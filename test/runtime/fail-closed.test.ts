import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStruggleVisiblePipeline } from "../../src/runtime/fail-closed.js";
import { newSessionState } from "../../src/types/session-state.js";
import type { BetweenTurnsConfig } from "../../src/types/config.js";
import type { RetrievedScripture } from "../../src/types/retrieved-scripture.js";

function testConfig(): BetweenTurnsConfig {
  return {
    enabled: true,
    translation: "NIV",
    modes: { ambient: true, visible: true },
    pacing: { ambient_min_turns_between_deliveries: 8, ambient_stuck_loop_failure_threshold: 3, ambient_backoff_base_turns: 10, repetition_window: 5 },
    gloo: { tenant: "t", collection: "c", publisher_id: "p", client_id_env: "TEST_FC_CLIENT_ID", client_secret_env: "TEST_FC_CLIENT_SECRET" },
    youversion: { api_key_env: "Y" },
    log_dir: ".between-turns/logs",
  };
}

function readLoggedEvents(cwd: string, config: BetweenTurnsConfig): RetrievedScripture[] {
  const root = join(cwd, config.log_dir);
  const events: RetrievedScripture[] = [];
  for (const dateDir of readdirSync(root)) {
    for (const file of readdirSync(join(root, dateDir))) {
      events.push(JSON.parse(readFileSync(join(root, dateDir, file), "utf-8")));
    }
  }
  return events;
}

describe("runStruggleVisiblePipeline -- staged fail-closed suppression", () => {
  const originalFetch = globalThis.fetch;
  let tmpCwd: string;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env["TEST_FC_CLIENT_ID"];
    delete process.env["TEST_FC_CLIENT_SECRET"];
    if (tmpCwd) rmSync(tmpCwd, { recursive: true, force: true });
  });

  test("a Gloo Search failure suppresses delivery and logs gloo_search_unavailable with the real error", async () => {
    process.env["TEST_FC_CLIENT_ID"] = "id";
    process.env["TEST_FC_CLIENT_SECRET"] = "secret";
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-fail-closed-"));

    globalThis.fetch = (async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      if (u.includes("/ai/data/v1/search")) {
        return new Response("internal error", { status: 500 });
      }
      throw new Error(`unexpected fetch to ${u}`);
    }) as typeof fetch;

    const config = testConfig();
    const state = newSessionState("s1");

    const outcome = await runStruggleVisiblePipeline(
      tmpCwd,
      config,
      state,
      { type: "frustration", detail: "test", score: 0.8 },
      "test context",
      "UserPromptSubmit"
    );

    assert.equal(outcome.available, false);
    assert.equal(outcome.source, null);

    const events = readLoggedEvents(tmpCwd, config);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.delivery.delivered, false);
    assert.equal(events[0]?.delivery.suppressed_reason, "gloo_search_unavailable");
    assert.match(events[0]?.delivery.debug_detail ?? "", /Gloo search failed: 500/);
  });

  test("zero matching candidates suppresses delivery and logs no_candidates_above_threshold", async () => {
    process.env["TEST_FC_CLIENT_ID"] = "id";
    process.env["TEST_FC_CLIENT_SECRET"] = "secret";
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-fail-closed-"));

    globalThis.fetch = (async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      if (u.includes("/ai/data/v1/search")) {
        // Real search results, but none of these filenames exist in the real
        // themes.json index -- every candidate gets filtered out.
        return new Response(
          JSON.stringify({
            data: [{ uuid: "1", metadata: { certainty: 0.9, distance: 0.1 }, properties: { filename: "NOT_A_REAL_VERSE.txt" }, collection: "c" }],
            intent: 1,
          }),
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch to ${u}`);
    }) as typeof fetch;

    const config = testConfig();
    const state = newSessionState("s1");

    const outcome = await runStruggleVisiblePipeline(
      tmpCwd,
      config,
      state,
      { type: "frustration", detail: "test", score: 0.8 },
      "test context",
      "UserPromptSubmit"
    );

    assert.equal(outcome.available, false);
    const events = readLoggedEvents(tmpCwd, config);
    assert.equal(events[0]?.delivery.suppressed_reason, "no_candidates_above_threshold");
  });

  test("a real candidate and a valid selection call together produce a real delivery, logged in full", async () => {
    process.env["TEST_FC_CLIENT_ID"] = "id";
    process.env["TEST_FC_CLIENT_SECRET"] = "secret";
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-fail-closed-"));

    // Between Turns' own themes.json is the real, checked-in taxonomy --
    // pick a reference we know exists so retrieval finds a real match.
    const realThemes = JSON.parse(readFileSync(join(process.cwd(), "data", "themes.json"), "utf-8"));
    const someTheme = realThemes[0];
    const someRef = someTheme.verified_references[0];
    const filename = `${someRef.osis_ref.replace(/[.-]/g, "_")}.txt`;

    globalThis.fetch = (async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      if (u.includes("/ai/data/v1/search")) {
        return new Response(
          JSON.stringify({
            data: [{ uuid: "1", metadata: { certainty: 0.91, distance: 0.05 }, properties: { filename }, collection: "c" }],
            intent: 1,
          }),
          { status: 200 }
        );
      }
      if (u.includes("/ai/v2/chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    { function: { name: "select_verse", arguments: JSON.stringify({ selected_id: "cand_0", rationale: "test rationale" }) } },
                  ],
                },
              },
            ],
          }),
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch to ${u}`);
    }) as typeof fetch;

    const config = testConfig();
    const state = newSessionState("s1");

    const outcome = await runStruggleVisiblePipeline(
      tmpCwd,
      config,
      state,
      { type: "frustration", detail: "test", score: 0.8 },
      "test context",
      "UserPromptSubmit"
    );

    assert.equal(outcome.available, true);
    assert.equal(outcome.source?.reference_display, someRef.reference_display);
    assert.equal(outcome.source?.verse_text, someRef.verse_text);

    const events = readLoggedEvents(tmpCwd, config);
    assert.equal(events[0]?.delivery.delivered, true);
    assert.equal(events[0]?.selection?.selected_osis_ref, someRef.osis_ref);
    assert.equal(state.ambient.last_delivery_turn, state.turn_counter, "a real delivery should record pacing state");
  });
});
