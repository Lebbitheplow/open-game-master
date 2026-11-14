"use client";

import { Church, Leaf, Sparkles } from "lucide-react";
import { appearanceDefinition } from "@/lib/appearance-themes";
import { useThemePrefs } from "@/lib/theme-mode";

const ICONS = { church: Church, leaf: Leaf, sparkles: Sparkles };

/** The registered theme's decorative emblem, independent of campaign genre. */
export function ThemeEmblem() {
  const { appearance } = useThemePrefs();
  const Icon = ICONS[appearanceDefinition(appearance).icon];
  return <span className="theme-crest" aria-hidden="true"><Icon /></span>;
}
