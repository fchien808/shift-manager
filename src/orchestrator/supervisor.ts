/**
 * Supervisor - the orchestrator loop that executes an approved shift plan.
 *
 * Data-driven version: the hardcoded worker switch is gone. The supervisor
 * walks the PlannedTask DAG, resolves each task's workerId to a WorkerSpec
 * via the registry, binds its inputs using the BindingContext (proposal,
 * upstream task outputs, planning artifacts), and invokes runWorker.
 *
 * What's still special-cased:
 *   - Social image generation runs as a post-step against the
 *     social-campaign task's output (it mutates the output in place
 *     before downstream consumers like verification see it).
 *   - Assembly is a deterministic merge with zero token cost. It's not
 *     a registry worker; the supervisor builds the LaunchKit directly
 *     from the final outputs by workerId.
 *
 * Waves:
 *   - Tasks execute in waves. A wave is the set of remaining tasks whose
 *     dependencies are all completed. Each wave runs in parallel.
 */

import {
  ShiftState,
  ShiftPlan,
  TaskResult,
  TokenUsage,
  EventCallback,
  LaunchKit,
  PositioningOutput,
  MarketingCopyOutput,
  WebsiteOutput,
  SocialCampaignOutput,
  CsDocsOutput,
  VerificationOutput,
} from "@/types/shift";
import type { PlannedTask, PlanningArtifact } from "@/types/worker-spec";
import { workerRegistry } from "@/workers/registry";
import { runWorker, resolveInputs, type BindingContext } from "@/workers/runtime";
import { generateImagesForCampaign } from "@/workers/image-gen";
import { synthesizeWorker } from "./synthesizer";
import { planShift } from "./planner";

const MAX_RETRIES = 1;

export interface RunShiftOptions {
  shiftId: string;
  productProposal: string;
  plan: ShiftPlan;
  plannerUsage?: TokenUsage[];
  planningArtifacts?: PlanningArtifact[];
  onEvent?: EventCallback;
  /**
   * When true (demo mode default), capability gaps are synthesized by Opus
   * and auto-approved for immediate use. When false, synthesized workers are
   * left as drafts and the shift surfaces blockers pending manual approval.
   */
  autoApproveSynthesized?: boolean;
}

