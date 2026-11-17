import {
  BookOpen,
  Dices,
  FlaskConical,
  Globe2,
  LayoutGrid,
  type LucideIcon,
  Map as MapIcon,
  Puzzle,
  Scale,
  Share2,
  Skull,
  Swords,
  UserRound,
  Users,
  Flag,
  Orbit,
} from "lucide-react";
import type { WorkshopSummary } from "@/app/workshop/types";
import type { IconRef } from "@/lib/icons";

// The systems a workshop is made of, and how each one counts itself.
//
// Nine of the counts come straight off the workshop's contents map, which
// /api/workshops/:id already serves per importable kind. The bestiary, the
// homebrew shelf, the party and the plugin are the exceptions: monsters,
// items, spells, character options and pregens are the builder's, not the
// workshop's, and the world pack draft is one JSON value rather than rows,
// so none of them are importable kinds and their counts are fetched from
// their own routes by the page. WorldForge counts what it adds over the
// records the other cards already count (links, events, secrets, maps), from
// its own route too. Rules is a yes-or-no rather than a number, and Share has
// nothing to count.
//
// The names, taglines and count lines live in the dictionaries under
// `workshop.system.*`: the data keeps ids and icons, and the readers pass the
// translator they already hold (the way home/types.ts agoLabel does), so a
// language switch rewords every card with the rest of the hub.

export type WorldCount = { entries: number; links: number; events: number; secrets: number; maps: number };

// Each system's painted glyph (scripts/icon-set.mjs paints them).
export function systemGlyph(id: SystemId): IconRef {
  return { kind: "glyph", key: `system-${id}` };
}

export const WORKSHOP_SYSTEMS = [
  { id: "world", icon: Orbit },
  { id: "storyboard", icon: LayoutGrid },
  { id: "party", icon: UserRound },
  { id: "maps", icon: MapIcon },
  { id: "region", icon: Globe2 },
  { id: "encounters", icon: Swords },
  { id: "cast", icon: Users },
  { id: "factions", icon: Flag },
  { id: "bestiary", icon: Skull },
  { id: "homebrew", icon: FlaskConical },
  { id: "lore", icon: BookOpen },
  { id: "tables", icon: Dices },
  { id: "rules", icon: Scale },
  { id: "plugin", icon: Puzzle },
  { id: "share", icon: Share2 },
] as const satisfies ReadonlyArray<{
  id: string;
  icon: LucideIcon;
}>;

export type SystemId = (typeof WORKSHOP_SYSTEMS)[number]["id"];

export function isSystemId(value: string | null): value is SystemId {
  return WORKSHOP_SYSTEMS.some((system) => system.id === value);
}

// The card's name and tagline, by the system's id.
type Translator = (key: string, vars?: Record<string, string | number>) => string;

export function systemLabel(t: Translator, id: SystemId): string {
  return ({ "world": t("WorldForge"), "storyboard": t("Storyboard"), "party": t("Party"), "maps": t("Battle maps"), "region": t("Region"), "encounters": t("Encounters"), "cast": t("Cast", { context: "workshop.system.cast.label" }), "factions": t("Factions"), "bestiary": t("Bestiary"), "homebrew": t("Homebrew"), "lore": t("Lore", { context: "workshop.system.lore.label" }), "tables": t("Tables"), "rules": t("Rules"), "plugin": t("Plugin"), "share": t("Share", { context: "workshop.system.share.label" }) } as Record<string, string>)[id] ?? String(id);
}

export function systemBlurb(t: Translator, id: SystemId): string {
  return ({ "world": t("Build the world"), "storyboard": t("Plan the arc"), "party": t("Who it is built for"), "maps": t("Rooms to fight in"), "region": t("The overworld & its places"), "encounters": t("Fights, budgeted"), "cast": t("NPCs & agendas"), "factions": t("Powers & standing"), "bestiary": t("Homebrew monsters"), "homebrew": t("Items, spells & options"), "lore": t("Facts, handouts & shops"), "tables": t("Roll tables"), "rules": t("House & variant"), "plugin": t("Build a world pack"), "share": t("Export a bundle") } as Record<string, string>)[id] ?? String(id);
}

// What a card shows big and what the system title says after its name.
// `figure` is null when there is nothing to count (Share) and, for the
// bestiary, while its count is still on the wire.
export type SystemCount = { figure: string | null; phrase: string; total: number };

// A counted word with its plural: "3 fights", "1 fight".
function countWord(t: Translator, key: string, count: number): string {
  return t(key, { count });
}

