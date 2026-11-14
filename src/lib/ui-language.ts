"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { isUiLanguageChoice, resolveUiLanguage, uiTranslator, type UiLanguageChoice } from "@/lib/language/ui-translate-logic";
import { startUiTranslation } from "@/lib/language/ui-translator";

// The interface's language (docs/specs/ogm-italian-ui.md): the browser's by
// default, or the reader's choice, kept on this device as the theme is
// (src/lib/theme-mode.ts). The Italian catalog is fetched only when it is
// used, so an English page loads nothing more.

const KEY = "odm.ui-language";

const listeners = new Set<() => void>();

export function readUiLanguageChoice(): UiLanguageChoice {
  if (typeof window === "undefined") {
    return "auto";
  }
  const stored = window.localStorage.getItem(KEY);
  return isUiLanguageChoice(stored) ? stored : "auto";
}

function currentLanguage() {
  return resolveUiLanguage(readUiLanguageChoice(), typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]);
}

// A change reloads the page: the English the layer replaced is not kept, and
// a fresh page is the one sure way back to it.
export function writeUiLanguageChoice(choice: UiLanguageChoice) {
  const before = currentLanguage();
  if (choice === "auto") {
    window.localStorage.removeItem(KEY);
  } else {
    window.localStorage.setItem(KEY, choice);
  }
  for (const listener of listeners) {
    listener();
  }
  if (currentLanguage() !== before) {
    window.location.reload();
  }
}

export function useUiLanguageChoice(): UiLanguageChoice {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readUiLanguageChoice,
    () => "auto",
  );
}

export function UiLanguageApplier() {
  useLayoutEffect(() => {
    if (currentLanguage() !== "italian") {
      return;
    }
    document.documentElement.lang = "it";
    let stop: (() => void) | undefined;
    let cancelled = false;
    void Promise.all([import("@/lib/language/ui-it.json"), import("@/lib/language/ui-it.patterns.json")])
      .then(([catalog, patterns]) => {
        if (!cancelled) {
          stop = startUiTranslation(document.documentElement, uiTranslator(catalog.default, patterns.default));
        }
      })
      // No catalog, no harm: the page stays English.
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  return null;
}
