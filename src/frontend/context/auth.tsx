import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, getToken, setToken } from "@/lib/api";
import type { AuthResponse, MeResponse, PublicUser } from "@/lib/types";

interface AuthContextValue {
  user: PublicUser | null;
  token: string | null;
  loading: boolean;
  register: (email: string, password: string, name: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Re-fetch /api/auth/me so the gift-point balance reflects server state. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [token, setTokenState] = useState<string | null>(getToken());
  const [loading, setLoading] = useState<boolean>(!!getToken());

  const applyAuth = useCallback((res: AuthResponse) => {
    setToken(res.token);
    setTokenState(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setTokenState(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    try {
      const res = await api.get<MeResponse>("/auth/me");
      setUser(res.user);
    } catch {
      // Token invalid/expired — clear it so the UI treats us as logged out.
      logout();
    }
  }, [logout]);

  // On first mount, if we have a persisted token, hydrate the user from /me.
  useEffect(() => {
    let active = true;
    (async () => {
      if (getToken()) {
        await refresh();
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [refresh]);

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      const res = await api.post<AuthResponse>("/auth/register", {
        email,
        password,
        name,
      });
      applyAuth(res);
    },
    [applyAuth],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<AuthResponse>("/auth/login", {
        email,
        password,
      });
      applyAuth(res);
    },
    [applyAuth],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, loading, register, login, logout, refresh }),
    [user, token, loading, register, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
