// A saving throw the server rolls for somebody: the save an enemy's spell, a
// trap or an area effect forces on a character, and the save a creature
// makes against what a character does to it. One place, so every such save
// reads the same things a requested roll reads: the conditions that decide
// it outright, a paladin's aura, the lasting effects on saves, exhaustion,
// and an inspiration die, which is spent by the roll it is added to.
//
// request_roll (src/lib/dm/invoke-roll.ts), group_check and aoe_damage call
// in here; cast_at_player and cast_at_enemy are meant to.

import { beguilingBroken } from "@/lib/dm/mt-fb-arrow-riders";
import { takeCounteredSave } from "@/lib/dm/slayers-counter-mark";
import { spiritTotemRollAdvantage } from "@/lib/dm/spirit-totem";
import { landsStrideClaim } from "@/lib/dm/mt-srd-druid";
import { noteShift, takeSaveHelp, takeShift } from "@/lib/dm/chronal-shift";
import { takeFate } from "@/lib/dm/fate-turn";
import { recordInspiredSuccess, recordSave } from "@/lib/dm/last-save";
import { diehardSaveAdvantage, shieldMasterSaveBonus } from "@/lib/srd/feat-combat";
import { LUCK_SPEND } from "@/lib/dm/roll-riders";
import { spendLuckCounter } from "@/lib/srd/class-resources";
import { allocateSeq, getCampaignById, type Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { insertRoll } from "@/lib/db/rolls";
import { getSheetById } from "@/lib/db/sheets";
import { patchSheetAudited, type AuditActor } from "@/lib/dm/audited-patch";
import { currentTurnId } from "@/lib/dm/job-control";
import { d20Expression, rollExpression, type RollResult } from "@/lib/dice";
import { bardOfHeldDie, heldBardicDie, heldOwnLuckDie, holdsMoteDie, sidesOf, withBonusDie } from "@/lib/dm/after-roll-logic";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { saveModFor } from "@/lib/bestiary/enemy-numbers";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import { allySaveAura } from "@/lib/dm/aura";
import { allyInitiativeAura } from "@/lib/dm/divine-auras";
import { mergeAdvantage, removeConditions, rollDerivation } from "@/lib/dm/condition-logic";
import { effectOutcome, rollEffectExtras } from "@/lib/dm/effect-tools";
import { resolveRollExpression, type RollArgs } from "@/lib/dm/rolls";
import { listedAgainst, type SaveAgainst } from "@/lib/dm/roll-about";
import { isSheetFoe } from "@/lib/dm/combat-sides-logic";
import { INSPIRATION_SPEND, spendInspirationCounter } from "@/lib/dm/roll-riders";
import { inDirectSunlight } from "@/lib/dm/sunlight";
import { obscuredFor } from "@/lib/dm/zone-rules";
import { rollerLight } from "@/lib/dm/place-light";
import { helpGiver } from "@/lib/dm/help-logic";
import { hasSunlightSensitivity, holdsFeature } from "@/lib/srd/trait-rules";
import { getActiveBoard, getActiveEncounter, saveEncounter } from "@/lib/db/encounters";
import { fearAsRolled } from "@/lib/dm/attack-light";
import { coverFor, coverFromPoint } from "@/lib/dm/attack-spatial";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { spendResistance } from "@/lib/dm/legendary-logic";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { pcMoveBudget } from "@/lib/battlemap/view";
import { speedToTiles } from "@/lib/battlemap/movement";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { conditionRollRiders } from "@/lib/srd/condition-effects";
import { enemyExhaustion, hasTrait } from "@/lib/dm/monster-abilities";
import { authoredEnemySave } from "@/lib/dm/authored-saves";
import { exaltedAllyAdvantage } from "@/lib/dm/exalted-aura";
import { authoredSaveDieVs } from "@/lib/srd/authored-effects-more";
import { preyEscapeDie } from "@/lib/dm/prey-escape";
import { moteAfterRoll, moteOf } from "@/lib/dm/authored-mote";
import { unfailingDieKept } from "@/lib/dm/ar-wbf-bard-dice-logic";
import { rollCharacterD20 } from "@/lib/dm/character-roll";
import { bondRider, bondStamped } from "@/lib/dm/emboldening-bond";
import { BOND_SPEND } from "@/lib/dm/emboldening-bond-logic";
import { magicalStrengthSave } from "@/lib/dm/infusion-charges";

// Everything resolveRollExpression cannot read for itself, for one roll of
// one character: the aura over them (saves only), the lasting effects on
// this kind of roll, and the table's encumbrance rule.
export function rollExtrasFor(campaign: Campaign, sheet: CharacterSheet, kind: string) {
  const aura = kind === "saving_throw" ? allySaveAura(campaign.id, sheet) : null;
  // An ally's Aura of the Sentinel on initiative (divine-auras.ts): every
  // initiative roll comes through here, so the ally's bonus is read once.
  const sentinel = kind === "initiative" ? allyInitiativeAura(campaign.id, sheet) : null;
  // Exalted Champion's allies (exalted-aura.ts): advantage on Wisdom and death saves.
  const exalted = kind === "saving_throw" ? exaltedAllyAdvantage(campaign.id, sheet) : null;
  return {
    ...(aura ? { saveBonus: aura.bonus, saveNote: aura.note } : {}),
    ...(exalted ? { allyAdvantage: exalted } : {}),
    // A Spirit Totem's aura the roller stands in (spirit-totem.ts).
    ...(kind === "saving_throw" || kind === "skill_check" || kind === "ability_check" ? { totemAdvantage: spiritTotemRollAdvantage(campaign.id, sheet) } : {}),
    ...(sentinel ? { initiativeBonus: sentinel.bonus, initiativeNote: sentinel.note } : {}),
    ...rollEffectExtras(campaign.id, sheet.id, kind),
    encumbrance: campaign.gameSettings.variantRules.encumbrance,
    // Sunlight Sensitivity reads the board's sky (src/lib/dm/sunlight.ts).
    sunlight: hasSunlightSensitivity(sheet) && inDirectSunlight(campaign.id),
    // Standing in a fog cloud, a web, magical darkness (src/lib/dm/zone-rules.ts).
    obscured: obscuredFor(campaign.id, sheet.id),
    // The place's light off the board, for a check by sight (place-light.ts).
    light: kind === "skill_check" || kind === "ability_check" ? rollerLight(campaign.id, sheet) : null,
    // Who gave a held Help, for a tool check they must be trained in (help-logic.ts).
    helper: kind === "ability_check" ? helperOf(sheet) : null,
    // Supreme Sneak reads how far the rogue walked this turn.
    movedLittle: holdsFeature(sheet, "supreme sneak") ? movedLittle(campaign.id, sheet) : false,
    // Frightened's disadvantage on checks needs its source in sight, read
    // from the board (attack-light.ts fearAsRolled).
    fearOutOfSight:
      kind !== "saving_throw" &&
      fearAsRolled(getActiveBoard(campaign.id)?.id ?? null, sheet.id, sheet.conditions, sheet.conditionMeta).length < sheet.conditions.length,
    // Emboldening Bond's d4, once a turn, beside another bonded creature
    // (emboldening-bond.ts): a check, a save or initiative (a Dexterity check).
    bondDie: bondRider(campaign.id, sheet),
    // Supernatural Defense's 1d6 on a check to escape the prey's grapple
    // (prey-escape.ts); rolls.ts adds it to a check named against the hold.
    escapeDie: kind === "skill_check" || kind === "ability_check" ? preyEscapeDie(sheet) : null,
  };
}

// The proficiencies of the character whose Help this one holds.
function helperOf(sheet: CharacterSheet): Pick<CharacterSheet, "name" | "proficiencies"> | null {
  const giver = helpGiver(sheet);
  const helper = giver ? getSheetById(giver) : null;
  return helper ? { name: helper.name, proficiencies: helper.proficiencies } : null;
}

// No more than half their speed walked this turn, on the board; off it the
// character is taken at their word and moves slowly.
function movedLittle(campaignId: string, sheet: CharacterSheet): boolean {
  const encounter = getActiveEncounter(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!encounter || !map || !token) {
    return true;
  }
  const { speed } = pcMoveBudget(campaignId, encounter, map, sheet, token);
  return token.movedThisRound <= Math.floor(speedToTiles(speed) / 2);
}

// Clears what a roll spent: an inspiration die, a held Help, a one-shot
// rider. `spent` is resolveRollExpression's spendInspiration. `actor` is who
// threw the roll when the caller knows (the rolls route); otherwise a roll
// inside a GM turn is the GM's, and one outside every turn is the player's
// own, never counted as the AI's to correct (issue #622).
export function spendRollCarriers(campaignId: string, sheetId: string, spent: string | undefined, actor?: AuditActor) {
  if (!spent) {
    return;
  }
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return;
  }
  const { conditions, meta: cleared } = removeConditions(
    sheet.conditions,
    sheet.conditionMeta,
    spent.split("|"),
  );
  // Inspiration is a counter, not a condition (src/lib/dm/roll-riders.ts).
  const carriers = spent.split("|");
  // Emboldening Bond's die stamps its turn on the bond, which stays.
  const meta = bondStamped(campaignId, { conditions, conditionMeta: cleared }, carriers) ?? cleared;
  let resources = carriers.includes(INSPIRATION_SPEND) ? spendInspirationCounter(sheet.resources) : undefined;
  // A luck point is a counter too (Lucky).
  if (carriers.includes(LUCK_SPEND)) {
    resources = spendLuckCounter(resources ?? sheet.resources) ?? resources;
  }
  // Audited: unaudited, an undo of a death save or a save the clock rolled
  // brought the death state back but never the die it spent (issue #622).
  patchSheetAudited(campaignId, sheet.id, { conditions, conditionMeta: meta, ...(resources ? { resources } : {}) }, {
    kind: "use_resource",
    reason: "spent on a roll",
    delta: { resource: carriers.map(carrierWords).join(" and "), spent: 1 },
    actor: actor ?? (currentTurnId() ? "dm" : "player"),
  });
}

