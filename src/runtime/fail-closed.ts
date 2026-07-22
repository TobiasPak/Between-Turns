import type { BetweenTurnsConfig } from "../types/config.js";
import { evaluateAmbientPacing, recordDelivery } from "../state/pacing.js";
import type { SessionState } from "../types/session-state.js";
import type { CandidateOffered, RetrievedScripture } from "../types/retrieved-scripture.js";
import { packageVisibleSourceMaterial, type VisibleSourceMaterial } from "./generation.js";
import { logRetrievedScripture } from "./logger.js";
import { retrieveCandidates, type RetrievalCandidate } from "./retrieval.js";
import { selectCandidate, type SelectionResult } from "./selection.js";

export interface TriggerInfo {
  type: "stuck_loop" | "frustration" | "session_close" | "pr_create";
  detail: string;
  score: number;
  errorSignature?: string;
}

/**
 * The staged suppression pipeline from plan §7. Steps 1-3 (opt-in, pacing,
 * detector-didn't-fire) are the caller's responsibility and are deliberately
 * NOT logged here -- they're not really "events," they're the common case
 * of nothing happening. Everything from retrieval onward either succeeds or
 * is logged as a suppressed RetrievedScripture event, so "fail-closed" is
 * provable from the log files, not just claimed.
 */
async function retrieveAndSelect(
  config: BetweenTurnsConfig,
  state: SessionState,
  contextDescription: string
): Promise<
  | { ok: true; candidates: RetrievalCandidate[]; selection: SelectionResult }
  | { ok: false; reason: "gloo_search_unavailable" | "no_candidates_above_threshold"; debugDetail?: string }
> {
  let candidates: RetrievalCandidate[];
  try {
    candidates = await retrieveCandidates(config, state, contextDescription);
  } catch (err) {
    return { ok: false, reason: "gloo_search_unavailable", debugDetail: (err as Error).message };
  }

  if (candidates.length === 0) {
    return { ok: false, reason: "no_candidates_above_threshold" };
  }

  const selection = await selectCandidate(config, contextDescription, candidates);
  return { ok: true, candidates, selection };
}

function candidatesOfferedLog(candidates: RetrievalCandidate[]): CandidateOffered[] {
  return candidates.map((c, i) => ({
    theme_id: c.theme_id,
    osis_ref: c.osis_ref,
    gloo_search_certainty: c.gloo_search_certainty,
    rank: i + 1,
  }));
}

function selectionLog(selection: SelectionResult, excludedAsRecent: string[]): RetrievedScripture["selection"] {
  return {
    selected_osis_ref: selection.selected.osis_ref,
    selection_method: selection.method,
    selection_rationale: selection.rationale,
    validation: { schema_valid: selection.schema_valid, id_in_candidate_set: selection.id_in_candidate_set },
    excluded_as_recent: excludedAsRecent,
  };
}

export interface VisibleOutcome {
  available: boolean;
  source: VisibleSourceMaterial | null;
}

/**
 * Shared core for every trigger now. There used to be a separate "ambient"
 * generation path that asked Claude to weave a line in verbatim, unattributed,
 * with no acknowledgment it was instructed -- a live Claude Code session
 * correctly identified that as a prompt-injection pattern and refused it.
 * Disclosed, attributed citation doesn't have that problem, so retrieval,
 * selection, and delivery are identical regardless of what triggered it;
 * only pacing (see the two exported wrappers below) differs by trigger type.
 */
async function deliverVisible(
  cwd: string,
  config: BetweenTurnsConfig,
  state: SessionState,
  trigger: TriggerInfo,
  contextDescription: string,
  deliveryHook: string,
  mode: "ambient" | "visible"
): Promise<VisibleOutcome> {
  const rs = await retrieveAndSelect(config, state, contextDescription);
  if (!rs.ok) {
    logRetrievedScripture(cwd, config, {
      session_id: state.session_id,
      mode,
      trigger: { type: trigger.type, detector_score: trigger.score, detail: trigger.detail },
      candidates_offered: [],
      selection: null,
      generation: null,
      delivery: { delivered: false, delivery_hook: deliveryHook, suppressed_reason: rs.reason, debug_detail: rs.debugDetail },
    });
    return { available: false, source: null };
  }

  const source = packageVisibleSourceMaterial(rs.selection.selected, rs.selection.rationale);
  recordDelivery(state, config, {
    osisRef: rs.selection.selected.osis_ref,
    mode,
    stuckLoopSignature: mode === "ambient" && trigger.type === "stuck_loop" ? trigger.errorSignature : undefined,
  });

  logRetrievedScripture(cwd, config, {
    session_id: state.session_id,
    mode,
    trigger: { type: trigger.type, detector_score: trigger.score, detail: trigger.detail },
    candidates_offered: candidatesOfferedLog(rs.candidates),
    selection: selectionLog(rs.selection, []),
    generation: {
      output_fragment: `${source.verse_text} -- ${source.reference_display}, ${source.translation}`,
      mode_constraints: { must_be_explicit: true, phrasing: "claude_authored", source_material_provided: true },
    },
    delivery: { delivered: true, delivery_hook: deliveryHook, suppressed_reason: null },
  });

  return { available: true, source };
}

/**
 * For repeatable, mid-session triggers (a stuck loop, frustrated language).
 * Unlike session-close/PR, these can fire many times in one session, so the
 * spacing floor and recurring-signature backoff from plan §6 still apply --
 * if anything, more conservatively than before: a disclosed citation is far
 * more noticeable than the old invisible tone-shift was ever meant to be,
 * so firing too often here reads as preachy in a way the old design didn't
 * risk in the same way.
 */
export async function runStruggleVisiblePipeline(
  cwd: string,
  config: BetweenTurnsConfig,
  state: SessionState,
  trigger: TriggerInfo,
  contextDescription: string,
  deliveryHook: string
): Promise<VisibleOutcome> {
  const pacingDecision = evaluateAmbientPacing(state, config, {
    type: trigger.type as "stuck_loop" | "frustration",
    errorSignature: trigger.errorSignature,
  });
  if (!pacingDecision.allowed) {
    return { available: false, source: null };
  }

  return deliverVisible(cwd, config, state, trigger, contextDescription, deliveryHook, "ambient");
}

/** No pacing cap here (plan §6) -- gated by real, naturally-rare events (session close, PR creation), not a spacing floor. */
export async function runVisiblePipeline(
  cwd: string,
  config: BetweenTurnsConfig,
  state: SessionState,
  trigger: TriggerInfo,
  contextDescription: string,
  deliveryHook: string
): Promise<VisibleOutcome> {
  return deliverVisible(cwd, config, state, trigger, contextDescription, deliveryHook, "visible");
}
