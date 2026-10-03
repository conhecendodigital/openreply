"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";
import { LANG_COOKIE, translate, type Lang, type TFunction } from "@/lib/i18n";

const LangContext = createContext<{ lang: Lang; t: TFunction; setLang: (l: Lang) => void }>({
  lang: "pt",
  t: (text, vars) => translate("pt", text, vars),
  setLang: () => {},
});

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const router = useRouter();
  const setLang = useCallback(
    (next: Lang) => {
      document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    },
    [router]
  );
  const value = useMemo(
    () => ({ lang, setLang, t: ((text, vars) => translate(lang, text, vars)) as TFunction }),
    [lang, setLang]
  );
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

/** `const t = useT(); t("Campaigns")` → "Campanhas" in Portuguese. */
export function useT(): TFunction {
  return useContext(LangContext).t;
}

export function useLang() {
  const { lang, setLang } = useContext(LangContext);
  return { lang, setLang };
}

/** PT | EN switch. */
export function LangSwitch({ className = "" }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <div className={`inline-flex rounded-lg border border-border p-0.5 text-xs font-semibold ${className}`}>
      {(["pt", "en"] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => l !== lang && setLang(l)}
          aria-pressed={l === lang}
          className={`rounded-md px-2.5 py-1 transition-colors ${
            l === lang ? "bg-foreground text-background" : "text-muted hover:text-foreground"
          }`}
        >
          {l === "pt" ? "PT" : "EN"}
        </button>
      ))}
    </div>
  );
}
