---
description: Show the real Between Turns delivery log for this session -- what was offered, selected, why, and whether it was delivered or suppressed.
---

Run this and show its full output to the developer, unedited:

```
between-turns scripture-context $ARGUMENTS
```

If `between-turns` isn't on PATH (not installed as a package yet -- e.g. during local development of Between Turns itself, or a test repo pointed directly at its source), fall back to running it via `tsx` against wherever Between Turns' own `src/cli/index.ts` actually lives on this machine (check `.claude/settings.json`'s existing hook commands in this repo for the path other hooks already use, so this stays consistent with them), e.g.:

```
npx tsx "<path-to-between-turns>/src/cli/index.ts" scripture-context $ARGUMENTS
```

Do not summarize, reinterpret, or add commentary beyond what the command itself prints -- the point of this command is that the developer sees the real, raw log data directly, not your gloss on it. If the command errors (e.g. no `between-turns.config.json` in this repo), just show the error.
