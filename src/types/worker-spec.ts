/**
 * WorkerSpec - data-driven worker definition.
 *
 * The big architectural shift: workers are no longer hardcoded functions
 * in a switch statement. They are declarative specs (prompt + tier + I/O
 * schemas) that a generic runtime executes. This lets the Opus planner
 * (a) pick from a growing registry of known workers and (b) synthesize
 * entirely new workers on demand when no existing capability fits.
 *
 * Seed workers are registered as TypeScript modules (typed + versioned
 * in source control). Synthesized workers are persisted as JSON files
 * under ./data/workers/. Both end up in the same in-memory registry.
 */

import type { ModelTier } from "./shift";

/**
 * A JSON Schema object. We don't import a full JSON Schema type here —
 * ajv will validate at runtime. The planner only needs to read these
 * schemas as data, not type them precisely.
 */
export type JsonSchema = Record<string, unknown>;

export interface WorkerSpec {
  /** Stable kebab-case identifier (e.g. "positioning", "competitive-research") */
  id: string;
  /** Version number, bumped when prompt or schema changes */
  version: number;
  /** Short human-readable name */
  name: string;
  /** One-liner the planner uses for capability matching */
  description: string;
  /** Longer explanation of what the worker does, inputs, outputs */
  purpose: string;
  /** Discovery tags (e.g. "research", "content", "gtm") */
  tags: string[];

  /** Model tier this worker runs on */
  tier: ModelTier;
  /** Max output tokens */
  maxTokens: number;
  /** Sampling temperature */
  temperature: number;

  /** JSON Schema describing the input object this worker expects */
  inputSchema: JsonSchema;
  /** JSON Schema describing the structured output this worker produces */
  outputSchema: JsonSchema;
  /**
   * Declares how output is formatted:
   *   - "json": model returns JSON matching outputSchema (validated)
   *   - "html": model returns raw HTML between <!DOCTYPE html>...</html>;
   *     outputSchema describes a wrapping object like { html: string }
   */
  outputFormat: "json" | "html";

  /** System prompt for the worker */
  systemPrompt: string;
  /**
   * User message template rendered with input values.
   * Supports {{placeholder}} substitution where placeholder is an input
   * field name. Object/array values are JSON.stringify'd with indent=2.
   */
  userTemplate: string;

  createdAt: number;
  createdBy: "seed" | "synthesis";
  status: "active" | "draft" | "deprecated";

  /** Filled in for synthesized workers */
  provenance?: {
    shiftId: string;
    sourceRequest: string;
    designedBy: ModelTier;
  };

  /** Usage + quality tracking (updated by supervisor over time) */
  metrics?: {
    uses: number;
    successes: number;
    lastUsedAt?: number;
    lastVerifierIssues?: number;
  };
}

// ============================================================
// Input binding language
//
// The planner wires upstream outputs to downstream worker inputs
// using a tiny binding DSL. Each binding resolves to a concrete
// value at execution time.
// ============================================================

export type InputBinding =
  /** Literal value (string, number, object, etc) */
  | { kind: "literal"; value: unknown }
  /** The product proposal text from the shift input */
  | { kind: "proposal" }
  /** Full output object of an upstream task */
  | { kind: "task"; taskId: string }
  /** Specific field of an upstream task's output (dot-path) */
  | { kind: "task_field"; taskId: string; path: string }
  /** A planning-time artifact produced by a worker called during planning */
  | { kind: "artifact"; artifactId: string };

/**
 * A task in a ShiftPlan is now a worker invocation: pick a workerId from
 * the registry and declare how to assemble its inputs from upstream.
 */
export interface PlannedTask {
  /** Unique task id within this shift (e.g. "positioning-1") */
  id: string;
  /** Worker to invoke from the registry */
  workerId: string;
  /** Model tier used for planner display; copied from the worker spec */
  tier: ModelTier;
  /** Human-readable label for the UI lane */
  label: string;
  /** Short description of what this task produces, from the planner */
  description: string;
  /** Upstream task ids this task depends on */
  dependsOn: string[];
  /** Bindings keyed by the input field names declared in the worker's inputSchema */
  inputs: Record<string, InputBinding>;
  /** Success criteria, for the verifier */
  successCriteria: string[];
}

/**
 * CapabilityGap - the planner declares a gap when no existing worker in
 * the registry fits a step it needs. This is the handoff point where
 * Phase C (worker synthesis) can plug in: Opus will later design a full
 * WorkerSpec from the gap description, run a smoke test, and register it
 * as a draft worker pending approval.
 */
export interface CapabilityGap {
  /** Suggested kebab-case id for the new worker */
  proposedWorkerId: string;
  /** What this missing worker should do */
  proposedPurpose: string;
  /** Discovery tags */
  proposedTags: string[];
  /** Suggested model tier */
  proposedTier: ModelTier;
  /** Short human description of the inputs it will need */
  inputsDescription: string;
  /** Short human description of the structured output it should produce */
  outputDescription: string;
  /** Why no existing registry worker fit this need */
  reasonNoExistingFit: string;
  /** The step in the plan where this gap appeared, for UX context */
  placedAfter?: string;
}

/**
 * Planning-time artifact: output of a worker the planner invoked during
 * planning (e.g. competitive-research), whose result is cached and
 * optionally surfaced in the final report.
 */
export interface PlanningArtifact {
  id: string;
  workerId: string;
  output: unknown;
  surfaceInReport: boolean;
  createdAt: number;
}
