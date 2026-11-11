// An Arcane Archer's Arcane Shot (XGtE), as the engine and the Hand both read
// it: the options a sheet knows, the dice each adds, and the turn's key for an
// arrow that hit. Pure.
//
//   bow-hit:<enemyId>   an arrow from a shortbow or longbow hit that creature
//                       on the archer's own turn (attack-swing.ts writes it)
import { textKey } from "@/lib/language/text-logic";
import { chosenOptions } from "@/lib/srd/options";

export const BOW_HIT = "bow-hit:";
// The conditions three options lay that the engine reads by these names
// (src/lib/srd/authored-conditions.ts, src/lib/dm/mt-fb-arrow-riders.ts), and
// the mark on a charm a Beguiling Arrow laid.
export const ENFEEBLING = "enfeebling arrow";
export const GRASPING = "grasping arrow";
export const SHADOWED = "shadow arrow";
export const BEGUILED = "beguiling";

export const SHOTS = ["banishing", "beguiling", "bursting", "enfeebling", "grasping", "piercing", "seeking", "shadow"] as const;
export type Shot = (typeof SHOTS)[number];

// The two that are loosed with no attack roll: they take one attack of the
// Attack action themselves, where the others ride an arrow that hit.
export const NO_ROLL: readonly Shot[] = ["piercing", "seeking"];

export const SHOT_LABEL: Record<Shot, string> = {
  banishing: "Banishing Arrow",
  beguiling: "Beguiling Arrow",
  bursting: "Bursting Arrow",
  enfeebling: "Enfeebling Arrow",
  grasping: "Grasping Arrow",
  piercing: "Piercing Arrow",
  seeking: "Seeking Arrow",
  shadow: "Shadow Arrow",
};

const TYPE: Record<Shot, string> = {
  banishing: "force",
  beguiling: "psychic",
  bursting: "force",
  enfeebling: "necrotic",
  grasping: "poison",
  piercing: "piercing",
  seeking: "force",
  shadow: "psychic",
};

// "a shortbow or longbow", by the weapon's name as it is carried ("Longbow +1").
export function isBow(weapon: string | null | undefined): boolean {
  const words = textKey(weapon ?? "").split(" ");
  return words.includes("shortbow") || words.includes("longbow");
}

// The options a sheet knows, from its picks ("Arcane Shot: Banishing Arrow").
export function shotsKnown(features: Array<{ name: string }>): Shot[] {
  const picked = new Set(chosenOptions(features, "arcane_shot").map((name) => textKey(name).split(" ")[0]));
  return SHOTS.filter((shot) => picked.has(shot));
}

// The dice an option adds at this fighter level, null when it adds none
// (Banishing below 18th), and their type.
export function shotDamage(shot: Shot, level: number): { dice: string | null; type: string } {
  const greater = level >= 18;
  const dice = shot === "banishing" ? (greater ? "2d6" : null) : NO_ROLL.includes(shot) ? (greater ? "2d6" : "1d6") : greater ? "4d6" : "2d6";
  return { dice, type: TYPE[shot] };
}

// The creature the turn's latest arrow hit, from its marks.
export function lastBowHit(marks: readonly string[] | undefined): string | null {
  const hits = (marks ?? []).filter((mark) => mark.startsWith(BOW_HIT));
  return hits.length ? hits[hits.length - 1].slice(BOW_HIT.length) : null;
}
