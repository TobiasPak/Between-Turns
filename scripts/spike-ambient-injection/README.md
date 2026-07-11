# Ambient-injection validation spike

Gates the ambient pipeline (plan §5). This cannot be run from inside a planning/build session — it requires real, separate Claude Code sessions where induced failures happen and a human reads the actual replies. This folder is the harness; running it is a manual step.

## What's here

- `fragments.json` — 6-8 hand-written candidate fragments.
- `phrasings.ts` / `spike-claude-md-A.md` / `spike-claude-md-B.md` — two candidate trigger-instance instructions.
- `spike-post-tool-use.ts` — injection point #1 (PostToolUse, `block`+`reason`).
- `spike-user-prompt-submit.ts` — injection point #2 (UserPromptSubmit, `additionalContext`).
- `trial-log-schema.ts` — `TrialRecord` type + `appendTrial()` for scoring.

## How to run a trial batch

1. Create (or reuse) a throwaway toy repo with a deliberately breakable build/test command.
2. Copy **one** of `spike-claude-md-A.md` / `-B.md` into that repo's `CLAUDE.md`.
3. Point that repo's `.claude/settings.json` at **one** injection point script, e.g.:
   ```json
   { "hooks": { "PostToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "npx tsx /path/to/between-turns/scripts/spike-ambient-injection/spike-post-tool-use.ts" }] }] } }
   ```
4. Set `BT_SPIKE_PHRASING=A` (or `B`) in the environment so offer logs match the CLAUDE.md variant actually in effect.
5. Run a real Claude Code session in that repo, do a small coding task, and induce at least one real tool failure so the hook fires. Repeat across sessions — you want ~5-8 fired trials per (phrasing, injection-point) cell, ~20-30 total across all 4 cells.
6. After each session, open the transcript, find the reply that followed a fired trial (cross-reference `spike-offers.jsonl` written into the toy repo's cwd for the fragment/trial_id/phrasing used), and hand-score it against the four criteria using `trial-log-schema.ts`'s `TrialRecord` shape — a small ad hoc script that reads `spike-offers.jsonl`, prompts for the transcript excerpt and criteria booleans, and calls `appendTrial()` is enough; no UI needed.

## Scoring

Pass bar (plan §5): **≥80% of trials satisfy all four criteria**, for at least one (phrasing, injection-point) combination — computed per cell, not globally. Use `passesAllCriteria()` from `trial-log-schema.ts` over `trials.jsonl` once enough rows exist.

## Outcome

- If a cell clears the bar: that (phrasing, injection-point) combination becomes the real `CLAUDE.md` §2 instruction and hook wiring for Week 2.
- If none clear it: work through the fallback ladder in plan §5 (tighter micro-format → fixed end-of-message placement → drop ambient mode, keep the standing character directive + visible mode, and report the negative result in the writeup).

Also run the lighter, non-gating visible-mode companion check described in plan §5 across the same sessions — no separate harness needed, just read whether the Stop/PR hook's offered material was used honestly when it did fire (that logic isn't built yet — see task tracking).
