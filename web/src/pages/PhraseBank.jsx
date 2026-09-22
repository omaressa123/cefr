import React, { useState, useMemo } from "react";
import { Search, Heart, BookOpenText, X, RotateCcw } from "lucide-react";
import { Badge } from "../components/Layout.jsx";
import Layout from "../components/Layout.jsx";

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
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState(() => new Set());

  const counts = useMemo(() => {
    const map = { All: PHRASE_DATA.length };
    for (const p of PHRASE_DATA) map[p.category] = (map[p.category] || 0) + 1;
    return map;
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PHRASE_DATA.filter((p) => {
      if (category !== "All" && p.category !== category) return false;
      if (showFavoritesOnly && !favorites.has(p.phrase)) return false;
      if (q && !p.phrase.toLowerCase().includes(q) && !p.meaning.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [query, category, showFavoritesOnly, favorites]);

  function toggleFavorite(phrase) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(phrase)) next.delete(phrase);
      else next.add(phrase);
      return next;
    });
  }

  function resetFilters() {
    setQuery("");
    setCategory("All");
    setShowFavoritesOnly(false);
  }

  const hasActiveFilters = query.trim() !== "" || category !== "All" || showFavoritesOnly;

  return (
    <Layout>
      <div className="fade-in phrase-bank">
        <div className="eyebrow">Your personal phrase collection</div>
        <h1>Phrase Bank</h1>
        <p className="page-subtitle">
          Save and organize useful phrases from your practice sessions.
        </p>

        <div className="phrase-stats" aria-label="Collection stats">
          <div className="phrase-stat">
            <BookOpenText size={16} aria-hidden="true" />
            <span><strong>{PHRASE_DATA.length}</strong> phrases</span>
          </div>
          <div className="phrase-stat">
            <Heart size={16} aria-hidden="true" />
            <span><strong>{favorites.size}</strong> favorited</span>
          </div>
          <div className="phrase-stat">
            <span><strong>{counts[category] ?? 0}</strong> in {category === "All" ? "all categories" : category}</span>
          </div>
        </div>

        <div className="panel phrase-controls">
          <form
            className="phrase-search"
            onSubmit={(e) => e.preventDefault()}
            role="search"
          >
            <Search size={18} className="phrase-search-icon" aria-hidden="true" />
            <input
              className="phrase-search-input"
              placeholder="Search phrases or meanings…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search phrases or meanings"
            />
            {query && (
              <button
                type="button"
                className="phrase-clear-btn"
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                <X size={16} />
              </button>
            )}
          </form>

          <div className="phrase-filter-row">
            <div className="category-tabs" role="tablist" aria-label="Filter by category">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={category === cat}
                  className={`category-tab ${category === cat ? "active" : ""}`}
                  onClick={() => setCategory(cat)}
                >
                  {cat}
                  <span className="category-count">{counts[cat] ?? 0}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              className={`favorites-toggle ${showFavoritesOnly ? "active" : ""}`}
              onClick={() => setShowFavoritesOnly((v) => !v)}
              aria-pressed={showFavoritesOnly}
              title="Show favorites only"
            >
              <Heart size={15} aria-hidden="true" />
              Favorites
            </button>
          </div>
        </div>

        {filtered.length > 0 && (
          <div className="result-count" aria-live="polite">
            Showing {filtered.length} of {PHRASE_DATA.length} phrases
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon" aria-hidden="true">📖</div>
            <h3>No phrases found</h3>
            <p>Try adjusting your search or filter to find what you're looking for.</p>
            {hasActiveFilters && (
              <button type="button" className="secondary" onClick={resetFilters}>
                <RotateCcw size={15} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: "6px" }} />
                Reset filters
              </button>
            )}
          </div>
        ) : (
          <div className="phrase-bank-grid">
            {filtered.map((item) => {
              const isFav = favorites.has(item.phrase);
              return (
                <article key={item.phrase} className="panel phrase-card">
                  <div className="phrase-card-body">
                    <p className="phrase-text">“{item.phrase}”</p>
                    <p className="phrase-meaning">{item.meaning}</p>
                  </div>
                  <div className="phrase-card-footer">
                    <div className="phrase-badges">
                      <Badge variant="info">{item.category}</Badge>
                      <Badge variant="secondary">{item.level}</Badge>
                    </div>
                    <button
                      type="button"
                      className={`phrase-fav-btn ${isFav ? "favorited" : ""}`}
                      onClick={() => toggleFavorite(item.phrase)}
                      aria-label={isFav ? `Remove "${item.phrase}" from favorites` : `Add "${item.phrase}" to favorites`}
                      aria-pressed={isFav}
                      title={isFav ? "Remove from favorites" : "Add to favorites"}
                    >
                      <Heart size={17} fill={isFav ? "currentColor" : "none"} aria-hidden="true" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
