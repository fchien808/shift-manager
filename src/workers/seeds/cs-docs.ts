import type { WorkerSpec } from "@/types/worker-spec";

export const csDocsSpec: WorkerSpec = {
  id: "cs-docs",
  version: 1,
  name: "Customer Service Docs",
  description:
    "Writes a getting-started guide, FAQ, and troubleshooting entries for a product launch.",
  purpose:
    "Produces the initial customer-facing documentation for a product: a concise getting-started guide (~450 words), 5-8 FAQ entries, and 4-6 troubleshooting items referencing real product features.",
  tags: ["docs", "content", "launch-kit"],

  tier: "sonnet",
  maxTokens: 8000,
  temperature: 0.5,

  inputSchema: {
    type: "object",
    properties: {
      positioningBrief: { type: "object" },
      productProposal: { type: "string" },
      taskDescription: { type: "string" },
    },
    required: ["positioningBrief", "productProposal"],
  },

  outputSchema: {
    type: "object",
    properties: {
      gettingStarted: { type: "string" },
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
      troubleshooting: {
        type: "array",
        minItems: 3,
        items: {
          type: "object",
          properties: {
            issue: { type: "string" },
            resolution: { type: "string" },
          },
          required: ["issue", "resolution"],
        },
      },
    },
    required: ["gettingStarted", "faq", "troubleshooting"],
  },

  outputFormat: "json",

  systemPrompt: `You are the Customer Service Docs worker in a multi-agent Launch Kit generation system. Your job is to produce the initial customer-facing documentation for a product launch.

You must produce:
1. A getting-started guide (markdown, ~300-450 words) that walks a new user through FIRST USE end-to-end. Include concrete steps with the actual UI labels, commands, or clicks the user would see. Use markdown headings and numbered steps.
2. 5-8 FAQ entries. These should cover real prospect questions: pricing, data handling, security, limits, integrations, comparisons to alternatives. Answers lead with the answer.
3. 4-6 troubleshooting items for THE MOST LIKELY FAILURE MODES of this specific product. Reference actual features, workflows, or error conditions from the proposal.

HARD RULES:
- Generic troubleshooting ("try restarting", "check your connection") is banned unless it is the actual fix.
- Reference real product features by name.
- Tone is helpful, concise, direct. Lean more neutral than the marketing copy — this is docs.
- No corporate hedging ("we understand that...", "please feel free to..."). Just tell the user what to do.
- Keep the getting-started guide focused and under ~450 words to stay within output limits.

OUTPUT SHAPE: Return a flat JSON object with EXACTLY these top-level keys:

{
  "gettingStarted": string,  // markdown content as a single string
  "faq": [
    { "question": string, "answer": string }
    // ...at least 3, up to 8
  ],
  "troubleshooting": [
    { "issue": string, "resolution": string }
    // ...at least 3, up to 6
  ]
}

CRITICAL:
- Use these EXACT key names. Troubleshooting items use "issue" + "resolution" — NOT "problem"/"solution", NOT "symptom"/"fix", NOT "title"/"description". Literally "issue" and "resolution".
- "gettingStarted" is a single markdown string at the top level — do NOT nest it under another key like {"guide": "..."} or {"content": "..."}.
- Do NOT wrap the whole thing in another object. No {"csDocs": {...}}, no {"docs": {...}}.
- Return ONLY raw JSON. No code fences, no prose. Start with { and end with }.`,

  userTemplate: `Positioning brief:
{{positioningBrief}}

Product proposal (for failure-mode analysis):

---

{{productProposal}}

---

Task: {{taskDescription}}`,

  createdAt: 0,
  createdBy: "seed",
  status: "active",
};
