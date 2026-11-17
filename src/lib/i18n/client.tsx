"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { LOCALE_COOKIE } from "./locale";
import { translate, translatePlural, type Locale, type TranslateVars } from "./translate";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue>({
  locale: "en",
  setLocale: () => {},
});

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    if (typeof document !== "undefined") {
      document.documentElement.lang = next;
      document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    }
  }, []);

  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function useT() {
  const { locale } = useLocale();
  return useCallback((english: string, vars?: TranslateVars) => translate(locale, english, vars), [locale]);
}

export function useTp() {
  const { locale } = useLocale();
  return useCallback(
    (englishOne: string, englishOther: string, vars: TranslateVars & { count: number }) =>
      translatePlural(locale, englishOne, englishOther, vars),
    [locale],
  );
}
