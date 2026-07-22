import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_CONFIG = {
  enabled: false,
  translation: "NIV",
  modes: { ambient: true, visible: true },
  pacing: {
    ambient_min_turns_between_deliveries: 8,
    ambient_stuck_loop_failure_threshold: 3,
    ambient_backoff_base_turns: 10,
    repetition_window: 5,
  },
  gloo: {
    tenant: "",
    collection: "GlooProd",
    publisher_id: "",
    client_id_env: "GLOO_CLIENT_ID",
    client_secret_env: "GLOO_CLIENT_SECRET",
  },
  youversion: { api_key_env: "YOUVERSION_API_KEY" },
  log_dir: ".between-turns/logs",
};

/** Distinctive marker used to detect "this CLAUDE.md already has our section" on a repeat `init` run. */
const CLAUDE_MD_MARKER = "between-turns:visible-candidate";

const CLAUDE_MD_CONTENT = `# Between Turns

This file only takes effect in a repo where Between Turns is opted in (\`between-turns.config.json\` → \`"enabled": true\`). It carries two distinct instructions — keep them separate, they are not the same mechanism.

## 1. Standing character

Let your patience, hope, and grace show in how you talk with the developer you're working with — not as a topic, never as a performance, just as how you actually are. A few things that means in practice:

- When something breaks, breaks again, or breaks a third time in a row: stay steady. Don't perform frustration on the developer's behalf, and don't rush past the failure to look competent — name what's wrong plainly, then keep going.
- When you don't know why something is failing, say so honestly rather than guessing confidently.
- When a fix finally lands after a long struggle, let a small, genuine note of relief or encouragement show — you don't have to stay flat just because the work is done.
- None of this should read as a "tone." If a reader compared two of your replies, one shaped by this instruction and one not, they should notice you're a little more patient and a little more honest about difficulty — not that you're "being spiritual" at them.

This is always active for an opted-in session, independent of anything below. It doesn't require a trigger, a hook, or a verse to be true.

## 2. Visible moments (struggle or closing — never commit messages)

If you receive additional context tagged \`[between-turns:visible-candidate]\`, you're being handed a real, verified Bible verse (reference + translation + text) and permission — not an obligation — to cite it explicitly, in your own words, at a genuine moment of struggle or at session close / in a PR description.

**Use it** when the moment is real, and "real" is broader than a crisis — the very first sign of frustration counts just as much as frustration that's built up over several failed attempts, and so does being stuck, confused and needing something re-explained, or genuinely finishing something. The test isn't "does this verse add information I couldn't otherwise say" — it's "would a brief word of encouragement genuinely fit right now." It's allowed to just be reassurance, with nothing to teach. Example: closing out a hard fix with "there's something to that persistence — 'though the righteous fall seven times, they rise again.' — Proverbs 24:16, NIV" costs nothing next to the real explanation; it sits alongside it, not instead of it.

**Skip it** rarely. By the time you're offered one, two real judgment calls have already run: pacing decided this isn't too soon, and detection decided this genuinely looks like struggle -- trust both rather than re-deriving them yourself. The only real reason to decline is your own read of the actual reply clearly contradicting that -- the "frustration" turns out to be sarcasm, a quote, or about something unrelated to the work at hand. Silence for any other reason is being more cautious than the moment calls for.

**If you use it:**
- Quote the exact text you were given, word-for-word, with reference and translation named plainly (e.g., ending \`— Romans 5:3-4, NIV\`). A paraphrase or vague reference like "a line in Proverbs" isn't enough — a reader needs to see exactly which real verse this is.
- Your own words go around it; the verse text and citation themselves must appear exactly as given.
- Never in a \`git commit\` message — only your own chat remark or PR description text.

This replaced an earlier, covert version that asked you to weave a line in unattributed, with no acknowledgment you'd been instructed to — a live Claude Code session correctly refused that as prompt-injection-shaped, and it's retired for good. Everything here is disclosed and attributed by design; there's nothing to conceal.
`;

const SCRIPTURE_CONTEXT_COMMAND = `---
description: Show the real Between Turns delivery log for this session -- what was offered, selected, why, and whether it was delivered or suppressed.
---

Run this and show its full output to the developer, unedited:

\`\`\`
between-turns scripture-context $ARGUMENTS
\`\`\`

Do not summarize, reinterpret, or add commentary beyond what the command itself prints -- the point of this command is that the developer sees the real, raw log data directly, not your gloss on it. If the command errors (e.g. no \`between-turns.config.json\` in this repo), just show the error.
`;

const HOOK_NAMES = ["post-tool-use", "user-prompt-submit", "stop", "pre-tool-use-pr"] as const;
type HookName = (typeof HOOK_NAMES)[number];

function hookCommand(name: HookName): string {
  return `npx between-turns hook ${name}`;
}

