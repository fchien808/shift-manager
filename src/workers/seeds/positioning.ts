import type { WorkerSpec } from "@/types/worker-spec";

export const positioningSpec: WorkerSpec = {
  id: "positioning",
  version: 1,
  name: "Positioning Brief",
  description:
    "Reads a product proposal and produces an opinionated positioning brief that anchors all downstream brand work.",
  purpose:
    "Produces a structured positioning brief (product name, one-liner, target user, value prop, differentiators, tone, accent color) from a product proposal. This is the upstream anchor for marketing copy, website, social campaign, and CS docs.",
  tags: ["positioning", "brand", "launch-kit"],

  tier: "sonnet",
  maxTokens: 1500,
  temperature: 0.4,

  inputSchema: {
    type: "object",
    properties: {
      productProposal: { type: "string" },
      taskDescription: { type: "string" },
      successCriteria: { type: "array", items: { type: "string" } },
    },
    required: ["productProposal"],
  },

  outputSchema: {
    type: "object",
    properties: {
      productName: { type: "string" },
      oneLiner: { type: "string" },
      targetUser: { type: "string" },
      valueProp: { type: "string" },
      differentiators: { type: "array", items: { type: "string" }, minItems: 2 },
      tone: { type: "string" },
      accentColor: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
    },
    required: [
      "productName",
      "oneLiner",
      "targetUser",
      "valueProp",
      "differentiators",
      "tone",
      "accentColor",
    ],
  },

  outputFormat: "json",

  systemPrompt: `You are the Positioning worker in a multi-agent Launch Kit generation system. Your job is to read a product proposal and produce a tight positioning brief that will anchor all downstream workers (marketing copy, website, social campaign, customer service docs).

Everything you produce becomes the shared brand reference for the rest of the shift, so be specific and opinionated. Vague positioning produces vague downstream work.

HARD RULES:
- Pull the product name and core claims FROM the proposal. Do not invent a new name.
- Differentiators must be mechanical and specific (e.g. "Runs tasks in parallel across a DAG of Sonnet workers"), not abstract ("powerful AI", "best-in-class").
- Target user must be a specific job title or role with the concrete situation they're in, not a persona archetype.
- Ban list (do NOT use anywhere): revolutionary, game-changing, seamlessly, unlock, harness, cutting-edge, leverage, empower, next-generation, transform your.
- Tone should be 3-5 adjectives that a human could actually calibrate against, e.g. "confident, technical, slightly irreverent, concrete, no-bullshit".

OUTPUT SHAPE: Return a flat JSON object with EXACTLY these top-level keys and types — no nesting, no wrapping envelope, no "positioningBrief" key:

{
  "productName": string,
  "oneLiner": string,
  "targetUser": string,
  "valueProp": string,
  "differentiators": [string, string, string, string?],
  "tone": string,
  "accentColor": string  // hex, e.g. "#1E40AF"
}

CRITICAL:
- Do NOT wrap this object in another object (no {"brief": {...}}, no {"output": {...}}).
- \`differentiators\` MUST be an array of plain strings. NOT objects. NOT {name, description} pairs. Just strings.
- Return ONLY raw JSON. No prose, no code fences. First character must be { and last must be }.`,

  userTemplate: `Product proposal:

---

{{productProposal}}

---

Task-specific guidance: {{taskDescription}}

Success criteria you must satisfy:
{{successCriteria}}`,

  createdAt: 0,
  createdBy: "seed",
  status: "active",
};
