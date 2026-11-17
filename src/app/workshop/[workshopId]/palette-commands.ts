import type { PaletteCommand } from "@/components/CommandPalette";
import type { MessageKey } from "@/lib/messages-logic";
import { WORKSHOP_SYSTEMS, systemBlurb, systemLabel, type SystemId } from "@/app/workshop/[workshopId]/systems";

// The workshop's command palette, derived from the systems the hub lists:
// one "jump" per system, and one "create" for every system whose panel can
// open its own editor when asked.
//
// Asking is the tour's prepare broadcast (src/lib/tours/prepare.ts): the page
// knows nothing about a panel's editor, the panel does, and it already
// answers these names for the guided tours. The palette is a second caller of
// the same names, so it can never open something the panel's own "New"
// button does not.
//
// The words it shows live in the dictionaries under `workshop.palette.*`; the
// keywords stay the palette's English search terms — they are matched against
// what a user types, never shown.

const GLYPH: Record<SystemId, string> = {
  world: "system-world",
  storyboard: "system-storyboard",
  party: "system-party",
  maps: "system-maps",
  region: "system-region",
  encounters: "system-encounters",
  cast: "system-cast",
  factions: "system-factions",
  bestiary: "system-bestiary",
  homebrew: "system-homebrew",
  lore: "system-lore",
  tables: "system-tables",
  rules: "system-rules",
  plugin: "system-plugin",
  share: "system-share",
};

// Lore has two: its own entries, and the Market's shops below them, which
// an author looking for shops could not find (audit WA-10).
export const SYSTEM_CREATE: Partial<Record<SystemId, Array<{ label: MessageKey; prepare: string; keywords: string[] }>>> = {
  world: [{ label: "New world entry", prepare: "open-world-entry", keywords: ["create", "add", "worldforge", "wiki", "entry"] }],
  maps: [{ label: "New battle map", prepare: "open-map-create", keywords: ["create", "add", "map", "room"] }],
  encounters: [{ label: "New encounter", prepare: "open-encounter-editor", keywords: ["create", "add", "fight"] }],
  cast: [{ label: "New NPC", prepare: "open-npc-editor", keywords: ["create", "add", "person", "character"] }],
  bestiary: [{ label: "Build a monster", prepare: "open-monster-build", keywords: ["create", "new", "add", "creature"] }],
  homebrew: [{ label: "New homebrew", prepare: "open-homebrew-editor", keywords: ["create", "add", "item", "spell", "option"] }],
  lore: [
    { label: "New lore entry", prepare: "open-lore-editor", keywords: ["create", "add", "fact", "place", "handout"] },
    { label: "New shop", prepare: "open-shop-editor", keywords: ["create", "add", "market", "merchant", "store", "trade"] },
  ],
  tables: [{ label: "New roll table", prepare: "open-table-editor", keywords: ["create", "add", "random"] }],
  plugin: [{ label: "Open the world pack wizard", prepare: "open-plugin-wizard", keywords: ["create", "new", "pack", "plugin"] }],
};

// The reading takes the translator from the page that draws the palette, so
// a language switch rewords the commands with the rest of the workshop.
type Translator = (key: string, vars?: Record<string, string | number>) => string;

export function workshopCommands(
  t: Translator,
  {
    current,
    phrase,
    onJump,
    onCreate,
    onHub,
    onHelp,
  }: {
    // The system on screen, or null on the hub.
    current: SystemId | null;
    // Each system's live count phrase, for the quiet line under its name.
    phrase: (id: SystemId) => string;
    onJump: (id: SystemId) => void;
    onCreate: (id: SystemId, prepare: string) => void;
    onHub: () => void;
    onHelp: () => void;
  },
): PaletteCommand[] {
  const jumps: PaletteCommand[] = WORKSHOP_SYSTEMS.filter((system) => system.id !== current).map((system) => ({
    id: `go-${system.id}`,
    label: t("Go to {name}", { name: systemLabel(t, system.id) }),
    hint: t("{blurb} · {count}", { blurb: systemBlurb(t, system.id), count: phrase(system.id) }),
    group: t("Jump to a system"),
    glyph: GLYPH[system.id],
    keywords: ["open", "jump", system.id],
    onSelect: () => onJump(system.id),
  }));
  const creates: PaletteCommand[] = WORKSHOP_SYSTEMS.flatMap((system) =>
    (SYSTEM_CREATE[system.id] ?? []).map((create, index) => ({
      id: index ? `new-${system.id}-${index}` : `new-${system.id}`,
      label: t(create.label),
      hint: t("In {name}", { name: systemLabel(t, system.id) }),
      group: t("Create an entry"),
      glyph: GLYPH[system.id],
      keywords: [...create.keywords, systemLabel(t, system.id)],
      onSelect: () => onCreate(system.id, create.prepare),
    })),
  );
  const here: PaletteCommand[] = [
    ...(current
      ? [{ id: "hub", label: t("Back to the hub"), hint: t("Every system at a glance"), group: t("This workshop"), glyph: "tab-campaigns", keywords: ["home", "cards"], onSelect: onHub }]
      : []),
    { id: "help", label: t("Guides and tours"), hint: t("How this works, and the walkthroughs"), group: t("This workshop"), glyph: "tab-reference", keywords: ["help", "tour", "guide"], onSelect: onHelp },
  ];
  return [...jumps, ...creates, ...here];
}
