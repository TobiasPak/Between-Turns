import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSessionState, saveSessionState } from "../../src/state/session-store.js";
import { newSessionState } from "../../src/types/session-state.js";

describe("session-store", () => {
  let tmpCwd: string;

  afterEach(() => {
    if (tmpCwd) rmSync(tmpCwd, { recursive: true, force: true });
  });

  test("loadSessionState returns a fresh new state when no file exists yet", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-session-store-"));
    const state = loadSessionState(tmpCwd, "brand-new-session");
    assert.equal(state.session_id, "brand-new-session");
    assert.equal(state.turn_counter, 0);
    assert.deepEqual(state.recent_selections, []);
  });

  test("loadSessionState returns a fresh new state when the file is corrupt, rather than throwing", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-session-store-"));
    const dir = join(tmpCwd, ".between-turns", "state");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "corrupt-session.json"), "{not valid json!!");

    const state = loadSessionState(tmpCwd, "corrupt-session");
    assert.equal(state.session_id, "corrupt-session");
    assert.equal(state.turn_counter, 0);
  });

  test("saveSessionState then loadSessionState round-trips real data correctly", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-session-store-"));
    const state = newSessionState("round-trip-session");
    state.turn_counter = 12;
    state.recent_selections = ["ROM.5.3-4", "PSA.23.1"];
    state.ambient.consecutive_failure_count = 2;

    saveSessionState(tmpCwd, state);
    const reloaded = loadSessionState(tmpCwd, "round-trip-session");

    assert.deepEqual(reloaded, state);
  });

  test("saveSessionState does not leave a stray .tmp file behind (write-then-rename)", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-session-store-"));
    const state = newSessionState("tmp-check-session");
    saveSessionState(tmpCwd, state);

    const files = readdirSync(join(tmpCwd, ".between-turns", "state"));
    assert.deepEqual(files, ["tmp-check-session.json"]);
  });

  test("saving a second time overwrites cleanly rather than duplicating files", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-session-store-"));
    const state = newSessionState("overwrite-session");
    saveSessionState(tmpCwd, state);
    state.turn_counter = 5;
    saveSessionState(tmpCwd, state);

    const files = readdirSync(join(tmpCwd, ".between-turns", "state"));
    assert.equal(files.length, 1);
    const reloaded = loadSessionState(tmpCwd, "overwrite-session");
    assert.equal(reloaded.turn_counter, 5);
  });
});
