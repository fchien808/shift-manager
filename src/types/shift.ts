/**
 * Core types for Shift Manager orchestrator.
 *
 * A Shift is the atomic unit of delegated work. It consists of:
 *   - An input (for the demo: a product proposal)
 *   - A Plan (DAG of tasks produced by the Planner/Opus)
 *   - Task results produced by Workers (Sonnet/Haiku)
 *   - A Shift Report assembled by the Supervisor (Opus)
 */

export type ModelTier = "opus" | "sonnet" | "haiku";

export const MODEL_IDS: Record<ModelTier, string> = {
  opus: "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
};

// Approximate pricing per 1M tokens (USD) as of April 2026.
// Used for the live cost dashboard in the demo - the key visual
// that makes the tiered-architecture argument concrete.
export const PRICING: Record<ModelTier, { input: number; output: number }> = {
  opus: { input: 15, output: 75 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 1, output: 5 },
};

export type TaskType =
  | "positioning" // extracts brand/positioning brief from input (anchor for all others)
  | "marketing_copy" // headline, subhead, value props, CTA, FAQ
  | "website" // single-file HTML landing page
  | "social_campaign" // 3 social posts with images
  | "cs_docs" // getting started + FAQ + troubleshooting
  | "verification" // cross-worker brand consistency check
  | "assembly"; // final launch kit compilation

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "retrying"
  | "blocked";

export interface TaskDefinition {
  id: string;
  type: TaskType;
  tier: ModelTier;
  description: string;
  dependsOn: string[]; // task ids
  successCriteria: string[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  tier: ModelTier;
  costUsd: number;
}

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  output?: unknown; // structured output specific to task type
  error?: string;
  usage: TokenUsage[];
  startedAt: number;
  completedAt?: number;
  retryCount: number;
}

// Forward reference; PlannedTask lives in worker-spec.ts to keep that
// module the single source of truth for worker data shapes.
import type { PlannedTask, CapabilityGap } from "./worker-spec";

export interface ShiftPlan {
  shiftId: string;
  goal: string;
  tasks: PlannedTask[];
  /** Id of the deterministic assembly step appended after planning */
  assemblyTaskId?: string;
  /**
   * Steps the planner wanted but couldn't fulfill with any registry worker.
   * In Phase B these surface as blockers; Phase C will synthesize new workers
   * from these gaps.
   */
  capabilityGaps?: CapabilityGap[];
  estimatedTokenBudget: {
    opus: number;
    sonnet: number;
    haiku: number;
  };
  createdAt: number;
}

export interface Blocker {
  taskId: string;
  description: string;
  proposedResolution?: string;
  severity: "info" | "warning" | "critical";
}

export interface ShiftState {
  shiftId: string;
  input: string; // the product proposal text
  plan?: ShiftPlan;
  results: Record<string, TaskResult>;
  blockers: Blocker[];
  startedAt: number;
  completedAt?: number;
  status: "planning" | "executing" | "reviewing" | "assembling" | "done" | "failed";
}

/** Structured outputs per worker type. These are the schemas
 *  the supervisor validates against before accepting a worker result.
 */

export interface PositioningOutput {
  productName: string;
  oneLiner: string;
  targetUser: string;
  valueProp: string;
  differentiators: string[];
  tone: string;
  accentColor: string; // hex, used by website worker
}

export interface MarketingCopyOutput {
  headline: string;
  subhead: string;
  valueProps: Array<{ title: string; body: string }>;
  cta: { primary: string; secondary: string };
  faq: Array<{ question: string; answer: string }>;
}

export interface WebsiteOutput {
  html: string; // single-file HTML with inline Tailwind
}

export interface SocialPost {
  platform: "twitter" | "linkedin" | "instagram";
  title: string;
  body: string;
  imagePrompt: string;
  imageUrl?: string; // filled in after image generation
}

export interface SocialCampaignOutput {
  posts: SocialPost[];
}

export interface CsDocsOutput {
  gettingStarted: string; // markdown
  faq: Array<{ question: string; answer: string }>;
  troubleshooting: Array<{ issue: string; resolution: string }>;
}

export interface VerificationOutput {
  passed: boolean;
  issues: Array<{
    severity: "info" | "warning" | "critical";
    workerId: string;
    description: string;
    suggestedFix?: string;
  }>;
}

export interface LaunchKit {
  positioning: PositioningOutput;
  marketingCopy: MarketingCopyOutput;
  website: WebsiteOutput;
  socialCampaign: SocialCampaignOutput;
  csDocs: CsDocsOutput;
  verification: VerificationOutput;
}

/** Events emitted by the orchestrator during execution.
 *  The UI subscribes to these via SSE to render the live shift view.
 */
export type ShiftEvent =
  | { type: "plan_created"; plan: ShiftPlan }
  | { type: "task_started"; taskId: string; tier: ModelTier }
  | { type: "task_progress"; taskId: string; message: string }
  | { type: "task_completed"; taskId: string; usage: TokenUsage[] }
  | { type: "task_failed"; taskId: string; error: string }
  | { type: "task_retrying"; taskId: string; reason: string }
  | { type: "verifier_review"; result: VerificationOutput }
  | { type: "blocker_raised"; blocker: Blocker }
  | { type: "shift_completed"; launchKit: LaunchKit }
  | { type: "shift_failed"; error: string };

export type EventCallback = (event: ShiftEvent) => void;
