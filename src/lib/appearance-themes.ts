// Visual identity is independent of brightness and the campaign's story theme.
// This catalog is safe to import in both client components and server schemas.
import type { Genre } from "@/lib/schemas/game-settings-options";

export const APPEARANCE_ICONS = ["sparkles", "leaf", "church", "flame", "shield", "waves"] as const;
export type AppearanceIcon = (typeof APPEARANCE_ICONS)[number];
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
  icon: AppearanceIcon;
  stylesheet: string;
  genres?: readonly Genre[];
  // Plain surfaces replace the app's original celestial furniture.
  baseStyle?: "celestial" | "plain";
  // A scaled corner reads the top-left 1/scale portion along each image axis.
  cornerScale?: number;
  frameSlice?: number;
  art?: ThemeArt;
  provenance?: string;
}

// Add a theme here once. Schema IDs, both pickers and validation use this list.
// See docs/appearance-themes.md for palette, artwork and preview requirements.
export const APPEARANCE_THEMES = [
  {
    id: "arcane", name: "Arcane", description: "Indigo stone, celestial brass, and amethyst fittings.", icon: "sparkles", stylesheet: "src/app/styles/themes/arcane.css",
    baseStyle: "celestial", cornerScale: 4,
    art: {
      texture: "/assets/themes/arcane/indigo-stone-v1.webp",
      frame: "/assets/themes/arcane/celestial-brass-frame-v1.webp",
      corner: "/assets/themes/arcane/celestial-brass-frame-v1.webp",
      backdrop: "/assets/themes/arcane/astral-observatory-v1.webp",
    },
    provenance: "public/assets/themes/arcane/art-provenance.json",
  },
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
  {
    id: "gothic", name: "Gothic", description: "Cathedral stone, silver tracery, and garnet glass.", icon: "church", stylesheet: "src/app/styles/themes/gothic.css",
    genres: ["dark_fantasy", "horror"], cornerScale: 4,
    art: {
      texture: "/assets/themes/gothic/cathedral-slate-v1.webp",
      frame: "/assets/themes/gothic/cathedral-iron-frame-v1.webp",
      corner: "/assets/themes/gothic/cathedral-iron-frame-v1.webp",
      backdrop: "/assets/themes/gothic/moonlit-cloister-v1.webp",
    },
    provenance: "public/assets/themes/gothic/art-provenance.json",
  },
  {
    id: "hearth", name: "Hearth & Haven", description: "Warm parchment, crafted oak, and welcoming amber lamplight.", icon: "flame", stylesheet: "src/app/styles/themes/hearth.css",
    cornerScale: 4,
    art: {
      texture: "/assets/themes/hearth/honey-oak-v1.webp",
      frame: "/assets/themes/hearth/carved-oak-frame-v1.webp",
      corner: "/assets/themes/hearth/carved-oak-frame-v1.webp",
      backdrop: "/assets/themes/hearth/fireside-haven-v1.webp",
    },
    provenance: "public/assets/themes/hearth/art-provenance.json",
  },
  {
    id: "kingdoms", name: "High Kingdoms", description: "Ivory vellum, royal blue, and illuminated heraldry.", icon: "shield", stylesheet: "src/app/styles/themes/kingdoms.css",
    cornerScale: 4,
    art: {
      texture: "/assets/themes/kingdoms/ivory-vellum-v1.webp",
      frame: "/assets/themes/kingdoms/illuminated-heraldry-frame-v1.webp",
      corner: "/assets/themes/kingdoms/illuminated-heraldry-frame-v1.webp",
      backdrop: "/assets/themes/kingdoms/royal-council-hall-v1.webp",
    },
    provenance: "public/assets/themes/kingdoms/art-provenance.json",
  },
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
export function themeArtStyle(id: AppearanceTheme): Record<`--theme-${string}`, string> {
  const definition = appearanceDefinition(id);
  return {
    ...artSlotStyle(definition.art),
    "--theme-frame-slice": `${definition.frameSlice ?? 22}%`,
    "--theme-corner-background-size": definition.cornerScale ? `${definition.cornerScale * 100}%` : "contain",
    "--theme-corner-background-position": definition.cornerScale ? "top left" : "center",
  };
}

export function artSlotStyle(art?: ThemeArt): Record<`--theme-art-${string}`, string> {
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
  return genreAppearance(settings?.genre, APPEARANCE_THEMES, "arcane");
}

export function genreAppearance<T extends { id: string; genres?: readonly string[] }>(genre: string | undefined, catalog: readonly T[], fallback: T["id"]): T["id"] {
  return catalog.find(entry => entry.genres?.includes(genre ?? ""))?.id ?? fallback;
}

export function resolveAppearance(choice: AppearanceChoice, campaignTheme: AppearanceTheme): AppearanceTheme {
  return choice === "campaign" ? campaignTheme : choice;
}
