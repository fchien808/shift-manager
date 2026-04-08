/**
 * Upstash Redis Store implementation.
 *
 * Storage layout:
 *   shift:{id}           - JSON blob of the PersistedShift metadata (no events)
 *   shift:{id}:events    - Redis list of ShiftEvent JSON strings (RPUSH order)
 *   shifts:index         - Sorted set (score = startedAt) of shift ids for /shifts listing
 *
 * Live updates work via polling rather than Redis pub/sub. Upstash's HTTP
 * client doesn't support long-lived subscribe connections, and polling is
 * more serverless-friendly anyway: an SSE subscriber keeps track of the
 * last event index it has seen and re-runs LRANGE + metadata GET every
 * ~800ms until the shift reaches a terminal status.
 *
 * This means latency for a new event reaching the live view is up to 800ms
 * (and for same-instance runs it's still immediate via the in-memory
 * listener shortcut). Good enough for a demo and avoids managing Redis
 * connection pools from Vercel functions.
 */

import { Redis } from "@upstash/redis";
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

function buildRedis(): Redis {
  // Prefer explicit UPSTASH_* vars; fall back to Vercel KV's KV_REST_API_* vars.
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error(
      "RedisStore requires UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN env vars"
    );
  }
  return new Redis({ url, token });
}

export function redisConfigured(): boolean {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
      (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)
  );
}

export class RedisStore implements Store {
  readonly kind = "redis" as const;
  private redis: Redis;

  constructor() {
    this.redis = buildRedis();
  }

  async createShift(id: string, productProposal: string): Promise<void> {
    const blob: ShiftBlob = {
      id,
      productProposal,
      status: "planning",
      startedAt: Date.now(),
    };
    await this.redis.set(SHIFT_KEY(id), JSON.stringify(blob), {
      ex: TTL_SECONDS,
    });
    await this.redis.expire(EVENTS_KEY(id), TTL_SECONDS);
    await this.redis.zadd(INDEX_KEY, { score: blob.startedAt, member: id });
  }

  async getShift(id: string): Promise<PersistedShift | null> {
    const blob = await this.readBlob(id);
    if (!blob) return null;
    const events = await this.readEvents(id);
    return {
      ...blob,
      events,
    };
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
    // Newest first via ZRANGE with REV.
    const ids = (await this.redis.zrange(INDEX_KEY, 0, 99, {
      rev: true,
    })) as string[];
    if (!ids.length) return [];
    const pipe = this.redis.pipeline();
    for (const id of ids) pipe.get(SHIFT_KEY(id));
    const blobs = (await pipe.exec()) as (ShiftBlob | string | null)[];
    const out: ShiftSummary[] = [];
    for (const raw of blobs) {
      const b = parseBlob(raw);
      if (!b) continue;
      out.push(summarizeBlob(b));
    }
    return out;
  }

  async subscribe(
    id: string,
    handlers: SubscribeHandlers
  ): Promise<Unsubscribe> {
    // Polling subscription. Starts from the current event count (the SSE
    // route already replays history separately via getShift).
    let lastIdx = await this.redis.llen(EVENTS_KEY(id));
    let cancelled = false;
    let timer: NodeJS.Timeout | null = null;

    const tick = async () => {
      if (cancelled) return;
      try {
        const len = await this.redis.llen(EVENTS_KEY(id));
        if (len > lastIdx) {
          const newRaw = (await this.redis.lrange(
            EVENTS_KEY(id),
            lastIdx,
            len - 1
          )) as (string | ShiftEvent)[];
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

    // Kick off the first poll soon, not immediately, so replay can finish.
    timer = setTimeout(tick, 200);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }

  // ---- helpers ----

  private async readBlob(id: string): Promise<ShiftBlob | null> {
    const raw = (await this.redis.get(SHIFT_KEY(id))) as
      | ShiftBlob
      | string
      | null;
    return parseBlob(raw);
  }

  private async readEvents(id: string): Promise<ShiftEvent[]> {
    const raws = (await this.redis.lrange(EVENTS_KEY(id), 0, -1)) as (
      | string
      | ShiftEvent
    )[];
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
    await this.redis.set(SHIFT_KEY(id), JSON.stringify(blob), {
      ex: TTL_SECONDS,
    });
  }
}

function parseBlob(raw: ShiftBlob | string | null | undefined): ShiftBlob | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as ShiftBlob;
    } catch {
      return null;
    }
  }
  return raw as ShiftBlob;
}

function parseEvent(raw: string | ShiftEvent): ShiftEvent | null {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as ShiftEvent;
    } catch {
      return null;
    }
  }
  return raw;
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
