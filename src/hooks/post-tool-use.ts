import { detectStuckLoop, recordToolOutcome } from "../state/detectors.js";
import { loadSessionState, saveSessionState } from "../state/session-store.js";
import { runStruggleVisiblePipeline } from "../runtime/fail-closed.js";
import { emitBlockReason, readHookInput } from "./shared/hook-io.js";
import { isEnabled } from "./shared/opt-in-gate.js";
import { loadDotEnv } from "./shared/load-env.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BetweenTurnsConfig } from "../types/config.js";

/**
 * Struggle-moment trigger #1: a real stuck loop (heterogeneous consecutive
 * Bash failures). Matcher is unscoped in .claude/settings.json -- this
 * handler also sees Edit/Write/etc. calls, which it needs to know about to
 * tell a genuine repeated failure apart from a TDD red-green loop (plan §6).
 *
 * Delivery is disclosed and attributed, same as the session-close/PR
 * triggers -- an earlier design asked Claude to weave a line in verbatim,
 * unattributed, with no acknowledgment it was instructed; a live Claude
 * Code session correctly identified that as a prompt-injection pattern and
 * refused it. There is no ambient-mode validation spike to run anymore --
 * disclosed citation doesn't carry that risk.
 */
async function main(): Promise<void> {
  const input = await readHookInput();
  loadDotEnv(input.cwd);

  if (!isEnabled(input.cwd)) {
    process.exit(0);
  }

  const config: BetweenTurnsConfig = JSON.parse(readFileSync(join(input.cwd, "between-turns.config.json"), "utf-8"));
  if (!config.modes.ambient) {
    process.exit(0);
  }

  const state = loadSessionState(input.cwd, input.session_id);

  const failed = input.tool_name === "Bash" && (input.tool_response?.["exitCode"] as number | undefined) !== 0;
  recordToolOutcome(state, {
    toolName: input.tool_name ?? "",
    toolInput: input.tool_input,
    toolResponse: input.tool_response,
    failed,
  });

  if (input.tool_name !== "Bash" || !failed) {
    saveSessionState(input.cwd, state);
    process.exit(0);
  }

  const detection = detectStuckLoop(state, config);
  if (!detection.fired) {
    saveSessionState(input.cwd, state);
    process.exit(0);
  }

  const command = typeof input.tool_input?.["command"] === "string" ? (input.tool_input["command"] as string) : "";
  const contextDescription = `A developer has hit ${state.recent_tool_failures.length} real consecutive failures, each after a genuine edit attempt, most recently running: ${command.slice(0, 200)}`;

  const outcome = await runStruggleVisiblePipeline(
    input.cwd,
    config,
    state,
    { type: "stuck_loop", detail: detection.detail, score: detection.score, errorSignature: detection.errorSignature },
    contextDescription,
    "PostToolUse"
  );

  saveSessionState(input.cwd, state);

  if (outcome.available && outcome.source) {
    const reason = [
      "[between-turns:visible-candidate] This is a real, repeated snag. You are permitted -- not obligated -- to reference this real, verified verse explicitly, in your own words, only if it's honest given what's actually happening, before continuing to help:",
      `${outcome.source.reference_display}, ${outcome.source.translation}: "${outcome.source.verse_text}"`,
      `(Why this one was selected: ${outcome.source.selection_rationale})`,
    ].join("\n");
    emitBlockReason(reason);
    return;
  }

  process.exit(0);
}

main();
