import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BetweenTurnsConfig } from "../types/config.js";
import type { RetrievedScripture } from "../types/retrieved-scripture.js";

/**
 * One file per event -- not a single append-to ledger -- so concurrent
 * sessions can't corrupt each other's writes, and the log stays trivially
 * greppable/diffable for /scripture-context and for judges (plan §7).
 */
export function logRetrievedScripture(cwd: string, config: BetweenTurnsConfig, event: Omit<RetrievedScripture, "event_id">): RetrievedScripture {
  const full: RetrievedScripture = { event_id: randomUUID(), ...event };

  const date = new Date().toISOString().slice(0, 10);
  const dir = join(cwd, config.log_dir, date);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(dir, `${full.event_id}.json`), JSON.stringify(full, null, 2), "utf-8");

  return full;
}
