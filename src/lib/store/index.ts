/**
 * Store factory. Picks the Redis backend when env vars are present,
 * otherwise falls back to the in-memory store. The choice is made once
 * per process and cached on globalThis so route handlers share state.
 */

import type { Store } from "./types";
import { InMemoryStore } from "./memory-store";
import { RedisStore, redisConfigured } from "./redis-store";

const globalAny = globalThis as unknown as { __store?: Store };

export function getStore(): Store {
  if (globalAny.__store) return globalAny.__store;
  let store: Store;
  if (redisConfigured()) {
    try {
      store = new RedisStore();
      console.log("[store] using RedisStore (Upstash)");
    } catch (err) {
      console.warn(
        "[store] RedisStore init failed, falling back to memory:",
        err
      );
      store = new InMemoryStore();
    }
  } else {
    store = new InMemoryStore();
    console.log("[store] using InMemoryStore (no Redis env vars set)");
  }
  globalAny.__store = store;
  return store;
}

export type { Store, PersistedShift, ShiftSummary, ShiftStatus } from "./types";
