import React, { useState } from "react";
import Layout from "../components/Layout.jsx";
import { api } from "../api/client.js";

export default function Quiz() {
  const [skill, setSkill] = useState("vocabulary");
  const [level, setLevel] = useState("A1");

  const [quiz, setQuiz] = useState(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState(null);
  const [score, setScore] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    try {
      setLoading(true);
      setError("");
      setQuiz(null);
      setScore(null);
      setResult(null);
      setAnswer("");
      setIndex(0);

      const response = await api.startQuiz(skill, level);

      console.log("Quiz API response:", response);

      // Normalize possible API response shapes
      const questions =
        response?.questions ??
        response?.data?.questions ??
        response?.quiz?.questions ??
        [];

      if (!Array.isArray(questions) || questions.length === 0) {
        throw new Error(
          "No quiz questions were returned for this level and skill."
        );
      }

      const normalizedQuiz = {
        ...response,
        questions,
      };

      setQuiz(normalizedQuiz);
    } catch (err) {
      console.error("Failed to start quiz:", err);
      setError(err.message || "Failed to start quiz.");
      setQuiz(null);
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    const question = quiz?.questions?.[index];

    if (!question) {
      setError("The current quiz question could not be found.");
      return;
    }

    if (!answer.trim()) {
      setError("Please provide an answer.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const response = await api.answerQuiz(question.id, answer);

      setResult(response);
    } catch (err) {
      console.error("Failed to submit answer:", err);
      setError(err.message || "Failed to submit answer.");
    } finally {
      setLoading(false);
    }
  }

  async function next() {
    if (!quiz?.questions?.length) {
      setError("Quiz questions are unavailable.");
      return;
    }

    if (index + 1 >= quiz.questions.length) {
      try {
        setLoading(true);
        setError("");

        const questionIds = quiz.questions
          .map((question) => question?.id)
          .filter(Boolean);

        if (questionIds.length === 0) {
          throw new Error("No valid quiz question IDs found.");
        }

        const finalScore = await api.finishQuiz(questionIds);

        setScore(finalScore);
      } catch (err) {
        console.error("Failed to finish quiz:", err);
        setError(err.message || "Failed to finish quiz.");
      } finally {
        setLoading(false);
      }

      return;
    }

    setIndex((current) => current + 1);
    setAnswer("");
    setResult(null);
    setError("");
  }

  const currentQuestion = quiz?.questions?.[index];

  return (
    <Layout>
      <div className="eyebrow">Practice quiz</div>

      <h1>Test, learn, repeat.</h1>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {!quiz ? (
        <div className="panel quiz-start">
          <select
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            disabled={loading}
          >
            <option value="vocabulary">Vocabulary</option>
            <option value="grammar">Grammar</option>
            <option value="pronunciation">Pronunciation</option>
            <option value="sentence_structure">
              Sentence structure
            </option>
          </select>

          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            disabled={loading}
          >
            {["A1", "A2", "B1", "B2", "C1", "C2"].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <button onClick={start} disabled={loading}>
            {loading ? "Starting..." : "Start quiz"}
          </button>
        </div>
      ) : score ? (
        <div className="panel">
          <div className="label">Quiz complete</div>

          <strong className="score-mark">
            {score.score ?? 0}%
          </strong>

          <p>
            {score.correct ?? 0} correct out of{" "}
            {score.attempts ?? quiz.questions.length} answers.
          </p>

          <button
            onClick={() => {
              setQuiz(null);
              setScore(null);
              setIndex(0);
              setAnswer("");
              setResult(null);
              setError("");
            }}
          >
            New quiz
          </button>
        </div>
      ) : !currentQuestion ? (
        <div className="panel">
          <div className="error-banner">
            The current question is unavailable.
          </div>

          <button
            onClick={() => {
              setQuiz(null);
              setError("");
            }}
          >
            Restart quiz
          </button>
        </div>
      ) : (
        <section className="panel quiz-card">
          <div className="label">
            Question {index + 1} of {quiz.questions.length}
          </div>

          <h2>
            {currentQuestion.prompt ??
              currentQuestion.question ??
              currentQuestion.text ??
              "Question unavailable"}
          </h2>

          {Array.isArray(currentQuestion.options) &&
            currentQuestion.options.map((option) => (
              <button
                className="secondary option-button"
                onClick={() => setAnswer(option)}
                key={option}
                disabled={loading || !!result}
              >
                {option}
              </button>
            ))}

          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Your answer"
            disabled={loading || !!result}
          />

          {!result ? (
            <button onClick={submit} disabled={loading || !answer.trim()}>
              {loading ? "Checking..." : "Check answer"}
            </button>
          ) : (
            <>
              <div
                className={
                  result.correct
                    ? "success-note"
                    : "error-banner"
                }
              >
                {result.correct
                  ? "Correct."
                  : `Correct answer: ${
                      result.correctAnswer ?? "Not available"
                    }`}{" "}
                {result.explanation ?? ""}
              </div>

              <button onClick={next} disabled={loading}>
                {loading
                  ? "Processing..."
                  : index + 1 === quiz.questions.length
                  ? "Finish"
                  : "Next"}
              </button>
            </>
          )}
        </section>
      )}
    </Layout>
  );
}