// A held Bardic Inspiration or Dark One's Own Luck die on a roll that cannot
// wait for its holder (a save the engine forces, a death save, a check rolled
// with its DC): the holder may decide once the d20 is rolled (SRD 5.1, Bardic
// Inspiration), so the die is added when the d20 falls short and could be
// carried over, as they would choose. Riding every such roll, it was spent on
// a natural 20 and on rolls it could not save. A roll with no DC cannot be
// judged, and a mote's die bursts at the throw (authored-mote.ts): both keep
// the die riding the roll as before.
export function heldDieWaits(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">, dc: number | null | undefined): boolean {
  return typeof dc === "number" && !holdsMoteDie(sheet);
}

// The roll with what the holder would add to it (heldDieWaits). `natural1`:
// a natural 1 fails whatever the total (a death save, an attack), so nothing
// is spent. `attack`: only Bardic Inspiration rides an attack roll; Dark One's
// Own Luck is for checks and saves.
export function settleHeldDie(campaignId: string, sheetId: string, outcome: RollResult, dc: number, natural1 = false, attack = false): RollResult {
  let settled = outcome;
  for (const held of attack ? [heldBardicDie] : [heldBardicDie, heldOwnLuckDie]) {
    if (settled.total >= dc || (natural1 && outcome.natural === 1)) {
      break;
    }
    const sheet = getSheetById(sheetId);
    const die = sheet ? held(sheet) : null;
    if (!die || settled.total + sidesOf(die.die) < dc) {
      continue;
    }
    const bard = held === heldBardicDie && sheet ? bardOfHeldDie(sheet) : null;
    settled = withBonusDie(settled, { sides: sidesOf(die.die), value: rollExpression(`1${die.die}`).total, kept: true });
    // Unfailing Inspiration: a die that left the roll short is kept.
    if (!sheet || !unfailingDieKept(sheet, die.condition, settled.total, dc)) {
      spendRollCarriers(campaignId, sheetId, die.condition);
    }
    // A Bardic Inspiration die that made the roll succeed (Infectious Inspiration).
    if (sheet && bard && settled.total >= dc) {
      recordInspiredSuccess(campaignId, { id: sheet.id, name: sheet.name }, bard, attack ? "attack" : "save or check");
    }
  }
  return settled;
}

