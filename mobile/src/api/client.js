import AsyncStorage from "@react-native-async-storage/async-storage";

// Set EXPO_PUBLIC_API_URL to the public server URL, including /api/v1.
// Example development value: http://192.168.1.20:4000/api/v1
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000/api/v1";

const TOKEN_KEY = "cefr_token";
const USER_KEY = "cefr_user";
const DEFAULT_TIMEOUT_MS = 15000;

let cachedToken = null;

export class ApiError extends Error {
  constructor(message, { status = null, isNetworkError = false, isTimeout = false, data = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.isNetworkError = isNetworkError;
    this.isTimeout = isTimeout;
    this.data = data;
  }
}

let onUnauthorized = null;
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

export async function getToken() {
  if (cachedToken) return cachedToken;
  cachedToken = await AsyncStorage.getItem(TOKEN_KEY);
  return cachedToken;
}

export async function setToken(token) {
  cachedToken = token;
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

export async function getStoredUser() {
  const raw = await AsyncStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function setStoredUser(user) {
  if (user) await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  else await AsyncStorage.removeItem(USER_KEY);
}


export async function clearSession() {
  await setToken(null);
  await setStoredUser(null);
}

function buildUrl(path, params) {
  if (!params || Object.keys(params).length === 0) return `${API_BASE_URL}${path}`;
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
  ).toString();
  return query ? `${API_BASE_URL}${path}?${query}` : `${API_BASE_URL}${path}`;
}

async function request(path, { method = "GET", body, params, isForm = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const headers = {};
  const token = await getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!isForm && body) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(buildUrl(path, params), {
      method,
      headers,
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new ApiError(`Request timed out after ${timeoutMs}ms`, { isTimeout: true });
    }
    throw new ApiError(err.message || "Network request failed", { isNetworkError: true });
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) {
      // Fire and forget - don't let a handler's own errors mask the original failure.
      Promise.resolve(onUnauthorized()).catch(() => {});
    }
    throw new ApiError(data?.error || `Request failed (${res.status})`, { status: res.status, data });
  }

  return data ?? {};
}

export const api = {
  register: (payload) => request("/auth/register", { method: "POST", body: payload }),
  login: (payload) => request("/auth/login", { method: "POST", body: payload }),
  me: () => request("/auth/me"),

  createClassroom: (name) => request("/classrooms", { method: "POST", body: { name } }),
  listClassrooms: () => request("/classrooms"),
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
};