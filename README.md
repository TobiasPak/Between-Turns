# Between Turns

A Claude Code companion that lets an opted-in Claude's character be shaped by real, verified Scripture at genuine moments of struggle and completion — built for the Gloo AI Summer Hackathon.

## About

Developers now spend more hours a day talking to Claude Code than to most people in their lives. Between Turns doesn't turn that into a notification system that dispenses a quota of scripture-flavored messages. It shapes *who Claude is* for an opted-in developer — patient, honest about failure, gracious under frustration — as a standing character, all the time, independent of any trigger. On top of that always-on disposition, four real moments (a stuck debugging loop, genuinely frustrated language, a session closing, a pull request being opened) can surface a real, verified Bible verse as disclosed source material, which Claude is free — never obligated — to cite explicitly, in its own words, only if it's honest to do given what's actually happening.

**The core thesis, provable from logs, not just claimed:** every verse this project ever surfaces traces back to real, YouVersion-fetched text — never an LLM's memory of a citation. That has to hold at two points: when the taxonomy is *built* (every candidate verified against a live Bible API, checksummed, and independently judged for genuine thematic fit) and when it's *delivered* (retrieval and selection both real, logged, and fail-closed — any failure suppresses delivery entirely rather than inventing something).

**One honest design pivot worth knowing about going in:** an earlier version of this project asked Claude to weave a Gloo-generated line into its reply verbatim, unattributed, with no acknowledgment it had been instructed to. A live Claude Code session correctly identified that as a prompt-injection pattern and refused to comply — repeatably, not as a fluke. That finding was taken at face value rather than engineered around: the covert design was retired for good, and everything now goes through fully disclosed, attributed delivery instead. See `notebooks/taxonomy-pipeline.md` and the git history for the full account.

**Current taxonomy:** 54 themes, 280 verified verse references (222 unique verses — some legitimately serve more than one theme), each with a real fetch timestamp, source URL, and SHA-256 checksum.

## Prerequisites

