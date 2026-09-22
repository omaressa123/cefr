import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Library, PenLine, Mic, AlignLeft, ArrowRight, Target, Flag } from "lucide-react";
import Layout from "../components/Layout.jsx";
import { api } from "../api/client.js";

const SKILL_META = {
  vocabulary: { label: "Vocabulary", hint: "Words learned", icon: Library, path: "/learning/vocabulary" },
  grammar: { label: "Grammar", hint: "Topics completed", icon: PenLine, path: "/learning/grammar" },
  pronunciation: { label: "Pronunciation", hint: "Lessons completed", icon: Mic, path: "/learning/pronunciation" },
  sentence_structure: { label: "Sentence Structure", hint: "Structures mastered", icon: AlignLeft, path: "/learning/sentences" },
};

function ProgressRing({ value }) {
  const size = 132;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value ?? 0));
  const offset = circumference - (clamped / 100) * circumference;
  return (
    <div className="progress-ring" role="img" aria-label={`Overall progress ${clamped} percent`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={stroke}
          className="progress-ring-track"
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={stroke} strokeLinecap="round"
          className="progress-ring-fill"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="progress-ring-center">
        <strong>{clamped}%</strong>
        <span>overall</span>
      </div>
    </div>
  );
}

function LoadingView() {
  return (
    <div aria-hidden="true">
      <div className="panel progress-hero skeleton-hero">
        <div className="skeleton skeleton-ring" />
        <div className="skeleton-hero-text">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line short" />
        </div>
      </div>
      <div className="progress-list">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="panel progress-row">
            <div className="skeleton skeleton-line" style={{ width: "40%" }} />
            <div className="skeleton skeleton-bar" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LearningProgress() {
  const [data, setData] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, r] = await Promise.all([api.getProgress(), api.getRecommendations()]);
      setData(Array.isArray(p) ? p[0] : p);
      setRecommendations(Array.isArray(r) ? r : r?.recommendations ?? []);
    } catch (err) {
      setError(err.message || "Failed to load progress");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = Object.entries(data?.progress ?? {}).filter(([key]) => key !== "quiz");
  const totalCompleted = rows.reduce((sum, [, item]) => sum + (item?.completed ?? 0), 0);
  const totalItems = rows.reduce((sum, [, item]) => sum + (item?.total ?? 0), 0);

  return (
    <Layout>
      <div className="fade-in progress-page">
        <Link to="/learning" className="back-link">
          ← Learning hub
        </Link>
        <div className="eyebrow">Your progress</div>
        <h1>Keep the whole picture in view.</h1>
        <p className="page-subtitle">
          Track completion across every skill and see what to practice next.
        </p>

        {error && (
          <div className="error-banner">
            {error}{" "}
            <button type="button" className="link-btn" onClick={load}>
              Try again
            </button>
          </div>
        )}

        {loading || !data ? (
          loading ? <LoadingView /> : null
        ) : (
          <>
            <div className="panel progress-hero">
              <ProgressRing value={data.overall ?? 0} />
              <div className="progress-hero-info">
                <div className="level-path">
                  <span className="level-chip current">
                    <Flag size={13} aria-hidden="true" />
                    {data.currentLevel || "A1"}
                  </span>
                  <span className="level-path-line" aria-hidden="true" />
                  <span className="level-chip target">
                    <Target size={13} aria-hidden="true" />
                    {data.targetLevel || "C2"}
                  </span>
                </div>
                <p className="progress-hero-text">
                  <strong>{totalCompleted}</strong> of <strong>{totalItems}</strong> items
                  complete across {rows.length} skills.
                </p>
              </div>
            </div>

            <div className="progress-list">
              {rows.map(([key, item]) => {
                const meta = SKILL_META[key] || { label: key.replaceAll("_", " "), hint: "", path: "/learning" };
                const Icon = meta.icon || Library;
                const percent = item?.percent ?? 0;
                return (
                  <Link to={meta.path} className="panel progress-row panel-hover" key={key}>
                    <div className="progress-row-icon" aria-hidden="true">
                      <Icon size={19} />
                    </div>
                    <div className="progress-row-main">
                      <div className="progress-row-head">
                        <strong>{meta.label}</strong>
                        <span className="progress-row-count">
                          {item?.completed ?? 0} of {item?.total ?? 0} {meta.hint}
                        </span>
                      </div>
                      <div
                        className="progress-track"
                        role="progressbar"
                        aria-valuenow={percent}
                        aria-valuemin="0"
                        aria-valuemax="100"
                        aria-label={`${meta.label} ${percent} percent complete`}
                      >
                        <div className="progress-fill" style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                    <strong className="progress-row-percent">{percent}%</strong>
                  </Link>
                );
              })}
            </div>

            <section className="learning-section">
              <div className="eyebrow">Next steps</div>
              <h2>Recommended for you</h2>
              {recommendations.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon" aria-hidden="true">🌱</div>
                  <h3>Nothing recommended yet</h3>
                  <p>Complete a quiz or lesson and personalized suggestions will appear here.</p>
                </div>
              ) : (
                <div className="reco-list">
                  {recommendations.map((item) => (
                    <Link
                      to={item.contentPath || "/learning"}
                      className="panel recommendation-row"
                      key={`${item.skill}-${item.title}`}
                    >
                      <span className="recommendation-number">{item.priority}</span>
                      <div className="reco-text">
                        <strong>{item.title}</strong>
                        <small>{item.reason}</small>
                      </div>
                      <ArrowRight size={17} className="reco-arrow" aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </Layout>
  );
}
