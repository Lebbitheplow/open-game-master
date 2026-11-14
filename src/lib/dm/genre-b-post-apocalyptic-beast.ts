// The packmaster's beasts (src/lib/classes/post-apocalyptic-features.json), as
// allies on the board with the stats the text gives (WAVE2 D5: a companion the
// app does not model is a summoned creature with the text's numbers), made as
// the steel defender and the rigger's drones are (src/lib/dm/summon-defender.ts,
// genre-a's src/lib/dm/genre-a-summons.ts):
//
//   Bonded Beast     "AC 13 + your proficiency, HP 5 x level, attack 1d8 + WIS,
//                    obeys your commands"
//   War Beast        "attacks deal 2d8 + WIS, count as magical, and it gains +2 AC"
//   Twin Bond        "a second, smaller beast (AC 12 + your proficiency, HP 2 x
//                    level, attack 1d4 + WIS, speed 50 ft)"
//   Call the Wild    "summon 1d4 local beasts (wolf stats) to aid you for 10
//                    minutes"; The Pack Provides: 2d4
//   Shared Fury      "you and your beast each gain +2 to damage rolls for 1 minute"
//   Legend of the    "your beast grows monstrous for 1 minute: double HP, +10 ft
//     Pack           speed, attacks deal +2d8 and frighten (WIS save)"
//
// The text gives the beast no speed or ability scores: it walks 40 feet with a
// wolf's build, and its attack carries the packmaster's proficiency and Wisdom
// ("1d8 + WIS"), as the steel defender's rend carries the artificer's.
//
// "A loyal wasteland beast fights beside you": the beast is always the
// packmaster's, so it comes to the board whenever it is not on it, by the
// Bonded Beast call or by a spend that needs it (Legend of the Pack, Shared
// Fury). Out of a fight a new bond replaces the old, hale again. In a fight a
// beast already beside them is not bonded anew, and one that fell in this
// fight is not replaced until it is over. Call the Wild's wolves come in a
// fight or out of one.
//
// What the pair does once it stands on the board (advantage, the takedown,
// One Blood, Pack Endurance) is src/lib/dm/genre-b-post-apocalyptic-pack.ts.
import { randomUUID } from "node:crypto";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { rollCard } from "@/lib/dm/roll-card";
import { fightMarked, markFight } from "@/lib/dm/turn-marks";
import { summonRecord } from "@/lib/dm/summon-rules";
import { removeSummon, spawnSummons, summonsOf } from "@/lib/dm/summon-store";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { DmTurn } from "@/lib/db/dm-turns";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { LEGEND_OF_THE_PACK, SHARED_FURY } from "@/lib/srd/genre-b-post-apocalyptic-conditions";
import { findSummonForm, type SummonForm } from "@/lib/srd/summon-forms";

export type PackCall = "bonded" | "wild" | "fury" | "legend";

export const BONDED_BEAST = "Bonded Beast";
export const BONDED_SCOUT = "Bonded Scout";
const CALL_THE_WILD = "Call the Wild";
const PACKMASTER = "packmaster";

type Result = ToolError | { result: Record<string, unknown> };

// The beasts a packmaster's features bond, the first the one that fights.
export function bondedForms(sheet: CharacterSheet, level: number): SummonForm[] {
  const derived = computeSheetDerived(sheet);
  const wis = derived.abilityMods.wis;
  const pb = derived.proficiencyBonus;
  const war = holdsGenreFeature(sheet, PACKMASTER, "War Beast");
  const bite = (dice: string) => ({ name: "Bite", toHit: pb + wis, damage: `${dice}${wis >= 0 ? "+" : "-"}${Math.abs(wis)}`, type: "piercing" });
  const beast: SummonForm = {
    name: BONDED_BEAST,
    type: "beast",
    size: "Medium",
    cr: 0,
    ac: 13 + pb + (war ? 2 : 0),
    hp: Math.max(1, 5 * level),
    speed: 40,
    abilities: { str: 14, dex: 14, con: 14, int: 3, wis: 12, cha: 6 },
    attacks: [bite(war ? "2d8" : "1d8")],
    traits: `Obeys the packmaster's commands.${war ? " Magic Weapons: its attacks count as magical." : ""}`,
  };
  if (!holdsGenreFeature(sheet, PACKMASTER, "Twin Bond")) {
    return [beast];
  }
  const scout: SummonForm = {
    name: BONDED_SCOUT,
    type: "beast",
    size: "Small",
    cr: 0,
    ac: 12 + pb,
    hp: Math.max(1, 2 * level),
    speed: 50,
    abilities: { str: 8, dex: 16, con: 12, int: 3, wis: 14, cha: 6 },
    attacks: [bite("1d4")],
    traits: "Obeys the packmaster's commands. The packmaster sees through its senses within a mile.",
  };
  return [beast, scout];
}

