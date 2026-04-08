// TODO(roadmap #3): synthesizer should fire whenever a user-requested
// deliverable has no matching worker — not only when the planner explicitly
// flags a CapabilityGap. Tie this into the upcoming intent-capture step
// (src/orchestrator/intent.ts). See TODO.md.
/**
 * Worker synthesizer (Phase C).
 *
 * Takes a CapabilityGap emitted by the planner and asks Opus to design a
 * full WorkerSpec (systemPrompt, userTemplate, inputSchema, outputSchema).
 * The synthesized spec is persisted to disk as a DRAFT worker — drafts are
 * excluded from `catalogForPlanner()` so the planner can't pick them until
 * they are approved.
 *
 * Phase C scope:
 *   - synthesize from gap, persist draft, return the new spec + usage
 *   - the "approval flow" in demo mode is a simple auto-approve toggle
 *     handled in the supervisor
 *
 * Deferred:
 *   - executing a smoke test against the new spec (Phase C+)
 *   - re-planning after a draft is approved mid-shift
 */

import { callModel, extractJson } from "./anthropic-client";
import { workerRegistry } from "@/workers/registry";
import type {
  CapabilityGap,
  JsonSchema,
  WorkerSpec,
} from "@/types/worker-spec";
import type { TokenUsage } from "@/types/shift";

interface RawSynthesizedSpec {
  id?: string;
  name: string;
  description: string;
  purpose: string;
  tags?: string[];
  maxTokens?: number;
  temperature?: number;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  outputFormat?: "json" | "html";
  systemPrompt: string;
  userTemplate: string;
}

function buildSynthesizerSystemPrompt(): string {
  return `You are the Worker Synthesizer in Shift Manager. Your job: design a brand-new WorkerSpec from a capability gap description so a generic runtime can execute it.

A WorkerSpec is a declarative worker definition: a system prompt, a user-message template with {{placeholders}}, a JSON Schema for inputs, and a JSON Schema for structured output. A generic runtime renders the template with resolved inputs, calls the model, validates the output against outputSchema, and hands the result to downstream workers.

HARD REQUIREMENTS
- inputSchema MUST be a valid JSON Schema object with "type": "object", a "properties" map, and a "required" array. Keep inputs minimal and sharp — prefer 2-4 fields.
- outputSchema MUST be a valid JSON Schema object with "type": "object", a "properties" map, and a "required" array. Every required field must be described in properties.
- KEEP "required" MINIMAL on outputSchema. Only mark a field as required if the downstream pipeline absolutely cannot proceed without it. Prefer 1-2 required fields max — list every other field as optional in "properties" but NOT in "required". Models occasionally drop fields under load, and over-strict required arrays cause cascading task failures. It is much better to have a worker return a partial-but-validated output than to fail the whole shift.
- userTemplate MUST reference every required input field as {{fieldName}}. Object/array values are stringified automatically.
- systemPrompt MUST include an explicit "OUTPUT SHAPE" JSON template block showing the exact keys the worker should return, and a "do NOT wrap in an envelope" instruction. Return ONLY raw JSON — first char "{", last char "}".
- Ban these marketing words in all prompts: revolutionary, seamlessly, unlock, harness, cutting-edge, leverage, empower.
- Do NOT reference other workers, tools, or registries in the prompt. The worker only sees the rendered user message.

OUTPUT FORMAT: Return ONLY a JSON object with this exact shape, no prose, no code fences:

{
  "id": "<kebab-case id matching proposedWorkerId>",
  "name": "<short human-readable name>",
  "description": "<one-liner the planner reads for capability matching>",
  "purpose": "<2-3 sentence explanation of what the worker does and its inputs/outputs>",
  "tags": ["<tag>", "<tag>"],
  "maxTokens": <integer 500-4000>,
  "temperature": <number 0.0-1.0>,
  "inputSchema": { "type": "object", "properties": {...}, "required": [...] },
  "outputSchema": { "type": "object", "properties": {...}, "required": [...] },
  "outputFormat": "json",
  "systemPrompt": "<full system prompt for the worker>",
  "userTemplate": "<user-message template with {{placeholders}}>"
}

STRICT FORMATTING
- Every string is valid JSON (escape quotes, backslashes, newlines as \\n).
- No code fences. No prose outside the JSON object.`;
}

function buildSynthesizerUserPrompt(
  gap: CapabilityGap,
  productProposal: string
): string {
  const proposalSnippet =
    productProposal.length > 2000
      ? productProposal.slice(0, 2000) + "\n\n[...truncated]"
      : productProposal;

  return `Design a new WorkerSpec for the following capability gap:

proposedWorkerId: ${gap.proposedWorkerId}
proposedPurpose: ${gap.proposedPurpose}
proposedTags: ${JSON.stringify(gap.proposedTags)}
proposedTier: ${gap.proposedTier}
inputsDescription: ${gap.inputsDescription}
outputDescription: ${gap.outputDescription}
reasonNoExistingFit: ${gap.reasonNoExistingFit}

The gap arose while planning a shift for this product proposal (for context only — the new worker must be generally reusable, not hardcoded to this product):

---
${proposalSnippet}
---

Return the WorkerSpec JSON now.`;
}

