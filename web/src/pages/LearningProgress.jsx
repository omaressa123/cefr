import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Library, PenLine, Mic, AlignLeft, ArrowRight, Target, Flag,
  Check, Lock, Trophy, Activity as ActivityIcon, CirclePlay,
} from "lucide-react";
import Layout, { Badge } from "../components/Layout.jsx";
import { api } from "../api/client.js";

const CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];

const SKILL_META = {
  vocabulary: { label: "Vocabulary", hint: "words learned", icon: Library, path: "/learning/vocabulary" },
  grammar: { label: "Grammar", hint: "topics completed", icon: PenLine, path: "/learning/grammar" },
  pronunciation: { label: "Pronunciation", hint: "lessons completed", icon: Mic, path: "/learning/pronunciation" },
  sentence_structure: { label: "Sentence Structure", hint: "structures mastered", icon: AlignLeft, path: "/learning/sentences" },
};

const ACTIVITY_ICONS = {
  vocabulary: Library,
  grammar: PenLine,
  pronunciation: Mic,
  sentence_structure: AlignLeft,
  quiz: Target,
};

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff) || diff < 0) return "";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

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
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, r, a] = await Promise.all([
        api.getProgress(),
        api.getRecommendations().catch(() => []),
        api.getActivity(8).catch(() => []),
      ]);
      setData(Array.isArray(p) ? p[0] : p);
      setRecommendations(Array.isArray(r) ? r : []);
      setActivity(Array.isArray(a) ? a : []);
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
  const levels = Array.isArray(data?.levels) && data.levels.length
    ? data.levels
    : CEFR_ORDER.map((code) => ({ code, title: code, total: 0, completed: 0, percent: 0, remaining: 0, status: "locked" }));
  const nextLevel = data?.nextLevel || null;
  const allComplete = Boolean(data?.allComplete);
  const totalCompleted = data?.totalCompleted ?? rows.reduce((s, [, i]) => s + (i?.completed ?? 0), 0);
  const totalUnits = data?.totalUnits ?? rows.reduce((s, [, i]) => s + (i?.total ?? 0), 0);

  return (
    <Layout>
      <div className="fade-in progress-page">
        <Link to="/learning" className="back-link">
          ← Learning hub
        </Link>
        <div className="eyebrow">Your progress</div>
        <h1>Keep the whole picture in view.</h1>
        <p className="page-subtitle">
          Real completion data from every lesson you finish — nothing estimated, nothing faked.
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
            {/* ===== Header: overall, level path, totals, next goal ===== */}
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
                  <strong>{totalCompleted}</strong> of <strong>{totalUnits}</strong> learning
                  units complete.
                </p>
                {allComplete ? (
                  <p className="progress-goal complete">
                    <Trophy size={15} aria-hidden="true" />
                    You completed every level — outstanding!
                  </p>
                ) : nextLevel ? (
                  <p className="progress-goal">
                    <CirclePlay size={15} aria-hidden="true" />
                    Next goal: finish <strong>{nextLevel.code}</strong> —{" "}
                    <strong>{nextLevel.remaining}</strong> of {nextLevel.total} units to go
                    ({nextLevel.percent}%).
                  </p>
                ) : null}
              </div>
            </div>

            {/* ===== Category cards ===== */}
            <div className="eyebrow">By skill</div>
            <h2 className="section-title">Category progress</h2>
            <div className="category-cards">
              {rows.map(([key, item]) => {
                const meta = SKILL_META[key] || { label: key.replaceAll("_", " "), hint: "", path: "/learning" };
                const Icon = meta.icon || Library;
                const percent = item?.percent ?? 0;
                const done = item?.total > 0 && (item?.completed ?? 0) >= item.total;
                return (
                  <div className="panel category-card" key={key}>
                    <div className="category-card-head">
                      <span className="progress-row-icon" aria-hidden="true">
                        <Icon size={19} />
                      </span>
                      <div>
                        <strong>{meta.label}</strong>
                        <small>{item?.completed ?? 0} of {item?.total ?? 0} {meta.hint}</small>
                      </div>
                      {done
                        ? <Badge variant="success">Complete</Badge>
                        : percent > 0
                          ? <Badge variant="info">In progress</Badge>
                          : <Badge variant="secondary">Not started</Badge>}
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
                    <div className="category-card-foot">
                      <strong>{percent}%</strong>
                      <Link to={meta.path} className="continue-link">
                        {done ? "Review" : percent > 0 ? "Continue learning" : "Start learning"}
                        <ArrowRight size={14} aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ===== CEFR roadmap ===== */}
            <div className="eyebrow">Roadmap</div>
            <h2 className="section-title">A1 → C2 journey</h2>
            <div className="panel roadmap-panel">
              <ol className="roadmap">
                {levels.map((level, i) => {
                  const status = level.status || "locked";
                  return (
                    <li key={level.code} className={`roadmap-node ${status}`}>
                      <span className="roadmap-dot" aria-hidden="true">
                        {status === "completed" ? <Check size={15} /> : status === "current" ? null : <Lock size={12} />}
                      </span>
                      {i < levels.length - 1 && (
                        <span
                          className={`roadmap-link ${levels[i + 1]?.status === "completed" || status === "completed" ? "done" : ""}`}
                          aria-hidden="true"
                        />
                      )}
                      <span className="roadmap-code">{level.code}</span>
                      <span className="roadmap-sub">
                        {status === "completed"
                          ? "Done"
                          : status === "current"
                            ? `${level.completed}/${level.total}`
                            : level.total > 0 ? `${level.total} units` : "—"}
                      </span>
                      <span className="sr-only">
                        {level.title || level.code}: {status}
                        {status === "current" ? `, ${level.percent} percent complete` : ""}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="roadmap-note">
                {allComplete
                  ? "Every level is complete. Keep practicing to stay sharp."
                  : nextLevel
                    ? `You are on ${nextLevel.code} — ${nextLevel.remaining} unit${nextLevel.remaining === 1 ? "" : "s"} remaining to unlock the next level. A level unlocks only when all its units are finished.`
                    : "Complete lessons to begin your journey."}
              </p>
            </div>

            {/* ===== Recent activity (real events only) ===== */}
            <div className="eyebrow">Activity</div>
            <h2 className="section-title">Recent learning activity</h2>
            {activity.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon" aria-hidden="true">🌱</div>
                <h3>No activity yet</h3>
                <p>Finish a vocabulary word, grammar topic, pronunciation lesson, or sentence exercise and it will show up here.</p>
                <Link to="/learning" className="btn-link">Open the learning hub</Link>
              </div>
            ) : (
              <ul className="activity-list">
                {activity.map((item) => {
                  const Icon = ACTIVITY_ICONS[item.kind] || ActivityIcon;
                  return (
                    <li key={item.id} className="panel activity-row">
                      <span className="progress-row-icon sm" aria-hidden="true">
                        <Icon size={16} />
                      </span>
                      <div className="activity-text">
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                      </div>
                      <span className="activity-time" title={item.happened_at}>
                        {timeAgo(item.happened_at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* ===== Recommendations ===== */}
            <section className="learning-section">
              <div className="eyebrow">Next steps</div>
              <h2>Recommended for you</h2>
              {recommendations.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon" aria-hidden="true">🧭</div>
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
