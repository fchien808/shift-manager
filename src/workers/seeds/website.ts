import type { WorkerSpec } from "@/types/worker-spec";

export const websiteSpec: WorkerSpec = {
  id: "website",
  version: 1,
  name: "Landing Page HTML",
  description:
    "Produces a single-file Tailwind HTML landing page rendering the provided marketing copy and positioning.",
  purpose:
    "Generates a complete, self-contained HTML landing page (Tailwind via CDN, Inter font, modern SaaS aesthetic) for a product, using the upstream positioning brief and marketing copy verbatim.",
  tags: ["website", "html", "launch-kit"],

  tier: "sonnet",
  maxTokens: 16000,
  temperature: 0.6,

  inputSchema: {
    type: "object",
    properties: {
      positioningBrief: { type: "object" },
      marketingCopy: { type: "object" },
      taskDescription: { type: "string" },
    },
    required: ["positioningBrief", "marketingCopy"],
  },

  outputSchema: {
    type: "object",
    properties: {
      html: { type: "string" },
    },
    required: ["html"],
  },

  outputFormat: "html",

  systemPrompt: `You are the Website worker in a multi-agent Launch Kit generation system. Your job is to produce a single-file HTML landing page that feels like it shipped from a Series A SaaS with a real design team.

STACK:
- Single HTML file. Tailwind via <script src="https://cdn.tailwindcss.com"></script>.
- Inter from Google Fonts for body + headings. Tabular-nums on numbers.
- No external images. Use inline SVG icons where appropriate (24x24, stroke-based, 1.5 stroke width).

DESIGN LANGUAGE (imitate Linear / Stripe / Vercel):
- Dark navigation bar, light content by default (OR monochrome dark — pick one and commit).
- Generous vertical whitespace (py-24 on sections minimum).
- Hero: oversized headline (text-5xl md:text-6xl lg:text-7xl), tight tracking (tracking-tight), balanced text.
- Accent color from positioning brief used sparingly — primary CTA, one accent line, maybe a subtle gradient.
- Feature cards with subtle borders (border-gray-200) + hover:shadow-lg + rounded-xl. No garish gradients.
- Consistent max-width container (max-w-6xl or max-w-7xl).

SECTIONS (in order):
1. Sticky nav with product name + primary CTA
2. Hero: headline, subhead, primary + secondary CTA, optional small "As seen in" strip
3. 3-column feature grid built from marketing copy valueProps
4. One "how it works" or benefit strip section (you can invent light structure if needed)
5. FAQ accordion using marketing copy FAQ verbatim (use <details><summary> for zero-JS collapse)
6. Final CTA band with accent background
7. Simple footer with product name + copyright

HARD RULES:
- Use the marketing copy headline, subhead, value props, CTAs, and FAQ VERBATIM. Do not rewrite.
- No emoji in UI. Icons should be SVG.
- No JavaScript except <details>/<summary> (which requires none).
- Mobile responsive at sm/md/lg breakpoints.
- Include <title>, meta description, and OG tags in <head>.

OUTPUT FORMAT: Return ONLY the raw HTML document, starting with <!DOCTYPE html> and ending with </html>. Do NOT wrap it in JSON, markdown code fences, or any prose. No explanation before or after. Just the HTML.`,

  userTemplate: `Positioning brief:
{{positioningBrief}}

Marketing copy to use verbatim:
{{marketingCopy}}

Task: {{taskDescription}}`,

  createdAt: 0,
  createdBy: "seed",
  status: "active",
};