// An attack roll's held Bardic Inspiration die (settleHeldDie): added only to
// a roll that misses `ac` and is no natural 1 or critical, when the die can
// lift it to a hit. The same object back when nothing was added.
export function settleAttackDie(campaignId: string, sheet: Pick<CharacterSheet, "id" | "conditions" | "conditionMeta">, outcome: RollResult, ac: number, critRange = 20): RollResult {
  const natural = outcome.natural ?? 0;
  if (!heldDieWaits(sheet, ac) || natural === 1 || natural >= critRange) {
    return outcome;
  }
  return settleHeldDie(campaignId, sheet.id, outcome, ac, true, true);
}

// What a spent carrier is called on the event log.
function carrierWords(carrier: string): string {
  return carrier === INSPIRATION_SPEND ? "Inspiration" : carrier === LUCK_SPEND ? "a luck point" : carrier === BOND_SPEND ? "Emboldening Bond's d4" : carrier;
}

export type ForcedSave = {
  success: boolean;
  // Null when a condition failed the save with no die rolled.
  total: number | null;
  autoFailed: boolean;
  notes: string[];
  // The kept d20 face, for the callers that read a natural roll.
  natural?: number;
  // The dice as rolled, for a caller that shows the save as its own card.
  result?: ReturnType<typeof rollExpression>;
  // A creature's Legendary Resistance turned the failure into a success.
  legendaryResistance?: boolean;
};