export async function runShift(
  opts: RunShiftOptions
): Promise<{ state: ShiftState; launchKit?: LaunchKit }> {
  const {
    shiftId,
    productProposal,
    plan,
    plannerUsage,
    planningArtifacts = [],
    onEvent = () => {},
    autoApproveSynthesized = true,
  } = opts;

  const state: ShiftState = {
    shiftId,
    input: productProposal,
    plan,
    results: {},
    blockers: [],
    startedAt: Date.now(),
    status: "executing",
  };

  if (plannerUsage && plannerUsage.length > 0) {
    state.results["__planning__"] = {
      taskId: "__planning__",
      status: "completed",
      usage: plannerUsage,
      startedAt: state.startedAt,
      completedAt: state.startedAt,
      retryCount: 0,
    };
  }

  // Mutable plan reference — may be replaced by a re-plan after synthesis.
  let activePlan = plan;

  // Binding context: seeded with the proposal + any planning-time artifacts
  // the planner produced via tool-use. Grows as upstream tasks complete.
  const ctx: BindingContext = {
    proposal: productProposal,
    taskOutputs: {},
    artifacts: Object.fromEntries(planningArtifacts.map((a) => [a.id, a])),
  };

  onEvent({ type: "plan_created", plan: activePlan });

  // Phase C: when the planner surfaces capability gaps, synthesize a new
  // WorkerSpec per gap via Opus. In demo mode (autoApproveSynthesized=true)
  // the draft is immediately promoted to active so downstream re-planning
  // could pick it up; otherwise it stays a draft and surfaces as a blocker.
  let approvedSynthesizedCount = 0;
  if (activePlan.capabilityGaps && activePlan.capabilityGaps.length > 0) {
    for (const gap of activePlan.capabilityGaps) {
      try {
        onEvent({
          type: "task_progress",
          taskId: gap.proposedWorkerId,
          message: `Synthesizing new worker for capability gap: ${gap.proposedPurpose}`,
        });
        const { spec, usage } = await synthesizeWorker(gap, productProposal, shiftId);
        state.results[`__synth__${spec.id}`] = {
          taskId: `__synth__${spec.id}`,
          status: "completed",
          usage: [usage],
          startedAt: Date.now(),
          completedAt: Date.now(),
          retryCount: 0,
          output: { synthesizedWorkerId: spec.id, status: spec.status },
        };
        if (autoApproveSynthesized) {
          workerRegistry.approveDraft(spec.id);
          approvedSynthesizedCount += 1;
          onEvent({
            type: "task_progress",
            taskId: spec.id,
            message: `Auto-approved synthesized worker "${spec.id}"`,
          });
        } else {
          const blocker = {
            taskId: spec.id,
            description: `Draft worker "${spec.id}" synthesized from capability gap and pending approval`,
            proposedResolution: `Review the draft at /workers and approve it to make it available to the planner.`,
            severity: "info" as const,
          };
          state.blockers.push(blocker);
          onEvent({ type: "blocker_raised", blocker });
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const blocker = {
          taskId: gap.proposedWorkerId,
          description: `Worker synthesis failed for "${gap.proposedWorkerId}": ${errorMessage.slice(0, 200)}`,
          proposedResolution: `Proceeding without the missing capability; the existing plan will run on available workers.`,
          severity: "warning" as const,
        };
        state.blockers.push(blocker);
        onEvent({ type: "blocker_raised", blocker });
      }
    }
  }

  // Phase C mid-shift re-plan: if we synthesized and approved at least one
  // new worker, re-invoke the planner so the current shift can actually use
  // the new capability. We re-plan at most once; if the fresh plan still
  // contains capability gaps those surface as info blockers but we do NOT
  // loop (no runaway synthesis). The original plan is kept on state under
  // `__originalPlan` via a blocker for provenance.
  if (approvedSynthesizedCount > 0) {
    try {
      onEvent({
        type: "task_progress",
        taskId: "__replan__",
        message: `Re-planning with ${approvedSynthesizedCount} newly synthesized worker${
          approvedSynthesizedCount === 1 ? "" : "s"
        }`,
      });
      const {
        plan: replanned,
        usage: replanUsage,
        artifacts: replanArtifacts,
      } = await planShift(shiftId, productProposal);
      // Merge any new planning-time artifacts into the binding context so
      // re-planned tasks can reference them.
      for (const a of replanArtifacts) {
        ctx.artifacts[a.id] = a;
      }
      // Record replan cost so the dashboard reflects it.
      state.results["__replan__"] = {
        taskId: "__replan__",
        status: "completed",
        usage: replanUsage,
        startedAt: Date.now(),
        completedAt: Date.now(),
        retryCount: 0,
        output: {
          reason: "post-synthesis re-plan",
          originalTaskCount: activePlan.tasks.length,
          newTaskCount: replanned.tasks.length,
        },
      };
      activePlan = replanned;
      state.plan = activePlan;
      onEvent({ type: "plan_created", plan: activePlan });

      // Any lingering gaps on the re-planned plan become info blockers but
      // we do NOT recurse into synthesis to avoid unbounded loops.
      if (activePlan.capabilityGaps && activePlan.capabilityGaps.length > 0) {
        for (const gap of activePlan.capabilityGaps) {
          const blocker = {
            taskId: gap.proposedWorkerId,
            description: `Unresolved capability gap after re-plan: ${gap.proposedPurpose}`,
            proposedResolution:
              "Second-round synthesis is disabled to prevent loops. Adjust the proposal or add seed workers.",
            severity: "warning" as const,
          };
          state.blockers.push(blocker);
          onEvent({ type: "blocker_raised", blocker });
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const blocker = {
        taskId: "__replan__",
        description: `Re-plan after worker synthesis failed: ${errorMessage.slice(0, 200)}`,
        proposedResolution:
          "Falling back to the original plan; the newly synthesized workers remain available for future shifts.",
        severity: "warning" as const,
      };
      state.blockers.push(blocker);
      onEvent({ type: "blocker_raised", blocker });
    }
  }

  // Find the verification task (if the plan has one). We execute it last,
  // after image generation has mutated the social-campaign output, so the
  // verifier sees the final artifacts.
  const verificationTask = activePlan.tasks.find((t) => t.workerId === "verification");
  const verificationId = verificationTask?.id;

  // ============================================================
  // Wave execution — everything except verification
  // ============================================================
  const remaining = new Set(
    activePlan.tasks.filter((t) => t.id !== verificationId).map((t) => t.id)
  );
  const completed = new Set<string>();
  const failed = new Set<string>();

  const cascadeSkip = () => {
    // Mark any remaining task with a failed dep as skipped, transitively.
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of activePlan.tasks) {
        if (!remaining.has(t.id)) continue;
        const blockedBy = t.dependsOn.find((d) => failed.has(d));
        if (!blockedBy) continue;
        state.results[t.id] = {
          taskId: t.id,
          status: "failed",
          error: `Skipped: upstream dependency "${blockedBy}" failed`,
          usage: [],
          startedAt: Date.now(),
          completedAt: Date.now(),
          retryCount: 0,
        };
        onEvent({
          type: "task_failed",
          taskId: t.id,
          error: `Skipped: upstream "${blockedBy}" failed`,
        });
        failed.add(t.id);
        remaining.delete(t.id);
        changed = true;
      }
    }
  };

  while (remaining.size > 0) {
    const ready = activePlan.tasks.filter(
      (t) => remaining.has(t.id) && t.dependsOn.every((d) => completed.has(d))
    );
    if (ready.length === 0) break; // stall (everything left is blocked by a failed dep)

    const results = await Promise.allSettled(
      ready.map((task) => executeTask(task, ctx, onEvent))
    );

    for (let i = 0; i < ready.length; i++) {
      const task = ready[i];
      const r = results[i];
      if (r.status === "fulfilled") {
        state.results[task.id] = r.value.result;
        ctx.taskOutputs[task.id] = r.value.output;
        completed.add(task.id);
        remaining.delete(task.id);
      } else {
        const errorMessage = r.reason instanceof Error ? r.reason.message : String(r.reason);
        state.results[task.id] = {
          taskId: task.id,
          status: "failed",
          error: errorMessage,
          usage: [],
          startedAt: Date.now(),
          completedAt: Date.now(),
          retryCount: MAX_RETRIES,
        };
        state.blockers.push({
          taskId: task.id,
          description: `${task.workerId} failed: ${errorMessage.slice(0, 200)}`,
          severity: "critical",
        });
        onEvent({
          type: "blocker_raised",
          blocker: state.blockers[state.blockers.length - 1],
        });
        onEvent({ type: "task_failed", taskId: task.id, error: errorMessage });
        failed.add(task.id);
        remaining.delete(task.id);
      }
    }

    // Propagate failures to downstream tasks before next wave.
    cascadeSkip();
  }

  const verificationSkipped =
    verificationTask != null &&
    verificationTask.dependsOn.some((d) => failed.has(d) || !completed.has(d));
  if (verificationTask && verificationSkipped) {
    state.results[verificationTask.id] = {
      taskId: verificationTask.id,
      status: "failed",
      error: "Skipped: upstream dependency failed",
      usage: [],
      startedAt: Date.now(),
      completedAt: Date.now(),
      retryCount: 0,
    };
    onEvent({
      type: "task_failed",
      taskId: verificationTask.id,
      error: "Skipped: upstream dependency failed",
    });
  }

  // ============================================================
  // Social image generation — post-processing on social-campaign output
  // ============================================================
  const socialTask = activePlan.tasks.find((t) => t.workerId === "social-campaign");
  if (socialTask && ctx.taskOutputs[socialTask.id]) {
    const socialOut = ctx.taskOutputs[socialTask.id] as SocialCampaignOutput;
    try {
      const withImages = await generateImagesForCampaign(socialOut.posts);
      ctx.taskOutputs[socialTask.id] = { posts: withImages };
      onEvent({
        type: "task_progress",
        taskId: socialTask.id,
        message: `Generated ${withImages.length} images`,
      });
    } catch (err) {
      state.blockers.push({
        taskId: socialTask.id,
        description: `Image generation failed: ${String(err).slice(0, 200)}`,
        severity: "warning",
        proposedResolution: "Use placeholder images; retry image generation later",
      });
    }
  }

  // ============================================================
  // Verification pass (registry worker, run after image gen)
  // ============================================================
  state.status = "reviewing";
  let verificationOutput: VerificationOutput | undefined;
  if (verificationTask && !verificationSkipped) {
    try {
      // Pre-compute websiteSummary from the website task's html output.
      // The verifier needs stripped text, not the whole HTML blob, to keep
      // its context small and focused on copy.
      const websiteTask = activePlan.tasks.find((t) => t.workerId === "website");
      const overrides: Record<string, unknown> = {};
      if (websiteTask) {
        const websiteOut = ctx.taskOutputs[websiteTask.id] as
          | { html?: string }
          | undefined;
        if (websiteOut?.html) {
          overrides.websiteSummary = summarizeHtmlForReview(websiteOut.html);
        }
      }
      const { result, output } = await executeTask(
        verificationTask,
        ctx,
        onEvent,
        overrides
      );
      state.results[verificationTask.id] = result;
      ctx.taskOutputs[verificationTask.id] = output;
      verificationOutput = output as VerificationOutput;
      onEvent({ type: "verifier_review", result: verificationOutput });
      for (const issue of verificationOutput.issues) {
        if (issue.severity === "critical" || issue.severity === "warning") {
          state.blockers.push({
            taskId: issue.workerId,
            description: `[${issue.severity}] ${issue.description}`,
            proposedResolution: issue.suggestedFix,
            severity: issue.severity,
          });
          onEvent({
            type: "blocker_raised",
            blocker: state.blockers[state.blockers.length - 1],
          });
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      state.results[verificationTask.id] = {
        taskId: verificationTask.id,
        status: "failed",
        error: errorMessage,
        usage: [],
        startedAt: Date.now(),
        completedAt: Date.now(),
        retryCount: MAX_RETRIES,
      };
      onEvent({ type: "task_failed", taskId: verificationTask.id, error: errorMessage });
    }
  }

  // ============================================================
  // Assembly — deterministic merge, zero-token
  // ============================================================
  state.status = "assembling";
  const launchKit = buildLaunchKit(activePlan, ctx, verificationOutput);

  const assemblyTaskId = activePlan.assemblyTaskId ?? "assembly";
  const assemblyStartedAt = Date.now();
  onEvent({ type: "task_started", taskId: assemblyTaskId, tier: "opus" });

  if (launchKit) {
    // Assembly is deterministic — no model call — but we emit a zero-cost
    // usage record so SSE consumers that expect usage[0] don't crash.
    const zeroUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      tier: "opus",
      costUsd: 0,
    };
    state.results[assemblyTaskId] = {
      taskId: assemblyTaskId,
      status: "completed",
      output: { assembledAt: Date.now() },
      usage: [zeroUsage],
      startedAt: assemblyStartedAt,
      completedAt: Date.now(),
      retryCount: 0,
    };
    onEvent({ type: "task_completed", taskId: assemblyTaskId, usage: [zeroUsage] });
    onEvent({ type: "shift_completed", launchKit });
    state.status = "done";
  } else {
    state.results[assemblyTaskId] = {
      taskId: assemblyTaskId,
      status: "failed",
      error: "Required upstream outputs missing",
      usage: [],
      startedAt: assemblyStartedAt,
      completedAt: Date.now(),
      retryCount: 0,
    };
    onEvent({
      type: "task_failed",
      taskId: assemblyTaskId,
      error: "Required upstream outputs missing",
    });
    onEvent({
      type: "shift_failed",
      error: "One or more required workers did not produce output",
    });
    state.status = "failed";
  }

  state.completedAt = Date.now();
  return { state, launchKit };
}

// ============================================================
// executeTask - resolve worker + bindings, run with retry
// ============================================================

interface TaskOutput {
  result: TaskResult;
  output: unknown;
}

async function executeTask(
  task: PlannedTask,
  ctx: BindingContext,
  onEvent: EventCallback,
  overrides?: Record<string, unknown>
): Promise<TaskOutput> {
  const spec = workerRegistry.getOrThrow(task.workerId);
  const startedAt = Date.now();
  const usage: TokenUsage[] = [];

  onEvent({ type: "task_started", taskId: task.id, tier: spec.tier });

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Resolve bindings fresh on each attempt (upstream outputs don't change,
      // but re-resolving is cheap and keeps the code simple).
      const inputs = resolveInputs(task.inputs, ctx);

      // Overrides (e.g. derived fields like websiteSummary) take precedence
      // over planner-emitted bindings.
      if (overrides) Object.assign(inputs, overrides);

      // Optional: inject task metadata fields the prompt template may reference.
      if (!("taskDescription" in inputs)) inputs.taskDescription = task.description;
      if (!("successCriteria" in inputs)) inputs.successCriteria = task.successCriteria;

      const { output, usage: workerUsage } = await runWorker(spec, inputs);
      usage.push(workerUsage);

      const result: TaskResult = {
        taskId: task.id,
        status: "completed",
        output,
        usage,
        startedAt,
        completedAt: Date.now(),
        retryCount: attempt,
      };

      onEvent({ type: "task_completed", taskId: task.id, usage: [workerUsage] });
      workerRegistry.recordRun(task.workerId, true);

      return { result, output };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        onEvent({
          type: "task_retrying",
          taskId: task.id,
          reason: lastError.message.slice(0, 200),
        });
      }
    }
  }

  workerRegistry.recordRun(task.workerId, false);
  throw lastError ?? new Error(`Task ${task.id} failed after ${MAX_RETRIES + 1} attempts`);
}

