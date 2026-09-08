import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setToken, setStoredUser } from "../api/client.js";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token, user } = await api.login({ username, password });
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
      <h1>Welcome back</h1>
      <p>Log in to keep practicing.</p>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={handleSubmit} className="panel" style={{ display: "grid", gap: "0.9rem" }}>
        <div>
          <div className="label">Username</div>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div>
          <div className="label">Password</div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? "Logging in..." : "Log in"}
        </button>
      </form>
      <p style={{ marginTop: "1rem" }}>
        New here? <Link to="/register">Create an account</Link>
      </p>
    </div>
  );
}
