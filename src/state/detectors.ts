import { createHash } from "node:crypto";
import type { BetweenTurnsConfig } from "../types/config.js";
import type { SessionState } from "../types/session-state.js";
import { chatCompletionsForcedTool } from "../runtime/gloo-client.js";

const STRUGGLE_JUDGE_MODEL = "gloo-anthropic-claude-sonnet-4.5";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

function errorSignature(toolInput: unknown, toolResponse: unknown): string {
  const raw = JSON.stringify({ toolInput, toolResponse });
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * Called on every PostToolUse event (matcher is unscoped -- see .claude/settings.json),
 * so this is the only place that can observe whether an edit happened between
 * two Bash failures. Mutates state in place; caller is responsible for saving it.
 */
export function recordToolOutcome(
  state: SessionState,
  params: { toolName: string; toolInput: unknown; toolResponse: unknown; failed: boolean }
): void {
  if (EDIT_TOOLS.has(params.toolName)) {
    state.ambient.edit_since_last_failure = true;
    return;
  }

  if (params.toolName !== "Bash") {
    return;
  }

  if (!params.failed) {
    // A successful command breaks the streak -- start fresh next time.
    state.recent_tool_failures = [];
    state.ambient.consecutive_failure_count = 0;
    return;
  }

  const signature = errorSignature(params.toolInput, params.toolResponse);
  const isFirstInStreak = state.recent_tool_failures.length === 0;

  // The TDD red-green / flaky-rerun exclusion: a repeated failure with no
  // edit since the last one doesn't count toward the stuck-loop threshold.
  if (!isFirstInStreak && !state.ambient.edit_since_last_failure) {
    return;
  }

  state.recent_tool_failures.push({
    turn: state.turn_counter,
    tool: params.toolName,
    error_signature: signature,
    had_edit_since_prior: isFirstInStreak || state.ambient.edit_since_last_failure,
  });
  state.ambient.consecutive_failure_count = state.recent_tool_failures.length;
  state.ambient.edit_since_last_failure = false;
}

export interface DetectorResult {
  fired: boolean;
  score: number;
  detail: string;
  errorSignature?: string;
}

export function detectStuckLoop(state: SessionState, config: BetweenTurnsConfig): DetectorResult {
  const threshold = config.pacing.ambient_stuck_loop_failure_threshold;
  if (state.recent_tool_failures.length < threshold) {
    return { fired: false, score: 0, detail: `${state.recent_tool_failures.length}/${threshold} heterogeneous failures so far` };
  }
  const latest = state.recent_tool_failures[state.recent_tool_failures.length - 1]!;
  return {
    fired: true,
    score: Math.min(1, 0.5 + 0.15 * state.recent_tool_failures.length),
    detail: `${state.recent_tool_failures.length} heterogeneous consecutive Bash failures (each preceded by a real edit)`,
    errorSignature: latest.error_signature,
  };
}

const SHORT_AFFIRMATIVES = new Set([
  "yes",
  "yeah",
  "yep",
  "ok",
  "okay",
  "sure",
  "continue",
  "go ahead",
  "do that",
  "yes please",
  "sounds good",
  "proceed",
  "looks good",
  "lgtm",
]);

/**
 * Replaced the old regex-based detectFrustration() with a real Gloo judgment
 * call -- phrase-matching only caught explicit lexical markers ("ugh",
 * "frustrating") and missed quieter struggle (repeated failed attempts,
 * resignation, confusion with no keyword attached). The caller is
 * responsible for checking pacing *before* calling this (see
 * user-prompt-submit.ts) so this only ever runs when a delivery could
 * actually happen -- otherwise every single message in every session would
 * cost a synchronous API call for no benefit on the turns pacing would
 * reject anyway. Fails closed: any API error is treated as "not struggling,"
 * the same way retrieval/selection failures suppress delivery elsewhere.
 */
export async function detectStruggleViaGloo(config: BetweenTurnsConfig, prompt: string): Promise<DetectorResult> {
  const normalized = prompt.trim().toLowerCase().replace(/[.!?]+$/, "");
  if (normalized.length < 24 && SHORT_AFFIRMATIVES.has(normalized)) {
    return { fired: false, score: 0, detail: "short affirmative, skipped" };
  }

  const parametersSchema = {
    type: "object",
    properties: {
      is_struggling: { type: "boolean", description: "True only if the message reflects genuine struggle, frustration, or being stuck -- not ordinary technical conversation." },
      confidence: { type: "number", description: "0 to 1." },
      rationale: { type: "string", description: "One brief sentence." },
    },
    required: ["is_struggling", "confidence", "rationale"],
    additionalProperties: false,
  };

  try {
    const { parsed } = await chatCompletionsForcedTool<{ is_struggling: boolean; confidence: number; rationale: string }>(
      config,
      {
        model: STRUGGLE_JUDGE_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You judge whether a developer's message to their coding assistant reflects genuine struggle, frustration, or being stuck. Struggle can be explicit (\"this is so annoying\", \"I give up\") or implicit (repeated failed attempts, resignation, real confusion) -- but don't over-trigger on ordinary technical requests, neutral questions, or short acknowledgments. Be conservative: say false unless it's genuinely there.",
          },
          {
            role: "user",
            content: `Developer's message: "${prompt.slice(0, 500)}"\n\nDoes this reflect genuine struggle right now?`,
          },
        ],
        toolName: "judge_struggle",
        toolDescription: "Judge whether the message reflects genuine struggle or frustration.",
        parametersSchema,
        temperature: 0.2,
        maxTokens: 200,
      }
    );

    if (!parsed.is_struggling) {
      return { fired: false, score: parsed.confidence, detail: parsed.rationale };
    }
    return { fired: true, score: parsed.confidence, detail: parsed.rationale };
  } catch (err) {
    return { fired: false, score: 0, detail: `gloo_struggle_judgment_unavailable: ${(err as Error).message}` };
  }
}
