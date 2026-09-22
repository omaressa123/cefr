import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Heart, BookOpenText, X, RotateCcw, Plus, Trash2 } from "lucide-react";
import { Badge } from "../components/Layout.jsx";
import Layout from "../components/Layout.jsx";
import { api } from "../api/client.js";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export default function PhraseBank() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPhrase, setNewPhrase] = useState({ phrase: "", meaning: "", category: "Daily", cefr_level: "A2" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = useCallback(async (overrides = {}) => {
    const activeCategory = overrides.category !== undefined ? overrides.category : category;
    const activeQuery = overrides.query !== undefined ? overrides.query : submittedQuery;
    const activeFavorites = overrides.favorites !== undefined ? overrides.favorites : showFavoritesOnly;
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (activeCategory !== "All") params.category = activeCategory;
      if (activeQuery.trim()) params.search = activeQuery.trim();
      if (activeFavorites) params.favorites = "true";
      const [list, cats] = await Promise.all([
        api.listPhrases(params),
        api.getPhraseCategories().catch(() => null),
      ]);
      setItems(list);
      if (cats) {
        setCategories(cats.categories || []);
        setTotal(cats.total || 0);
      }
    } catch (err) {
      setError(err.message || "Failed to load phrases");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [category, submittedQuery, showFavoritesOnly]);

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const favoriteCount = useMemo(() => items.filter((i) => i.favorite).length, [items]);
  const categoryCount = useCallback((name) => {
    if (name === "All") return total;
    return categories.find((c) => c.name === name)?.count ?? 0;
  }, [categories, total]);

  function handleSearchSubmit(e) {
    e.preventDefault();
    setSubmittedQuery(query);
    load({ query });
  }

  function handleCategoryChange(name) {
    setCategory(name);
    load({ category: name });
  }

  function handleFavoritesToggle() {
    const next = !showFavoritesOnly;
    setShowFavoritesOnly(next);
    load({ favorites: next });
  }

  async function toggleFavorite(item) {
    const next = !item.favorite;
    setItems((prev) => {
      const updated = prev.map((p) => (p.id === item.id ? { ...p, favorite: next } : p));
      return showFavoritesOnly && !next ? updated.filter((p) => p.id !== item.id) : updated;
    });
    try {
      await api.favoritePhrase(item.id, next);
    } catch {
      setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, favorite: !next } : p)));
    }
  }

  async function handleAddPhrase(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const created = await api.createPhrase(newPhrase);
      setItems((prev) => [created, ...prev]);
      setTotal((t) => t + 1);
      setNewPhrase({ phrase: "", meaning: "", category: "Daily", cefr_level: "A2" });
      setShowAddForm(false);
      load();
    } catch (err) {
      setFormError(err.message || "Failed to save phrase");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    const previous = items;
    setItems((prev) => prev.filter((p) => p.id !== id));
    try {
      await api.deletePhrase(id);
      setTotal((t) => Math.max(0, t - 1));
    } catch {
      setItems(previous);
    }
  }

  function resetFilters() {
    setQuery("");
    setSubmittedQuery("");
    setCategory("All");
    setShowFavoritesOnly(false);
    load({ query: "", category: "All", favorites: false });
  }

  const hasActiveFilters = submittedQuery.trim() !== "" || category !== "All" || showFavoritesOnly;

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
            <span><strong>{total}</strong> phrases</span>
          </div>
          <div className="phrase-stat">
            <Heart size={16} aria-hidden="true" />
            <span><strong>{favoriteCount}</strong> favorited on screen</span>
          </div>
          <div className="phrase-stat">
            <span><strong>{categoryCount(category)}</strong> in {category === "All" ? "all categories" : category}</span>
          </div>
        </div>

        {error && (
          <div className="error-banner">
            {error}{" "}
            <button type="button" className="link-btn" onClick={() => load()}>
              Try again
            </button>
          </div>
        )}

        <div className="panel phrase-controls">
          <form className="phrase-search" onSubmit={handleSearchSubmit} role="search">
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
                onClick={() => { setQuery(""); setSubmittedQuery(""); load({ query: "" }); }}
                aria-label="Clear search"
              >
                <X size={16} />
              </button>
            )}
          </form>

          <div className="phrase-filter-row">
            <div className="category-tabs" role="tablist" aria-label="Filter by category">
              {["All", ...categories.map((c) => c.name)].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={category === cat}
                  className={`category-tab ${category === cat ? "active" : ""}`}
                  onClick={() => handleCategoryChange(cat)}
                >
                  {cat}
                  <span className="category-count">{categoryCount(cat)}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              className={`favorites-toggle ${showFavoritesOnly ? "active" : ""}`}
              onClick={handleFavoritesToggle}
              aria-pressed={showFavoritesOnly}
              title="Show favorites only"
            >
              <Heart size={15} aria-hidden="true" />
              Favorites
            </button>
          </div>

          <div className="phrase-add-row">
            <button
              type="button"
              className="secondary phrase-add-toggle"
              onClick={() => setShowAddForm((v) => !v)}
              aria-expanded={showAddForm}
            >
              <Plus size={15} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: "6px" }} />
              {showAddForm ? "Close form" : "Add your own phrase"}
            </button>
          </div>

          {showAddForm && (
            <form className="phrase-add-form" onSubmit={handleAddPhrase}>
              <input
                value={newPhrase.phrase}
                onChange={(e) => setNewPhrase((p) => ({ ...p, phrase: e.target.value }))}
                placeholder="Phrase (e.g. Break the ice)"
                aria-label="New phrase"
                maxLength={255}
              />
              <input
                value={newPhrase.meaning}
                onChange={(e) => setNewPhrase((p) => ({ ...p, meaning: e.target.value }))}
                placeholder="Meaning"
                aria-label="Phrase meaning"
                maxLength={2000}
              />
              <div className="phrase-add-meta">
                <input
                  value={newPhrase.category}
                  onChange={(e) => setNewPhrase((p) => ({ ...p, category: e.target.value }))}
                  placeholder="Category"
                  aria-label="Phrase category"
                  maxLength={100}
                />
                <select
                  value={newPhrase.cefr_level}
                  onChange={(e) => setNewPhrase((p) => ({ ...p, cefr_level: e.target.value }))}
                  aria-label="CEFR level"
                >
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save phrase"}
                </button>
              </div>
              {formError && <div className="error-banner">{formError}</div>}
            </form>
          )}
        </div>

        {!loading && !error && items.length > 0 && (
          <div className="result-count" aria-live="polite">
            Showing {items.length} phrase{items.length === 1 ? "" : "s"}
          </div>
        )}

        {loading ? (
          <div className="phrase-bank-grid" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="panel phrase-card">
                <div className="skeleton skeleton-line" />
                <div className="skeleton skeleton-line short" />
              </div>
            ))}
          </div>
        ) : items.length === 0 && !error ? (
          <div className="empty-state">
            <div className="empty-state-icon" aria-hidden="true">📖</div>
            <h3>No phrases found</h3>
            <p>Try adjusting your search or filter — or add your own phrase above.</p>
            {hasActiveFilters && (
              <button type="button" className="secondary" onClick={resetFilters}>
                <RotateCcw size={15} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: "6px" }} />
                Reset filters
              </button>
            )}
          </div>
        ) : (
          <div className="phrase-bank-grid">
            {items.map((item) => (
              <article key={item.id} className="panel phrase-card">
                <div className="phrase-card-body">
                  <p className="phrase-text">“{item.phrase}”</p>
                  <p className="phrase-meaning">{item.meaning}</p>
                </div>
                <div className="phrase-card-footer">
                  <div className="phrase-badges">
                    <Badge variant="info">{item.category}</Badge>
                    <Badge variant="secondary">{item.cefr_level}</Badge>
                  </div>
                  <div className="phrase-actions">
                    {item.mine && (
                      <button
                        type="button"
                        className="phrase-del-btn"
                        onClick={() => handleDelete(item.id)}
                        aria-label={`Delete "${item.phrase}"`}
                        title="Delete your phrase"
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      className={`phrase-fav-btn ${item.favorite ? "favorited" : ""}`}
                      onClick={() => toggleFavorite(item)}
                      aria-label={item.favorite ? `Remove "${item.phrase}" from favorites` : `Add "${item.phrase}" to favorites`}
                      aria-pressed={!!item.favorite}
                      title={item.favorite ? "Remove from favorites" : "Add to favorites"}
                    >
                      <Heart size={17} fill={item.favorite ? "currentColor" : "none"} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
