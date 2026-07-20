import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { newSessionState, type SessionState } from "../types/session-state.js";

function statePath(cwd: string, sessionId: string): string {
  return join(cwd, ".between-turns", "state", `${sessionId}.json`);
}

export function loadSessionState(cwd: string, sessionId: string): SessionState {
  const path = statePath(cwd, sessionId);
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SessionState;
  } catch {
    return newSessionState(sessionId);
  }
}

/**
 * Write-to-temp-then-rename so a crash mid-write can't leave a corrupt
 * state file behind for the next hook invocation to choke on.
 */
export function saveSessionState(cwd: string, state: SessionState): void {
  const path = statePath(cwd, state.session_id);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf-8");
  renameSync(tmpPath, path);
}
