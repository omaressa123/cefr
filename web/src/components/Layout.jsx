import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Home, BookOpen, Headphones, Library, TrendingUp, User, Settings, Menu, X, Bell,
  Mic, Volume2, ArrowLeft, HelpCircle, Play, Pause, Heart, Star, Check
} from "lucide-react";
import { getStoredUser, setToken, setStoredUser } from "../api/client.js";
import "./Layout.css";

const NAV_ITEMS = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/practice", icon: Headphones, label: "Practice" },
  { to: "/scenarios", icon: BookOpen, label: "Scenarios" },
  { to: "/phrases", icon: Library, label: "Phrase Bank" },
  { to: "/progress", icon: TrendingUp, label: "Progress" },
];

export default function Layout({ children, currentPage }) {
  const user = getStoredUser();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  function handleLogout() {
    setToken(null);
    setStoredUser(null);
    navigate("/login");
  }

  function closeSidebar() {
    setSidebarOpen(false);
    setMobileMenuOpen(false);
  }

  return (
    <div className="app-shell">
      <button
        className="sidebar-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle navigation"
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      <aside className={`sidebar ${sidebarOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand" onClick={closeSidebar}>
          <div className="brand-icon">
            <span style={{ fontSize: "1.1rem", fontWeight: 800, color: "white" }}>L</span>
          </div>
          <span className="brand-text">LingoLife</span>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1 }}>
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={closeSidebar}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
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
                {user?.displayName}
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
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            zIndex: 49, display: "none" // desktop overlay handled by sidebar position
          }}
        />
      )}

      <main className="content">{children}</main>
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
          className={`bottom-nav-item ${currentPage === to ? 'active' : ''}`}
          onClick={() => navigate(to)}
        >
          <Icon size={20} className="nav-icon" />
          <span style={{ fontSize: "10px", fontWeight: 500 }}>{label}</span>
        </button>
      ))}
      <button className="bottom-nav-item" onClick={() => navigate('/profile')}>
        <User size={20} className="nav-icon" />
        <span style={{ fontSize: "10px", fontWeight: 500 }}>Profile</span>
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

export function HelpBottomSheet({ levels, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="bottom-sheet" onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-6)" }}>
          <h3 style={{ margin: 0 }}>I'm Stuck — Need Help?</h3>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: "4px" }}><X size={20} /></button>
        </div>
        <p style={{ fontSize: "var(--text-caption)", color: "var(--color-secondary-text)", marginBottom: "var(--space-6)" }}>
          Learning is okay. Mistakes are part of practice.
        </p>
        {levels.map((level, i) => (
          <div key={i} className="help-level">
            <h4>Level {i + 1}: {level.title}</h4>
            <p>{level.content}</p>
          </div>
        ))}
      </div>
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

export function PhraseCard({ phrase, meaning, category, onPlay, onPractice, onMark }) {
  return (
    <div className="phrase-card panel-hover">
      <div style={{ flex: 1 }}>
        <div className="phrase" style={{ fontSize: "var(--text-body)", fontWeight: 500 }}>{phrase}</div>
        <div className="meaning">{meaning}</div>
        <div style={{ marginTop: "4px" }}><Badge variant="info">{category}</Badge></div>
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button className="btn btn-ghost" style={{ padding: "8px", minWidth: "36px" }} onClick={onPlay}><Volume2 size={16} /></button>
        <button className="btn btn-ghost" style={{ padding: "8px", minWidth: "36px" }} onClick={onPractice}><Play size={16} /></button>
        {onMark && <button className="btn btn-ghost" style={{ padding: "8px", minWidth: "36px" }} onClick={onMark}><Heart size={16} /></button>}
      </div>
    </div>
  );
}

export function ScenarioCard({ icon, title, description, duration, difficulty, onClick }) {
  return (
    <div className="scenario-card panel-hover" onClick={onClick}>
      <div className="scenario-card-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      <div className="scenario-card-meta">
        <span className="scenario-card-duration">{duration}</span>
        {difficulty && <Badge variant={difficulty === "Beginner" ? "success" : difficulty === "Intermediate" ? "warning" : "error"}>{difficulty}</Badge>}
      </div>
    </div>
  );
}

export function VoiceRecorder({ isRecording, onStart, onStop, duration, onError }) {
  return (
    <button
      className={`voice-btn ${isRecording ? 'recording' : ''}`}
      onClick={isRecording ? onStop : onStart}
      aria-label={isRecording ? "Stop recording" : "Start recording"}
    >
      {isRecording ? <Pause size={20} /> : <Mic size={20} />}
    </button>
  );
}

export function ConversationBubble({ speaker, message, type = "ai", audioUrl }) {
  return (
    <div className={`message-bubble ${type}`}>
      <span className={`speaker ${type === 'ai' ? 'ai-speaker' : 'user-speaker'}`}>
        {speaker}
      </span>
      <p style={{ margin: 0 }}>{message}</p>
      {audioUrl && type === "ai" && (
        <div className="audio-player" style={{ marginTop: "8px" }}>
          <button className="play-btn"><Play size={12} /></button>
          <span>Listen</span>
        </div>
      )}
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="message-bubble ai">
      <div className="typing-indicator">
        <div className="typing-dot" />
        <div className="typing-dot" />
        <div className="typing-dot" />
        <span style={{ marginLeft: "8px" }}>Thinking...</span>
      </div>
    </div>
  );
}
