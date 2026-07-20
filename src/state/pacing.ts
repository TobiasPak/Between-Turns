import type { BetweenTurnsConfig } from "../types/config.js";
import type { SessionState } from "../types/session-state.js";

export interface PacingDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * There is no per-session cap here -- see plan §6. This only answers two
 * questions: is it too soon since the last delivery (a floor, not a
 * ceiling), and does this specific trigger look like a misfiring detector
 * rather than real distress (the same failure signature recurring right
 * after we already delivered for it).
 */
export function evaluateAmbientPacing(
  state: SessionState,
  config: BetweenTurnsConfig,
  trigger: { type: "stuck_loop" | "frustration"; errorSignature?: string }
): PacingDecision {
  const { pacing } = config;

  if (state.ambient.false_positive_backoff_until_turn !== null && state.turn_counter < state.ambient.false_positive_backoff_until_turn) {
    return { allowed: false, reason: "circuit_breaker_backoff_active" };
  }

  if (
    trigger.type === "stuck_loop" &&
    trigger.errorSignature &&
    state.ambient.stuck_loop_signature === trigger.errorSignature &&
    state.ambient.last_delivery_turn !== null &&
    state.turn_counter - state.ambient.last_delivery_turn < pacing.ambient_min_turns_between_deliveries
  ) {
    // Same failure, still recurring shortly after we already delivered for
    // it once -- that's a proxy for "didn't correlate with real recovery,"
    // not fresh distress. Escalate rather than just re-applying the floor.
    state.ambient.cooldown_strikes = Math.min(3, state.ambient.cooldown_strikes + 1);
    state.ambient.false_positive_backoff_until_turn =
      state.turn_counter + pacing.ambient_backoff_base_turns * 2 ** state.ambient.cooldown_strikes;
    return { allowed: false, reason: "recurring_signature_backoff" };
  }

  if (
    state.ambient.last_delivery_turn !== null &&
    state.turn_counter - state.ambient.last_delivery_turn < pacing.ambient_min_turns_between_deliveries
  ) {
    return { allowed: false, reason: "spacing_floor" };
  }

  return { allowed: true };
}

/**
 * recent_selections is shared across ambient AND visible delivery (plan §6)
 * -- repetition-avoidance applies regardless of mode. The ambient-specific
 * spacing/backoff fields, though, only make sense for ambient's repeated
 * mid-session triggers, so those only update when mode is "ambient".
 */
export function recordDelivery(
  state: SessionState,
  config: BetweenTurnsConfig,
  params: { osisRef: string; mode: "ambient" | "visible"; stuckLoopSignature?: string }
): void {
  if (params.mode === "ambient") {
    state.ambient.last_delivery_turn = state.turn_counter;
    if (params.stuckLoopSignature) {
      state.ambient.stuck_loop_signature = params.stuckLoopSignature;
    }
    // A real delivery is evidence the detector wasn't just noise -- reset the backoff.
    state.ambient.cooldown_strikes = 0;
    state.ambient.false_positive_backoff_until_turn = null;
  }

  state.recent_selections.push(params.osisRef);
  const overflow = state.recent_selections.length - config.pacing.repetition_window;
  if (overflow > 0) {
    state.recent_selections.splice(0, overflow);
  }
}

/** "Switch verses" concretely means: never offer something already in the recent window. */
export function excludeRecentSelections<T extends { osis_ref: string }>(candidates: T[], state: SessionState): T[] {
  const recent = new Set(state.recent_selections);
  return candidates.filter((c) => !recent.has(c.osis_ref));
}
