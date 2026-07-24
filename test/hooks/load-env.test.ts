import { test, describe, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDotEnv } from "../../src/hooks/shared/load-env.js";

describe("loadDotEnv", () => {
  let tmpCwd: string;
  const testKeys = ["BT_TEST_A", "BT_TEST_B", "BT_TEST_C", "BT_TEST_QUOTED", "BT_TEST_EXISTING"];

  beforeEach(() => {
    for (const k of testKeys) delete process.env[k];
  });
  afterEach(() => {
    if (tmpCwd) rmSync(tmpCwd, { recursive: true, force: true });
    for (const k of testKeys) delete process.env[k];
  });

  test("does nothing when no .env file exists", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-load-env-"));
    loadDotEnv(tmpCwd); // should not throw
    assert.equal(process.env["BT_TEST_A"], undefined);
  });

  test("loads real KEY=VALUE pairs into process.env", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-load-env-"));
    writeFileSync(join(tmpCwd, ".env"), "BT_TEST_A=hello\nBT_TEST_B=world\n");
    loadDotEnv(tmpCwd);
    assert.equal(process.env["BT_TEST_A"], "hello");
    assert.equal(process.env["BT_TEST_B"], "world");
  });

  test("skips blank lines and # comments", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-load-env-"));
    writeFileSync(join(tmpCwd, ".env"), "# a comment\n\nBT_TEST_C=value\n# another\n");
    loadDotEnv(tmpCwd);
    assert.equal(process.env["BT_TEST_C"], "value");
  });

  test("strips matching surrounding quotes", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-load-env-"));
    writeFileSync(join(tmpCwd, ".env"), 'BT_TEST_QUOTED="quoted value"\n');
    loadDotEnv(tmpCwd);
    assert.equal(process.env["BT_TEST_QUOTED"], "quoted value");
  });

  test("never overrides a variable already set in the real environment", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-load-env-"));
    process.env["BT_TEST_EXISTING"] = "real-os-value";
    writeFileSync(join(tmpCwd, ".env"), "BT_TEST_EXISTING=from-dotenv\n");
    loadDotEnv(tmpCwd);
    assert.equal(process.env["BT_TEST_EXISTING"], "real-os-value", "a real OS env var must win over .env");
  });
});
