import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { recordToolOutcome, detectStuckLoop, detectStruggleViaGloo } from "../../src/state/detectors.js";
import { newSessionState } from "../../src/types/session-state.js";
import type { BetweenTurnsConfig } from "../../src/types/config.js";

function testConfig(): BetweenTurnsConfig {
  return {
    enabled: true,
    translation: "NIV",
    modes: { ambient: true, visible: true },
    pacing: { ambient_min_turns_between_deliveries: 8, ambient_stuck_loop_failure_threshold: 3, ambient_backoff_base_turns: 10, repetition_window: 5 },
    gloo: { tenant: "t", collection: "c", publisher_id: "p", client_id_env: "TEST_GLOO_CLIENT_ID", client_secret_env: "TEST_GLOO_CLIENT_SECRET" },
    youversion: { api_key_env: "Y" },
    log_dir: ".between-turns/logs",
  };
}

describe("recordToolOutcome", () => {
  test("an Edit call sets edit_since_last_failure and doesn't touch failure tracking", () => {
    const state = newSessionState("s1");
    recordToolOutcome(state, { toolName: "Edit", toolInput: {}, toolResponse: {}, failed: false });
    assert.equal(state.ambient.edit_since_last_failure, true);
    assert.equal(state.recent_tool_failures.length, 0);
  });

  test("a successful Bash call clears the failure streak", () => {
    const state = newSessionState("s1");
    state.recent_tool_failures = [{ turn: 1, tool: "Bash", error_signature: "x", had_edit_since_prior: true }];
    state.ambient.consecutive_failure_count = 1;
    recordToolOutcome(state, { toolName: "Bash", toolInput: {}, toolResponse: {}, failed: false });
    assert.equal(state.recent_tool_failures.length, 0);
    assert.equal(state.ambient.consecutive_failure_count, 0);
  });

  test("the first Bash failure in a streak is always recorded", () => {
    const state = newSessionState("s1");
    recordToolOutcome(state, { toolName: "Bash", toolInput: { command: "npm test" }, toolResponse: { exitCode: 1 }, failed: true });
    assert.equal(state.recent_tool_failures.length, 1);
    assert.equal(state.ambient.consecutive_failure_count, 1);
  });

  test("a second failure with no edit in between (flaky rerun / TDD red-green) is not counted", () => {
    const state = newSessionState("s1");
    recordToolOutcome(state, { toolName: "Bash", toolInput: { command: "npm test" }, toolResponse: { exitCode: 1 }, failed: true });
    // No Edit call happened here -- this is the exact "rerun the same failing test" case.
    recordToolOutcome(state, { toolName: "Bash", toolInput: { command: "npm test" }, toolResponse: { exitCode: 1 }, failed: true });
    assert.equal(state.recent_tool_failures.length, 1, "a repeat failure with no edit since should not accumulate");
  });

  test("a second failure after a real edit is counted as heterogeneous", () => {
    const state = newSessionState("s1");
    recordToolOutcome(state, { toolName: "Bash", toolInput: { command: "npm test" }, toolResponse: { exitCode: 1 }, failed: true });
    recordToolOutcome(state, { toolName: "Edit", toolInput: {}, toolResponse: {}, failed: false });
    recordToolOutcome(state, { toolName: "Bash", toolInput: { command: "npm test" }, toolResponse: { exitCode: 1 }, failed: true });
    assert.equal(state.recent_tool_failures.length, 2);
    assert.equal(state.recent_tool_failures[1]?.had_edit_since_prior, true);
  });

  test("non-Bash, non-Edit tool calls are ignored entirely", () => {
    const state = newSessionState("s1");
    recordToolOutcome(state, { toolName: "Read", toolInput: {}, toolResponse: {}, failed: false });
    assert.equal(state.recent_tool_failures.length, 0);
    assert.equal(state.ambient.edit_since_last_failure, false);
  });
});

describe("detectStuckLoop", () => {
  test("does not fire below the configured threshold", () => {
    const state = newSessionState("s1");
    const config = testConfig();
    state.recent_tool_failures = [{ turn: 1, tool: "Bash", error_signature: "a", had_edit_since_prior: true }];
    const result = detectStuckLoop(state, config);
    assert.equal(result.fired, false);
  });

  test("fires once the threshold is met and reports the latest error signature", () => {
    const state = newSessionState("s1");
    const config = testConfig();
    state.recent_tool_failures = [
      { turn: 1, tool: "Bash", error_signature: "a", had_edit_since_prior: true },
      { turn: 2, tool: "Bash", error_signature: "b", had_edit_since_prior: true },
      { turn: 3, tool: "Bash", error_signature: "c", had_edit_since_prior: true },
    ];
    const result = detectStuckLoop(state, config);
    assert.equal(result.fired, true);
    assert.equal(result.errorSignature, "c");
    assert.ok(result.score > 0 && result.score <= 1);
  });
});

describe("detectStruggleViaGloo", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env["TEST_GLOO_CLIENT_ID"];
    delete process.env["TEST_GLOO_CLIENT_SECRET"];
  });

  test("skips the API call entirely for a short affirmative", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("should not be called");
    }) as typeof fetch;

    const result = await detectStruggleViaGloo(testConfig(), "yes");
    assert.equal(result.fired, false);
    assert.equal(fetchCalled, false, "a short affirmative should never trigger a Gloo call");
  });

  test("fails closed (fired: false) when the Gloo call errors, and preserves the real error", async () => {
    process.env["TEST_GLOO_CLIENT_ID"] = "id";
    process.env["TEST_GLOO_CLIENT_SECRET"] = "secret";

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "invalid_client" }), { status: 400 })) as typeof fetch;

    const result = await detectStruggleViaGloo(testConfig(), "this is genuinely so frustrating, nothing works");
    assert.equal(result.fired, false);
    assert.match(result.detail, /gloo_struggle_judgment_unavailable/);
  });

  test("returns fired: true when Gloo judges the prompt as genuine struggle", async () => {
    process.env["TEST_GLOO_CLIENT_ID"] = "id";
    process.env["TEST_GLOO_CLIENT_SECRET"] = "secret";

    globalThis.fetch = (async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: "judge_struggle",
                      arguments: JSON.stringify({ is_struggling: true, confidence: 0.8, rationale: "genuine frustration expressed" }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const result = await detectStruggleViaGloo(testConfig(), "I am so stuck on this bug");
    assert.equal(result.fired, true);
    assert.equal(result.score, 0.8);
    assert.equal(result.detail, "genuine frustration expressed");
  });
});
