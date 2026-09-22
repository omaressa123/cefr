// Validation + normalization for user-submitted phrases.
// Pure functions so they can be unit-tested without a database.
import { CEFR_LEVELS } from "./progress.js";

export const PHRASE_CATEGORY_MAX = 100;
export const PHRASE_TEXT_MAX = 255;
export const PHRASE_MEANING_MAX = 2000;

export function validatePhraseInput(input = {}) {
  const errors = [];
  const phrase = String(input.phrase || "").trim();
  const meaning = String(input.meaning || "").trim();
  const category = String(input.category || "Daily").trim() || "Daily";
  const level = String(input.cefr_level || input.level || "A2").trim().toUpperCase() || "A2";

  if (!phrase) errors.push("phrase is required");
  else if (phrase.length > PHRASE_TEXT_MAX) errors.push(`phrase must be ${PHRASE_TEXT_MAX} characters or fewer`);
  if (!meaning) errors.push("meaning is required");
  else if (meaning.length > PHRASE_MEANING_MAX) errors.push(`meaning must be ${PHRASE_MEANING_MAX} characters or fewer`);
  if (category.length > PHRASE_CATEGORY_MAX) errors.push("category is too long");
  if (!CEFR_LEVELS.includes(level)) errors.push(`cefr_level must be one of ${CEFR_LEVELS.join(", ")}`);

  return {
    valid: errors.length === 0,
    errors,
    value: { phrase, meaning, category, cefr_level: level },
  };
}

export function normalizePhraseRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    phrase: row.phrase,
    meaning: row.meaning,
    category: row.category,
    cefr_level: row.cefr_level,
    level: row.cefr_level,
    favorite: row.favorite_id != null,
    created_by: row.created_by || null,
    mine: row.created_by != null,
    created_at: row.created_at || null,
  };
}
