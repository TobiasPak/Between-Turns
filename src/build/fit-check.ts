import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BetweenTurnsConfig } from "../types/config.js";
import type { ThemeSeed } from "../types/theme-seed.js";
import { chatCompletionsForcedTool, glooSearch } from "../runtime/gloo-client.js";
import { ingestTextItem } from "./gloo-ingest.js";
import type { VerifiedVerse } from "./verify-youversion.js";

const REPO_ROOT = process.cwd();
const MODEL = "gloo-anthropic-claude-sonnet-4.5";
// Must cover the full ingested corpus -- a lower limit silently truncates the
// ranked list and produces false "not found" (certainty 0) results for
// anything ranked below the cutoff, which is a windowing artifact, not a
// genuine low-relevance signal (confirmed empirically: 1SA.17.38-40 scored
// 0.59 at rank 51, falsely reading as 0.00 under a limit of 50).
const SEARCH_QUERY_LIMIT = 250;
const SEARCH_QUERY_CERTAINTY_FLOOR = 0.01;
const CERTAINTY_KEEP_THRESHOLD = 0.35;
const DELAY_MS = 120;

interface CandidatesFile {
  results: { theme_id: string; candidates: { osis_ref: string; rationale: string }[] }[];
}

interface VerificationResults {
  verified: Record<string, VerifiedVerse>;
  rejected: Record<string, { reason: string }>;
}

interface FitCheckedCandidate {
  osis_ref: string;
  reference_display: string;
  verse_text: string;
  youversion_fetch: VerifiedVerse["youversion_fetch"];
  fit_score: number;
  gloo_search_certainty: number;
  gloo_yesno_verdict: "yes" | "no";
  gloo_yesno_rationale: string;
  kept: boolean;
  reject_reason: string | null;
}

function loadConfig(): BetweenTurnsConfig {
  return JSON.parse(readFileSync(join(REPO_ROOT, "between-turns.config.json"), "utf-8"));
}
function loadThemeSeeds(): ThemeSeed[] {
  return JSON.parse(readFileSync(join(REPO_ROOT, "data", "theme-seeds.json"), "utf-8"));
}
function loadCandidates(): CandidatesFile {
  return JSON.parse(readFileSync(join(REPO_ROOT, "data", "build-logs", "candidates.json"), "utf-8"));
}
function loadVerification(): VerificationResults {
  return JSON.parse(readFileSync(join(REPO_ROOT, "data", "build-logs", "verification-results.json"), "utf-8"));
}

function sanitize(osisRef: string): string {
  return osisRef.replace(/[.\-]/g, "_");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ingestAllVerifiedVerses(
  config: BetweenTurnsConfig,
  verified: Record<string, VerifiedVerse>
): Promise<void> {
  const refs = Object.keys(verified);
  console.log(`Ingesting ${refs.length} verified verses into Gloo (publisher: ${config.gloo.publisher_id})...`);
  for (const ref of refs) {
    const verse = verified[ref]!;
    const filename = `${sanitize(ref)}.txt`;
    process.stdout.write(`  ${filename}... `);
    try {
      const result = await ingestTextItem(config, {
        filename,
        content: verse.verse_text,
        producerId: sanitize(ref),
      });
      console.log(result.duplicates.length ? "duplicate (already ingested)" : "queued");
    } catch (err) {
      console.log(`FAILED: ${(err as Error).message}`);
    }
    await sleep(DELAY_MS);
  }
}

async function searchCertaintyMap(config: BetweenTurnsConfig, query: string): Promise<Map<string, number>> {
  const result = await glooSearch(config, {
    query,
    limit: SEARCH_QUERY_LIMIT,
    certainty: SEARCH_QUERY_CERTAINTY_FLOOR,
  });
  const map = new Map<string, number>();
  for (const item of result.data) {
    const filename = item.properties["filename"] as string | undefined;
    if (filename) {
      map.set(filename, item.metadata.certainty);
    }
  }
  return map;
}

async function yesNoVerdict(
  config: BetweenTurnsConfig,
  theme: ThemeSeed,
  verse: VerifiedVerse
): Promise<{ verdict: "yes" | "no"; rationale: string }> {
  const parametersSchema = {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["yes", "no"] },
      rationale: { type: "string", description: "One sentence explaining the verdict." },
    },
    required: ["verdict", "rationale"],
    additionalProperties: false,
  };

  const { parsed } = await chatCompletionsForcedTool<{ verdict: "yes" | "no"; rationale: string }>(config, {
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You judge, briefly and honestly, whether a real Bible verse text genuinely supports a given theme. Say no if the connection is a stretch or only superficial, even if the verse sounds vaguely related.",
      },
      {
        role: "user",
        content: `Theme: "${theme.description}"\nVerse text (${verse.reference_display}): "${verse.verse_text}"\nDoes this verse genuinely support the theme? Answer yes or no with a brief one-sentence rationale.`,
      },
    ],
    toolName: "judge_fit",
    toolDescription: "Judge whether the real verse text genuinely supports the theme.",
    parametersSchema,
    temperature: 0.3,
    maxTokens: 300,
  });

  return parsed;
}

interface FitCheckResultsFile {
  checked_at: string;
  model: string;
  certainty_keep_threshold: number;
  total_kept: number;
  total_rejected: number;
  per_theme: Record<string, FitCheckedCandidate[]>;
}

/**
 * Re-runs only the Gloo Search certainty step against already-ingested
 * content, reusing the existing yes/no verdicts on disk. For correcting a
 * retrieval-window bug (see SEARCH_QUERY_LIMIT comment) without re-spending
 * ~239 LLM judge calls that didn't need to change.
 */