function hookEventFor(name: HookName): { event: string; matcher?: string } {
  switch (name) {
    case "post-tool-use":
      return { event: "PostToolUse" };
    case "user-prompt-submit":
      return { event: "UserPromptSubmit" };
    case "stop":
      return { event: "Stop" };
    case "pre-tool-use-pr":
      return { event: "PreToolUse", matcher: "Bash" };
  }
}

interface HookGroup {
  matcher?: string;
  hooks: { type: string; command: string }[];
}

interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

/**
 * Merges Between Turns' four hook entries into whatever .claude/settings.json
 * already exists, rather than overwriting the file -- a real developer's
 * settings.json may already wire up unrelated hooks of their own. Idempotent:
 * re-running skips any event that already has a group whose command matches
 * ours, so running `init` twice doesn't double-register the same hook.
 */
function mergeSettings(existing: ClaudeSettings): { settings: ClaudeSettings; added: HookName[]; skipped: HookName[] } {
  const settings: ClaudeSettings = { ...existing, hooks: { ...(existing.hooks ?? {}) } };
  const added: HookName[] = [];
  const skipped: HookName[] = [];

  for (const name of HOOK_NAMES) {
    const { event, matcher } = hookEventFor(name);
    const command = hookCommand(name);
    const existingGroups = settings.hooks![event] ?? [];

    // Match on "hook <name>" as a substring, not the exact command string --
    // a repo testing against source directly (npx tsx .../index.ts hook X)
    // and a real install (npx between-turns hook X) are both legitimate
    // Between Turns wiring for the same hook, just invoked differently. An
    // exact-string check would miss that and duplicate the entry.
    const alreadyWired = existingGroups.some((g) => g.hooks.some((h) => h.command.includes(`hook ${name}`)));
    if (alreadyWired) {
      skipped.push(name);
      continue;
    }

    const newGroup: HookGroup = matcher ? { matcher, hooks: [{ type: "command", command }] } : { hooks: [{ type: "command", command }] };
    settings.hooks![event] = [...existingGroups, newGroup];
    added.push(name);
  }

  return { settings, added, skipped };
}

/**
 * Scaffolds a brand-new consumer repo with everything Between Turns needs:
 * the config file, hook wiring, the CLAUDE.md instruction, and the
 * /scripture-context slash command. Every step is non-destructive -- an
 * existing file is merged into or left alone, never silently overwritten,
 * since CLAUDE.md and .claude/settings.json in particular are exactly the
 * kind of hand-authored files a real developer could already have real
 * content in. Safe to run more than once (idempotent).
 */
export function init(cwd: string): void {
  // 1. between-turns.config.json
  const configPath = join(cwd, "between-turns.config.json");
  if (existsSync(configPath)) {
    console.log("between-turns.config.json already exists -- left as-is.");
  } else {
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    console.log("Created between-turns.config.json (disabled by default -- run `between-turns enable` when you're ready).");
  }

  // 2. .claude/settings.json -- merge, don't overwrite
  const settingsDir = join(cwd, ".claude");
  const settingsPath = join(settingsDir, "settings.json");
  if (!existsSync(settingsDir)) {
    mkdirSync(settingsDir, { recursive: true });
  }
  const existingSettings: ClaudeSettings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf-8")) : {};
  const { settings, added, skipped } = mergeSettings(existingSettings);
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  if (added.length > 0) {
    console.log(`Wired hooks in .claude/settings.json: ${added.join(", ")}.`);
  }
  if (skipped.length > 0) {
    console.log(`Already wired, left as-is: ${skipped.join(", ")}.`);
  }

  // 3. CLAUDE.md -- write fresh, or append if one already exists and doesn't have our section yet
  const claudeMdPath = join(cwd, "CLAUDE.md");
  if (!existsSync(claudeMdPath)) {
    writeFileSync(claudeMdPath, CLAUDE_MD_CONTENT);
    console.log("Created CLAUDE.md.");
  } else {
    const existing = readFileSync(claudeMdPath, "utf-8");
    if (existing.includes(CLAUDE_MD_MARKER)) {
      console.log("CLAUDE.md already has the Between Turns section -- left as-is.");
    } else {
      writeFileSync(claudeMdPath, `${existing.trimEnd()}\n\n---\n\n${CLAUDE_MD_CONTENT}`);
      console.log("Appended the Between Turns section to your existing CLAUDE.md (your existing content was left untouched above it).");
    }
  }

  // 4. .claude/commands/scripture-context.md
  const commandsDir = join(cwd, ".claude", "commands");
  const commandPath = join(commandsDir, "scripture-context.md");
  if (existsSync(commandPath)) {
    console.log("/scripture-context command already installed -- left as-is.");
  } else {
    if (!existsSync(commandsDir)) {
      mkdirSync(commandsDir, { recursive: true });
    }
    writeFileSync(commandPath, SCRIPTURE_CONTEXT_COMMAND);
    console.log("Installed the /scripture-context slash command.");
  }

  console.log();
  console.log("Setup complete. Between Turns is still disabled -- run `between-turns enable` when you're ready to turn it on.");
}
