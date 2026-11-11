// The Spirit Tales table and the tale a bard holds, apart from the engine
// that tells and plays them (src/lib/dm/spirit-tales.ts), so the Hand reads
// the same table: Release Tale's card is aimed at a friend for a tale that
// heals and at a foe for any other (hand-subclass.ts). Pure.

import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import { isConditionNamed, nameChoice } from "@/lib/srd/feature-names";

export const SPIRIT_TALE = "spirit tale";
const REACH = 30;

// The bard's Bardic Inspiration die at a bard level.
export const dieAt = (level: number) => (level >= 15 ? "d12" : level >= 10 ? "d10" : level >= 5 ? "d8" : "d6");
const dice = (count: number) => (level: number) => `${count}${dieAt(level)}`;
const healing = (count: number) => (level: number) => `${count}${dieAt(level)}+${level}`;

type Tale = { name: string; told: string; helps?: boolean; does: SpendDoes };

export const SPIRIT_TALES: Tale[] = [
  { name: "The Burned Bridge", told: "a bridge that burned under an army: the creature makes a Dexterity save, taking two Bardic Inspiration dice of fire damage, half on a success", does: { kind: "save_effect", save: "dex", dcAbility: "spell", dice: dice(2), type: "fire", half: true, rangeFt: REACH } },
  { name: "The Hound at the Gate", told: "a hound that guarded a gate past death: the creature makes a Wisdom save or is frightened of the bard until the end of its next turn", does: { kind: "save_effect", save: "wis", dcAbility: "spell", condition: "frightened", rounds: 1, rangeFt: REACH } },
  { name: "The Healer's Last Song", told: "a healer who sang through a plague: the creature regains one Bardic Inspiration die plus the bard's level in hit points", helps: true, does: { kind: "heal_area", formula: healing(1), rangeFt: REACH, chosen: true } },
  { name: "The Thunder Child", told: "a child born in a storm: the creature makes a Strength save, or takes a Bardic Inspiration die of thunder damage and is knocked prone", does: { kind: "save_effect", save: "str", dcAbility: "spell", dice: dice(1), type: "thunder", condition: "prone", rangeFt: REACH } },
  { name: "The Drowned Lantern", told: "a lantern carried down into a lake: the creature makes a Constitution save or is blinded until the end of its next turn", does: { kind: "save_effect", save: "con", dcAbility: "spell", condition: "blinded", rounds: 1, rangeFt: REACH } },
  { name: "The Lying Twin", told: "a twin who lived the other's life: the creature makes a Wisdom save or is charmed by the bard for a minute, saving again at the end of each of its turns", does: { kind: "save_effect", save: "wis", dcAbility: "spell", condition: "charmed", rounds: 10, saveEnds: true, rangeFt: REACH } },
  { name: "The Cold Crown", told: "a queen whose crown froze to her brow: the creature makes a Constitution save, taking two Bardic Inspiration dice of cold damage, half on a success", does: { kind: "save_effect", save: "con", dcAbility: "spell", dice: dice(2), type: "cold", half: true, rangeFt: REACH } },
  { name: "The Whispering Knife", told: "a knife that told its owner secrets: the creature makes an Intelligence save, taking two Bardic Inspiration dice of psychic damage, half on a success", does: { kind: "save_effect", save: "int", dcAbility: "spell", dice: dice(2), type: "psychic", half: true, rangeFt: REACH } },
  { name: "The Kind Stranger", told: "a stranger who mended every wound on the road: the creature regains two Bardic Inspiration dice plus the bard's level in hit points", helps: true, does: { kind: "heal_area", formula: healing(2), rangeFt: REACH, chosen: true } },
  { name: "The Stone Sleeper", told: "a sleeper who woke in a quarry wall: the creature makes a Constitution save or is poisoned for a minute, saving again at the end of each of its turns", does: { kind: "save_effect", save: "con", dcAbility: "spell", condition: "poisoned", rounds: 10, saveEnds: true, rangeFt: REACH } },
  { name: "The Last Charge", told: "a company that charged a dragon: the creature makes a Wisdom save or is frightened of the bard for a minute, saving again at the end of each of its turns", does: { kind: "save_effect", save: "wis", dcAbility: "spell", condition: "frightened", rounds: 10, saveEnds: true, rangeFt: REACH } },
  { name: "The Storm Bride", told: "a bride who married the storm: the creature makes a Dexterity save, taking three Bardic Inspiration dice of lightning damage, half on a success", does: { kind: "save_effect", save: "dex", dcAbility: "spell", dice: dice(3), type: "lightning", half: true, rangeFt: REACH } },
];

// The tale the bard holds: its mark, and its number on the table (the
// mark's meta, or a mark written as "spirit tale (N)"), null when the mark
// carries none (laid by hand): that tale is drawn as it is told.
export function heldTale(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">): { mark: string; number: number | null } | null {
  const mark = sheet.conditions.find((entry) => isConditionNamed(entry, SPIRIT_TALE));
  if (!mark) return null;
  const meta = (sheet.conditionMeta ?? {}) as Record<string, { tale?: number } | undefined>;
  const number = meta[mark]?.tale ?? Number(nameChoice(mark));
  return { mark, number: Number.isInteger(number) && number >= 1 && number <= SPIRIT_TALES.length ? number : null };
}

// Whom the held tale is told at: a tale that heals goes to a friend (the bard
// too), any other to a foe; a tale not yet drawn (a mark laid by hand) to a foe,
// as most of the table is.
export function taleAimsAt(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">): "ally" | "enemy" {
  const number = heldTale(sheet)?.number ?? null;
  return number !== null && SPIRIT_TALES[number - 1]?.helps ? "ally" : "enemy";
}
