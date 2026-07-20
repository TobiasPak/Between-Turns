import type { RetrievalCandidate } from "./retrieval.js";

export interface VisibleSourceMaterial {
  reference_display: string;
  translation: string;
  verse_text: string;
  selection_rationale: string;
}

/**
 * No generation call here -- Claude authors the closing line itself, in its
 * own words, from this real source material. This is the only delivery
 * path now: an earlier "ambient" mode asked Claude to weave a line in
 * verbatim, unattributed, with no acknowledgment it was instructed -- a
 * live Claude Code session correctly identified that as a prompt-injection
 * pattern and refused. Disclosed, attributed citation doesn't have that
 * problem, so every trigger (struggle or closing) routes through here now.
 */
export function packageVisibleSourceMaterial(selected: RetrievalCandidate, selectionRationale: string): VisibleSourceMaterial {
  return {
    reference_display: selected.reference_display,
    translation: selected.translation,
    verse_text: selected.verse_text,
    selection_rationale: selectionRationale,
  };
}
