"use client";

import { ThemeIcon } from "@/components/ThemeIcon";
import { appearanceDefinition } from "@/lib/appearance-themes";
import { useThemePrefs } from "@/lib/theme-mode";

/** The registered theme's decorative emblem, independent of campaign genre. */
export function ThemeEmblem() {
  const { appearance } = useThemePrefs();
  return <span className="theme-crest" aria-hidden="true"><ThemeIcon icon={appearanceDefinition(appearance).icon} /></span>;
}
