import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectStruggleViaGloo } from "../state/detectors.js";
import { evaluateAmbientPacing } from "../state/pacing.js";
import { loadSessionState, saveSessionState } from "../state/session-store.js";
import { runStruggleVisiblePipeline } from "../runtime/fail-closed.js";
import type { BetweenTurnsConfig } from "../types/config.js";
import { emitAdditionalContext, readHookInput } from "./shared/hook-io.js";
import { isEnabled } from "./shared/opt-in-gate.js";

/**
 * Struggle-moment trigger #2: genuine struggle in the prompt, judged by a
 * real Gloo call rather than phrase-matching (a fixed keyword list missed
 * quiet struggle with no lexical marker attached). This is also where
 * turn_counter advances -- once per user message, not once per tool call --
 * since a single message can involve many tool calls before the agent
 * replies, and pacing (plan §6) is meant to track conversational turns, not
 * raw tool-call volume.
 *
 * Pacing is checked *before* the Gloo call, not after: the old regex
 * detector was free to run on every message, so gating it behind pacing
 * afterward cost nothing. A real API call isn't free the same way -- if
 * pacing would reject a delivery anyway, there's no reason to pay for the
 * judgment call first, so the cheap local check runs first and the Gloo
 * call only happens on turns where a delivery is actually possible.
 *
 * Delivery is disclosed and attributed -- see the NOTE in post-tool-use.ts
 * on why the earlier verbatim/unattributed design was retired.
 */
async function main(): Promise<void> {
  const input = await readHookInput();

  if (!isEnabled(input.cwd)) {
    process.exit(0);
  }

  const config: BetweenTurnsConfig = JSON.parse(readFileSync(join(input.cwd, "between-turns.config.json"), "utf-8"));
  const state = loadSessionState(input.cwd, input.session_id);
  state.turn_counter += 1;

  if (!config.modes.ambient || !input.prompt) {
    saveSessionState(input.cwd, state);
    process.exit(0);
  }

  const pacingDecision = evaluateAmbientPacing(state, config, { type: "frustration" });
  if (!pacingDecision.allowed) {
    saveSessionState(input.cwd, state);
    process.exit(0);
  }

  const detection = await detectStruggleViaGloo(config, input.prompt);
  if (!detection.fired) {
    saveSessionState(input.cwd, state);
    process.exit(0);
  }

  const contextDescription = `The developer just wrote something that reads as genuine struggle: "${input.prompt.slice(0, 300)}"`;

  const outcome = await runStruggleVisiblePipeline(
    input.cwd,
    config,
    state,
    { type: "frustration", detail: detection.detail, score: detection.score },
    contextDescription,
    "UserPromptSubmit"
  );

  saveSessionState(input.cwd, state);

  if (outcome.available && outcome.source) {
    const context = [
      "[between-turns:visible-candidate] The developer sounds frustrated right now. You are permitted -- not obligated -- to reference this real, verified verse explicitly, in your own words, only if it's honest given what's actually happening:",
      `${outcome.source.reference_display}, ${outcome.source.translation}: "${outcome.source.verse_text}"`,
      `(Why this one was selected: ${outcome.source.selection_rationale})`,
    ].join("\n");
    emitAdditionalContext("UserPromptSubmit", context);
    return;
  }

  process.exit(0);
}

main();
