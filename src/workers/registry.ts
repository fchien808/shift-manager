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
 * ephemeral). Skip disk persistence entirely in that environment — seeds
 * come from the compiled bundle and synthesized workers live in memory for
 * the warm Lambda's lifetime, which is sufficient for a demo shift.
 */
const PERSIST_TO_DISK = process.env.VERCEL !== "1";

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
    if (!PERSIST_TO_DISK) return;
    try {
      fs.mkdirSync(WORKERS_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(WORKERS_DIR, `${spec.id}.json`),
        JSON.stringify(spec, null, 2),
        "utf8"
      );
    } catch (e) {
      console.warn(`[registry] failed to persist ${spec.id}:`, e);
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
