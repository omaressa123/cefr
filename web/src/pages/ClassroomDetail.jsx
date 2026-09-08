import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import { api, getStoredUser } from "../api/client.js";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export default function ClassroomDetail() {
  const { id } = useParams();
  const user = getStoredUser();
  const [classroom, setClassroom] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ cefrLevel: "B1", targetTopic: "" });

  async function refresh() {
    try {
      const [c, a] = await Promise.all([api.getClassroom(id), api.listAssignments(id)]);
      setClassroom(c);
      setAssignments(a);
      if (user?.role === "teacher") {
        setReport(await api.getCohortReport(id));
      }
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function createAssignment(e) {
    e.preventDefault();
    try {
      await api.createAssignment(id, form);
      setForm({ cefrLevel: "B1", targetTopic: "" });
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!classroom) {
    return (
      <Layout>
        {error ? <div className="error-banner">{error}</div> : <p>Loading...</p>}
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="label">Classroom</div>
      <h1>{classroom.name}</h1>
      {user?.role === "teacher" && <p>Join code: <span className="pill accent">{classroom.join_code}</span></p>}
      {error && <div className="error-banner">{error}</div>}

      {user?.role === "teacher" && (
        <form onSubmit={createAssignment} className="panel" style={{ display: "grid", gap: "0.7rem", marginBottom: "1.5rem", maxWidth: 420 }}>
          <h3 style={{ margin: 0 }}>New assignment</h3>
          <div>
            <div className="label">CEFR level</div>
            <select value={form.cefrLevel} onChange={(e) => setForm((f) => ({ ...f, cefrLevel: e.target.value }))}>
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <div className="label">Target topic</div>
            <input
              placeholder="e.g. Ordering food at a restaurant"
              value={form.targetTopic}
              onChange={(e) => setForm((f) => ({ ...f, targetTopic: e.target.value }))}
              required
            />
          </div>
          <button type="submit">Create assignment</button>
        </form>
      )}

      <h2>Assignments</h2>
      {assignments.length === 0 ? (
        <p>No assignments yet.</p>
      ) : (
        <div style={{ display: "grid", gap: "0.7rem", marginBottom: "2rem" }}>
          {assignments.map((a) => (
            <div key={a.id} className="panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span className="pill">{a.cefr_level}</span>{" "}
                <strong>{a.target_topic}</strong>
              </div>
              {user?.role === "student" && (
                <Link to={`/practice/assignment/${a.id}`}><button>Start</button></Link>
              )}
            </div>
          ))}
        </div>
      )}

      {user?.role === "teacher" && report && (
        <>
          <h2>Class trends (last 24h)</h2>
          <div className="panel highlight">
            {report.breakdown.every((b) => b.turnsAffectedPct === 0) ? (
              <p style={{ margin: 0 }}>No practice turns recorded yet in this window.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                {report.breakdown
                  .filter((b) => b.turnsAffectedPct > 0)
                  .map((b) => (
                    <li key={b.category}>
                      <strong>{b.turnsAffectedPct}%</strong> of turns had a {b.category.replace(/_/g, " ")} error
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Layout>
  );
}
