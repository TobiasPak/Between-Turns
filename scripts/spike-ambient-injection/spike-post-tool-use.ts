#!/usr/bin/env -S npx tsx
/**
 * Injection-point variant #1 for the ambient spike: PostToolUse, block+reason.
 * Wire this into a throwaway toy repo's .claude/settings.json (NOT this
 * project's own settings.json — the spike is deliberately isolated), paired
 * with spike-claude-md-A.md or spike-claude-md-B.md pasted into that repo's
 * CLAUDE.md. Set BT_SPIKE_PHRASING=A or B to match, purely for the log.
 *
 * Fires only on a failing Bash tool call. See README.md for the full
 * protocol (~20-30 real sessions, 4 hard-scored criteria).
 */
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import fragments from "./fragments.json" with { type: "json" };

interface StdinShape {
  session_id: string;
  tool_name?: string;
  tool_response?: { exitCode?: number; error?: string };
}

async function readStdin(): Promise<StdinShape> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
}

async function main(): Promise<void> {
  const input = await readStdin();

  const failed =
    input.tool_name === "Bash" &&
    (input.tool_response?.exitCode !== undefined ? input.tool_response.exitCode !== 0 : false);
  if (!failed) {
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
      injection_point: "post-tool-use",
      phrasing_id: phrasing,
      fragment_used: fragment,
      session_id: input.session_id,
    }) + "\n",
    "utf-8"
  );

  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason: `[between-turns:ambient-fragment] ${fragment}`,
    })
  );
}

main();