// Spends one of a legendary creature's resistances; false when it has none
// left (or none at all).
export function spendLegendaryResistance(campaignId: string, enemyId: string): boolean {
  const encounter = getActiveEncounter(campaignId);
  const pool = encounter?.legendary.pools[enemyId];
  const spent = pool ? spendResistance(pool) : null;
  if (!encounter || !spent) {
    return false;
  }
  encounter.legendary.pools[enemyId] = spent;
  saveEncounter(encounter);
  publishPersisted(campaignId, "encounter_updated", { encounter: activePublicEncounter(campaignId) });
  return true;
}

// The last save a legendary creature failed, kept so legendary_resist can
// turn exactly that failure into a success and undo what it did
// (src/lib/dm/legendary-tools.ts). The callers that settle the failure add
// what it cost (settleFailedSave).
function noteFailedSave(campaignId: string, enemyId: string, detail: string) {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter?.legendary.pools[enemyId]) {
    return;
  }
  encounter.legendary.failedSave = { enemyId, round: encounter.round, detail: detail.slice(0, 160) };
  saveEncounter(encounter);
}

// What the failed save just noted cost the creature: the conditions it laid
// (with the spell that laid them) and the hit points a success would have
// spared it.
export function settleFailedSave(
  campaignId: string,
  enemyId: string,
  cost: { conditions?: string[]; spell?: string; source?: string; refund?: number },
) {
  const encounter = getActiveEncounter(campaignId);
  const failed = encounter?.legendary.failedSave;
  if (!encounter || !failed || failed.enemyId !== enemyId || failed.resisted) {
    return;
  }
  encounter.legendary.failedSave = {
    ...failed,
    conditions: [...(failed.conditions ?? []), ...(cost.conditions ?? [])],
    ...(cost.spell ? { spell: cost.spell } : {}),
    ...(cost.source ? { source: cost.source } : {}),
    refund: (failed.refund ?? 0) + Math.max(0, cost.refund ?? 0),
  };
  saveEncounter(encounter);
}

// What a few saves add beyond the shared riders: Battle Caster's expertise
// die on a concentration save, Starry Form's floor under the d20.
export type SaveExtra = {
  die?: string;
  floor?: number;
  // Half (+2) or three-quarters (+5) cover between the save and the
  // effect's origin: "a +2 bonus to AC and Dexterity saving throws" (SRD
  // 5.1, Cover). Counts on a Dexterity save only.
  cover?: number;
  // Where the effect starts, for the board to measure that cover when the
  // caller has not: the creature it comes from (an attack's rider, a
  // cone's caster), or a square (a trap's dart wall).
  origin?: SaveOrigin;
};

export type SaveOrigin = { ref: string } | { at: { x: number; y: number } };

// The cover bonus a save takes: on a Dexterity save only (SRD 5.1, Cover),
// the caller's own reading or else the board's between the saver and the
// effect's origin ("against an attack or effect that originates on the
// opposite side of the cover"). Before this only a spell cast at one
// creature and an area counted it; an attack's rider, Prismatic Spray, a
// trap or a monk's Open Hand did not.
function saveCoverBonus(campaignId: string, saverRef: string, ability: SaveAbility, extra: { cover?: number; origin?: SaveOrigin } | undefined): number {
  if (ability !== "dex") {
    return 0;
  }
  if (extra?.cover !== undefined) {
    return Math.max(0, extra.cover);
  }
  const board = extra?.origin ? getActiveBoard(campaignId) : null;
  if (!extra?.origin || !board) {
    return 0;
  }
  return "ref" in extra.origin ? coverFor(board.id, extra.origin.ref, saverRef) : coverFromPoint(board.id, extra.origin.at, saverRef);
}

