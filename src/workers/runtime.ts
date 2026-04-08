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
// Input coercion — bridge schema mismatches between workers
// ============================================================

/**
 * Render an arbitrary JSON value into a compact, readable markdown-ish string
 * suitable for dropping into a user message template. Keeps keys visible so
 * downstream workers retain the semantic structure of the upstream output.
 */
function renderValueAsMarkdown(value: unknown, depth = 0): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const rendered = renderValueAsMarkdown(item, depth + 1);
        return rendered.includes("\n") ? `- ${rendered.replace(/\n/g, "\n  ")}` : `- ${rendered}`;
      })
      .join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries
      .map(([k, v]) => {
        const rendered = renderValueAsMarkdown(v, depth + 1);
        if (rendered.includes("\n")) {
          return `**${k}:**\n${rendered
            .split("\n")
            .map((l) => `  ${l}`)
            .join("\n")}`;
        }
        return `**${k}:** ${rendered}`;
      })
      .join("\n");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Walk an input object and coerce each field to the type declared in the
 * worker's input schema. Currently handles the dominant failure mode: a
 * downstream worker expects a string but received a structured object from
 * its upstream binding. In that case we render the object as markdown.
 *
 * Non-string target types pass through untouched — if we ever need the
 * inverse (e.g. expected object, got string), add it here.
 */
function coerceInputsToSchema(
  inputs: Record<string, unknown>,
  inputSchema: unknown
): Record<string, unknown> {
  const schema = inputSchema as {
    properties?: Record<string, { type?: string | string[] }>;
  } | null;
  const props = schema?.properties;
  if (!props) return inputs;

  const out: Record<string, unknown> = { ...inputs };
  for (const [key, propSchema] of Object.entries(props)) {
    const value = out[key];
    if (value == null) continue;
    const type = propSchema?.type;
    const expectedTypes = Array.isArray(type) ? type : type ? [type] : [];
    const wantsString = expectedTypes.includes("string");
    const isString = typeof value === "string";
    if (wantsString && !isString) {
      out[key] = renderValueAsMarkdown(value);
    }
  }
  return out;
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
  // Coerce inputs to match the input schema before validation. This handles
  // the common case where a synthesized worker declares an input as `string`
  // but the upstream worker it's bound to emits a structured object. Rather
  // than making the synthesizer clairvoyant about upstream output shapes, we
  // stringify object/array values into readable markdown when the target is
  // a string field. Safe and centralized — no other failure mode in play.
  resolvedInputs = coerceInputsToSchema(resolvedInputs, spec.inputSchema);

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
