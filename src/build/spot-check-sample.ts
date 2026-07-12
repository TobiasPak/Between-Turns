import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Theme } from "../types/theme.js";

const REPO_ROOT = process.cwd();
const SAMPLE_RATE = 0.15;

interface SampleEntry {
  theme_id: string;
  theme_description: string;
  osis_ref: string;
  reference_display: string;
  verse_text: string;
  gloo_yesno_rationale: string;
  human_verdict: "approved" | "rejected" | null;
  human_notes: string;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function main(): void {
  const themes: Theme[] = JSON.parse(readFileSync(join(REPO_ROOT, "data", "themes.json"), "utf-8"));

  const allVerified: SampleEntry[] = [];
  for (const theme of themes) {
    for (const v of theme.verified_references) {
      allVerified.push({
        theme_id: theme.theme_id,
        theme_description: theme.description,
        osis_ref: v.osis_ref,
        reference_display: v.reference_display,
        verse_text: v.verse_text,
        gloo_yesno_rationale: v.gloo_yesno_rationale,
        human_verdict: null,
        human_notes: "",
      });
    }
  }

  const sampleSize = Math.round(allVerified.length * SAMPLE_RATE);
  const sample = shuffle(allVerified).slice(0, sampleSize);
  sample.sort((a, b) => a.theme_id.localeCompare(b.theme_id));

  const jsonPath = join(REPO_ROOT, "data", "build-logs", "spot-check-sample.json");
  writeFileSync(jsonPath, JSON.stringify(sample, null, 2));

  const md = [
    `# Spot-check sample (${sample.length}/${allVerified.length} verified references, ${(SAMPLE_RATE * 100).toFixed(0)}%)`,
    "",
    "For each entry: read the theme description and the real verse text, and judge for yourself whether it genuinely fits -- independent of Gloo's own rationale below. Record your verdict in `spot-check-sample.json` (`human_verdict`: `\"approved\"` or `\"rejected\"`, plus `human_notes`), then re-run `build-taxonomy.ts` to fold verdicts back into `themes.json` if you add that step.",
    "",
    ...sample.map(
      (s, i) =>
        `## ${i + 1}. ${s.theme_id}\n\n**Theme:** ${s.theme_description}\n\n**Verse (${s.reference_display}):** "${s.verse_text}"\n\n**Gloo's rationale:** ${s.gloo_yesno_rationale}\n\n**Your verdict:** ___________\n`
    ),
  ].join("\n");

  const mdPath = join(REPO_ROOT, "data", "build-logs", "spot-check-sample.md");
  writeFileSync(mdPath, md);

  console.log(`Sampled ${sample.length} of ${allVerified.length} verified references (${(SAMPLE_RATE * 100).toFixed(0)}%).`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`Readable review sheet: ${mdPath}`);
}

main();
