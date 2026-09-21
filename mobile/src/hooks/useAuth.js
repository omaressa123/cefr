import { useState, useEffect, useCallback } from "react";
import { api, getToken, getStoredUser, setToken, setStoredUser } from "../api/client.js";

export function useAuth() {
  const [user, setUser] = useState(null);
  const [token, setAuthToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const t = await getToken();
        const u = t ? await getStoredUser() : null;
        setAuthToken(t);
        setUser(u);
      } catch {
        setAuthToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (credentials) => {
    const { token: t, user: u } = await api.login(credentials);
    await setToken(t);
    await setStoredUser(u);
    setAuthToken(t);
    setUser(u);
    return u;
  }, []);

  const register = useCallback(async (data) => {
    const { token: t, user: u } = await api.register(data);
    await setToken(t);
    await setStoredUser(u);
    setAuthToken(t);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    await setToken(null);
    await setStoredUser(null);
    setAuthToken(null);
    setUser(null);
  }, []);

  return { user, token, loading, login, register, logout, isAuthenticated: !!token };
}
