// What the mystery, post-apocalyptic and steampunk casters' features add to a
// damaging spell once it has struck a creature (WAVE2 D5: the genre text is the
// rule). Every spell such a class casts is one of its formulae, sermons, tech
// effects or arts, as The Word Made Iron reads a sermon
// (src/lib/srd/authored-effects-genre-b.ts):
//
//   Corrosive Focus (alchemist)      1/turn, +1d6 acid
//   Judgment (waste preacher)        1/turn, +1d8 radiant to one target
//   Blessed Isotope (salvage tech)   1/turn, +1d6 radiant
//   Dynamo Spark (aether channeler)  1/turn, the CHA modifier as lightning
//   Catalyst Stone (alchemist)       its spent stone: +1d4 (+1d8 with Improved
//                                    Catalyst) of the spell's own type, once
//   Volatile Chain (alchemist)       one creature beside the target takes the
//                                    INT modifier in the spell's type
//   Chain Arc (aether channeler)     its spent arc: a lightning spell jumps to a
//                                    second creature within 15 ft for half
//   Etching Acid (alchemist)         acid that lands takes 1 off the creature's
//                                    AC until the alchemist's next turn, not
//                                    cumulative; Universal Solvent stacks it to -3
//   Overcharge (aether channeler)    its spent charge: the spell's dice at their
//                                    maximum (genreBSpellAtMaximum), 1d10
//                                    lightning back on the channeler
//
// landSpellDamage (src/lib/dm/cast-at-enemy-damage.ts) calls these for every
// creature a cast_at_enemy spell damages, and attack-blow.ts for a spell attack
// pc_attack lands, so a spell card, a console cast and the model's call land
// the same dice. Overcharge's maximum is the save spell's (landSpellDamage); a
// spell attack's dice are rolled before its hit is known. A once-a-turn rider claims its key on
// the caster's turn budget; the first creature of one casting is the one it
// rides (a later creature of the same area takes the casting's one roll).
//
// A rider never strikes the caster's own side: Volatile Chain "may" splash, so
// it takes an enemy beside the target or nobody.
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, listEnemies, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { claimOncePerTurn } from "@/lib/dm/action-budget";
import { withinFeet } from "@/lib/dm/authored-saves";
import { removeConditions } from "@/lib/dm/condition-logic";
import { layEnemyConditionInstance } from "@/lib/dm/enemy-condition-lay";
import { applyEnemyDamage } from "@/lib/dm/enemy-damage";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { rollCard } from "@/lib/dm/roll-card";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { publishPersisted } from "@/lib/events";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const mod = (score: number | undefined) => Math.floor(((score ?? 10) - 10) / 2);

// The marks the counters' spends lay on the caster (genre-b-conditions.ts),
// each spent by the spell it changes.
export const OVERCHARGE_MARK = "overcharge";
export const CATALYST_MARK = "catalyst stone";
export const CHAIN_ARC_MARK = "chain arc";

// The etched conditions, by depth (genre-b-conditions.ts: -1, -2, -3 AC).
export const ETCHED = ["etched", "etched twice", "etched thrice"] as const;

type Rider = { feature: string; classId: string; dice: (sheet: CharacterSheet) => string; type: string | "spell" };

// The once-a-turn riders, each its own feature's.
const ONCE_A_TURN: Rider[] = [
  { feature: "Corrosive Focus", classId: "alchemist", dice: () => "1d6", type: "acid" },
  { feature: "Judgment", classId: "waste_preacher", dice: () => "1d8", type: "radiant" },
  { feature: "Blessed Isotope", classId: "salvage_tech", dice: () => "1d6", type: "radiant" },
  { feature: "Dynamo Spark", classId: "aether_channeler", dice: (sheet) => String(Math.max(0, mod(sheet.abilities?.cha))), type: "lightning" },
];

function holdsMark(sheet: CharacterSheet, mark: string): boolean {
  return sheet.conditions.some((entry) => isConditionNamed(entry, mark));
}

function spendMark(sheet: CharacterSheet, mark: string): CharacterSheet {
  const name = sheet.conditions.find((entry) => isConditionNamed(entry, mark));
  if (!name) {
    return sheet;
  }
  const left = removeConditions(sheet.conditions, sheet.conditionMeta, [name]);
  return patchSheet(sheet.id, { conditions: left.conditions, conditionMeta: left.meta }) ?? sheet;
}

// Overcharge: "a damaging art rolls maximum dice". Read before the dice roll.
export function genreBSpellAtMaximum(sheet: CharacterSheet): boolean {
  const fresh = getSheetById(sheet.id) ?? sheet;
  return holdsGenreFeature(fresh, "aether_channeler", "Overcharge") && holdsMark(fresh, OVERCHARGE_MARK);
}

