import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimal, dependency-free .env loader -- Claude Code spawns each hook as a
 * fresh child process, which only inherits whatever's already in its own
 * parent environment. A project-local .env (written by `between-turns
 * configure`) never reaches process.env on its own; this is what actually
 * loads it. Never overrides a variable already set (e.g. a real OS env var
 * takes precedence over .env), matching standard dotenv convention -- and
 * meaning this stays a no-op for anyone using persistent OS env vars instead.
 */
export function loadDotEnv(cwd: string): void {
  const path = join(cwd, ".env");
  if (!existsSync(path)) return;

  const raw = readFileSync(path, "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
