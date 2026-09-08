import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import { api } from "../api/client.js";

const levelNames = { A1: "Beginner", A2: "Elementary", B1: "Intermediate", B2: "Upper-intermediate", C1: "Advanced", C2: "Proficient" };
const cards = [
  ["Vocabulary", "/learning/vocabulary", "Browse words, save favorites, and review weak spots."],
  ["Grammar roadmap", "/learning/grammar", "Move from sentence foundations to advanced structures."],
  ["Pronunciation lab", "/learning/pronunciation", "Listen, repeat, and work through difficult sounds."],
  ["Sentence builder", "/learning/sentences", "Build accurate sentences one structure at a time."],
  ["Quiz", "/learning/quiz", "Check your understanding across the four skills."],
  ["Progress", "/learning/progress", "See your skill progress and recommended next steps."],
];

export default function LearningDashboard() {
  const [progress, setProgress] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [error, setError] = useState(null);
  useEffect(() => { Promise.all([api.getProgress(), api.getRecommendations()]).then(([p, r]) => { setProgress(p); setRecommendations(r); }).catch((err) => setError(err.message)); }, []);
  return <Layout>
    <div className="eyebrow">CEFR learning system</div>
    <h1>Build your English, level by level.</h1>
    {error && <div className="error-banner">{error}</div>}
    <div className="panel highlight learning-hero">
      <div><div className="label">Current level</div><strong className="level-mark">{progress?.currentLevel || "A1"}</strong><span className="pill accent">{levelNames[progress?.currentLevel || "A1"]}</span></div>
      <div className="progress-track"><div className="progress-fill" style={{ width: `${progress?.overall || 0}%` }} /></div>
      <div><div className="label">Overall progress</div><strong>{progress?.overall || 0}%</strong></div>
    </div>
    <div className="learning-grid">{cards.map(([title, href, description]) => <Link className="panel learning-card" to={href} key={href}><div className="label">Open module</div><h3>{title}</h3><p>{description}</p><span className="card-arrow">→</span></Link>)}</div>
    <section className="learning-section"><div className="section-heading"><div><div className="eyebrow">Personalized</div><h2>Recommended for you</h2></div><Link to="/learning/progress">View progress</Link></div>{recommendations.map((item) => <Link className="recommendation-row" to={item.contentPath} key={`${item.skill}-${item.title}`}><span className="recommendation-number">{item.priority}</span><span><strong>{item.title}</strong><small>{item.reason}</small></span><span>→</span></Link>)}</section>
  </Layout>;
}