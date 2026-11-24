// Visual identity is independent of brightness and the campaign's story theme.
// This catalog is safe to import in both client components and server schemas.
import type { Genre } from "@/lib/schemas/game-settings-options";

export const APPEARANCE_ICONS = ["sparkles", "leaf", "church", "flame", "shield", "waves", "anvil", "eye", "snowflake", "chain", "flower", "cog", "circuit", "wrench", "lamp"] as const;
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
  // Genres the look fits without being their default. A theme may suit several.
  suits?: readonly Genre[];
  // Plain surfaces replace the app's original celestial furniture.
  baseStyle?: "celestial" | "plain";
  // A scaled corner reads the top-left 1/scale portion along each image axis.
  cornerScale?: number;
  frameSlice?: number;
  art?: ThemeArt;
  // Day artwork: a slot given here replaces the same slot of `art` while the
  // brightness is light. The corner crop and frame slice serve both sets.
  artDay?: ThemeArt;
}
export type ThemeBrightness = "dark" | "light";

// Add a theme here once. Schema IDs, both pickers and validation use this list.
// See docs/appearance-themes.md for palette, artwork and preview requirements.
export const APPEARANCE_THEMES = [
  {
    id: "arcane", name: "Arcane", description: "Indigo stone, celestial brass, and amethyst fittings.", icon: "sparkles", suits: ["high_fantasy", "dark_fantasy"],
    baseStyle: "celestial",
    art: {
      texture: "/assets/themes/arcane/indigo-stone-v1.webp",
      frame: "/assets/themes/arcane/celestial-brass-frame-v1.webp",
      corner: "/assets/themes/arcane/astral-brass-clasp-v1.webp",
      backdrop: "/assets/themes/arcane/astral-observatory-v1.webp",
    },
  },
  {
    id: "woodland", name: "Ancient Woodland", description: "Carved oak, living ivy, and silver leaf fittings.", icon: "leaf", suits: ["high_fantasy"],
    art: {
      texture: "/assets/themes/woodland/oak-grain-v1.webp",
      frame: "/assets/themes/woodland/ivy-oak-frame-v1.webp",
      corner: "/assets/themes/woodland/root-silver-joint-v1.webp",
      backdrop: "/assets/themes/woodland/elderwood-canopy-v1.webp",
    },
  },
  {
    id: "gothic", name: "Gothic", description: "Cathedral stone, silver tracery, and garnet glass.", icon: "church", suits: ["dark_fantasy", "horror"],
    genres: ["dark_fantasy", "horror"],
    art: {
      texture: "/assets/themes/gothic/cathedral-slate-v1.webp",
      frame: "/assets/themes/gothic/cathedral-iron-frame-v1.webp",
      corner: "/assets/themes/gothic/rose-window-briar-v1.webp",
      backdrop: "/assets/themes/gothic/moonlit-cloister-v1.webp",
    },
  },
  {
    id: "hearth", name: "Hearth & Haven", description: "Warm parchment, crafted oak, and welcoming amber lamplight.", icon: "flame", suits: ["high_fantasy"],
    art: {
      texture: "/assets/themes/hearth/honey-oak-v1.webp",
      frame: "/assets/themes/hearth/carved-oak-frame-v1.webp",
      corner: "/assets/themes/hearth/oak-brass-strap-hinge-v1.webp",
      backdrop: "/assets/themes/hearth/fireside-haven-v1.webp",
    },
  },
  {
    id: "kingdoms", name: "High Kingdoms", description: "Ivory vellum, royal blue, and illuminated heraldry.", icon: "shield", suits: ["high_fantasy"],
    art: {
      texture: "/assets/themes/kingdoms/ivory-vellum-v1.webp",
      frame: "/assets/themes/kingdoms/illuminated-heraldry-frame-v1.webp",
      corner: "/assets/themes/kingdoms/wheat-rosette-gilt-scroll-v1.webp",
      backdrop: "/assets/themes/kingdoms/royal-council-hall-v1.webp",
    },
  },
  {
    id: "tide", name: "Sunken Tide", description: "Sea-glass teal, pale driftwood, and verdigris bronze.", icon: "waves", suits: ["high_fantasy"],
    art: {
      texture: "/assets/themes/tide/driftwood-v1.webp",
      frame: "/assets/themes/tide/kelp-driftwood-frame-v1.webp",
      corner: "/assets/themes/tide/shell-bronze-clasp-v1.webp",
      backdrop: "/assets/themes/tide/tide-shrine-v1.webp",
    },
  },
  {
    id: "forge", name: "Deep Forge", description: "Dark basalt, hammered bronze, and ember light.", icon: "anvil", suits: ["high_fantasy", "dark_fantasy"],
    art: {
      texture: "/assets/themes/forge/basalt-v1.webp",
      frame: "/assets/themes/forge/bronze-band-frame-v1.webp",
      corner: "/assets/themes/forge/ember-plate-corner-v1.webp",
      backdrop: "/assets/themes/forge/forge-hall-v1.webp",
    },
  },
  {
    id: "depths", name: "Unquiet Depths", description: "A case file gone wrong by day; what it found, coiled in drowned stone, by night.", icon: "eye", suits: ["horror", "mystery"],
    // Each rail is one long painted strip, so its corners are a small share
    // of the image and the stretched middle repeats only every 8 rail widths.
    frameSlice: 10,
    art: {
      texture: "/assets/themes/depths/wet-stone-v1.webp",
      frame: "/assets/themes/depths/cracked-stone-frame-v4.webp",
      corner: "/assets/themes/depths/slit-eye-coil-v3.webp",
      backdrop: "/assets/themes/depths/drowned-abyss-v2.webp",
    },
    artDay: {
      texture: "/assets/themes/depths/manila-card-v1.webp",
      frame: "/assets/themes/depths/case-file-frame-v2.webp",
      corner: "/assets/themes/depths/ring-slit-seal-v2.webp",
      backdrop: "/assets/themes/depths/case-gone-wrong-v2.webp",
    },
  },
  {
    id: "frost", name: "Frostbound", description: "Blue-white ice, pale steel, and aurora light.", icon: "snowflake", suits: ["high_fantasy"],
    art: {
      texture: "/assets/themes/frost/rimed-steel-v1.webp",
      frame: "/assets/themes/frost/rimed-steel-frame-v1.webp",
      corner: "/assets/themes/frost/frost-crystal-boss-v1.webp",
      backdrop: "/assets/themes/frost/aurora-pass-v1.webp",
    },
  },
  {
    id: "inferno", name: "Inferno", description: "Obsidian, black iron chain, and a crimson glow.", icon: "chain", suits: ["high_fantasy", "dark_fantasy"],
    art: {
      texture: "/assets/themes/inferno/obsidian-v1.webp",
      frame: "/assets/themes/inferno/iron-chain-frame-v1.webp",
      corner: "/assets/themes/inferno/gem-ring-corner-v1.webp",
      backdrop: "/assets/themes/inferno/brimstone-cavern-v1.webp",
    },
  },
  {
    id: "fey", name: "Twilight Court", description: "Dusk rose, gossamer thread, and pearl silverwork.", icon: "flower", suits: ["high_fantasy"],
    art: {
      texture: "/assets/themes/fey/gossamer-silk-v1.webp",
      frame: "/assets/themes/fey/silver-stem-blossom-frame-v1.webp",
      corner: "/assets/themes/fey/bloom-rosette-corner-v1.webp",
      backdrop: "/assets/themes/fey/dusk-glade-v1.webp",
    },
  },
  {
    id: "brassworks", name: "Brassworks", description: "Brass pipework and meshed gears, oxblood leather, and green gauge glass.", icon: "cog", suits: ["steampunk"],
    // The brass pipework is the same by day; the page under it changes from
    // the engine hall's leather to the drawing office's linen.
    art: {
      texture: "/assets/themes/brassworks/oxblood-leather-v1.webp",
      frame: "/assets/themes/brassworks/brass-pipe-frame-v1.webp",
      corner: "/assets/themes/brassworks/porthole-gears-corner-v3.webp",
      backdrop: "/assets/themes/brassworks/engine-hall-gears-v2.webp",
    },
    artDay: {
      texture: "/assets/themes/brassworks/drawing-linen-v1.webp",
      backdrop: "/assets/themes/brassworks/drawing-office-gears-v2.webp",
    },
  },
  {
    id: "neon", name: "Neon District", description: "Black glass, magenta and cyan tube signs, and brushed steel.", icon: "circuit", suits: ["cyberpunk"],
    art: {
      texture: "/assets/themes/neon/black-glass-v1.webp",
      frame: "/assets/themes/neon/tube-channel-frame-v1.svg",
      corner: "/assets/themes/neon/junction-box-corner-v1.webp",
      backdrop: "/assets/themes/neon/rain-street-v1.webp",
    },
    artDay: {
      frame: "/assets/themes/neon/tube-channel-frame-day-v1.svg",
      corner: "/assets/themes/neon/junction-box-corner-day-v1.webp",
      backdrop: "/assets/themes/neon/overcast-street-v1.webp",
    },
  },
  {
    id: "wasteland", name: "Wasteland", description: "Roll-cage tube, tyre tread and chain: the desert road by day, the convoy's fires by night.", icon: "wrench", suits: ["post_apocalyptic"],
    // The machine-built frame and corner serve both modes: the same rig at
    // noon and by firelight. The ground under the panels and the view change:
    // canvas and the storm road by day, steel and the convoy camp by night.
    // The slice is cut at the tube's elbow, so the tube fills the rail. The
    // corner piece covers the elbow everywhere but the picker.
    frameSlice: 13,
    art: {
      texture: "/assets/themes/wasteland/cooled-steel-v1.webp",
      frame: "/assets/themes/wasteland/roll-cage-frame-v2.webp",
      corner: "/assets/themes/wasteland/salvage-wheel-corner-v1.webp",
      backdrop: "/assets/themes/wasteland/convoy-fires-v1.webp",
    },
    artDay: {
      texture: "/assets/themes/wasteland/bleached-canvas-v1.webp",
      backdrop: "/assets/themes/wasteland/dust-storm-road-v1.webp",
    },
  },
  {
    id: "gaslight", name: "Gaslight", description: "Dark walnut, polished brass, and green baize by gaslight.", icon: "lamp", suits: ["mystery"],
    // The rail is one plain walnut bead with a brass line, painted in the
    // outer 8% of the frame; a wider slice would leave it a thread.
    frameSlice: 8,
    // Night is the room itself: walnut for the page, with baize kept for the
    // panels by the palette.
    art: {
      texture: "/assets/themes/gaslight/walnut-panel-v1.webp",
      frame: "/assets/themes/gaslight/walnut-brass-frame-v1.webp",
      corner: "/assets/themes/gaslight/gas-bracket-lamp-lit-v1.webp",
      backdrop: "/assets/themes/gaslight/reading-room-walnut-v1.webp",
    },
    // The same room on a grey morning with the gas turned off: the green
    // cloth under pale paper, the bracket lamp unlit, cream walls behind.
    artDay: {
      texture: "/assets/themes/gaslight/green-baize-v1.webp",
      corner: "/assets/themes/gaslight/gas-bracket-lamp-unlit-v1.webp",
      backdrop: "/assets/themes/gaslight/reading-room-morning-v1.webp",
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

// The artwork a theme shows at one brightness. Every slot is written on each
// change of theme or brightness, so neither set outlives its mode.
export function themeArt(id: AppearanceTheme, mode: ThemeBrightness = "dark"): ThemeArt | undefined {
  return modeArt(appearanceDefinition(id), mode);
}
export function modeArt({ art, artDay }: Pick<AppearanceDefinition, "art" | "artDay">, mode: ThemeBrightness): ThemeArt | undefined {
  return mode === "light" && artDay ? { ...art, ...artDay } : art;
}

// Explicit none values prevent artwork leaking when switching themes or when
// a picker thumbnail is nested inside a different theme. Safe during SSR too.
export function themeArtStyle(id: AppearanceTheme, mode: ThemeBrightness = "dark"): Record<`--theme-${string}`, string> {
  const definition = appearanceDefinition(id);
  return {
    ...artSlotStyle(themeArt(id, mode)),
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

// The themes a picker offers first at a table of this genre: those that suit
// it or are its default, plus any the caller keeps in view (the one in use).
// Null means the whole catalog: no genre to go by, too few suited to be a
// choice, or so few left out that hiding them would only add a step.
export function genreShortlist<T extends { id: string; genres?: readonly string[]; suits?: readonly string[] }>(genre: string | undefined, catalog: readonly T[], keep: readonly string[] = []): T["id"][] | null {
  if (!genre) return null;
  const suited = catalog.filter((entry) => entry.suits?.includes(genre) || entry.genres?.includes(genre));
  if (suited.length < 2) return null;
  const shown = catalog.filter((entry) => suited.includes(entry) || keep.includes(entry.id));
  return catalog.length - shown.length < 3 ? null : shown.map((entry) => entry.id);
}

// A theme's name and look in the reader's language. The name takes a context
// of its own: "Arcane" alone is the Arcana skill's word in French.
type ThemeT = (key: string, vars?: { context?: string }) => string;
export function themeName(t: ThemeT, entry: Pick<AppearanceDefinition, "id" | "name">): string {
  return t(entry.name, { context: `appearance.theme.${entry.id}` });
}
export function themeDescription(t: ThemeT, entry: Pick<AppearanceDefinition, "description">): string {
  return t(entry.description);
}
