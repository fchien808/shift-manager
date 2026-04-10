/**
 * WorkerRegistry - the canonical catalog of WorkerSpecs available to the planner.
 *
 * Sources, in order of precedence (later wins on id collision):
 *   1. Seed specs (compiled into the bundle, src/workers/seeds/)
 *   2. Synthesized specs persisted to disk at ./data/workers/{id}.json
 *
 * The registry is a thin in-memory Map that lazy-loads from disk on first access.
 * Synthesized specs are written back via `saveSpec`. Metrics are tracked per-id
 * and flushed on update.
 *
 * The planner queries the registry via `listActive()` / `find()`. The runtime
 * resolves a PlannedTask's workerId to a spec via `get()`.
 */

import fs from "node:fs";
import path from "node:path";
import type { WorkerSpec } from "@/types/worker-spec";
import { seedWorkerSpecs } from "./seeds";

const WORKERS_DIR = path.join(process.cwd(), "data", "workers");

/**
 * On Vercel, the function filesystem is read-only (except /tmp, which is
 * ephemeral). Disk persistence is skipped; instead, synthesized workers are
 * persisted to Redis (if configured) so they survive cold starts and are
 * available to future shifts.
 */
const ON_VERCEL = process.env.VERCEL === "1";
const PERSIST_TO_DISK = !ON_VERCEL;

/**
 * Redis persistence for synthesized workers on Vercel. We lazily import
 * ioredis to avoid issues when Redis isn't configured (local dev).
 */
const REDIS_WORKER_PREFIX = "worker:spec:";

let _redisClient: import("ioredis").default | null | undefined;
async function getRedis(): Promise<import("ioredis").default | null> {
  if (_redisClient !== undefined) return _redisClient;
  const url = process.env.REDIS_URL;
  if (!url) {
    _redisClient = null;
    return null;
  }
  try {
    const { default: Redis } = await import("ioredis");
    _redisClient = new Redis(url, {
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
      tls: url.startsWith("rediss://") ? {} : undefined,
    });
    return _redisClient;
  } catch {
    _redisClient = null;
    return null;
  }
}

class WorkerRegistry {
  private specs = new Map<string, WorkerSpec>();
  private loaded = false;

  private ensureLoaded() {
    if (this.loaded) return;
    // 1. Seeds first.
    for (const s of seedWorkerSpecs) {
      this.specs.set(s.id, s);
    }
    // 2. Disk overrides / additions (skipped on Vercel).
    if (!PERSIST_TO_DISK) {
      this.loaded = true;
      // Kick off async Redis load — fills in synthesized workers from
      // previous shifts. Callers that need the full catalog (planner)
      // should call `await ensureReady()` before reading.
      this.redisLoadPromise = this.loadFromRedis();
      return;
    }
    try {
      if (fs.existsSync(WORKERS_DIR)) {
        for (const file of fs.readdirSync(WORKERS_DIR)) {
          if (!file.endsWith(".json")) continue;
          try {
            const raw = fs.readFileSync(path.join(WORKERS_DIR, file), "utf8");
            const spec = JSON.parse(raw) as WorkerSpec;
            if (spec && typeof spec.id === "string") {
              this.specs.set(spec.id, spec);
            }
          } catch (e) {
            console.warn(`[registry] failed to load ${file}:`, e);
          }
        }
      }
    } catch (e) {
      console.warn("[registry] disk load failed:", e);
    }
    this.loaded = true;
  }

  /** Load synthesized workers from Redis into the in-memory map. */
  private async loadFromRedis(): Promise<void> {
    try {
      const redis = await getRedis();
      if (!redis) return;
      const keys = await redis.keys(`${REDIS_WORKER_PREFIX}*`);
      if (keys.length === 0) return;
      const pipe = redis.pipeline();
      for (const k of keys) pipe.get(k);
      const results = await pipe.exec();
      if (!results) return;
      let count = 0;
      for (const [err, raw] of results) {
        if (err || typeof raw !== "string") continue;
        try {
          const spec = JSON.parse(raw) as WorkerSpec;
          if (spec && typeof spec.id === "string") {
            this.specs.set(spec.id, spec);
            count++;
          }
        } catch {
          // skip malformed entries
        }
      }
      if (count > 0) {
        console.log(`[registry] loaded ${count} synthesized worker(s) from Redis`);
      }
    } catch (e) {
      console.warn("[registry] Redis load failed:", e);
    }
  }

