export type Mode = "ambient" | "visible";

export interface CandidateOffered {
  theme_id: string;
  osis_ref: string;
  gloo_search_certainty: number;
  rank: number;
}

export interface RetrievedScripture {
  event_id: string;
  session_id: string;
  mode: Mode;
  trigger: {
    type: string;
    detector_score: number;
    detail: string;
  };
  candidates_offered: CandidateOffered[];
  selection: {
    selected_osis_ref: string;
    selection_method: string;
    selection_rationale: string;
    validation: { schema_valid: boolean; id_in_candidate_set: boolean };
    excluded_as_recent: string[];
  } | null;
  generation: {
    output_fragment: string;
    mode_constraints: Record<string, unknown>;
  } | null;
  delivery: {
    delivered: boolean;
    delivery_hook: string;
    suppressed_reason: string | null;
  };
}