// Whether this sheet is a beast a packmaster bonded (either of Twin Bond's two).
export function isBondedBeast(sheet: Pick<CharacterSheet, "summon">): boolean {
  return textKey(sheet.summon?.spell ?? "") === textKey(BONDED_BEAST);
}

// Twin Bond's second, smaller beast.
const isScout = (sheet: Pick<CharacterSheet, "summon">) => textKey(sheet.summon?.form ?? "") === textKey(BONDED_SCOUT);

// The packmaster's bonded beasts still standing, the fighting beast first.
export function bondedBeastsOf(campaignId: string, packmasterId: string): CharacterSheet[] {
  return listSheets(campaignId)
    .filter((sheet) => sheet.summon?.casterId === packmasterId && isBondedBeast(sheet))
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((sheet) => sheet.currentHp > 0 && !sheet.deathSaves?.dead)
    .sort((a, b) => Number(!isScout(b)) - Number(!isScout(a)));
}

// The packmaster a bonded beast answers to, while they hold the class.
export function packmasterOf(beast: Pick<CharacterSheet, "summon">): CharacterSheet | null {
  if (!isBondedBeast(beast) || !beast.summon?.casterId) {
    return null;
  }
  const master = getSheetById(beast.summon.casterId);
  return master && holdsGenreFeature(master, PACKMASTER, BONDED_BEAST) ? master : null;
}

const inFight = (campaignId: string) => {
  const encounter = getActiveEncounter(campaignId);
  return Boolean(encounter && encounter.status === "active" && (encounter.kind ?? "fight") === "fight");
};

const line = (form: SummonForm) => `${form.name}: ${form.hp} HP, AC ${form.ac}, speed ${form.speed} ft, ${form.attacks[0].name} +${form.attacks[0].toHit} (${form.attacks[0].damage} ${form.attacks[0].type})`;

const fellKey = (masterId: string) => `pack-fell:${masterId}`;

function bond(campaign: Campaign, sheet: CharacterSheet, level: number): Result {
  const fight = inFight(campaign.id) ? getActiveEncounter(campaign.id) : null;
  if (fight && bondedBeastsOf(campaign.id, sheet.id).length) {
    return { error: `${sheet.name}'s beast already fights beside them; a new bond is made outside a fight. Nothing was spent.`, refused: "rules" };
  }
  if (fight && fightMarked(fight.id, fellKey(sheet.id), "1")) {
    return { error: `${sheet.name}'s beast fell in this fight; it is bonded again once the fight is over. Nothing was spent.`, refused: "rules" };
  }
  const replaced = summonsOf(campaign.id, sheet.id, BONDED_BEAST);
  for (const old of replaced) {
    removeSummon(campaign, old);
  }
  const forms = bondedForms(sheet, level);
  const castId = randomUUID().slice(0, 8);
  const made: CharacterSheet[] = [];
  for (const form of forms) {
    const record = summonRecord(form, { spell: BONDED_BEAST, casterId: sheet.id, casterName: sheet.name, concentration: false, castId });
    made.push(...spawnSummons(campaign, sheet, { form, count: 1, record, rounds: null, slotLevel: null, initiative: "caster", overrides: { level: sheet.level } }));
  }
  return {
    result: {
      summoned: made.map((entry) => ({ characterId: entry.id, name: entry.name, hp: `${entry.currentHp}/${entry.maxHp}`, ac: entry.ac })),
      creature: forms.map(line).join("; "),
      ...(replaced.length ? { replaced: "The old bond is gone; one at a time." } : {}),
      note: `Allies on the board acting right after ${sheet.name}; each attacks with pc_attack under its own characterId.`,
    },
  };
}

