import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BetweenTurnsConfig } from "../types/config.js";
import { fixYouVersionText } from "./youversion-text-fixes.js";

const REPO_ROOT = process.cwd();
const YOUVERSION_BASE = "https://api.youversion.com/v1";
const NIV_VERSION_ID = 111; // NIV 2011, US English -- confirmed Day 1
const DELAY_MS_BETWEEN_CALLS = 120;

interface CandidateProposal {
  osis_ref: string;
  rationale: string;
}

interface CandidatesFile {
  results: { theme_id: string; candidates: CandidateProposal[] }[];
}

export interface VerifiedVerse {
  osis_ref: string;
  reference_display: string;
  verse_text: string;
  youversion_fetch: {
    fetched_at: string;
    source_url: string;
    checksum: string;
  };
}

interface RejectedVerse {
  osis_ref: string;
  stage: "verification";
  reason: string;
}

function loadConfig(): BetweenTurnsConfig {
  return JSON.parse(readFileSync(join(REPO_ROOT, "between-turns.config.json"), "utf-8"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchVerse(
  apiKey: string,
  osisRef: string
): Promise<{ ok: true; verse: VerifiedVerse } | { ok: false; reason: string }> {
  const url = `${YOUVERSION_BASE}/bibles/${NIV_VERSION_ID}/passages/${osisRef}`;
  const res = await fetch(url, { headers: { "X-YVP-App-Key": apiKey } });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, reason: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  }

  const json = (await res.json()) as { id?: string; content?: string; reference?: string };
  if (!json.content || typeof json.content !== "string" || json.content.trim().length === 0) {
    return { ok: false, reason: "empty content in response" };
  }

  const content = fixYouVersionText(json.content);
  const checksum = "sha256:" + createHash("sha256").update(content, "utf-8").digest("hex");
  return {
    ok: true,
    verse: {
      osis_ref: osisRef,
      reference_display: json.reference ?? osisRef,
      verse_text: content,
      youversion_fetch: {
        fetched_at: new Date().toISOString(),
        source_url: url,
        checksum,
      },
    },
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const apiKey = process.env[config.youversion.api_key_env];
  if (!apiKey) {
    throw new Error(`Missing YouVersion API key: set ${config.youversion.api_key_env}`);
  }

  const candidatesPath = join(REPO_ROOT, "data", "build-logs", "candidates.json");
  const candidatesFile: CandidatesFile = JSON.parse(readFileSync(candidatesPath, "utf-8"));

  const uniqueRefs = Array.from(
    new Set(candidatesFile.results.flatMap((r) => r.candidates.map((c) => c.osis_ref)))
  );

  const verified = new Map<string, VerifiedVerse>();
  const rejected = new Map<string, RejectedVerse>();

  console.log(`Verifying ${uniqueRefs.length} unique references against YouVersion (NIV, version ${NIV_VERSION_ID})...`);

  for (const ref of uniqueRefs) {
    process.stdout.write(`${ref}... `);
    try {
      const result = await fetchVerse(apiKey, ref);
      if (result.ok) {
        verified.set(ref, result.verse);
        console.log("verified");
      } else {
        rejected.set(ref, { osis_ref: ref, stage: "verification", reason: result.reason });
        console.log(`REJECTED (${result.reason})`);
      }
    } catch (err) {
      rejected.set(ref, { osis_ref: ref, stage: "verification", reason: `fetch error: ${(err as Error).message}` });
      console.log(`REJECTED (fetch error: ${(err as Error).message})`);
    }
    await sleep(DELAY_MS_BETWEEN_CALLS);
  }

  const outPath = join(REPO_ROOT, "data", "build-logs", "verification-results.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        verified_at: new Date().toISOString(),
        translation: "NIV",
        youversion_version_id: NIV_VERSION_ID,
        total_unique_refs: uniqueRefs.length,
        total_verified: verified.size,
        total_rejected: rejected.size,
        verified: Object.fromEntries(verified),
        rejected: Object.fromEntries(rejected),
      },
      null,
      2
    )
  );

  console.log(
    `\nDone. ${verified.size} verified, ${rejected.size} rejected (hallucination/unresolvable catches) out of ${uniqueRefs.length} unique references.`
  );
  console.log(`Output: ${outPath}`);
}

main();
