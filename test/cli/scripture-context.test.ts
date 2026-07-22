import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// printScriptureContext only prints -- capture console.log to assert on output.
async function captureConsoleLog(fn: () => void): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines;
}

describe("printScriptureContext", () => {
  let tmpCwd: string;

  afterEach(() => {
    if (tmpCwd) rmSync(tmpCwd, { recursive: true, force: true });
  });

  test("regression: an event logged before the timestamp field existed doesn't crash the command", async () => {
    const { printScriptureContext } = await import("../../src/cli/scripture-context.js");
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-scripture-context-"));
    writeFileSync(
      join(tmpCwd, "between-turns.config.json"),
      JSON.stringify({ log_dir: ".between-turns/logs" })
    );

    const logDir = join(tmpCwd, ".between-turns", "logs", "2026-01-01");
    mkdirSync(logDir, { recursive: true });
    // Deliberately no "timestamp" field -- this is exactly the shape of
    // events logged before that field was added.
    writeFileSync(
      join(logDir, "old-event.json"),
      JSON.stringify({
        event_id: "old-event",
        session_id: "s1",
        mode: "ambient",
        trigger: { type: "frustration", detector_score: 0.5, detail: "test" },
        candidates_offered: [],
        selection: null,
        generation: null,
        delivery: { delivered: false, delivery_hook: "UserPromptSubmit", suppressed_reason: "no_candidates_above_threshold" },
      })
    );

    // Should not throw.
    const lines = await captureConsoleLog(() => printScriptureContext(tmpCwd, "10"));
    assert.ok(lines.some((l) => l.includes("old-event") || l.includes("frustration")), "should print the old event without crashing");
  });

  test("reports no events cleanly when the log directory doesn't exist yet", async () => {
    const { printScriptureContext } = await import("../../src/cli/scripture-context.js");
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-scripture-context-"));
    writeFileSync(join(tmpCwd, "between-turns.config.json"), JSON.stringify({ log_dir: ".between-turns/logs" }));

    const lines = await captureConsoleLog(() => printScriptureContext(tmpCwd, undefined));
    assert.ok(lines.some((l) => l.includes("No Between Turns events logged yet")));
  });

  test("rejects a non-numeric count argument with a clear error, not a crash", async () => {
    const { printScriptureContext } = await import("../../src/cli/scripture-context.js");
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-scripture-context-"));
    writeFileSync(join(tmpCwd, "between-turns.config.json"), JSON.stringify({ log_dir: ".between-turns/logs" }));

    assert.throws(() => printScriptureContext(tmpCwd, "notanumber"), /Invalid count/);
  });

  test("throws a clear error when between-turns.config.json is missing", async () => {
    const { printScriptureContext } = await import("../../src/cli/scripture-context.js");
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-scripture-context-"));
    assert.throws(() => printScriptureContext(tmpCwd), /No between-turns\.config\.json found/);
  });
});
