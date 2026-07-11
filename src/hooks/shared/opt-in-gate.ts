import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BetweenTurnsConfig } from "../../types/config.js";

/**
 * Cheapest possible short-circuit: a sync local file read, no session-state
 * touch, no network. Every hook entrypoint calls this first.
 */
export function isEnabled(cwd: string): boolean {
  try {
    const configPath = join(cwd, "between-turns.config.json");
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as BetweenTurnsConfig;
    return config.enabled === true;
  } catch {
    return false;
  }
}

export function loadConfig(cwd: string): BetweenTurnsConfig | null {
  try {
    const configPath = join(cwd, "between-turns.config.json");
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as BetweenTurnsConfig;
  } catch {
    return null;
  }
}
