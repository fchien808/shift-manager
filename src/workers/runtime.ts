/**
 * Generic worker runtime.
 *
 * Given a WorkerSpec + a resolved input object, this:
 *   1. Validates the input object against the spec's inputSchema (ajv)
 *   2. Renders the userTemplate with {{placeholder}} substitution
 *   3. Calls the model tier declared in the spec
 *   4. Parses the output as JSON or HTML based on outputFormat
 *   5. Validates the output against outputSchema (ajv) for JSON specs
 *   6. Returns { output, usage }
 *
 * There is no worker-specific code in this file. Everything that used to
 * live as a hand-written function in workers.ts is now derived from the
 * spec. Adding a new worker = adding a new WorkerSpec to the registry.
 */

import Ajv, { type ValidateFunction } from "ajv";
import { callModel, extractJson } from "@/orchestrator/anthropic-client";
import type { TokenUsage } from "@/types/shift";
import type { WorkerSpec, InputBinding, PlannedTask, PlanningArtifact } from "@/types/worker-spec";

const ajv = new Ajv({ allErrors: true, strict: false });
const validatorCache = new Map<string, ValidateFunction>();

function getValidator(cacheKey: string, schema: object): ValidateFunction {
  let v = validatorCache.get(cacheKey);
  if (!v) {
    v = ajv.compile(schema);
    validatorCache.set(cacheKey, v);
  }
  return v;
}

// ============================================================
// Template rendering
// ============================================================

export function renderTemplate(template: string, inputs: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const val = resolveDotPath(inputs, key);
    if (val === undefined || val === null) return "";
    if (typeof val === "string") return val;
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      return String(val);
    }
  });
}

function resolveDotPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === undefined || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

// ============================================================
// Binding resolution
// ============================================================

export interface BindingContext {
  proposal: string;
  /** taskId -> worker output object (structured; whatever the upstream worker returned) */
  taskOutputs: Record<string, unknown>;
  /** artifactId -> planning artifact */
  artifacts: Record<string, PlanningArtifact>;
}

export function resolveBinding(binding: InputBinding, ctx: BindingContext): unknown {
  switch (binding.kind) {
    case "literal":
      return binding.value;
    case "proposal":
      return ctx.proposal;
    case "task": {
      const out = ctx.taskOutputs[binding.taskId];
      if (out === undefined) {
        throw new Error(`Binding refers to missing upstream task: ${binding.taskId}`);
      }
      return out;
    }
    case "task_field": {
      const out = ctx.taskOutputs[binding.taskId];
      if (out === undefined) {
        throw new Error(`Binding refers to missing upstream task: ${binding.taskId}`);
      }
      return resolveDotPath(out, binding.path);
    }
    case "artifact": {
      const art = ctx.artifacts[binding.artifactId];
      if (!art) throw new Error(`Binding refers to missing artifact: ${binding.artifactId}`);
      return art.output;
    }
    default: {
      const _exhaustive: never = binding;
      throw new Error(`Unknown binding kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export function resolveInputs(
  bindings: Record<string, InputBinding>,
  ctx: BindingContext
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const [key, binding] of Object.entries(bindings)) {
    inputs[key] = resolveBinding(binding, ctx);
  }
  return inputs;
}

// ============================================================
// HTML extraction (for outputFormat: "html")
// ============================================================

function extractHtml(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "");
  const start = t.search(/<!DOCTYPE\s+html/i);
  if (start === -1) {
    throw new Error(
      `Worker did not return an HTML document. First 300 chars: ${t.slice(0, 300)}`
    );
  }
  const endIdx = t.lastIndexOf("</html>");
  if (endIdx !== -1) return t.slice(start, endIdx + "</html>".length);
  console.warn("[runtime] HTML output was truncated, auto-closing tags");
  let html = t.slice(start);
  if (!/<\/body>/i.test(html)) html += "\n</body>";
  if (!/<\/html>/i.test(html)) html += "\n</html>";
  return html;
}

// ============================================================
// runWorker - the one entry point the supervisor calls
// ============================================================

export interface RunWorkerResult {
  output: unknown;
  usage: TokenUsage;
}

export async function runWorker(
  spec: WorkerSpec,
  resolvedInputs: Record<string, unknown>
): Promise<RunWorkerResult> {
  // Validate inputs
  const inputValidator = getValidator(`${spec.id}@${spec.version}:in`, spec.inputSchema);
  if (!inputValidator(resolvedInputs)) {
    throw new Error(
      `Worker ${spec.id} input failed validation: ${ajv.errorsText(inputValidator.errors)}`
    );
  }

  const userMessage = renderTemplate(spec.userTemplate, resolvedInputs);

  const result = await callModel({
    tier: spec.tier,
    system: spec.systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    maxTokens: spec.maxTokens,
    temperature: spec.temperature,
  });

  let output: unknown;
  if (spec.outputFormat === "html") {
    output = { html: extractHtml(result.text) };
  } else {
    output = extractJson(result.text);
  }

  const outputValidator = getValidator(`${spec.id}@${spec.version}:out`, spec.outputSchema);

  // If the model wrapped the payload in a single-key envelope
  // (e.g. {"positioningBrief": {...}} or {"output": {...}}), try unwrapping.
  if (!outputValidator(output) && output && typeof output === "object" && !Array.isArray(output)) {
    const keys = Object.keys(output as Record<string, unknown>);
    if (keys.length === 1) {
      const inner = (output as Record<string, unknown>)[keys[0]];
      if (outputValidator(inner)) {
        console.warn(
          `[runtime] unwrapped single-key envelope "${keys[0]}" for worker ${spec.id}`
        );
        output = inner;
      }
    }
  }

  if (!outputValidator(output)) {
    throw new Error(
      `Worker ${spec.id} output failed validation: ${ajv.errorsText(outputValidator.errors)}`
    );
  }

  return { output, usage: result.usage };
}

/**
 * Convenience: resolve a PlannedTask's bindings + run the worker.
 */
export async function runPlannedTask(
  task: PlannedTask,
  spec: WorkerSpec,
  ctx: BindingContext
): Promise<RunWorkerResult> {
  const inputs = resolveInputs(task.inputs, ctx);
  return runWorker(spec, inputs);
}
