import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import ClassroomDetail from "./pages/ClassroomDetail.jsx";
import PracticeSession from "./pages/PracticeSession.jsx";
import { getStoredUser } from "./api/client.js";
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

function RequireAuth({ children }) {
  const user = getStoredUser();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/classrooms/:id" element={<RequireAuth><ClassroomDetail /></RequireAuth>} />
      <Route path="/practice/free" element={<RequireAuth><PracticeSession /></RequireAuth>} />
      <Route path="/practice/assignment/:assignmentId" element={<RequireAuth><PracticeSession /></RequireAuth>} />
      <Route path="/learning" element={<RequireAuth><LearningDashboard /></RequireAuth>} />
      <Route path="/learning/vocabulary" element={<RequireAuth><Vocabulary /></RequireAuth>} />
      <Route path="/learning/vocabulary/:id" element={<RequireAuth><VocabularyDetail /></RequireAuth>} />
      <Route path="/learning/grammar" element={<RequireAuth><GrammarRoadmap /></RequireAuth>} />
      <Route path="/learning/grammar/:id" element={<RequireAuth><GrammarLesson /></RequireAuth>} />
      <Route path="/learning/pronunciation" element={<RequireAuth><PronunciationLab /></RequireAuth>} />
      <Route path="/learning/pronunciation/:id" element={<RequireAuth><PronunciationLesson /></RequireAuth>} />
      <Route path="/learning/sentences" element={<RequireAuth><SentenceBuilder /></RequireAuth>} />
      <Route path="/learning/quiz" element={<RequireAuth><Quiz /></RequireAuth>} />
      <Route path="/learning/progress" element={<RequireAuth><LearningProgress /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