function callTheWild(campaign: Campaign, turn: DmTurn | null, sheet: CharacterSheet): Result {
  const wolf = findSummonForm("Wolf");
  if (!wolf) {
    return { error: `The wolf's stat block is missing from the bestiary, so ${CALL_THE_WILD} has nothing to call. Nothing was spent.`, refused: "rules" };
  }
  // "summon 1d4 local beasts"; The Pack Provides: "Call the Wild summons 2d4 beasts".
  const dice = holdsGenreFeature(sheet, PACKMASTER, "The Pack Provides") ? "2d4" : "1d4";
  const count = Math.max(1, Number(rollCard(campaign, turn, sheet.id, "custom", `${CALL_THE_WILD}: how many beasts answer (${dice})`, dice, null).total) || 1);
  for (const old of summonsOf(campaign.id, sheet.id, CALL_THE_WILD)) {
    removeSummon(campaign, old);
  }
  const record = summonRecord(wolf, { spell: CALL_THE_WILD, casterId: sheet.id, casterName: sheet.name, concentration: false, castId: randomUUID().slice(0, 8) });
  // "for 10 minutes": a hundred rounds.
  const made = spawnSummons(campaign, sheet, { form: wolf, count, record, rounds: 100, slotLevel: null, initiative: "caster" });
  return {
    result: {
      rolled: `${dice}: ${count}`,
      summoned: made.map((entry) => ({ characterId: entry.id, name: entry.name, hp: `${entry.currentHp}/${entry.maxHp}`, ac: entry.ac })),
      note: `${count} ${count === 1 ? "wolf answers" : "wolves answer"} ${sheet.name} for 10 minutes, as allies on the board acting right after them; each attacks with pc_attack under its own characterId.`,
    },
  };
}

