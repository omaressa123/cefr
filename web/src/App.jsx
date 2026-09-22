import React, { useEffect } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import Layout, { BottomNavigation, Badge } from "./components/Layout.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import PracticeSession from "./pages/PracticeSession.jsx";
import ClassroomDetail from "./pages/ClassroomDetail.jsx";
import LearningDashboard from "./pages/LearningDashboard.jsx";
import Vocabulary from "./pages/Vocabulary.jsx";
import VocabularyDetail from "./pages/VocabularyDetail.jsx";
import GrammarRoadmap from "./pages/GrammarRoadmap.jsx";
import GrammarLesson from "./pages/GrammarLesson.jsx";
import PronunciationLab from "./pages/PronunciationLab.jsx";
import PronunciationLesson from "./pages/PronunciationLesson.jsx";
import SentenceBuilder from "./pages/SentenceBuilder.jsx";
import Quiz from "./pages/Quiz.jsx";
import LearningProgress from "./pages/LearningProgress.jsx";
import PhraseBank from "./pages/PhraseBank.jsx";
import Settings from "./pages/Settings.jsx";
import TypographyTool from "./pages/TypographyTool/TypographyTool.jsx";
import { getStoredUser } from "./api/client.js";

function RequireAuth({ children }) {
  const user = getStoredUser();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    document.querySelector(".content")?.scrollTo?.({ top: 0 });
  }, [pathname]);
  return null;
}

function PageTransition({ children }) {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="page-transition">
      {children}
    </div>
  );
}

