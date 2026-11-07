"use client";

import { useLocale } from "@/components/locale-provider";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { LandingPage } from "@/components/landing-page";
import { api, type User } from "@/lib/api";

const AuthContext = createContext<{
  user: User;
  logout: () => Promise<void>;
} | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("Auth boundary missing");
  return context;
}

export function AuthBoundary({ children }: { children: ReactNode }) {
  const { t: tr } = useLocale();

  const [user, setUser] = useState<User | null>(null);
  const [verifying, setVerifying] = useState(true);

  useEffect(() => {
    let active = true;

    // Always verify auth with credentials on initial mount.
    // The session cookie is HttpOnly, so document.cookie cannot read it.
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then(async (response) => {
        if (!active) return;
        if (response.ok) {
          const data = await response.json();
          setUser(data);
          try {
            localStorage.setItem("stemora_active_session", "1");
          } catch {
            // ignore
          }
        } else {
          setUser(null);
          try {
            localStorage.removeItem("stemora_active_session");
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {
        // Network or offline: don't wipe active session prematurely
      })
      .finally(() => {
        if (active) setVerifying(false);
      });

    // Guard against transient 401s: verify /api/auth/me before terminating session
    let isRechecking = false;
    const onUnauthorized = async () => {
      if (isRechecking) return;
      isRechecking = true;
      try {
        const check = await fetch("/api/auth/me", { credentials: "same-origin" });
        if (!check.ok && active) {
          setUser(null);
          try {
            localStorage.removeItem("stemora_active_session");
          } catch {
            // ignore
          }
        }
      } catch {
        // Network error; preserve current session in UI
      } finally {
        isRechecking = false;
      }
    };

    window.addEventListener("stemora:unauthorized", onUnauthorized);
    return () => {
      active = false;
      window.removeEventListener("stemora:unauthorized", onUnauthorized);
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    try {
      localStorage.removeItem("stemora-active-task");
      localStorage.removeItem("stemora_active_session");
    } catch {
      // ignore
    }
    setUser(null);
  }, []);

  if (verifying) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#08090a",
          color: "#f4f4f5",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            border: "2px solid rgba(198, 255, 0, 0.2)",
            borderTopColor: "#c6ff00",
            animation: "stemora-auth-spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes stemora-auth-spin { to { transform: rotate(360deg); } }`}</style>
        <div
          style={{
            fontSize: 12,
            letterSpacing: "0.12em",
            color: "#71717a",
            fontWeight: 600,
            textTransform: "uppercase",
          }}
        >
          STEMORA
        </div>
      </div>
    );
  }

  if (user) {
    return (
      <AuthContext.Provider value={{ user, logout }}>
        {children}
      </AuthContext.Provider>
    );
  }

  return (
    <LandingPage
      onSuccess={(u) => {
        try {
          localStorage.setItem("stemora_active_session", "1");
        } catch {
          // ignore
        }
        setUser(u);
      }}
    />
  );
}