// Cap top-level `required` at 2 fields and recursively relax any nested
// object schemas the same way. Keeps the worker tolerant of model variance
// without losing structural typing on the fields it does emit.
function relaxOutputRequired(schema: unknown, maxRequired = 2): void {
  if (!schema || typeof schema !== "object") return;
  const s = schema as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    items?: unknown;
  };
  if (s.type === "object" && Array.isArray(s.required) && s.required.length > maxRequired) {
    const dropped = s.required.slice(maxRequired);
    s.required = s.required.slice(0, maxRequired);
    console.warn(
      `[synthesizer] relaxed output schema required[]: kept ${JSON.stringify(s.required)}, made optional ${JSON.stringify(dropped)}`
    );
  }
  if (s.properties) {
    for (const child of Object.values(s.properties)) {
      relaxOutputRequired(child, maxRequired);
    }
  }
  if (s.items) {
    relaxOutputRequired(s.items, maxRequired);
  }
}

function validateSynthesized(raw: RawSynthesizedSpec, gap: CapabilityGap): void {
  if (!raw || typeof raw !== "object") {
    throw new Error("Synthesizer returned non-object");
  }
  if (typeof raw.systemPrompt !== "string" || raw.systemPrompt.length < 50) {
    throw new Error("Synthesized spec missing systemPrompt");
  }
  if (typeof raw.userTemplate !== "string" || raw.userTemplate.length < 5) {
    throw new Error("Synthesized spec missing userTemplate");
  }
  const input = raw.inputSchema as Record<string, unknown> | undefined;
  const output = raw.outputSchema as Record<string, unknown> | undefined;
  if (!input || input.type !== "object" || !Array.isArray(input.required)) {
    throw new Error("Synthesized inputSchema must be an object schema with required[]");
  }
  if (!output || output.type !== "object" || !Array.isArray(output.required)) {
    throw new Error("Synthesized outputSchema must be an object schema with required[]");
  }
  // Every required input must appear as {{placeholder}} in the template.
  for (const field of input.required as string[]) {
    if (!raw.userTemplate.includes(`{{${field}}}`)) {
      throw new Error(
        `Synthesized userTemplate missing required placeholder {{${field}}}`
      );
    }
  }
  if (raw.id && raw.id !== gap.proposedWorkerId) {
    // Not fatal — we'll override with the gap's id for stability.
  }
}

export async function synthesizeWorker(
  gap: CapabilityGap,
  productProposal: string,
  shiftId: string
): Promise<{ spec: WorkerSpec; usage: TokenUsage }> {
  const result = await callModel({
    tier: "opus",
    system: buildSynthesizerSystemPrompt(),
    messages: [
      {
        role: "user",
        content: buildSynthesizerUserPrompt(gap, productProposal),
      },
    ],
    maxTokens: 4000,
    temperature: 0.3,
  });

  const raw = extractJson<RawSynthesizedSpec>(result.text);
  validateSynthesized(raw, gap);
  // Hard safety net: cap output schema `required` at 2 fields. The synthesizer
  // is told to keep this minimal in its system prompt, but it occasionally
  // ignores that and lists 6-10 required fields. When the worker model drops
  // even one of them, the whole task (and every downstream task) fails. This
  // post-processor enforces the limit deterministically.
  relaxOutputRequired(raw.outputSchema);

  // If an id collision exists in the registry, bump with a suffix so we
  // never overwrite an existing spec.
  let id = gap.proposedWorkerId;
  if (workerRegistry.get(id)) {
    id = `${gap.proposedWorkerId}-${Date.now().toString(36).slice(-4)}`;
  }

  const spec: WorkerSpec = {
    id,
    version: 1,
    name: raw.name,
    description: raw.description,
    purpose: raw.purpose,
    tags: raw.tags ?? gap.proposedTags ?? [],
    tier: gap.proposedTier,
    maxTokens: clampInt(raw.maxTokens ?? 2000, 500, 4000),
    temperature: clampNum(raw.temperature ?? 0.3, 0, 1),
    inputSchema: raw.inputSchema,
    outputSchema: raw.outputSchema,
    outputFormat: raw.outputFormat === "html" ? "html" : "json",
    systemPrompt: raw.systemPrompt,
    userTemplate: raw.userTemplate,
    createdAt: Date.now(),
    createdBy: "synthesis",
    status: "draft", // drafts are excluded from the planner catalog until approved
    provenance: {
      shiftId,
      sourceRequest: gap.proposedPurpose,
      designedBy: "opus",
    },
    metrics: { uses: 0, successes: 0 },
  };

  workerRegistry.saveSpec(spec);

  return { spec, usage: result.usage };
}

function clampInt(n: number, lo: number, hi: number): number {
  const i = Math.round(Number(n));
  if (!Number.isFinite(i)) return lo;
  return Math.max(lo, Math.min(hi, i));
}

function clampNum(n: number, lo: number, hi: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}