function AppLayout({ children, currentPage }) {
  return (
    <>
      <PageTransition>{children}</PageTransition>
      <BottomNavigation currentPage={currentPage} />
    </>
  );
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route path="/" element={
        <RequireAuth>
          <AppLayout currentPage="/"><Dashboard /></AppLayout>
        </RequireAuth>
      } />
      <Route path="/classrooms/:id" element={
        <RequireAuth>
          <AppLayout currentPage="/"><ClassroomDetail /></AppLayout>
        </RequireAuth>
      } />
      <Route path="/practice/free" element={
        <RequireAuth>
          <AppLayout currentPage="/practice"><PracticeSession /></AppLayout>
        </RequireAuth>
      } />
      <Route path="/practice/assignment/:assignmentId" element={
        <RequireAuth>
          <AppLayout currentPage="/practice"><PracticeSession /></AppLayout>
        </RequireAuth>
      } />

      <Route path="/practice" element={
        <RequireAuth>
          <AppLayout currentPage="/practice"><Navigate to="/practice/free" replace /></AppLayout>
        </RequireAuth>
      } />

      <Route path="/scenarios" element={
        <RequireAuth>
          <AppLayout currentPage="/scenarios"><ScenariosHome /></AppLayout>
        </RequireAuth>
      } />
      <Route path="/scenarios/:id" element={
        <RequireAuth>
          <AppLayout currentPage="/scenarios"><PracticeSession /></AppLayout>
        </RequireAuth>
      } />

      <Route path="/phrases" element={
        <RequireAuth>
          <AppLayout currentPage="/phrases"><PhraseBank /></AppLayout>
        </RequireAuth>
      } />

      <Route path="/learning" element={
        <RequireAuth>
          <AppLayout currentPage="/learning"><LearningDashboard /></AppLayout>
        </RequireAuth>
      } />
      <Route path="/learning/vocabulary" element={
        <RequireAuth>
          <AppLayout currentPage="/learning"><Vocabulary /></AppLayout>
        </RequireAuth>
      } />
      <Route path="/learning/vocabulary/:id" element={
        <RequireAuth>
          <AppLayout currentPage="/learning"><VocabularyDetail /></AppLayout>
        </RequireAuth>
      } />
      <Route path="/learning/grammar" element={
        <RequireAuth>
          <AppLayout currentPage="/learning"><GrammarRoadmap /></AppLayout>
        </RequireAuth>
      } />
      <Route path="/learning/grammar/:id" element={
        <RequireAuth>
          <AppLayout currentPage="/learning"><GrammarLesson /></AppLayout>
        </RequireAuth>
      } />
      <Route path="/learning/pronunciation" element={
        <RequireAuth>
          <AppLayout currentPage="/learning"><PronunciationLab /></AppLayout>
        </RequireAuth>
      } />
      <Route path="/learning/pronunciation/:id" element={
        <RequireAuth>
          <AppLayout currentPage="/learning"><PronunciationLesson /></AppLayout>
        </RequireAuth>
      } />
      <Route path="/learning/sentences" element={
        <RequireAuth>
          <AppLayout currentPage="/learning"><SentenceBuilder /></AppLayout>
        </RequireAuth>
      } />
      <Route path="/learning/quiz" element={
        <RequireAuth>
          <AppLayout currentPage="/learning"><Quiz /></AppLayout>
        </RequireAuth>
      } />
      <Route path="/learning/progress" element={
        <RequireAuth>
          <AppLayout currentPage="/progress"><LearningProgress /></AppLayout>
        </RequireAuth>
      } />

      <Route path="/profile" element={
        <RequireAuth>
          <AppLayout currentPage="/"><Profile /></AppLayout>
        </RequireAuth>
      } />
      <Route path="/settings" element={
        <RequireAuth>
          <AppLayout currentPage="/settings"><Settings /></AppLayout>
        </RequireAuth>
      } />

      <Route path="/typography" element={
        <RequireAuth>
          <AppLayout currentPage="/typography"><TypographyTool /></AppLayout>
        </RequireAuth>
      } />

      <Route path="/progress" element={<Navigate to="/learning/progress" replace />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}

function ScenariosHome() {
  const navigate = useNavigate();
  return (
    <Layout>
    <div className="fade-in">
      <div className="home-header">
        <p className="home-greeting">Choose your situation</p>
        <h1 className="home-title">Practice Scenarios</h1>
        <div className="home-goal" style={{ marginTop: "var(--space-3)" }}>
          <span>🎯</span> Pick a real-life scenario to practice
        </div>
      </div>
      <div className="scenario-grid">
        {[
          { icon: "💼", title: "Work & Freelancing", desc: "Meetings, emails, negotiations, and professional communication", duration: "15-20 min", difficulty: "Intermediate" },
          { icon: "☕", title: "Daily Life", desc: "Ordering, shopping, directions, and everyday interactions", duration: "10-15 min", difficulty: "Beginner" },
          { icon: "✈️", title: "Travel", desc: "Hotels, transportation, asking for help, and sightseeing", duration: "15-20 min", difficulty: "Beginner" },
          { icon: "💼", title: "Job Interview", desc: "Introduce yourself, answer questions, and discuss experience", duration: "20-25 min", difficulty: "Advanced" },
          { icon: "🏋️", title: "Gym & Sports", desc: "Trainer instructions, group classes, and fitness talk", duration: "10-15 min", difficulty: "Beginner" },
          { icon: "🎉", title: "Social Conversations", desc: "Small talk, parties, making friends, and casual chat", duration: "10-15 min", difficulty: "Beginner" },
        ].map((scenario, i) => (
          <button
            key={i}
            type="button"
            className="scenario-card panel-hover scenario-card-btn"
            onClick={() => navigate(`/scenarios/${i + 1}`)}
          >
            <div className="scenario-card-icon">{scenario.icon}</div>
            <h3>{scenario.title}</h3>
            <p>{scenario.desc}</p>
            <div className="scenario-card-meta">
              <span className="scenario-card-duration">{scenario.duration}</span>
              <Badge variant={scenario.difficulty === "Beginner" ? "success" : scenario.difficulty === "Intermediate" ? "warning" : "error"}>{scenario.difficulty}</Badge>
            </div>
          </button>
        ))}
      </div>
    </div>
    </Layout>
  );
}

function Profile() {
  return (
    <Layout>
    <div className="fade-in">
      <div className="home-header">
        <p className="home-greeting">Your account</p>
        <h1 className="home-title">Profile</h1>
      </div>
      <div className="panel profile-panel">
        <div className="profile-head">
          <div className="avatar avatar-lg">U</div>
          <div className="profile-head-text">
            <h3>User</h3>
            <p>student@lingo.com</p>
          </div>
        </div>
        <div className="profile-stats-grid">
          <div className="progress-stat">
            <div className="stat-value">24</div>
            <div className="stat-label">Sessions</div>
          </div>
          <div className="progress-stat">
            <div className="stat-value">12h</div>
            <div className="stat-label">Practice Time</div>
          </div>
          <div className="progress-stat">
            <div className="stat-value">58</div>
            <div className="stat-label">Phrases</div>
          </div>
          <div className="progress-stat">
            <div className="stat-value">6</div>
            <div className="stat-label">Scenarios</div>
          </div>
        </div>
        <h3 style={{ marginBottom: "var(--space-3)" }}>Settings</h3>
        {[
          { label: "Dark Mode", desc: "Toggle dark theme", active: true },
          { label: "Audio Playback", desc: "Auto-play AI responses", active: true },
          { label: "Voice Input", desc: "Use microphone for responses", active: false },
          { label: "Arabic Interface", desc: "RTL layout and Arabic UI", active: false },
        ].map((s, i) => (
          <div key={i} className="setting-row">
            <div>
              <label>{s.label}</label>
              <p>{s.desc}</p>
            </div>
            <button type="button" aria-label={s.label} className={`toggle ${s.active ? 'active' : ''}`} />
          </div>
        ))}
      </div>
    </div>
    </Layout>
  );
}


