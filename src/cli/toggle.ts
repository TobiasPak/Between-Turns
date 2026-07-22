import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BetweenTurnsConfig } from "../types/config.js";

function configPath(cwd: string): string {
  return join(cwd, "between-turns.config.json");
}

function loadConfig(cwd: string): BetweenTurnsConfig {
  const path = configPath(cwd);
  if (!existsSync(path)) {
    throw new Error(`No between-turns.config.json found in ${cwd} -- Between Turns must already be set up in this repo.`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as BetweenTurnsConfig;
}

function saveConfig(cwd: string, config: BetweenTurnsConfig): void {
  writeFileSync(configPath(cwd), JSON.stringify(config, null, 2) + "\n");
}

interface GhPreflightResult {
  installed: boolean;
  authenticated: boolean;
  detail: string;
}

/**
 * A checked prerequisite with clear messaging, not a silent auto-install --
 * installing system software as an unannounced side effect of enabling a
 * feature isn't appropriate, even though it's a one-line winget/brew command.
 * This exists because a real live test showed the alternative: the verse
 * gets drafted correctly into a PR body, but the actual `gh pr create` never
 * runs, with nothing anywhere pointing at `gh` as the cause.
 */
function checkGhPreflight(): GhPreflightResult {
  try {
    execSync("gh --version", { stdio: "ignore" });
  } catch {
    return { installed: false, authenticated: false, detail: "`gh` (GitHub CLI) isn't installed or isn't on PATH." };
  }
  try {
    execSync("gh auth status", { stdio: "ignore" });
    return { installed: true, authenticated: true, detail: "gh is installed and authenticated." };
  } catch {
    return { installed: true, authenticated: false, detail: "`gh` is installed but not authenticated." };
  }
}

function printGhNote(gh: GhPreflightResult): void {
  console.log();
  console.log("Note: the PR-closing trigger (gh pr create) needs GitHub CLI set up.");
  console.log(gh.detail);
  if (!gh.installed) console.log("Install: https://cli.github.com");
  if (gh.installed && !gh.authenticated) console.log("Authenticate: gh auth login");
  console.log("Everything else -- struggle-moment and session-close delivery -- works without this.");
}

export function enable(cwd: string): void {
  const config = loadConfig(cwd);
  config.enabled = true;
  saveConfig(cwd, config);
  console.log("Between Turns is now enabled for this repo.");

  const gh = checkGhPreflight();
  if (!gh.installed || !gh.authenticated) {
    printGhNote(gh);
  }
}

export function disable(cwd: string): void {
  const config = loadConfig(cwd);
  config.enabled = false;
  saveConfig(cwd, config);
  console.log("Between Turns is now disabled for this repo.");
}

export function status(cwd: string): void {
  const config = loadConfig(cwd);
  console.log(`Between Turns is currently ${config.enabled ? "enabled" : "disabled"} for this repo.`);
  console.log(`  translation: ${config.translation}`);
  console.log(`  modes: ambient=${config.modes.ambient} visible=${config.modes.visible}`);

  const gh = checkGhPreflight();
  const ghSummary = gh.installed ? `installed, ${gh.authenticated ? "authenticated" : "not authenticated"}` : "not installed";
  console.log(`  gh CLI: ${ghSummary}`);
  if (!gh.installed || !gh.authenticated) {
    printGhNote(gh);
  }
}
