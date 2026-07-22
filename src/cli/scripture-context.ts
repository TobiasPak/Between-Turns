import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BetweenTurnsConfig } from "../types/config.js";
import type { RetrievedScripture } from "../types/retrieved-scripture.js";

const DEFAULT_COUNT = 10;

function loadConfig(cwd: string): BetweenTurnsConfig {
  const path = join(cwd, "between-turns.config.json");
  if (!existsSync(path)) {
    throw new Error(`No between-turns.config.json found in ${cwd}.`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as BetweenTurnsConfig;
}

function loadAllEvents(cwd: string, logDir: string): RetrievedScripture[] {
  const root = join(cwd, logDir);
  if (!existsSync(root)) {
    return [];
  }

  const events: RetrievedScripture[] = [];
  for (const dateDir of readdirSync(root, { withFileTypes: true })) {
    if (!dateDir.isDirectory()) continue;
    const dirPath = join(root, dateDir.name);
    for (const file of readdirSync(dirPath)) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(dirPath, file);
      try {
        const event = JSON.parse(readFileSync(filePath, "utf-8")) as RetrievedScripture;
        // Events logged before the timestamp field existed fall back to file
        // mtime, so old log directories don't crash this command.
        if (!event.timestamp) {
          event.timestamp = statSync(filePath).mtime.toISOString();
        }
        events.push(event);
      } catch {
        // Skip a corrupt/partial file rather than crash the whole command.
      }
    }
  }
  return events;
}

function formatEvent(e: RetrievedScripture): string {
  const lines: string[] = [];
  lines.push(`${e.timestamp}  [${e.mode}]  trigger=${e.trigger.type}  session=${e.session_id.slice(0, 8)}`);
  lines.push(`  detector: score=${e.trigger.detector_score.toFixed(2)} -- ${e.trigger.detail}`);

  if (e.candidates_offered.length > 0) {
    lines.push(`  candidates offered (${e.candidates_offered.length}):`);
    for (const c of e.candidates_offered) {
      lines.push(`    #${c.rank} ${c.osis_ref} (${c.theme_id}) certainty=${c.gloo_search_certainty.toFixed(2)}`);
    }
  }

  if (e.selection) {
    lines.push(`  selected: ${e.selection.selected_osis_ref} via ${e.selection.selection_method}`);
    lines.push(`    rationale: ${e.selection.selection_rationale}`);
    if (e.selection.excluded_as_recent.length > 0) {
      lines.push(`    excluded as recently used: ${e.selection.excluded_as_recent.join(", ")}`);
    }
  }

  if (e.generation) {
    lines.push(`  source material: "${e.generation.output_fragment}"`);
  }

  lines.push(`  delivery: ${e.delivery.delivered ? `delivered via ${e.delivery.delivery_hook}` : `suppressed (${e.delivery.suppressed_reason})`}`);
  if (e.delivery.debug_detail) {
    lines.push(`    debug: ${e.delivery.debug_detail}`);
  }

  return lines.join("\n");
}

/**
 * Near-direct dump of the per-event RetrievedScripture logs -- the same
 * artifact that makes fail-closed provable rather than just claimed (plan
 * §7), surfaced in a form a developer can actually read without opening raw
 * JSON files by hand. No summarization or reinterpretation: every field
 * shown here is read straight from the log.
 */
export function printScriptureContext(cwd: string, countArg?: string): void {
  const config = loadConfig(cwd);
  const count = countArg ? parseInt(countArg, 10) : DEFAULT_COUNT;
  if (countArg && (!Number.isFinite(count) || count <= 0)) {
    throw new Error(`Invalid count: "${countArg}". Expected a positive number.`);
  }

  const events = loadAllEvents(cwd, config.log_dir);
  if (events.length === 0) {
    console.log(`No Between Turns events logged yet in ${config.log_dir}.`);
    return;
  }

  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const shown = events.slice(0, count);

  console.log(`Showing ${shown.length} of ${events.length} logged event(s), most recent first:\n`);
  for (const event of shown) {
    console.log(formatEvent(event));
    console.log();
  }

  const delivered = events.filter((e) => e.delivery.delivered).length;
  console.log(`Total: ${events.length} event(s) -- ${delivered} delivered, ${events.length - delivered} suppressed.`);
}
