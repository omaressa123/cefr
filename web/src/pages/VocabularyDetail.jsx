import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import { api } from "../api/client.js";

export default function VocabularyDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    api
      .getVocabulary(id)
      .then(setItem)
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) {
    return (
      <Layout>
        <div className="error-banner">{error}</div>
      </Layout>
    );
  }

  if (!item) {
    return (
      <Layout>
        <p>Loading vocabulary...</p>
      </Layout>
    );
  }

  async function action(fn, text) {
    try {
      await fn();
      setMessage(text);
      setItem((prev) =>
        prev
          ? {
              ...prev,
              progress_status: text === "Marked as learned" ? "learned" : prev.progress_status,
              favorite_id: text === "Removed from favorites" ? null : prev.favorite_id || true,
            }
          : prev
      );
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Layout>
      <Link to="/learning/vocabulary" className="back-link">
        ← Vocabulary
      </Link>
      <div className="eyebrow">
        {item.cefr_level} / {item.category?.name}
      </div>
      <h1>{item.word}</h1>

      <div className="detail-grid">
        <section className="panel">
          <div className="pronunciation">{item.pronunciation || "Pronunciation not available"}</div>
          <p>{item.definition}</p>
          {item.arabic_translation && (
            <div className="translation" dir="rtl">
              {item.arabic_translation}
            </div>
          )}
          {item.example_sentence && <p className="example">“{item.example_sentence}”</p>}

          <div className="button-row">
            <button onClick={() => action(() => api.learnVocabulary(id), "Marked as learned")}>
              Mark learned
            </button>
            <button
              className="secondary"
              onClick={() =>
                action(
                  () => api.favoriteVocabulary(id, !item.favorite_id),
                  item.favorite_id ? "Removed from favorites" : "Added to favorites"
                )
              }
            >
              {item.favorite_id ? "Unfavorite" : "Favorite"}
            </button>
          </div>
          {message && <div className="success-note">{message}</div>}
        </section>

        <section className="panel">
          <div className="label">Word family</div>
          <p>{item.word_family?.join(", ") || "-"}</p>
          <div className="label">Synonyms</div>
          <p>{item.synonyms?.join(", ") || "-"}</p>
          <div className="label">Common mistake</div>
          <p>{item.common_mistakes || "No note yet."}</p>
        </section>
      </div>
      {error && <div className="error-banner">{error}</div>}
    </Layout>
  );
}