import test from "node:test";
import assert from "node:assert/strict";
import { categories, grammar, levels, pronunciation, quizQuestions, sentenceTopics, vocabulary } from "../src/content/seedData.js";

const levelCodes = ["A1", "A2", "B1", "B2", "C1", "C2"];

test("content defines the complete CEFR progression", () => {
  assert.deepEqual(levels.map((level) => level.code), levelCodes);
  assert.equal(new Set(levels.map((level) => level.code)).size, 6);
});

test("seed content uses valid CEFR levels and stable keys", () => {
  for (const collection of [vocabulary, grammar, pronunciation, sentenceTopics, quizQuestions]) {
    assert.ok(collection.length > 0);
    for (const item of collection) assert.ok(levelCodes.includes(item.level));
  }
  assert.equal(new Set(grammar.map((item) => item.slug)).size, grammar.length);
  assert.equal(new Set(pronunciation.map((item) => item.slug)).size, pronunciation.length);
  assert.equal(new Set(sentenceTopics.map((item) => item.slug)).size, sentenceTopics.length);
});

test("learning content carries Arabic support and exercise explanations", () => {
  assert.ok(vocabulary.every((item) => item.arabic && item.example));
  assert.ok(grammar.every((item) => item.arabic && item.examples.length && item.mistakes.length));
  assert.ok(sentenceTopics.every((item) => item.arabic && item.exercises.length));
  assert.ok(categories.length >= 10);
});

test("quiz content is limited to supported skills", () => {
  const supportedSkills = new Set(["vocabulary", "grammar", "pronunciation", "sentence_structure"]);
  assert.ok(quizQuestions.every((question) => supportedSkills.has(question.skill)));
  assert.ok(quizQuestions.every((question) => question.prompt && question.answer && question.explanation));
});