import { readHookInput } from "./shared/hook-io.js";
import { isEnabled } from "./shared/opt-in-gate.js";

/**
 * Ambient trigger #2: frustration language in the user's prompt.
 *
 * Stub — see post-tool-use.ts for the fail-closed rationale. Detector logic
 * and the shared retrieval/selection/generation pipeline land in Week 2.
 */
async function main(): Promise<void> {
  const input = await readHookInput();

  if (!isEnabled(input.cwd)) {
    process.exit(0);
  }

  process.exit(0);
}

main();