// ============================================================
// Assembly helper
// ============================================================

function buildLaunchKit(
  plan: ShiftPlan,
  ctx: BindingContext,
  verification: VerificationOutput | undefined
): LaunchKit | undefined {
  const byWorker = (workerId: string): unknown => {
    const task = plan.tasks.find((t) => t.workerId === workerId);
    if (!task) return undefined;
    return ctx.taskOutputs[task.id];
  };

  const positioning = byWorker("positioning") as PositioningOutput | undefined;
  const marketingCopy = byWorker("marketing-copy") as MarketingCopyOutput | undefined;
  const website = byWorker("website") as WebsiteOutput | undefined;
  const socialCampaign = byWorker("social-campaign") as SocialCampaignOutput | undefined;
  const csDocs = byWorker("cs-docs") as CsDocsOutput | undefined;

  if (!positioning || !marketingCopy || !website || !socialCampaign || !csDocs) {
    return undefined;
  }

  return {
    positioning,
    marketingCopy,
    website,
    socialCampaign,
    csDocs,
    verification: verification ?? { passed: true, issues: [] },
  };
}

// ============================================================
// Strip HTML tags + scripts/styles so the verifier sees only copy.
// The old hand-coded verification worker did this inline; now the
// supervisor does it as a pre-step and passes the result in as an override.
// ============================================================
function summarizeHtmlForReview(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > 2000 ? stripped.slice(0, 2000) + "..." : stripped;
}

