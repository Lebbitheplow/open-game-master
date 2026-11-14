// Visual identity is independent of brightness and the campaign's story theme.
// This catalog is safe to import in both client components and server schemas.
export const THEME_ART_SLOTS = {
  texture: "--theme-art-texture",
  frame: "--theme-art-frame",
  corner: "--theme-art-corner",
  backdrop: "--theme-art-backdrop",
} as const;
export type ThemeArt = Partial<Record<keyof typeof THEME_ART_SLOTS, string>>;
export interface AppearanceDefinition {
  id: string;
  name: string;
  description: string;
  icon: "sparkles" | "leaf" | "church";
  stylesheet: string;
  art?: ThemeArt;
  provenance?: string;
}

// Add a theme here once. Schema IDs, both pickers and validation use this list.
// See docs/appearance-themes.md for palette, artwork and preview requirements.
export const APPEARANCE_THEMES = [
  { id: "arcane", name: "Arcane", description: "Indigo skies, aged gold, and celestial detail.", icon: "sparkles", stylesheet: "src/app/styles/themes/arcane.css" },
  {
    id: "woodland", name: "Ancient Woodland", description: "Carved oak, living ivy, and silver leaf fittings.", icon: "leaf", stylesheet: "src/app/styles/themes/woodland.css",
    art: {
      texture: "/assets/themes/woodland/oak-grain-v1.webp",
      frame: "/assets/themes/woodland/ivy-oak-frame-v1.webp",
      corner: "/assets/themes/woodland/root-silver-joint-v1.webp",
      backdrop: "/assets/themes/woodland/elderwood-canopy-v1.webp",
    },
    provenance: "public/assets/themes/woodland/art-provenance.json",
  },
  { id: "gothic", name: "Gothic", description: "Charcoal, rose silver, and cathedral arches.", icon: "church", stylesheet: "src/app/styles/themes/gothic.css" },
] as const satisfies readonly AppearanceDefinition[];
export type AppearanceTheme = (typeof APPEARANCE_THEMES)[number]["id"];
export type AppearanceChoice = "campaign" | AppearanceTheme;
export type CampaignAppearance = "genre" | AppearanceTheme;
export const APPEARANCE_THEME_IDS = APPEARANCE_THEMES.map((theme) => theme.id);

export function appearanceDefinition(id: AppearanceTheme): AppearanceDefinition {
  return APPEARANCE_THEMES.find((theme) => theme.id === id)!;
}

// Explicit none values prevent artwork leaking when switching themes or when
// a picker thumbnail is nested inside a different theme. Safe during SSR too.
export function themeArtStyle(id: AppearanceTheme): Record<`--theme-art-${string}`, string> {
  const art = appearanceDefinition(id).art;
  return Object.fromEntries(Object.entries(THEME_ART_SLOTS).map(([slot, property]) => {
    const asset = art?.[slot as keyof ThemeArt];
    return [property, asset ? `url(${JSON.stringify(asset)})` : "none"];
  }));
}

export function isAppearanceTheme(value: unknown): value is AppearanceTheme {
  return APPEARANCE_THEME_IDS.some((id) => id === value);
}

export function campaignAppearance(settings?: { appearanceTheme?: string; genre?: string } | null): AppearanceTheme {
  if (isAppearanceTheme(settings?.appearanceTheme)) return settings.appearanceTheme;
  return settings?.genre === "dark_fantasy" || settings?.genre === "horror" ? "gothic" : "arcane";
}

export function resolveAppearance(choice: AppearanceChoice, campaignTheme: AppearanceTheme): AppearanceTheme {
  return choice === "campaign" ? campaignTheme : choice;
}
