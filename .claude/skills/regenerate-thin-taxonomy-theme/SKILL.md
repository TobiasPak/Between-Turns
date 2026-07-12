---
name: regenerate-thin-taxonomy-theme
description: Use this skill whenever a theme in Between Turns' Scripture taxonomy (data/themes.json) has too few verified references -- especially 0, 1, or 2 -- or whenever the user asks to "fix", "regenerate", "beef up", "add more verses to", or "top up" a specific theme. Also use if the user asks which themes are thin or need more candidates. Diagnoses *why* prior candidates were rejected before writing a new prompt, rather than blindly re-running the same generic generation call and getting the same near-misses back.
---

# Regenerating a thin taxonomy theme

A theme comes out "thin" when `fit-check.ts` only kept 0-2 verified references for it. Re-running the exact same generation prompt almost never fixes this — Gloo tends to propose similar candidates again, and they get rejected for the same reason. The fix is to diagnose the *specific* reason the judge rejected each prior candidate, then write a prompt that steers toward a genuinely different angle.

## Why this matters

The taxonomy's whole credibility rests on never padding a theme with a verse that doesn't really fit — a thin theme has to be either genuinely strengthened or honestly left thin, never forced. Understanding *why* candidates failed is what makes the difference between a productive second attempt and three more rounds of the same rejection.

## Steps

1. **Read the rejection history.** Look at the theme's entry in `data/themes.json` (`rejected_at_build`) or the raw detail in `data/build-logs/fit-check-results.json` (`per_theme[theme_id]`, includes each `gloo_yesno_rationale`). Read the actual rationale text for every rejection, not just the reject reason code.

2. **Diagnose the failure pattern.** There are usually two kinds:
   - **Wrong concept entirely** — the candidates keep landing on an adjacent-but-different idea (e.g. verses about *God forgiving sin* kept getting proposed for a theme about *charity toward a past professional decision made under real constraints* — a different concept, not a moral one). If you see the same underlying concept rejected 2-3 times in different verse clothing, that's the signal to change angle, not just verse.
   - **Close but not quite** — genuinely on-topic candidates that miss on specificity (e.g. "completing a mission" verses proposed for a theme about *permission to rest*, rejected because completion isn't the same as rest).

3. **Find a genuinely different narrative angle**, not a rephrasing. Think about concrete stories/passages rather than abstract restatements — narrative specificity tends to land better with the judge than another abstract exhortation verse. If you're not sure, it's fine to propose 2-3 candidate angles and let the regeneration call sort out which fits.

4. **Run the regeneration script**, naming every already-rejected reference explicitly so Gloo doesn't propose them again, and stating the new angle:
   ```
   set -a && source .env && set +a && npx tsx src/build/regenerate-theme-candidates.ts <theme_id> "Already tried and rejected: REF1 (why), REF2 (why). Try a fresh angle: <specific narrative/passage idea>."
   ```
   This script (`src/build/regenerate-theme-candidates.ts`) generates new candidates, verifies them against YouVersion, ingests them into Gloo, fit-checks them, and merges surviving results into `candidates.json`, `verification-results.json`, and `fit-check-results.json` automatically — it does not overwrite prior rejected attempts, so the audit trail stays intact.

5. **Check the result.** If it's still at 0-1 after two honest, genuinely-different attempts, that's real signal the theme may not map cleanly onto Scripture's own vocabulary — stop and note it as a documented limitation rather than fishing for a third or fourth angle. (`grace-toward-past-decisions` in this project is the reference example: two rounds of forgiveness-of-sin verses failed before the David/Solomon temple-dedication narrative in 1 Kings 8:17-19 worked, landing it at 2 — a real, non-padded number.)

6. **Rebuild the assembled taxonomy** once you're done with all the themes you're regenerating in this pass:
   ```
   npx tsx src/build/build-taxonomy.ts
   ```
   This dedupes and writes the final `data/themes.json`. If the public write-up needs to reflect the new numbers, also run `npx tsx src/build/generate-notebook.ts`.

## Gotcha

None of these scripts auto-load `.env` — always prefix with `set -a && source .env && set +a` in the same command, or the script will fail on missing credentials.
