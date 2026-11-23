"use client";

import dynamic from "next/dynamic";
import { Palette } from "lucide-react";
import { cn } from "@/lib/cn";
import { setThemePanelOpen, useTableThemeControl, useThemePanel } from "@/lib/theme-mode";

// The panel and its picker load the first time someone opens it, so no page
// carries them at first load.
const ThemePanel = dynamic(() => import("@/components/ThemePanel").then((module) => module.ThemePanel), { ssr: false });

export function ThemePanelHost() {
  const { opened } = useThemePanel();
  return opened ? <ThemePanel /> : null;
}

// Tells the panel which table the reader is at and whether they may set its
// theme. A component, so a page with early returns can still place it.
export function TableThemeControl({ campaignId, canSet }: { campaignId: string; canSet: boolean }) {
  useTableThemeControl(campaignId, canSet);
  return null;
}

// The lobby's door to the panel: the place a theme shows most had no way to
// change it short of going back to the front screen.
export function ThemeButton({ className }: { className?: string }) {
  const { open } = useThemePanel();
  return (
    <button type="button" className={cn("theme-button", className)} aria-expanded={open} aria-haspopup="dialog" onClick={() => setThemePanelOpen(!open)} data-theme-button="">
      <Palette aria-hidden="true" className="size-4" /> Theme
    </button>
  );
}
