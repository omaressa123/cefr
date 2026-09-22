// Central progress-calculation model for the learning system.
//
// Design rules (do not weaken without a product decision):
// - A learning unit counts as completed ONLY when its module recorded an
//   explicit completion (vocabulary: status='learned' via Mark learned/review;
//   grammar: status='completed'; pronunciation: completed=TRUE via Mark complete;
//   sentence: completed=TRUE once correct answers cover every exercise).
// - Opening a lesson never counts as completion.
// - A CEFR level counts as completed ONLY when every eligible unit at that
//   level is completed (threshold below). The current level is derived from
//   data on every request, so a user can never be "promoted" incorrectly and
//   progress survives refresh/logout because it is read from the database.
// - Each unit is counted exactly once (UNIQUE user+unit keys in every
//   progress table; per-level aggregation groups by the unit's own level).
// - Category weights are equal unless the curriculum defines otherwise.

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

// Percent of a level's units that must be completed before the level counts
// as completed. 100 = the whole level. Lower only deliberately.
export const LEVEL_COMPLETE_PERCENT = 100;

export const CATEGORY_WEIGHTS = {
  vocabulary: 1,
  grammar: 1,
  pronunciation: 1,
  sentence_structure: 1,
};

export function categoryPercent(completed, total) {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((completed / total) * 100));
}

// Weighted mean of category percents. Equal weights by default.
export function overallPercent(metrics) {
  const entries = Object.entries(metrics).filter(
    ([skill, m]) => (CATEGORY_WEIGHTS[skill] ?? 0) > 0 && m && m.total > 0,
  );
  if (!entries.length) return 0;
  let weightedSum = 0;
  let weightTotal = 0;
  for (const [skill, m] of entries) {
    const w = CATEGORY_WEIGHTS[skill];
    weightedSum += categoryPercent(m.completed, m.total) * w;
    weightTotal += w;
  }
  return Math.round(weightedSum / weightTotal);
}

// Merge per-skill per-level counts into per-level totals.
// rowsBySkill: { skill: [{ cefr_level, total, completed }, ...] }
export function buildLevelProgress(rowsBySkill) {
  const byLevel = new Map();
  for (const level of CEFR_LEVELS) byLevel.set(level, { total: 0, completed: 0 });
  for (const rows of Object.values(rowsBySkill)) {
    for (const row of rows || []) {
      const slot = byLevel.get(row.cefr_level);
      if (!slot) continue; // ignore unknown levels, never invent units
      slot.total += Number(row.total) || 0;
      slot.completed += Number(row.completed) || 0;
    }
  }
  return CEFR_LEVELS.map((code) => {
    const { total, completed } = byLevel.get(code);
    const percent = categoryPercent(completed, total);
    return { code, total, completed, percent, remaining: Math.max(0, total - completed) };
  });
}

// Assign completed/current/locked. The current level is the first level whose
// completion is below the threshold; everything before it is completed.
// A level with zero curriculum units can never be "completed".
export function assignLevelStatuses(levelProgress, threshold = LEVEL_COMPLETE_PERCENT) {
  let currentFound = false;
  return levelProgress.map((level) => {
    let status;
    if (level.total > 0 && level.percent >= threshold && !currentFound) {
      status = "completed";
    } else if (!currentFound) {
      status = "current";
      currentFound = true;
    } else {
      status = "locked";
    }
    return { ...level, status };
  });
}

export function summarizeLevels(levelsWithStatus) {
  const current = levelsWithStatus.find((l) => l.status === "current") || null;
  const completedLevels = levelsWithStatus.filter((l) => l.status === "completed").length;
  const totalCompleted = levelsWithStatus.reduce((s, l) => s + l.completed, 0);
  const totalUnits = levelsWithStatus.reduce((s, l) => s + l.total, 0);
  return {
    currentLevel: current ? current.code : "C2",
    allComplete: !current,
    nextLevel: current
      ? { code: current.code, percent: current.percent, remaining: current.remaining, total: current.total }
      : null,
    completedLevels,
    totalCompleted,
    totalUnits,
  };
}
