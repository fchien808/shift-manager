# Shift Manager

> **Start the shift at midnight. Review finished work at 8am.**

Shift Manager is an asynchronous multi-agent work delegation platform. Drop in a product proposal (or any goal); a tiered team of Claude agents — **Opus** plans, **Sonnet** workers execute in parallel, **Haiku** verifies — produces a complete launch kit (positioning, marketing copy, landing page, social campaign, CS docs) and delivers a structured report. No babysitting. No browser tab left open.

This is the working web prototype: Next.js + Vercel + Redis Cloud, with a live shift view, persistent state across function timeouts, and a **dynamic worker registry that synthesizes brand-new workers on demand** when the planner encounters a capability the catalog doesn't cover.

---

## Architecture

```
            ┌─────────────────┐
            │  User: product  │
            │     proposal    │
            └────────┬────────┘
                     │
                     ▼
          ┌────────────────────┐
          │  Planner (Opus)    │  ← reads worker registry catalog,
          └────────┬───────────┘     produces a DAG with tier
                   │                  assignments + success criteria
                   │
                   │ (capability gap?)
                   │       │
                   │       ▼
                   │  ┌──────────────────┐
                   │  │ Synthesizer      │  ← Opus drafts a brand-new
                   │  │ (Opus)           │     WorkerSpec on the fly
                   │  └────────┬─────────┘     (system prompt + I/O JSON
                   │           │                schemas) so the runtime
                   │           ▼                can execute it without
                   │     New worker added       any code changes
                   │     to live registry
                   │
                   ▼
          ┌────────────────────┐
          │ Positioning worker │  ← Sonnet: brand anchor for downstream
          └────────┬───────────┘
                   │
          ┌────────┴────────┬──────────┬──────────┐
          ▼                 ▼          ▼          ▼
    ┌──────────┐     ┌──────────┐ ┌────────┐ ┌────────┐
    │ Marketing│     │ Website  │ │ Social │ │CS Docs │  ← parallel
    │   Copy   │     │  (HTML)  │ │Campaign│ │        │     Sonnet workers
    └────┬─────┘     └────┬─────┘ └───┬────┘ └───┬────┘
         │                │           │          │
         └────────┬───────┴─────┬─────┴──────────┘
                  ▼             ▼
          ┌────────────────────────┐
          │ Verifier (Haiku)       │  ← brand consistency + spec check
          └────────┬───────────────┘
                   │
                   ▼
          ┌────────────────────┐
          │  Morning Report    │  ← artifacts, cost dashboard,
          │   (live in UI)     │     event log, blockers
          └────────────────────┘
```

**Model tiering** (validated on real shifts, not theoretical):
- **Opus** — planning, synthesis, supervisor judgment. ~5-10% of tokens.
- **Sonnet** — primary execution. ~60-70% of tokens.
- **Haiku** — verification, formatting, checks. ~20-30% of tokens.

**Real cost compression:** a full launch-kit shift runs ~$0.30-$0.60 in tokens vs. ~$4-$8 if every task ran on Opus — about a **10x compression** on a real workload.

---

## What's interesting in this prototype

### 1. Dynamic worker synthesis (the key feature)

The planner doesn't pick from a hard-coded list of workers. It reads a **live worker registry catalog** at plan time. If it encounters a sub-task that no existing worker can handle, it emits a `CapabilityGap` describing what's needed, and the **Synthesizer (Opus)** designs a brand-new `WorkerSpec` on the fly:

- A tuned system prompt for the new worker
- A user-message template with `{{placeholders}}`
- A JSON Schema for inputs (validated before the call)
- A JSON Schema for outputs (validated after the call)
- A tier assignment (Sonnet or Haiku based on complexity)

The generic worker runtime then executes the new spec without any code changes — render the template, call the model with structured output, validate, hand off to downstream tasks. New synthesized workers are persisted as drafts so they can be reviewed before being promoted to the catalog (preventing the planner from picking unverified workers in future shifts).

