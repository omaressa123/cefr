import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import { api } from "../api/client.js";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export default function Vocabulary() {
  const [level, setLevel] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (overrides = {}) => {
    const activeLevel = overrides.level !== undefined ? overrides.level : level;
    const activeSearch = overrides.search !== undefined ? overrides.search : search;
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (activeLevel) params.level = activeLevel;
      if (activeSearch.trim()) params.search = activeSearch.trim();
      const data = await api.listVocabulary(params);
      const list = Array.isArray(data) ? data : data?.items ?? [];
      setItems(list);
      setTotal(Array.isArray(data) ? data.length : data?.total ?? list.length);
    } catch (err) {
      setError(err.message || "Failed to load vocabulary");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [level, search]);

  // Reload when the level filter changes
  useEffect(() => {
    load();
  }, [level]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleLevelChange(e) {
    const next = e.target.value;
    setLevel(next);
    load({ level: next });
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    load();
  }

  function clearFilters() {
    setLevel("");
    setSearch("");
    load({ level: "", search: "" });
  }

  const hasFilters = level !== "" || search.trim() !== "";

  return (
    <Layout>
      <div className="fade-in">
        <div className="eyebrow">Vocabulary</div>
        <h1>Words you can use.</h1>
        <p className="page-subtitle">
          Browse CEFR-graded words, search definitions, and open any card to learn it.
        </p>

        <form className="toolbar vocab-toolbar" onSubmit={handleSearchSubmit}>
          <select
            value={level}
            onChange={handleLevelChange}
            aria-label="Filter by CEFR level"
            className="toolbar-select"
          >
            <option value="">All levels</option>
            {LEVELS.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search words or definitions"
            aria-label="Search words or definitions"
            className="toolbar-search"
          />
          <button type="submit" disabled={loading} className="toolbar-btn">
            {loading ? "Searching…" : "Search"}
          </button>
        </form>

        {error && (
          <div className="error-banner">
            {error}{" "}
            <button type="button" className="link-btn" onClick={() => load()}>
              Try again
            </button>
          </div>
        )}

        {!loading && !error && (
          <div className="result-count" aria-live="polite">
            {total === 0
              ? "No words found"
              : `${total} word${total === 1 ? "" : "s"} found`}
          </div>
        )}

        {loading ? (
          <div className="content-list">
            {[0, 1, 2].map((i) => (
              <div key={i} className="panel content-row skeleton-row" aria-hidden="true">
                <div className="skeleton skeleton-pill" />
                <div className="skeleton skeleton-line" />
                <div className="skeleton skeleton-line short" />
              </div>
            ))}
          </div>
        ) : (
          <div className="content-list">
            {items.map((item) => (
              <Link
                to={`/learning/vocabulary/${item.id}`}
                className="panel content-row panel-hover"
                key={item.id}
              >
                <div className="content-row-main">
                  <span className="pill accent">{item.cefr_level}</span>
                  <h3>{item.word}</h3>
                  <p>{item.definition}</p>
                </div>
                <div className="row-meta">
                  <span>{item.category?.name}</span>
                  <span className={item.progress_status === "learned" ? "row-status done" : "row-status"}>
                    {item.progress_status === "learned" ? "✓ Learned" : "Learn →"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon" aria-hidden="true">📚</div>
            <h3>No vocabulary matches this search</h3>
            <p>Try a different word or clear your filters to browse everything.</p>
            {hasFilters && (
              <button type="button" className="secondary" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