function lay(campaign: Campaign, target: CharacterSheet, condition: string, rounds: number, extra: Parameters<typeof patchSheet>[1] = {}) {
  const fresh = getSheetById(target.id) ?? target;
  const kept = fresh.conditions.filter((entry) => !isConditionNamed(entry, condition));
  const updated = patchSheet(fresh.id, { conditions: [...kept, condition], conditionMeta: { ...fresh.conditionMeta, [condition]: { rounds } }, ...extra });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// The packmaster's beasts on the board, brought to it when none stands there
// and one may come (see the head of this file).
function beside(campaign: Campaign, sheet: CharacterSheet, level: number): CharacterSheet[] {
  const there = bondedBeastsOf(campaign.id, sheet.id);
  if (there.length || "error" in bond(campaign, sheet, level)) {
    return there;
  }
  return bondedBeastsOf(campaign.id, sheet.id);
}

// "you and your beast each gain +2 to damage rolls for 1 minute".
function sharedFury(campaign: Campaign, sheet: CharacterSheet, level: number): Result {
  const beasts = beside(campaign, sheet, level);
  for (const one of [sheet, ...beasts]) {
    lay(campaign, one, SHARED_FURY, 10);
  }
  return { result: { applied: [`${[sheet, ...beasts].map((entry) => entry.name).join(" and ")}: +2 to weapon damage rolls for 1 minute.${beasts.length ? "" : ` ${sheet.name} has no bonded beast beside them to share it.`}`] } };
}

// "your beast grows monstrous for 1 minute: double HP, +10 ft speed, attacks
// deal +2d8 and frighten (WIS save)": the hit points it has and its maximum
// both double, and halve again when the minute ends (legendEnded).
function legend(campaign: Campaign, sheet: CharacterSheet, level: number): Result {
  const [beast] = beside(campaign, sheet, level);
  if (!beast) {
    return { error: `${sheet.name}'s beast fell in this fight, so Legend of the Pack has no beast to grow. Nothing was spent.`, refused: "rules" };
  }
  if (beast.conditions.some((entry) => isConditionNamed(entry, LEGEND_OF_THE_PACK))) {
    return { error: `${beast.name} is already grown monstrous. Nothing was spent.`, refused: "rules" };
  }
  lay(campaign, beast, LEGEND_OF_THE_PACK, 10, { maxHp: Math.min(500, beast.maxHp * 2), currentHp: Math.min(500, beast.currentHp * 2) });
  const grown = getSheetById(beast.id) ?? beast;
  return { result: { applied: [`${beast.name} grows monstrous for 1 minute: ${grown.currentHp}/${grown.maxHp} hit points, +10 ft speed, +2d8 on its attacks, and a creature it hits saves (WIS) or is frightened of it.`] } };
}

// The minute ran out (src/lib/dm/condition-tick.ts): the doubled hit points go.
export function legendEnded(campaign: Campaign, sheet: CharacterSheet, expired: string[]): string | null {
  if (!isBondedBeast(sheet) || !expired.some((name) => isConditionNamed(name, LEGEND_OF_THE_PACK))) {
    return null;
  }
  const maxHp = Math.max(1, Math.ceil(sheet.maxHp / 2));
  const updated = patchSheet(sheet.id, { maxHp, currentHp: Math.min(sheet.currentHp, maxHp) });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return `${sheet.name} shrinks back to its own size: ${Math.min(sheet.currentHp, maxHp)}/${maxHp} hit points.`;
}

// The spends (src/lib/dm/authored-spend-effects.ts, kind "pack"), each refusing
// before anything is paid.
export function packSpend(input: { campaign: Campaign; turn: DmTurn | null; sheet: CharacterSheet; level: number }, call: PackCall): Result {
  const { campaign, sheet } = input;
  switch (call) {
    case "bonded":
      return bond(campaign, sheet, input.level);
    case "wild":
      return callTheWild(campaign, input.turn, sheet);
    case "fury":
      return sharedFury(campaign, sheet, input.level);
    case "legend":
      return legend(campaign, sheet, input.level);
  }
}

// ---- what keeps the pair standing (the damage and healing paths ask here; this
// module imports no roll or damage engine, so they can) ----
//
//   Pack Endurance  "When your beast would drop to 0 HP, 1/long rest it drops to
//                   1 instead; the same holds for you while it lives": one use a
//                   long rest, the beast's or the packmaster's, whichever would
//                   fall first (src/lib/dm/pc-damage.ts, src/lib/dm/genre-b-drops.ts)
//   Mended Hide     "Your healing bonds may target your beast at double effect"
//                   (src/lib/dm/heal-spell.ts)

const PACK_ENDURANCE = "post_apocalyptic_pack_endurance";
type Uses = Record<string, { max: number; used: number }>;

// Pack Endurance, the beast's half: the blow that would drop it leaves it at 1
// hit point and spends the packmaster's use. Returns the note, or null.
export function packBeastHold(campaign: Campaign, beast: CharacterSheet): string | null {
  const master = packmasterOf(beast);
  const state = (master?.resources as Uses | undefined)?.[PACK_ENDURANCE];
  if (!master || !holdsGenreFeature(master, PACKMASTER, "Pack Endurance") || !state || state.used >= state.max) {
    // It falls: no beast is bonded again in this fight (bond, above).
    const fight = master && inFight(campaign.id) ? getActiveEncounter(campaign.id) : null;
    if (fight && master) {
      markFight(fight.id, fellKey(master.id), "1");
    }
    return null;
  }
  const held = patchSheet(beast.id, { currentHp: 1 });
  const spent = patchSheet(master.id, { resources: { ...(master.resources as Uses), [PACK_ENDURANCE]: { max: state.max, used: state.used + 1 } } });
  for (const sheet of [held, spent]) {
    if (sheet) {
      publishPersisted(campaign.id, "sheet_updated", { sheet });
    }
  }
  return `${beast.name} should have fallen, but ${master.name}'s Pack Endurance holds it at 1 HP. The use is spent until a long rest.`;
}

// Pack Endurance, the packmaster's half ("the same holds for you while it
// lives"), for src/lib/dm/genre-b-drops.ts: the counters after the spend.
export function packmasterHold(campaignId: string, sheet: CharacterSheet): { name: string; resources: Uses } | null {
  const state = (sheet.resources as Uses | undefined)?.[PACK_ENDURANCE];
  if (!holdsGenreFeature(sheet, PACKMASTER, "Pack Endurance") || !state || state.used >= state.max || !bondedBeastsOf(campaignId, sheet.id).length) {
    return null;
  }
  return { name: "Pack Endurance", resources: { ...(sheet.resources as Uses), [PACK_ENDURANCE]: { max: state.max, used: state.used + 1 } } };
}

// Mended Hide: a healing spell the packmaster casts on their own beast heals
// twice as much. Returns the rider's note, or null.
export function mendedHide(caster: CharacterSheet, target: CharacterSheet): string | null {
  if (!holdsGenreFeature(caster, PACKMASTER, "Mended Hide") || !isBondedBeast(target) || target.summon?.casterId !== caster.id) {
    return null;
  }
  return "Mended Hide: doubled on the bonded beast";
}
