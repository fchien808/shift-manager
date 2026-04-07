/**
 * In-memory shift registry.
 *
 * Each shift gets:
 *   - a rolling event buffer (so a late-connecting SSE client can replay history)
 *   - a set of active listeners that receive new events as they arrive
 *   - final state + launchKit once the shift finishes
 *
 * This is intentionally process-local and ephemeral. For a real product
 * this would be Redis + a durable store, but for the demo it keeps the
 * architecture readable end-to-end.
 */

import * as fs from "fs";
import * as path from "path";
import type {
  ShiftState,
  ShiftEvent,
  ShiftPlan,
  LaunchKit,
} from "@/types/shift";

// On-disk persistence so the /shifts index survives server restarts.
// Stored under ./data/shifts/{id}.json relative to the Next.js working dir.
// Disabled on Vercel where the function filesystem is read-only; the
// in-memory map is the only source of truth in that environment.
const DATA_DIR = path.resolve(process.cwd(), "data", "shifts");
const PERSIST_TO_DISK = process.env.VERCEL !== "1";

function ensureDataDir() {
  if (!PERSIST_TO_DISK) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    // best effort
  }
}

export interface PersistedShift {
  id: string;
  productProposal: string;
  plan?: ShiftPlan;
  events: ShiftEvent[];
  state?: ShiftState;
  launchKit?: LaunchKit;
  status: "planning" | "executing" | "done" | "failed";
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export interface ShiftRecord {
  id: string;
  productProposal: string;
  plan?: ShiftPlan;
  events: ShiftEvent[];
  state?: ShiftState;
  launchKit?: LaunchKit;
  status: "planning" | "executing" | "done" | "failed";
  startedAt: number;
  completedAt?: number;
  error?: string;
  listeners: Set<(event: ShiftEvent) => void>;
  doneListeners: Set<() => void>;
}

// Module-scoped map. Next.js dev server may hot-reload, so attach to globalThis
// to survive route handler recompiles within a single run.
const globalAny = globalThis as unknown as {
  __shiftStore?: Map<string, ShiftRecord>;
};
export const shiftStore: Map<string, ShiftRecord> =
  globalAny.__shiftStore ?? new Map();
if (!globalAny.__shiftStore) {
  globalAny.__shiftStore = shiftStore;
}

export function createShiftRecord(
  id: string,
  productProposal: string
): ShiftRecord {
  const record: ShiftRecord = {
    id,
    productProposal,
    events: [],
    status: "planning",
    startedAt: Date.now(),
    listeners: new Set(),
    doneListeners: new Set(),
  };
  shiftStore.set(id, record);
  return record;
}

export function pushEvent(id: string, event: ShiftEvent) {
  const rec = shiftStore.get(id);
  if (!rec) return;
  rec.events.push(event);
  for (const l of rec.listeners) {
    try {
      l(event);
    } catch {
      // best effort
    }
  }
}

export function markDone(
  id: string,
  state: ShiftState,
  launchKit?: LaunchKit,
  error?: string
) {
  const rec = shiftStore.get(id);
  if (!rec) return;
  rec.state = state;
  rec.launchKit = launchKit;
  rec.status = error ? "failed" : "done";
  rec.completedAt = Date.now();
  rec.error = error;
  // Persist a snapshot so /shifts survives server restarts.
  persistRecord(rec);
  for (const l of rec.doneListeners) {
    try {
      l();
    } catch {}
  }
  rec.doneListeners.clear();
}

function persistRecord(rec: ShiftRecord) {
  if (!PERSIST_TO_DISK) return;
  ensureDataDir();
  const snapshot: PersistedShift = {
    id: rec.id,
    productProposal: rec.productProposal,
    plan: rec.plan,
    events: rec.events,
    state: rec.state,
    launchKit: rec.launchKit,
    status: rec.status,
    startedAt: rec.startedAt,
    completedAt: rec.completedAt,
    error: rec.error,
  };
  try {
    fs.writeFileSync(
      path.join(DATA_DIR, `${rec.id}.json`),
      JSON.stringify(snapshot, null, 2),
      "utf-8"
    );
  } catch (err) {
    console.warn("[shift-store] persist failed", err);
  }
}

export function loadPersistedRecord(id: string): PersistedShift | null {
  if (!PERSIST_TO_DISK) return null;
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, `${id}.json`), "utf-8");
    return JSON.parse(raw) as PersistedShift;
  } catch {
    return null;
  }
}

export interface ShiftSummary {
  id: string;
  status: string;
  startedAt: number;
  completedAt?: number;
  productName?: string;
  oneLiner?: string;
  goal?: string;
  totalCost?: number;
  totalTokens?: number;
  error?: string;
}

export function listPersistedShifts(): ShiftSummary[] {
  // On Vercel, only in-memory records exist.
  if (!PERSIST_TO_DISK) {
    const summaries: ShiftSummary[] = [];
    for (const rec of shiftStore.values()) summaries.push(summarizeRecord(rec));
    summaries.sort((a, b) => b.startedAt - a.startedAt);
    return summaries;
  }

  ensureDataDir();
  let files: string[] = [];
  try {
    files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  const seenIds = new Set<string>();
  const summaries: ShiftSummary[] = [];

  // Include in-flight shifts from the in-memory store first
  for (const rec of shiftStore.values()) {
    summaries.push(summarizeRecord(rec));
    seenIds.add(rec.id);
  }

  for (const f of files) {
    const id = f.replace(/\.json$/, "");
    if (seenIds.has(id)) continue;
    const rec = loadPersistedRecord(id);
    if (rec) summaries.push(summarizeRecord(rec));
  }

  summaries.sort((a, b) => b.startedAt - a.startedAt);
  return summaries;
}

function summarizeRecord(rec: ShiftRecord | PersistedShift): ShiftSummary {
  let totalCost = 0;
  let totalTokens = 0;
  if (rec.state) {
    for (const r of Object.values(rec.state.results)) {
      for (const u of r.usage) {
        totalCost += u.costUsd;
        totalTokens += u.inputTokens + u.outputTokens;
      }
    }
  }
  return {
    id: rec.id,
    status: rec.status,
    startedAt: rec.startedAt,
    completedAt: rec.completedAt,
    productName: rec.launchKit?.positioning.productName,
    oneLiner: rec.launchKit?.positioning.oneLiner,
    goal: rec.plan?.goal,
    totalCost: totalCost || undefined,
    totalTokens: totalTokens || undefined,
    error: rec.error,
  };
}
