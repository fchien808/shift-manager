/**
 * Redis Store implementation (TCP via ioredis).
 *
 * Works with any Redis provider that speaks the standard Redis wire
 * protocol over TCP/TLS — Vercel KV (Upstash), Vercel Marketplace Redis
 * Cloud, raw Upstash, self-hosted Redis, etc. Reads `REDIS_URL` (preferred,
 * what Vercel injects) and falls back to a host/port pair if needed.
 *
 * Storage layout:
 *   shift:{id}           - JSON blob of the PersistedShift metadata (no events)
 *   shift:{id}:events    - Redis list of ShiftEvent JSON strings (RPUSH order)
 *   shifts:index         - Sorted set (score = startedAt) of shift ids for /shifts listing
 *
 * Live updates work via polling rather than Redis pub/sub. ioredis can do
 * pub/sub but it requires a dedicated subscriber connection per channel
 * which is awkward on serverless. Polling is simpler and more reliable:
 * an SSE subscriber tracks the last event index it has seen and re-runs
 * LRANGE + a status read every ~800ms until the shift reaches a terminal
 * state.
 *
 * Connection management: a single ioredis client is cached on globalThis
 * so warm Lambda invocations reuse it instead of opening a new TCP/TLS
 * connection per request. Cold starts pay one ~50ms connection cost.
 */

import Redis from "ioredis";
import type {
  Store,
  PersistedShift,
  ShiftSummary,
  ShiftStatus,
  SubscribeHandlers,
  Unsubscribe,
} from "./types";
import type {
  ShiftState,
  ShiftEvent,
  ShiftPlan,
  LaunchKit,
} from "@/types/shift";

const SHIFT_KEY = (id: string) => `shift:${id}`;
const EVENTS_KEY = (id: string) => `shift:${id}:events`;
const INDEX_KEY = "shifts:index";
const TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

interface ShiftBlob {
  id: string;
  productProposal: string;
  plan?: ShiftPlan;
  state?: ShiftState;
  launchKit?: LaunchKit;
  status: ShiftStatus;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

const globalAny = globalThis as unknown as { __ioredis?: Redis };

function getClient(): Redis {
  if (globalAny.__ioredis) return globalAny.__ioredis;
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("RedisStore requires REDIS_URL env var");
  }
  // ioredis options tuned for serverless: short connect timeout, keep
  // commands buffered if the connection drops so a follow-up call
  // triggers a reconnect rather than throwing.
  const client = new Redis(url, {
    connectTimeout: 10_000,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    // Required for rediss:// (TLS) endpoints; harmless for plain redis://
    tls: url.startsWith("rediss://") ? {} : undefined,
  });
  client.on("error", (err) => {
    console.warn("[RedisStore] client error", err.message);
  });
  globalAny.__ioredis = client;
  return client;
}

export function redisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL);
}

export class RedisStore implements Store {
  readonly kind = "redis" as const;
  private redis: Redis;

  constructor() {
    this.redis = getClient();
  }

  async createShift(id: string, productProposal: string): Promise<void> {
    const blob: ShiftBlob = {
      id,
      productProposal,
      status: "planning",
      startedAt: Date.now(),
    };
    await this.redis.set(SHIFT_KEY(id), JSON.stringify(blob), "EX", TTL_SECONDS);
    await this.redis.zadd(INDEX_KEY, blob.startedAt, id);
  }

  async getShift(id: string): Promise<PersistedShift | null> {
    const blob = await this.readBlob(id);
    if (!blob) return null;
    const events = await this.readEvents(id);
    return { ...blob, events };
  }

  async setPlan(id: string, plan: ShiftPlan): Promise<void> {
    await this.mutateBlob(id, (b) => {
      b.plan = plan;
    });
  }

  async setStatus(id: string, status: ShiftStatus): Promise<void> {
    await this.mutateBlob(id, (b) => {
      b.status = status;
    });
  }

  async appendEvent(id: string, event: ShiftEvent): Promise<void> {
    await this.redis.rpush(EVENTS_KEY(id), JSON.stringify(event));
    await this.redis.expire(EVENTS_KEY(id), TTL_SECONDS);
  }

