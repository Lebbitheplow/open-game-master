"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { appearanceDefinition, campaignAppearance, isAppearanceTheme, resolveAppearance, themeArtStyle, type AppearanceChoice, type AppearanceTheme, type CampaignAppearance } from "@/lib/appearance-themes";

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
// What the theme panel needs to know about the table the reader is at: its
// genre and stored choice (from the campaign stream), and whether this reader
// may change it (from the page that knows their seat). Null away from a table.
export interface TableAppearance { genre?: string; setting: CampaignAppearance }
export interface TableControl { campaignId: string; canSet: boolean }
let currentTable: TableAppearance | null = null;
let currentControl: TableControl | null = null;
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
  // A theme or brightness the reader picks arrives the theme's own way.
  settle(key !== SCALE_KEY);
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
  const present = Boolean(settings);
  const genre = settings?.genre;
  const setting: CampaignAppearance = isAppearanceTheme(settings?.appearanceTheme) ? settings.appearanceTheme : "genre";
  const seated = useRef(false);
  useEffect(() => {
    currentCampaignTheme = theme;
    currentTable = present ? { genre, setting } : null;
    // Sitting down at a table lays its theme at once, with the page. A theme
    // the GM gives the table while the reader sits there arrives its own way.
    settle(seated.current && present);
    seated.current = present;
    emit();
  }, [theme, present, genre, setting]);
  useEffect(() => () => {
    // Not seated any more: React's development double mount runs this and
    // then the effect above again, which must not take the table's theme
    // coming back for a change made while seated.
    seated.current = false;
    currentCampaignTheme = "arcane";
    currentTable = null;
    applyTheme();
    emit();
  }, []);
}

// Called by the lobby and the table, which know the reader's seat.
export function useTableThemeControl(campaignId: string, canSet: boolean) {
  useEffect(() => {
    if (!campaignId) return;
    currentControl = { campaignId, canSet };
    emit();
    return () => {
      currentControl = null;
      emit();
    };
  }, [campaignId, canSet]);
}

// The theme panel is one surface for the whole app, opened from the account
// menu or the lobby, so its open state lives here beside what it changes.
let panelOpen = false;
// Once opened, the panel's code is loaded and stays mounted.
let panelOpened = false;
export function setThemePanelOpen(open: boolean) {
  if (panelOpen === open) return;
  panelOpen = open;
  if (open) panelOpened = true;
  emit();
}
export function useThemePanel() {
  const open = useSyncExternalStore(subscribe, () => panelOpen, () => false);
  const table = useSyncExternalStore(subscribe, () => currentTable, () => null);
  const control = useSyncExternalStore(subscribe, () => currentControl, () => null);
  const tableTheme = useSyncExternalStore(subscribe, () => currentCampaignTheme, (): AppearanceTheme => "arcane");
  const opened = useSyncExternalStore(subscribe, () => panelOpened, () => false);
  return { open, opened, table, control, tableTheme };
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
  settle(false);
}

interface Look { appearance: AppearanceTheme; mode: ThemeMode }
function layLook({ appearance, mode }: Look) {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.dataset.appearance = appearance;
  root.dataset.themeBase = appearanceDefinition(appearance).baseStyle ?? "plain";
  const art = themeArtStyle(appearance, mode);
  for (const [property, value] of Object.entries(art)) root.style.setProperty(property, value);
  root.dataset.themeOrnaments = String(art["--theme-art-frame"] !== "none" || art["--theme-art-corner"] !== "none");
  root.style.colorScheme = mode;
}

// A theme arriving its own way (src/lib/theme-arrival, loaded when the first
// one is needed): the look on its way in, and how to stop it short.
let arriving: { look: Look; stop: () => void } | null = null;
let arrivalCode: Promise<typeof import("@/lib/theme-arrival/run")> | null = null;
function loadArrival() {
  arrivalCode ??= import("@/lib/theme-arrival/run");
  // A failed fetch is tried again at the next change, not remembered.
  arrivalCode.catch(() => { arrivalCode = null; });
  return arrivalCode;
}
// A browser without View Transitions, or a page nobody is looking at, gets
// the plain swap.
const canArrive = () => typeof document.startViewTransition === "function" && document.visibilityState === "visible";
// The picker asks for the code as it opens, so the first pick need not wait.
export function preloadThemeArrival() {
  if (typeof document !== "undefined" && canArrive()) void loadArrival().catch(() => undefined);
}
function arrive(look: Look) {
  let live = true;
  let skip = () => {};
  const mine = { look, stop: () => { live = false; arriving = null; skip(); } };
  const done = () => { if (arriving === mine) arriving = null; };
  arriving = mine;
  loadArrival().then(({ runThemeArrival }) => {
    if (live) skip = runThemeArrival({ theme: look.appearance, lay: () => { if (live) layLook(look); }, done }).skip;
  }, () => {
    if (!live) return;
    layLook(look);
    done();
  });
}

// `play` is set only for a change made while the reader watches: their own
// pick, or the table's theme changed under them. Everything else (the page
// loading, a table opened or left, the system turning to night, another tab)
// lays the look at once.
function settle(play: boolean) {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  const scale = readUiScale();
  root.style.setProperty("--ui-scale", String(scale));
  root.style.fontSize = scale === 1 ? "" : `${scale * 100}%`;
  const look: Look = { appearance: readAppearance(), mode: resolveTheme(readThemeChoice()) };
  if (arriving) {
    // Every listener's applyTheme lands here while an arrival plays; laying
    // its look early would leave it nothing to arrive over.
    if (arriving.look.appearance === look.appearance && arriving.look.mode === look.mode) return;
    arriving.stop();
  }
  const shown = root.dataset.appearance;
  if (play && shown && (shown !== look.appearance || root.dataset.theme !== look.mode) && canArrive()) arrive(look);
  else layLook(look);
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
