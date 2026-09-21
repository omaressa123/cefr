import React from "react";
import { Button } from "../components/Layout.jsx";
import Layout from "../components/Layout.jsx";

export default function Settings() {
  return (
    <Layout>
    
      <div className="fade-in">
        <div className="home-header">
          <p className="home-greeting">Configure your experience</p>
          <h1 className="home-title">Settings</h1>
        </div>

        <div className="panel" style={{ maxWidth: 600 }}>
          <div style={{ marginBottom: "var(--space-6)" }}>
            <h3 style={{ marginBottom: "var(--space-4)" }}>Preferences</h3>
            {[
              { label: "Language", desc: "Interface language", value: "English" },
              { label: "Difficulty", desc: "Adaptive based on performance", value: "Adaptive" },
              { label: "Session Length", desc: "Duration of practice sessions", value: "15 minutes" },
              { label: "Notifications", desc: "Daily reminders and progress updates", value: "On" },
            ].map((s, i) => (
              <div key={i} className="setting-row">
                <div>
                  <label>{s.label}</label>
                  <p>{s.desc}</p>
                </div>
                <span style={{ fontSize: "var(--text-caption)", color: "var(--color-secondary-text)" }}>{s.value}</span>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: "var(--space-6)" }}>
            <h3 style={{ marginBottom: "var(--space-4)" }}>Privacy</h3>
            {[
              { label: "Voice Recording", desc: "Allow audio recording for practice", active: true },
              { label: "Analytics", desc: "Share usage data to improve the app", active: false },
              { label: "Marketing Emails", desc: "Receive tips and product updates", active: false },
            ].map((s, i) => (
              <div key={i} className="setting-row">
                <div>
                  <label>{s.label}</label>
                  <p>{s.desc}</p>
                </div>
                <button className={`toggle ${s.active ? 'active' : ''}`} />
              </div>
            ))}
          </div>

          <Button variant="danger" style={{ marginTop: "var(--space-2)" }}>Delete Account</Button>
        </div>
      </div>
    
    </Layout>
  );
}