This is what makes the architecture general. Adding a new deliverable type (research brief, slide deck, spreadsheet model) doesn't require writing TypeScript — the planner asks for it, the synthesizer designs it, the runtime runs it.

See: `src/orchestrator/synthesizer.ts`, `src/orchestrator/registry.ts`.

### 2. Pluggable persistence that survives serverless timeouts

Vercel functions have a wall-clock cap, and shifts run longer than the default. Solved with:

- **`Store` abstraction** (`src/lib/store/`) with two implementations: `InMemoryStore` for local dev, `RedisStore` for production. Same async API: `createShift`, `setPlan`, `appendEvent`, `markDone`, `subscribe`.
- **Redis Cloud over `ioredis`** — TCP client cached on `globalThis` for warm Lambda reuse. Storage layout: `shift:{id}` JSON blob + `shift:{id}:events` list + `shifts:index` sorted set, all 14-day TTL.
- **Polling subscribe** — `LRANGE` from `lastIdx` every 800ms instead of pub/sub. Boring, works across function instances.
- **Vercel Fluid Compute + `maxDuration: 800`** with `waitUntil` keeping the background runner alive after the HTTP response returns.

Refresh the page mid-shift and the report picks up exactly where it left off.

### 3. Planner heartbeat reasoning (delegation UX, not chat UX)

The planning phase is ~60s of Opus inference. Silent dead air would make the user think it crashed. The orchestrator emits a rotating "what the planner is thinking" event every 5 seconds — _"Reading worker registry catalog… Matching steps to available workers… Decomposing launch into a parallelizable DAG… Wiring task dependencies…"_ — surfaced in the live shift view next to a pulsing dot. Solves the worst UX bug from the v0 and turns the awkward latency into a feature that demonstrates planner reasoning visibly.

### 4. Auto-repaired planner deps

Opus occasionally generates a plan where a task's `inputs.taskId` references a parent that's missing from its own `dependsOn` list (especially when goals expand beyond the few-shot examples — e.g. asking the planner to add GTM strategy + market research on top of a launch kit). We hit this exact bug in real runs. Mitigation: a `repairPlanDeps()` pass walks every task's input bindings before validation and auto-adds any referenced taskId into `dependsOn`. Safe inference (a binding *is* a dependency), and means the planner can be slightly sloppy without nuking the whole shift.

See: `src/orchestrator/planner.ts` → `repairPlanDeps`.

---

## Prerequisites

- Node.js 18+
- An Anthropic API key
- (Optional) A Fal.ai API key for real image generation in social campaigns — without it, the system falls back to placeholder images
- (For deployment) A Redis Cloud database accessible via `REDIS_URL` (Vercel Marketplace works out of the box)

## Install

```bash
cd shift-manager
npm install
```

## Configure

Create a `.env.local` file in the `shift-manager/` directory:

```bash
ANTHROPIC_API_KEY=sk-ant-...
FAL_API_KEY=...        # optional
REDIS_URL=rediss://... # optional locally; required for Vercel deploy
```

Without `REDIS_URL`, the app uses `InMemoryStore` — perfect for local dev, but state won't survive a server restart.

## Run locally

```bash
npm run dev
# open http://localhost:3000
```

Paste a product proposal into the start form on the home page and hit **Start a shift**. You'll be redirected to the live shift view, where you can watch the planner heartbeat, then the workers fan out, then the verifier and report.

## Deploy to Vercel

```bash
vercel link    # one-time, link the project
vercel --prod
```

Make sure these environment variables are set in the Vercel project:
- `ANTHROPIC_API_KEY`
- `REDIS_URL` (use the Vercel Marketplace Redis Cloud integration; the env var is auto-populated)
- `FAL_API_KEY` (optional)

The repo's `vercel.json` enables Fluid Compute and bumps `maxDuration` to 800s on the shift API routes.

