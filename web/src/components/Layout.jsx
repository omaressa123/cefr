import React, { useState, useRef, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Home, BookOpen, Headphones, Library, TrendingUp, User, Settings, Menu, X, Bell,
  Mic, Volume2, ArrowLeft, HelpCircle, Play, Pause, Heart, Star, Check, Palette, Sparkles
} from "lucide-react";
import { getStoredUser, setToken, setStoredUser } from "../api/client.js";
import { useTheme } from "../context/ThemeContext.jsx";
import "./Layout.css";

const NAV_ITEMS = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/practice", icon: Headphones, label: "Practice" },
  { to: "/scenarios", icon: BookOpen, label: "Scenarios" },
  { to: "/phrases", icon: Library, label: "Phrase Bank" },
  { to: "/progress", icon: TrendingUp, label: "Progress" },
  { to: "/settings", icon: Settings, label: "Settings" },
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
  const { currentThemeObj, cycleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  function handleLogout() {
    setToken(null);
    setStoredUser(null);
    navigate("/login");
  }

  function closeSidebar() {
    setSidebarOpen(false);
  }

  return (
    <div className="app-shell">
      {/* Mobile Top Bar */}
      <div className="mobile-header-bar" style={{
        display: "none",
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "56px",
        background: "var(--color-dark-surface)",
        borderBottom: "1px solid var(--color-border)",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        zIndex: "var(--z-sidebar)",
      }}>
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle navigation"
          style={{ display: "flex", background: "none", border: "none", padding: "6px" }}
        >
          {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
        </button>

        <div className="brand-text" style={{ fontSize: "1.1rem", fontWeight: 700 }}>
          LingoLife
        </div>

        <ThemeSwitcherDropdown />
      </div>

      <button
        className="sidebar-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle navigation"
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
        <div style={{ padding: "0 8px 16px" }}>
          <ThemeSwitcherDropdown />
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1 }}>
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={closeSidebar}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            >
              <Icon size={18} className="nav-icon" />
              <span className="nav-label">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user" style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px" }}>
            <div className="avatar avatar-sm">
              {user?.displayName?.charAt(0) || "?"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--color-primary-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {user?.displayName || "Student"}
              </div>
              <div style={{ fontSize: "0.7rem", color: "var(--color-secondary-text)" }}>
                {user?.role === "teacher" ? "Teacher" : "Student"}
              </div>
            </div>
          </div>
          <button className="nav-item" onClick={handleLogout} style={{ marginTop: "4px" }}>
            <X size={18} className="nav-icon" />
            <span className="nav-label">Log out</span>
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={closeSidebar}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            zIndex: 49,
            display: "block",
          }}
        />
      )}

      <main className="content">
        {/* Desktop Header bar with quick theme switcher */}
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: "1.5rem" }}>
          <ThemeSwitcherDropdown />
        </div>
        {children}
      </main>
    </div>
  );
}

export function BottomNavigation({ currentPage }) {
  const navigate = useNavigate();
  const MOBILE_ITEMS = [
    { to: "/", icon: Home, label: "Home" },
    { to: "/practice", icon: Headphones, label: "Practice" },
    { to: "/scenarios", icon: BookOpen, label: "Scenarios" },
    { to: "/phrases", icon: Library, label: "Phrases" },
    { to: "/progress", icon: TrendingUp, label: "Progress" },
  ];

  return (
    <nav className="bottom-nav">
      {MOBILE_ITEMS.map(({ to, icon: Icon, label }) => (
        <button
          key={to}
          className={`bottom-nav-item ${currentPage === to ? "active" : ""}`}
          onClick={() => navigate(to)}
        >
          <Icon size={20} className="nav-icon" />
          <span style={{ fontSize: "10px", fontWeight: 500 }}>{label}</span>
        </button>
      ))}
      <button className="bottom-nav-item" onClick={() => navigate("/settings")}>
        <Settings size={20} className="nav-icon" />
        <span style={{ fontSize: "10px", fontWeight: 500 }}>Settings</span>
      </button>
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
