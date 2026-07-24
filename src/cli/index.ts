#!/usr/bin/env node
import { disable, enable, status } from "./toggle.js";
import { printScriptureContext } from "./scripture-context.js";
import { init } from "./init.js";
import { configure } from "./configure.js";
import { ingestTaxonomy } from "./ingest-taxonomy.js";
import { loadDotEnv } from "../hooks/shared/load-env.js";

const HOOK_MODULES: Record<string, string> = {
  "post-tool-use": "../hooks/post-tool-use.js",
  "user-prompt-submit": "../hooks/user-prompt-submit.js",
  stop: "../hooks/stop.js",
  "pre-tool-use-pr": "../hooks/pre-tool-use-pr.js",
};

async function main(): Promise<void> {
  const [command, sub] = process.argv.slice(2);
  loadDotEnv(process.cwd());

  if (command === "hook") {
    const modulePath = sub ? HOOK_MODULES[sub] : undefined;
    if (!modulePath) {
      console.error(`unknown hook: ${sub}. Expected one of: ${Object.keys(HOOK_MODULES).join(", ")}`);
      process.exit(1);
    }
    await import(new URL(modulePath, import.meta.url).href);
    return;
  }

  if (command === "init") {
    try {
      init(process.cwd());
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
    return;
  }

  if (command === "configure") {
    try {
      await configure(process.cwd());
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
    return;
  }

  if (command === "ingest-taxonomy") {
    try {
      await ingestTaxonomy(process.cwd());
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
    return;
  }

  if (command === "enable" || command === "disable" || command === "status") {
    try {
      if (command === "enable") enable(process.cwd());
      else if (command === "disable") disable(process.cwd());
      else status(process.cwd());
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
    return;
  }

  if (command === "scripture-context") {
    try {
      printScriptureContext(process.cwd(), sub);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
    return;
  }

  console.error("usage: between-turns <init|configure|ingest-taxonomy|hook <name>|enable|disable|status|scripture-context [n]>");
  process.exit(1);
}

main();
