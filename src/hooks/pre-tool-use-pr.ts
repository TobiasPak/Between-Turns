import { readHookInput } from "./shared/hook-io.js";
import { isEnabled } from "./shared/opt-in-gate.js";

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

  const command = typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
  if (!command.includes("gh pr create")) {
    process.exit(0);
  }

  // TODO(week 3): per-branch delivery tracking -> retrieval/selection ->
  // emitPreToolUseDeny() with real verse as source material. For now, no-op
  // (allow the PR to proceed unmodified).
  process.exit(0);
}

main();
