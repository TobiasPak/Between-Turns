import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BetweenTurnsConfig } from "../types/config.js";
import type { SessionState } from "../types/session-state.js";
import type { Theme, VerifiedReference } from "../types/theme.js";
import { excludeRecentSelections } from "../state/pacing.js";
import { glooSearch } from "./gloo-client.js";

/**
 * themes.json is a build artifact that ships with the Between Turns package
 * itself -- it does not exist in whatever repo a developer is actually
 * working in. Resolve it relative to this module's own location (two levels
 * up from src/runtime/), not the session's cwd, the same way cli/index.ts
 * resolves hook modules relative to itself rather than cwd. Everything else
 * (config, session state, logs) is correctly cwd-relative, since those are
 * genuinely per-consuming-repo; only this one is a shipped package asset.
 */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface RetrievalCandidate {
  theme_id: string;
  osis_ref: string;
  reference_display: string;
  translation: string;
  verse_text: string;
  gloo_search_certainty: number;
}

function sanitize(osisRef: string): string {
  return osisRef.replace(/[.\-]/g, "_");
}

function loadThemesIndex(): Map<string, { theme_id: string; ref: VerifiedReference }> {
  const themes: Theme[] = JSON.parse(readFileSync(join(PACKAGE_ROOT, "data", "themes.json"), "utf-8"));
  const index = new Map<string, { theme_id: string; ref: VerifiedReference }>();
  for (const theme of themes) {
    for (const ref of theme.verified_references) {
      index.set(`${sanitize(ref.osis_ref)}.txt`, { theme_id: theme.theme_id, ref });
    }
  }
  return index;
}

/**
 * Queries across the whole verse corpus (not scoped to one pre-matched
 * theme) and ranks by Gloo Search certainty. Because the search already
 * spans every theme, if the top-ranked candidates get filtered out by
 * excludeRecentSelections, the next-ranked ones -- which may belong to a
 * different theme entirely -- naturally take their place. That's what plan
 * §6 calls "widening to sibling themes"; it falls out of not pre-scoping
 * the query to a single theme rather than needing separate logic.
 */
export async function retrieveCandidates(
  config: BetweenTurnsConfig,
  state: SessionState,
  contextQuery: string,
  limit = 8
): Promise<RetrievalCandidate[]> {
  const index = loadThemesIndex();
  const result = await glooSearch(config, { query: contextQuery, limit: 250, certainty: 0.01 });

  const candidates: RetrievalCandidate[] = [];
  for (const item of result.data) {
    const filename = item.properties["filename"] as string | undefined;
    if (!filename) continue;
    const entry = index.get(filename);
    if (!entry) continue; // an ingested item that isn't (or is no longer) a verified reference in the current taxonomy

    candidates.push({
      theme_id: entry.theme_id,
      osis_ref: entry.ref.osis_ref,
      reference_display: entry.ref.reference_display,
      translation: entry.ref.translation,
      verse_text: entry.ref.verse_text,
      gloo_search_certainty: item.metadata.certainty,
    });
  }

  candidates.sort((a, b) => b.gloo_search_certainty - a.gloo_search_certainty);
  return excludeRecentSelections(candidates, state).slice(0, limit);
}
