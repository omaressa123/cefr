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
      console.log("Fetched classrooms:", data);
      console.log("User role:", user?.role);
      console.log("User ID:", user?.id);
      console.log("Is array:", Array.isArray(data));
    setClassrooms(Array.isArray(data) ? data : data.classrooms ?? data.data ?? []);
    } catch (err) {
    setError(err.message);
    setClassrooms([]);
    setTimeout(() => setError(null), 10000); 
    setRecommendations([]);
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
      <h1>{user?.role === "teacher" ? "Your classrooms" : "Your classes"}</h1>
      {error && <div className="error-banner">{error}</div>}

      {user?.role === "teacher" ? (
        <form onSubmit={createClassroom} className="panel" style={{ display: "flex", gap: "0.6rem", marginBottom: "1.5rem" }}>
          <input placeholder="Classroom name (e.g. B2 Evening Group)" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button type="submit">Create classroom</button>
        </form>
      ) : (
        <form onSubmit={joinClassroom} className="panel" style={{ display: "flex", gap: "0.6rem", marginBottom: "1.5rem" }}>
          <input placeholder="Join code (e.g. A1B2C3)" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} />
          <button type="submit">Join classroom</button>
        </form>
      )}

      {classrooms.length === 0 ? (
        <p>Nothing here yet.</p>
      ) : (
        <div style={{ display: "grid", gap: "0.8rem" }}>
          {classrooms.map((c) => (
            <Link key={c.id} to={`/classrooms/${c.id}`} className="panel" style={{ display: "block", color: "inherit" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0 }}>{c.name}</h3>
                {user?.role === "teacher" && <span className="pill accent">code: {c.join_code}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}

      {user?.role === "student" && (
        <div style={{ marginTop: "2rem" }}>
          <h2>Free practice</h2>
          <p>Practice without an assignment, at whatever level suits you.</p>
          <Link to="/practice/free">
            <button>Start free practice</button>
          </Link>
        </div>
      )}
    </Layout>
  );
}
