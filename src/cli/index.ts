#!/usr/bin/env node
import { fileURLToPath } from "node:url";

const HOOK_MODULES: Record<string, string> = {
  "post-tool-use": "../hooks/post-tool-use.js",
  "user-prompt-submit": "../hooks/user-prompt-submit.js",
  stop: "../hooks/stop.js",
  "pre-tool-use-pr": "../hooks/pre-tool-use-pr.js",
};

async function main(): Promise<void> {
  const [command, sub] = process.argv.slice(2);

  if (command === "hook") {
    const modulePath = sub ? HOOK_MODULES[sub] : undefined;
    if (!modulePath) {
      console.error(`unknown hook: ${sub}. Expected one of: ${Object.keys(HOOK_MODULES).join(", ")}`);
      process.exit(1);
    }
    await import(new URL(modulePath, import.meta.url).href);
    return;
  }

  if (command === "enable" || command === "disable" || command === "status") {
    // TODO(week 3): implemented in toggle.ts.
    console.error(`\`between-turns ${command}\` is not implemented yet.`);
    process.exit(1);
  }

  console.error("usage: between-turns <hook <name>|enable|disable|status>");
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
