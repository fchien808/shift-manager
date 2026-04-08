# Shift Manager — Roadmap TODOs

Living list of bigger directional bets. Use `// TODO(scope):` comments in code
for tactical, file-local notes; use this doc for product-level intent.

---

## 1. Generalize beyond launch kits → "any knowledge worker, any deliverable"

**Today:** Shift Manager is hard-wired to produce a 6-piece launch kit
(positioning → marketing → website → social → CS docs → verify). The planner,
worker registry, and validator all assume this shape.

**Vision:** A knowledge worker drops in *any* goal — "build me a board deck on
Q2 results," "model three pricing scenarios in Excel," "draft a hiring rubric +
scorecard," "research 10 competitors and write a brief" — and Shift Manager
plans + executes the right multi-agent workflow.

**What needs to change:**
- Worker registry should expand beyond launch-kit workers: `slide-deck`,
  `xlsx-modeler`, `research-brief`, `doc-writer`, `data-analyst`, etc. Each
  needs a system prompt, input/output schema, and tier.
- Planner system prompt + few-shots need to be deliverable-agnostic. Today it
  hard-codes "Launch Kit." Replace with "produce the deliverables the user
  asked for, drawing from the worker catalog."
- Drop the `validatePlan` requirement that every plan contain a `positioning`
  task. Instead, validate structural correctness only (DAG, deps, schemas).
- Output renderer (`/shift/[id]/page.tsx` report view) should render arbitrary
  deliverables, not just launch-kit sections. Probably a generic
  "Deliverables" list keyed off the plan's terminal tasks.
- Skill integration: when a task produces a `.pptx`/`.xlsx`/`.docx`, hand off
  to the corresponding Cowork skill rather than emitting raw text.

**Files to touch:**
- `src/orchestrator/registry.ts` — add new workers
- `src/orchestrator/planner.ts` — generalize prompt + drop launch-kit asserts
- `src/orchestrator/synthesizer.ts` — already general, just exercise more
- `src/app/shift/[id]/page.tsx` — generic deliverables UI
- `src/app/page.tsx` — update DEFAULT_PROPOSAL to showcase variety

---

## 2. Tight 3rd-party integrations (Cowork connectors) — kill copy/paste

**Today:** Each worker outputs text/HTML. The user has to manually copy the
website HTML into Webflow, the LinkedIn post into LinkedIn, etc.

**Vision:** When a task finishes, if the user has the relevant connector
linked, Shift Manager pushes the artifact to the destination as a **draft**
(never auto-publish without confirmation).

**Examples:**
- `website` task → push draft HTML page to Webflow / Framer / WordPress / Ghost
- `social-campaign` task → create draft posts in X, LinkedIn, Facebook,
  Instagram (via Buffer / Hootsuite / native APIs)
- `cs-docs` task → create draft article in Intercom / Zendesk / Help Scout
- `marketing-copy` task → push to Notion / Google Docs
- `slide-deck` task → upload `.pptx` to Google Drive / Dropbox
- `research-brief` task → drop in user's Notion workspace

**What needs to change:**
- New `src/integrations/` module with a `Connector` interface:
  `{ id, name, supports(artifactKind), pushDraft(artifact) }`
- Per-task post-processor hook: after a task completes, look up connectors that
  match the output kind, attempt draft push, surface result in event stream.
- UI: connector status pills on the report view ("✓ Drafted to LinkedIn").
- Use the Cowork MCP registry / `search_mcp_registry` pattern to discover
  installed connectors at runtime.
- Permission model: never publish, always draft. User clicks through to review.

**Files to touch:**
- New `src/integrations/` directory
- `src/lib/run-shift-background.ts` — call integrations after each task
- `src/app/shift/[id]/page.tsx` — render connector status
- Possibly a settings page for connecting accounts

---

## 3. Fluid agent synthesis — know exactly what the user wants and deliver it

**Today:** The synthesizer (`src/orchestrator/synthesizer.ts`) only fires when
the planner detects a capability gap. Even then, the new worker is best-effort
and not always validated against what the user actually asked for. The planner
sometimes invents extra tasks (e.g. when goals expand to GTM + market research)
and forgets to wire `dependsOn` (just patched with auto-repair, but root cause
is loose intent capture).

**Vision:** Before planning, Shift Manager has a brief, structured back-and-
forth with the user that locks down: *what specific outputs do you want, in
what format, with what audience, by when?* Then the planner produces a DAG
that provably covers each output. Then the synthesizer fills any worker gaps
on demand. After execution, a final "deliverable matcher" verifies every
requested output exists and meets the spec.

**What needs to change:**
- **Intent capture step** before planning. Could be a Sonnet pass that reads
  the proposal and emits a structured `RequestedDeliverables[]` list:
  `{ id, kind, format, audience, requirements }`. Show this to the user for
  confirmation before the shift starts.
- **Plan-vs-intent check**: validator confirms every `RequestedDeliverable` is
  produced by some terminal task. If not, planner re-runs with the gap.
- **Output-vs-intent verifier**: after execution, Haiku verifier checks each
  deliverable against its spec (not just generic quality).
- **Synthesizer triggers**: gap detection should also fire if a requested
  deliverable has no matching worker — not just when the planner says so.

**Files to touch:**
- New `src/orchestrator/intent.ts` — capture step
- `src/orchestrator/planner.ts` — accept `RequestedDeliverables` as input,
  validate coverage
- `src/orchestrator/verifier.ts` — per-deliverable spec checks
- `src/app/page.tsx` — UI for confirming captured intent before launch

---

## Smaller stuff (drop in as you go)

- [ ] Cost dashboard: split by tier vs. by worker
- [ ] Resume/retry failed tasks without rerunning the whole shift
- [ ] Export full shift bundle as `.zip`
- [ ] Shareable read-only shift URLs
- [ ] Workers can stream partial output (token-by-token) into the event log
- [ ] Worker registry editable from the UI
