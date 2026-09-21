import test, { describe } from "node:test";
import assert from "node:assert/strict";

describe("learning API logic & helpers", () => {
  const levels = ["A1", "A2", "B1", "B2", "C1", "C2"];

  function parseJson(value, fallback = []) {
    if (value == null) return fallback;
    if (typeof value === "object") return value;
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function parsePage(query) {
    const page = Math.max(Number.parseInt(query.page || "1", 10) || 1, 1);
    const pageSize = Math.min(Math.max(Number.parseInt(query.pageSize || "20", 10) || 20, 1), 100);
    return { page, pageSize, offset: (page - 1) * pageSize };
  }

  function validateLevel(level) {
    return !level || levels.includes(level);
  }

  test("validateLevel correctly filters standard CEFR levels", () => {
    assert.equal(validateLevel("A1"), true);
    assert.equal(validateLevel("B2"), true);
    assert.equal(validateLevel("C2"), true);
    assert.equal(validateLevel(""), true); // empty is all levels
    assert.equal(validateLevel(undefined), true);
    assert.equal(validateLevel("D1"), false);
    assert.equal(validateLevel("invalid"), false);
  });

  test("parseJson safely handles strings, arrays, objects, and corrupted inputs", () => {
    assert.deepEqual(parseJson('["apple", "banana"]'), ["apple", "banana"]);
    assert.deepEqual(parseJson({ key: "val" }), { key: "val" });
    assert.deepEqual(parseJson(null, []), []);
    assert.deepEqual(parseJson(undefined, {}), {});
    assert.deepEqual(parseJson("{ corrupted json", ["fallback"]), ["fallback"]);
  });

  test("parsePage clamps boundaries cleanly", () => {
    assert.deepEqual(parsePage({ page: "1", pageSize: "20" }), { page: 1, pageSize: 20, offset: 0 });
    assert.deepEqual(parsePage({ page: "3", pageSize: "10" }), { page: 3, pageSize: 10, offset: 20 });
    assert.deepEqual(parsePage({ page: "-5", pageSize: "500" }), { page: 1, pageSize: 100, offset: 0 }); // clamped to max 100
    assert.deepEqual(parsePage({}), { page: 1, pageSize: 20, offset: 0 });
  });

  test("recommendation mapping logic properly links weak skills to web paths", () => {
    const paths = {
      vocabulary: "/learning/vocabulary",
      grammar: "/learning/grammar",
      pronunciation: "/learning/pronunciation",
      sentence_structure: "/learning/sentences",
      speaking: "/practice/free",
    };

    const weakItems = [
      { skill: "grammar", category: "verb_tense", attempts: 5, correct: 1 },
      { skill: "vocabulary", category: "travel", attempts: 4, correct: 2 },
    ];

    const recommendations = weakItems.map((item, index) => ({
      skill: item.skill,
      title: `${item.category.replaceAll("_", " ")} practice`,
      reason: `${item.correct} correct out of ${item.attempts} attempts`,
      priority: index + 1,
      contentPath: paths[item.skill] || "/learning",
    }));

    assert.equal(recommendations.length, 2);
    assert.equal(recommendations[0].contentPath, "/learning/grammar");
    assert.equal(recommendations[0].title, "verb tense practice");
    assert.equal(recommendations[1].contentPath, "/learning/vocabulary");
  });
});

