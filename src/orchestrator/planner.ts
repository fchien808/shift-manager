/**
 * Planner - uses Opus to decompose a shift goal into a worker-id-based DAG.
 *
 * Key shift from the old planner: the planner is no longer hardcoded to a
 * fixed set of task TYPES. Instead, it is handed the full active worker
 * registry (via workerRegistry.catalogForPlanner()) and must pick worker
 * ids + wire their inputs using the InputBinding language.
 *
 * For the Launch Kit demo the plan still lands on roughly the same DAG
 * (positioning -> {marketing_copy, website, social_campaign, cs_docs} ->
 * verification -> assembly), but Opus reaches that shape by reasoning
 * over the registry catalog rather than filling in a hardcoded template.
 * This is what lets the same planner later pick different workers or
 * trigger worker synthesis.
 *
 * Assembly is still appended deterministically after Opus returns — it's
 * a pure deterministic merge, not a model call, so there's no need for
 * the planner to invent it.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { callModel, extractJson } from "./anthropic-client";
import { workerRegistry } from "@/workers/registry";
import { runWorker } from "@/workers/runtime";
import type { ShiftPlan, TokenUsage } from "@/types/shift";
import type {
  PlannedTask,
  InputBinding,
  CapabilityGap,
  PlanningArtifact,
} from "@/types/worker-spec";

/** Max number of tool-use iterations during planning. Hard cap to prevent runaway. */
const MAX_PLANNING_TOOL_ITERATIONS = 4;

function buildPlannerSystemPrompt(): string {
  const catalog = workerRegistry.catalogForPlanner();
  const catalogJson = JSON.stringify(catalog, null, 2);

  return `You are the Supervisor agent in Shift Manager, a multi-agent system for async knowledge work delegation. Your job right now is to PLAN a shift.

The user has provided a product proposal. You need to produce a structured work plan that generates a complete "Launch Kit" for that product. A Launch Kit consists of: a positioning brief, marketing copy, a single-file HTML landing page, a 3-platform social campaign, customer service docs, and a verification pass.

You have a REGISTRY of available workers. Each worker has an \`id\`, a \`description\`, a \`purpose\`, an \`inputSchema\` (JSON Schema), and a \`tier\`. You MUST pick workers from this registry and wire their inputs using the binding language below.

WORKER REGISTRY:
\`\`\`json
${catalogJson}
\`\`\`

INPUT BINDING LANGUAGE
Every task you emit declares an \`inputs\` object keyed by the field names in that worker's \`inputSchema\`. Each value is a binding of one of these shapes:

  { "kind": "literal", "value": <any JSON value> }
  { "kind": "proposal" }                             // the full product proposal string
  { "kind": "task", "taskId": "<upstream task id>" } // full output of an upstream task
  { "kind": "task_field", "taskId": "<id>", "path": "a.b.c" }  // dot-path into upstream output
  { "kind": "artifact", "artifactId": "<id>" }       // planning-time artifact (rarely used)

Rules:
- Every \`inputs\` entry must cover a required field in that worker's inputSchema.
- Use \`proposal\` for raw-proposal inputs. Use \`task\` / \`task_field\` to pass upstream outputs. Use \`literal\` only for task-specific guidance strings, success hints, or small config values.
- Do NOT invent workerIds. Only use ids that appear in the registry above.
- Upstream tasks referenced in bindings MUST appear earlier in the task list and MUST be listed in \`dependsOn\`.

TIER ASSIGNMENT
Use the worker's declared tier. Do NOT override it. (Each worker was authored for a specific tier.)

DEPENDENCY RULES
- The positioning worker runs first and alone.
- Marketing copy, website, social campaign, and cs docs run IN PARALLEL after positioning.
- The website worker should take the marketing copy as input (so value props / CTAs stay in sync).
- Verification runs after all downstream workers complete.
- Do NOT emit an \`assembly\` task — the system appends it deterministically.

PLANNING-TIME WORKER CALLS (OPTIONAL)
You have access to a \`run_worker\` tool that lets you invoke any active worker in the registry immediately, during planning, to produce an ARTIFACT that the plan can reference later. Use this sparingly — only when having concrete upstream data would meaningfully improve the plan (e.g. running a lightweight research worker to scout context before writing detailed task descriptions). Do NOT use it to execute the main Launch Kit pipeline — that runs during execution, not planning.

When you call \`run_worker\`, the tool returns an \`artifactId\`. You can reference that artifact from a task's inputs using:
  { "kind": "artifact", "artifactId": "<id from the tool result>" }

Hard limits: at most ${MAX_PLANNING_TOOL_ITERATIONS} tool calls total. When you're done exploring, return the final plan JSON in a text message (no tool call).

CAPABILITY GAPS
If the proposal genuinely needs a step for which NO worker in the registry above fits, do NOT invent a workerId and do NOT shoehorn an unrelated worker. Instead, add an entry to the top-level \`capabilityGaps\` array describing the missing worker. Only do this when you're confident no existing worker covers the need — prefer existing workers whenever they plausibly fit. For the standard Launch Kit flow, the six seed workers are sufficient and \`capabilityGaps\` should be \`[]\`.

Each capability gap has this shape:
{
  "proposedWorkerId": "<kebab-case id for the new worker>",
  "proposedPurpose": "<what this missing worker should do, 1-2 sentences>",
  "proposedTags": ["<tag>", "<tag>"],
  "proposedTier": "opus" | "sonnet" | "haiku",
  "inputsDescription": "<short description of the inputs it would need>",
  "outputDescription": "<short description of the structured output it should produce>",
  "reasonNoExistingFit": "<why none of the registry workers cover this>",
  "placedAfter": "<task id in your plan this would logically follow, or omit>"
}

OUTPUT FORMAT: Return ONLY a JSON object with this exact shape, no prose, no code fences:

{
  "goal": "<one-sentence restatement of the shift goal>",
  "tasks": [
    {
      "id": "<short kebab-case task id, unique in this plan>",
      "workerId": "<id from the registry above>",
      "label": "<short UI lane label>",
      "description": "<1-2 sentences tailored to the specific product>",
      "dependsOn": ["<task id>", ...],
      "inputs": {
        "<inputField>": { "kind": "...", ... }
      },
      "successCriteria": ["<criterion 1>", "<criterion 2>", "<criterion 3>"]
    }
  ],
  "capabilityGaps": [],
  "estimatedTokenBudget": { "opus": <n>, "sonnet": <n>, "haiku": <n> }
}

STRICT FORMATTING
- All strings are valid JSON (escape quotes/backslashes). No line breaks inside strings.
- Exactly 3 success criteria per task.
- Descriptions must reference the actual product from the proposal (name, features, users) — not generic language.`;
}