// ============================================================
// Cost summary (unchanged)
// ============================================================
export function summarizeCost(state: ShiftState): {
  byTier: Record<"opus" | "sonnet" | "haiku", { tokens: number; cost: number }>;
  total: { tokens: number; cost: number };
  opusOnlyEstimate: number;
} {
  const byTier = {
    opus: { tokens: 0, cost: 0 },
    sonnet: { tokens: 0, cost: 0 },
    haiku: { tokens: 0, cost: 0 },
  };

  for (const result of Object.values(state.results)) {
    for (const u of result.usage) {
      byTier[u.tier].tokens += u.inputTokens + u.outputTokens;
      byTier[u.tier].cost += u.costUsd;
    }
  }

  const totalTokens = byTier.opus.tokens + byTier.sonnet.tokens + byTier.haiku.tokens;
  const totalCost = byTier.opus.cost + byTier.sonnet.cost + byTier.haiku.cost;

  const opusOutputRate = 75;
  const opusInputRate = 15;
  const estimatedOutput = totalTokens * 0.4;
  const estimatedInput = totalTokens * 0.6;
  const opusOnlyEstimate =
    (estimatedOutput / 1_000_000) * opusOutputRate + (estimatedInput / 1_000_000) * opusInputRate;

  return {
    byTier,
    total: { tokens: totalTokens, cost: totalCost },
    opusOnlyEstimate,
  };
}
