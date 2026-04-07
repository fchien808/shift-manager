/**
 * Thin wrapper around the Anthropic SDK that:
 *   1. Routes requests to the right model tier.
 *   2. Tracks token usage and cost per call.
 *   3. Provides a simple JSON-extraction helper for structured outputs.
 *
 * This wrapper is intentionally small. We don't use LangChain or CrewAI
 * because the orchestration logic IS the product story we want to show.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ModelTier, MODEL_IDS, PRICING, TokenUsage } from "@/types/shift";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface CallOptions {
  tier: ModelTier;
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
  temperature?: number;
  tools?: Anthropic.Tool[];
}

export interface CallResult {
  text: string;
  usage: TokenUsage;
  stopReason: string | null;
  raw: Anthropic.Message;
}

export async function callModel(opts: CallOptions): Promise<CallResult> {
  const { tier, system, messages, maxTokens = 4096, temperature = 0.7, tools } = opts;

  const response = await client.messages.create({
    model: MODEL_IDS[tier],
    system,
    messages,
    max_tokens: maxTokens,
    temperature,
    ...(tools ? { tools } : {}),
  });

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const pricing = PRICING[tier];
  const costUsd =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;

  // Extract text from the first text block.
  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";

  return {
    text,
    usage: {
      inputTokens,
      outputTokens,
      tier,
      costUsd,
    },
    stopReason: response.stop_reason,
    raw: response,
  };
}

/**
 * Extract a JSON object from model output. Handles both raw JSON
 * and JSON inside ```json code fences, which is how Claude usually
 * returns structured data. We prompt for JSON explicitly but the
 * model sometimes wraps it - this parser handles both forms.
 */
export function extractJson<T>(text: string): T {
  let jsonStr = text.trim();

  // Strip a closed ```json ... ``` fence if present
  const closedFence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (closedFence) {
    jsonStr = closedFence[1].trim();
  } else {
    // Strip an UNclosed leading fence (happens when output is truncated mid-JSON)
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }

  const firstBrace = jsonStr.indexOf("{");
  if (firstBrace === -1) {
    throw new Error(`No JSON object found in model output:\n${text.slice(0, 500)}`);
  }
  const lastBrace = jsonStr.lastIndexOf("}");

  // If there's no closing brace at all, the output was truncated mid-object.
  // Try to repair it by closing open strings, arrays, and braces.
  let candidate: string;
  if (lastBrace === -1 || lastBrace < firstBrace) {
    candidate = repairTruncatedJson(jsonStr.slice(firstBrace));
  } else {
    candidate = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(candidate) as T;
  } catch (err) {
    // Last-resort repair even if we had a closing brace
    try {
      const repaired = repairTruncatedJson(candidate);
      return JSON.parse(repaired) as T;
    } catch {
      throw new Error(
        `Failed to parse JSON from model output: ${(err as Error).message}\n\nCandidate:\n${candidate.slice(0, 500)}`
      );
    }
  }
}

/**
 * Best-effort repair of a truncated JSON object.
 *
 * Walks the string tracking whether we're inside a string (respecting
 * backslash escapes), counting open braces/brackets, and detecting
 * whether the last token is a dangling comma or property key. Then it
 * closes any open string, trims trailing commas/partial tokens, and
 * appends the missing closing brackets and braces.
 *
 * This won't magically fix all truncation, but it recovers the common
 * case where the model ran out of tokens mid-array and was otherwise
 * producing valid structure.
 */
function repairTruncatedJson(s: string): string {
  let inString = false;
  let escape = false;
  const stack: string[] = []; // '{' or '['
  let lastNonWs = "";

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}") {
      if (stack[stack.length - 1] === "{") stack.pop();
    } else if (c === "]") {
      if (stack[stack.length - 1] === "[") stack.pop();
    }
    if (c.trim()) lastNonWs = c;
  }

  let out = s;
  // Close a dangling string
  if (inString) out += '"';
  // Trim dangling comma or partial-key artifacts
  out = out.replace(/,\s*$/s, "");
  // If last non-ws was ':' or we're left with an orphan key, drop that key
  out = out.replace(/,\s*"[^"]*"\s*:\s*$/s, "");
  out = out.replace(/\{\s*"[^"]*"\s*:\s*$/s, "{");
  // Close any still-open arrays and objects in LIFO order
  while (stack.length) {
    const open = stack.pop();
    out += open === "{" ? "}" : "]";
  }
  return out;
}