// The turn's once-a-turn key for this caster's rider, claimed now; false when
// the caster already used it this turn. Off their own turn a caster casts with
// their one reaction, once a round at most, so the rider rides; with no fight
// there is no turn to count.
function claimOnce(campaignId: string, caster: CharacterSheet, feature: string): boolean {
  const encounter = getActiveEncounter(campaignId);
  const budget = budgetFor(encounter, caster.id, attacksAllowedFor(caster));
  if (!encounter || !budget) {
    return true;
  }
  const claimed = claimOncePerTurn(budget, `genre:${textKey(feature)}`);
  if (!claimed) {
    return false;
  }
  storeBudget(encounter, claimed);
  return true;
}

type Land = {
  campaign: Campaign;
  turn: DmTurn;
  encounter: Encounter;
  sheet: CharacterSheet;
  enemy: EncounterEnemy;
  damageType: string | undefined;
  // What the spell dealt this creature, after its save.
  dealt: number;
  // The first creature of the casting (no shared roll handed in).
  first: boolean;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
};

function strike(input: Land, target: EncounterEnemy, dice: string, type: string, label: string): number {
  // A flat number rolls no card (roll-card.ts returns it as it stands).
  const amount = rollCard(input.campaign, input.turn, input.sheet.id, "damage", `${label} on ${target.displayName}`, dice, { kind: "sheet", id: input.sheet.id, name: input.sheet.name }).total ?? 0;
  if (amount <= 0) {
    return 0;
  }
  const fresh = getEnemy(target.id) ?? target;
  if (fresh.currentHp <= 0) {
    return 0;
  }
  applyEnemyDamage(input.campaign, input.turn, getActiveEncounter(input.campaign.id) ?? input.encounter, fresh, amount, input.sheets, input.sheetsById, type || undefined, { magical: true, spell: true });
  return amount;
}

// Etching Acid: one step deeper (to -3 with Universal Solvent), else the -1
// laid again; until the alchemist's next turn either way.
function etch(input: Land, target: EncounterEnemy, caster: CharacterSheet): string | null {
  if (!holdsGenreFeature(caster, "alchemist", "Etching Acid")) {
    return null;
  }
  const fresh = getEnemy(target.id) ?? target;
  if (fresh.currentHp <= 0) {
    return null;
  }
  const depth = ETCHED.reduce((deepest, name, index) => (fresh.conditions.some((entry) => isConditionNamed(entry, name)) ? index + 1 : deepest), 0);
  const deepest = holdsGenreFeature(caster, "alchemist", "Universal Solvent") ? ETCHED.length : 1;
  const next = Math.min(deepest, depth + 1);
  const name = ETCHED[next - 1];
  for (const shallower of ETCHED.filter((entry) => entry !== name)) {
    if (fresh.conditions.some((entry) => isConditionNamed(entry, shallower))) {
      const left = removeConditions(fresh.conditions, fresh.conditionMeta, [shallower]);
      fresh.conditions = left.conditions;
      fresh.conditionMeta = left.meta as EncounterEnemy["conditionMeta"];
    }
  }
  layEnemyConditionInstance(input.campaign, fresh, name, { untilTurnOf: caster.id, source: caster.id });
  return `Etching Acid: ${fresh.displayName} is ${name}, ${next} off its AC until ${caster.name}'s next turn.`;
}

