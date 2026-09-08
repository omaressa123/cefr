import { v5 as uuid } from "uuid";
import { pool } from "./pool.js";
import { categories, grammar, levels, pronunciation, quizQuestions, sentenceTopics, vocabulary } from "../content/seedData.js";

const NAMESPACE = "3d0c7b8e-9c3a-4f8c-9b09-8f4bf91e30dc";
const idFor = (kind, key) => uuid(`${kind}:${key}`, NAMESPACE);

async function seed() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const level of levels) {
      await connection.query(
        `INSERT INTO cefr_levels (code, title, description, sort_order) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), description = VALUES(description), sort_order = VALUES(sort_order)`,
        [level.code, level.title, level.description, level.sortOrder],
      );
    }

    const categoryIds = new Map();
    for (const category of categories) {
      const id = idFor("category", category.slug);
      categoryIds.set(category.slug, id);
      await connection.query(
        `INSERT INTO vocabulary_categories (id, slug, name) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        [id, category.slug, category.name],
      );
    }

    for (const item of vocabulary) {
      await connection.query(
        `INSERT INTO vocabulary
          (id, cefr_level, category_id, word, part_of_speech, definition, arabic_translation, example_sentence, pronunciation, audio_text, synonyms, antonyms, word_family, common_mistakes, related_words, usefulness)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE category_id = VALUES(category_id), part_of_speech = VALUES(part_of_speech), definition = VALUES(definition), arabic_translation = VALUES(arabic_translation), example_sentence = VALUES(example_sentence), pronunciation = VALUES(pronunciation), audio_text = VALUES(audio_text), synonyms = VALUES(synonyms), antonyms = VALUES(antonyms), word_family = VALUES(word_family), common_mistakes = VALUES(common_mistakes), related_words = VALUES(related_words), usefulness = VALUES(usefulness)`,
        [idFor("vocabulary", `${item.level}:${item.word}`), item.level, categoryIds.get(item.category), item.word, item.partOfSpeech, item.definition, item.arabic, item.example, item.pronunciation, item.word, JSON.stringify(item.synonyms), JSON.stringify(item.antonyms), JSON.stringify(item.family), item.mistakes, JSON.stringify(item.related), item.usefulness],
      );
    }

    for (const item of grammar) {
      await connection.query(
        `INSERT INTO grammar_topics (id, cefr_level, slug, title, category, difficulty, explanation, arabic_explanation, examples, common_mistakes, prerequisites, related_topics)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE cefr_level = VALUES(cefr_level), title = VALUES(title), category = VALUES(category), difficulty = VALUES(difficulty), explanation = VALUES(explanation), arabic_explanation = VALUES(arabic_explanation), examples = VALUES(examples), common_mistakes = VALUES(common_mistakes), prerequisites = VALUES(prerequisites), related_topics = VALUES(related_topics)`,
        [idFor("grammar", item.slug), item.level, item.slug, item.title, item.category, item.difficulty, item.explanation, item.arabic, JSON.stringify(item.examples), JSON.stringify(item.mistakes), JSON.stringify(item.prerequisites), JSON.stringify(item.related)],
      );
    }

    for (const item of pronunciation) {
      const lessonId = idFor("pronunciation", item.slug);
      await connection.query(
        `INSERT INTO pronunciation_lessons (id, cefr_level, slug, title, sound, mouth_position, tongue_position, voiced, explanation, example_words, minimal_pairs, common_mistakes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE cefr_level = VALUES(cefr_level), title = VALUES(title), sound = VALUES(sound), mouth_position = VALUES(mouth_position), tongue_position = VALUES(tongue_position), voiced = VALUES(voiced), explanation = VALUES(explanation), example_words = VALUES(example_words), minimal_pairs = VALUES(minimal_pairs), common_mistakes = VALUES(common_mistakes)`,
        [lessonId, item.level, item.slug, item.title, item.sound, item.mouth, item.tongue, item.voiced, item.explanation, JSON.stringify(item.words), JSON.stringify(item.pairs), JSON.stringify(item.mistakes)],
      );
      for (const [index, exercise] of item.exercises.entries()) {
        await connection.query(
          `INSERT INTO pronunciation_exercises (id, lesson_id, prompt, target_text, phonetic_text, exercise_type, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE prompt = VALUES(prompt), target_text = VALUES(target_text), phonetic_text = VALUES(phonetic_text), exercise_type = VALUES(exercise_type), sort_order = VALUES(sort_order)`,
          [idFor("pronunciation-exercise", `${item.slug}:${index}`), lessonId, exercise.prompt, exercise.target, exercise.phonetic, exercise.type, index],
        );
      }
    }

    for (const item of sentenceTopics) {
      const topicId = idFor("sentence-topic", item.slug);
      await connection.query(
        `INSERT INTO sentence_structure_topics (id, cefr_level, slug, title, explanation, arabic_explanation, examples)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE cefr_level = VALUES(cefr_level), title = VALUES(title), explanation = VALUES(explanation), arabic_explanation = VALUES(arabic_explanation), examples = VALUES(examples)`,
        [topicId, item.level, item.slug, item.title, item.explanation, item.arabic, JSON.stringify(item.examples)],
      );
      for (const [index, exercise] of item.exercises.entries()) {
        await connection.query(
          `INSERT INTO sentence_exercises (id, topic_id, exercise_type, prompt, options, correct_answer, explanation, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE exercise_type = VALUES(exercise_type), prompt = VALUES(prompt), options = VALUES(options), correct_answer = VALUES(correct_answer), explanation = VALUES(explanation), sort_order = VALUES(sort_order)`,
          [idFor("sentence-exercise", `${item.slug}:${index}`), topicId, exercise.type, exercise.prompt, JSON.stringify(exercise.options), exercise.answer, exercise.explanation, index],
        );
      }
    }

    for (const item of quizQuestions) {
      await connection.query(
        `INSERT INTO quiz_questions (id, skill, cefr_level, category, question_type, prompt, options, correct_answer, explanation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE skill = VALUES(skill), cefr_level = VALUES(cefr_level), category = VALUES(category), question_type = VALUES(question_type), prompt = VALUES(prompt), options = VALUES(options), correct_answer = VALUES(correct_answer), explanation = VALUES(explanation)`,
        [idFor("quiz", `${item.skill}:${item.level}:${item.prompt}`), item.skill, item.level, item.category, item.type, item.prompt, JSON.stringify(item.options), item.answer, item.explanation],
      );
    }

    await connection.commit();
    console.log(`Seeded ${vocabulary.length} vocabulary items, ${grammar.length} grammar topics, ${pronunciation.length} pronunciation lessons, ${sentenceTopics.length} sentence topics, and ${quizQuestions.length} quiz questions.`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

seed().catch((error) => {
  console.error("Learning content seed failed:", error);
  process.exit(1);
});