  private redisLoadPromise: Promise<void> | null = null;

  /**
   * Async version of ensureLoaded that waits for Redis to finish loading.
   * Call this before any operation that needs synthesized workers from
   * previous shifts (e.g. the planner building the catalog).
   */
  async ensureReady(): Promise<void> {
    this.ensureLoaded();
    if (this.redisLoadPromise) await this.redisLoadPromise;
  }

  get(id: string): WorkerSpec | undefined {
    this.ensureLoaded();
    return this.specs.get(id);
  }

  getOrThrow(id: string): WorkerSpec {
    const s = this.get(id);
    if (!s) throw new Error(`WorkerSpec not found: ${id}`);
    return s;
  }

  list(): WorkerSpec[] {
    this.ensureLoaded();
    return [...this.specs.values()];
  }

  listActive(): WorkerSpec[] {
    return this.list().filter((s) => s.status === "active");
  }

  find(predicate: (s: WorkerSpec) => boolean): WorkerSpec[] {
    return this.list().filter(predicate);
  }

  /** Compact summary for inclusion in planner prompts. */
  catalogForPlanner(): Array<{
    id: string;
    name: string;
    description: string;
    purpose: string;
    tags: string[];
    tier: WorkerSpec["tier"];
    inputSchema: unknown;
    outputFormat: WorkerSpec["outputFormat"];
    status: WorkerSpec["status"];
  }> {
    return this.listActive().map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      purpose: s.purpose,
      tags: s.tags,
      tier: s.tier,
      inputSchema: s.inputSchema,
      outputFormat: s.outputFormat,
      status: s.status,
    }));
  }

  saveSpec(spec: WorkerSpec): void {
    this.ensureLoaded();
    this.specs.set(spec.id, spec);
    if (PERSIST_TO_DISK) {
      try {
        fs.mkdirSync(WORKERS_DIR, { recursive: true });
        fs.writeFileSync(
          path.join(WORKERS_DIR, `${spec.id}.json`),
          JSON.stringify(spec, null, 2),
          "utf8"
        );
      } catch (e) {
        console.warn(`[registry] failed to persist ${spec.id} to disk:`, e);
      }
    }
    // On Vercel (or whenever Redis is available), persist non-seed specs to
    // Redis so they survive cold starts and are available to future shifts.
    if (spec.createdBy !== "seed") {
      void this.saveToRedis(spec);
    }
  }

  private async saveToRedis(spec: WorkerSpec): Promise<void> {
    try {
      const redis = await getRedis();
      if (!redis) return;
      // 30-day TTL so stale synthesized workers are eventually cleaned up.
      await redis.set(
        `${REDIS_WORKER_PREFIX}${spec.id}`,
        JSON.stringify(spec),
        "EX",
        60 * 60 * 24 * 30
      );
    } catch (e) {
      console.warn(`[registry] failed to persist ${spec.id} to Redis:`, e);
    }
  }

  /** Approve a draft worker, flipping it to active and persisting. */
  approveDraft(id: string): WorkerSpec {
    const s = this.getOrThrow(id);
    if (s.status === "active") return s;
    if (s.status !== "draft") {
      throw new Error(`Worker ${id} is not a draft (status=${s.status})`);
    }
    s.status = "active";
    this.saveSpec(s);
    return s;
  }

  recordRun(id: string, success: boolean, verifierIssues?: number) {
    const s = this.get(id);
    if (!s) return;
    const metrics = s.metrics ?? { uses: 0, successes: 0 };
    metrics.uses += 1;
    if (success) metrics.successes += 1;
    metrics.lastUsedAt = Date.now();
    if (verifierIssues !== undefined) metrics.lastVerifierIssues = verifierIssues;
    s.metrics = metrics;
    // Only persist metrics for disk-backed (non-seed) specs to avoid
    // mutating seeds on each run. Seeds stay immutable in-memory.
    if (s.createdBy !== "seed") {
      this.saveSpec(s);
    }
  }
}

export const workerRegistry = new WorkerRegistry();
