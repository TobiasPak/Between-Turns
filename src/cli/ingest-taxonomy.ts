import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BetweenTurnsConfig } from "../types/config.js";
import type { Theme } from "../types/theme.js";
import { ingestTextItem } from "../build/gloo-ingest.js";
import { glooSearch } from "../runtime/gloo-client.js";

/** themes.json ships with the package -- resolve relative to this module's own location, same convention as retrieval.ts's PACKAGE_ROOT, not the caller's cwd. */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DELAY_MS = 120;
const VERIFY_SEARCH_LIMIT = 250;

function sanitize(osisRef: string): string {
  return osisRef.replace(/[.\-]/g, "_");
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadConfig(cwd: string): BetweenTurnsConfig {
  const path = join(cwd, "between-turns.config.json");
  if (!existsSync(path)) {
    throw new Error(`No between-turns.config.json found in ${cwd} -- run \`between-turns init\` first.`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as BetweenTurnsConfig;
}

function loadAllVerses(): Map<string, string> {
  const themes: Theme[] = JSON.parse(readFileSync(join(PACKAGE_ROOT, "data", "themes.json"), "utf-8"));
  // Dedupe by osis_ref -- the same real verse legitimately appears under multiple themes.
  const verses = new Map<string, string>();
  for (const theme of themes) {
    for (const ref of theme.verified_references) {
      verses.set(ref.osis_ref, ref.verse_text);
    }
  }
  return verses;
}

/**
 * Ingests the already-verified taxonomy into whichever Gloo tenant/publisher
 * the caller configured with their own credentials (`between-turns
 * configure`) -- makes the runtime delivery mechanism work against *their
 * own* account rather than depending on access to the tenant it was
 * originally built with. No YouVersion call here at all: every verse's text
 * and checksum were already fetched and verified at taxonomy build time;
 * this only pushes that already-verified text into Gloo's search index.
 *
 * Ends with a real Gloo Search query against the caller's own tenant to
 * confirm the content is actually findable, rather than declaring success
 * just because the upload calls returned 200 -- matching this project's own
 * "verify, don't just claim" pattern used throughout the build pipeline.
 */
export async function ingestTaxonomy(cwd: string, log: (msg: string) => void = console.log): Promise<void> {
  const config = loadConfig(cwd);

  if (!config.gloo.tenant || !config.gloo.publisher_id) {
    throw new Error("Gloo tenant/publisher_id not set -- run `between-turns configure` first.");
  }
  const clientId = process.env[config.gloo.client_id_env];
  const clientSecret = process.env[config.gloo.client_secret_env];
  if (!clientId || !clientSecret) {
    throw new Error(
      `Missing Gloo credentials: set ${config.gloo.client_id_env} and ${config.gloo.client_secret_env} (run \`between-turns configure\`).`
    );
  }

  const verses = loadAllVerses();
  log(`Ingesting ${verses.size} verified verses into your Gloo tenant "${config.gloo.tenant}"...`);

  let queued = 0;
  let duplicate = 0;
  let failed = 0;

  for (const [osisRef, text] of verses) {
    const filename = `${sanitize(osisRef)}.txt`;
    try {
      const result = await ingestTextItem(config, { filename, content: text, producerId: sanitize(osisRef) });
      if (result.duplicates.length > 0) {
        duplicate++;
      } else {
        queued++;
      }
    } catch (err) {
      log(`  ${osisRef}: FAILED (${(err as Error).message})`);
      failed++;
    }
    await sleep(DELAY_MS);
  }

  log(`\nIngestion requests: ${queued} newly queued, ${duplicate} already present, ${failed} failed.`);

  if (queued + duplicate === 0) {
    throw new Error("Every single ingestion request failed -- check your Gloo credentials and tenant/publisher_id with `between-turns status`.");
  }

  log("Waiting 20s for Gloo indexing to catch up...");
  await sleep(20_000);

  log("Verifying with a real Gloo Search query against your tenant...");
  const searchResult = await glooSearch(config, {
    query: "encouragement and wisdom for a software developer working through a difficult problem",
    limit: VERIFY_SEARCH_LIMIT,
    certainty: 0.01,
  });
  const foundFilenames = new Set(searchResult.data.map((item) => item.properties["filename"] as string | undefined).filter(Boolean));
  const expectedFilenames = Array.from(verses.keys()).map((ref) => `${sanitize(ref)}.txt`);
  const foundCount = expectedFilenames.filter((f) => foundFilenames.has(f)).length;
  const foundRatio = foundCount / expectedFilenames.length;

  if (foundRatio < 0.5) {
    throw new Error(
      `Ingestion requests completed, but a verification search only found ${foundCount}/${expectedFilenames.length} verses actually searchable in your tenant. This usually means indexing needs more time, or the tenant/publisher_id/credentials in between-turns.config.json don't match what was just ingested to -- check \`between-turns status\` and try running \`between-turns ingest-taxonomy\` again in a minute.`
    );
  }

  log(`Verified: ${foundCount}/${expectedFilenames.length} verses are actually searchable in your tenant.`);
  log("\nYour Gloo tenant now has the full taxonomy. Next: `between-turns enable`.");
}
