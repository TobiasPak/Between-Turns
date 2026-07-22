import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluateAmbientPacing, recordDelivery, excludeRecentSelections } from "../../src/state/pacing.js";
import { newSessionState } from "../../src/types/session-state.js";
import type { BetweenTurnsConfig } from "../../src/types/config.js";

function testConfig(overrides: Partial<BetweenTurnsConfig["pacing"]> = {}): BetweenTurnsConfig {
  return {
    enabled: true,
    translation: "NIV",
    modes: { ambient: true, visible: true },
    pacing: {
      ambient_min_turns_between_deliveries: 8,
      ambient_stuck_loop_failure_threshold: 3,
      ambient_backoff_base_turns: 10,
      repetition_window: 5,
      ...overrides,
    },
    gloo: { tenant: "t", collection: "c", publisher_id: "p", client_id_env: "A", client_secret_env: "B" },
    youversion: { api_key_env: "Y" },
    log_dir: ".between-turns/logs",
  };
}

describe("evaluateAmbientPacing", () => {
  test("allows the first delivery in a fresh session", () => {
    const state = newSessionState("s1");
    const config = testConfig();
    const decision = evaluateAmbientPacing(state, config, { type: "frustration" });
    assert.equal(decision.allowed, true);
  });

  test("blocks a second delivery inside the spacing floor", () => {
    const state = newSessionState("s1");
    const config = testConfig({ ambient_min_turns_between_deliveries: 8 });
    state.turn_counter = 5;
    state.ambient.last_delivery_turn = 2; // 3 turns since last delivery, floor is 8
    const decision = evaluateAmbientPacing(state, config, { type: "frustration" });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "spacing_floor");
  });

  test("allows a delivery once the spacing floor has passed", () => {
    const state = newSessionState("s1");
    const config = testConfig({ ambient_min_turns_between_deliveries: 8 });
    state.turn_counter = 10;
    state.ambient.last_delivery_turn = 2; // 8 turns since last delivery, floor is 8
    const decision = evaluateAmbientPacing(state, config, { type: "frustration" });
    assert.equal(decision.allowed, true);
  });

  test("circuit breaker blocks delivery while backoff is active", () => {
    const state = newSessionState("s1");
    const config = testConfig();
    state.turn_counter = 5;
    state.ambient.false_positive_backoff_until_turn = 20;
    const decision = evaluateAmbientPacing(state, config, { type: "frustration" });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "circuit_breaker_backoff_active");
  });

  test("a recurring stuck-loop signature right after a delivery escalates backoff instead of just re-applying the floor", () => {
    const state = newSessionState("s1");
    const config = testConfig({ ambient_min_turns_between_deliveries: 8, ambient_backoff_base_turns: 10 });
    state.turn_counter = 5;
    state.ambient.last_delivery_turn = 2;
    state.ambient.stuck_loop_signature = "same-error-hash";
    state.ambient.cooldown_strikes = 0;

    const decision = evaluateAmbientPacing(state, config, { type: "stuck_loop", errorSignature: "same-error-hash" });

    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "recurring_signature_backoff");
    assert.equal(state.ambient.cooldown_strikes, 1);
    // backoff = base(10) * 2^1 = 20 turns from the current turn (5)
    assert.equal(state.ambient.false_positive_backoff_until_turn, 25);
  });

  test("cooldown strikes cap at 3", () => {
    const state = newSessionState("s1");
    const config = testConfig({ ambient_min_turns_between_deliveries: 8, ambient_backoff_base_turns: 10 });
    state.ambient.cooldown_strikes = 3;
    state.turn_counter = 5;
    state.ambient.last_delivery_turn = 2;
    state.ambient.stuck_loop_signature = "same-error-hash";

    evaluateAmbientPacing(state, config, { type: "stuck_loop", errorSignature: "same-error-hash" });

    assert.equal(state.ambient.cooldown_strikes, 3, "strikes should not exceed the cap of 3");
  });

  test("a different stuck-loop signature is not treated as recurring", () => {
    const state = newSessionState("s1");
    const config = testConfig({ ambient_min_turns_between_deliveries: 8 });
    state.turn_counter = 5;
    state.ambient.last_delivery_turn = 2;
    state.ambient.stuck_loop_signature = "some-other-error";

    // Different signature, and still within the spacing floor -- so this
    // should fall through to the plain spacing_floor reason, not the
    // recurring-signature backoff (that's only for the *same* signature).
    const decision = evaluateAmbientPacing(state, config, { type: "stuck_loop", errorSignature: "a-new-error" });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "spacing_floor");
  });
});

describe("recordDelivery", () => {
  test("sets last_delivery_turn and resets backoff state for ambient mode", () => {
    const state = newSessionState("s1");
    const config = testConfig();
    state.turn_counter = 7;
    state.ambient.cooldown_strikes = 2;
    state.ambient.false_positive_backoff_until_turn = 50;

    recordDelivery(state, config, { osisRef: "ROM.5.3-4", mode: "ambient" });

    assert.equal(state.ambient.last_delivery_turn, 7);
    assert.equal(state.ambient.cooldown_strikes, 0);
    assert.equal(state.ambient.false_positive_backoff_until_turn, null);
  });

  test("does not touch ambient-specific fields for visible mode", () => {
    const state = newSessionState("s1");
    const config = testConfig();
    state.turn_counter = 7;

    recordDelivery(state, config, { osisRef: "ROM.5.3-4", mode: "visible" });

    assert.equal(state.ambient.last_delivery_turn, null);
  });

  test("records the stuck-loop signature when provided", () => {
    const state = newSessionState("s1");
    const config = testConfig();
    recordDelivery(state, config, { osisRef: "ROM.5.3-4", mode: "ambient", stuckLoopSignature: "err-hash-123" });
    assert.equal(state.ambient.stuck_loop_signature, "err-hash-123");
  });

  test("appends to recent_selections regardless of mode, and evicts beyond the repetition window", () => {
    const state = newSessionState("s1");
    const config = testConfig({}); // repetition_window: 5

    for (let i = 0; i < 7; i++) {
      recordDelivery(state, config, { osisRef: `REF.${i}`, mode: i % 2 === 0 ? "ambient" : "visible" });
    }

    assert.equal(state.recent_selections.length, 5, "should evict down to the repetition window size");
    assert.deepEqual(state.recent_selections, ["REF.2", "REF.3", "REF.4", "REF.5", "REF.6"]);
  });
});

describe("excludeRecentSelections", () => {
  test("filters out candidates whose osis_ref is in the recent window", () => {
    const state = newSessionState("s1");
    state.recent_selections = ["ROM.5.3-4", "JAS.1.2-4"];

    const candidates = [
      { osis_ref: "ROM.5.3-4" },
      { osis_ref: "PSA.23.1" },
      { osis_ref: "JAS.1.2-4" },
      { osis_ref: "PRO.24.16" },
    ];

    const result = excludeRecentSelections(candidates, state);
    assert.deepEqual(
      result.map((c) => c.osis_ref),
      ["PSA.23.1", "PRO.24.16"]
    );
  });

  test("returns everything unchanged when nothing has been used recently", () => {
    const state = newSessionState("s1");
    const candidates = [{ osis_ref: "PSA.23.1" }];
    assert.deepEqual(excludeRecentSelections(candidates, state), candidates);
  });
});
