// The wild magic table a Wild Magic sorcerer's surge rolls on.
//
// THIS IS AN ORIGINAL TABLE WRITTEN FOR THIS APP. The table printed with the
// Wild Magic origin is not open content: none of its entries, their wording
// or their order is reproduced here, and nothing in this file was copied from
// it. A maintainer who edits this table writes new entries of their own in
// the same way. Each entry is a mechanic the engine already runs (a condition,
// hit points, temporary hit points, damage with a save, a teleport, sorcery
// points, a spell slot), so the server applies what is rolled
// (src/lib/dm/ar-ws-wild-surge.ts). One die, one entry: the die is the
// table's length (a d10).
//
// Pure data.

import type { Ability } from "@/lib/srd/authored-effects-types";

export type SurgeEffect =
  // A condition on the sorcerer: for a count of rounds, until the end of
  // their next turn, or until something ends it (prone).
  | { kind: "condition"; condition: string; rounds?: number; untilNextTurnEnds?: boolean }
  // Spent sorcery points come back, as many as the dice show.
  | { kind: "regain_points"; dice: string }
  // One spent spell slot comes back: the highest spent, `maxLevel` at most.
  | { kind: "regain_slot"; maxLevel: number }
  // Every other creature within reach saves against the sorcerer's spell save
  // DC or takes the dice, half as much on a success.
  | { kind: "burst"; rangeFt: number; save: Ability; dice: string; type: string }
  // Temporary hit points: the dice plus the sorcerer level.
  | { kind: "temp_hp"; dice: string }
  // A teleport of up to so many feet, the square the player's to choose.
  | { kind: "teleport"; feet: number }
  // Hit points regained.
  | { kind: "heal"; dice: string }
  // Damage to the sorcerer alone.
  | { kind: "self_damage"; dice: string; type: string };

export type SurgeEntry = { name: string; text: string; effect: SurgeEffect };

// The two rolls a Controlled Chaos sorcerer's surge left to pick from, kept
// on this condition's meta as `faces` (src/lib/dm/ar-ws-wild-surge.ts).
export const CHAOS_PICK = "controlled chaos";

// The rolls waiting on the pick, or none.
export function chaosFaces(sheet: { conditionMeta?: unknown }): number[] {
  const meta = (sheet.conditionMeta ?? {}) as Record<string, { faces?: unknown } | undefined>;
  const faces = meta[CHAOS_PICK]?.faces;
  return Array.isArray(faces) ? faces.filter((face): face is number => typeof face === "number") : [];
}

export const WILD_SURGE_TABLE: SurgeEntry[] = [
  { name: "Guttered Candle", text: "The light goes out behind your eyes: you are blinded until the end of your next turn.", effect: { kind: "condition", condition: "blinded", untilNextTurnEnds: true } },
  { name: "Loose Change", text: "Stray magic settles back into you: you regain 1d4 spent sorcery points.", effect: { kind: "regain_points", dice: "1d4" } },
  { name: "Borrowed Tomorrow", text: "A casting you had spent comes back: you regain one spent spell slot of 2nd level or lower, the higher if both are spent.", effect: { kind: "regain_slot", maxLevel: 2 } },
  { name: "Thunderclap Hiccup", text: "The spell coughs: every other creature within 10 feet of you makes a Constitution save against your spell save DC, taking 2d8 thunder damage, or half as much on a success.", effect: { kind: "burst", rangeFt: 10, save: "con", dice: "2d8", type: "thunder" } },
  { name: "Second Skin", text: "The surge wraps you: you gain temporary hit points equal to 1d8 plus your sorcerer level.", effect: { kind: "temp_hp", dice: "1d8" } },
  { name: "Wrong Footing", text: "The ground is not where you left it: you fall prone.", effect: { kind: "condition", condition: "prone" } },
  { name: "Sidestep Through Nothing", text: "You are elsewhere for a moment: you teleport up to 30 feet to an open space you can see.", effect: { kind: "teleport", feet: 30 } },
  { name: "Mended Seam", text: "The magic knits where it tore: you regain 2d6 hit points.", effect: { kind: "heal", dice: "2d6" } },
  { name: "Sour Note", text: "A ringing swallows every sound: you are deafened for a minute.", effect: { kind: "condition", condition: "deafened", rounds: 10 } },
  { name: "Static Bite", text: "The spell snaps back at your fingers: you take 1d6 lightning damage.", effect: { kind: "self_damage", dice: "1d6", type: "lightning" } },
];