// After the spell's own damage landed on a creature: the riders, the splash,
// the jump, the etching and the backlash. The lines go on the cast's result.
export function genreBSpellLanded(input: Land): string[] {
  const lines: string[] = [];
  let caster = getSheetById(input.sheet.id) ?? input.sheet;
  if (input.dealt <= 0) {
    return lines;
  }
  const spellType = textKey(input.damageType ?? "");
  let acidLanded = spellType === "acid";
  for (const rider of ONCE_A_TURN) {
    if (!input.first || !holdsGenreFeature(caster, rider.classId, rider.feature)) {
      continue;
    }
    const dice = rider.dice(caster);
    if (dice === "0" || !claimOnce(input.campaign.id, caster, rider.feature)) {
      continue;
    }
    const dealt = strike(input, input.enemy, dice, rider.type, rider.feature);
    if (dealt > 0) {
      lines.push(`${rider.feature}: +${dealt} ${rider.type} (${dice}).`);
      acidLanded ||= rider.type === "acid";
    }
  }
  // Catalyst Stone: "add +1d4 to one formula's damage or healing"; Improved
  // Catalyst: "adds +1d8". The spent stone is used by this spell.
  if (input.first && holdsGenreFeature(caster, "alchemist", "Catalyst Stone") && holdsMark(caster, CATALYST_MARK)) {
    const dice = holdsGenreFeature(caster, "alchemist", "Improved Catalyst") ? "1d8" : "1d4";
    caster = spendMark(caster, CATALYST_MARK);
    const dealt = strike(input, input.enemy, dice, spellType, "Catalyst Stone");
    lines.push(`Catalyst Stone: +${dealt}${spellType ? ` ${spellType}` : ""} (${dice}).`);
  }
  // Volatile Chain: "one creature adjacent to the target takes your INT mod in
  // the same damage type".
  if (input.first && holdsGenreFeature(caster, "alchemist", "Volatile Chain") && mod(caster.abilities?.int) > 0) {
    const beside = besideTarget(input, 5);
    if (beside) {
      const dealt = strike(input, beside, String(mod(caster.abilities?.int)), spellType, "Volatile Chain");
      lines.push(`Volatile Chain: ${beside.displayName} beside it takes ${dealt}${spellType ? ` ${spellType}` : ""}.`);
    }
  }
  // Chain Arc: "a single-target lightning art jumps to a second target within
  // 15 ft for half damage".
  if (input.first && spellType === "lightning" && holdsGenreFeature(caster, "aether_channeler", "Chain Arc") && holdsMark(caster, CHAIN_ARC_MARK)) {
    const next = besideTarget(input, 15);
    if (next) {
      caster = spendMark(caster, CHAIN_ARC_MARK);
      const dealt = strike(input, next, String(Math.floor(input.dealt / 2)), "lightning", "Chain Arc");
      lines.push(`Chain Arc: the lightning jumps to ${next.displayName} for ${dealt}.`);
    }
  }
  if (acidLanded) {
    const etched = etch(input, input.enemy, caster);
    if (etched) {
      lines.push(etched);
    }
  }
  // Overcharge: "you take 1d10 lightning backlash", once the maximum landed.
  if (input.first && holdsGenreFeature(caster, "aether_channeler", "Overcharge") && holdsMark(caster, OVERCHARGE_MARK)) {
    caster = spendMark(caster, OVERCHARGE_MARK);
    const backlash = rollCard(input.campaign, input.turn, caster.id, "damage", "Overcharge backlash", "1d10", { kind: "sheet", id: caster.id, name: caster.name }).total ?? 0;
    const hurt = backlash > 0 ? applyPcDamage(input.campaign, input.turn.id, caster, { amount: backlash, type: "lightning", reason: "Overcharge backlash" }) : null;
    lines.push(`Overcharge: the art's dice were at their maximum; ${caster.name} takes ${backlash} lightning backlash${hurt && "hp" in hurt ? ` (${String(hurt.hp)})` : ""}.`);
  }
  return lines;
}

// The nearest other enemy within `feet` of the struck creature, never the
// caster's own side; off a board, any other standing enemy.
function besideTarget(input: Land, feet: number): EncounterEnemy | null {
  const encounter = getActiveEncounter(input.campaign.id) ?? input.encounter;
  return listEnemies(encounter.id)
    .filter((other) => other.id !== input.enemy.id && other.currentHp > 0)
    .find((other) => withinFeet(encounter.id, input.enemy.id, other.id, feet)) ?? null;
}

// After a healing spell's roll (src/lib/dm/heal-spell.ts): the Catalyst Stone
// whose die rode it is spent (its spell_rider rides while the mark is held),
// and Baptism of Ash: "When you heal a creature below half HP, it also gains
// +1 to attack rolls until your next turn". `wasBelowHalf`: before this heal.
export function genreBHealed(
  campaign: Campaign,
  caster: CharacterSheet,
  target: CharacterSheet,
  wasBelowHalf: boolean,
): string[] {
  const lines: string[] = [];
  const fresh = getSheetById(caster.id) ?? caster;
  if (holdsGenreFeature(fresh, "alchemist", "Catalyst Stone") && holdsMark(fresh, CATALYST_MARK)) {
    spendMark(fresh, CATALYST_MARK);
  }
  if (wasBelowHalf && holdsGenreFeature(fresh, "waste_preacher", "Baptism of Ash")) {
    const healed = getSheetById(target.id) ?? target;
    const name = BAPTISM_OF_ASH;
    const kept = healed.conditions.filter((entry) => !isConditionNamed(entry, name));
    const updated = patchSheet(healed.id, { conditions: [...kept, name], conditionMeta: { ...healed.conditionMeta, [name]: { untilTurnOf: fresh.id, source: fresh.id } } });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      lines.push(`Baptism of Ash: ${healed.name} has +1 to attack rolls until ${fresh.name}'s next turn`);
    }
  }
  return lines;
}

export const BAPTISM_OF_ASH = "baptism of ash";
