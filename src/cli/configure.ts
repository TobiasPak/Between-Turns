import { createInterface } from "node:readline/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BetweenTurnsConfig } from "../types/config.js";

export interface ConfigureValues {
  tenant: string;
  publisherId: string;
  clientId: string;
  clientSecret: string;
  youversionKey?: string;
}

function loadConfig(cwd: string): BetweenTurnsConfig {
  const path = join(cwd, "between-turns.config.json");
  if (!existsSync(path)) {
    throw new Error(`No between-turns.config.json found in ${cwd} -- run \`between-turns init\` first.`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as BetweenTurnsConfig;
}

/**
 * Merges new KEY=VALUE pairs into an existing .env (or creates one) without
 * touching unrelated lines -- if a key is already present, its line is
 * updated in place; otherwise the key is appended. Never writes these values
 * anywhere git-tracked; between-turns.config.json only ever stores the env
 * var *names*, never the actual secret values.
 */
function writeEnvValues(cwd: string, values: Record<string, string>): void {
  const path = join(cwd, ".env");
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const lines = existing.split("\n").filter((l) => l.length > 0);
  const remainingKeys = new Set(Object.keys(values));

  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1 || trimmed.startsWith("#")) return line;
    const key = trimmed.slice(0, eq).trim();
    if (remainingKeys.has(key)) {
      remainingKeys.delete(key);
      return `${key}=${values[key]}`;
    }
    return line;
  });

  for (const key of remainingKeys) {
    updatedLines.push(`${key}=${values[key]}`);
  }

  writeFileSync(path, updatedLines.join("\n") + "\n");
}

/**
 * The actual, testable logic -- separated from the interactive prompting
 * below so it can be tested without simulating a terminal. Writes
 * tenant/publisher_id into the tracked config (not secrets, just identifiers
 * naming *which* tenant -- safe to have in a shared file) and writes the
 * real credentials into .env (never the tracked config).
 */
export function applyConfiguration(cwd: string, values: ConfigureValues): void {
  const config = loadConfig(cwd);
  config.gloo.tenant = values.tenant;
  config.gloo.publisher_id = values.publisherId;
  writeFileSync(join(cwd, "between-turns.config.json"), JSON.stringify(config, null, 2) + "\n");

  const envValues: Record<string, string> = {
    [config.gloo.client_id_env]: values.clientId,
    [config.gloo.client_secret_env]: values.clientSecret,
  };
  if (values.youversionKey) {
    envValues[config.youversion.api_key_env] = values.youversionKey;
  }
  writeEnvValues(cwd, envValues);
}

interface Question {
  label: string;
  current: string;
}

function promptText(q: Question): string {
  const suffix = q.current ? ` [current: ${q.current}]` : "";
  return `${q.label}${suffix}: `;
}

/**
 * Reads answers via the readline interface's async-iterator form (`for
 * await...of rl`), not repeated `rl.question()` calls -- confirmed by direct
 * testing that repeated `.question()` awaits on the same interface hang
 * indefinitely on the second call when stdin is piped/non-interactive
 * (a real, reproducible Node readline limitation, not specific to this
 * code). The iterator form reads reliably either way.
 */
async function askAll(questions: Question[]): Promise<string[]> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answers: string[] = [];
  try {
    process.stdout.write(promptText(questions[0]!));
    for await (const rawLine of rl) {
      const q = questions[answers.length]!;
      answers.push(rawLine.trim() || q.current);
      if (answers.length >= questions.length) break;
      process.stdout.write(promptText(questions[answers.length]!));
    }
  } finally {
    rl.close();
  }
  return answers;
}

export async function configure(cwd: string): Promise<void> {
  // Fails fast if init hasn't run yet, before bothering to prompt for anything.
  const existing = loadConfig(cwd);

  console.log("Configuring Between Turns with your own Gloo AI credentials.");
  console.log("Find your tenant (Publisher Name) and publisher_id in Gloo AI Studio -> Organizations -> Publishers.");
  console.log("These identify *your own* Gloo account -- Between Turns never ships with anyone else's.\n");

  const [tenant, publisherId, clientId, clientSecret, youversionKey] = await askAll([
    { label: "Gloo tenant (Publisher Name)", current: existing.gloo.tenant },
    { label: "Gloo publisher_id", current: existing.gloo.publisher_id },
    { label: "Gloo client ID", current: "" },
    { label: "Gloo client secret", current: "" },
    { label: "YouVersion API key (optional -- only needed to rebuild/expand the taxonomy yourself, press enter to skip)", current: "" },
  ]);

  applyConfiguration(cwd, {
    tenant: tenant ?? "",
    publisherId: publisherId ?? "",
    clientId: clientId ?? "",
    clientSecret: clientSecret ?? "",
    youversionKey: youversionKey || undefined,
  });

  console.log("\nSaved tenant/publisher_id to between-turns.config.json.");
  console.log("Saved credentials to .env (gitignored -- never committed, never shared).");
  console.log("\nNext: `between-turns ingest-taxonomy` to populate your tenant, then `between-turns enable`.");
}
