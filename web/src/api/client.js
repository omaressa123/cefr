const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api/v1";

function getToken() {
  return localStorage.getItem("cefr_token");
}

export function setToken(token) {
  if (token) localStorage.setItem("cefr_token", token);
  else localStorage.removeItem("cefr_token");
}

export function getStoredUser() {
  const raw = localStorage.getItem("cefr_user");
  return raw ? JSON.parse(raw) : null;
}

export function setStoredUser(user) {
  if (user) localStorage.setItem("cefr_user", JSON.stringify(user));
  else localStorage.removeItem("cefr_user");
}

async function request(path, { method = "GET", body, isForm = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!isForm && body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  // Always parse as JSON — body stream can only be consumed once
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  register: (payload) => request("/auth/register", { method: "POST", body: payload }),
  login: (payload) => request("/auth/login", { method: "POST", body: payload }),
  me: () => request("/auth/me"),

  createClassroom: (name) => request("/classrooms", { method: "POST", body: { name } }),
  listClassrooms: async () => {
    const data = await request("/classrooms");
    return Array.isArray(data) ? data : data?.classrooms ?? data?.data ?? [];
  },
  joinClassroom: (joinCode) => request("/classrooms/join", { method: "POST", body: { joinCode } }),
  getClassroom: (id) => request(`/classrooms/${id}`),

  createAssignment: (classroomId, payload) =>
    request(`/classrooms/${classroomId}/assignments`, { method: "POST", body: payload }),
  listAssignments: (classroomId) => request(`/classrooms/${classroomId}/assignments`),

  startSession: (payload) => request("/sessions", { method: "POST", body: payload }),
  submitTextTurn: (sessionId, text) =>
    request(`/sessions/${sessionId}/turns/text`, { method: "POST", body: { text } }),
  submitAudioTurn: (sessionId, formData) =>
    request(`/sessions/${sessionId}/turns/audio`, { method: "POST", body: formData, isForm: true }),
  getExchanges: (sessionId) => request(`/sessions/${sessionId}/exchanges`),
  getSessionReport: (sessionId) => request(`/sessions/${sessionId}/report`),

  getCohortReport: (classroomId) => request(`/classrooms/${classroomId}/report`),

  getEngineStatus: () => request("/engine/status"),

  getCefrLevels: () => request("/cefr/levels"),

  listVocabulary: (params = {}) => request(`/vocabulary?${new URLSearchParams(params)}`),

  getVocabulary: (id) => {
    const validId = parseInt(id, 10);
    if (isNaN(validId) || validId <= 0) throw new Error("Invalid vocabulary ID");
    return request(`/vocabulary/${validId}`);
  },

  learnVocabulary: (id) => {
    const validId = parseInt(id, 10);
    if (isNaN(validId) || validId <= 0) throw new Error("Invalid vocabulary ID");
    return request(`/vocabulary/${validId}/learn`, { method: "POST" });
  },

  favoriteVocabulary: (id, favorite) => {
    const validId = parseInt(id, 10);
    if (isNaN(validId) || validId <= 0) throw new Error("Invalid vocabulary ID");
    return request(`/vocabulary/${validId}/favorite`, { method: "POST", body: { favorite } });
  },

  reviewVocabulary: (id, correct) => {
    const validId = parseInt(id, 10);
    if (isNaN(validId) || validId <= 0) throw new Error("Invalid vocabulary ID");
    return request(`/vocabulary/${validId}/review`, { method: "POST", body: { correct } });
  },

  listGrammar: (level) => request(`/grammar${level ? `?level=${level}` : ""}`),

  getGrammar: (id) => {
    const validId = parseInt(id, 10);
    if (isNaN(validId) || validId <= 0) throw new Error("Invalid grammar ID");
    return request(`/grammar/${validId}`);
  },

  completeGrammar: (id, score) => {
    const validId = parseInt(id, 10);
    if (isNaN(validId) || validId <= 0) throw new Error("Invalid grammar ID");
    return request(`/grammar/${validId}/complete`, { method: "POST", body: { score } });
  },

  listPronunciation: (level) => request(`/pronunciation${level ? `?level=${level}` : ""}`),

  getPronunciation: (id) => {
    const validId = parseInt(id, 10);
    if (isNaN(validId) || validId <= 0) throw new Error("Invalid pronunciation ID");
    return request(`/pronunciation/${validId}`);
  },

  completePronunciation: (id) => {
    const validId = parseInt(id, 10);
    if (isNaN(validId) || validId <= 0) throw new Error("Invalid pronunciation ID");
    return request(`/pronunciation/${validId}/complete`, { method: "POST" });
  },

  pronunciationAudio: (id, text) => {
    const validId = parseInt(id, 10);
    if (isNaN(validId) || validId <= 0) throw new Error("Invalid pronunciation ID");
    if (!text || typeof text !== "string") throw new Error("Invalid text for pronunciation audio");
    return request(`/pronunciation/${validId}/audio`, { method: "POST", body: { text } });
  },

  listSentenceTopics: (level) => request(`/sentence-structure${level ? `?level=${level}` : ""}`),

  getSentenceTopic: (id) => {
    const validId = parseInt(id, 10);
    if (isNaN(validId) || validId <= 0) throw new Error("Invalid sentence topic ID");
    return request(`/sentence-structure/${validId}`);
  },

  answerSentenceExercise: (id, exerciseId, answer) => {
    const validId = parseInt(id, 10);
    if (isNaN(validId) || validId <= 0) throw new Error("Invalid sentence exercise ID");
    return request(`/sentence-structure/${validId}/answer`, { method: "POST", body: { exerciseId, answer } });
  },

  startQuiz: (skill, cefrLevel, limit = 5) => {
    if (!skill || !cefrLevel) throw new Error("Both skill and cefrLevel are required");
    const validSkills = ["vocabulary", "grammar", "pronunciation", "sentence_structure", "speaking"];
    if (!validSkills.includes(skill)) throw new Error(`Invalid skill. Valid: ${validSkills.join(", ")}`);
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("Limit must be a positive integer");
    return request("/quiz/start", { method: "POST", body: { skill, cefrLevel, limit } });
  },

  answerQuiz: (questionId, answer) => {
    if (!questionId || !answer) throw new Error("Both questionId and answer are required");
    return request("/quiz/answer", { method: "POST", body: { questionId, answer } });
  },

  finishQuiz: (questionIds) => {
    const ids = Array.isArray(questionIds) ? questionIds : [questionIds];
    return request("/quiz/finish", { method: "POST", body: { questionIds: ids } });
  },

  getProgress: async () => {
    const data = await request("/progress");
    return Array.isArray(data) ? data : [data];
  },

  getRecommendations: async () => {
    const data = await request("/recommendations");
    return Array.isArray(data) ? data : data?.recommendations ?? data?.data ?? [];
  },
};
