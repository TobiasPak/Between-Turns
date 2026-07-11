import { readHookInput } from "./shared/hook-io.js";
import { isEnabled } from "./shared/opt-in-gate.js";

/**
 * Ambient trigger #1: Bash tool failures.
 *
 * Currently a stub — exits 0 with no output once opt-in is confirmed.
 * Pacing (pacing.ts), detection (detectors.ts), and the retrieval/selection/
 * generation pipeline (see plan §6, §7) land in Week 2. Until then this hook
 * intentionally does nothing observable, which is correct fail-closed
 * behavior: no code path here can inject unverified content.
 */
async function main(): Promise<void> {
  const input = await readHookInput();

  if (!isEnabled(input.cwd)) {
    process.exit(0);
  }

  // TODO(week 2): pacing check -> detector check -> retrieval -> selection ->
  // generation -> fail-closed suppression pipeline (plan §7). For now, no-op.
  process.exit(0);
}

main();
