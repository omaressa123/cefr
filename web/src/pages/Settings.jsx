import React from "react";
import Layout, { Button, Badge } from "../components/Layout.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { Palette, Check, Sparkles, Moon, Sun } from "lucide-react";

export default function Settings() {
  const { theme, setTheme, themes, currentThemeObj } = useTheme();

  return (
    <Layout>
      <div className="fade-in">
        <div className="home-header">
          <div className="eyebrow">Personalization & Configuration</div>
          <h1 className="home-title">System Settings</h1>
          <p style={{ marginTop: "var(--space-2)", color: "var(--color-secondary-text)" }}>
            Customize system appearance, color themes, and practice preferences.
          </p>
        </div>

        {/* ====== THEME SELECTOR STUDIO ====== */}
        <div className="panel" style={{ maxWidth: 800, marginBottom: "var(--space-6)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
            <div>
              <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                <Palette size={20} style={{ color: "var(--color-primary-purple)" }} />
                Color Theme Studio
              </h3>
              <p style={{ margin: "4px 0 0", fontSize: "var(--text-caption)", color: "var(--color-secondary-text)" }}>
                Select your preferred color scheme. All buttons, cards, badges, and accents update instantly across the entire app.
              </p>
            </div>
            <span className="pill accent">
              Active: {currentThemeObj.name}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--space-4)", marginTop: "var(--space-4)" }}>
            {themes.map((t) => (
              <div
                key={t.id}
                className={`theme-preview-card ${t.id === theme ? "active" : ""}`}
                onClick={() => setTheme(t.id)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <span
                      style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "50%",
                        backgroundColor: t.color,
                        boxShadow: `0 0 10px ${t.color}66`,
                        display: "inline-block",
                      }}
                    />
                    <span
                      style={{
                        width: "14px",
                        height: "14px",
                        borderRadius: "50%",
                        backgroundColor: t.accent,
                        display: "inline-block",
                      }}
                    />
                  </div>
                  {t.id === theme ? (
                    <Badge variant="success">Active ✓</Badge>
                  ) : (
                    <Badge variant="secondary">{t.badge}</Badge>
                  )}
                </div>

                <div style={{ fontWeight: 700, fontSize: "var(--text-body)", color: "var(--color-primary-text)" }}>
                  {t.name}
                </div>

                <div style={{ fontSize: "11px", color: "var(--color-secondary-text)", lineHeight: 1.4 }}>
                  {t.description}
                </div>

                <div
                  style={{
                    marginTop: "auto",
                    paddingTop: "8px",
                    display: "flex",
                    gap: "4px",
                  }}
                >
                  <div style={{ height: "6px", flex: 2, borderRadius: "3px", backgroundColor: t.color }} />
                  <div style={{ height: "6px", flex: 1, borderRadius: "3px", backgroundColor: t.accent }} />
                  <div style={{ height: "6px", flex: 1, borderRadius: "3px", backgroundColor: t.bg, border: "1px solid rgba(255,255,255,0.2)" }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ====== GENERAL PREFERENCES ====== */}
        <div className="panel" style={{ maxWidth: 800 }}>
          <div style={{ marginBottom: "var(--space-6)" }}>
            <h3 style={{ marginBottom: "var(--space-4)" }}>Practice Preferences</h3>
            {[
              { label: "Target CEFR Level", desc: "Adaptive CEFR assessment baseline", value: "B1 - Intermediate" },
              { label: "AI Voice Synthesis", desc: "Natural neural text-to-speech audio", value: "Active (Edge TTS)" },
              { label: "Grammar Guardrail", desc: "CELTA-aligned verbatim quotation filter", value: "Enforced" },
              { label: "Speech Recognition", desc: "Whisper Verbatim model conditioning", value: "Enabled" },
            ].map((s, i) => (
              <div key={i} className="setting-row">
                <div>
                  <label>{s.label}</label>
                  <p>{s.desc}</p>
                </div>
                <span className="pill accent">{s.value}</span>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: "var(--space-6)" }}>
            <h3 style={{ marginBottom: "var(--space-4)" }}>App Behavior</h3>
            {[
              { label: "Auto-Play AI Responses", desc: "Automatically play spoken audio after each turn", active: true },
              { label: "Continuous Session Tracking", desc: "Preserve active conversations across page reloads", active: true },
              { label: "Guided Discovery for B1+", desc: "Encourage self-correction with concept check prompts", active: true },
            ].map((s, i) => (
              <div key={i} className="setting-row">
                <div>
                  <label>{s.label}</label>
                  <p>{s.desc}</p>
                </div>
                <button className={`toggle ${s.active ? "active" : ""}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}
