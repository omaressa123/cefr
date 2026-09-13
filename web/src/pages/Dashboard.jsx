import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import { api, getStoredUser } from "../api/client.js";

export default function Dashboard() {
  const user = getStoredUser();
  const [classrooms, setClassrooms] = useState([]);
  const [error, setError] = useState(null);
  const [newName, setNewName] = useState("");
  const [joinCode, setJoinCode] = useState("");

  async function refresh() {
    try {
      const data = await api.listClassrooms();
      setClassrooms(Array.isArray(data) ? data : data?.classrooms ?? data?.data ?? []);
    } catch (err) {
      setError(err.message);
      setClassrooms([]);
      setTimeout(() => setError(null), 8000);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function createClassroom(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.createClassroom(newName);
      setNewName("");
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function joinClassroom(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.joinClassroom(joinCode);
      setJoinCode("");
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Layout>
      <div className="eyebrow">{user?.role === "teacher" ? "Teacher Portal" : "Student Dashboard"}</div>
      <h1>{user?.role === "teacher" ? "Your classrooms" : "Welcome back"}</h1>
      {error && <div className="error-banner">{error}</div>}

      {/* Quick Action Banner for Students */}
      {user?.role === "student" && (
        <div className="panel highlight dashboard-hero" style={{ marginBottom: "2rem" }}>
          <div>
            <div className="label">Ready to study?</div>
            <h2 style={{ marginTop: "0.2rem", marginBottom: "0.5rem" }}>Practice spoken English or level up your skills</h2>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.95rem" }}>
              Have an open AI conversation with instant grammar feedback, or explore our structured lessons.
            </p>
          </div>
          <div className="hero-actions" style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", marginTop: "1rem" }}>
            <Link to="/practice/free">
              <button>Start free practice</button>
            </Link>
            <Link to="/learning">
              <button className="secondary">Open learning hub →</button>
            </Link>
          </div>
        </div>
      )}

      {/* Classroom Section */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2>{user?.role === "teacher" ? "Manage Cohorts" : "Your Classrooms"}</h2>
      </div>

      {user?.role === "teacher" ? (
        <form onSubmit={createClassroom} className="panel" style={{ display: "flex", gap: "0.6rem", marginBottom: "1.5rem" }}>
          <input
            placeholder="Classroom name (e.g. B2 Evening Group)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            style={{ flex: 1 }}
          />
          <button type="submit">Create classroom</button>
        </form>
      ) : (
        <form onSubmit={joinClassroom} className="panel" style={{ display: "flex", gap: "0.6rem", marginBottom: "1.5rem" }}>
          <input
            placeholder="Enter classroom code (e.g. A1B2C3)"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            required
            style={{ flex: 1 }}
          />
          <button type="submit">Join classroom</button>
        </form>
      )}

      {classrooms.length === 0 ? (
        <div className="panel empty-state">
          <p style={{ margin: 0, color: "var(--text-muted)" }}>
            {user?.role === "teacher"
              ? "No classrooms created yet. Use the form above to set up your first cohort."
              : "You haven't joined any classrooms yet. Enter a join code above to enroll."}
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "0.8rem" }}>
          {classrooms.map((c) => (
            <Link key={c.id} to={`/classrooms/${c.id}`} className="panel content-row" style={{ display: "block" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ margin: 0 }}>{c.name}</h3>
                  <small style={{ color: "var(--text-muted)" }}>View assignments and progress</small>
                </div>
                {user?.role === "teacher" && <span className="pill accent">code: {c.join_code}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Layout>
  );
}
