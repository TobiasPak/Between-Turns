import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSessionState, saveSessionState } from "../state/session-store.js";
import { runVisiblePipeline } from "../runtime/fail-closed.js";
import type { BetweenTurnsConfig } from "../types/config.js";
import { emitPreToolUseDeny, readHookInput } from "./shared/hook-io.js";
import { isEnabled } from "./shared/opt-in-gate.js";

function currentBranch(cwd: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Visible mode: gh pr create. Matcher in .claude/settings.json is Bash-wide;
 * this handler internally filters to `gh pr create` and exits 0 immediately
 * for every other Bash call — the cheapest possible no-op path for the
 * overwhelming majority of Bash invocations that aren't PR creation.
 *
 * Never touches `git commit` and never mutates tool args directly (plan §3) —
 * only offers source material via a deny+reason, Claude retries with its own
 * revised --body.
 */
async function main(): Promise<void> {
  const input = await readHookInput();

  if (!isEnabled(input.cwd)) {
    process.exit(0);
  }

  const command = typeof input.tool_input?.["command"] === "string" ? (input.tool_input["command"] as string) : "";
  if (!command.includes("gh pr create")) {
    process.exit(0);
  }

  const config: BetweenTurnsConfig = JSON.parse(readFileSync(join(input.cwd, "between-turns.config.json"), "utf-8"));
  if (!config.modes.visible) {
    process.exit(0);
  }

  const branch = currentBranch(input.cwd);
  const state = loadSessionState(input.cwd, input.session_id);

  if (state.visible.pr_comment_delivered_for.includes(branch)) {
    // Already offered material for this branch (this is the retry after our
    // own deny, or a second PR attempt on the same branch) -- let it through.
    process.exit(0);
  }

  const contextDescription = `The developer is opening a pull request from branch "${branch}" -- real, completed work is about to be proposed for review.`;

  const outcome = await runVisiblePipeline(
    input.cwd,
    config,
    state,
    { type: "pr_create", detail: `gh pr create on branch ${branch}`, score: 1 },
    contextDescription,
    "PreToolUse"
  );

  state.visible.pr_comment_delivered_for.push(branch);
  saveSessionState(input.cwd, state);

  if (outcome.available && outcome.source) {
    const reason = [
      "[between-turns:visible-candidate] This PR is about to be opened. You are permitted -- not obligated -- to close your PR description with a real, verified verse cited plainly in your own words, only if it's honest given the actual work in this PR:",
      `${outcome.source.reference_display}, ${outcome.source.translation}: "${outcome.source.verse_text}"`,
      `(Why this one was selected: ${outcome.source.selection_rationale})`,
      "Retry the gh pr create command with your own revised --body. This never applies to git commit messages -- only this PR description.",
    ].join("\n");
    emitPreToolUseDeny(reason);
    return;
  }

  process.exit(0);
}

main();
