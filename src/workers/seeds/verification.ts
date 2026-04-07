import type { WorkerSpec } from "@/types/worker-spec";

export const verificationSpec: WorkerSpec = {
  id: "verification",
  version: 1,
  name: "Brand Consistency Verifier",
  description:
    "Haiku-tier verifier that reviews all upstream worker outputs for brand consistency, contradictions, and AI-slop.",
  purpose:
    "Reads the positioning brief and all downstream artifacts (marketing copy, website, social campaign, CS docs) and produces a structured pass/fail report with severity-tagged issues. Runs last in the shift as the quality gate.",
  tags: ["verification", "qa", "launch-kit"],

  tier: "haiku",
  maxTokens: 2000,
  temperature: 0.2,

  inputSchema: {
    type: "object",
    properties: {
      positioningBrief: { type: "object" },
      marketingCopy: { type: "object" },
      websiteSummary: { type: "string" },
      socialCampaign: { type: "object" },
      csDocs: { type: "object" },
      taskDescription: { type: "string" },
    },
    required: [
      "positioningBrief",
      "marketingCopy",
      "websiteSummary",
      "socialCampaign",
      "csDocs",
    ],
  },

  outputSchema: {
    type: "object",
    properties: {
      passed: { type: "boolean" },
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            severity: {
              type: "string",
              enum: ["info", "warning", "critical"],
            },
            workerId: { type: "string" },
            description: { type: "string" },
            suggestedFix: { type: "string" },
          },
          required: ["severity", "workerId", "description", "suggestedFix"],
        },
      },
    },
    required: ["passed", "issues"],
  },

  outputFormat: "json",

  systemPrompt: `You are the Verification worker in a multi-agent Launch Kit generation system. Your job is to review all worker outputs for brand consistency and quality issues.

Check for:
1. Tone mismatches across workers (e.g. positioning says "irreverent" but cs_docs is stiff and corporate)
2. Contradictions in product description, feature claims, or pricing
3. Terminology inconsistencies (e.g. "users" vs "customers" vs "members" used interchangeably)
4. Positioning drift - workers invented differentiators not in the positioning brief
5. AI-slop phrases that slipped through the worker ban lists: "revolutionary", "game-changing", "seamlessly", "unlock", "harness", "cutting-edge", "leverage", "empower", "next-generation", "transform your", "supercharge", "in today's fast-paced world", "thrilled to", "excited to", "humbled", "journey to"
6. Marketing copy and CS docs using different product names or feature names
7. Hallucinated features or claims not present in the proposal

Severity guidance:
- critical: contradiction, wrong product name, hallucinated pricing or feature, broken JSON-like artifacts
- warning: AI-slop phrase, mild tone drift, terminology inconsistency
- info: minor style improvements

Be specific. Quote the offending text in your description field. If everything looks good, return passed: true with an empty issues array — don't invent problems.

OUTPUT FORMAT: Return ONLY raw JSON. No code fences, no prose. Start with { and end with }.`,

  userTemplate: `Positioning brief:
{{positioningBrief}}

---

Marketing copy:
{{marketingCopy}}

---

Website copy summary:
{{websiteSummary}}

---

Social campaign:
{{socialCampaign}}

---

CS docs:
{{csDocs}}

Task: {{taskDescription}}

Review all of the above for brand consistency. Return your verdict as JSON.`,

  createdAt: 0,
  createdBy: "seed",
  status: "active",
};
