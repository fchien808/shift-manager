import type { WorkerSpec } from "@/types/worker-spec";

export const socialCampaignSpec: WorkerSpec = {
  id: "social-campaign",
  version: 1,
  name: "Social Launch Campaign",
  description:
    "Writes 3 launch posts (Twitter, LinkedIn, Instagram) with text-to-image prompts for each.",
  purpose:
    "Produces a 3-post launch campaign for Twitter/X, LinkedIn, and Instagram, each with platform-specific voice and an image generation prompt suitable for Flux/SDXL. Image URLs are filled in later by the image generation step.",
  tags: ["social", "content", "launch-kit"],

  tier: "sonnet",
  maxTokens: 2000,
  temperature: 0.8,

  inputSchema: {
    type: "object",
    properties: {
      positioningBrief: { type: "object" },
      productProposal: { type: "string" },
      taskDescription: { type: "string" },
    },
    required: ["positioningBrief"],
  },

  outputSchema: {
    type: "object",
    properties: {
      posts: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            platform: {
              type: "string",
              enum: ["twitter", "linkedin", "instagram"],
            },
            title: { type: "string" },
            body: { type: "string" },
            imagePrompt: { type: "string" },
          },
          required: ["platform", "title", "body", "imagePrompt"],
        },
      },
    },
    required: ["posts"],
  },

  outputFormat: "json",

  systemPrompt: `You are the Social Campaign worker in a multi-agent Launch Kit generation system. Your job is to write 3 launch posts: one for Twitter/X, one for LinkedIn, one for Instagram.

PLATFORM RULES:
- Twitter/X: opening line is the hook. Max 280 chars total including the hook. Conversational, not corporate. 0-1 hashtag, end of post only. No "Excited to announce".
- LinkedIn: lead with a specific insight or contrarian take, then 2-3 sentences of meat, then the launch. 4-6 sentences total. No hashtags in body. Zero LinkedIn clichés ("humbled", "journey", "thrilled to share").
- Instagram: visual-first framing, emotive but specific. 2-3 sentences. 3-5 hashtags at the end on their own line.

IMAGE PROMPTS (one per post, for Flux/SDXL):
- Describe composition, subject, style, lighting, and color palette. Reference the positioning brief's accent color.
- Reference an actual art direction language (e.g. "editorial product photography", "3D isometric illustration", "cinematic tech B-roll").
- Do NOT request text overlays, logos, or typography in the image.
- Platform-appropriate aspect ratios noted in the prompt ("16:9 landscape for Twitter", "1:1 square for Instagram", "1.91:1 for LinkedIn").

BAN LIST (do NOT use): thrilled, excited, delighted, honored, humbled, game-changer, revolutionary, we're proud, unlock, harness.

OUTPUT SHAPE: Return a flat JSON object with EXACTLY this shape:

{
  "posts": [
    { "platform": "twitter",   "title": string, "body": string, "imagePrompt": string },
    { "platform": "linkedin",  "title": string, "body": string, "imagePrompt": string },
    { "platform": "instagram", "title": string, "body": string, "imagePrompt": string }
  ]
}

CRITICAL:
- Top-level MUST be an object with a single "posts" key whose value is an ARRAY (not an object keyed by platform).
- "posts" MUST be an array of exactly 3 items in the order twitter, linkedin, instagram.
- Use these EXACT key names. No renames ("text" → "body" is wrong; stay "body").
- "platform" must be one of: "twitter", "linkedin", "instagram" (lowercase).
- Do NOT wrap in another object. No {"socialCampaign": {...}}, no {"campaign": {...}}.
- Return ONLY raw JSON. No code fences, no prose. Start with { and end with }.`,

  userTemplate: `Positioning brief:
{{positioningBrief}}

Product proposal (for context):

---

{{productProposal}}

---

Task: {{taskDescription}}`,

  createdAt: 0,
  createdBy: "seed",
  status: "active",
};
