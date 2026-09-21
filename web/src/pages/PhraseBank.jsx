import React, { useState, useMemo } from "react";
import { Badge, Button, EmptyState } from "../components/Layout.jsx";
import Layout from "../components/Layout.jsx";
import { api } from "../api/client.js";

const CATEGORIES = ["All", "Business", "Travel", "Daily", "Academic", "Idioms", "Slang"];

const PHRASE_DATA = [
  { phrase: "Break the ice", meaning: "To start a conversation in a social situation", category: "Social", level: "A2" },
  { phrase: "Hit the nail on the head", meaning: "To describe exactly what is causing a situation or problem", category: "Idioms", level: "B1" },
  { phrase: "Let's touch base", meaning: "To connect with someone at a later time", category: "Business", level: "B1" },
  { phrase: "I'm feeling under the weather", meaning: "To feel sick or unwell", category: "Daily", level: "A2" },
  { phrase: "The ball is in your court", meaning: "It's your decision or turn to act", category: "Idioms", level: "B2" },
  { phrase: "Can you elaborate?", meaning: "Could you explain more in detail?", category: "Academic", level: "C1" },
  { phrase: "It's a piece of cake", meaning: "Something is very easy to do", category: "Idioms", level: "A2" },
  { phrase: "I'd like to follow up", meaning: "To continue or revisit a topic later", category: "Business", level: "B1" },
  { phrase: "On the same page", meaning: "To have the same understanding or opinion", category: "Business", level: "B2" },
  { phrase: "Could you clarify that?", meaning: "Can you make that clearer?", category: "Academic", level: "B1" },
  { phrase: "I'm on board", meaning: "I agree or I'm ready to participate", category: "Daily", level: "A2" },
  { phrase: "That's a good point", meaning: "I acknowledge what you said is valid", category: "Social", level: "B1" },
  { phrase: "Let's dive in", meaning: "Let's start working on something", category: "Business", level: "A2" },
  { phrase: "Time flies when you're having fun", meaning: "Time passes quickly when you enjoy yourself", category: "Daily", level: "A1" },
  { phrase: "The early bird catches the worm", meaning: "Being early gives you an advantage", category: "Idioms", level: "A2" },
];

export default function PhraseBank() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [favorites, setFavorites] = useState(new Set());

  const filtered = useMemo(() => {
    return PHRASE_DATA.filter((p) => {
      const matchCategory = category === "All" || p.category === category;
      const matchQuery = p.phrase.toLowerCase().includes(query.toLowerCase()) || p.meaning.toLowerCase().includes(query.toLowerCase());
      return matchCategory && matchQuery;
    });
  }, [query, category]);

  function toggleFavorite(phrase) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(phrase)) next.delete(phrase);
      else next.add(phrase);
      return next;
    });
  }

  return (
    <Layout>
    
      <div className="fade-in">
        <div className="home-header">
          <p className="home-greeting">Your personal phrase collection</p>
          <h1 className="home-title">Phrase Bank</h1>
          <p style={{ marginTop: "var(--space-2)", color: "var(--color-secondary-text)" }}>
            Save and organize useful phrases from your practice sessions
          </p>
        </div>

        <div className="search-bar">
          <span className="search-icon">🔍</span>
          <input
            className="input"
            placeholder="Search phrases or meanings..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="category-tabs">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={`category-tab ${category === cat ? 'active' : ''}`}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon="📖" title="No phrases found" description="Try adjusting your search or filter to find what you're looking for." />
        ) : (
          <div className="phrase-bank-grid">
            {filtered.map((phrase, i) => (
              <div key={i} className="phrase-card panel-hover" style={{ cursor: "pointer" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "var(--text-body)", fontWeight: 600, color: "var(--color-primary-text)" }}>
                    {phrase.phrase}
                  </div>
                  <div style={{ fontSize: "var(--text-caption)", color: "var(--color-secondary-text)", marginTop: "var(--space-1)" }}>
                    {phrase.meaning}
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
                    <Badge variant="info">{phrase.category}</Badge>
                    <Badge variant="secondary">{phrase.level}</Badge>
                  </div>
                </div>
                <button
                  className={`btn btn-ghost ${favorites.has(phrase.phrase) ? 'favorited' : ''}`}
                  onClick={() => toggleFavorite(phrase.phrase)}
                  style={{ padding: "8px", minWidth: "36px", color: favorites.has(phrase.phrase) ? "var(--color-error)" : "var(--color-secondary-text)" }}
                >
                  {favorites.has(phrase.phrase) ? "❤️" : "🤍"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    
    </Layout>
  );
}
