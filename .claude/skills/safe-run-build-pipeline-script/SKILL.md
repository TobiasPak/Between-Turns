---
name: safe-run-build-pipeline-script
description: Use this skill before running any new or modified script in Between Turns' src/build/ pipeline (generate-candidates.ts, verify-youversion.ts, fit-check.ts, regenerate-theme-candidates.ts, build-taxonomy.ts, etc.) that calls real, paid Gloo or YouVersion APIs across many items -- e.g. all 48 themes. Also use whenever the user asks to "run the pipeline", "regenerate the taxonomy", or "rebuild themes.json". Don't run a full batch against live paid APIs on the first try of new or changed code.
---

# Safely running a build-pipeline script against live paid APIs

Every script in `src/build/` calls real Gloo and/or YouVersion APIs, often once per theme or per candidate (48 themes, hundreds of candidates). A bug caught after the full batch runs means re-spending real API calls and real time to find out. This skill is the sequence that catches problems cheaply, before they're expensive.

## Steps

1. **Type-check first.** `npx tsc -p tsconfig.json --noEmit`. Catches shape mismatches, typos, and interface drift before a single API call goes out.

2. **Load credentials.** None of these scripts auto-load `.env` — every invocation needs the credentials sourced into the same shell command:
   ```
   set -a && source .env && set +a && npx tsx src/build/<script>.ts
   ```

3. **Smoke-test on a small slice before committing to the full batch.** Most scripts in `src/build/` accept a numeric first CLI argument that limits scope (e.g. `npx tsx src/build/fit-check.ts 2` only fit-checks the first 2 themes). Run with a small limit first and actually open the output file it wrote — don't just check the exit code — to confirm the real values look right (correct field shapes, sensible scores, no unexpected nulls).

4. **Only then run the full batch**, and run it in the background if it'll take more than roughly a minute — dozens to hundreds of sequential API calls add up fast, and there's no reason to block on it. Check back on the result rather than waiting synchronously.

5. **Write results incrementally, not just once at the end**, for any script that loops over many independent items (themes, verses, candidates). If the script can be killed by a timeout partway through, you want whatever finished so far to already be on disk — see `fit-check.ts`'s `writeResults()` call after every theme for the pattern. A single `writeFileSync` at the very end of a 10-minute loop means a timeout throws away everything.

6. **Sanity-check the aggregate once it's done**, before treating the run as trustworthy:
   - Any item that came back empty, zero, or all-identical across every entry — that's usually a sign of a bug (a stale loop variable, an off-by-one, a retrieval window silently truncating results) rather than a genuine finding. In this project, a `certainty: 0` that turned out to be a search-result-window bug (not a real low score) is the concrete example — it was only caught by noticing several themes had suspiciously identical rejection patterns.
   - Zero-survivor or thin items (e.g. a theme with 0-1 kept candidates) — worth a targeted look (see the `regenerate-thin-taxonomy-theme` skill) rather than shipping as-is.

## Why this matters here specifically

This isn't generic caution for its own sake — in this project, catching bugs *after* the fact means either accepting wrong data in a taxonomy whose entire value proposition is "every reference is real and verified," or re-spending real, metered API calls to redo work that a five-minute smoke test would have caught for free.
