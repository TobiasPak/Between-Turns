import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../../src/cli/init.js";

describe("init", () => {
  let tmpCwd: string;

  afterEach(() => {
    if (tmpCwd) rmSync(tmpCwd, { recursive: true, force: true });
  });

  test("scaffolds all four pieces into a genuinely empty repo", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-init-"));
    init(tmpCwd);

    assert.ok(existsSync(join(tmpCwd, "between-turns.config.json")));
    assert.ok(existsSync(join(tmpCwd, ".claude", "settings.json")));
    assert.ok(existsSync(join(tmpCwd, "CLAUDE.md")));
    assert.ok(existsSync(join(tmpCwd, ".claude", "commands", "scripture-context.md")));

    const config = JSON.parse(readFileSync(join(tmpCwd, "between-turns.config.json"), "utf-8"));
    assert.equal(config.enabled, false, "must default to disabled -- opt-in, per the plan");

    const settings = JSON.parse(readFileSync(join(tmpCwd, ".claude", "settings.json"), "utf-8"));
    assert.equal(settings.hooks.PostToolUse.length, 1);
    assert.equal(settings.hooks.UserPromptSubmit.length, 1);
    assert.equal(settings.hooks.Stop.length, 1);
    assert.equal(settings.hooks.PreToolUse.length, 1);
    assert.equal(settings.hooks.PreToolUse[0].matcher, "Bash");

    const claudeMd = readFileSync(join(tmpCwd, "CLAUDE.md"), "utf-8");
    assert.match(claudeMd, /between-turns:visible-candidate/);
  });

  test("running init twice is fully idempotent -- no duplicate hooks, no duplicate CLAUDE.md content", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-init-"));
    init(tmpCwd);
    const firstClaudeMd = readFileSync(join(tmpCwd, "CLAUDE.md"), "utf-8");

    init(tmpCwd);
    const secondClaudeMd = readFileSync(join(tmpCwd, "CLAUDE.md"), "utf-8");

    assert.equal(firstClaudeMd, secondClaudeMd, "a second run must not append a duplicate section");

    const settings = JSON.parse(readFileSync(join(tmpCwd, ".claude", "settings.json"), "utf-8"));
    assert.equal(settings.hooks.PostToolUse.length, 1, "a second run must not duplicate hook wiring");
    assert.equal(settings.hooks.UserPromptSubmit.length, 1);
    assert.equal(settings.hooks.Stop.length, 1);
    assert.equal(settings.hooks.PreToolUse.length, 1);
  });

  test("preserves a real developer's existing CLAUDE.md content, appending rather than overwriting", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-init-"));
    const original = "# My Project\n\nReal, hand-written instructions that must not be lost.\n";
    writeFileSync(join(tmpCwd, "CLAUDE.md"), original);

    init(tmpCwd);

    const result = readFileSync(join(tmpCwd, "CLAUDE.md"), "utf-8");
    assert.ok(result.startsWith(original.trimEnd()), "original content must remain, untouched, at the top");
    assert.match(result, /between-turns:visible-candidate/, "our section must still be appended");
  });

  test("recognizes existing dev-mode hook wiring (tsx against source) as already-wired, and doesn't duplicate it", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-init-"));
    const claudeDir = join(tmpCwd, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({
        hooks: {
          PostToolUse: [{ hooks: [{ type: "command", command: "npx tsx src/cli/index.ts hook post-tool-use" }] }],
        },
      })
    );

    init(tmpCwd);

    const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf-8"));
    assert.equal(settings.hooks.PostToolUse.length, 1, "an existing dev-mode entry for the same hook must not be duplicated");
    // The other three hooks weren't present at all, so those should have been added fresh.
    assert.equal(settings.hooks.UserPromptSubmit.length, 1);
    assert.equal(settings.hooks.Stop.length, 1);
    assert.equal(settings.hooks.PreToolUse.length, 1);
  });

  test("preserves a developer's own unrelated hooks in settings.json rather than overwriting the file", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-init-"));
    const claudeDir = join(tmpCwd, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({
        hooks: {
          PostToolUse: [{ hooks: [{ type: "command", command: "echo some-other-unrelated-hook" }] }],
        },
      })
    );

    init(tmpCwd);

    const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf-8"));
    // The developer's own unrelated hook must still be present, plus ours added alongside it.
    assert.equal(settings.hooks.PostToolUse.length, 2);
    const commands = settings.hooks.PostToolUse.map((g: { hooks: { command: string }[] }) => g.hooks[0].command);
    assert.ok(commands.includes("echo some-other-unrelated-hook"));
    assert.ok(commands.some((c: string) => c.includes("hook post-tool-use")));
  });

  test("does not overwrite an already-installed /scripture-context command", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-init-"));
    const commandsDir = join(tmpCwd, ".claude", "commands");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(join(commandsDir, "scripture-context.md"), "custom content the developer wrote themselves");

    init(tmpCwd);

    const result = readFileSync(join(commandsDir, "scripture-context.md"), "utf-8");
    assert.equal(result, "custom content the developer wrote themselves");
  });

  test("default config has blank tenant/publisher_id, not a hardcoded real value", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-init-"));
    init(tmpCwd);
    const config = JSON.parse(readFileSync(join(tmpCwd, "between-turns.config.json"), "utf-8"));
    assert.equal(config.gloo.tenant, "");
    assert.equal(config.gloo.publisher_id, "");
  });

  test("creates .gitignore with .env and .between-turns/ when none exists", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-init-"));
    init(tmpCwd);
    const gitignore = readFileSync(join(tmpCwd, ".gitignore"), "utf-8");
    assert.match(gitignore, /^\.env$/m);
    assert.match(gitignore, /^\.between-turns\/$/m);
  });

  test("appends missing entries to an existing .gitignore without touching what's already there", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-init-"));
    writeFileSync(join(tmpCwd, ".gitignore"), "node_modules/\ndist/\n");
    init(tmpCwd);
    const gitignore = readFileSync(join(tmpCwd, ".gitignore"), "utf-8");
    assert.match(gitignore, /node_modules\//);
    assert.match(gitignore, /dist\//);
    assert.match(gitignore, /^\.env$/m);
  });

  test("does not duplicate .gitignore entries on a second run", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-init-"));
    init(tmpCwd);
    init(tmpCwd);
    const gitignore = readFileSync(join(tmpCwd, ".gitignore"), "utf-8");
    const envLines = gitignore.split("\n").filter((l) => l.trim() === ".env");
    assert.equal(envLines.length, 1);
  });
});