export function systemCount(
  t: Translator,
  id: SystemId,
  workshop: WorkshopSummary,
  bestiary: number | null,
  homebrew: number | null = null,
  pregens: number | null = null,
  plugin: number | null = null,
  world: WorldCount | null = null,
): SystemCount {
  const contents = workshop.contents;
  switch (id) {
    case "world": {
      if (!world) return { figure: null, phrase: t("counting"), total: 0 };
      const pieces = world.links + world.events + world.secrets + world.maps;
      return {
        figure: String(world.entries),
        phrase: world.entries
          ? [
              countWord(t, "workshop.system.world.entries", world.entries),
              countWord(t, "workshop.system.world.links", world.links),
              countWord(t, "workshop.system.world.events", world.events),
            ].join(", ")
          : t("an empty world"),
        total: pieces,
      };
    }
    case "plugin":
      return {
        figure: plugin === null ? null : String(plugin),
        phrase:
          plugin === null
            ? t("counting")
            : plugin
              ? countWord(t, "workshop.system.plugin.pack", plugin)
              : t("no pack yet"),
        total: plugin ?? 0,
      };
    case "party": {
      const party = workshop.gameSettings.targetParty;
      return {
        figure: String(party.size),
        phrase:
          pregens === null
            ? t("at level {level}", { level: party.level })
            : `${t("at level {level}", { level: party.level })}, ${countWord(t, "workshop.system.party.pregens", pregens)}`,
        total: pregens ?? 0,
      };
    }
    case "homebrew":
      return {
        figure: homebrew === null ? null : String(homebrew),
        phrase: homebrew === null ? t("counting") : countWord(t, "workshop.system.homebrew.count", homebrew),
        total: homebrew ?? 0,
      };
    case "storyboard": {
      const count = contents.storyboard;
      return {
        figure: String(count),
        phrase: count ? t("a board in progress") : t("no board yet"),
        total: count,
      };
    }
    case "maps":
      return { figure: String(contents.maps), phrase: countWord(t, "{count} in the drawer", contents.maps), total: contents.maps };
    case "region": {
      // Places live here: the overworld pins every location the workshop
      // knows, so they are counted on this card rather than on Lore, whose
      // tab lists only lore entries (issue #121 saw a 28 over a list of 16).
      const count = contents.overworld;
      const places = contents.locations;
      const drawn = count ? t("the overworld is drawn") : t("no overworld yet");
      return {
        figure: String(count + places),
        phrase: places ? `${drawn}, ${countWord(t, "workshop.system.region.places", places)}` : drawn,
        total: count + places,
      };
    }
    case "encounters":
      return {
        figure: String(contents.encounters),
        phrase: countWord(t, "workshop.system.encounters.count", contents.encounters),
        total: contents.encounters,
      };
    case "cast":
      return {
        figure: String(contents.npcs),
        phrase: countWord(t, "workshop.system.cast.count", contents.npcs),
        total: contents.npcs,
      };
    case "factions":
      // Not counted on the summary; the panel reads its own list.
      return { figure: null, phrase: t("powers of the world"), total: 0 };
    case "bestiary":
      return {
        figure: bestiary === null ? null : String(bestiary),
        phrase: bestiary === null ? t("counting") : countWord(t, "workshop.system.bestiary.count", bestiary),
        total: bestiary ?? 0,
      };
    case "lore": {
      // The Market's shops sit under Lore's entries, so the card counts and
      // names them too (audit WA-10).
      const count = contents.lore;
      const shops = contents.shops ?? 0;
      const entries = countWord(t, "workshop.system.lore.entries", count);
      return {
        figure: String(count + shops),
        phrase: shops ? `${entries}, ${countWord(t, "workshop.system.lore.shops", shops)}` : entries,
        total: count + shops,
      };
    }
    case "tables":
      return {
        figure: String(contents.tables),
        phrase: countWord(t, "workshop.system.tables.count", contents.tables),
        total: contents.tables,
      };
    case "rules":
      return {
        figure: contents.houseRules ? t("set") : t("none", { context: "workshop.system.rules.figureNone" }),
        phrase: contents.houseRules ? t("house rules set") : t("no house rules yet"),
        total: 0,
      };
    case "share":
      return { figure: null, phrase: t("export a bundle"), total: 0 };
  }
}

// "41 pieces of prep": every countable thing in the workshop, for the hub's
// section heading.
export function totalPieces(
  t: Translator,
  workshop: WorkshopSummary,
  bestiary: number | null,
  homebrew: number | null = null,
  pregens: number | null = null,
  plugin: number | null = null,
  world: WorldCount | null = null,
): number {
  return WORKSHOP_SYSTEMS.reduce(
    (sum, system) => sum + systemCount(t, system.id, workshop, bestiary, homebrew, pregens, plugin, world).total,
    0,
  );
}
