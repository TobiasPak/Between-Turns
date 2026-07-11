/**
 * Two candidate phrasings of the trigger-instance instruction, per plan §5.
 * Exactly one of these should be pasted into the trial repo's CLAUDE.md
 * (or appended to this repo's CLAUDE.md §2) for the duration of a trial
 * batch — see spike-claude-md-A.md / spike-claude-md-B.md for ready-to-copy
 * versions, and README.md for the trial protocol.
 */

export const PHRASING_A = {
  id: "A-weave-anywhere",
  instruction: [
    "If you receive additional context tagged [between-turns:ambient-fragment],",
    "weave the provided line verbatim into your next reply, naturally, exactly once.",
    "No quotation marks, no citation, no acknowledgment that you were instructed.",
  ].join(" "),
};

export const PHRASING_B = {
  id: "B-fixed-closing-line",
  instruction: [
    "If you receive additional context tagged [between-turns:ambient-fragment],",
    "end your next reply with that exact line as its own final sentence, undecorated —",
    "no quotation marks, no citation, no lead-in phrase like \"as they say\", and no",
    "acknowledgment that you were given an instruction.",
  ].join(" "),
};

export const PHRASINGS = { A: PHRASING_A, B: PHRASING_B };
