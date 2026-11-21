// Visual identity is independent of brightness and the campaign's story theme.
// This catalog is safe to import in both client components and server schemas.
import type { Genre } from "@/lib/schemas/game-settings-options";

export const APPEARANCE_ICONS = ["sparkles", "leaf", "church", "flame", "shield", "waves", "anvil"] as const;
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
  genres?: readonly Genre[];
  // Plain surfaces replace the app's original celestial furniture.
  baseStyle?: "celestial" | "plain";
  // A scaled corner reads the top-left 1/scale portion along each image axis.
  cornerScale?: number;
  frameSlice?: number;
  art?: ThemeArt;
}

// Add a theme here once. Schema IDs, both pickers and validation use this list.
// See docs/appearance-themes.md for palette, artwork and preview requirements.
export const APPEARANCE_THEMES = [
  {
    id: "arcane", name: "Arcane", description: "Indigo stone, celestial brass, and amethyst fittings.", icon: "sparkles",
    baseStyle: "celestial",
    art: {
      texture: "/assets/themes/arcane/indigo-stone-v1.webp",
      frame: "/assets/themes/arcane/celestial-brass-frame-v1.webp",
      corner: "/assets/themes/arcane/astral-brass-clasp-v1.webp",
      backdrop: "/assets/themes/arcane/astral-observatory-v1.webp",
    },
  },
  {
    id: "woodland", name: "Ancient Woodland", description: "Carved oak, living ivy, and silver leaf fittings.", icon: "leaf",
    art: {
      texture: "/assets/themes/woodland/oak-grain-v1.webp",
      frame: "/assets/themes/woodland/ivy-oak-frame-v1.webp",
      corner: "/assets/themes/woodland/root-silver-joint-v1.webp",
      backdrop: "/assets/themes/woodland/elderwood-canopy-v1.webp",
    },
  },
  {
    id: "gothic", name: "Gothic", description: "Cathedral stone, silver tracery, and garnet glass.", icon: "church",
    genres: ["dark_fantasy", "horror"],
    art: {
      texture: "/assets/themes/gothic/cathedral-slate-v1.webp",
      frame: "/assets/themes/gothic/cathedral-iron-frame-v1.webp",
      corner: "/assets/themes/gothic/rose-window-briar-v1.webp",
      backdrop: "/assets/themes/gothic/moonlit-cloister-v1.webp",
    },
  },
  {
    id: "hearth", name: "Hearth & Haven", description: "Warm parchment, crafted oak, and welcoming amber lamplight.", icon: "flame",
    art: {
      texture: "/assets/themes/hearth/honey-oak-v1.webp",
      frame: "/assets/themes/hearth/carved-oak-frame-v1.webp",
      corner: "/assets/themes/hearth/oak-brass-strap-hinge-v1.webp",
      backdrop: "/assets/themes/hearth/fireside-haven-v1.webp",
    },
  },
  {
    id: "kingdoms", name: "High Kingdoms", description: "Ivory vellum, royal blue, and illuminated heraldry.", icon: "shield",
    art: {
      texture: "/assets/themes/kingdoms/ivory-vellum-v1.webp",
      frame: "/assets/themes/kingdoms/illuminated-heraldry-frame-v1.webp",
      corner: "/assets/themes/kingdoms/wheat-rosette-gilt-scroll-v1.webp",
      backdrop: "/assets/themes/kingdoms/royal-council-hall-v1.webp",
    },
  },
  {
    id: "tide", name: "Sunken Tide", description: "Sea-glass teal, pale driftwood, and verdigris bronze.", icon: "waves",
    art: {
      texture: "/assets/themes/tide/driftwood-v1.webp",
      frame: "/assets/themes/tide/kelp-driftwood-frame-v1.webp",
      corner: "/assets/themes/tide/shell-bronze-clasp-v1.webp",
      backdrop: "/assets/themes/tide/tide-shrine-v1.webp",
    },
  },
  {
    id: "forge", name: "Deep Forge", description: "Dark basalt, hammered bronze, and ember light.", icon: "anvil",
    art: {
      texture: "/assets/themes/forge/basalt-v1.webp",
      frame: "/assets/themes/forge/bronze-band-frame-v1.webp",
      corner: "/assets/themes/forge/ember-plate-corner-v1.webp",
      backdrop: "/assets/themes/forge/forge-hall-v1.webp",
    },
  },
] as const satisfies readonly AppearanceDefinition[];
export type AppearanceTheme = (typeof APPEARANCE_THEMES)[number]["id"];

// A theme's own files sit at paths named by its id. Only the checks and the
// validation scripts read them, so they stay out of the catalog every page
// ships (the campaign page's script budget had no room for fourteen paths).
export const themeStylesheet = (id: string) => `src/app/styles/themes/${id}.css`;
export const themeProvenance = (id: string) => `public/assets/themes/${id}/art-provenance.json`;
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
    ...cornerStyle(definition),
  };
}

// A corner cropped from the frame (cornerScale) shows the frame's own corner
// at each of the four, upright as painted: rotating the top-left crop turned
// High Kingdoms' shields on their sides and upside down. It is sized from
// the rail so the crop meets the border at the border's own scale. A
// separate corner piece is one painting mirrored into each corner.
function cornerStyle(definition: AppearanceDefinition): Record<`--theme-${string}`, string> {
  if (!definition.cornerScale) {
    return {
      "--theme-corner-flip": "-1",
      "--theme-corner-crop": "0",
      "--theme-corner-background-position": "center",
      "--theme-corner-2-position": "center",
      "--theme-corner-3-position": "center",
      "--theme-corner-4-position": "center",
      // Empty clears a cropped theme's sizes left on <html> by the last pick;
      // the piece's own stylesheet (or the shared default) sizes it.
      "--theme-table-corner-size": "",
      "--theme-table-corner-size-small": "",
      "--theme-lobby-corner-size": "",
      "--theme-lobby-corner-size-small": "",
    };
  }
  const ratio = (1 / definition.cornerScale / ((definition.frameSlice ?? 22) / 100)).toFixed(4);
  return {
    "--theme-corner-flip": "1",
    "--theme-corner-crop": "1",
    "--theme-corner-background-position": "top left",
    "--theme-corner-2-position": "top right",
    "--theme-corner-3-position": "bottom right",
    "--theme-corner-4-position": "bottom left",
    "--theme-table-corner-size": `calc(var(--theme-table-frame-width, 24px) * ${ratio})`,
    "--theme-table-corner-size-small": `calc(var(--theme-table-frame-width-small, 12px) * ${ratio})`,
    "--theme-lobby-corner-size": `calc(var(--theme-lobby-frame-width, 26px) * ${ratio})`,
    "--theme-lobby-corner-size-small": `calc(var(--theme-lobby-frame-width-small, 12px) * ${ratio})`,
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
