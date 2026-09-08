import { NavLink, useNavigate } from "react-router-dom";
import { Home, BookOpen, FileText, CheckSquare, Mic, LogOut } from "lucide-react";
import { getStoredUser, setToken, setStoredUser } from "../api/client.js";

export default function Layout({ children }) {
  const user = getStoredUser();
  const navigate = useNavigate();

  function logout() {
    setToken(null);
    setStoredUser(null);
    navigate("/login");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">CEFR Practice</div>
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
        {user && (
          <>
            <div className="sidebar-footer" style={{ marginTop: "auto", paddingTop: "1.5rem" }}>
              <div className="label nav-label">{user.role === "teacher" ? "Teacher" : "Student"}</div>
              <div className="nav-label" style={{ marginBottom: "0.75rem" }}>{user.displayName}</div>
              <button className="secondary logout-btn" onClick={logout} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
                <LogOut size={16} /> <span className="nav-label">Log out</span>
              </button>
            </div>
          </>
        )}
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}

