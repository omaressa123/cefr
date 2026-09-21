import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "crypto";

describe("classrooms & assignments logic", () => {
  function generateJoinCode() {
    return randomBytes(3).toString("hex").toUpperCase(); // e.g. "A1B2C3"
  }

  test("generateJoinCode produces 6-character uppercase hex strings", () => {
    const code = generateJoinCode();
    assert.equal(typeof code, "string");
    assert.equal(code.length, 6);
    assert.match(code, /^[0-9A-F]{6}$/);
  });

  test("generateJoinCode produces unique codes across iterations", () => {
    const codes = new Set();
    for (let i = 0; i < 100; i++) {
      codes.add(generateJoinCode());
    }
    assert.equal(codes.size, 100);
  });

  test("cohort report aggregation computes correct percentages", () => {
    const ERROR_CATEGORIES = [
      "subject_verb_agreement",
      "verb_tense",
      "article_determiner",
      "preposition",
    ];

    const sampleRows = [
      { errors: [{ category: "verb_tense" }] },
      { errors: [{ category: "verb_tense" }, { category: "preposition" }] },
      { errors: [{ category: "article_determiner" }] },
      { errors: [] },
    ];

    const totalTurns = sampleRows.length;
    const counts = Object.fromEntries(ERROR_CATEGORIES.map((c) => [c, 0]));

    for (const row of sampleRows) {
      const errs = Array.isArray(row.errors) ? row.errors : [];
      const seen = new Set(errs.map((e) => e.category));
      for (const category of seen) {
        if (counts[category] !== undefined) counts[category] += 1;
      }
    }

    const report = ERROR_CATEGORIES.map((category) => ({
      category,
      turnsAffectedPct: Math.round((counts[category] / totalTurns) * 100),
    })).sort((a, b) => b.turnsAffectedPct - a.turnsAffectedPct);

    assert.equal(report.find((r) => r.category === "verb_tense").turnsAffectedPct, 50); // 2 out of 4
    assert.equal(report.find((r) => r.category === "preposition").turnsAffectedPct, 25); // 1 out of 4
    assert.equal(report.find((r) => r.category === "article_determiner").turnsAffectedPct, 25); // 1 out of 4
    assert.equal(report.find((r) => r.category === "subject_verb_agreement").turnsAffectedPct, 0);
  });
});

