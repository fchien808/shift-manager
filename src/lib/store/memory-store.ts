/**
 * In-memory Store implementation.
 *
 * Uses a process-local Map plus per-shift listener sets. Equivalent to the
 * old shift-store.ts but exposed through the async Store interface so the
 * callers don't care which backend is live.
 *
 * Attaches the Map to globalThis so Next.js dev-server hot reloads don't
 * wipe in-flight shifts on route recompile.
 */

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

interface MemRecord extends PersistedShift {
  eventListeners: Set<(event: ShiftEvent) => void>;
  doneListeners: Set<() => void>;
}

const globalAny = globalThis as unknown as {
  __shiftMemStore?: Map<string, MemRecord>;
};
const records: Map<string, MemRecord> =
  globalAny.__shiftMemStore ?? new Map();
if (!globalAny.__shiftMemStore) {
  globalAny.__shiftMemStore = records;
}

export class InMemoryStore implements Store {
  readonly kind = "memory" as const;

  async createShift(id: string, productProposal: string): Promise<void> {
    records.set(id, {
      id,
      productProposal,
      events: [],
      status: "planning",
      startedAt: Date.now(),
      eventListeners: new Set(),
      doneListeners: new Set(),
    });
  }

  async getShift(id: string): Promise<PersistedShift | null> {
    const rec = records.get(id);
    if (!rec) return null;
    return snapshot(rec);
  }

  async setPlan(id: string, plan: ShiftPlan): Promise<void> {
    const rec = records.get(id);
    if (!rec) return;
    rec.plan = plan;
  }

  async setStatus(id: string, status: ShiftStatus): Promise<void> {
    const rec = records.get(id);
    if (!rec) return;
    rec.status = status;
  }

  async appendEvent(id: string, event: ShiftEvent): Promise<void> {
    const rec = records.get(id);
    if (!rec) return;
    rec.events.push(event);
    for (const l of rec.eventListeners) {
      try {
        l(event);
      } catch {
        // best effort
      }
    }
  }

  async markDone(
    id: string,
    state: ShiftState,
    launchKit?: LaunchKit,
    error?: string
  ): Promise<void> {
    const rec = records.get(id);
    if (!rec) return;
    rec.state = state;
    rec.launchKit = launchKit;
    rec.status = error ? "failed" : "done";
    rec.completedAt = Date.now();
    rec.error = error;
    for (const l of rec.doneListeners) {
      try {
        l();
      } catch {}
    }
    rec.doneListeners.clear();
  }

  async listShifts(): Promise<ShiftSummary[]> {
    const out: ShiftSummary[] = [];
    for (const rec of records.values()) out.push(summarize(rec));
    out.sort((a, b) => b.startedAt - a.startedAt);
    return out;
  }

  async subscribe(
    id: string,
    handlers: SubscribeHandlers
  ): Promise<Unsubscribe> {
    const rec = records.get(id);
    if (!rec) {
      // No such shift — return a noop unsubscribe and fire onDone.
      handlers.onDone();
      return () => {};
    }
    rec.eventListeners.add(handlers.onEvent);
    rec.doneListeners.add(handlers.onDone);
    // If already terminal, fire onDone on next tick
    if (rec.status === "done" || rec.status === "failed") {
      setTimeout(() => {
        handlers.onDone();
        rec.eventListeners.delete(handlers.onEvent);
        rec.doneListeners.delete(handlers.onDone);
      }, 0);
    }
    return () => {
      rec.eventListeners.delete(handlers.onEvent);
      rec.doneListeners.delete(handlers.onDone);
    };
  }
}

function snapshot(rec: MemRecord): PersistedShift {
  return {
    id: rec.id,
    productProposal: rec.productProposal,
    plan: rec.plan,
    events: [...rec.events],
    state: rec.state,
    launchKit: rec.launchKit,
    status: rec.status,
    startedAt: rec.startedAt,
    completedAt: rec.completedAt,
    error: rec.error,
  };
}

function summarize(rec: MemRecord): ShiftSummary {
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
