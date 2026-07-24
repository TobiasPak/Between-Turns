import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../../src/cli/init.js";
import { applyConfiguration } from "../../src/cli/configure.js";

describe("applyConfiguration", () => {
  let tmpCwd: string;

  afterEach(() => {
    if (tmpCwd) rmSync(tmpCwd, { recursive: true, force: true });
  });

  test("writes tenant/publisher_id into the tracked config, and credentials into .env", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-configure-"));
    init(tmpCwd);

    applyConfiguration(tmpCwd, {
      tenant: "MyOwnTenant",
      publisherId: "my-publisher-uuid",
      clientId: "my-client-id",
      clientSecret: "my-client-secret",
    });

    const config = JSON.parse(readFileSync(join(tmpCwd, "between-turns.config.json"), "utf-8"));
    assert.equal(config.gloo.tenant, "MyOwnTenant");
    assert.equal(config.gloo.publisher_id, "my-publisher-uuid");

    const env = readFileSync(join(tmpCwd, ".env"), "utf-8");
    assert.match(env, /GLOO_CLIENT_ID=my-client-id/);
    assert.match(env, /GLOO_CLIENT_SECRET=my-client-secret/);
  });

  test("never writes the actual secret values into between-turns.config.json", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-configure-"));
    init(tmpCwd);
    applyConfiguration(tmpCwd, { tenant: "T", publisherId: "P", clientId: "secret-client-id-value", clientSecret: "secret-value-xyz" });

    const configRaw = readFileSync(join(tmpCwd, "between-turns.config.json"), "utf-8");
    assert.ok(!configRaw.includes("secret-client-id-value"), "the tracked config must never contain the actual credential value");
    assert.ok(!configRaw.includes("secret-value-xyz"));
  });

  test("only writes the YouVersion key when one is actually provided", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-configure-"));
    init(tmpCwd);
    applyConfiguration(tmpCwd, { tenant: "T", publisherId: "P", clientId: "id", clientSecret: "secret" });

    const env = readFileSync(join(tmpCwd, ".env"), "utf-8");
    assert.ok(!env.includes("YOUVERSION_API_KEY"), "should not write an empty/skipped YouVersion key");
  });

  test("writes the YouVersion key when provided", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-configure-"));
    init(tmpCwd);
    applyConfiguration(tmpCwd, { tenant: "T", publisherId: "P", clientId: "id", clientSecret: "secret", youversionKey: "yv-key-123" });

    const env = readFileSync(join(tmpCwd, ".env"), "utf-8");
    assert.match(env, /YOUVERSION_API_KEY=yv-key-123/);
  });

  test("updates an existing .env value in place rather than duplicating the key", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-configure-"));
    init(tmpCwd);
    writeFileSync(join(tmpCwd, ".env"), "SOME_OTHER_VAR=keep-me\nGLOO_CLIENT_ID=old-value\n");

    applyConfiguration(tmpCwd, { tenant: "T", publisherId: "P", clientId: "new-value", clientSecret: "secret" });

    const env = readFileSync(join(tmpCwd, ".env"), "utf-8");
    const clientIdLines = env.split("\n").filter((l) => l.startsWith("GLOO_CLIENT_ID="));
    assert.equal(clientIdLines.length, 1, "must not duplicate the key");
    assert.equal(clientIdLines[0], "GLOO_CLIENT_ID=new-value");
    assert.match(env, /SOME_OTHER_VAR=keep-me/, "unrelated existing values must survive untouched");
  });

  test("throws a clear error if init hasn't been run yet", () => {
    tmpCwd = mkdtempSync(join(tmpdir(), "bt-configure-"));
    assert.throws(
      () => applyConfiguration(tmpCwd, { tenant: "T", publisherId: "P", clientId: "id", clientSecret: "secret" }),
      /run `between-turns init` first/
    );
  });
});
