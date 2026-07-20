import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSessionState, saveSessionState } from "../state/session-store.js";
import { runVisiblePipeline } from "../runtime/fail-closed.js";
import type { BetweenTurnsConfig } from "../types/config.js";
import { emitBlockReason, readHookInput } from "./shared/hook-io.js";
import { isEnabled } from "./shared/opt-in-gate.js";

// A trivial one-or-two-message exchange doesn't warrant a debrief -- wait
// for a session with some real back-and-forth before the first attempt.
const SIGNIFICANCE_MIN_TURNS = 3;

// A session can genuinely "close" more than once (Stop fires after every
// turn, and a real conversation can pause and resume many times) -- this is
// a spacing floor between debrief attempts, not a hard one-time lock, and it
// only counts from a *successful* prior debrief (see below). This is
// deliberately separate from the stop_hook_active guard, which is about not
// forcing a second continuation on the *same* stop event.
const DEBRIEF_MIN_TURNS_BETWEEN = 10;

async function main(): Promise<void> {
  const input = await readHookInput();

  if (!isEnabled(input.cwd)) {
    process.exit(0);
  }

  if (input.stop_hook_active) {
    process.exit(0);
  }

  const config: BetweenTurnsConfig = JSON.parse(readFileSync(join(input.cwd, "between-turns.config.json"), "utf-8"));
  if (!config.modes.visible) {
    process.exit(0);
  }

  const state = loadSessionState(input.cwd, input.session_id);

  const tooSoonSinceLastDebrief =
    state.visible.last_debrief_turn !== null && state.turn_counter - state.visible.last_debrief_turn < DEBRIEF_MIN_TURNS_BETWEEN;
  if (tooSoonSinceLastDebrief || state.turn_counter < SIGNIFICANCE_MIN_TURNS) {
    process.exit(0);
  }

  const contextDescription = `A coding session is concluding after ${state.turn_counter} turns of real back-and-forth work.`;

  const outcome = await runVisiblePipeline(
    input.cwd,
    config,
    state,
    { type: "session_close", detail: `session ending after ${state.turn_counter} turns`, score: 1 },
    contextDescription,
    "Stop"
  );

  // Only a *successful* debrief starts the spacing floor -- a suppressed or
  // failed attempt (e.g. a real infrastructure error) never costs the
  // session its next real chance, unlike the old one-time lock did.
  if (outcome.available && outcome.source) {
    state.visible.last_debrief_turn = state.turn_counter;
  }
  saveSessionState(input.cwd, state);

  if (outcome.available && outcome.source) {
    const reason = [
      "[between-turns:visible-candidate] The session is ending. You are permitted -- not obligated -- to close explicitly, citing this real, verified verse in your own words, only if it's honest given what actually happened this session:",
      `${outcome.source.reference_display}, ${outcome.source.translation}: "${outcome.source.verse_text}"`,
      `(Why this one was selected: ${outcome.source.selection_rationale})`,
    ].join("\n");
    emitBlockReason(reason);
    return;
  }

  process.exit(0);
}

main();
