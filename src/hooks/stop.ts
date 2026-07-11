import { readHookInput } from "./shared/hook-io.js";
import { isEnabled } from "./shared/opt-in-gate.js";

/**
 * Visible mode: session debrief. Per plan §3/§6, this hook is allowed to
 * force one continuation (block+reason) at session close, but the reason
 * text must hand Claude real, verified source material and let it author
 * the closing line itself — never a dictated string.
 *
 * Stub for now. Also must respect `stop_hook_active` (Claude Code's own
 * loop guard) once real logic lands, as defense in depth against forcing
 * more than one continuation.
 */
async function main(): Promise<void> {
  const input = await readHookInput();

  if (!isEnabled(input.cwd)) {
    process.exit(0);
  }

  if (input.stop_hook_active) {
    process.exit(0);
  }

  // TODO(week 2/3): session-significance check -> retrieval/selection ->
  // emitBlockReason() with real verse as source material, Claude-authored
  // phrasing per CLAUDE.md §3. For now, no-op.
  process.exit(0);
}

main();
