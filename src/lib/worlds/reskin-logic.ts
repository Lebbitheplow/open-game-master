// Display overlays for a selected world pack.
//
// Everything here changes a LABEL and nothing else. Ids are never rewritten,
// so race.asi, classFeaturesFor(klass.id), spellClassFor(klass.id) and the
// submitted sheet all keep seeing canonical values. That is the invariant that
// lets a pack be a pure reskin instead of a fork of the rules.
//
// Pure and client-safe on purpose: the character builder imports it directly
// and plain-node tests import it with no Next or database context.
import type { WorldPack } from "@/lib/worlds/types";
import { textKey } from "@/lib/language/text-logic";
import { srdRaceId } from "@/lib/srd/race-id";

export type IdReskin = { id: string; name: string; blurb: string };

// What an overlaid option carries on top of its canonical shape. `packName` is
// present only when this pack actually renames the entry, which is what the
// builder keys "show the canonical name too" off.
export type Reskinned<T> = T & { packName?: string; packBlurb?: string };

// How a pack's id is matched to an option's. A pack names races by the
// bundled snake_case ids (hill_dwarf, variant_human), while with the content
// pack installed the creator offers its rows under kebab-case slugs
// (hill-dwarf), so a race is matched on its one spelling (srdRaceId). Matched
// on the raw id, six of Saltmarch's twelve peoples kept their canonical
// names and dropped out of the world's recommended group. Classes and
// backgrounds use one spelling everywhere.
function reskinKey(kind: IdReskinKind | undefined, id: string): string {
  return kind === "races" ? srdRaceId(id) : id;
}

export function applyIdReskins<T extends { id: string; name: string }>(
  options: T[],
  reskins: IdReskin[],
  kind?: IdReskinKind,
): Array<Reskinned<T>> {
  if (!reskins.length) {
    return options;
  }
  const byId = new Map(reskins.map((entry) => [reskinKey(kind, entry.id), entry]));
  return options.map((option) => {
    const reskin = byId.get(reskinKey(kind, option.id));
    if (!reskin) {
      return option;
    }
    // The reskin renames an option that exists. A reskin naming an id the
    // catalog does not have is ignored rather than injected, because a pack
    // must not conjure a class the rules engine cannot resolve.
    return { ...option, name: reskin.name, packName: reskin.name, packBlurb: reskin.blurb };
  });
}

// Classes additionally carry castingLabel, the existing flavor field that
// decides whether a sheet says "spells" or "Programs" or "Jutsu".
export function applyClassReskins<
  T extends { id: string; name: string; castingLabel?: string | null },
>(options: T[], pack: WorldPack | null): Array<Reskinned<T>> {
  if (!pack?.classes.length) {
    return options;
  }
  const byId = new Map(pack.classes.map((entry) => [entry.id, entry]));
  return options.map((option) => {
    const reskin = byId.get(option.id);
    if (!reskin) {
      return option;
    }
    return {
      ...option,
      name: reskin.name,
      packName: reskin.name,
      packBlurb: reskin.blurb,
      // Only override when the pack states one. A pack that leaves it null on
      // a caster is saying "the ordinary word is fine here".
      castingLabel: reskin.castingLabel ?? option.castingLabel ?? null,
    };
  });
}

export type NameReskinKind = "spells" | "items" | "features";

// The label for something the sheet stores by name. Falls through to the
// canonical string when there is no pack or no mapping, so every caller can
// pass it unconditionally.
export function displayName(
  pack: WorldPack | null,
  kind: NameReskinKind,
  canonical: string,
): string {
  if (!pack) {
    return canonical;
  }
  const wanted = textKey(canonical);
  const match = pack[kind].find((entry) => textKey(entry.from) === wanted);
  if (match) {
    return match.name;
  }
  // The class tables list one feature at each step of its growth: "Bardic
  // Inspiration (d6)", "Channel Divinity (1/rest)", "Channel Divinity: Turn
  // Undead". A pack renames the feature, so each step wears the new name
  // with its die or count kept; matched on the exact name only, every one of
  // them showed the canonical name.
  const split = /^(.*?)(\s*\(.*\)|:\s.*)$/.exec(canonical);
  if (split) {
    const base = textKey(split[1]);
    const stem = pack[kind].find((entry) => textKey(entry.from) === base);
    if (stem) {
      return `${stem.name}${split[2]}`;
    }
  }
  return canonical;
}

export type IdReskinKind = "races" | "classes" | "backgrounds";

// Whether this pack calls out an option as fitting its world, which is what
// floats it into the builder's recommended group.
export function packRecommends(
  pack: WorldPack | null,
  kind: IdReskinKind,
  id: string,
): boolean {
  const wanted = reskinKey(kind, id);
  return Boolean(pack?.[kind].some((entry) => reskinKey(kind, entry.id) === wanted));
}

// The ids a pack recommends, in the pack's own order. These are raw pack
// values, NOT validated against the catalog: this module is client-safe and
// has no catalog to check against. scripts/test-world-packs.mjs proves every
// shipped pack's ids resolve, but a pack injected through WORLD_PACKS_DIR is
// unvetted, so any caller that turns this into an allowlist must filter it
// against the real catalog first (see companion-tools).
export function packIds(pack: WorldPack | null, kind: IdReskinKind): string[] {
  return pack ? pack[kind].map((entry) => entry.id) : [];
}