async function recomputeCertaintyOnly(config: BetweenTurnsConfig, themes: ThemeSeed[]): Promise<void> {
  const outPath = join(REPO_ROOT, "data", "build-logs", "fit-check-results.json");
  const existing: FitCheckResultsFile = JSON.parse(readFileSync(outPath, "utf-8"));
  const themeById = new Map(themes.map((t) => [t.theme_id, t]));

  let totalKept = 0;
  let totalRejected = 0;

  for (const [themeId, candidates] of Object.entries(existing.per_theme)) {
    const theme = themeById.get(themeId);
    if (!theme) continue;

    console.log(`\n${themeId}`);
    const certaintyMap = await searchCertaintyMap(config, theme.description);
    await sleep(DELAY_MS);

    for (const c of candidates) {
      const filename = `${sanitize(c.osis_ref)}.txt`;
      const certainty = certaintyMap.get(filename) ?? 0;
      c.fit_score = certainty;
      c.gloo_search_certainty = certainty;
      c.kept = c.gloo_yesno_verdict === "yes" && certainty >= CERTAINTY_KEEP_THRESHOLD;
      c.reject_reason = c.kept ? null : c.gloo_yesno_verdict === "no" ? "gloo_yesno_no" : "certainty_below_threshold";

      if (c.kept) totalKept++;
      else totalRejected++;

      console.log(
        `  ${c.osis_ref}: certainty=${certainty.toFixed(2)} yesno=${c.gloo_yesno_verdict} -> ${
          c.kept ? "KEEP" : "reject (" + c.reject_reason + ")"
        }`
      );
    }

    writeFileSync(
      outPath,
      JSON.stringify(
        { ...existing, checked_at: new Date().toISOString(), total_kept: totalKept, total_rejected: totalRejected },
        null,
        2
      )
    );
  }

  console.log(`\nDone (recompute). ${totalKept} kept, ${totalRejected} rejected at fit-check.`);
  console.log(`Output: ${outPath}`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const themes = loadThemeSeeds();

  if (process.env["BT_RECOMPUTE_CERTAINTY_ONLY"]) {
    await recomputeCertaintyOnly(config, themes);
    return;
  }

  let candidatesFile = loadCandidates();
  const verification = loadVerification();

  const limit = process.argv[2] ? Number(process.argv[2]) : undefined;
  if (limit) {
    candidatesFile = { results: candidatesFile.results.slice(0, limit) };
  }

  if (!process.env["BT_SKIP_INGEST"]) {
    await ingestAllVerifiedVerses(config, verification.verified);
    console.log("\nWaiting 20s for Gloo indexing to catch up...");
    await sleep(20_000);
  } else {
    console.log("Skipping ingestion (BT_SKIP_INGEST set) -- assuming verses already indexed from a prior run.");
  }

  const outPath = join(REPO_ROOT, "data", "build-logs", "fit-check-results.json");
  const themeById = new Map(themes.map((t) => [t.theme_id, t]));
  const perTheme: Record<string, FitCheckedCandidate[]> = {};
  let totalKept = 0;
  let totalRejected = 0;

  const writeResults = (): void => {
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          checked_at: new Date().toISOString(),
          model: MODEL,
          certainty_keep_threshold: CERTAINTY_KEEP_THRESHOLD,
          total_kept: totalKept,
          total_rejected: totalRejected,
          per_theme: perTheme,
        },
        null,
        2
      )
    );
  };

  for (const themeResult of candidatesFile.results) {
    const theme = themeById.get(themeResult.theme_id);
    if (!theme) continue;

    console.log(`\n${theme.theme_id}`);
    const certaintyMap = await searchCertaintyMap(config, theme.description);
    await sleep(DELAY_MS);

    const checked: FitCheckedCandidate[] = [];
    for (const candidate of themeResult.candidates) {
      const verse = verification.verified[candidate.osis_ref];
      if (!verse) {
        continue; // was rejected at the verification stage already (e.g. JAM.1.19-20)
      }

      const filename = `${sanitize(candidate.osis_ref)}.txt`;
      const certainty = certaintyMap.get(filename) ?? 0;

      let yesno: { verdict: "yes" | "no"; rationale: string };
      try {
        yesno = await yesNoVerdict(config, theme, verse);
      } catch (err) {
        yesno = { verdict: "no", rationale: `fit-check call failed: ${(err as Error).message}` };
      }
      await sleep(DELAY_MS);

      const kept = yesno.verdict === "yes" && certainty >= CERTAINTY_KEEP_THRESHOLD;
      const rejectReason = kept
        ? null
        : yesno.verdict === "no"
        ? "gloo_yesno_no"
        : "certainty_below_threshold";

      checked.push({
        osis_ref: candidate.osis_ref,
        reference_display: verse.reference_display,
        verse_text: verse.verse_text,
        youversion_fetch: verse.youversion_fetch,
        fit_score: certainty,
        gloo_search_certainty: certainty,
        gloo_yesno_verdict: yesno.verdict,
        gloo_yesno_rationale: yesno.rationale,
        kept,
        reject_reason: rejectReason,
      });

      if (kept) totalKept++;
      else totalRejected++;

      process.stdout.write(
        `  ${candidate.osis_ref}: certainty=${certainty.toFixed(2)} yesno=${yesno.verdict} -> ${
          kept ? "KEEP" : "reject (" + rejectReason + ")"
        }\n`
      );
    }

    perTheme[theme.theme_id] = checked;
    writeResults();
  }

  console.log(`\nDone. ${totalKept} kept, ${totalRejected} rejected at fit-check.`);
  console.log(`Output: ${outPath}`);
}

main();