- **Node.js 20+**
- **Claude Code** installed and working
- **A Gloo AI Studio account** ([studio.ai.gloo.com](https://studio.ai.gloo.com/)) — the runtime delivery mechanism (retrieval + selection) makes real calls to Gloo's platform and needs your own tenant populated with the taxonomy (setup below)
- **Optional: GitHub CLI (`gh`)**, installed and authenticated (`gh auth login`) — only needed for the fourth trigger (offering a citation when opening a pull request). Everything else works without it.
- **Optional: a YouVersion API key** — only needed if you want to rebuild or expand the verse taxonomy yourself. Not needed to run or test the product as-is; the taxonomy ships pre-verified in `data/themes.json`.

## Installation

**If published to npm:**
```
npm install -g between-turns
```

**Running from source (current state at submission time — this repo has not been published to the npm registry yet):**
```
git clone https://github.com/TobiasPak/Between-Turns.git
cd Between-Turns
npm install
npm run build
npm link
```
`npm link` makes the `between-turns` command available globally on your machine, pointing at this cloned copy — functionally identical to a real global install for everything below.

## Setup (one-time, per project you want it active in)

1. **Create your own Gloo Publisher** — this is a manual step in Gloo AI Studio, not something the CLI can do for you (there's no API for it): click your account (bottom-left) → **Manage Organizations** → find your org → **View Publishers** → **Create New Publisher**. Only the Publisher name is required. This gives you the `tenant` name and `publisher_id` you'll need in step 4, plus your Gloo API client credentials (client ID/secret) from the same Studio account.
2. In the project where you want Between Turns active:
   ```
   between-turns init
   ```
   Scaffolds `between-turns.config.json` (disabled by default), wires the four Claude Code hooks into `.claude/settings.json`, writes `CLAUDE.md`, installs the `/scripture-context` slash command, and makes sure `.gitignore` excludes `.env` before anything sensitive is ever written there.
3. ```
   between-turns configure
   ```
   Prompts for your Gloo tenant, `publisher_id`, client ID, and client secret (and optionally a YouVersion key). Tenant/publisher_id — just identifiers, not secrets — are saved into `between-turns.config.json`; your actual credentials go into a gitignored `.env`, never into the tracked config.
4. ```
   between-turns ingest-taxonomy
   ```
   Pushes all 222 already-verified verses into *your own* Gloo tenant. Takes a few minutes (real, rate-limited API calls) and ends with a real search query against your tenant to confirm the content is actually findable before declaring success — safe to re-run any time (it detects and skips anything already present).
5. ```
   between-turns enable
   ```
   Turns it on. `between-turns status` at any point shows whether it's active and whether `gh` is set up for the PR trigger.

## Testing it

### A. Requires nothing — no Gloo account, no credentials

- **`npm test`** — 64 automated tests covering pacing, detection, the fail-closed suppression logic (including mocked-but-real Gloo call shapes), and known-bug regressions.
- **Read the taxonomy evidence directly**: `notebooks/taxonomy-pipeline.md` walks through the real build numbers, real bugs the pipeline caught in itself, and worked examples; `data/build-logs/*.json` contain every candidate proposal, every rejection (real HTTP 404s, real certainty scores, real judge rationales), and every verified verse's checksum. This is the most reliable way to verify the taxonomy claim — it doesn't depend on anyone's credentials working.

### B. Testing live delivery — needs your own Gloo account (setup above)

Once enabled, try any of the four real triggers in an actual Claude Code session in a repo where Between Turns is set up:

- **Stuck loop**: give it a task with a real bug, let it fail the same way 3+ times with real edit attempts in between (not just re-running the same command).
- **Frustration**: express genuine frustration in a message — this is judged by a real Gloo call, not keyword matching, so it should feel natural rather than needing a magic phrase.
- **Session close**: let a session with some real back-and-forth end naturally.
- **PR creation** (needs `gh`): ask it to open a pull request for real work.

After any of these, run `/scripture-context` inside the Claude Code session (or `between-turns scripture-context` from a terminal) to see the real, unedited log of what was offered, why it was selected, and whether it was delivered or suppressed — regardless of what actually showed up in the chat reply, since Claude has genuine discretion over whether to use what it's offered.

### C. Testing the taxonomy *pipeline* itself, live — optional, needs both Gloo and YouVersion credentials

The committed build-logs (section A) are the primary evidence this is real. If you want to additionally watch the pipeline run live rather than just read its output, you can — but **do this in a disposable clone, not this one**: these scripts overwrite `data/build-logs/*.json` and `data/themes.json` with whatever they just produced, and running them against a single theme would replace the full, real 54-theme submission data with a tiny subset.

In a throwaway clone:
```
npx tsx src/build/generate-candidates.ts 1   # propose real candidates for just the first theme
npx tsx src/build/verify-youversion.ts       # fetch + checksum them against the real YouVersion API
npx tsx src/build/fit-check.ts 1             # real Gloo Search certainty + a real yes/no judgment call
```
Each step prints its real API responses as it goes — HTTP statuses, certainty scores, judge rationales — the same mechanism that built the full taxonomy, just scoped to one theme so it's fast and cheap to watch happen.

## How it actually works

- `src/hooks/` — the four Claude Code hook entrypoints (`post-tool-use.ts`, `user-prompt-submit.ts`, `stop.ts`, `pre-tool-use-pr.ts`), each detecting one real trigger.
- `src/state/` — pacing (spacing floor, repetition avoidance, noise backoff) and detection (stuck-loop tracking, Gloo-judged frustration).
- `src/runtime/` — retrieval (Gloo Search across the whole verse corpus, not scoped by theme), selection (forced tool-choice, picks one candidate), and the fail-closed suppression pipeline that logs *why* whenever nothing gets delivered.
- `src/build/` — the taxonomy pipeline: generate candidates → verify against YouVersion → ingest into Gloo → fit-check (semantic certainty + independent yes/no judgment) → assemble `data/themes.json`.
- `src/cli/` — `init`, `configure`, `ingest-taxonomy`, `enable`/`disable`/`status`, `scripture-context`.
- `CLAUDE.md` — the two-part instruction Claude Code actually reads: an always-on standing-character directive, and the rules for using an offered verse (verbatim quote + citation, never in a commit message, genuine discretion over whether it fits).

## Fail-closed, by design

Retrieval failure, no candidates above threshold, missing credentials, network errors — every failure mode suppresses delivery silently rather than falling back to invented content. Claude Code proceeds exactly as if the hook weren't installed. This is logged and provable (`.between-turns/logs/`, readable via `/scripture-context`), not just asserted.
