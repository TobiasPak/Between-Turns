import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fixYouVersionText } from "../../src/build/youversion-text-fixes.js";

describe("fixYouVersionText", () => {
  test("inserts the missing space after LORD collapsed to 'Lord' before a lowercase word (regression: DEU.29.29)", () => {
    const broken = "the Lordour God has not revealed";
    assert.equal(fixYouVersionText(broken), "the Lord our God has not revealed");
  });

  test("inserts the missing space for another real case (regression: EXO.39.32-43)", () => {
    const broken = "just as the Lordhad commanded Moses";
    assert.equal(fixYouVersionText(broken), "just as the Lord had commanded Moses");
  });

  test("leaves 'Lord' followed by a space untouched", () => {
    const clean = "the Lord our God";
    assert.equal(fixYouVersionText(clean), clean);
  });

  test("leaves 'Lord' at the end of a string untouched (no following character at all)", () => {
    const clean = "praise the Lord";
    assert.equal(fixYouVersionText(clean), clean);
  });

  test("does not touch 'Lord' followed by punctuation or uppercase", () => {
    const text = "O Lord, my God! The LORD Almighty";
    assert.equal(fixYouVersionText(text), text);
  });

  test("known limitation: a genuine word starting with 'Lord' (e.g. 'Lordship') gets a spurious space inserted", () => {
    // This is a real, narrow gap: the regex can't distinguish "Lord" glued to
    // a following word (the actual bug) from "Lord" as a literal prefix of a
    // longer real word -- both look identical at the character level. Never
    // observed in the real NIV corpus this function actually processes (no
    // verse in data/themes.json triggers it), so it's accepted as-is rather
    // than solved with a dictionary/word-boundary heuristic. Documented here
    // so the tradeoff is explicit, not silently assumed correct.
    assert.equal(fixYouVersionText("Wordplay and Lordship are different"), "Wordplay and Lord ship are different");
  });

  test("handles multiple occurrences in the same passage", () => {
    const broken = "the Lordblessed him and the Lordwas with him";
    assert.equal(fixYouVersionText(broken), "the Lord blessed him and the Lord was with him");
  });
});
