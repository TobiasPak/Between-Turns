export interface ClaudeCodeHookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  prompt?: string;
  stop_hook_active?: boolean;
}

export async function readHookInput(): Promise<ClaudeCodeHookInput> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) {
    throw new Error("no hook input on stdin");
  }
  return JSON.parse(raw) as ClaudeCodeHookInput;
}

export function emitAdditionalContext(hookEventName: string, additionalContext: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName,
        additionalContext,
      },
    })
  );
}

export function emitBlockReason(reason: string): void {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

export function emitPreToolUseDeny(reason: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })
  );
}

export function noop(): void {
  process.exit(0);
}
