"use client";

import { Suspense, createContext, use, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { loadCatalog } from "./i18n/catalog-loader";
import { LOCALE_COOKIE } from "./i18n/locale";
import { catalogInstalled } from "./i18n/translate";
import { localeTag, translate, translatePlural, type Locale, type MessageKey, type MessageVars } from "./messages-logic";

// The interface's language, beside the theme and the scale (theme-mode.ts).
// It lives in localStorage and a cookie (odm_locale) as the reader's own
// choice — "auto" follows the browser's languages — and is applied to <html>
// so the screen reader and the fonts read the same words everyone else does.
// English is the source dictionary and the fallback, so an area not
// translated yet reads English instead of breaking.

export type LocaleChoice = "auto" | Locale;

const LOCALE_KEY = "odm.locale";

const ServerLocaleContext = createContext<Locale>("en");

// The page the server rendered in French hydrates in French: until the
// catalog's chunk is in (catalog-loader.ts), the tree waits under Suspense
// and React keeps the server's HTML, rather than hydrating English over
// French and throwing the page away. On the server the catalog is already
// installed (fr-catalog.ts), so nothing waits there.
function CatalogGate({ locale, children }: { locale: Locale; children: ReactNode }) {
  if (!catalogInstalled(locale)) {
    use(loadCatalog(locale));
  }
  return <>{children}</>;
}

export function LocaleProvider({ initialLocale, serverLocale = null, children }: { initialLocale: Locale; serverLocale?: Locale | null; children: ReactNode }) {
  // Read by "auto" before the browser's languages (resolveLocale), as the
  // server's own render read it (layout.tsx). Set before the children read
  // it, with nothing told: they have not rendered yet.
  adoptServerLocale(serverLocale);
  return (
    <ServerLocaleContext.Provider value={initialLocale}>
      {initialLocale === "en" ? (
        children
      ) : (
        <Suspense fallback={null}>
          <CatalogGate locale={initialLocale}>{children}</CatalogGate>
        </Suspense>
      )}
    </ServerLocaleContext.Provider>
  );
}

const listeners = new Set<() => void>();

// The server's language where the menus have it (i18n/locale.ts
// localeOfServerLanguage): "auto" takes it before the browser's. The root
// layout hands it over on the website; in the apps, which have no layout,
// the host's capabilities do (use-capabilities.ts).
let serverDefault: Locale | null = null;

function adoptServerLocale(locale: Locale | null) {
  serverDefault = locale;
}

export function setServerLocale(locale: Locale | null) {
  if (locale === serverDefault) {
    return;
  }
  serverDefault = locale;
  if (typeof window !== "undefined") {
    applyLocale();
    emit();
  }
}
function emit() {
  for (const listener of listeners) {
    listener();
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readLocaleChoice(): LocaleChoice {
  if (typeof window === "undefined") {
    return "auto";
  }
  const stored = window.localStorage.getItem(LOCALE_KEY);
  return stored === "en" || stored === "fr" ? stored : "auto";
}

// Headers that tell the server which language the reader chose, for the
// surfaces the app builds per request (the starter's cards, the join
// previews, the rulebook). An explicit choice wins over the browser's
// Accept-Language — a French reader on an English-locale desktop reads
// French; "auto" sends nothing, leaving the browser's word as ever.
export function odmLocaleHeaders(): Record<string, string> {
  const choice = readLocaleChoice();
  return choice === "auto" ? {} : { "X-Odm-Locale": choice };
}

// The browser's own preference order decides "auto": the first language the
// app speaks wins, and anything unrecognised lands on English, the source
// dictionary.
export function resolveLocale(choice: LocaleChoice): Locale {
  if (choice !== "auto") {
    return choice;
  }
  if (serverDefault) {
    return serverDefault;
  }
  if (typeof navigator === "undefined") {
    return "en";
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const language = tag.toLowerCase().split("-")[0];
    if (language === "fr") {
      return "fr";
    }
    if (language === "en") {
      return "en";
    }
  }
  return "en";
}

export function writeLocaleChoice(choice: LocaleChoice) {
  if (choice === "auto") {
    window.localStorage.removeItem(LOCALE_KEY);
    document.cookie = `${LOCALE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  } else {
    window.localStorage.setItem(LOCALE_KEY, choice);
    document.cookie = `${LOCALE_COOKIE}=${choice}; path=/; max-age=31536000; SameSite=Lax`;
  }
  applyLocale();
  emit();
}

// The locale the screen shows: the reader's, once its catalog is in. Asked
// for French before the chunk has arrived it starts the fetch and reads
// English, then every translated string switches together when it lands.
function shownLocale(): Locale {
  const wanted = resolveLocale(readLocaleChoice());
  if (catalogInstalled(wanted)) {
    return wanted;
  }
  void loadCatalog(wanted).then(() => {
    applyLocale();
    emit();
  });
  return "en";
}

// Writes the choice onto <html>, as applyTheme writes the theme, so the
// document's language matches the words on screen.
export function applyLocale() {
  if (typeof document === "undefined") {
    return;
  }
  const wanted = resolveLocale(readLocaleChoice());
  document.documentElement.lang = localeTag(catalogInstalled(wanted) ? wanted : "en");
}

export function useLocale(): Locale {
  const serverLocale = useContext(ServerLocaleContext);
  return useSyncExternalStore(subscribe, shownLocale, () => serverLocale);
}

export function useLocaleChoice(): LocaleChoice {
  return useSyncExternalStore(subscribe, readLocaleChoice, () => "auto" as LocaleChoice);
}

// The one door components use: `const t = useT();` then `t("Hello")`.
// Bound to the current locale, so a switch re-renders every translated
// string on the page at once.
export function useT() {
  const locale = useLocale();
  return useMemo(
    () =>
      Object.assign(
        (key: MessageKey | (string & {}), vars?: MessageVars) => translate(locale, key, vars),
        { locale },
      ),
    [locale],
  );
}

// Plural-aware translator: `const tp = useTp();` then
// `tp("{count} item", "{count} items", { count })`.
export function useTp() {
  const locale = useLocale();
  return useCallback(
    (englishOne: string, englishOther: string, vars: MessageVars & { count: number }) =>
      translatePlural(locale, englishOne, englishOther, vars),
    [locale],
  );
}

// Mounted once in the root layout, beside ThemeApplier: applies the stored
// choice before the first paint settles and again whenever it changes.
export function LocaleApplier() {
  useEffect(() => {
    applyLocale();
    return subscribe(applyLocale);
  }, []);
  return null;
}
