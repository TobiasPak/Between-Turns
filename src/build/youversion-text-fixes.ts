/**
 * YouVersion's API renders the divine name as "Lord" (its small-caps LORD
 * styling collapsed to plain text) and drops the space before whatever word
 * follows it -- e.g. "the LORD our God" comes back as "the Lordour God".
 * Confirmed against the live API (not our own fetch/parsing code) and
 * confirmed narrow: only "Lord" is affected (not "GOD" or similar), and only
 * when directly followed by a lowercase letter with no space.
 */
export function fixYouVersionText(text: string): string {
  return text.replace(/\bLord(?=[a-z])/g, "Lord ");
}
