"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { translate, type Locale } from "@/lib/i18n";
const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (source: string, parameters?: Record<string, unknown>) => string;
} | null>(null);
export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, updateLocale] = useState(initialLocale);
  const setLocale = useCallback((value: Locale) => {
    updateLocale(value);
    document.documentElement.lang = value;
    document.cookie = `stemora_locale=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    try {
      localStorage.setItem("stemora-locale", value);
    } catch {
      /* Preferences still persist in the cookie. */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title =
      locale === "th"
        ? "STEMORA — เสียงของคุณ ในแบบใหม่"
        : "STEMORA — Your sound, reimagined";
    const sync = (event: StorageEvent) => {
      if (
        event.key === "stemora-locale" &&
        (event.newValue === "th" || event.newValue === "en")
      )
        updateLocale(event.newValue);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [locale]);
  const t = useCallback(
    (source: string, parameters?: Record<string, unknown>) =>
      translate(source, locale, parameters),
    [locale],
  );
  const context = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );
  return (
    <LocaleContext.Provider value={context}>{children}</LocaleContext.Provider>
  );
}
export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("Locale provider missing");
  return value;
}
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useLocale();
  return (
    <div className="language-switcher" role="group" aria-label={t("Language")}>
      <button
        type="button"
        lang="th"
        aria-label="ภาษาไทย"
        aria-pressed={locale === "th"}
        onClick={() => setLocale("th")}
      >
        TH
      </button>
      <button
        type="button"
        lang="en"
        aria-label="English"
        aria-pressed={locale === "en"}
        onClick={() => setLocale("en")}
      >
        EN
      </button>
    </div>
  );
}
