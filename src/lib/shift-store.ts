/**
 * Compat shim re-exporting the new async Store API.
 *
 * The old sync in-memory shift-store has been replaced by a pluggable
 * Store (see ./store/). This file now just re-exports what callers need
 * so the import paths stay stable. New code should import from
 * "@/lib/store" directly.
 */

export { getStore } from "./store";
export type {
  Store,
  PersistedShift,
  ShiftSummary,
  ShiftStatus,
} from "./store";
