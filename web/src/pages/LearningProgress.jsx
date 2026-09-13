import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import { api } from "../api/client.js";

export default function LearningProgress() {
  const [data, setData] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api.getProgress(), api.getRecommendations()])
      .then(([p, r]) => {
        const progressObj = Array.isArray(p) ? p[0] : p;
        setData(progressObj);
        setRecommendations(r || []);
      })
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <Layout>
        <div className="error-banner">{error}</div>
      </Layout>
    );
  }

  if (!data) {
    return (
      <Layout>
        <p>Loading progress...</p>
      </Layout>
    );
  }

  const rows = Object.entries(data.progress ?? {}).filter(([key]) => key !== "quiz");

  return (
    <Layout>
      <Link to="/learning" className="back-link">
        ← Learning hub
      </Link>
      <div className="eyebrow">Your progress</div>
      <h1>Keep the whole picture in view.</h1>

      <div className="progress-summary panel">
        <strong className="score-mark">{data.overall ?? 0}%</strong>
        <div>
          <div className="label">Current level</div>
          <h2>{data.currentLevel || "A1"}</h2>
          <p style={{ margin: 0, color: "var(--text-muted)" }}>Target: {data.targetLevel || "B2"}</p>
        </div>
      </div>

      <div className="progress-list">
        {rows.map(([key, item]) => (
          <div className="progress-row panel" key={key}>
            <div>
              <strong style={{ textTransform: "capitalize" }}>{key.replaceAll("_", " ")}</strong>
              <small>
                {item.completed ?? 0} of {item.total ?? 0} complete
              </small>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${item.percent ?? 0}%` }} />
            </div>
            <strong>{item.percent ?? 0}%</strong>
          </div>
        ))}
      </div>

      <section className="learning-section" style={{ marginTop: "2rem" }}>
        <div className="eyebrow">Next steps</div>
        <h2>Recommended for you</h2>
        <div style={{ display: "grid", gap: "0.6rem", marginTop: "1rem" }}>
          {recommendations.map((item) => (
            <Link
              to={item.contentPath || "/learning"}
              className="panel recommendation-row"
              key={`${item.skill}-${item.title}`}
            >
              <span className="recommendation-number">{item.priority}</span>
              <div style={{ flex: 1 }}>
                <strong>{item.title}</strong>
                <small>{item.reason}</small>
              </div>
              <span className="card-arrow">→</span>
            </Link>
          ))}
        </div>
      </section>
    </Layout>
  );
}