interface RawPlannedTask {
  id: string;
  workerId: string;
  label: string;
  description: string;
  dependsOn: string[];
  inputs: Record<string, InputBinding>;
  successCriteria: string[];
}

interface PlannerOutput {
  goal: string;
  tasks: RawPlannedTask[];
  capabilityGaps?: CapabilityGap[];
  estimatedTokenBudget: { opus: number; sonnet: number; haiku: number };
}

function buildRunWorkerTool(): Anthropic.Tool {
  return {
    name: "run_worker",
    description:
      "Invoke an active worker from the registry immediately, during planning, to produce an artifact the plan can reference via {kind: 'artifact', artifactId}. Use sparingly — only when concrete upstream data would meaningfully improve the plan. Returns an artifactId plus a trimmed preview of the output.",
    input_schema: {
      type: "object",
      properties: {
        workerId: {
          type: "string",
          description: "id of an ACTIVE worker in the registry catalog",
        },
        reason: {
          type: "string",
          description: "1 sentence explaining why this planning-time call is needed",
        },
        inputs: {
          type: "object",
          description:
            "Concrete input object for the worker, matching its inputSchema. Literal values only — no bindings. The proposal text is automatically available as {{productProposal}} if the worker expects it.",
        },
      },
      required: ["workerId", "reason", "inputs"],
    },
  };
}

function truncateForTool(value: unknown, maxChars = 2000): unknown {
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (str.length <= maxChars) return value;
  return str.slice(0, maxChars) + `\n...[truncated ${str.length - maxChars} chars]`;
}

