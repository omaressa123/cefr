import React, { useState, useRef, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Home, BookOpen, Headphones, Library, TrendingUp, Settings, Menu, X, Check, Palette, LogOut
} from "lucide-react";
import { getStoredUser, setToken, setStoredUser } from "../api/client.js";
import { useTheme } from "../context/ThemeContext.jsx";
import "./Layout.css";

const NAV_ITEMS = [
  { to: "/", icon: Home, label: "Home", match: ["/", "/profile"] },
  { to: "/practice/free", icon: Headphones, label: "Practice", match: ["/practice"] },
  { to: "/scenarios", icon: BookOpen, label: "Scenarios", match: ["/scenarios"] },
  { to: "/phrases", icon: Library, label: "Phrase Bank", match: ["/phrases"] },
  { to: "/learning/progress", icon: TrendingUp, label: "Progress", match: ["/learning/progress", "/progress", "/learning"] },
  { to: "/settings", icon: Settings, label: "Settings", match: ["/settings"] },
];

export function ThemeSwitcherDropdown() {
  const { theme, setTheme, themes, currentThemeObj } = useTheme();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div style={{ position: "relative" }} ref={dropdownRef}>
      <button
        type="button"
        className="theme-switch-btn"
        onClick={() => setOpen(!open)}
        title="Change system color theme"
        aria-label="Change theme"
      >
        <span
          className="theme-color-dot"
          style={{ backgroundColor: currentThemeObj.color, color: currentThemeObj.color }}
        />
        <span>{currentThemeObj.name}</span>
        <Palette size={14} style={{ opacity: 0.7 }} />
      </button>

      {open && (
        <div className="theme-dropdown">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px 8px", borderBottom: "1px solid var(--color-border)" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary-text)" }}>
              Color Themes
            </span>
            <span style={{ fontSize: "10px", color: "var(--color-primary-purple)" }}>
              Instant Preview
            </span>
          </div>
          {themes.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`theme-option-row ${t.id === theme ? "active" : ""}`}
              onClick={() => {
                setTheme(t.id);
                setOpen(false);
              }}
            >
              <span
                className="theme-color-dot"
                style={{ backgroundColor: t.color, color: t.color }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{t.name}</div>
                <div style={{ fontSize: "10px", color: "var(--color-secondary-text)" }}>{t.badge}</div>
              </div>
              {t.id === theme && <Check size={14} style={{ color: "var(--color-primary-purple)" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout({ children, currentPage }) {
  const user = getStoredUser();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  function handleLogout() {
    setToken(null);
    setStoredUser(null);
    navigate("/login");
  }

  function closeSidebar() {
    setSidebarOpen(false);
  }

  // Lock body scroll when the mobile sidebar is open + close on Escape
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? "hidden" : "";
    function onKey(e) {
      if (e.key === "Escape") setSidebarOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [sidebarOpen]);

  return (
    <div className="app-shell">
      {/* Mobile Top Bar (CSS controls visibility) */}
      <div className="mobile-header-bar">
        <button
          type="button"
          className="sidebar-toggle sidebar-toggle-inline"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle navigation"
          aria-expanded={sidebarOpen}
        >
          {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
        </button>

        <div className="brand-text mobile-brand">
          LingoLife
        </div>

        <ThemeSwitcherDropdown />
      </div>

      <button
        type="button"
        className="sidebar-toggle sidebar-toggle-fab"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle navigation"
        aria-expanded={sidebarOpen}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      <aside className={`sidebar ${sidebarOpen ? "mobile-open" : ""}`}>
        <div className="sidebar-brand" onClick={closeSidebar}>
          <div className="brand-icon">
            <span style={{ fontSize: "1.1rem", fontWeight: 800, color: "white" }}>L</span>
          </div>
          <div style={{ flex: 1 }}>
            <span className="brand-text">LingoLife</span>
          </div>
        </div>

        {/* Theme Quick Switcher in Sidebar */}
        <div className="sidebar-theme-switch">
          <ThemeSwitcherDropdown />
        </div>

        <nav className="sidebar-nav" aria-label="Primary">
          {NAV_ITEMS.map(({ to, icon: Icon, label, match }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive || (currentPage && match?.includes(currentPage)) ? "active" : ""}`
              }
            >
              <Icon size={18} className="nav-icon" />
              <span className="nav-label">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="avatar avatar-sm">
              {user?.displayName?.charAt(0) || "?"}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">
                {user?.displayName || "Student"}
              </div>
              <div className="sidebar-user-role">
                {user?.role === "teacher" ? "Teacher" : "Student"}
              </div>
            </div>
          </div>
          <button type="button" className="nav-item nav-logout" onClick={handleLogout}>
            <LogOut size={18} className="nav-icon" />
            <span className="nav-label">Log out</span>
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="sidebar-overlay sidebar-overlay-visible"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      <main className="content">
        {/* Desktop Header bar with quick theme switcher */}
        <div className="content-header">
          <ThemeSwitcherDropdown />
        </div>
        {children}
      </main>
    </div>
  );
}

export function BottomNavigation({ currentPage }) {
  const MOBILE_ITEMS = [
    { to: "/", icon: Home, label: "Home", match: ["/", "/profile"] },
    { to: "/practice/free", icon: Headphones, label: "Practice", match: ["/practice", "/practice/free"] },
    { to: "/scenarios", icon: BookOpen, label: "Scenarios", match: ["/scenarios"] },
    { to: "/phrases", icon: Library, label: "Phrases", match: ["/phrases"] },
    { to: "/learning/progress", icon: TrendingUp, label: "Progress", match: ["/progress", "/learning/progress", "/learning"] },
  ];

  function isActive(item) {
    if (currentPage) return item.match?.includes(currentPage);
    return false;
  }

  return (
    <nav className="bottom-nav" aria-label="Mobile">
      {MOBILE_ITEMS.map(({ to, icon: Icon, label, match }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive: routerActive }) =>
            `bottom-nav-item ${routerActive || isActive({ match }) ? "active" : ""}`
          }
        >
          <Icon size={20} className="nav-icon" />
          <span>{label}</span>
        </NavLink>
      ))}
      <NavLink to="/settings" className={({ isActive }) => `bottom-nav-item ${isActive ? "active" : ""}`}>
        <Settings size={20} className="nav-icon" />
        <span>Settings</span>
      </NavLink>
    </nav>
  );
}

export function Avatar({ name, size = "sm" }) {
  const initials = name?.charAt(0)?.toUpperCase() || "?";
  return <div className={`avatar avatar-${size}`}>{initials}</div>;
}

export function Badge({ children, variant = "primary" }) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}

export function Button({ children, variant = "primary", className = "", onClick, disabled, type = "button", ...props }) {
  return (
    <button
      className={`btn btn-${variant} ${className}`}
      onClick={onClick}
      disabled={disabled}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input({ placeholder, value, onChange, type = "text", ...props }) {
  return (
    <input
      className="input"
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      type={type}
      {...props}
    />
  );
}

export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <Button>{action}</Button>}
    </div>
  );
}

export function LoadingState({ message = "Loading..." }) {
  return (
    <div className="flex items-center justify-center" style={{ padding: "var(--space-10)" }}>
      <div style={{ textAlign: "center" }}>
        <div className="skeleton" style={{ width: 40, height: 40, borderRadius: "50%", margin: "0 auto var(--space-4)" }} />
        <p style={{ color: "var(--color-secondary-text)", fontSize: "var(--text-caption)" }}>{message}</p>
      </div>
    </div>
  );
}

export function ErrorState({ message = "Something went wrong", action }) {
  return (
    <div className="error-state">
      <h3>Oops!</h3>
      <p>{message}</p>
      {action && <Button>{action}</Button>}
    </div>
  );
}

export function ProgressIndicator({ value, max = 100, size = "md" }) {
  const percent = Math.min((value / max) * 100, 100);
  return (
    <div className="progress-track" style={{ width: size === "lg" ? "100%" : "120px" }}>
      <div className="progress-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function FeedbackCard({ success, corrections, alternatives, phrase }) {
  return (
    <div className="feedback-card fade-in">
      {success && (
        <div className="feedback-success">✓ {success}</div>
      )}
      {corrections?.map((c, i) => (
        <div key={i} className="feedback-correction">
          <strong style={{ fontSize: "var(--text-helper)", color: "var(--color-error)" }}>Correction:</strong>
          <p style={{ margin: "4px 0 0", fontSize: "var(--text-caption)" }}>{c}</p>
        </div>
      ))}
      {alternatives?.map((a, i) => (
        <div key={i} className="feedback-alternative">
          <strong style={{ fontSize: "var(--text-helper)", color: "var(--color-info)" }}>Try this:</strong>
          <p style={{ margin: "4px 0 0", fontSize: "var(--text-caption)" }}>{a}</p>
        </div>
      ))}
      {phrase && (
        <div style={{ marginTop: "var(--space-3)", padding: "var(--space-3)", background: "rgba(54,201,143,0.08)", borderRadius: "var(--radius-sm)" }}>
          <span style={{ fontSize: "var(--text-helper)", color: "var(--color-success)", fontWeight: 600 }}>📖 New phrase:</span>
          <p style={{ margin: "4px 0 0", fontSize: "var(--text-body)", color: "var(--color-primary-text)" }}>{phrase}</p>
        </div>
      )}
    </div>
  );
}
