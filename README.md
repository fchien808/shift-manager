# Claude Shift Manager — Prototype

Multi-agent async work delegation platform. This prototype demonstrates a tiered supervisor/worker architecture that generates a complete product Launch Kit (positioning brief, marketing copy, landing page, social campaign with images, customer service docs) from a single product proposal input.

## Architecture

```
            ┌─────────────────┐
            │  User: product  │
            │     proposal    │
            └────────┬────────┘
                     │
                     ▼
          ┌────────────────────┐
          │  Planner (Opus)    │  ← produces DAG with tier assignments
          └────────┬───────────┘
                   │
                   ▼
          ┌────────────────────┐
          │ Positioning worker │  ← Sonnet: brand anchor for all downstream
          │      (Sonnet)      │
          └────────┬───────────┘
                   │
          ┌────────┴────────┬──────────┬──────────┐
          ▼                 ▼          ▼          ▼
    ┌──────────┐     ┌──────────┐ ┌────────┐ ┌────────┐
    │ Marketing│     │ Website  │ │ Social │ │CS Docs │  ← 4 parallel
    │   Copy   │     │  (HTML)  │ │Campaign│ │        │     Sonnet workers
    └────┬─────┘     └────┬─────┘ └───┬────┘ └───┬────┘
         │                │           │           │
         │                │           ▼           │
         │                │      ┌─────────┐      │
         │                │      │Fal.ai   │      │
         │                │      │Flux     │      │
         │                │      │(images) │      │
         │                │      └────┬────┘      │
         │                │           │           │
         └────────┬───────┴─────┬─────┴───────────┘
                  ▼             ▼
          ┌────────────────────────┐
          │ Verifier (Haiku)       │  ← brand consistency check
          │ brand consistency pass │
          └────────┬───────────────┘
                   │
                   ▼
          ┌────────────────────┐
          │ Assembly (Opus)    │  ← Launch Kit compilation
          └────────┬───────────┘
                   │
                   ▼
            ┌─────────────┐
            │ Launch Kit  │  (plan.json, website.html, copy.md,
            │  artifacts  │   social.md, cs-docs.md + cost report)
            └─────────────┘
```

Model tiering:
- **Opus** — planning, assembly. Used sparingly (~5-10% of tokens).
- **Sonnet** — primary execution (~60-70% of tokens). Positioning, copy, website, social, cs docs.
- **Haiku** — verification, formatting checks (~20-30% of tokens).

## Prerequisites

- Node.js 18+
- An Anthropic API key
- (Optional) A Fal.ai API key for real image generation in the social campaign — without it, the system falls back to placeholder images via picsum.photos

## Install

```bash
cd shift-manager
npm install
```

## Configure

Create a `.env` file in the `shift-manager/` directory:

```bash
cp .env.example .env
# then edit .env and paste your key:
# ANTHROPIC_API_KEY=sk-ant-...
# FAL_API_KEY=...   (optional)
```

## Run the end-to-end orchestrator test

This is the headless test that runs the full pipeline on the Shift Manager product proposal as input (meta demo). It will:

1. Call Opus to produce a shift plan (DAG of tasks with tier assignments)
2. Execute the positioning worker (Sonnet)
3. Fan out four parallel workers — marketing copy, website, social campaign, cs docs (all Sonnet)
4. Generate images for the social posts (Fal.ai Flux Schnell, or placeholders)
5. Run the verifier (Haiku) to check brand consistency across all outputs
6. Assemble the Launch Kit and write all artifacts to `./artifacts/shift-<timestamp>/`
7. Print a cost summary showing per-tier token spend and the Opus-only cost estimate for contrast

```bash
npm run orchestrator:test
```

Expected runtime: 2-6 minutes depending on model latency and image generation. Cost: usually under $1 per shift.

## Inspect the results

After the test completes:

```bash
# The most interesting artifact - open it in a browser
open artifacts/shift-*/website.html

# Other outputs
cat artifacts/shift-*/marketing-copy.md
cat artifacts/shift-*/social-campaign.md
cat artifacts/shift-*/cs-docs.md

# The full plan and shift state (for debugging)
cat artifacts/shift-*/plan.json | jq .
cat artifacts/shift-*/shift-state.json | jq .
```

## Project structure

```
shift-manager/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── src/
│   ├── types/
│   │   └── shift.ts              # all structured types + pricing model
│   ├── orchestrator/
│   │   ├── anthropic-client.ts   # SDK wrapper with token tracking
│   │   ├── planner.ts            # Opus-based DAG planner
│   │   └── supervisor.ts         # the main orchestration loop
│   └── workers/
│       ├── workers.ts            # all 5 workers + verifier
│       └── image-gen.ts          # Fal.ai Flux integration
├── scripts/
│   └── test-orchestrator.ts      # end-to-end runner
└── artifacts/
    └── shift-<timestamp>/        # output of each run
```

## Key files to read (for code review)

1. **`src/orchestrator/supervisor.ts`** — the core orchestration loop. Wave-based DAG execution, parallel fan-out, retry logic, verification gate, cost summary. This is where the multi-agent architecture lives.
2. **`src/orchestrator/planner.ts`** — Opus prompt that turns a product proposal into a structured DAG with tier assignments and success criteria.
3. **`src/workers/workers.ts`** — all five workers + verifier. Each has a tuned system prompt and a structured JSON output contract that the supervisor validates against.
4. **`src/types/shift.ts`** — the full type system and the pricing model used for the cost dashboard.

## Next steps (not yet built)

- Next.js UI with three surfaces: Plan view, Live Shift view (with per-worker lanes + live token counter), Morning Report
- Timeline/Gantt visualization of parallel worker execution
- Website preview iframe in the Morning Report
- Pre-seeded second shift (for the "shift history" demo moment)
