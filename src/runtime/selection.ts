import type { BetweenTurnsConfig } from "../types/config.js";
import { chatCompletionsForcedTool } from "./gloo-client.js";
import type { RetrievalCandidate } from "./retrieval.js";

const MODEL = "gloo-anthropic-claude-sonnet-4.5";

export interface SelectionResult {
  selected: RetrievalCandidate;
  method: "gloo_tool_choice_strict" | "fallback_top_search_match";
  rationale: string;
  schema_valid: boolean;
  id_in_candidate_set: boolean;
}

/**
 * Forced tool-choice selection among the offered candidates, using the
 * exact mechanism confirmed safe on Day 1: strict:true + additionalProperties:false
 * + an enum of candidate IDs. That test showed the constraint holds even
 * under an adversarial prompt -- but the validation below stays in place
 * regardless, as defense in depth (plan §7 step 8), not as the only guard.
 */
export async function selectCandidate(
  config: BetweenTurnsConfig,
  contextDescription: string,
  candidates: RetrievalCandidate[]
): Promise<SelectionResult | null> {
  if (candidates.length === 0) {
    return null;
  }

  const ids = candidates.map((_, i) => `cand_${i}`);
  const parametersSchema = {
    type: "object",
    properties: {
      selected_id: { type: "string", enum: ids },
      rationale: { type: "string", description: "One sentence on why this candidate fits the situation best." },
    },
    required: ["selected_id", "rationale"],
    additionalProperties: false,
  };

  try {
    const { parsed } = await chatCompletionsForcedTool<{ selected_id: string; rationale: string }>(config, {
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You select the single best-fit verse for a developer's real, specific situation, from a fixed list of pre-verified candidates. You must pick exactly one of the given IDs -- never invent a new one.",
        },
        {
          role: "user",
          content: `Situation: ${contextDescription}\n\nCandidates:\n${candidates
            .map((c, i) => `${ids[i]}: ${c.reference_display} -- "${c.verse_text}"`)
            .join("\n")}\n\nSelect the single best fit for this specific situation.`,
        },
      ],
      toolName: "select_verse",
      toolDescription: "Select the single best-fit candidate verse ID for the situation.",
      parametersSchema,
      temperature: 0.5,
      maxTokens: 300,
    });

    const idx = ids.indexOf(parsed.selected_id);
    if (idx !== -1) {
      return {
        selected: candidates[idx]!,
        method: "gloo_tool_choice_strict",
        rationale: parsed.rationale,
        schema_valid: true,
        id_in_candidate_set: true,
      };
    }
  } catch {
    // fall through to fallback below
  }

  // Invalid or failed response -- fall back to the top Gloo Search match
  // (candidates are already sorted by certainty in retrieval.ts).
  return {
    selected: candidates[0]!,
    method: "fallback_top_search_match",
    rationale: "Selection call failed or returned an out-of-set id; fell back to the top Gloo Search certainty match.",
    schema_valid: false,
    id_in_candidate_set: false,
  };
}
