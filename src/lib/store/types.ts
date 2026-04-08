/**
 * Store interface: the persistence + pub/sub boundary for shifts.
 *
 * Two implementations:
 *   - InMemoryStore: process-local Map + listener callbacks. Used for local
 *     dev when no Redis env vars are set.
 *   - RedisStore: Upstash Redis (HTTP client). Records are JSON blobs,
 *     events are lists, and subscribers poll LRANGE from their last index.
 *     Works across Lambda instances and survives cold starts.
 *
 * All methods are async so callers don't need to know which backend is live.
 */

import type {
  ShiftState,
  ShiftEvent,
  ShiftPlan,
  LaunchKit,
} from "@/types/shift";

export type ShiftStatus = "planning" | "executing" | "done" | "failed";

export interface PersistedShift {
  id: string;
  productProposal: string;
  plan?: ShiftPlan;
  events: ShiftEvent[];
  state?: ShiftState;
  launchKit?: LaunchKit;
  status: ShiftStatus;
  startedAt: number;
  completedAt?: number;
  error?: string;
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

export interface SubscribeHandlers {
  onEvent: (event: ShiftEvent) => void;
  onDone: () => void;
}

/** Returned unsubscribe function. */
export type Unsubscribe = () => void;

export interface Store {
  /** Backend name for logging. */
  readonly kind: "memory" | "redis";

  createShift(id: string, productProposal: string): Promise<void>;

  getShift(id: string): Promise<PersistedShift | null>;

  setPlan(id: string, plan: ShiftPlan): Promise<void>;

  setStatus(id: string, status: ShiftStatus): Promise<void>;

  /** Append an event to the shift's event log and notify subscribers. */
  appendEvent(id: string, event: ShiftEvent): Promise<void>;

  /** Finalize a shift with its final state + launch kit. */
  markDone(
    id: string,
    state: ShiftState,
    launchKit?: LaunchKit,
    error?: string
  ): Promise<void>;

  /** List summaries for the /shifts index, newest first. */
  listShifts(): Promise<ShiftSummary[]>;

  /**
   * Subscribe to live events for a shift. Returns an unsubscribe.
   * The store will call onEvent for every new event AFTER replay is done;
   * callers are responsible for replaying history separately via getShift.
   * When the shift terminates, onDone fires once and the subscription
   * is auto-torn-down.
   */
  subscribe(id: string, handlers: SubscribeHandlers): Promise<Unsubscribe>;
}