## Project structure

```
shift-manager/
├── README.md
├── TODO.md                            ← roadmap (3 big bets, see below)
├── package.json
├── tsconfig.json
├── vercel.json                        ← Fluid Compute + maxDuration
├── src/
│   ├── app/
│   │   ├── layout.tsx                 ← top nav + footer + Inter font
│   │   ├── page.tsx                   ← landing page + start form
│   │   ├── globals.css                ← full design system
│   │   ├── shift/[id]/page.tsx        ← live shift view + report
│   │   └── api/
│   │       ├── shift/route.ts         ← POST start shift
│   │       ├── shift/[id]/route.ts    ← GET shift state
│   │       ├── shift/[id]/stream/     ← SSE event stream
│   │       └── shifts/route.ts        ← GET shift history
│   ├── orchestrator/
│   │   ├── planner.ts                 ← Opus DAG planner + auto-repair
│   │   ├── supervisor.ts              ← wave-based DAG executor
│   │   ├── synthesizer.ts             ← on-demand WorkerSpec creator
│   │   ├── registry.ts                ← worker catalog
│   │   └── verifier.ts                ← Haiku consistency check
│   ├── workers/
│   │   ├── workers.ts                 ← built-in workers
│   │   └── image-gen.ts               ← Fal.ai Flux integration
│   ├── lib/
│   │   ├── store/                     ← Store abstraction
│   │   │   ├── types.ts               ← Store interface
│   │   │   ├── memory-store.ts        ← in-memory impl
│   │   │   ├── redis-store.ts         ← ioredis impl
│   │   │   └── index.ts               ← getStore() factory
│   │   └── run-shift-background.ts    ← waitUntil background runner
│   └── types/
│       └── shift.ts                   ← all event + plan types
└── scripts/
    └── test-orchestrator.ts           ← headless e2e (legacy, still works)
```

## Key files to read (for code review)

1. **`src/orchestrator/supervisor.ts`** — wave-based DAG execution, parallel fan-out, retry logic, verification gate, cost summary. This is where the multi-agent architecture lives.
2. **`src/orchestrator/planner.ts`** — Opus prompt that turns a goal into a structured DAG. Includes `repairPlanDeps()` and `validatePlan()`.
3. **`src/orchestrator/synthesizer.ts`** — the dynamic worker creation flow. Reads a `CapabilityGap` and produces a complete `WorkerSpec` (system prompt, template, input/output JSON schemas).
4. **`src/orchestrator/registry.ts`** — the worker catalog the planner draws from. Synthesized workers are added here as drafts.
5. **`src/lib/store/redis-store.ts`** — the persistence layer with the polling subscribe trick.
6. **`src/app/shift/[id]/page.tsx`** — the live shift view: lanes, heartbeat, event log, cost dashboard, report.
7. **`src/types/shift.ts`** — full event + plan type system, pricing model for the cost dashboard.

## Roadmap

See [`TODO.md`](./TODO.md) for the three big roadmap bets:

1. **Generalize beyond launch kits** → any deliverable, any knowledge worker (board decks, Excel models, research briefs, doc writing, data analysis). Expand the worker registry, drop launch-kit-specific validator asserts, render arbitrary deliverables in the report view.
2. **Tight 3rd-party connector integrations** → kill the copy-paste tax. When a worker finishes, push the artifact as a *draft* to the user's connected tools (Webflow, LinkedIn, Notion, Google Drive, Intercom, etc.). Policy is invariant: **draft only, never publish.**
3. **Fluid agent synthesis with intent capture** → before planning, lock down a structured `RequestedDeliverables` contract with the user. Validate that every requested deliverable is covered by some terminal task in the plan. Verify post-execution that every deliverable was actually produced. Trigger the synthesizer not just on planner-detected gaps, but on any uncovered deliverable.

`grep -rn "TODO(roadmap" src/` jumps you to the exact code anchors for each roadmap item.