function coverNote(bonus: number): string[] {
  return bonus ? [`${bonus >= 5 ? "three-quarters" : "half"} cover: +${bonus} to the Dexterity save`] : [];
}

// A character's forced save, rolled, published as a dice card and recorded
// on the turn (when there is one: a save the clock or a damage hook rolls has
// none).
export function rollCharacterSave(
  campaign: Campaign,
  turn: DmTurn | null,
  stale: CharacterSheet,
  ability: SaveAbility,
  dc: number,
  detail: string,
  // What the save resists, for the traits keyed to it (src/lib/dm/roll-about.ts).
  resists?: SaveAgainst,
  // The creature forcing the save, for the features that answer it
  // (Supernatural Defense against the Monster Slayer's prey).
  from?: EncounterEnemy | null,
  // Advantage or disadvantage the engine itself has established (Mage
  // Slayer against an adjacent caster, Dungeon Delver against a trap).
  claim?: { advantage: "advantage" | "disadvantage"; reason: string } | null,
  // The effect targets this character alone (a spell cast at them, not an
  // area): Shield Master adds the shield's AC bonus to the Dexterity save.
  single?: boolean,
  extra?: SaveExtra,
): ForcedSave {
  const sheet = getSheetById(stale.id) ?? stale;
  // Slayer's Counter's attack hit at the stop before this save
  // (slayers-counter-mark.ts): it succeeds with no roll.
  if (from && takeCounteredSave(sheet.id, from.id)) {
    recordSave(campaign.id, sheet.id, ability, { id: from.id, name: from.displayName }, true, resists?.against, dc);
    return { success: true, total: null, autoFailed: false, notes: ["Slayer's Counter: the attack hit, so this save succeeds with no roll"] };
  }
  const shieldSave = single && ability === "dex" ? shieldMasterSaveBonus(sheet) : 0;
  const covered = saveCoverBonus(campaign.id, sheet.id, ability, extra);
  // Diehard: advantage against what would exhaust them.
  const diehard = diehardSaveAdvantage(sheet, resists?.against);
  // Land's Stride: advantage against Entangle and its kind (mt-srd-druid.ts).
  const claimed = claim ?? (diehard ? { advantage: "advantage" as const, reason: "Diehard: advantage against exhaustion" } : landsStrideClaim(sheet, detail));
  const waits = heldDieWaits(sheet, dc);
  const resolved = resolveRollExpression(
    {
      kind: "saving_throw",
      ability,
      dc,
      ...resists,
      // The creature forcing it, subtype and all, for what answers its
      // kind (Demon Armor's curse against a demon's spells and abilities).
      ...(from?.stats?.type ? { sourceType: from.stats.type } : {}),
      ...(claimed ? { advantage: claimed.advantage, advantageReason: claimed.reason } : {}),
    } as RollArgs,
    sheet,
    { ...rollExtrasFor(campaign, sheet, "saving_throw"), keepHeldDie: waits },
  );
  if ("error" in resolved) {
    return { success: false, total: null, autoFailed: true, notes: [resolved.error] };
  }
  if ("autoFail" in resolved) {
    return { success: false, total: null, autoFailed: true, notes: resolved.notes };
  }
  const mote = moteOf(sheet, resolved.spendInspiration);
  spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
  const versus = authoredSaveDieVs(sheet, sheet.id, from ? { conditions: from.conditions, meta: from.conditionMeta as Record<string, { source?: string }> } : null);
  const purpose = { roller: "hero" as const, kind: "save" as const, who: sheet.name };
  const expression = `${resolved.expression}${versus ? `+${versus.die}` : ""}${shieldSave ? `+${shieldSave}` : ""}${covered ? `+${covered}` : ""}${extra?.die ? `+${extra.die}` : ""}`;
  // A floor under the d20 (Starry Form's dragon: a 9 or lower counts as 10).
  const floored = (thrown: RollResult): RollResult =>
    extra?.floor && thrown.natural !== undefined && thrown.natural < extra.floor ? { ...thrown, total: thrown.total - thrown.natural + extra.floor } : thrown;
  // A held die is spent only where it carries the roll, so it is still
  // held for the second roll when it could not save the first.
  const settled = (thrown: RollResult) => (waits ? settleHeldDie(campaign.id, sheet.id, thrown, dc) : thrown);
  const throwSave = () => floored(rollExpression(expression, undefined, { purpose }));
  // The player's own save, though the engine forces it (WAVE1 R5: "A seat
  // on physical dice rolls its own saves, including saves the engine
  // forces"): on physical dice they roll it, a wizard holding a foretold
  // number may use it, and a failure waits on what they hold (Lucky, Bardic
  // Inspiration), all before the damage or the condition lands
  // (src/lib/dm/character-roll.ts).
  let outcome = rollCharacterD20(campaign, sheet, { kind: "saving_throw", tag: purpose, expression, detail: detail.slice(0, 200), dc, throwIt: throwSave, adjust: floored, settle: settled });
  // A Chronal Shift a watching wizard set on this save (chronal-shift.ts).
  const shiftedBy = takeShift(campaign.id, purpose, outcome.total >= dc);
  const shiftLine = shiftedBy ? `${shiftedBy}'s Chronal Shift: rolled again (${outcome.total} became ` : null;
  if (shiftedBy) {
    outcome = settled(throwSave());
    noteShift(campaign.id, `${shiftedBy} used Chronal Shift: ${sheet.name} rolled the save again, ${outcome.total} against DC ${dc}, and the new roll stands.`);
  }
  // Convergent Future or Bend Luck set on this save at the stop (fate-turn.ts).
  outcome = takeFate(campaign.id, purpose, sheet.name, outcome, dc)?.outcome ?? outcome;
  // Flash of Genius or Favored by the Gods set on this save at the stop.
  const helped = takeSaveHelp(campaign.id, purpose, sheet.name, outcome, dc);
  if (helped) {
    outcome = helped.outcome;
  }
  // A charge of an artificer's Armor of Magical Strength on a Strength save
  // it would fail (src/lib/dm/infusion-charges.ts).
  const strength = magicalStrengthSave(campaign, sheet, ability, outcome.total, dc);
  if (strength) {
    outcome = { ...outcome, total: outcome.total + strength.bonus };
  }
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "saving_throw",
    detail: detail.slice(0, 200),
    dc,
    result: outcome,
  });
  turn?.rollIds.push(roll.id);
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll,
    source: "digital",
  });
  const moteLine = moteAfterRoll(campaign, sheet, mote, "saving_throw", outcome);
  // A save forced by a creature is kept, made or failed, for what answers it
  // (Vigilant Rebuke a success, Slayer's Counter the forcing, Hellish Rebuke
  // the damage through it: src/lib/dm/last-save.ts).
  if (from) {
    recordSave(campaign.id, sheet.id, ability, { id: from.id, name: from.displayName }, outcome.total >= dc, resists?.against, dc);
  }
  return {
    success: outcome.total >= dc,
    total: outcome.total,
    autoFailed: false,
    ...(outcome.natural !== undefined ? { natural: outcome.natural } : {}),
    notes: [
      ...(resolved.conditionNotes ?? []),
      ...(versus ? [`${versus.feature}: +${versus.die} against its prey`] : []),
      ...(shieldSave ? [`Shield Master: +${shieldSave} (the shield) on a Dexterity save against an effect that targets only them`] : []),
      ...coverNote(covered),
      ...(moteLine ? [moteLine] : []),
      ...(strength ? [strength.note] : []),
      ...(shiftLine ? [`${shiftLine}${outcome.total})`] : []),
      ...(helped ? [helped.line] : []),
    ],
  };
}

