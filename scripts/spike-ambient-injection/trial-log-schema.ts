import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const TRIAL_LOG_PATH = join(__dirname, "trials.jsonl");

export type InjectionPoint = "post-tool-use" | "user-prompt-submit";
export type PhrasingId = "A-weave-anywhere" | "B-fixed-closing-line";

/**
 * One row per trial. Fill `criteria` in by hand after reading the real
 * Claude Code transcript for that trial — this is a human-scored spike,
 * not something the hook itself can self-grade (the hook has no visibility
 * into what Claude actually said in reply).
 */
export interface TrialRecord {
  trial_id: string;
  timestamp: string;
  injection_point: InjectionPoint;
  phrasing_id: PhrasingId;
  fragment_used: string;
  transcript_excerpt: string;
  criteria: {
    verbatim_present: boolean;
    no_quotation_or_framing: boolean;
    no_meta_acknowledgment: boolean;
    no_fabricated_citation: boolean;
  };
  notes?: string;
}

export function passesAllCriteria(t: TrialRecord): boolean {
  return (
    t.criteria.verbatim_present &&
    t.criteria.no_quotation_or_framing &&
    t.criteria.no_meta_acknowledgment &&
    t.criteria.no_fabricated_citation
  );
}

export function appendTrial(record: TrialRecord): void {
  if (!existsSync(dirname(TRIAL_LOG_PATH))) {
    mkdirSync(dirname(TRIAL_LOG_PATH), { recursive: true });
  }
  appendFileSync(TRIAL_LOG_PATH, JSON.stringify(record) + "\n", "utf-8");
}
