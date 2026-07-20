#!/usr/bin/env -S npx tsx
/**
 * Injection-point variant #2 for the ambient spike: UserPromptSubmit,
 * additionalContext. See spike-post-tool-use.ts header for wiring notes —
 * same rules apply (isolated toy repo, paired CLAUDE.md variant).
 *
 * Fires on every prompt by default; set BT_SPIKE_PROBABILITY (0-1) to
 * sample instead, if you want prompt-triggered trials mixed in with
 * ordinary conversation rather than on every single turn.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import fragments from "./fragments.json" with { type: "json" };

interface StdinShape {
  session_id: string;
  prompt?: string;
}

async function readStdin(): Promise<StdinShape> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
}

async function main(): Promise<void> {
  const input = await readStdin();

  const probability = process.env.BT_SPIKE_PROBABILITY ? Number(process.env.BT_SPIKE_PROBABILITY) : 1.0;
  if (Math.random() > probability) {
    process.exit(0);
  }

  const fragment = fragments[Math.floor(Math.random() * fragments.length)];
  const trialId = randomUUID();
  const phrasing =
    process.env.BT_SPIKE_PHRASING === "B"
      ? "B-fixed-closing-line"
      : process.env.BT_SPIKE_PHRASING === "C"
        ? "C-consent-explicit"
        : "A-weave-anywhere";

  appendFileSync(
    join(process.cwd(), "spike-offers.jsonl"),
    JSON.stringify({
      trial_id: trialId,
      timestamp: new Date().toISOString(),
      injection_point: "user-prompt-submit",
      phrasing_id: phrasing,
      fragment_used: fragment,
      session_id: input.session_id,
    }) + "\n",
    "utf-8"
  );

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: `[between-turns:ambient-fragment] ${fragment}`,
      },
    })
  );
}

main();
