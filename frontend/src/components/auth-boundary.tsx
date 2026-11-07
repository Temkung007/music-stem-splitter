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
import Image from "next/image";
import { LoaderCircle } from "lucide-react";
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

  useEffect(() => {
    let active = true;
    // Only check auth endpoint if there's a possibility of an active session
    const hasPossibleSession = typeof document !== "undefined" && (
      document.cookie.includes("session") ||
      document.cookie.includes("token") ||
      Boolean(localStorage.getItem("stemora_active_session"))
    );

    if (hasPossibleSession) {
      fetch("/api/auth/me", { credentials: "same-origin" })
        .then(async (response) => {
          if (response.ok && active) setUser(await response.json());
        })
        .catch(() => {
          // network or server error handled gracefully
        });
    }

    const expired = () => {
      setUser(null);
      localStorage.removeItem("stemora_active_session");
    };
    window.addEventListener("stemora:unauthorized", expired);
    return () => {
      active = false;
      window.removeEventListener("stemora:unauthorized", expired);
    };
  }, []);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    localStorage.removeItem("stemora-active-task");
    setUser(null);
  }, []);

  if (user) {
    return (
      <AuthContext.Provider value={{ user, logout }}>
        {children}
      </AuthContext.Provider>
    );
  }

  return <LandingPage onSuccess={(u) => setUser(u)} />;
}
