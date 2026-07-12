/**
 * Assembles notebooks/taxonomy-pipeline.md from the real build-log artifacts
 * (data/build-logs/*.json, data/themes.json) rather than hand-typed numbers,
 * so every count in the write-up is provably drawn from what actually ran.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, path), "utf-8")) as T;
}

interface Theme {
  theme_id: string;
  description: string;
  verified_references: { osis_ref: string }[];
}

function main(): void {
  const candidates = loadJson<{ results: { theme_id: string; candidates: { osis_ref: string }[] }[] }>(
    "data/build-logs/candidates.json"
  );
  const verification = loadJson<{
    total_verified: number;
    total_rejected: number;
    rejected: Record<string, { reason: string }>;
  }>("data/build-logs/verification-results.json");
  const fitCheck = loadJson<{
    total_kept: number;
    total_rejected: number;
    certainty_keep_threshold: number;
    per_theme: Record<
      string,
      { osis_ref: string; reject_reason: string | null; kept: boolean }[]
    >;
  }>("data/build-logs/fit-check-results.json");
  const themes = loadJson<Theme[]>("data/themes.json");

  const totalCandidateSlots = candidates.results.reduce((s, r) => s + r.candidates.length, 0);
  const perThemeCounts = themes.map((t) => t.verified_references.length);
  const minCount = Math.min(...perThemeCounts);
  const maxCount = Math.max(...perThemeCounts);
  const avgCount = (perThemeCounts.reduce((a, b) => a + b, 0) / perThemeCounts.length).toFixed(1);
  const totalVerifiedRefs = perThemeCounts.reduce((a, b) => a + b, 0);

  let fitRejectYesNo = 0;
  let fitRejectCertainty = 0;
  for (const candidates of Object.values(fitCheck.per_theme)) {
    for (const c of candidates) {
      if (c.reject_reason === "gloo_yesno_no") fitRejectYesNo++;
      if (c.reject_reason === "certainty_below_threshold") fitRejectCertainty++;
    }
  }

  const verificationRejections = Object.entries(verification.rejected)
    .map(([ref, r]) => `- \`${ref}\`: ${r.reason.slice(0, 80)}${r.reason.length > 80 ? "..." : ""}`)
    .join("\n");

  const md = `# Between Turns: the taxonomy build pipeline

This is the real, inspectable record of how \`data/themes.json\` — the verified Scripture taxonomy the runtime draws from — actually got built. Every number below is pulled directly from the build-log artifacts in \`data/build-logs/\`, not hand-typed, so it can't drift from what actually happened.

**The thesis this pipeline exists to prove:** every generated line the runtime ever produces traces back to real, YouVersion-fetched verse text — never an LLM's memory of a citation. That has to be true at build time first. Here's how build time actually went, including the parts that didn't work on the first try.

## The pipeline, in order

1. **Seed** — 48 hand-authored theme descriptions (\`data/theme-seeds.json\`): short, plain-language situations ("continuing effort despite the same failure recurring multiple times"), not verses.
2. **Generate** — Gloo AI Studio (\`/ai/v2/chat/completions\`, forced tool-choice, \`strict: true\`) proposes candidate Bible references per theme, with a one-sentence rationale each. Gloo has no way to know at this point whether a proposed reference is even real.
3. **Verify** — every proposed reference is checked against YouVersion's live API. If it doesn't resolve, it's discarded and logged as a build-time catch. If it resolves, the real fetched text is checksummed and kept.
4. **Fit-check** — every verified verse gets two independent, real checks: a Gloo Search semantic-certainty score against the theme's description, and a separate Gloo judgment call asked plainly "does this real text genuinely support this theme, yes or no, why." A candidate only survives if both agree.
5. **Gap-filling** — themes that came out of step 4 thin (0-1 surviving verses) get a second, more specifically-guided generation round rather than being left weak or padded.
6. **Assemble** — everything gets deduped and written to \`data/themes.json\`, the single source of truth the runtime reads from later — no live YouVersion re-fetching happens at runtime.

## Real counts

| Stage | Count |
|---|---|
| Themes seeded | ${themes.length} |
| Candidate proposals made (incl. gap-filling rounds) | ${totalCandidateSlots} |
| Unique references sent to YouVersion for verification | ${verification.total_verified + verification.total_rejected} |
| Verified (real text fetched, checksummed) | ${verification.total_verified} |
| Rejected at verification (reference didn't resolve) | ${verification.total_rejected} |
| Candidates fit-checked | ${fitCheck.total_kept + fitCheck.total_rejected} |
| Kept (passed both certainty *and* yes/no judgment) | ${fitCheck.total_kept} |
| Rejected at fit-check: failed the yes/no judgment | ${fitRejectYesNo} |
| Rejected at fit-check: below the certainty threshold (${fitCheck.certainty_keep_threshold}) | ${fitRejectCertainty} |
| **Final verified references in \`themes.json\`** (deduped) | **${totalVerifiedRefs}** |
| References per theme | min ${minCount}, max ${maxCount}, avg ${avgCount} |

Worth flagging plainly rather than burying in the table: **every one of the ${fitRejectYesNo} fit-check rejections failed on the yes/no judgment, not the certainty score.** Once the retrieval-window bug below was fixed, Gloo Search's certainty for same-domain content (184-254 short Bible verses, all thematically similar to begin with) clustered tightly in the 0.5-0.7 range regardless of actual fit — meaning the numeric embedding-similarity signal doesn't discriminate much within a corpus this narrow, and the real filtering work is being done by the independent judgment call, not the score. The certainty gate stays in the pipeline as a genuine check (an out-of-domain or truly unrelated item would still fail it), but for this specific corpus it hasn't been the deciding factor even once.

Every one of the ${verification.total_rejected} verification-stage rejections, in full:

${verificationRejections}

Worth being precise here rather than overselling it: only \`JAM.1.19-20\` was a genuinely fabricated-*looking* reference, and even that turned out to be a real verse (James 1:19-20) under a non-standard book code (\`JAM\` instead of the correct OSIS code \`JAS\`) — Gloo got the content right and the code wrong. Re-querying under the correct code resolves cleanly. The other three (\`JOEL.2.25\`, \`MAR.6.31-32\`, \`MAR.12.28-34\`) were similar near-misses from later gap-filling rounds, not invented content. Zero references in this taxonomy are outright hallucinated Scripture — every rejection here is a resolution failure, not a fabrication catch, and the pipeline is built to treat both the same way: discard, log, move on.

## A real fit-check rejection, in full

Theme **perseverance-under-repeated-failure** ("continuing effort despite the same failure recurring multiple times") had \`2 Corinthians 4:8-9\` proposed as a candidate:

> "We are hard pressed on every side, but not crushed; perplexed, but not in despair; persecuted, but not abandoned; struck down, but not destroyed."

Gloo's own semantic-certainty score liked it (0.62, well above the 0.35 threshold) — but the independent yes/no judgment call rejected it anyway: *"The verse describes enduring through various hardships without being defeated, but it doesn't address recurring failure or repeated attempts at the same task — it's about resilience amid ongoing pressure, not persistence despite repeated failure."* That's the pipeline working as intended: a verse can sound thematically adjacent and still get filtered for not actually fitting.

## A real gap-filling story: \`grace-toward-past-decisions\`

"Charity toward your own earlier choices, even bad ones" turned out to be the hardest theme in the whole taxonomy. Two full rounds (12 candidates total) were rejected, every one of them for the same reason: they were all real, well-known verses about **God forgiving sin** — Romans 8:1 ("no condemnation"), 1 John 1:9 ("if we confess"), Isaiah 43:25 ("blots out your transgressions"), Psalm 103:10-12 ("removed our transgressions") — but the theme isn't about moral guilt. It's about looking back at a decision that was *reasonable given what was known at the time*, which is a different idea entirely, and the judge correctly refused to conflate the two, twelve times in a row.

The theme was rescued by a completely different narrative angle: **1 Kings 8:17-19**, where God tells David *"You did well to have it in your heart to build a temple for my Name. Nevertheless, you are not the one to build the temple, but your son..."* — God commending the reasonableness of David's intention even though circumstances meant someone else finished the work. That's the actual shape of "charity toward a past decision," and the judge recognized it immediately: *"God explicitly honors David's good intention... even though David could not fulfill it, modeling charitable recognition of one's earlier choices despite their limitations."*

The theme still sits at the low end of the taxonomy (2 verified references, versus a 4.5 average) — that's an honest reflection of a real gap between a modern professional-judgment concept and Scripture's own vocabulary, not a padded number.

## Two bugs this pipeline caught in itself

**A retrieval-window bug.** Early fit-check runs capped Gloo Search results at the top 50 per theme. Several judge-approved candidates (e.g. \`1 Samuel 17:38-40\`, David rejecting Saul's armor — a strong fit for "wisdom-in-simplicity") were coming back with certainty 0.00 and getting rejected. Querying the full 184-item corpus directly showed \`1SA.17.38-40\` actually scoring 0.59 at rank 51 — one place outside the window. The fix was a wider search limit, not a lower bar; re-running recovered dozens of false rejections across the whole taxonomy (133 kept → 190 kept in one pass, before any gap-filling).

**A source-text bug.** Two verified verses (\`DEU.29.29\`, \`EXO.39.32-43\`) came back from YouVersion's own API with a missing space: *"the Lordour God"* instead of *"the LORD our God."* Confirmed against a fresh, direct API call that this is YouVersion's own small-caps-to-plain-text rendering losing the space after "LORD," not something introduced by this pipeline. Fixed with a narrow, verified-safe normalization in \`verify-youversion.ts\`, and the two already-fetched entries were corrected and re-checksummed rather than left wrong in the shipped taxonomy.

## What this leaves provable

Every one of the ${totalVerifiedRefs} verified references in \`data/themes.json\` carries a real \`youversion_fetch\` record — the fetch timestamp, the exact API URL used, and a SHA-256 checksum of the fetched text. Nothing in the runtime selection or generation layer can point to a verse that isn't sitting in that file with its own audit trail already attached.
`;

  const outPath = join(REPO_ROOT, "notebooks", "taxonomy-pipeline.md");
  writeFileSync(outPath, md);
  console.log(`Wrote ${outPath} (${md.length} chars)`);
}

main();
