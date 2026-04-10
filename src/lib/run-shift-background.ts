/**
 * Fire-and-forget runner that drives a shift through planning + execution
 * and writes every event into the Store. Called by the POST /api/shift
 * route handler. The HTTP response returns immediately with the shift id;
 * clients then subscribe to /api/shift/[id]/stream for live events.
 */

// TODO(roadmap #2): after each task completes, hand the artifact to any
// matching Cowork connector (Webflow/LinkedIn/Notion/etc.) and push as a
// DRAFT — never auto-publish. Surface push status in the event stream.
// See TODO.md.
import { planShift } from "@/orchestrator/planner";
import { runShift } from "@/orchestrator/supervisor";
import { getStore } from "./store";
import type { ShiftEvent } from "@/types/shift";

/**
 * Run a shift to completion. Returns a promise that resolves when the shift
 * finishes (success or failure). Callers that want fire-and-forget behavior
 * (dev server) can drop the promise; callers on Vercel should pass the
 * returned promise into `waitUntil` so the Lambda stays alive until done.
 */
export function runShiftToCompletion(
  shiftId: string,
  productProposal: string
): Promise<void> {
  const store = getStore();

  return (async () => {
    await store.createShift(shiftId, productProposal);
    try {
      await store.appendEvent(shiftId, {
        type: "task_progress",
        taskId: "__planning__",
        message: "Opus planner drafting shift DAG",
      });

      // Rotating heartbeat so the UI shows live "planner thinking" status
      // during the ~60s Opus planning call. These are narrated stages, not
      // streamed tokens — cheap, reliable, and informative.
      const plannerThoughts = [
        "Reading worker registry catalog…",
        "Analyzing product proposal for core value props…",
        "Matching steps to available workers…",
        "Checking for capability gaps in the registry…",
        "Decomposing launch into a parallelizable DAG…",
        "Wiring task dependencies and input bindings…",
        "Assigning model tiers per task…",
        "Drafting task descriptions tailored to this product…",
        "Validating plan structure…",
        "Finalizing shift plan…",
      ];
      let thoughtIdx = 0;
      const heartbeat = setInterval(() => {
        void store.appendEvent(shiftId, {
          type: "task_progress",
          taskId: "__planning__",
          message: plannerThoughts[thoughtIdx % plannerThoughts.length],
        });
        thoughtIdx++;
      }, 5000);

      let planResult;
      try {
        planResult = await planShift(shiftId, productProposal);
      } finally {
        clearInterval(heartbeat);
      }
      const {
        plan,
        usage: plannerUsage,
        artifacts: planningArtifacts,
      } = planResult;

      await store.setPlan(shiftId, plan);
      await store.setStatus(shiftId, "executing");

      // Broadcast planner usage as a synthetic task_completed so the live
      // cost dashboard includes Opus planning cost (matching the report view).
      if (plannerUsage.length > 0) {
        await store.appendEvent(shiftId, {
          type: "task_completed",
          taskId: "__planning__",
          usage: plannerUsage,
        });
      }

      const onEvent = (event: ShiftEvent) => {
        void store.appendEvent(shiftId, event);
      };

      const { state, launchKit } = await runShift({
        shiftId,
        productProposal,
        plan,
        plannerUsage,
        planningArtifacts,
        onEvent,
      });

      // If the supervisor re-planned after synthesizing new workers, the
      // active plan on `state` will differ from the original. Sync it back
      // to the store so the report page sees the final plan (including any
      // synthesized worker tasks like competitor-research or gtm-strategy).
      if (state.plan && state.plan !== plan) {
        await store.setPlan(shiftId, state.plan);
      }

      await store.markDone(
        shiftId,
        state,
        launchKit,
        state.status === "failed" ? "Shift failed" : undefined
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.appendEvent(shiftId, { type: "shift_failed", error: message });
      const existing = await store.getShift(shiftId);
      await store.markDone(
        shiftId,
        {
          shiftId,
          input: productProposal,
          plan: {
            shiftId,
            goal: "",
            tasks: [],
            estimatedTokenBudget: { opus: 0, sonnet: 0, haiku: 0 },
            createdAt: Date.now(),
          },
          results: {},
          blockers: [],
          startedAt: existing?.startedAt ?? Date.now(),
          status: "failed",
        },
        undefined,
        message
      );
    }
  })();
}

// Legacy fire-and-forget alias for any remaining callers.
export function startShiftInBackground(
  shiftId: string,
  productProposal: string
): void {
  void runShiftToCompletion(shiftId, productProposal);
}
