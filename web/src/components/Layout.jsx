import React, { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Home, BookOpen, FileText, CheckSquare, Mic, LogOut, Sun, Moon } from "lucide-react";
import { getStoredUser, setToken, setStoredUser } from "../api/client.js";

export default function Layout({ children }) {
  const user = getStoredUser();
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => localStorage.getItem("cefr_theme") || "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("cefr_theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }

  function logout() {
    setToken(null);
    setStoredUser(null);
    navigate("/login");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <div className="brand" style={{ margin: 0 }}>CEFR Practice</div>
        </div>

        <NavLink to="/" end className={({ isActive }) => (isActive ? "active nav-item" : "nav-item")}>
          <Home size={18} className="nav-icon" /> <span className="nav-label">Dashboard</span>
        </NavLink>
        <NavLink to="/learning" end className={({ isActive }) => (isActive ? "active nav-item" : "nav-item")}>
          <BookOpen size={18} className="nav-icon" /> <span className="nav-label">Learn</span>
        </NavLink>
        <NavLink to="/learning/vocabulary" className={({ isActive }) => (isActive ? "active nav-item" : "nav-item")}>
          <FileText size={18} className="nav-icon" /> <span className="nav-label">Vocabulary</span>
        </NavLink>
        <NavLink to="/learning/grammar" className={({ isActive }) => (isActive ? "active nav-item" : "nav-item")}>
          <CheckSquare size={18} className="nav-icon" /> <span className="nav-label">Grammar</span>
        </NavLink>
        <NavLink to="/learning/pronunciation" className={({ isActive }) => (isActive ? "active nav-item" : "nav-item")}>
          <Mic size={18} className="nav-icon" /> <span className="nav-label">Pronunciation</span>
        </NavLink>

        <div className="sidebar-footer" style={{ marginTop: "auto", paddingTop: "1.5rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            <span className="nav-label">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
          </button>

          {user && (
            <>
              <div style={{ marginTop: "0.4rem" }}>
                <div className="label nav-label">{user.role === "teacher" ? "Teacher" : "Student"}</div>
                <div className="nav-label" style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                  {user.displayName}
                </div>
              </div>
              <button
                type="button"
                className="secondary logout-btn"
                onClick={logout}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
              >
                <LogOut size={16} /> <span className="nav-label">Log out</span>
              </button>
            </>
          )}
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
