export interface CandidateVerseConsidered {
  osis_ref: string;
  proposed_by: string;
  status: "verified" | "rejected_at_build";
}

export interface VerifiedReference {
  osis_ref: string;
  reference_display: string;
  translation: string;
  verse_text: string;
  youversion_fetch: {
    fetched_at: string;
    source_url: string;
    checksum: string;
  };
  fit_score: number;
  gloo_search_certainty: number;
  gloo_yesno_verdict: "yes" | "no";
  gloo_yesno_rationale: string;
  human_spot_check?: {
    checked: boolean;
    checked_by: string;
    verdict: "approved" | "rejected";
    notes?: string;
  };
}

export interface RejectedAtBuild {
  osis_ref: string;
  stage: "verification" | "fit_check";
  reason: string;
  value?: number;
  threshold?: number;
}

export interface Theme {
  theme_id: string;
  description: string;
  candidate_verses_considered: CandidateVerseConsidered[];
  verified_references: VerifiedReference[];
  rejected_at_build: RejectedAtBuild[];
  build_metadata: {
    generated_at: string;
    total_candidates_proposed: number;
    total_verified: number;
  };
}
