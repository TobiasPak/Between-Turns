import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BetweenTurnsConfig } from "../types/config.js";
import type { ThemeSeed } from "../types/theme-seed.js";
import { chatCompletionsForcedTool } from "../runtime/gloo-client.js";

const REPO_ROOT = process.cwd();
const MODEL = "gloo-anthropic-claude-sonnet-4.5";
const CANDIDATES_PER_THEME = 5;

interface CandidateProposal {
  osis_ref: string;
  rationale: string;
}

interface ProposeCandidatesResult {
  candidates: CandidateProposal[];
}

function loadConfig(): BetweenTurnsConfig {
  return JSON.parse(readFileSync(join(REPO_ROOT, "between-turns.config.json"), "utf-8"));
}

function loadThemeSeeds(): ThemeSeed[] {
  return JSON.parse(readFileSync(join(REPO_ROOT, "data", "theme-seeds.json"), "utf-8"));
}

async function generateForTheme(
  config: BetweenTurnsConfig,
  theme: ThemeSeed
): Promise<{ candidates: CandidateProposal[]; raw: unknown }> {
  const parametersSchema = {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        minItems: CANDIDATES_PER_THEME,
        maxItems: CANDIDATES_PER_THEME,
        items: {
          type: "object",
          properties: {
            osis_ref: {
              type: "string",
              description:
                "OSIS/USFM style reference: three-letter book code, chapter.verse, hyphenated ranges, no spaces. e.g. ROM.5.3-4 or JHN.3.16.",
            },
            rationale: { type: "string", description: "One sentence on why this verse fits the theme." },
          },
          required: ["osis_ref", "rationale"],
          additionalProperties: false,
        },
      },
    },
    required: ["candidates"],
    additionalProperties: false,
  };

  const { parsed, raw } = await chatCompletionsForcedTool<ProposeCandidatesResult>(config, {
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You propose real, well-known Bible verse or short-passage references that genuinely fit a given theme, for a downstream pipeline that will independently verify every reference against a licensed Bible API and discard anything that doesn't resolve or doesn't hold up on review. Propose your honest best candidates, including ones you're only moderately confident about -- do not pad with irrelevant filler just to fill a quota. Use OSIS/USFM book codes (three letters, e.g. GEN, ROM, 1CO, JAS, REV), chapter.verse format, hyphenated ranges for passages (e.g. ROM.5.3-4), no spaces.",
      },
      {
        role: "user",
        content: `Theme: "${theme.description}"\nExample contexts where this theme applies: ${theme.example_contexts.join(
          "; "
        )}.\nPropose ${CANDIDATES_PER_THEME} distinct real Bible verse or short-passage references that fit this theme, each with a one-sentence rationale.`,
      },
    ],
    toolName: "propose_candidates",
    toolDescription: "Propose candidate Bible verse references for the given theme.",
    parametersSchema,
    temperature: 0.8,
    maxTokens: 1200,
  });

  return { candidates: parsed.candidates, raw };
}

async function main(): Promise<void> {
  const config = loadConfig();
  let themes = loadThemeSeeds();

  const limit = process.argv[2] ? Number(process.argv[2]) : undefined;
  if (limit) {
    themes = themes.slice(0, limit);
  }

  const rawLogDir = join(REPO_ROOT, "data", "build-logs", "candidates-raw");
  mkdirSync(rawLogDir, { recursive: true });

  const results: { theme_id: string; candidates: CandidateProposal[] }[] = [];
  let totalProposed = 0;
  let failures = 0;

  for (const theme of themes) {
    process.stdout.write(`${theme.theme_id}... `);
    try {
      const { candidates, raw } = await generateForTheme(config, theme);
      writeFileSync(
        join(rawLogDir, `${theme.theme_id}.json`),
        JSON.stringify({ theme_id: theme.theme_id, request_model: MODEL, candidates, raw }, null, 2)
      );
      results.push({ theme_id: theme.theme_id, candidates });
      totalProposed += candidates.length;
      console.log(`ok (${candidates.length})`);
    } catch (err) {
      console.log(`FAILED: ${(err as Error).message}`);
      results.push({ theme_id: theme.theme_id, candidates: [] });
      failures++;
    }
  }

  const outPath = join(REPO_ROOT, "data", "build-logs", "candidates.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        model: MODEL,
        total_themes: themes.length,
        total_proposed: totalProposed,
        failed_themes: failures,
        results,
      },
      null,
      2
    )
  );

  console.log(`\nDone. ${totalProposed} candidates proposed across ${themes.length} themes (${failures} failed).`);
  console.log(`Aggregate: ${outPath}`);
  console.log(`Per-theme raw logs: ${rawLogDir}`);
}

main();