export async function planShift(
  shiftId: string,
  productProposal: string
): Promise<{
  plan: ShiftPlan;
  usage: TokenUsage[];
  artifacts: PlanningArtifact[];
}> {
  const systemPrompt = buildPlannerSystemPrompt();
  const tools = [buildRunWorkerTool()];

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Here is the product proposal. Produce the shift plan as specified.\n\n---\n\n${productProposal}`,
    },
  ];

  const usages: TokenUsage[] = [];
  const artifacts: PlanningArtifact[] = [];
  let finalText = "";

  for (let iter = 0; iter <= MAX_PLANNING_TOOL_ITERATIONS; iter++) {
    const isLastIter = iter === MAX_PLANNING_TOOL_ITERATIONS;
    const result = await callModel({
      tier: "opus",
      system: systemPrompt,
      messages,
      maxTokens: 8000,
      temperature: 0.3,
      // On the very last allowed turn, drop tools so the model is forced
      // to return the final plan as text.
      ...(isLastIter ? {} : { tools }),
    });
    usages.push(result.usage);

    const content = result.raw.content;
    const toolUses = content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUses.length === 0 || result.raw.stop_reason !== "tool_use") {
      finalText = result.text;
      break;
    }

    // Append assistant turn (content blocks) as-is
    messages.push({ role: "assistant", content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      if (tu.name !== "run_worker") {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `Error: unknown tool "${tu.name}"`,
          is_error: true,
        });
        continue;
      }
      const input = tu.input as {
        workerId?: string;
        reason?: string;
        inputs?: Record<string, unknown>;
      };
      const workerId = input?.workerId;
      if (!workerId) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: "Error: missing workerId",
          is_error: true,
        });
        continue;
      }
      const spec = workerRegistry.get(workerId);
      if (!spec || spec.status !== "active") {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `Error: workerId "${workerId}" is not an active registry worker`,
          is_error: true,
        });
        continue;
      }
      try {
        const workerInputs: Record<string, unknown> = {
          productProposal,
          taskDescription: input.reason ?? "planning-time worker call",
          successCriteria: ["planning-time artifact"],
          ...(input.inputs ?? {}),
        };
        const { output, usage } = await runWorker(spec, workerInputs);
        usages.push(usage);
        const artifactId = `artifact-${artifacts.length + 1}`;
        artifacts.push({
          id: artifactId,
          workerId,
          output,
          surfaceInReport: false,
          createdAt: Date.now(),
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify({
            artifactId,
            workerId,
            outputPreview: truncateForTool(output),
          }),
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `Error running worker: ${
            err instanceof Error ? err.message : String(err)
          }`,
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  if (!finalText) {
    throw new Error(
      "Planner did not produce a final plan within the tool-use iteration budget"
    );
  }

  const parsed = extractJson<PlannerOutput>(finalText);

  const tasks: PlannedTask[] = parsed.tasks.map((t) => {
    const spec = workerRegistry.get(t.workerId);
    if (!spec) {
      throw new Error(
        `Planner emitted unknown workerId "${t.workerId}" for task ${t.id}. Available: ${workerRegistry
          .listActive()
          .map((s) => s.id)
          .join(", ")}`
      );
    }
    return {
      id: t.id,
      workerId: t.workerId,
      tier: spec.tier,
      label: t.label,
      description: t.description,
      dependsOn: t.dependsOn ?? [],
      inputs: t.inputs ?? {},
      successCriteria: t.successCriteria ?? [],
    };
  });

  const artifactIds = new Set(artifacts.map((a) => a.id));
  repairPlanDeps(tasks);
  validatePlan(tasks, artifactIds);

  // Deterministically append the assembly task. It depends on every LLM
  // task so it always runs last. Assembly has no worker — it's a pure merge.
  const assemblyTaskId = "assembly";
  // (assembly is not a registry worker; the supervisor handles it specially)

  const capabilityGaps = sanitizeCapabilityGaps(parsed.capabilityGaps);

  const plan: ShiftPlan = {
    shiftId,
    goal: parsed.goal,
    tasks,
    assemblyTaskId,
    capabilityGaps: capabilityGaps.length > 0 ? capabilityGaps : undefined,
    estimatedTokenBudget: parsed.estimatedTokenBudget ?? { opus: 0, sonnet: 0, haiku: 0 },
    createdAt: Date.now(),
  };

  return { plan, usage: usages, artifacts };
}

function sanitizeCapabilityGaps(raw: CapabilityGap[] | undefined): CapabilityGap[] {
  if (!Array.isArray(raw)) return [];
  const validTiers = new Set(["opus", "sonnet", "haiku"]);
  return raw
    .filter(
      (g) =>
        g &&
        typeof g.proposedWorkerId === "string" &&
        typeof g.proposedPurpose === "string" &&
        typeof g.inputsDescription === "string" &&
        typeof g.outputDescription === "string" &&
        typeof g.reasonNoExistingFit === "string" &&
        validTiers.has(g.proposedTier)
    )
    .map((g) => ({
      proposedWorkerId: g.proposedWorkerId,
      proposedPurpose: g.proposedPurpose,
      proposedTags: Array.isArray(g.proposedTags) ? g.proposedTags : [],
      proposedTier: g.proposedTier,
      inputsDescription: g.inputsDescription,
      outputDescription: g.outputDescription,
      reasonNoExistingFit: g.reasonNoExistingFit,
      placedAfter: g.placedAfter,
    }));
}

// Auto-repair: if an input binding references a task that isn't in dependsOn,
// add it. The planner LLM occasionally forgets to mirror input.taskId into deps,
// especially when adding extra tasks (GTM, market research, etc.).
function repairPlanDeps(tasks: PlannedTask[]): void {
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    for (const binding of Object.values(t.inputs)) {
      if (binding.kind === "task" || binding.kind === "task_field") {
        if (ids.has(binding.taskId) && !t.dependsOn.includes(binding.taskId)) {
          t.dependsOn.push(binding.taskId);
        }
      }
    }
  }
}

// TODO(roadmap #1): drop the launch-kit-specific assertions below (positioning
// task required, fixed downstream worker list) so plans can produce arbitrary
// deliverables. See TODO.md.
// TODO(roadmap #3): also validate that every user-requested deliverable is
// covered by some terminal task in the plan.
function validatePlan(tasks: PlannedTask[], artifactIds: Set<string> = new Set()): void {
  const ids = new Set(tasks.map((t) => t.id));

  // Must have exactly one task using the positioning worker, and it must have no deps.
  const positioning = tasks.filter((t) => t.workerId === "positioning");
  if (positioning.length === 0) {
    throw new Error("Plan missing required positioning task");
  }
  if (positioning[0].dependsOn.length !== 0) {
    throw new Error("Positioning task must have no dependencies");
  }

  // All deps must reference existing tasks.
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (!ids.has(dep)) {
        throw new Error(`Task ${t.id} depends on non-existent task ${dep}`);
      }
    }
  }

  // Every input binding that references a task must reference one in dependsOn.
  for (const t of tasks) {
    for (const [field, binding] of Object.entries(t.inputs)) {
      if (binding.kind === "task" || binding.kind === "task_field") {
        if (!t.dependsOn.includes(binding.taskId)) {
          throw new Error(
            `Task ${t.id} input "${field}" binds to task ${binding.taskId} but does not list it in dependsOn`
          );
        }
      }
      if (binding.kind === "artifact") {
        if (!artifactIds.has(binding.artifactId)) {
          throw new Error(
            `Task ${t.id} input "${field}" binds to unknown planning artifact ${binding.artifactId}`
          );
        }
      }
    }
  }

  // Parallel downstream workers must depend on a positioning task.
  const positioningIds = new Set(positioning.map((p) => p.id));
  const downstream = ["marketing-copy", "website", "social-campaign", "cs-docs"];
  for (const t of tasks) {
    if (downstream.includes(t.workerId)) {
      const hasPos = t.dependsOn.some((d) => positioningIds.has(d));
      if (!hasPos) {
        throw new Error(`Task ${t.id} (${t.workerId}) must depend on a positioning task`);
      }
    }
  }
}