  async markDone(
    id: string,
    state: ShiftState,
    launchKit?: LaunchKit,
    error?: string
  ): Promise<void> {
    await this.mutateBlob(id, (b) => {
      b.state = state;
      b.launchKit = launchKit;
      b.status = error ? "failed" : "done";
      b.completedAt = Date.now();
      b.error = error;
    });
  }

  async listShifts(): Promise<ShiftSummary[]> {
    // Newest first via ZREVRANGE.
    const ids = await this.redis.zrevrange(INDEX_KEY, 0, 99);
    if (!ids.length) return [];
    const pipe = this.redis.pipeline();
    for (const id of ids) pipe.get(SHIFT_KEY(id));
    const results = (await pipe.exec()) ?? [];
    const out: ShiftSummary[] = [];
    for (const [, raw] of results) {
      const b = parseBlob(raw as string | null);
      if (!b) continue;
      out.push(summarizeBlob(b));
    }
    return out;
  }

  async subscribe(
    id: string,
    handlers: SubscribeHandlers
  ): Promise<Unsubscribe> {
    let lastIdx = await this.redis.llen(EVENTS_KEY(id));
    let cancelled = false;
    let timer: NodeJS.Timeout | null = null;

    const tick = async () => {
      if (cancelled) return;
      try {
        const len = await this.redis.llen(EVENTS_KEY(id));
        if (len > lastIdx) {
          const newRaw = await this.redis.lrange(
            EVENTS_KEY(id),
            lastIdx,
            len - 1
          );
          lastIdx = len;
          for (const raw of newRaw) {
            const ev = parseEvent(raw);
            if (ev && !cancelled) handlers.onEvent(ev);
          }
        }
        const blob = await this.readBlob(id);
        if (blob && (blob.status === "done" || blob.status === "failed")) {
          if (!cancelled) {
            handlers.onDone();
            cancelled = true;
            return;
          }
        }
      } catch (err) {
        console.warn("[RedisStore] subscribe poll failed", err);
      }
      if (!cancelled) {
        timer = setTimeout(tick, 800);
      }
    };

    timer = setTimeout(tick, 200);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }

  // ---- helpers ----

  private async readBlob(id: string): Promise<ShiftBlob | null> {
    const raw = await this.redis.get(SHIFT_KEY(id));
    return parseBlob(raw);
  }

  private async readEvents(id: string): Promise<ShiftEvent[]> {
    const raws = await this.redis.lrange(EVENTS_KEY(id), 0, -1);
    const out: ShiftEvent[] = [];
    for (const r of raws) {
      const ev = parseEvent(r);
      if (ev) out.push(ev);
    }
    return out;
  }

  private async mutateBlob(
    id: string,
    mutator: (b: ShiftBlob) => void
  ): Promise<void> {
    const blob = await this.readBlob(id);
    if (!blob) return;
    mutator(blob);
    await this.redis.set(
      SHIFT_KEY(id),
      JSON.stringify(blob),
      "EX",
      TTL_SECONDS
    );
  }
}

function parseBlob(raw: string | null | undefined): ShiftBlob | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ShiftBlob;
  } catch {
    return null;
  }
}

function parseEvent(raw: string): ShiftEvent | null {
  try {
    return JSON.parse(raw) as ShiftEvent;
  } catch {
    return null;
  }
}

function summarizeBlob(b: ShiftBlob): ShiftSummary {
  let totalCost = 0;
  let totalTokens = 0;
  if (b.state) {
    for (const r of Object.values(b.state.results)) {
      for (const u of r.usage) {
        totalCost += u.costUsd;
        totalTokens += u.inputTokens + u.outputTokens;
      }
    }
  }
  return {
    id: b.id,
    status: b.status,
    startedAt: b.startedAt,
    completedAt: b.completedAt,
    productName: b.launchKit?.positioning.productName,
    oneLiner: b.launchKit?.positioning.oneLiner,
    goal: b.plan?.goal,
    totalCost: totalCost || undefined,
    totalTokens: totalTokens || undefined,
    error: b.error,
  };
}
