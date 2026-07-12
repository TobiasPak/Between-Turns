/**
 * One-off targeted retry for a theme that survived fit-check with zero kept
 * candidates. Generates a fresh, larger batch of candidates for a single
 * theme (with a more specific prompt nudge), verifies against YouVersion,
 * ingests into Gloo, and runs the same yes/no + search-certainty fit-check
 * as the main pipeline -- then merges surviving results into the existing
 * candidates.json / verification-results.json / fit-check-results.json
 * rather than overwriting them, preserving the original rejected attempts
 * for the audit trail.
 *
 * Usage: tsx src/build/regenerate-theme-candidates.ts <theme_id> "<extra prompt guidance>"
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
const CANDIDATE_COUNT = 8;
const CERTAINTY_KEEP_THRESHOLD = 0.35;

function loadConfig(): BetweenTurnsConfig {
  return JSON.parse(readFileSync(join(REPO_ROOT, "between-turns.config.json"), "utf-8"));
}
function sanitize(osisRef: string): string {
  return osisRef.replace(/[.\-]/g, "_");
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const themeId = process.argv[2];
  const extraGuidance = process.argv[3] ?? "";
  if (!themeId) throw new Error("usage: regenerate-theme-candidates.ts <theme_id> [extra guidance]");

  const config = loadConfig();
  const themes: ThemeSeed[] = JSON.parse(readFileSync(join(REPO_ROOT, "data", "theme-seeds.json"), "utf-8"));
  const theme = themes.find((t) => t.theme_id === themeId);
  if (!theme) throw new Error(`theme not found: ${themeId}`);

  console.log(`Regenerating candidates for ${themeId}...`);

  const parametersSchema = {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        minItems: CANDIDATE_COUNT,
        maxItems: CANDIDATE_COUNT,
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

  const { parsed } = await chatCompletionsForcedTool<{ candidates: { osis_ref: string; rationale: string }[] }>(
    config,
    {
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You propose real, well-known Bible verse or short-passage references that genuinely fit a given theme. A prior attempt at this theme produced only generic 'do not judge' verses that a reviewer correctly rejected as too generic. Propose different, more specific angles this time. Use OSIS/USFM book codes, chapter.verse, hyphenated ranges, no spaces.",
        },
        {
          role: "user",
          content: `Theme: "${theme.description}"\nExample contexts: ${theme.example_contexts.join("; ")}.\n${extraGuidance}\nPropose ${CANDIDATE_COUNT} distinct real verse/passage references with a one-sentence rationale each. Prefer specific narratives or direct statements over generic judgment-of-others verses.`,
        },
      ],
      toolName: "propose_candidates",
      toolDescription: "Propose candidate Bible verse references for the given theme.",
      parametersSchema,
      temperature: 0.9,
      maxTokens: 1500,
    }
  );

  console.log(`Proposed ${parsed.candidates.length} new candidates. Verifying against YouVersion...`);

  const apiKey = process.env[config.youversion.api_key_env];
  if (!apiKey) throw new Error(`Missing YouVersion API key: set ${config.youversion.api_key_env}`);

  const verifiedNew: Record<string, { reference_display: string; verse_text: string; youversion_fetch: { fetched_at: string; source_url: string; checksum: string } }> = {};
  const rejectedNew: Record<string, { reason: string }> = {};

  for (const c of parsed.candidates) {
    const url = `https://api.youversion.com/v1/bibles/${NIV_VERSION_ID}/passages/${c.osis_ref}`;
    process.stdout.write(`  ${c.osis_ref}... `);
    try {
      const res = await fetch(url, { headers: { "X-YVP-App-Key": apiKey } });
      if (!res.ok) {
        rejectedNew[c.osis_ref] = { reason: `HTTP ${res.status}` };
        console.log("REJECTED (unresolvable)");
        continue;
      }
      const json = (await res.json()) as { content?: string; reference?: string };
      if (!json.content) {
        rejectedNew[c.osis_ref] = { reason: "empty content" };
        console.log("REJECTED (empty)");
        continue;
      }
      const content = fixYouVersionText(json.content);
      const checksum = "sha256:" + createHash("sha256").update(content, "utf-8").digest("hex");
      verifiedNew[c.osis_ref] = {
        reference_display: json.reference ?? c.osis_ref,
        verse_text: content,
        youversion_fetch: { fetched_at: new Date().toISOString(), source_url: url, checksum },
      };
      console.log("verified");
    } catch (err) {
      rejectedNew[c.osis_ref] = { reason: `fetch error: ${(err as Error).message}` };
      console.log(`REJECTED (${(err as Error).message})`);
    }
    await sleep(120);
  }

  console.log(`\nIngesting ${Object.keys(verifiedNew).length} newly verified verses into Gloo...`);
  for (const [ref, v] of Object.entries(verifiedNew)) {
    const filename = `${sanitize(ref)}.txt`;
    await ingestTextItem(config, { filename, content: v.verse_text, producerId: sanitize(ref) });
    await sleep(120);
  }

  console.log("Waiting 20s for indexing...");
  await sleep(20_000);

  const certaintyMap = new Map<string, number>();
  const searchResult = await glooSearch(config, { query: theme.description, limit: 250, certainty: 0.01 });
  for (const item of searchResult.data) {
    const filename = item.properties["filename"] as string | undefined;
    if (filename) certaintyMap.set(filename, item.metadata.certainty);
  }

  const fitCheckedNew: {
    osis_ref: string;
    reference_display: string;
    verse_text: string;
    youversion_fetch: { fetched_at: string; source_url: string; checksum: string };
    fit_score: number;
    gloo_search_certainty: number;
    gloo_yesno_verdict: "yes" | "no";
    gloo_yesno_rationale: string;
    kept: boolean;
    reject_reason: string | null;
  }[] = [];

  for (const [ref, verse] of Object.entries(verifiedNew)) {
    const yesNoSchema = {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["yes", "no"] },
        rationale: { type: "string" },
      },
      required: ["verdict", "rationale"],
      additionalProperties: false,
    };
    const { parsed: yesno } = await chatCompletionsForcedTool<{ verdict: "yes" | "no"; rationale: string }>(config, {
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You judge, briefly and honestly, whether a real Bible verse text genuinely supports a given theme. Say no if the connection is a stretch or only superficial.",
        },
        {
          role: "user",
          content: `Theme: "${theme.description}"\nVerse text (${verse.reference_display}): "${verse.verse_text}"\nDoes this verse genuinely support the theme? Answer yes or no with a brief one-sentence rationale.`,
        },
      ],
      toolName: "judge_fit",
      toolDescription: "Judge whether the real verse text genuinely supports the theme.",
      parametersSchema: yesNoSchema,
      temperature: 0.3,
      maxTokens: 300,
    });
    await sleep(120);

    const certainty = certaintyMap.get(`${sanitize(ref)}.txt`) ?? 0;
    const kept = yesno.verdict === "yes" && certainty >= CERTAINTY_KEEP_THRESHOLD;
    fitCheckedNew.push({
      osis_ref: ref,
      reference_display: verse.reference_display,
      verse_text: verse.verse_text,
      youversion_fetch: verse.youversion_fetch,
      fit_score: certainty,
      gloo_search_certainty: certainty,
      gloo_yesno_verdict: yesno.verdict,
      gloo_yesno_rationale: yesno.rationale,
      kept,
      reject_reason: kept ? null : yesno.verdict === "no" ? "gloo_yesno_no" : "certainty_below_threshold",
    });
    console.log(
      `  ${ref}: certainty=${certainty.toFixed(2)} yesno=${yesno.verdict} -> ${kept ? "KEEP" : "reject"}`
    );
  }

  // Merge into existing build-log files rather than overwrite.
  const candidatesPath = join(REPO_ROOT, "data", "build-logs", "candidates.json");
  const candidatesFile = JSON.parse(readFileSync(candidatesPath, "utf-8"));
  const themeEntry = candidatesFile.results.find((r: { theme_id: string }) => r.theme_id === themeId);
  if (themeEntry) {
    themeEntry.candidates.push(...parsed.candidates);
    candidatesFile.total_proposed += parsed.candidates.length;
    writeFileSync(candidatesPath, JSON.stringify(candidatesFile, null, 2));
  }

  const verificationPath = join(REPO_ROOT, "data", "build-logs", "verification-results.json");
  const verificationFile = JSON.parse(readFileSync(verificationPath, "utf-8"));
  Object.assign(verificationFile.verified, verifiedNew);
  Object.assign(verificationFile.rejected, rejectedNew);
  verificationFile.total_verified = Object.keys(verificationFile.verified).length;
  verificationFile.total_rejected = Object.keys(verificationFile.rejected).length;
  writeFileSync(verificationPath, JSON.stringify(verificationFile, null, 2));

  const fitCheckPath = join(REPO_ROOT, "data", "build-logs", "fit-check-results.json");
  const fitCheckFile = JSON.parse(readFileSync(fitCheckPath, "utf-8"));
  fitCheckFile.per_theme[themeId].push(...fitCheckedNew);
  fitCheckFile.total_kept += fitCheckedNew.filter((c) => c.kept).length;
  fitCheckFile.total_rejected += fitCheckedNew.filter((c) => !c.kept).length;
  writeFileSync(fitCheckPath, JSON.stringify(fitCheckFile, null, 2));

  const keptCount = fitCheckedNew.filter((c) => c.kept).length;
  console.log(`\nDone. ${keptCount}/${fitCheckedNew.length} new candidates kept for ${themeId}.`);
  console.log("Merged into candidates.json, verification-results.json, fit-check-results.json.");
}

main();
