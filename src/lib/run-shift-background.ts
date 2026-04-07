/**
 * Fire-and-forget runner that drives a shift through planning + execution
 * and writes every event into the shift store. Called by the POST /api/shift
 * route handler. The HTTP response returns immediately with the shift id;
 * clients then subscribe to /api/shift/[id]/stream for live events.
 */

import { planShift } from "@/orchestrator/planner";
import { runShift } from "@/orchestrator/supervisor";
import { createShiftRecord, pushEvent, markDone, shiftStore } from "./shift-store";
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
  createShiftRecord(shiftId, productProposal);

  return (async () => {
    try {
      pushEvent(shiftId, {
        type: "task_progress",
        taskId: "__planning__",
        message: "Opus planner drafting shift DAG",
      });

      const {
        plan,
        usage: plannerUsage,
        artifacts: planningArtifacts,
      } = await planShift(shiftId, productProposal);

      const rec = shiftStore.get(shiftId);
      if (rec) {
        rec.plan = plan;
        rec.status = "executing";
      }

      // Broadcast planner usage as a synthetic task_completed so the live
      // cost dashboard includes Opus planning cost (matching the report view).
      if (plannerUsage.length > 0) {
        pushEvent(shiftId, {
          type: "task_completed",
          taskId: "__planning__",
          usage: plannerUsage,
        });
      }

      const onEvent = (event: ShiftEvent) => pushEvent(shiftId, event);

      const { state, launchKit } = await runShift({
        shiftId,
        productProposal,
        plan,
        plannerUsage,
        planningArtifacts,
        onEvent,
      });

      markDone(
        shiftId,
        state,
        launchKit,
        state.status === "failed" ? "Shift failed" : undefined
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushEvent(shiftId, { type: "shift_failed", error: message });
      const rec = shiftStore.get(shiftId);
      if (rec) {
        markDone(
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
            startedAt: rec.startedAt,
            status: "failed",
          },
          undefined,
          message
        );
      }
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
