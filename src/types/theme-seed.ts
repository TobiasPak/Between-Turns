/**
 * A hand-authored theme description (data/theme-seeds.json) -- the input to
 * generate-candidates.ts, distinct from the built, verified Theme in theme.ts.
 */
export interface ThemeSeed {
  theme_id: string;
  description: string;
  example_contexts: string[];
}
