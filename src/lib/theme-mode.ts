"use client";

import { useEffect, useSyncExternalStore } from "react";
import { campaignAppearance, isAppearanceTheme, resolveAppearance, themeArtStyle, type AppearanceChoice, type AppearanceTheme } from "@/lib/appearance-themes";

// Brightness, visual identity and scale belong to this reader and device.
// Brightness follows the OS by default; identity follows the current campaign.
// Canvases size themselves in pixels and intentionally ignore interface scale.

export type ThemeChoice = "auto" | "dark" | "light";
export type ThemeMode = "dark" | "light";

const THEME_KEY = "odm.theme";
const APPEARANCE_KEY = "odm.appearance";
const SCALE_KEY = "odm.ui-scale";
export const UI_SCALE_MIN = 0.9;
export const UI_SCALE_MAX = 1.25;

const listeners = new Set<() => void>();
let currentCampaignTheme: AppearanceTheme = "arcane";
// Storage may be blocked in an embedded browser. Changes still work for this visit.
const memoryPrefs = new Map<string, string | null>();
function readPreference(key: string): string | null {
  if (typeof window === "undefined") return null;
  if (memoryPrefs.has(key)) return memoryPrefs.get(key) ?? null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writePreference(key: string, value: string | null) {
  memoryPrefs.set(key, value);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* Keep the in-memory preference when storage is unavailable. */ }
  applyTheme();
  emit();
}
function emit() {
  for (const listener of listeners) {
    listener();
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  media?.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener("change", listener);
  };
}

export function readThemeChoice(): ThemeChoice {
  if (typeof window === "undefined") {
    return "auto";
  }
  const stored = readPreference(THEME_KEY);
  return stored === "dark" || stored === "light" ? stored : "auto";
}

export function resolveTheme(choice: ThemeChoice): ThemeMode {
  if (choice !== "auto") {
    return choice;
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function writeThemeChoice(choice: ThemeChoice) {
  writePreference(THEME_KEY, choice === "auto" ? null : choice);
}

export function readAppearanceChoice(): AppearanceChoice {
  const stored = readPreference(APPEARANCE_KEY);
  return isAppearanceTheme(stored) ? stored : "campaign";
}

export function writeAppearanceChoice(choice: AppearanceChoice) {
  writePreference(APPEARANCE_KEY, choice === "campaign" ? null : choice);
}

function readAppearance(): AppearanceTheme {
  return resolveAppearance(readAppearanceChoice(), currentCampaignTheme);
}

// Bound to the campaign stream so lobby and full-screen table agree, including
// live settings updates. Leaving the campaign restores the app's default.
export function useCampaignAppearance(settings?: { appearanceTheme?: string; genre?: string } | null) {
  const theme = campaignAppearance(settings);
  useEffect(() => {
    currentCampaignTheme = theme;
    applyTheme();
    emit();
    return () => {
      currentCampaignTheme = "arcane";
      applyTheme();
      emit();
    };
  }, [theme]);
}

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.round(Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, value)) * 100) / 100;
}

export function readUiScale(): number {
  if (typeof window === "undefined") {
    return 1;
  }
  return clampScale(Number(readPreference(SCALE_KEY)) || 1);
}

export function writeUiScale(scale: number) {
  const clamped = clampScale(scale);
  writePreference(SCALE_KEY, clamped === 1 ? null : String(clamped));
}

// Writes the choice onto <html>: data-theme for the token set, the scale
// as a root variable and as the root font size so every rem follows it.
export function applyTheme() {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  const mode = resolveTheme(readThemeChoice());
  root.dataset.theme = mode;
  root.dataset.appearance = readAppearance();
  const art = themeArtStyle(readAppearance());
  for (const [property, value] of Object.entries(art)) root.style.setProperty(property, value);
  root.dataset.themeOrnaments = String(art["--theme-art-frame"] !== "none" || art["--theme-art-corner"] !== "none");
  root.style.colorScheme = mode;
  const scale = readUiScale();
  root.style.setProperty("--ui-scale", String(scale));
  root.style.fontSize = scale === 1 ? "" : `${scale * 100}%`;
}

const SERVER_SNAPSHOT = { choice: "auto" as ThemeChoice, mode: "dark" as ThemeMode, scale: 1 };

export function useThemePrefs() {
  const choice = useSyncExternalStore(subscribe, readThemeChoice, () => SERVER_SNAPSHOT.choice);
  const scale = useSyncExternalStore(subscribe, readUiScale, () => SERVER_SNAPSHOT.scale);
  const mode = useSyncExternalStore(subscribe, () => resolveTheme(readThemeChoice()), () => SERVER_SNAPSHOT.mode);
  const appearanceChoice = useSyncExternalStore(subscribe, readAppearanceChoice, (): AppearanceChoice => "campaign");
  const appearance = useSyncExternalStore(subscribe, readAppearance, (): AppearanceTheme => "arcane");
  return { choice, mode, scale, appearanceChoice, appearance };
}

// Mounted once in the root layout: applies preferences on hydration, then
// follows OS brightness and changes from other tabs.
export function ThemeApplier() {
  useEffect(() => {
    applyTheme();
    const unsubscribe = subscribe(applyTheme);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && ![THEME_KEY, APPEARANCE_KEY, SCALE_KEY].includes(event.key)) return;
      if (event.key === null) memoryPrefs.clear();
      else memoryPrefs.delete(event.key);
      applyTheme();
      emit();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return null;
}
