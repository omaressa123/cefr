import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setToken, setStoredUser } from "../api/client.js";

export default function Register() {
  const [form, setForm] = useState({ username: "", password: "", displayName: "", role: "student" });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token, user } = await api.register(form);
      setToken(token);
      setStoredUser(user);
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 380, margin: "4rem auto" }}>
      <h1>Create an account</h1>
      <p>Practice as a student, or set up classrooms as a teacher.</p>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={handleSubmit} className="panel" style={{ display: "grid", gap: "0.9rem" }}>
        <div>
          <div className="label">Display name</div>
          <input value={form.displayName} onChange={(e) => update("displayName", e.target.value)} required />
        </div>
        <div>
          <div className="label">Username</div>
          <input value={form.username} onChange={(e) => update("username", e.target.value)} required />
        </div>
        <div>
          <div className="label">Password</div>
          <input
            type="password"
            value={form.password}
            onChange={(e) => update("password", e.target.value)}
            required
          />
        </div>
        <div>
          <div className="label">I am a</div>
          <select value={form.role} onChange={(e) => update("role", e.target.value)}>
            <option value="student">Student</option>
            <option value="teacher">Teacher</option>
          </select>
        </div>
        <button type="submit" disabled={loading}>
          {loading ? "Creating account..." : "Create account"}
        </button>
      </form>
      <p style={{ marginTop: "1rem" }}>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