// Black Flag prints resistance to a condition (advantage on a save against
// it) and, for a giant's prone, vulnerability (disadvantage). The lean a
// save against these conditions gets.
export function conditionSaveLean(
  stats: { conditionResist?: string; conditionVulnerable?: string },
  against: string | string[] | undefined,
): Array<"advantage" | "disadvantage"> {
  const wanted = (Array.isArray(against) ? against : against ? [against] : []).map((name) => name.trim().toLowerCase().replace(/\s+\d+$/, "")).filter(Boolean);
  if (!wanted.length) {
    return [];
  }
  const listed = (line: string | undefined) => (line ?? "").toLowerCase().split(/\s*,\s*/).filter(Boolean);
  const resisted = listed(stats.conditionResist);
  const vulnerable = listed(stats.conditionVulnerable);
  return [
    ...(wanted.some((name) => resisted.includes(name)) ? ["advantage" as const] : []),
    ...(wanted.some((name) => vulnerable.includes(name)) ? ["disadvantage" as const] : []),
  ];
}

// A creature's save from its stat block, with its conditions honoured: a
// paralyzed, stunned, unconscious or petrified creature fails Strength and
// Dexterity saves with no die rolled, a restrained one rolls Dexterity saves
// at disadvantage, and a lasting effect on its saves counts. Rolled
// silently, as enemy saves are; the caller reports the result.
export function rollEnemySave(
  campaignId: string,
  enemy: EncounterEnemy,
  ability: SaveAbility,
  dc: number,
  // The save is against a spell or another magical effect, which Magic
  // Resistance answers with advantage (SRD 5.1). `advantage` and
  // `disadvantage` are the spell's own say (Charm Person in a fight, Blight
  // on a plant). `record` keeps the roll as a row only the DM sees, so an
  // enemy's save is on the record like every other roll.
  options: {
    magical?: boolean;
    // Against a Channel Divinity option (Elder Champion's disadvantage, authored-saves.ts).
    channel?: boolean;
    advantage?: boolean;
    disadvantage?: boolean;
    record?: { turn?: DmTurn; detail: string };
    // The failed save would bind the creature (a condition that takes its
    // turn, its movement or its mind): a creature with Legendary Resistance
    // spends one and succeeds instead, as a DM running it would
    // (src/lib/dm/legendary-tools.ts). A save that only halves damage is
    // left to the creature's choice (legendary_resist).
    resist?: boolean;
    // The conditions a failure lays, or the one the save ends: a block
    // resistant to one rolls with advantage, vulnerable to one with
    // disadvantage (Black Flag's condition resistances).
    against?: string | string[];
    // Cover between the creature and the effect's origin, or the origin
    // to measure it from (SaveExtra).
    cover?: number;
    origin?: SaveOrigin;
    // The damage the spell deals ("fire", "fire, radiant"), for a lean that
    // holds against some types only (Corona of Light, authored-saves.ts).
    damageType?: string;
  } = {},
): ForcedSave {
  // A Beguiling Arrow's charm ends when its ally forces the creature to save
  // ("or forces it to make a saving throw"): every save a character's effect
  // forces names that character as its origin.
  if (options.origin && "ref" in options.origin) {
    beguilingBroken(campaignId, options.origin.ref, enemy.id);
  }
  // A character fighting the party, seen as a foe (sheet-foe.ts), saves as
  // the character it is: proficiency, auras, Bless and its dice card.
  const asSheet = isSheetFoe(enemy) ? getSheetById(enemy.id) : null;
  const campaign = asSheet ? getCampaignById(campaignId) : null;
  if (asSheet && campaign) {
    const against = listedAgainst((Array.isArray(options.against) ? options.against[0] : options.against)?.trim().toLowerCase());
    return rollCharacterSave(
      campaign,
      options.record?.turn ?? null,
      asSheet,
      ability,
      dc,
      options.record?.detail ?? `${asSheet.name}: ${ability.toUpperCase()} save`,
      {
        ...(against ? { against } : {}),
        ...(options.magical ? { magical: true } : {}),
      },
      null,
      options.advantage ? { advantage: "advantage", reason: "the effect's own advantage" } : options.disadvantage ? { advantage: "disadvantage", reason: "the effect's own disadvantage" } : null,
      undefined,
      { ...(options.cover !== undefined ? { cover: options.cover } : {}), ...(options.origin ? { origin: options.origin } : {}) },
    );
  }
  const covered = saveCoverBonus(campaignId, enemy.id, ability, options);
  const derivation = rollDerivation(enemy.conditions, "saving_throw", ability);
  if (derivation.autoFail) {
    // Legendary Resistance answers a save failed outright as well.
    if (options.resist === true && spendLegendaryResistance(campaignId, enemy.id)) {
      return { success: true, total: null, autoFailed: false, legendaryResistance: true, notes: ["Legendary Resistance: the failed save becomes a success", ...derivation.notes] };
    }
    noteFailedSave(campaignId, enemy.id, options.record?.detail ?? `${ability.toUpperCase()} save`);
    return { success: false, total: null, autoFailed: true, notes: derivation.notes };
  }
  const effect = effectOutcome(campaignId, { kind: "enemy", id: enemy.id }, "save");
  // A spell a character left on the creature (Bane's d4 off, Bless's d4 on)
  // counts on its saves exactly as it would on a character's.
  const riders = conditionRollRiders(enemy.conditions, "save", ability);
  // Authored subclass features (Magical Ambush, Hound of Ill Omen, Unsettling Words): authored-saves.ts.
  const authored = authoredEnemySave(campaignId, enemy, { channel: options.channel, magical: options.magical, damageType: options.damageType });
  const resistsMagic = options.magical === true && hasTrait(enemy.stats, "magicResistance");
  const against = conditionSaveLean(enemy.stats, options.against);
  // Sunlight Weakness: its saves are at disadvantage in sunlight.
  const sunWeak = hasTrait(enemy.stats, "sunlightWeakness") && inDirectSunlight(campaignId);
  const worn = enemyExhaustion(enemy.conditions) >= 3;
  const advantage = mergeAdvantage([
    ...(worn ? ["disadvantage" as const] : []),
    ...derivation.sources,
    ...(effect.advantage ? ["advantage" as const] : []),
    ...(effect.disadvantage ? ["disadvantage" as const] : []),
    ...(resistsMagic ? ["advantage" as const] : []),
    ...against,
    ...(sunWeak ? ["disadvantage" as const] : []),
    ...(options.advantage ? ["advantage" as const] : []),
    ...(options.disadvantage ? ["disadvantage" as const] : []),
    ...riders.advantageSources,
    ...authored.sources,
  ]);
  const purpose = { roller: "enemy" as const, kind: "save" as const, who: enemy.displayName };
  const expression = `${d20Expression(saveModFor(enemy.stats, ability) + effect.bonus + covered, advantage)}${riders.diceSuffix}`;
  let outcome = rollExpression(expression, undefined, { purpose });
  // A Chronal Shift a watching wizard set on this save (chronal-shift.ts):
  // a success is rolled again, and the second roll stands. Legendary
  // Resistance may still answer the failure that follows.
  const shiftedBy = takeShift(campaignId, purpose, outcome.total >= dc);
  const firstTotal = outcome.total;
  if (shiftedBy) {
    outcome = rollExpression(expression, undefined, { purpose });
    noteShift(campaignId, `${shiftedBy} used Chronal Shift: ${enemy.displayName} rolled the save again, ${outcome.total} against DC ${dc}, and the new roll stands.`);
  }
  // Convergent Future or Bend Luck a watcher set on this save: a success made
  // one less than the Difficulty Class, or a d4 taken off it.
  outcome = takeFate(campaignId, purpose, enemy.displayName, outcome, dc)?.outcome ?? outcome;
  if (options.record) {
    const roll = insertRoll({
      campaignId,
      characterId: null,
      requestedBy: "dm",
      kind: "saving_throw",
      detail: options.record.detail.slice(0, 200),
      dc,
      ...(advantage === "none" ? {} : { advantage }),
      result: outcome,
      visibility: "dm",
    });
    options.record.turn?.rollIds.push(roll.id);
  }
  const made = outcome.total >= dc;
  const resisted = !made && options.resist === true && spendLegendaryResistance(campaignId, enemy.id);
  if (!made && !resisted) {
    noteFailedSave(campaignId, enemy.id, options.record?.detail ?? `${ability.toUpperCase()} save`);
  }
  return {
    success: made || resisted,
    total: outcome.total,
    autoFailed: false,
    result: outcome,
    ...(resisted ? { legendaryResistance: true } : {}),
    notes: [
      ...(resisted ? ["Legendary Resistance: the failed save becomes a success"] : []),
      ...derivation.notes,
      ...effect.sources,
      ...(resistsMagic ? ["Magic Resistance: advantage against magic"] : []),
      ...(worn ? ["exhaustion: disadvantage on saving throws"] : []),
      ...coverNote(covered),
      ...riders.notes,
      ...authored.notes,
      ...(shiftedBy ? [`${shiftedBy}'s Chronal Shift: rolled again (${firstTotal} became ${outcome.total})`] : []),
    ],
  };
}
