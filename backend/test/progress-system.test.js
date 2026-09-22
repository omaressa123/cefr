import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  CEFR_LEVELS,
  LEVEL_COMPLETE_PERCENT,
  assignLevelStatuses,
  buildLevelProgress,
  categoryPercent,
  overallPercent,
  summarizeLevels,
} from "../src/core/progress.js";

describe("progress calculation model", () => {
  test("categoryPercent handles empty curriculum safely (no division by zero)", () => {
    assert.equal(categoryPercent(0, 0), 0);
    assert.equal(categoryPercent(5, 0), 0);
    assert.equal(categoryPercent(3, 10), 30);
    assert.equal(categoryPercent(10, 10), 100);
    assert.equal(categoryPercent(12, 10), 100); // never above 100
  });

  test("overallPercent uses equal weights and skips empty categories", () => {
    assert.equal(
      overallPercent({
        vocabulary: { completed: 5, total: 10 },
        grammar: { completed: 10, total: 10 },
        pronunciation: { completed: 0, total: 10 },
        sentence_structure: { completed: 0, total: 0 }, // empty -> excluded
      }),
      50, // (50 + 100 + 0) / 3
    );
    assert.equal(overallPercent({}), 0);
  });

  test("buildLevelProgress counts each unit once under its own level", () => {
    const levels = buildLevelProgress({
      vocabulary: [
        { cefr_level: "A1", total: 4, completed: 2 },
        { cefr_level: "A2", total: 3, completed: 0 },
      ],
      grammar: [{ cefr_level: "A1", total: 2, completed: 2 }],
      pronunciation: [],
      sentence_structure: [{ cefr_level: "BOGUS", total: 99, completed: 99 }],
    });
    assert.equal(levels.length, 6);
    const a1 = levels.find((l) => l.code === "A1");
    assert.deepEqual([a1.total, a1.completed, a1.percent, a1.remaining], [6, 4, 67, 2]);
    const a2 = levels.find((l) => l.code === "A2");
    assert.deepEqual([a2.total, a2.completed, a2.percent], [3, 0, 0]);
    // Unknown levels are ignored, never invented
    assert.equal(levels.reduce((s, l) => s + l.total, 0), 9);
  });

  test("assignLevelStatuses: current is first incomplete level, no skipping", () => {
    const levels = assignLevelStatuses([
      { code: "A1", total: 10, completed: 10, percent: 100, remaining: 0 },
      { code: "A2", total: 10, completed: 4, percent: 40, remaining: 6 },
      { code: "B1", total: 10, completed: 10, percent: 100, remaining: 0 },
      { code: "B2", total: 0, completed: 0, percent: 0, remaining: 0 },
      { code: "C1", total: 5, completed: 0, percent: 0, remaining: 5 },
      { code: "C2", total: 5, completed: 0, percent: 0, remaining: 5 },
    ]);
    assert.deepEqual(levels.map((l) => l.status), [
      "completed", "current", "locked", "locked", "locked", "locked",
    ]);
  });

  test("assignLevelStatuses: empty level can never count as completed", () => {
    const [only] = assignLevelStatuses([
      { code: "A1", total: 0, completed: 0, percent: 0, remaining: 0 },
    ]);
    assert.equal(only.status, "current");
  });

  test("assignLevelStatuses: everything done means all completed, no current", () => {
    const levels = assignLevelStatuses(
      CEFR_LEVELS.map((code) => ({ code, total: 5, completed: 5, percent: 100, remaining: 0 })),
    );
    assert.ok(levels.every((l) => l.status === "completed"));
    const summary = summarizeLevels(levels);
    assert.equal(summary.allComplete, true);
    assert.equal(summary.currentLevel, "C2");
    assert.equal(summary.nextLevel, null);
  });

  test("summarizeLevels reports current level, remaining units and totals", () => {
    const summary = summarizeLevels(
      assignLevelStatuses([
        { code: "A1", total: 10, completed: 10, percent: 100, remaining: 0 },
        { code: "A2", total: 8, completed: 3, percent: 38, remaining: 5 },
        ...CEFR_LEVELS.slice(2).map((code) => ({ code, total: 4, completed: 0, percent: 0, remaining: 4 })),
      ]),
    );
    assert.equal(summary.currentLevel, "A2");
    assert.equal(summary.allComplete, false);
    assert.deepEqual(summary.nextLevel, { code: "A2", percent: 38, remaining: 5, total: 8 });
    assert.equal(summary.completedLevels, 1);
    assert.equal(summary.totalCompleted, 13);
    assert.equal(summary.totalUnits, 34);
  });

  test("LEVEL_COMPLETE_PERCENT threshold is strict by default", () => {
    assert.equal(LEVEL_COMPLETE_PERCENT, 100);
  });
});
