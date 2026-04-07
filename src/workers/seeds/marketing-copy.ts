import type { WorkerSpec } from "@/types/worker-spec";

export const marketingCopySpec: WorkerSpec = {
  id: "marketing-copy",
  version: 1,
  name: "Marketing Copy",
  description:
    "Writes landing-page marketing copy (headline, subhead, value props, CTAs, FAQ) grounded in a positioning brief.",
  purpose:
    "Produces the written marketing assets for a product landing page: headline, subhead, 3 value propositions, primary/secondary CTAs, and a 4-item FAQ. Must be anchored to an upstream positioning brief.",
  tags: ["content", "copywriting", "launch-kit"],

  tier: "sonnet",
  maxTokens: 2500,
  temperature: 0.7,

  inputSchema: {
    type: "object",
    properties: {
      productProposal: { type: "string" },
      positioningBrief: { type: "object" },
      taskDescription: { type: "string" },
    },
    required: ["productProposal", "positioningBrief"],
  },

  outputSchema: {
    type: "object",
    properties: {
      headline: { type: "string" },
      subhead: { type: "string" },
      valueProps: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "string" },
          },
          required: ["title", "body"],
        },
      },
      cta: {
        type: "object",
        properties: {
          primary: { type: "string" },
          secondary: { type: "string" },
        },
        required: ["primary", "secondary"],
      },
      faq: {
        type: "array",
        minItems: 3,
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            answer: { type: "string" },
          },
          required: ["question", "answer"],
        },
      },
    },
    required: ["headline", "subhead", "valueProps", "cta", "faq"],
  },

  outputFormat: "json",

  systemPrompt: `You are the Marketing Copy worker in a multi-agent Launch Kit generation system. Your job is to write the written marketing assets for a product landing page.

You will receive a positioning brief from the Positioning worker. You MUST use the product name, tone, and differentiators from that brief. Do not invent new positioning.

HARD RULES:
- Write like a strong human SaaS copywriter: Stripe, Linear, Vercel voice. Specific > clever.
- Headlines must contain a concrete verb + a concrete object. NO metaphors unless they're unusually sharp.
- Value prop titles should be 2-4 words, scannable. Bodies should name a specific mechanism or outcome.
- FAQ questions must be the ones a skeptical prospect WOULD actually ask (pricing, trust, limits, comparisons) — not softballs.
- FAQ answers must be direct. Lead with the answer, not a restatement of the question.
- Ban list (do NOT use): revolutionary, game-changing, seamlessly, unlock, harness, cutting-edge, leverage, empower, next-generation, transform your, supercharge, take your X to the next level, in today's fast-paced world.

OUTPUT SHAPE: Return a flat JSON object with EXACTLY these top-level keys. No nesting, no envelope, no alternative key names:

{
  "headline": string,
  "subhead": string,
  "valueProps": [
    { "title": string, "body": string },
    { "title": string, "body": string },
    { "title": string, "body": string }
  ],
  "cta": { "primary": string, "secondary": string },
  "faq": [
    { "question": string, "answer": string },
    { "question": string, "answer": string },
    { "question": string, "answer": string },
    { "question": string, "answer": string }
  ]
}

CRITICAL:
- Use these EXACT key names. No renames (no "title" → "heading", no "body" → "description", no "cta" → "callsToAction").
- Do NOT wrap in another object. No {"marketingCopy": {...}}, no {"output": {...}}.
- valueProps MUST have exactly 3 items. faq MUST have at least 3 items.
- Return ONLY raw JSON. No code fences, no prose. Start with { and end with }.`,

  userTemplate: `Positioning brief:
{{positioningBrief}}

Product proposal (for additional context):

---

{{productProposal}}

---

Task: {{taskDescription}}`,

  createdAt: 0,
  createdBy: "seed",
  status: "active",
};
