/**
 * Runs the full generate -> verify -> fit-check pipeline for a specific set
 * of brand-new theme_ids not yet present in the build-log files, merging
 * results into candidates.json / verification-results.json /
 * fit-check-results.json safely (creating a new entry per theme rather than
 * assuming one already exists, which is what regenerate-theme-candidates.ts
 * assumes and would crash on for a theme it's never seen before).
 *
 * Usage: tsx src/build/add-new-themes.ts <theme_id> [theme_id ...]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BetweenTurnsConfig } from "../types/config.js";
import type { ThemeSeed } from "../types/theme-seed.js";
import { chatCompletionsForcedTool, glooSearch } from "../runtime/gloo-client.js";
import { ingestTextItem } from "./gloo-ingest.js";
import { fixYouVersionText } from "./youversion-text-fixes.js";

const REPO_ROOT = process.cwd();
const MODEL = "gloo-anthropic-claude-sonnet-4.5";
const NIV_VERSION_ID = 111;
const CANDIDATES_PER_THEME = 5;
const SEARCH_QUERY_LIMIT = 250;
const SEARCH_QUERY_CERTAINTY_FLOOR = 0.01;
const CERTAINTY_KEEP_THRESHOLD = 0.35;
const DELAY_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function sanitize(osisRef: string): string {
  return osisRef.replace(/[.\-]/g, "_");
}
function loadConfig(): BetweenTurnsConfig {
  return JSON.parse(readFileSync(join(REPO_ROOT, "between-turns.config.json"), "utf-8"));
}

interface CandidateProposal {
  osis_ref: string;
  rationale: string;
}

async function generateForTheme(config: BetweenTurnsConfig, theme: ThemeSeed): Promise<CandidateProposal[]> {
  const parametersSchema = {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        minItems: CANDIDATES_PER_THEME,
        maxItems: CANDIDATES_PER_THEME,
        items: {
          type: "object",
          properties: {
            osis_ref: { type: "string", description: "OSIS/USFM ref, e.g. ROM.5.3-4 or JHN.3.16." },
            rationale: { type: "string" },
          },
          required: ["osis_ref", "rationale"],
          additionalProperties: false,
        },
      },
    },
    required: ["candidates"],
    additionalProperties: false,
  };

  const { parsed } = await chatCompletionsForcedTool<{ candidates: CandidateProposal[] }>(config, {
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You propose real, well-known Bible verse or short-passage references that genuinely fit a given theme, for a downstream pipeline that will independently verify every reference against a licensed Bible API and discard anything that doesn't resolve or doesn't hold up on review. Use OSIS/USFM book codes (three letters), chapter.verse format, hyphenated ranges for passages, no spaces.",
      },
      {
        role: "user",
        content: `Theme: "${theme.description}"\nExample contexts: ${theme.example_contexts.join("; ")}.\nPropose ${CANDIDATES_PER_THEME} distinct real Bible verse or short-passage references that fit this theme, each with a one-sentence rationale.`,
      },
    ],
    toolName: "propose_candidates",
    toolDescription: "Propose candidate Bible verse references for the given theme.",
    parametersSchema,
    temperature: 0.8,
    maxTokens: 1200,
  });

  return parsed.candidates;
}

interface VerifiedVerse {
  osis_ref: string;
  reference_display: string;
  verse_text: string;
  youversion_fetch: { fetched_at: string; source_url: string; checksum: string };
}

async function verifyRef(apiKey: string, osisRef: string): Promise<{ ok: true; verse: VerifiedVerse } | { ok: false; reason: string }> {
  const url = `https://api.youversion.com/v1/bibles/${NIV_VERSION_ID}/passages/${osisRef}`;
  try {
    const res = await fetch(url, { headers: { "X-YVP-App-Key": apiKey } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = (await res.json()) as { content?: string; reference?: string };
    if (!json.content) {
      return { ok: false, reason: "empty content" };
    }
    const content = fixYouVersionText(json.content);
    const checksum = "sha256:" + createHash("sha256").update(content, "utf-8").digest("hex");
    return {
      ok: true,
      verse: {
        osis_ref: osisRef,
        reference_display: json.reference ?? osisRef,
        verse_text: content,
        youversion_fetch: { fetched_at: new Date().toISOString(), source_url: url, checksum },
      },
    };
  } catch (err) {
    return { ok: false, reason: `fetch error: ${(err as Error).message}` };
  }
}

async function yesNoVerdict(config: BetweenTurnsConfig, theme: ThemeSeed, verse: VerifiedVerse): Promise<{ verdict: "yes" | "no"; rationale: string }> {
  const parametersSchema = {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["yes", "no"] },
      rationale: { type: "string" },
    },
    required: ["verdict", "rationale"],
    additionalProperties: false,
  };
  const { parsed } = await chatCompletionsForcedTool<{ verdict: "yes" | "no"; rationale: string }>(config, {
    model: MODEL,
    messages: [
      {
        role: "system",
        content: "You judge, briefly and honestly, whether a real Bible verse text genuinely supports a given theme. Say no if the connection is a stretch or only superficial, even if the verse sounds vaguely related.",
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

async function main(): Promise<void> {
  const themeIds = process.argv.slice(2);
  if (themeIds.length === 0) {
    throw new Error("usage: add-new-themes.ts <theme_id> [theme_id ...]");
  }

  const config = loadConfig();
  const allSeeds: ThemeSeed[] = JSON.parse(readFileSync(join(REPO_ROOT, "data", "theme-seeds.json"), "utf-8"));
  const themes = themeIds.map((id) => {
    const t = allSeeds.find((s) => s.theme_id === id);
    if (!t) throw new Error(`theme not found in theme-seeds.json: ${id}`);
    return t;
  });

  const apiKey = process.env[config.youversion.api_key_env];
  if (!apiKey) throw new Error(`Missing YouVersion API key: set ${config.youversion.api_key_env}`);

  const candidatesPath = join(REPO_ROOT, "data", "build-logs", "candidates.json");
  const verificationPath = join(REPO_ROOT, "data", "build-logs", "verification-results.json");
  const fitCheckPath = join(REPO_ROOT, "data", "build-logs", "fit-check-results.json");

  const candidatesFile = JSON.parse(readFileSync(candidatesPath, "utf-8"));
  const verificationFile = JSON.parse(readFileSync(verificationPath, "utf-8"));
  const fitCheckFile = JSON.parse(readFileSync(fitCheckPath, "utf-8"));

  for (const theme of themes) {
    console.log(`\n=== ${theme.theme_id} ===`);

    // 1. Generate
    const proposed = await generateForTheme(config, theme);
    console.log(`Proposed ${proposed.length} candidates.`);
    await sleep(DELAY_MS);

    // Merge into candidates.json (create entry if new, else append -- this theme is always new here).
    let candidatesEntry = candidatesFile.results.find((r: { theme_id: string }) => r.theme_id === theme.theme_id);
    if (!candidatesEntry) {
      candidatesEntry = { theme_id: theme.theme_id, candidates: [] };
      candidatesFile.results.push(candidatesEntry);
    }
    candidatesEntry.candidates.push(...proposed);
    candidatesFile.total_proposed = (candidatesFile.total_proposed ?? 0) + proposed.length;
    writeFileSync(candidatesPath, JSON.stringify(candidatesFile, null, 2));

    // 2. Verify against YouVersion (only refs we don't already know about)
    const verifiedForTheme = new Map<string, VerifiedVerse>();
    for (const c of proposed) {
      if (verificationFile.verified[c.osis_ref]) {
        verifiedForTheme.set(c.osis_ref, verificationFile.verified[c.osis_ref]);
        console.log(`  ${c.osis_ref}: already verified (reused)`);
        continue;
      }
      process.stdout.write(`  ${c.osis_ref}... `);
      const result = await verifyRef(apiKey, c.osis_ref);
      if (result.ok) {
        verificationFile.verified[c.osis_ref] = result.verse;
        verifiedForTheme.set(c.osis_ref, result.verse);
        console.log("verified");
      } else {
        verificationFile.rejected[c.osis_ref] = { reason: result.reason };
        console.log(`REJECTED (${result.reason})`);
      }
      await sleep(DELAY_MS);
    }
    verificationFile.total_verified = Object.keys(verificationFile.verified).length;
    verificationFile.total_rejected = Object.keys(verificationFile.rejected).length;
    writeFileSync(verificationPath, JSON.stringify(verificationFile, null, 2));

    if (verifiedForTheme.size === 0) {
      console.log(`  No verified candidates for ${theme.theme_id} -- skipping fit-check.`);
      fitCheckFile.per_theme[theme.theme_id] = fitCheckFile.per_theme[theme.theme_id] ?? [];
      writeFileSync(fitCheckPath, JSON.stringify(fitCheckFile, null, 2));
      continue;
    }

    // 3. Ingest verified verses into Gloo
    for (const [ref, verse] of verifiedForTheme) {
      const filename = `${sanitize(ref)}.txt`;
      await ingestTextItem(config, { filename, content: verse.verse_text, producerId: sanitize(ref) });
      await sleep(DELAY_MS);
    }
    console.log("  Waiting 20s for Gloo indexing...");
    await sleep(20_000);

    // 4. Fit-check: search certainty + yes/no judgment
    const searchResult = await glooSearch(config, { query: theme.description, limit: SEARCH_QUERY_LIMIT, certainty: SEARCH_QUERY_CERTAINTY_FLOOR });
    const certaintyMap = new Map<string, number>();
    for (const item of searchResult.data) {
      const filename = item.properties["filename"] as string | undefined;
      if (filename) certaintyMap.set(filename, item.metadata.certainty);
    }
    await sleep(DELAY_MS);

    const fitChecked: {
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
    }[] = [];

    for (const [ref, verse] of verifiedForTheme) {
      const certainty = certaintyMap.get(`${sanitize(ref)}.txt`) ?? 0;
      const yesno = await yesNoVerdict(config, theme, verse);
      await sleep(DELAY_MS);
      const kept = yesno.verdict === "yes" && certainty >= CERTAINTY_KEEP_THRESHOLD;
      const rejectReason = kept ? null : yesno.verdict === "no" ? "gloo_yesno_no" : "certainty_below_threshold";
      fitChecked.push({
        osis_ref: ref,
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
      console.log(`  ${ref}: certainty=${certainty.toFixed(2)} yesno=${yesno.verdict} -> ${kept ? "KEEP" : "reject (" + rejectReason + ")"}`);
    }

    fitCheckFile.per_theme[theme.theme_id] = fitChecked;
    fitCheckFile.total_kept = (fitCheckFile.total_kept ?? 0) + fitChecked.filter((c) => c.kept).length;
    fitCheckFile.total_rejected = (fitCheckFile.total_rejected ?? 0) + fitChecked.filter((c) => !c.kept).length;
    writeFileSync(fitCheckPath, JSON.stringify(fitCheckFile, null, 2));

    const keptCount = fitChecked.filter((c) => c.kept).length;
    console.log(`Done with ${theme.theme_id}: ${keptCount}/${fitChecked.length} kept.`);
  }

  console.log("\nAll requested themes processed. Run build-taxonomy.ts to fold results into themes.json.");
}

main();
