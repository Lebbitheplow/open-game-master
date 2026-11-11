// A College of Spirits bard's Tales from Beyond. The Spirit Tales table of
// the subclass's own book is not open content, so the table here is this
// server's own: twelve tales, each a thing the engine already resolves (a
// save against damage or a condition, or healing), with its numbers written
// in. "Expend one use of your Bardic Inspiration and roll on the Spirit Tales
// table using your Bardic Inspiration die ... You retain the tale in mind
// until you bestow the tale's effect or you finish a short or long rest ...
// you can use an action to choose one creature you can see within 30 feet of
// you (this can be you) ... rolling on the Spirit Tales table immediately ends
// the effect of the previous tale."
//
// use_resource "Tales from Beyond" rolls the die and keeps the tale as the
// condition "spirit tale" (its number in the meta), which a rest ends; use_resource "Release Tale"
// (authored-spend-effects.ts) plays the tale held on the creature named and
// lets it go.

import { rollCard } from "@/lib/dm/roll-card";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import { isConditionNamed, nameChoice } from "@/lib/srd/feature-names";

export const SPIRIT_TALE = "spirit tale";
const REACH = 30;

// The bard's Bardic Inspiration die at a bard level.
const dieAt = (level: number) => (level >= 15 ? "d12" : level >= 10 ? "d10" : level >= 5 ? "d8" : "d6");
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

// The Bardic Inspiration die rolled on the table.
export function drawTale(ctx: SpendContext): number {
  const die = dieAt(ctx.held.level);
  return Math.max(1, Math.min(SPIRIT_TALES.length, Number(rollCard(ctx.campaign, ctx.turn, ctx.sheet.id, "custom", `${ctx.sheet.name}: Tales from Beyond`, `1${die}`, null).total)));
}

// use_resource "Tales from Beyond": the die rolled, the tale kept (the one
// held before ends).
export function tellTale(ctx: SpendContext): ToolError | { patch: FullPatchSheetInput; result: Record<string, unknown> } {
  const { sheet } = ctx;
  const die = dieAt(ctx.held.level);
  const rolled = drawTale(ctx);
  const tale = SPIRIT_TALES[rolled - 1];
  const kept = sheet.conditions.filter((entry) => !isConditionNamed(entry, SPIRIT_TALE));
  const meta = Object.fromEntries(Object.entries(sheet.conditionMeta ?? {}).filter(([name]) => !isConditionNamed(name, SPIRIT_TALE)));
  return {
    patch: { conditions: [...kept, SPIRIT_TALE], conditionMeta: { ...meta, [SPIRIT_TALE]: { untilRestEnds: true, tale: rolled } } as FullPatchSheetInput["conditionMeta"] },
    result: {
      rolled,
      tale: `${tale.name} (${rolled} on the ${die}): ${tale.told}. use_resource "Release Tale" with an action plays it on one creature within 30 feet (${tale.helps ? "targetCharacterId, the bard by default" : "targetEnemyId"}); it is kept until then or a rest.`,
    },
  };
}
