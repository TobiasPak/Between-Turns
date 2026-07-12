import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ThemeSeed } from "../types/theme-seed.js";
import type { Theme, CandidateVerseConsidered, VerifiedReference, RejectedAtBuild } from "../types/theme.js";

const REPO_ROOT = process.cwd();

interface CandidatesFile {
  results: { theme_id: string; candidates: { osis_ref: string; rationale: string }[] }[];
}
interface VerificationResults {
  verified: Record<string, { reference_display: string; verse_text: string; youversion_fetch: VerifiedReference["youversion_fetch"] }>;
  rejected: Record<string, { reason: string }>;
}
interface FitCheckedCandidate {
  osis_ref: string;
  reference_display: string;
  verse_text: string;
  youversion_fetch: VerifiedReference["youversion_fetch"];
  fit_score: number;
  gloo_search_certainty: number;
  gloo_yesno_verdict: "yes" | "no";
  gloo_yesno_rationale: string;
  kept: boolean;
  reject_reason: string | null;
}
interface FitCheckResultsFile {
  certainty_keep_threshold: number;
  per_theme: Record<string, FitCheckedCandidate[]>;
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function main(): void {
  const themeSeeds = loadJson<ThemeSeed[]>(join(REPO_ROOT, "data", "theme-seeds.json"));
  const candidatesFile = loadJson<CandidatesFile>(join(REPO_ROOT, "data", "build-logs", "candidates.json"));
  const verification = loadJson<VerificationResults>(join(REPO_ROOT, "data", "build-logs", "verification-results.json"));
  const fitCheck = loadJson<FitCheckResultsFile>(join(REPO_ROOT, "data", "build-logs", "fit-check-results.json"));

  const candidatesByTheme = new Map(candidatesFile.results.map((r) => [r.theme_id, r.candidates]));

  const themes: Theme[] = [];
  let grandTotalProposed = 0;
  let grandTotalVerified = 0;

  for (const seed of themeSeeds) {
    const proposedCandidates = candidatesByTheme.get(seed.theme_id) ?? [];
    const fitChecked = fitCheck.per_theme[seed.theme_id] ?? [];

    // candidate_verses_considered: dedupe by osis_ref, status from verification stage.
    const seenRefs = new Set<string>();
    const candidateVersesConsidered: CandidateVerseConsidered[] = [];
    for (const c of proposedCandidates) {
      if (seenRefs.has(c.osis_ref)) continue;
      seenRefs.add(c.osis_ref);
      candidateVersesConsidered.push({
        osis_ref: c.osis_ref,
        proposed_by: "gloo-candidate-gen",
        status: verification.verified[c.osis_ref] ? "verified" : "rejected_at_build",
      });
    }

    // verified_references: dedupe by osis_ref, first kept occurrence wins.
    const verifiedRefs: VerifiedReference[] = [];
    const seenVerified = new Set<string>();
    for (const c of fitChecked) {
      if (!c.kept || seenVerified.has(c.osis_ref)) continue;
      seenVerified.add(c.osis_ref);
      verifiedRefs.push({
        osis_ref: c.osis_ref,
        reference_display: c.reference_display,
        translation: "NIV",
        verse_text: c.verse_text,
        youversion_fetch: c.youversion_fetch,
        fit_score: c.fit_score,
        gloo_search_certainty: c.gloo_search_certainty,
        gloo_yesno_verdict: c.gloo_yesno_verdict,
        gloo_yesno_rationale: c.gloo_yesno_rationale,
      });
    }

    // rejected_at_build: verification-stage rejections (unresolvable refs) + fit-check-stage rejections, deduped.
    const rejectedAtBuild: RejectedAtBuild[] = [];
    const seenRejected = new Set<string>();
    for (const c of proposedCandidates) {
      if (verification.rejected[c.osis_ref] && !seenRejected.has(c.osis_ref)) {
        seenRejected.add(c.osis_ref);
        rejectedAtBuild.push({
          osis_ref: c.osis_ref,
          stage: "verification",
          reason: verification.rejected[c.osis_ref]!.reason,
        });
      }
    }
    for (const c of fitChecked) {
      if (!c.kept && !seenRejected.has(c.osis_ref)) {
        seenRejected.add(c.osis_ref);
        rejectedAtBuild.push({
          osis_ref: c.osis_ref,
          stage: "fit_check",
          reason: c.reject_reason ?? "unknown",
          value: c.gloo_search_certainty,
          threshold: fitCheck.certainty_keep_threshold,
        });
      }
    }

    themes.push({
      theme_id: seed.theme_id,
      description: seed.description,
      candidate_verses_considered: candidateVersesConsidered,
      verified_references: verifiedRefs,
      rejected_at_build: rejectedAtBuild,
      build_metadata: {
        generated_at: new Date().toISOString(),
        total_candidates_proposed: candidateVersesConsidered.length,
        total_verified: verifiedRefs.length,
      },
    });

    grandTotalProposed += candidateVersesConsidered.length;
    grandTotalVerified += verifiedRefs.length;
  }

  const outPath = join(REPO_ROOT, "data", "themes.json");
  writeFileSync(outPath, JSON.stringify(themes, null, 2));

  const zeroVerified = themes.filter((t) => t.verified_references.length === 0);
  const thin = themes.filter((t) => t.verified_references.length === 1);

  console.log(`Wrote ${outPath}`);
  console.log(`Themes: ${themes.length}`);
  console.log(`Total unique candidates considered: ${grandTotalProposed}`);
  console.log(`Total verified references across taxonomy: ${grandTotalVerified}`);
  console.log(`Themes with zero verified references: ${zeroVerified.length}`);
  console.log(`Themes with exactly one verified reference: ${thin.length}${thin.length ? " -> " + thin.map((t) => t.theme_id).join(", ") : ""}`);
}

main();
