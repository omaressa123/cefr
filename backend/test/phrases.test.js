import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { normalizePhraseRow, validatePhraseInput } from "../src/core/phrases.js";

describe("phrases input validation", () => {
  test("accepts a complete valid phrase", () => {
    const result = validatePhraseInput({ phrase: "Break the ice", meaning: "Start a conversation", category: "Social", cefr_level: "A2" });
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    assert.equal(result.value.phrase, "Break the ice");
  });

  test("applies sensible defaults for category and level", () => {
    const result = validatePhraseInput({ phrase: "Hi", meaning: "Hello" });
    assert.equal(result.valid, true);
    assert.equal(result.value.category, "Daily");
    assert.equal(result.value.cefr_level, "A2");
  });

  test("rejects missing phrase or meaning", () => {
    assert.equal(validatePhraseInput({ meaning: "x" }).valid, false);
    assert.equal(validatePhraseInput({ phrase: "x" }).valid, false);
    assert.equal(validatePhraseInput({}).valid, false);
  });

  test("rejects invalid CEFR level and oversized text", () => {
    assert.equal(validatePhraseInput({ phrase: "x", meaning: "y", cefr_level: "Z9" }).valid, false);
    assert.equal(validatePhraseInput({ phrase: "x".repeat(300), meaning: "y" }).valid, false);
  });

  test("normalizePhraseRow maps favorite flag and ownership", () => {
    const fav = normalizePhraseRow({ id: "1", phrase: "a", meaning: "b", category: "c", cefr_level: "A1", favorite_id: "f", created_by: "u" });
    assert.equal(fav.favorite, true);
    assert.equal(fav.mine, true);
    const plain = normalizePhraseRow({ id: "2", phrase: "a", meaning: "b", category: "c", cefr_level: "A1", favorite_id: null, created_by: null });
    assert.equal(plain.favorite, false);
    assert.equal(plain.mine, false);
    assert.equal(normalizePhraseRow(null), null);
  });
});
