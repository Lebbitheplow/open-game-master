// use_reaction on an authored subclass feature (src/lib/srd/authored-effects-data*.ts,
// `reactions`), resolved by the engine the way Uncanny Dodge and Cutting Words
// are: a reaction to a hit re-resolves that attack from the engine's record of
// it (src/lib/dm/last-hit.ts) and gives back what the feature gives back
// (reaction-refund.ts); a reaction that strikes back rolls and lands its
// damage; a reaction attack is one pc_attack with the reaction. Only a holder
// of the feature (or, for Voice of Authority, Inspiring Surge, Protective Bond
// and Combat Inspiration, the ally it serves) takes it, and a refusal spends
// nothing.
//
// Before this every one of them fell to use_reaction's last branch: the
// reaction was spent and the effect was "resolved from its own text".

import { bothBonded, teleportBeside } from "@/lib/dm/protective-bond";
import { SOUL_TRINKET, gainTrinket } from "@/lib/dm/mt-mr-trinkets";
import { rollSurge } from "@/lib/dm/mt-fb-wild-surge";
import { beastFormRefusal, growBeastForm } from "@/lib/dm/mt-fb-beast";
import { answersRefusal, noteAnswer } from "@/lib/dm/mt-fb-surge";
import { landTurnedMiss, missedAttackOn, turnedMissRefusal } from "@/lib/dm/ar-ws-charm-miss";
import { deflectionAftermath, deflectionFirst } from "@/lib/dm/ar-ws-deflection";
import { pullStraightToward, pushStraightAway } from "@/lib/dm/ar-ws-storm-fury";
import { spendWrath, wrathApplies, WRATH_NOTE } from "@/lib/dm/destructive-wrath";
import { feetFromOwnZone } from "@/lib/dm/zone-reach";
import { maximumOf } from "@/lib/dm/heal-spell";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { getActiveEncounter, getEnemy, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import {
  authoredReactionNamed,
  gateHolds,
  heldAuthored,
  resolveFormula,
  type AuthoredReaction,
  type HeldAuthored,
} from "@/lib/srd/authored-effects";
import { addSheetCondition, rollCard } from "@/lib/dm/action-common";
import { pcResistances, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { meetEnemyPart } from "@/lib/dm/enemy-defenses";
import { scaledParts } from "@/lib/dm/enemy-hit";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { bindsWorthResisting } from "@/lib/dm/legendary-logic";
import { answerKey, answerLabel, answeredBy, attackerFoeId, carryCuts, critTurnsNormal, cutBlow, freshLastHit, openHits, plainOfReroll, rerollAttacker, type LastHit, type SwingRecord } from "@/lib/dm/last-hit";
import { vowedFoe } from "@/lib/srd/vow-of-enmity";
import { ENTROPIC_EDGE } from "@/lib/dm/reaction-kinds";
import { answerSave, kindOf, MENTAL, openSaves, openTriggers, recordTrigger, savedIt, type LastSave } from "@/lib/dm/last-save";
import { rollAgainst } from "@/lib/roll-labels";
import { applyPcDamage, blowDefenses, meetDefenses } from "@/lib/dm/pc-damage";
import { ownTurnOf } from "@/lib/dm/held-turn";
import { stopReaches } from "@/lib/dm/chronal-shift";
import { answerTriggers, openTriggersFor, triggerRefusal, triggerSpecOf, type TriggerAsk } from "@/lib/dm/reaction-triggers";
import { handlePcAttack } from "@/lib/dm/pc-attack";
import { allyOf, noHit, settle, SPENT, spendReaction, type Ctx } from "@/lib/dm/reaction-tools";
import { unseenRefusal, withinFeet } from "@/lib/dm/authored-saves";
import { reachAtLevel } from "@/lib/dm/reaction-kinds";
import { resolveMoreReaction } from "@/lib/dm/authored-reactions-more";
import { projectWard } from "@/lib/dm/arcane-ward";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { noneNamed, toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { swallowCoverError } from "@/lib/dm/swallow";
import { spentSlotRefusal } from "@/lib/dm/cast-rules";
import { reactionPatch } from "@/lib/dm/reaction-refund";
import { destroyEcho } from "@/lib/dm/mt-fb-echo";
import { raiseToCritical } from "@/lib/dm/critical-raise";
import { textKey } from "@/lib/language/text-logic";
import { isConditionNamed, holdsFeature } from "@/lib/srd/feature-names";
import { resourceName } from "@/lib/srd/class-resources";
import { blowLandsOn, redirectTaker } from "@/lib/dm/redirect-target";
import { layHeldCharm } from "@/lib/dm/mt-fb-runes";
import { laidBySave, openFailedSave, turnFailedSave } from "@/lib/dm/save-turned";
import type { Combatant } from "@/lib/dm/combatant";

type Found = { reaction: AuthoredReaction; held: HeldAuthored; holder: CharacterSheet; variant: string };

// The variant that declines a miss's attack (Glorious Defense's card offers it).
export const NO_ATTACK = "no attack";

// The authored reaction a use_reaction call names, for the character taking
// it: their own feature, or an ally's feature that serves them. The feature
// may carry its option after the name ("Raging Storm tundra").
function findReaction(ctx: Ctx): Found | null | ToolError {
  const asked = textKey(ctx.args.feature ?? "");
  const split = (name: string) => (asked === textKey(name) || asked.startsWith(`${textKey(name)} `) ? asked.slice(textKey(name).length).trim() : null);
  // A feature with one reaction per state (Raging Storm: the desert's, the
  // sea's) answers with the one whose gate holds now.
  let first: Found | null = null;
  for (const held of heldAuthored(ctx.sheet)) {
    for (const reaction of held.entry.reactions ?? []) {
      for (const name of [reaction.name, ...(reaction.aliases ?? [])]) {
        const variant = split(name);
        if (variant !== null && (reaction.usedBy ?? "holder") === "holder") {
          const found = { reaction, held, holder: ctx.sheet, variant };
          if (gateHolds(reaction.gate, ctx.sheet, held)) {
            return found;
          }
          first ??= found;
        }
      }
    }
  }
  if (first) {
    return first;
  }
  const named = authoredReactionNamed((ctx.args.feature ?? "").replace(/\s*\(.*$/, ""));
  if (!named) {
    return null;
  }
  if ((named.reaction.usedBy ?? "holder") === "holder") {
    return { error: `${ctx.sheet.name} does not have ${named.reaction.name}; only its holder takes that reaction. Nothing was spent.`, refused: "rules" };
  }
  // A reaction the feature gives an ally: someone at the table holds it.
  // Two at the table may hold it: the one whose turn this is did what the
  // reaction answers (the banneret who surged), and the first was asked alone.
  const acting = getActiveEncounter(ctx.campaign.id)?.turnBudget?.ownerId;
  const holders: Found[] = [];
  for (const stale of listSheets(ctx.campaign.id)) {
    const holder = getSheetById(stale.id) ?? stale;
    const held = heldAuthored(holder).find((entry) => entry.key === named.row.key);
    if (held && !holder.deathSaves?.dead) {
      holders.push({ reaction: named.reaction, held, holder, variant: "" });
    }
  }
  const serving = holders.find((entry) => entry.holder.id === acting) ?? holders[0];
  if (serving) {
    return serving;
  }
  return { error: `Nobody at the table has ${named.reaction.name}, so ${ctx.sheet.name} cannot answer with it. Nothing was spent.`, refused: "rules" };
}

function heaviest(swings: SwingRecord[], which: (swing: SwingRecord) => boolean = () => true): number {
  let best = -1;
  swings.forEach((swing, index) => {
    if (swing.hit && which(swing) && (best < 0 || swing.raw > swings[best].raw)) {
      best = index;
    }
  });
  return best;
}

// The critical as the normal hit it becomes: the same dice without the
// critical's, and whatever a reaction already took off it taken off this the
// same way (last-hit.ts carryCuts), or in proportion on a record that kept no
// cuts. The unconscious target's `ordinary` goes with the critical it read back.
function asNormalHit(swing: SwingRecord): SwingRecord {
  const normal = swing.normal;
  const raw = normal
    ? (carryCuts(swing, normal.raw, normal.from) ?? (normal.from > 0 ? Math.round((normal.raw * swing.raw) / normal.from) : 0))
    : swing.raw;
  return {
    ...swing,
    crit: false,
    raw,
    ...(normal?.type !== undefined ? { type: normal.type } : {}),
    parts: normal?.parts ? scaledParts(normal.parts, raw) : undefined,
    normal: undefined,
    ordinary: undefined,
    plain: undefined,
  };
}

// "A creature you can see": the one the hit fell on (authored `sees`), asked
// after the reach, which says more when both fail.
function unseenTarget(ctx: Ctx, found: Found, seen: CharacterSheet): ToolError | null {
  if ((found.reaction.sees !== "target" && found.reaction.sees !== "both") || seen.id === found.holder.id) return null;
  return unseenRefusal(ctx.encounter?.id, found.holder, seen, found.reaction.name);
}

// `anyDamage`: damage from no attack too (a spell's save, a hazard: last-hit.ts
// openEffect), for a reaction to damage taken whatever dealt it.
function lastHitOn(ctx: Ctx, target: CharacterSheet, label: string, which?: (hit: LastHit) => (swing: SwingRecord) => boolean, what?: string, anyDamage = false): { record: LastHit; index: number } | ToolError {
  // Of several open hits, the heaviest blow it can still answer.
  const record = freshLastHit(
    ctx.campaign.id,
    target.id,
    (hit) => (hit.source === "attack" || (anyDamage && hit.source === "effect")) && !answeredBy(hit, label) && heaviest(hit.swings, which?.(hit)) >= 0,
    (hit) => hit.swings[heaviest(hit.swings, which?.(hit))]?.raw ?? -1,
  );
  const index = record ? heaviest(record.swings, which?.(record)) : -1;
  if (!record || index < 0) {
    return noHit(target.name, answerLabel(label), what);
  }
  return { record, index };
}

// One open hit on `covered` rolled again at disadvantage, and settled: a miss
// gives the hit points back, a hit that stands is answered all the same. What
// goes through here: every reaction that lays disadvantage on an attack roll
// already made (the authored disadv_vs_hit rows; the steel defender's Deflect
// Attack, summon-reactions.ts), so the kept die, a critical that no longer is
// one and the refund are worked out in one place.
export function rollHitAgainAtDisadvantage(
  ctx: Ctx,
  covered: CharacterSheet,
  name: string,
  label: string,
  options: { notVsAdvantage?: boolean; unseen?: (record: LastHit) => ToolError | null } = {},
): { applied: string; missed: boolean; record: LastHit } | ToolError {
  const hit = lastHitOn(ctx, covered, label);
  if ("error" in hit) return hit;
  const swing = hit.record.swings[hit.index];
  if (swing.natural === null) {
    return { error: `${name} answers an attack roll, and this hit had none on record. Nothing was spent.`, refused: "rules" };
  }
  const unseen = options.unseen?.(hit.record) ?? null;
  if (unseen) return unseen;
  // Shadowy Dodge: only against an attack roll made without advantage.
  if (options.notVsAdvantage && swing.advantage === "advantage") {
    return { error: `${name} answers an attack roll made without advantage, and this one had advantage. Nothing was spent.`, refused: "rules" };
  }
  const kept =
    swing.advantage === "disadvantage"
      ? swing.natural
      : swing.advantage === "advantage"
        ? (swing.faces[0] ?? swing.natural)
        : Math.min(swing.natural, rollCard(ctx.campaign, ctx.turn, null, "attack", rollAgainst(`${swing.attack ?? hit.record.attack} again, at disadvantage (${name})`, ctx.sheet.name), "1d20", rerollAttacker(hit.record)).total);
  const total = swing.total - swing.natural + kept;
  const missed = kept !== 20 && (kept === 1 || total < swing.vsAc);
  if (!missed) {
    // Answered all the same: the reaction is spent on it. A critical the
    // kept die no longer makes lands as an ordinary hit (plainOfReroll).
    const plain = plainOfReroll(swing, kept);
    const settled = settle(ctx, hit.record, hit.record.swings.map((entry, at) => (at === hit.index ? plain : entry)), label);
    return {
      missed: false,
      record: hit.record,
      applied: plain === swing
        ? `Rolled again at disadvantage: ${total} against AC ${swing.vsAc} still hits.`
        : `Rolled again at disadvantage: ${total} against AC ${swing.vsAc} still hits, no longer a critical: ${settled.given} hit points come back. HP ${settled.hp}.`,
    };
  }
  const settled = settle(ctx, hit.record, hit.record.swings.map((entry, at) => (at === hit.index ? { ...entry, hit: false, raw: 0 } : entry)), label);
  return { missed: true, record: hit.record, applied: `Rolled again at disadvantage: ${total} against AC ${swing.vsAc} misses, and ${settled.given} hit points come back. HP ${settled.hp}.` };
}

function modsOf(sheet: CharacterSheet) {
  return computeSheetDerived(sheet).abilityMods;
}

function saveDc(holder: CharacterSheet, ability: string): number {
  const derived = computeSheetDerived(holder);
  if (ability === "spell") {
    return derived.spellSaveDc ?? 8 + derived.proficiencyBonus + Math.max(derived.abilityMods.int, derived.abilityMods.wis, derived.abilityMods.cha);
  }
  return 8 + derived.proficiencyBonus + (derived.abilityMods[ability as keyof typeof derived.abilityMods] ?? 0);
}

// The creature a redirect turns the attack onto, or why there is none
// (redirect-target.ts).
function takerOf(ctx: Ctx, encounter: NonNullable<Ctx["encounter"]>, record: LastHit, reaction: string, closest: boolean): Combatant | ToolError {
  return redirectTaker({
    campaignId: ctx.campaign.id,
    encounter,
    holder: ctx.sheet,
    attackerId: attackerFoeId(record),
    attackerName: record.attacker.name,
    named: ctx.args.targetEnemyId ?? ctx.args.targetCharacterId ?? null,
    reaction,
    closest,
  });
}

function enemyTarget(ctx: Ctx, fallbackId: string | null): EncounterEnemy | null {
  const encounter = ctx.encounter;
  const ref = ctx.args.targetEnemyId ?? fallbackId;
  if (!encounter || !ref) {
    return null;
  }
  const enemy = resolveTargetFoe(encounter.campaignId, encounter, ref);
  return enemy && enemy.status === "alive" ? enemy : null;
}

// The attack a reaction's miss earns, against whoever made the attack. A hit
// already turned aside stays so, whatever becomes of this: out of reach it is
// reported, not refused.
function strikeAttacker(ctx: Ctx, name: string, record: LastHit): Record<string, unknown> {
  const foeId = attackerFoeId(record);
  const enemy = foeId ? enemyTarget({ ...ctx, args: { ...ctx.args, targetEnemyId: undefined } }, foeId) : null;
  if (!enemy) {
    return { attack: `${name} earns an attack, and the attacker is not there to take it.` };
  }
  const result = handlePcAttack(ctx.campaign, ctx.turn, JSON.stringify({ characterId: ctx.sheet.id, targetEnemyId: enemy.id }), ctx.sheets, ctx.sheetsById, new Set(), null, { reactionAttack: true });
  // The reaction and the use are already spent, whatever pc_attack's own refusal
  // says about the attack it did not make.
  return typeof result.error === "string" ? { attack: "No attack follows; the miss and the spent use stand.", attackRefused: result.error } : { attack: result };
}

// The damage type a strike back deals: its own, or with a second the holder
// may choose (Wrath of the Storm), the one named after the feature ("Wrath of
// the Storm thunder"), else whichever the creature's defenses let more of
// through, its own type on a tie.
function strikeType(ctx: Ctx, does: Extract<AuthoredReaction["does"], { kind: "strike_back" }>, variant: string, name: string, enemy: EncounterEnemy): string | ToolError {
  if (!does.orType) {
    return does.type;
  }
  const types = [does.type, does.orType];
  if (variant) {
    const named = types.find((type) => textKey(type) === variant);
    return named ?? noneNamed(`${name} deals`, variant, types.map((type) => `${name} ${type}`));
  }
  const through = (type: string) => meetEnemyPart(ctx.campaign.id, enemy, 16, type, { magical: true }).amount;
  return through(does.orType) > through(does.type) ? does.orType : does.type;
}

// Entropic Ward's miss: the warlock's next attack roll against the creature
// has advantage if made before the end of their next turn. The mark names the
// creature (`quarry`), lasts to the end of the warlock's next turn, and the
// attack against it spends it (authored-hooks.ts authoredAttackSituation).
function markEntropicEdge(ctx: Ctx, record: LastHit): string | null {
  const foe = attackerFoeId(record);
  if (!foe) {
    return null;
  }
  const now = getSheetById(ctx.sheet.id) ?? ctx.sheet;
  const kept = now.conditions.filter((entry) => textKey(entry) !== ENTROPIC_EDGE);
  const updated = patchSheet(now.id, {
    conditions: [...kept, ENTROPIC_EDGE],
    conditionMeta: { ...now.conditionMeta, [ENTROPIC_EDGE]: { quarry: foe, untilTurnEndOf: now.id, source: "Entropic Ward" } },
  });
  if (updated) {
    publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
  }
  return `${ctx.sheet.name}'s next attack roll against ${record.attacker.name} has advantage, if made before the end of their next turn.`;
}

// The save a reaction to a save answers: "you or a creature you can see
// within 30 feet of you succeeds on an Intelligence, a Wisdom, or a Charisma
// saving throw" (Vigilant Rebuke), from the saves the engine kept this turn
// (last-save.ts). The creature named picks among them. A save is answered only
// from the record: with none open the reaction is refused, as every other
// trigger-shaped one is (reaction-triggers.ts); it was once taken on the GM's
// word with any creature named, in a fight where nobody had saved.
function savedAgainst(ctx: Ctx, name: string, rangeFt: number | undefined): { save: LastSave } | ToolError {
  const named = ctx.args.targetEnemyId?.trim();
  const open = openSaves(ctx.campaign.id).filter((save) => savedIt(save) && MENTAL.has(save.ability));
  const near = open.filter(
    (save) => save.characterId === ctx.sheet.id || !ctx.encounter || !rangeFt || withinFeet(ctx.encounter.id, ctx.sheet.id, save.characterId, rangeFt),
  );
  const forcedBy = (save: LastSave) => {
    if (!named || !ctx.encounter) return true;
    return save.forcer.id === named || resolveTargetFoe(ctx.encounter.campaignId, ctx.encounter, named)?.id === save.forcer.id;
  };
  const save = near.filter(forcedBy).at(-1) ?? null;
  if (save) {
    return { save };
  }
  if (!open.length) {
    return { error: `${name} answers a successful INT, WIS or CHA save someone made against a creature, and the server has none on record this turn. Nothing was spent.`, refused: "rules" };
  }
  return { error: `${name} answers a successful INT, WIS or CHA save by ${ctx.sheet.name} or someone within ${rangeFt ?? 30} feet, and none open this turn was forced by ${named ? "that creature" : "a creature still in reach"}. Nothing was spent.`, refused: "rules" };
}

// The bond's other half (Reflexive Resistance for the drake): resistance to the
// damage the pet just took, so half of it comes back to the pet. Null when the
// reaction answers the holder's own hit instead. The thirty feet between the
// two are not measured: a pet has no place on the board (handed off).
function resistPetDamage(ctx: Ctx, name: string, types: string[], label: string): ToolResult | ToolError | null {
  // The pet named by petName, or by the variant its card sends.
  const named = (ctx.args.petName ?? ctx.args.variant ?? "").trim();
  const own = freshLastHit(ctx.campaign.id, ctx.sheet.id, (hit) => hit.source === "attack" && !answeredBy(hit, label));
  if (!named && own) return null;
  const record = openTriggers(ctx.campaign.id)
    .filter((entry) => kindOf(entry) === "pet_damage" && entry.characterId === ctx.sheet.id && !(entry.answered ?? []).includes(label) && (!named || textKey(entry.petName ?? "") === textKey(named)))
    .at(-1);
  if (!record) {
    return named ? { error: `${name} answers damage ${ctx.sheet.name}'s ${named} has just taken, and the server has none on record. Nothing was spent.`, refused: "rules" } : null;
  }
  const type = textKey(record.damage?.type ?? "");
  if (type && !types.includes(type)) {
    return { error: `${name} answers ${types.join(", ")} damage; the hit on ${record.petName} was ${type}. Nothing was spent.`, refused: "rules" };
  }
  const now = getSheetById(ctx.sheet.id) ?? ctx.sheet;
  const pet = (now.pets ?? []).find((entry) => textKey(entry.name) === textKey(record.petName ?? ""));
  if (!pet) {
    return { error: `${ctx.sheet.name}'s ${record.petName} is no longer with them. Nothing was spent.`, refused: "rules" };
  }
  // Resistance halves the damage, rounded down: what it took less that half comes back.
  const dealt = record.damage?.amount ?? 0;
  const back = dealt - Math.floor(dealt / 2);
  const hp = Math.min(pet.maxHp, pet.hp + back);
  reactionPatch(ctx.campaign, ctx.turn.id, now.id, { pets: now.pets.map((entry) => (entry === pet ? { ...entry, hp } : entry)) }, `${name}: ${pet.name} resists the damage`);
  answerSave(ctx.campaign.id, record.id, label);
  return { applied: `${pet.name} resists this ${type || "damage"}: ${hp - pet.hp} hit points come back. HP ${hp}/${pet.maxHp}.` };
}

function psionicDie(level: number): string {
  return level >= 17 ? "1d12" : level >= 11 ? "1d10" : level >= 5 ? "1d8" : "1d6";
}

// The authored reaction this call names, resolved; null when the call names
// none of them and use_reaction's own branches decide.
export function authoredReaction(given: Ctx): ToolResult | null {
  let ctx = given;
  const found = findReaction(ctx);
  if (!found) {
    return null;
  }
  if ("error" in found) {
    return found;
  }
  const { reaction, held, holder } = found;
  if (!gateHolds(reaction.gate, holder, held)) {
    return { error: `${reaction.name} is not open to ${holder.name} right now (${reaction.gate?.raging ? "only while raging" : reaction.gate?.condition ? `only while ${reaction.gate.condition} holds` : "its condition is not met"}). Nothing was spent.`, refused: "rules" };
  }
  // A reaction whose trigger is not a hit answers the record of it
  // (reaction-triggers.ts): with nothing open it is refused before anything is
  // paid, and one that acts on the trigger's creature aims at it unless the
  // call names another open one.
  const ask: TriggerAsk = { campaignId: ctx.campaign.id, reactor: ctx.sheet, holder, name: reaction.name, gateCondition: reaction.gate?.condition, targetEnemyId: ctx.args.targetEnemyId, label: answerKey(textKey(reaction.name), ctx.sheet.id) };
  const unanswered = triggerRefusal(ask);
  if (unanswered) {
    return unanswered;
  }
  ctx = aimAtTrigger(ctx, ask);
  // The pool: a counter, or a spell slot of the level asked for.
  let paid: (() => void) | null = null;
  if (reaction.pool && "slot" in reaction.pool) {
    const level = ctx.args.level ?? 1;
    const slot = ctx.sheet.spellcasting?.slots?.[String(level)];
    if (!slot || slot.used >= slot.max) {
      return spentSlotRefusal(ctx.sheet.name, ctx.sheet.spellcasting, { level, lowest: 1, what: reaction.name, withPact: false });
    }
    paid = () => {
      const now = getSheetById(ctx.sheet.id) ?? ctx.sheet;
      const slots = { ...now.spellcasting!.slots, [String(level)]: { max: slot.max, used: slot.used + 1 } };
      // Audited, so "Revert this turn" gives the slot back with the reaction.
      reactionPatch(ctx.campaign, ctx.turn.id, now.id, { spellcasting: { ...now.spellcasting!, slots } }, `${reaction.name}: a level ${level} slot`);
    };
  } else if (reaction.pool) {
    const pool = reaction.pool;
    const state = holder.resources?.[pool.id];
    const amount = pool.amount ?? 1;
    if (!state || state.max - state.used < amount) {
      return { error: `${holder.name} has nothing left to spend on ${reaction.name} (${resourceName(pool.id)}). Nothing was spent.`, refused: "rules" };
    }
    paid = () => {
      const now = getSheetById(holder.id) ?? holder;
      const current = now.resources[pool.id];
      // Audited, so "Revert this turn" gives the use back with the reaction.
      reactionPatch(ctx.campaign, ctx.turn.id, now.id, { resources: { ...now.resources, [pool.id]: { max: current.max, used: current.used + amount } } }, `${reaction.name}: a use spent`);
    };
  }
  // The ally it covers and the creature it answers are both across no
  // swallower's wall (swallow.ts).
  const ally = allyOf(ctx);
  const walled =
    (ally ? swallowCoverError(ctx.sheet.id, ally.id) : null) ??
    (ctx.args.targetEnemyId ? swallowCoverError(ctx.sheet.id, ctx.args.targetEnemyId.trim()) : null);
  if (walled) {
    return walled;
  }
  const outcome = resolve(ctx, found);
  if ("error" in outcome) {
    return outcome;
  }
  answerTriggers({ ...ask, targetEnemyId: ctx.args.targetEnemyId });
  paid?.();
  spendReaction(ctx);
  // What Arcane Deflection leaves behind, whichever half was used (ar-ws-deflection.ts).
  const after = reaction.does.kind === "ac_vs_hit" && reaction.does.cantripsOnly ? deflectionAftermath(ctx, holder) : {};
  return { ok: true, reaction: reaction.name, spent: SPENT(ctx.sheet.name), ...outcome, ...after };
}

// The creature a trigger-shaped reaction acts on, when the call names none:
// the one the latest open trigger puts before it, if it is a living enemy.
function aimAtTrigger(ctx: Ctx, ask: TriggerAsk): Ctx {
  const spec = triggerSpecOf(ask);
  if (!spec?.aimsAt || ctx.args.targetEnemyId) return ctx;
  const creature = openTriggersFor(ask, spec).at(-1)?.creatureId;
  const enemy = creature ? getEnemy(creature) : null;
  return enemy && enemy.status === "alive" ? { ...ctx, args: { ...ctx.args, targetEnemyId: enemy.id } } : ctx;
}

function resolve(ctx: Ctx, found: Found): ToolResult | ToolError {
  const { reaction, held, holder } = found;
  const does = reaction.does;
  // Kept on the hit with its holder (last-hit.ts answerKey).
  const label = answerKey(textKey(reaction.name), holder.id);
  const encounter = ctx.encounter;
  switch (does.kind) {
    case "reduce": {
      const ally = allyOf(ctx);
      const target = does.who === "self" ? ctx.sheet : does.who === "ally" ? ally : (ally ?? ctx.sheet);
      if (!target || (does.who === "ally" && target.id === ctx.sheet.id)) {
        return { error: `${reaction.name} protects another creature: pass the ally's targetCharacterId. Nothing was spent.`, retry: true };
      }
      if (does.rangeFt && encounter && target.id !== ctx.sheet.id && !withinFeet(encounter.id, ctx.sheet.id, target.id, does.rangeFt)) {
        return { error: `${target.name} is beyond ${does.rangeFt} feet of ${ctx.sheet.name}. Nothing was spent.`, refused: "rules" };
      }
      // "An ally you can see" (Spirit Shield): a blinded holder shields nobody.
      const hidden = unseenTarget(ctx, found, target);
      if (hidden) return hidden;
      if (does.nearZone && encounter) {
        const feet = feetFromOwnZone(encounter, ctx.sheet.id, does.nearZone.spell, target.id);
        if (feet !== null && feet > does.nearZone.feet) {
          return { error: `${target.name} stands ${feet} feet from ${ctx.sheet.name}'s ${does.nearZone.spell}, beyond the ${does.nearZone.feet} feet ${reaction.name} reaches. Nothing was spent.`, refused: "rules" };
        }
      }
      // Deflect Energy: "reduces acid, cold, fire, force, lightning or thunder
      // damage you take", whatever dealt it. A row with its own types on its
      // holder alone answers damage of those types from no attack as well.
      const anyDamage = Boolean(does.types) && does.who === "self";
      const typed = anyDamage ? lastHitOn(ctx, target, label, (entry) => (swing) => does.types!.includes(textKey(swing.type ?? entry.type)), undefined, true) : null;
      const hit = typed && !("error" in typed) ? typed : lastHitOn(ctx, target, label, undefined, anyDamage ? `${does.types!.join(", ")} damage they took` : undefined);
      if ("error" in hit) return hit;
      const swing = hit.record.swings[hit.index];
      if (does.types && !does.types.includes(textKey(swing.type ?? hit.record.type))) {
        return { error: `${reaction.name} answers ${does.types.join(", ")} damage, and the hit on ${target.name} was ${swing.type ?? hit.record.type}. Nothing was spent.`, refused: "rules" };
      }
      let reduction: number;
      let rolled = "";
      if (does.amount === "half") {
        reduction = Math.ceil(swing.raw / 2);
      } else if (does.amount === "ward") {
        // Projected Ward: the Arcane Ward takes what it can hold (arcane-ward.ts).
        const held = projectWard(ctx.campaign, holder, swing.raw);
        if (!held) {
          return { error: `${holder.name}'s Arcane Ward has no hit points to give (it rises with an abjuration spell of 1st level or higher). Nothing was spent.`, refused: "rules" };
        }
        reduction = held;
      } else if (does.amount === "slot5") {
        reduction = 5 * (ctx.args.level ?? 1);
      } else {
        const expression = does.amount === "psionic_int" ? `${psionicDie(held.level)}+${modsOf(holder).int}` : resolveFormula(does.amount, held.level, modsOf(holder));
        reduction = Math.max(0, rollCard(ctx.campaign, ctx.turn, holder.id, "custom", `${holder.name}: ${reaction.name}`, expression, null).total);
        rolled = `${expression}: ${reduction}`;
      }
      const corrected = hit.record.swings.map((entry, at) => (at === hit.index ? cutBlow(entry, does.amount === "half" ? "half" : reduction) : entry));
      const settled = settle(ctx, hit.record, corrected, label);
      // Vengeful Ancestors: what Spirit Shield prevented strikes the attacker.
      const reflected: Record<string, unknown> = {};
      const prevented = Math.min(reduction, swing.raw);
      if (does.reflect && prevented > 0 && encounter && holder.features.some((feature) => textKey(feature.name) === textKey(does.reflect!.feature))) {
        const attacker = attackerFoeId(hit.record) !== null ? enemyTarget(ctx, hit.record.attacker.id) : null;
        if (attacker) {
          Object.assign(reflected, { [does.reflect.feature]: applyEnemyDamage(ctx.campaign, ctx.turn, encounter, attacker, prevented, ctx.sheets, ctx.sheetsById, does.reflect.type, { magical: true }) });
          publishEncounter(ctx.campaign.id);
        }
      }
      return { ...(rolled ? { rolled } : {}), applied: `${reaction.name} takes ${reduction} off the ${swing.attack ?? hit.record.attack} hit on ${target.name}: ${settled.given} hit points come back. HP ${settled.hp}.`, ...reflected };
    }
    // Unstable Backlash: the Wild Surge rolled again (mt-fb-wild-surge.ts).
    case "resurge": {
      const rolled = rollSurge({ campaign: ctx.campaign, turn: ctx.turn, sheet: ctx.sheet, args: { targetEnemyId: ctx.args.targetEnemyId } });
      return rolled ?? { error: `${ctx.sheet.name} has no Wild Surge to roll again while not raging. Nothing was spent.`, refused: "rules" };
    }
    case "ac_vs_hit": {
      // Arcane Deflection (ar-ws-deflection.ts): its shroud's named creatures are
      // held to its reach, and its other half answers a save just failed.
      const saved = does.orSave === undefined ? null : deflectionFirst(ctx, found.variant, reaction.name, does.orSave, label);
      if (saved) return saved;
      let bonus: number;
      let spentDie: string | null = null;
      if (does.amount === "bardic") {
        spentDie = ctx.sheet.conditions.find((entry) => /^bardic inspiration \(d\d+\)$/i.test(entry)) ?? null;
        if (!spentDie) {
          return { error: `${ctx.sheet.name} holds no Bardic Inspiration die to add to their AC. Nothing was spent.`, refused: "rules" };
        }
        const die = /\((d\d+)\)/i.exec(spentDie)![1];
        bonus = rollCard(ctx.campaign, ctx.turn, ctx.sheet.id, "custom", `${ctx.sheet.name}: ${reaction.name}`, `1${die}`, null).total;
      } else if (typeof does.amount === "number") {
        bonus = does.amount;
      } else if (typeof does.amount === "object") {
        // Rolled below, once the hit it answers is found.
        bonus = 0;
      } else {
        bonus = Math.max(1, modsOf(holder).cha ?? 0);
      }
      const tail = does.beastForm ? { feature: found.held.feature, weapon: { name: does.beastForm } } : null;
      const otherForm = tail ? beastFormRefusal(ctx.sheet, tail) : null;
      if (otherForm) {
        return { ...otherForm, error: otherForm.error.replace("Nothing was rolled.", "Nothing was spent.") };
      }
      const covered = does.rangeFt ? (allyOf(ctx) ?? ctx.sheet) : ctx.sheet;
      if (does.rangeFt && encounter && covered.id !== ctx.sheet.id && !withinFeet(encounter.id, ctx.sheet.id, covered.id, does.rangeFt)) {
        return { error: `${covered.name} is beyond ${does.rangeFt} feet of ${ctx.sheet.name}. Nothing was spent.`, refused: "rules" };
      }
      const hidden = unseenTarget(ctx, found, covered);
      if (hidden) return hidden;
      const hit = lastHitOn(ctx, covered, label);
      if ("error" in hit) return hit;
      const swing = hit.record.swings[hit.index];
      // "A creature you can see within 10 feet" (the tail of Form of the Beast).
      const striker = attackerFoeId(hit.record);
      if (does.attackerWithinFt && encounter && striker && !withinFeet(encounter.id, ctx.sheet.id, striker, does.attackerWithinFt)) {
        return { error: `${hit.record.attacker.name} is beyond ${does.attackerWithinFt} feet of ${ctx.sheet.name}; ${reaction.name} reaches no further. Nothing was spent.`, refused: "rules" };
      }
      const unseenStriker = does.attackerWithinFt && reaction.sees === "attacker" ? unseenRefusal(encounter?.id, ctx.sheet, hit.record.attacker, reaction.name) : null;
      if (unseenStriker) return unseenStriker;
      if (typeof does.amount === "object") {
        bonus = rollCard(ctx.campaign, ctx.turn, ctx.sheet.id, "custom", `${ctx.sheet.name}: ${reaction.name}`, does.amount.die, null).total;
      }
      growBeastForm(ctx.campaign.id, ctx.sheet.id, tail);
      const missed = swing.natural !== 20 && swing.total < swing.vsAc + bonus;
      if (spentDie) {
        const cleared = removeConditions(ctx.sheet.conditions, ctx.sheet.conditionMeta, [spentDie]);
        reactionPatch(ctx.campaign, ctx.turn.id, ctx.sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta }, `${reaction.name}: the Bardic Inspiration die spent`);
      }
      if (!missed) {
        return { applied: `AC ${swing.vsAc} + ${bonus} against ${swing.total}: the hit still lands.` };
      }
      const corrected = hit.record.swings.map((entry, at) => (at === hit.index ? { ...entry, hit: false, raw: 0 } : entry));
      const settled = settle(ctx, hit.record, corrected, label);
      // Glorious Defense: "a resulting miss lets you attack the attacker". The
      // attack is the paladin's choice (maintainer ruling R6,
      // /tmp/odm-gapstudy/WAVE1.md): made unless the call says "no attack".
      const declined = textKey(ctx.args.variant ?? "") === NO_ATTACK;
      const struck = does.strikeOnMiss ? (declined ? { attack: `${ctx.sheet.name} lets the attack pass.` } : strikeAttacker(ctx, reaction.name, hit.record)) : {};
      return { ...struck, applied: `AC ${swing.vsAc} + ${bonus} turns the ${swing.total} into a miss: ${settled.given} hit points come back. HP ${settled.hp}.` };
    }
    case "disadv_vs_hit": {
      const named = allyOf(ctx);
      const covered = named && (does.allyWith || does.anyAlly) ? named : ctx.sheet;
      if (covered.id !== ctx.sheet.id) {
        if (does.allyWith && !holdsFeature(ctx.sheet, does.allyWith)) {
          return { error: `${reaction.name} covers only ${ctx.sheet.name} until they hold ${does.allyWith}. Nothing was spent.`, refused: "rules" };
        }
        if (does.rangeFt && encounter && !withinFeet(encounter.id, ctx.sheet.id, covered.id, does.rangeFt)) {
          return { error: `${covered.name} is beyond ${does.rangeFt} feet of ${ctx.sheet.name}. Nothing was spent.`, refused: "rules" };
        }
        // Improved Flare: "a creature other than you that you can see".
        const hidden = unseenTarget(ctx, found, covered);
        if (hidden) return hidden;
      }
      // Warding Flare: "a creature ... that you can see" attacks (with
      // Improved Flare the ally it attacks is seen too, asked above).
      const again = rollHitAgainAtDisadvantage(ctx, covered, reaction.name, label, {
        notVsAdvantage: does.notVsAdvantage,
        unseen: (record) => (reaction.sees === "attacker" || reaction.sees === "both" ? unseenRefusal(encounter?.id, ctx.sheet, record.attacker, reaction.name) : null),
      });
      if ("error" in again) return again;
      const edge = again.missed && does.advantageOnMiss ? markEntropicEdge(ctx, again.record) : null;
      return { ...(edge ? { next: edge } : {}), applied: again.applied };
    }
    case "reroll_hit": {
      // Unnamed, a reaction that answers the roller answers the hit on its holder.
      const ally = allyOf(ctx) ?? (does.roller ? ctx.sheet : null);
      if (!ally || (ally.id === ctx.sheet.id && !does.roller)) {
        return { error: `${reaction.name} protects another creature: pass the ally's targetCharacterId. Nothing was spent.`, retry: true };
      }
      if (!does.roller && encounter && !withinFeet(encounter.id, ctx.sheet.id, ally.id, does.rangeFt)) {
        return { error: `${ally.name} is beyond ${does.rangeFt} feet of ${ctx.sheet.name}. Nothing was spent.`, refused: "rules" };
      }
      const hidden = does.roller ? null : unseenTarget(ctx, found, ally);
      if (hidden) return hidden;
      // Chronal Shift reaches the creature that rolled, wherever it hit: of the
      // hits open on the ally, one from an attacker in reach and in sight.
      const rollerRefusal = (record: LastHit): ToolError | null => {
        const foe = attackerFoeId(record);
        if (!does.roller || !encounter || !foe) return null;
        if (!withinFeet(encounter.id, ctx.sheet.id, foe, does.rangeFt)) {
          return { error: `${record.attacker.name} is beyond ${does.rangeFt} feet of ${ctx.sheet.name}, and ${reaction.name} answers a roll made within them. Nothing was spent.`, refused: "rules" };
        }
        return unseenRefusal(encounter.id, ctx.sheet, record.attacker, reaction.name);
      };
      const reachable = (record: LastHit) => (rollerRefusal(record) ? () => false : () => true);
      const hit = lastHitOn(ctx, ally, label, does.roller ? reachable : undefined);
      if ("error" in hit) {
        const open = does.roller ? lastHitOn(ctx, ally, label) : hit;
        return "error" in open ? hit : (rollerRefusal(open.record) ?? hit);
      }
      const swing = hit.record.swings[hit.index];
      if (swing.natural === null) {
        return { error: `${reaction.name} answers an attack roll, and this hit had none on record. Nothing was spent.`, refused: "rules" };
      }
      // One d20 in place of the die that counted, even from a roll with advantage:
      // the new roll is the one used, so the other die does not save the hit.
      const natural = rollCard(ctx.campaign, ctx.turn, null, "attack", rollAgainst(`${swing.attack ?? hit.record.attack} again (${reaction.name})`, ally.name), "1d20", rerollAttacker(hit.record)).total;
      const total = swing.total - swing.natural + natural;
      const lands = natural === 20 || (natural !== 1 && total >= swing.vsAc);
      if (!lands) {
        const settled = settle(ctx, hit.record, hit.record.swings.map((entry, at) => (at === hit.index ? { ...entry, hit: false, raw: 0 } : entry)), label);
        return { applied: `Rolled again: ${total} against AC ${swing.vsAc} misses ${ally.name}, and ${settled.given} hit points come back. HP ${settled.hp}.`, ...(settled.notes.length ? { notes: settled.notes } : {}) };
      }
      // The new roll goes on the record, so a later reaction (Shield, Cutting Words)
      // reads it and not the first. A critical the natural 20 alone made is lost
      // with it (plainOfReroll); a melee blow beside a downed ally stays one whatever
      // the die. A natural 20 gained makes the hit a critical, its dice rolled again
      // (critical-raise.ts), where the hit kept its roll; an older one is said, not raised.
      const raised = natural === 20 && !swing.crit ? raiseToCritical(ctx.campaign, ctx.turn, hit.record, swing, reaction.name) : null;
      const plain = raised ?? plainOfReroll(swing, natural);
      const settled = settle(ctx, hit.record, hit.record.swings.map((entry, at) => (at === hit.index ? { ...plain, total, natural, faces: [natural], advantage: "none" as const } : entry)), label);
      const critical = raised
        ? ` It is a natural 20, and the hit becomes a critical: ${Math.max(0, raised.raw - swing.raw)} more damage. HP ${settled.hp}.`
        : plain !== swing
          ? ` No longer a critical: ${settled.given} hit points come back. HP ${settled.hp}.`
          : natural === 20 && !swing.crit
            ? " It is a natural 20, and the hit is not raised to a critical: the damage already rolled stands."
            : swing.crit && natural !== 20
              ? " It stays a critical, and its damage stands."
              : "";
      return { applied: `Rolled again: ${total} against AC ${swing.vsAc} still hits ${ally.name}.${critical}`, ...(settled.notes.length ? { notes: settled.notes } : {}) };
    }
    case "resist_instance": {
      const target = allyOf(ctx) ?? ctx.sheet;
      if (does.bond && target.id !== ctx.sheet.id) {
        return { error: `${reaction.name} covers only ${ctx.sheet.name} and their ${does.bond}, not ${target.name}. Nothing was spent.`, refused: "rules" };
      }
      if (does.bond && !(ctx.sheet.pets ?? []).some((pet) => pet.kind === does.bond && pet.hp > 0)) {
        return { error: `${reaction.name} needs ${ctx.sheet.name}'s ${does.bond} up and out, and it is not: summon_pet first. Nothing was spent.`, refused: "rules" };
      }
      // A bond's range to the pet always holds: the pet stands with its owner
      // (pet-place.ts, ruling D2), so only an ally's distance is measured.
      if (encounter && target.id !== ctx.sheet.id && !withinFeet(encounter.id, ctx.sheet.id, target.id, does.rangeFt)) {
        return { error: `${target.name} is beyond ${does.rangeFt} feet of ${ctx.sheet.name}. Nothing was spent.`, refused: "rules" };
      }
      // "When you or your drake takes damage": the drake's, kept as its own
      // trigger (last-save.ts, pet-tools.ts), when the call names the pet or the
      // holder has no hit of their own open.
      if (does.bond) {
        const pet = resistPetDamage(ctx, reaction.name, does.types, label);
        if (pet) return pet;
      }
      const hit = lastHitOn(ctx, target, label);
      if ("error" in hit) return hit;
      const type = textKey(hit.record.swings[hit.index].type ?? hit.record.type);
      if (!does.types.includes(type)) {
        return { error: `${reaction.name} answers ${does.types.join(", ")} damage; the hit on ${target.name} was ${type || "untyped"}. Nothing was spent.`, refused: "rules" };
      }
      // Resistance does not stack: the reaction is taken, and changes nothing.
      if (pcResistances(target).includes(type)) {
        return { applied: `${target.name} already resists ${type} damage: ${reaction.name} changes nothing.` };
      }
      const corrected = hit.record.swings.map((entry) => (textKey(entry.type ?? hit.record.type) === type && entry.hit ? cutBlow(entry, "half") : entry));
      const settled = settle(ctx, hit.record, corrected, label);
      return { applied: `${target.name} resists this ${type} damage: ${settled.given} hit points come back. HP ${settled.hp}.` };
    }
    case "take_for_ally": {
      const ally = allyOf(ctx);
      if (!ally || ally.id === ctx.sheet.id) {
        return { error: `${reaction.name} takes the hit an ally took: pass the ally's targetCharacterId. Nothing was spent.`, retry: true };
      }
      const feet = reachAtLevel(does.rangeFt, held.level);
      if (encounter && !withinFeet(encounter.id, ctx.sheet.id, ally.id, feet)) {
        return { error: `${ally.name} is beyond ${feet} feet of ${ctx.sheet.name}. Nothing was spent.`, refused: "rules" };
      }
      // Only between two creatures the bond joins (protective-bond.ts).
      if (does.bond && !bothBonded(does.bond, getSheetById(ctx.sheet.id) ?? ctx.sheet, ally)) {
        return { error: `${reaction.name} passes a blow between two creatures of the ${does.bond}, and ${ctx.sheet.name} and ${ally.name} are not both bonded. Nothing was spent.`, refused: "rules" };
      }
      const record = freshLastHit(ctx.campaign.id, ally.id, (hit) => hit.source === "attack" && !answeredBy(hit, label) && hit.swings.some((swing) => swing.hit));
      if (!record) {
        return noHit(ally.name, reaction.name, `an attack that hit ${ally.name}`);
      }
      const raw = record.swings.filter((swing) => swing.hit).reduce((sum, swing) => sum + swing.raw, 0);
      // "split": the ally keeps half the blow; "halved": the holder takes
      // half and the ally none, as does a holder who resists it from
      // `resistFrom` (Expansive Bond); otherwise the holder takes it all.
      const share_ = does.share ?? (does.resistFrom && held.level >= does.resistFrom ? "halved" : undefined);
      const kept = share_ === "split" ? Math.ceil(raw / 2) : 0;
      const corrected = share_ === "split"
        ? record.swings.map((swing) => (swing.hit ? cutBlow(swing, "half_up") : swing))
        : record.swings.map((swing) => ({ ...swing, hit: false, raw: 0 }));
      const settled = settle(ctx, record, corrected, label);
      const share = share_ ? Math.floor(raw / 2) : raw;
      // The protector teleports beside the creature first (Protective Bond).
      const stepped = does.teleport ? teleportBeside(ctx.campaign.id, ctx.sheet.id, ally.id) : null;
      // The damage lands on the paladin as it was dealt: nothing reduces it.
      const taken = applyPcDamage(ctx.campaign, ctx.turn.id, getSheetById(ctx.sheet.id) ?? ctx.sheet, { amount: share, reason: `${reaction.name} for ${ally.name}` });
      return {
        applied: share_ === "split"
          ? `${ctx.sheet.name} takes ${share} of the ${raw} damage and ${ally.name} keeps ${kept}: ${settled.given} hit points come back to ${ally.name}.`
          : `${ctx.sheet.name} takes ${share === raw ? `the ${raw} damage` : `half of the ${raw} damage (${share})`} meant for ${ally.name}, whose ${settled.given} hit points come back.`,
        taken,
        ...(stepped ? { teleported: stepped } : {}),
      };
    }
    case "echo_hit": {
      const ally = allyOf(ctx);
      if (!ally || ally.id === ctx.sheet.id || !encounter) {
        return { error: `${reaction.name} answers a hit on another creature: pass that ally's targetCharacterId. Nothing was spent.`, retry: true };
      }
      // The reach is the attacker's ("an attacker within 30 feet of you deals
      // damage with an attack against a creature other than you"), checked
      // below; the creature it struck may stand anywhere.
      // The hit by the creature named, when one is: the heaviest hit on the ally
      // may be another attacker's, and it would take what this one is owed.
      const named = ctx.args.targetEnemyId;
      const nearest = lastHitOn(ctx, ally, label);
      if ("error" in nearest) return nearest;
      const byNamed = named && attackerFoeId(nearest.record) !== named ? freshLastHit(ctx.campaign.id, ally.id, (entry) => attackerFoeId(entry) === named) : null;
      if (named && attackerFoeId(nearest.record) !== named && !byNamed) {
        return noHit(ally.name, reaction.name, "an attack by that creature");
      }
      const hit = byNamed ? { record: byNamed, index: heaviest(byNamed.swings) } : nearest;
      const foeId = attackerFoeId(hit.record);
      const enemy = foeId ? enemyTarget({ ...ctx, args: { ...ctx.args, targetEnemyId: undefined } }, foeId) : null;
      if (!enemy) {
        return { error: `${reaction.name} answers the creature that struck ${ally.name}, and it is not in the fight. Nothing was spent.`, refused: "rules" };
      }
      if (!withinFeet(encounter.id, ctx.sheet.id, enemy.id, does.rangeFt)) {
        return { error: `${enemy.displayName} is beyond ${does.rangeFt} feet of ${ctx.sheet.name}. Nothing was spent.`, refused: "rules" };
      }
      // "Radiant damage equal to the damage it just dealt": what the blow took
      // off the ally once their resistances, immunities and vulnerabilities
      // met it, as the damage path met it (the replay's own reading,
      // reaction-refund.ts). The dice it rolled sent a resisted blow back
      // whole.
      const swing = hit.record.swings[hit.index];
      const before = { ...ally, conditions: hit.record.before.conditions, conditionMeta: hit.record.before.conditionMeta, wildShape: hit.record.before.wildShape ?? null };
      const defenses = blowDefenses(ctx.campaign.id, before, { ...(swing.flags ?? {}), ...(swing.resists?.length ? { resists: swing.resists } : {}) });
      const dealt = meetDefenses(defenses, swing.raw, (swing.type ?? hit.record.type) || undefined, swing.parts, 0).amount;
      if (dealt <= 0) {
        return { error: `${enemy.displayName}'s hit dealt ${ally.name} no damage to send back. Nothing was spent.`, refused: "rules" };
      }
      const dc = saveDc(holder, does.save.dcAbility);
      const save = rollEnemySave(ctx.campaign.id, enemy, does.save.ability, dc, {
        magical: true,
        origin: { ref: holder.id },
        record: { turn: ctx.turn, detail: `${enemy.displayName}: ${does.save.ability.toUpperCase()} save against ${reaction.name}` },
      });
      const amount = save.success ? Math.floor(dealt / 2) : dealt;
      const out: Record<string, unknown> = { dealt, save: `${save.total ?? "failed"} vs DC ${dc}`, amount };
      if (amount > 0) {
        Object.assign(out, applyEnemyDamage(ctx.campaign, ctx.turn, encounter, enemy, amount, ctx.sheets, ctx.sheetsById, does.type, { magical: true }));
        publishEncounter(ctx.campaign.id);
      }
      // The hit's swings stand; settling marks it answered, so its card goes.
      settle(ctx, hit.record, hit.record.swings, label);
      return out;
    }
    case "strike_back": {
      // Vigilant Rebuke answers a save, not a hit (savedAgainst).
      const saved = does.afterSave ? savedAgainst(ctx, reaction.name, does.rangeFt) : null;
      if (saved && "error" in saved) return saved;
      // The open hit by the creature named, when one is.
      const record = does.afterSave
        ? null
        : (freshLastHit(ctx.campaign.id, ctx.sheet.id, (hit) => hit.source !== "effect" && (!ctx.args.targetEnemyId || hit.attacker.id === ctx.args.targetEnemyId)) ?? freshLastHit(ctx.campaign.id, ctx.sheet.id));
      const enemy = enemyTarget(ctx, saved ? saved.save.forcer.id : attackerFoeId(record));
      if (!enemy || !encounter) {
        return { error: `${reaction.name} strikes a creature in the fight: pass targetEnemyId. Nothing was spent.`, retry: true };
      }
      if (does.melee && record && record.attacker.id !== enemy.id) {
        return { error: `${reaction.name} answers the creature whose melee attack just hit ${ctx.sheet.name}. Nothing was spent.`, refused: "rules" };
      }
      if (does.melee && (!record || record.ranged || !record.swings.some((swing) => swing.hit))) {
        return noHit(ctx.sheet.name, reaction.name, "a melee attack that hit them");
      }
      // An answer to a save reaches the creature that forced it wherever it
      // is; its reach is the one who saved (savedAgainst).
      if (does.rangeFt && !does.afterSave && !withinFeet(encounter.id, ctx.sheet.id, enemy.id, does.rangeFt)) {
        return { error: `${enemy.displayName} is beyond ${does.rangeFt} feet of ${ctx.sheet.name}. Nothing was spent.`, refused: "rules" };
      }
      // Halo of Spores: "a creature you can see" starting its turn near; the
      // creature struck back is the one that must be seen.
      const unseen = reaction.sees === "attacker" || reaction.sees === "both" ? unseenRefusal(encounter.id, ctx.sheet, { id: enemy.id, name: enemy.displayName }, reaction.name) : null;
      if (unseen) return unseen;
      const type = strikeType(ctx, does, found.variant, reaction.name, enemy);
      if (typeof type !== "string") {
        return type;
      }
      // A held Destructive Wrath takes the next lightning or thunder, this too.
      const wrath = wrathApplies(getSheetById(holder.id) ?? holder, type);
      if (wrath) {
        spendWrath(ctx.campaign.id, holder.id);
      }
      const formula = resolveFormula(does.amount, held.level, modsOf(holder));
      const expression = wrath ? String(maximumOf(formula)) : formula;
      let amount = rollCard(ctx.campaign, ctx.turn, holder.id, "damage", rollAgainst(reaction.name, enemy.displayName), expression, { kind: "sheet", id: holder.id, name: holder.name }).total;
      const out: Record<string, unknown> = { rolled: `${expression}: ${amount}`, ...(does.orType ? { type } : {}), ...(wrath ? { destructiveWrath: WRATH_NOTE } : {}) };
      if (does.save) {
        const dc = saveDc(holder, does.save.dcAbility);
        const save = rollEnemySave(ctx.campaign.id, enemy, does.save.ability, dc, {
          magical: true,
          // A DEX save takes the cover between the feature's holder and it.
          origin: { ref: holder.id },
          record: { turn: ctx.turn, detail: `${enemy.displayName}: ${does.save.ability.toUpperCase()} save against ${reaction.name}` },
        });
        out.save = `${save.total ?? "failed"} vs DC ${dc}`;
        if (save.success && !does.save.damageRegardless) {
          amount = does.save.half ? Math.floor(amount / 2) : 0;
        }
        if (!save.success && does.save.onFail) {
          out.onFail = `${enemy.displayName} ${does.save.onFail}.`;
        }
        if (!save.success && does.save.pushFeet) {
          out.pushed = pushStraightAway(ctx.campaign, encounter.id, holder, enemy, does.save.pushFeet);
        }
      }
      if (amount > 0) {
        Object.assign(out, applyEnemyDamage(ctx.campaign, ctx.turn, encounter, enemy, amount, ctx.sheets, ctx.sheetsById, type, { magical: true }));
        publishEncounter(ctx.campaign.id);
      }
      // A reaction to one melee hit answers that hit: its card goes, and a reaction
      // back at a later turn's start cannot answer it again.
      if (does.melee && record) {
        settle(ctx, record, record.swings, label);
      }
      if (saved) {
        answerSave(ctx.campaign.id, saved.save.id);
      }
      return out;
    }
    case "attack": {
      const enemy = enemyTarget(ctx, null);
      if (!enemy || !encounter) {
        return { error: `${reaction.name} is one weapon attack at a creature in the fight: pass targetEnemyId. Nothing was spent.`, retry: true };
      }
      if (does.vowed) {
        if (vowedFoe(ctx.sheet) !== enemy.id) {
          return { error: `${reaction.name} answers the creature under ${ctx.sheet.name}'s Vow of Enmity, and ${enemy.displayName} is not. Nothing was spent.`, refused: "rules" };
        }
        if (!ctx.sheets.some((sheet) => openHits(ctx.campaign.id, sheet.id).some((hit) => hit.attacker.id === enemy.id))) {
          return { error: `${reaction.name} answers ${enemy.displayName}'s attack, and the server has none on record. Nothing was spent.`, refused: "rules" };
        }
      }
      if (!does.weaponRange && !withinFeet(encounter.id, ctx.sheet.id, enemy.id, does.rangeFt)) {
        return { error: `${enemy.displayName} is beyond ${does.rangeFt} feet of ${ctx.sheet.name}; ${reaction.name} is a melee attack. Nothing was spent.`, refused: "rules" };
      }
      const crowded = does.answers ? answersRefusal(ctx.campaign.id, holder, reaction.name, Number(resolveFormula(does.answers, held.level))) : null;
      if (crowded) {
        return crowded;
      }
      // Each of these answers what another creature does (moves, attacks,
      // forces a save, is commanded) on that creature's turn or its holder's,
      // never on the reacting character's own: there it is refused, unless
      // the engine has seen the trigger itself (the vowed creature's attack).
      // A turn held while the enemies before it act is not yet the holder's own
      // (src/lib/dm/held-turn.ts): Hold the Line answers the goblins moving then.
      if (ownTurnOf(encounter, ctx.sheet.id) && !does.vowed) {
        return { error: `${reaction.name} answers what another creature does on its turn, and it is ${ctx.sheet.name}'s own turn. Nothing was spent.`, refused: "rules" };
      }
      // The attack is the reaction alone (pc-attack.ts reactionAttack). It
      // borrowed the readied condition, so on the holder's own turn it spent
      // their Action, and it took a readied action they already held.
      // Slayer's Counter is made "immediately before" the save it answers:
      // the attack is made as its holder stood before that save failed, so
      // what the failure laid comes off for it, and goes back on if the
      // attack does not turn the save (save-turned.ts).
      // A ranger whose player can be asked takes it at the stop before the save
      // (foresight.ts slayersCounterStops, slayers-counter.ts), so nothing has
      // to be given back. The answer to a save already rolled is kept for a
      // seat no stop reaches (an agent's, a companion's, a player away).
      if (does.turnsSave && stopReaches(ctx.campaign.id, getSheetById(ctx.sheet.id) ?? ctx.sheet)) {
        return { error: `${reaction.name} is made before the save is rolled: the server stops for ${ctx.sheet.name}'s player when their prey forces a save on them. Nothing was spent.`, refused: "rules" };
      }
      const failedSave = does.turnsSave ? openFailedSave(ctx.campaign.id, ctx.sheet.id, enemy.id) : null;
      const bound = failedSave ? laidBySave(getSheetById(ctx.sheet.id) ?? ctx.sheet, failedSave) : { names: [], meta: {} };
      const rebind = () => {
        const now = bound.names.length ? getSheetById(ctx.sheet.id) : null;
        if (now) {
          reactionPatch(ctx.campaign, ctx.turn.id, now.id, { conditions: [...now.conditions, ...bound.names.filter((name) => !now.conditions.includes(name))], conditionMeta: { ...(now.conditionMeta as ConditionMetaMap), ...bound.meta } as typeof now.conditionMeta }, `${reaction.name}: the save stands`);
        }
      };
      if (bound.names.length) {
        const now = getSheetById(ctx.sheet.id) ?? ctx.sheet;
        const cleared = removeConditions(now.conditions, now.conditionMeta, bound.names);
        reactionPatch(ctx.campaign, ctx.turn.id, now.id, { conditions: cleared.conditions, conditionMeta: cleared.meta }, `${reaction.name}: made before the save`);
      }
      const result = handlePcAttack(ctx.campaign, ctx.turn, JSON.stringify({ characterId: ctx.sheet.id, targetEnemyId: enemy.id }), ctx.sheets, ctx.sheetsById, new Set(), null, { reactionAttack: true });
      if (typeof result.error === "string") {
        rebind();
        return toolError(result);
      }
      if (does.answers) {
        noteAnswer(ctx.campaign.id, holder, reaction.name, ctx.sheet.id);
      }
      if (does.onHitCondition && result.hit) {
        const fresh = getEnemy(enemy.id);
        // Not on a creature immune to it, a petrified one's poison included.
        if (fresh && fresh.status === "alive" && !immuneToCondition(fresh, does.onHitCondition.name)) {
          patchEnemyConditions(fresh.id, [...fresh.conditions, does.onHitCondition.name], {
            ...(fresh.conditionMeta as ConditionMetaMap),
            [does.onHitCondition.name]: { rounds: does.onHitCondition.rounds, source: ctx.sheet.id },
          } as typeof fresh.conditionMeta);
          publishEncounter(ctx.campaign.id);
        }
      }
      // Slayer's Counter: the attack comes before the save, and a hit makes
      // the save a success. The save has landed by now, so what its failure
      // alone cost is given back (save-turned.ts).
      if (does.turnsSave && result.hit) {
        return { attack: result, save: failedSave ? turnFailedSave(ctx.campaign, ctx.turn.id, failedSave, `${reaction.name}: the save succeeds`, bound.names).line : `${ctx.sheet.name}'s save against ${enemy.displayName} had already succeeded.` };
      }
      if (does.turnsSave) {
        rebind();
      }
      return { attack: result };
    }
    case "save_condition": {
      const record = freshLastHit(ctx.campaign.id, ctx.sheet.id, (hit) => hit.source !== "effect" && (!ctx.args.targetEnemyId || hit.attacker.id === ctx.args.targetEnemyId)) ?? freshLastHit(ctx.campaign.id, ctx.sheet.id);
      const enemy = enemyTarget(ctx, attackerFoeId(record));
      if (!enemy || !encounter) {
        return { error: `${reaction.name} answers a creature in the fight: pass targetEnemyId. Nothing was spent.`, retry: true };
      }
      // "A creature you can see" (the Stone Rune): asked of the one it charms.
      const unseenFoe = reaction.sees === "attacker" ? unseenRefusal(encounter.id, ctx.sheet, { id: enemy.id, name: enemy.displayName }, reaction.name) : null;
      if (unseenFoe) return unseenFoe;
      // A reaction with variants takes the one named whole after its name
      // ("Raging Storm tundra"); a miss is refused before anything rolls.
      const variants = Object.entries(does.variants ?? {});
      const chosen = variants.find(([key]) => textKey(key) === found.variant);
      if (variants.length && !chosen) {
        return noneNamed(`${reaction.name} has no variant called`, found.variant, variants.map(([key]) => `${reaction.name} ${key}`));
      }
      const condition = chosen?.[1] ?? does.condition;
      const dc = saveDc(holder, does.dcAbility);
      const save = rollEnemySave(ctx.campaign.id, enemy, does.save, dc, {
        magical: true,
        resist: bindsWorthResisting([condition]),
        against: condition,
        origin: { ref: ctx.sheet.id },
        record: { turn: ctx.turn, detail: `${enemy.displayName}: ${does.save.toUpperCase()} save against ${reaction.name}` },
      });
      if (save.success) {
        return { applied: `${enemy.displayName} resists (${does.save.toUpperCase()} ${save.total} vs DC ${dc}).` };
      }
      // Its own immunities, and a petrified creature's to poison.
      if (immuneToCondition(enemy, condition)) {
        return { applied: `${enemy.displayName} fails the ${does.save.toUpperCase()} save but cannot be ${condition}.` };
      }
      if (does.also || does.saveEnds) {
        return { applied: layHeldCharm(ctx, enemy, { names: [condition, ...(does.also ?? [])], rounds: does.rounds, saveEnds: does.saveEnds ? { ability: does.save, dc } : undefined }, `${enemy.displayName} fails the ${does.save.toUpperCase()} save (${save.total ?? "failed"} vs DC ${dc})`) };
      }
      patchEnemyConditions(enemy.id, [...enemy.conditions.filter((entry) => textKey(entry) !== condition), condition], {
        ...(enemy.conditionMeta as ConditionMetaMap),
        [condition]: { source: ctx.sheet.id, ...(does.rounds ? { rounds: does.rounds } : { untilTurnOf: ctx.sheet.id }) },
      } as typeof enemy.conditionMeta);
      publishEncounter(ctx.campaign.id);
      const failed: Record<string, unknown> = { applied: `${enemy.displayName} fails the ${does.save.toUpperCase()} save (${save.total ?? "failed"} vs DC ${dc}) and is ${condition}.` };
      if (does.pullFeet) {
        failed.pulled = pullStraightToward(ctx.campaign, encounter.id, ctx.sheet, enemy, does.pullFeet);
      }
      // The attack is part of this reaction (pc-attack.ts reactionAttack): it
      // spends no action, and a refusal of it leaves the pull standing.
      if (does.attackWithin && withinFeet(encounter.id, ctx.sheet.id, enemy.id, does.attackWithin)) {
        const result = handlePcAttack(ctx.campaign, ctx.turn, JSON.stringify({ characterId: ctx.sheet.id, targetEnemyId: enemy.id }), ctx.sheets, ctx.sheetsById, new Set(), null, { reactionAttack: true });
        Object.assign(failed, typeof result.error === "string" ? { attack: "No attack follows; the pull and the spent use stand.", attackRefused: result.error } : { attack: result });
      }
      return failed;
    }
    case "gain_condition": {
      // A soul trinket is counted, up to the proficiency bonus (mt-mr-trinkets.ts).
      if (textKey(does.condition) === SOUL_TRINKET) {
        return gainTrinket(ctx.campaign, ctx.sheet);
      }
      addSheetCondition(ctx.campaign, ctx.sheet, does.condition, { rounds: does.rounds }, reaction.name);
      return { applied: `${ctx.sheet.name} gains ${does.condition}.` };
    }
    case "attack_penalty": {
      const target = allyOf(ctx) ?? ctx.sheet;
      const hit = lastHitOn(ctx, target, label);
      if ("error" in hit) return hit;
      const die = rollCard(ctx.campaign, ctx.turn, ctx.sheet.id, "custom", `${ctx.sheet.name}: ${reaction.name}`, does.die, null).total;
      const swing = hit.record.swings[hit.index];
      if (swing.natural === 20 || swing.total - die >= swing.vsAc) {
        return { rolled: die, applied: `The attack falls to ${swing.total - die} and still hits AC ${swing.vsAc}.` };
      }
      const settled = settle(ctx, hit.record, hit.record.swings.map((entry, at) => (at === hit.index ? { ...entry, hit: false, raw: 0 } : entry)), label);
      return { rolled: die, applied: `The attack falls to ${swing.total - die} against AC ${swing.vsAc} and misses: ${settled.given} hit points come back to ${target.name}.` };
    }
    case "redirect": {
      // The Cloud Rune turns a hit before its damage is rolled: the knight's
      // player is asked at the hit itself (cloud-rune.ts), and a seat no stop
      // reaches lets it land as rolled. A hit already dealt is never taken back.
      if (does.within) {
        return { error: `${reaction.name} turns a hit before its damage is rolled: ${ctx.sheet.name}'s player is asked at the hit, and a hit already dealt is not taken back. Nothing was spent.`, refused: "rules" };
      }
      const covered = ctx.sheet;
      const landed = lastHitOn(ctx, covered, label);
      // Instinctive Charm answers the attack roll, hit or miss
      // (ar-ws-charm-miss.ts): with no hit open, an attack that missed.
      const hit = "error" in landed && does.save ? (missedAttackOn(ctx.campaign.id, ctx.sheet.id, label) ?? landed) : landed;
      if ("error" in hit) return hit;
      if (!encounter) {
        return { error: `${reaction.name} turns an attack in a fight; there is no active encounter. Nothing was spent.`, refused: "rules" };
      }
      // Who takes the blow, settled before anything is rolled: for
      // Misdirection a creature beside the holder giving cover, for
      // Instinctive Charm the one closest to the attacker (redirect-target.ts).
      const taker = does.save ? null : takerOf(ctx, encounter, hit.record, reaction.name, false);
      if (taker && "error" in taker) return taker;
      // Instinctive Charm: the attacker saves first, and keeps its target on
      // a success. What bars the attacker is asked before who is closest to it.
      let charmed: Combatant | null = null;
      if (does.save) {
        // The attacker by its own id: targetEnemyId here is who takes the blow.
        const foeId = attackerFoeId(hit.record);
        const foe = foeId ? resolveTargetFoe(encounter.campaignId, encounter, foeId) : null;
        const attacker = foe?.status === "alive" ? foe : null;
        if (!attacker) {
          return { error: `${reaction.name} answers a creature's attack on ${ctx.sheet.name}; this one had no attacker in the fight on record. Nothing was spent.`, refused: "rules" };
        }
        if (does.rangeFt && !withinFeet(encounter.id, ctx.sheet.id, attacker.id, does.rangeFt)) {
          return { error: `${attacker.displayName} is beyond ${does.rangeFt} feet of ${ctx.sheet.name}. Nothing was spent.`, refused: "rules" };
        }
        // "When a creature you can see": the attacker in the holder's sight.
        const unseen = reaction.sees === "attacker" ? unseenRefusal(encounter.id, ctx.sheet, { id: attacker.id, name: attacker.displayName }, reaction.name) : null;
        if (unseen) return unseen;
        if (immuneToCondition(attacker, "charmed")) {
          return { error: `${attacker.displayName} cannot be charmed, so ${reaction.name} cannot sway it. Nothing was spent.`, refused: "rules" };
        }
        // Withstood once, it cannot be swayed again until the holder's long rest:
        // the mark sits on the creature, naming each holder it has withstood. A
        // creature already holding ten conditions has no room for it (encounters.ts
        // keeps ten), so there the bar lasts only until the round's tick.
        const withstood = textKey(`withstood ${reaction.name}`);
        const marks = attacker.conditionMeta as ConditionMetaMap;
        const swayedBy = marks[withstood]?.sources ?? [];
        if (swayedBy.includes(ctx.sheet.id)) {
          return { error: `${attacker.displayName} has already resisted ${reaction.name}, and cannot be swayed again until ${ctx.sheet.name}'s long rest. Nothing was spent.`, refused: "rules" };
        }
        const closest = takerOf(ctx, encounter, hit.record, reaction.name, true);
        if ("error" in closest) return closest;
        charmed = closest;
        const dry = hit.record.swings[hit.index].hit ? null : turnedMissRefusal(ctx.campaign.id, hit.record, hit.index, closest, reaction.name);
        if (dry) return dry;
        const dc = saveDc(holder, does.save.dcAbility);
        const save = rollEnemySave(ctx.campaign.id, attacker, does.save.ability, dc, {
          magical: true,
          resist: bindsWorthResisting(["charmed"]),
          against: "charmed",
          origin: { ref: ctx.sheet.id },
          record: { turn: ctx.turn, detail: `${attacker.displayName}: ${does.save.ability.toUpperCase()} save against ${reaction.name}` },
        });
        if (save.success) {
          // A character on the foes' side takes it on their sheet (patchEnemyConditions).
          patchEnemyConditions(attacker.id, [...attacker.conditions.filter((entry) => textKey(entry) !== withstood), withstood], {
            ...marks,
            [withstood]: { source: ctx.sheet.id, sources: [...swayedBy, ctx.sheet.id].slice(-20), untilLongRest: true },
          } as typeof attacker.conditionMeta);
          publishEncounter(ctx.campaign.id);
          return { applied: `${attacker.displayName} resists (${does.save.ability.toUpperCase()} ${save.total} vs DC ${dc}) and keeps its target; ${reaction.name} cannot sway it again until ${ctx.sheet.name}'s long rest.` };
        }
      }
      const target = taker ?? charmed;
      if (!target) return { error: `${reaction.name} found no creature to turn the attack onto. Nothing was spent.`, refused: "rules" };
      const swing = hit.record.swings[hit.index];
      if (!swing.hit) return landTurnedMiss(ctx, encounter, hit, target, reaction.name, label);
      const settled = settle(ctx, hit.record, hit.record.swings.map((entry, at) => (at === hit.index ? { ...entry, hit: false, raw: 0 } : entry)), label);
      // The attack now targets that creature: its roll meets their AC.
      const meets = blowLandsOn(ctx.campaign.id, target, swing);
      if (!meets.lands || swing.raw < 1) {
        publishEncounter(ctx.campaign.id);
        return { applied: `The attack turns onto ${target.name} and misses (${swing.total} against AC ${meets.ac}): ${settled.given} hit points come back to ${covered.name}.` };
      }
      const type = swing.type ?? hit.record.type;
      const applied = target.kind === "enemy"
        ? applyEnemyDamage(ctx.campaign, ctx.turn, encounter, target.enemy, swing.raw, ctx.sheets, ctx.sheetsById, type)
        : applyPcDamage(ctx.campaign, ctx.turn.id, getSheetById(target.id) ?? target.sheet, { amount: swing.raw, type, crit: swing.crit, reason: `${hit.record.attacker.name}'s ${hit.record.attack}, turned by ${reaction.name}` });
      publishEncounter(ctx.campaign.id);
      return { applied: `The blow lands on ${target.name} instead: ${settled.given} hit points come back to ${covered.name}.`, redirected: applied };
    }
    case "force_miss": {
      const target = allyOf(ctx) ?? ctx.sheet;
      // Convergent Future reaches a roll made within 60 feet: a hit open from
      // an attacker beyond them is not one it can answer.
      const inReach = (record: LastHit) => () => {
        const foe = attackerFoeId(record);
        return !does.rangeFt || !encounter || !foe || withinFeet(encounter.id, ctx.sheet.id, foe, does.rangeFt);
      };
      const hit = lastHitOn(ctx, target, label, does.rangeFt ? inReach : undefined);
      if ("error" in hit) return hit;
      const settled = settle(ctx, hit.record, hit.record.swings.map((entry, at) => (at === hit.index ? { ...entry, hit: false, raw: 0 } : entry)), label);
      if (!does.exhaustion) {
        return { applied: `The attack misses: ${settled.given} hit points come back to ${target.name}. HP ${settled.hp}.` };
      }
      const now = getSheetById(ctx.sheet.id) ?? ctx.sheet;
      reactionPatch(ctx.campaign, ctx.turn.id, now.id, { exhaustion: Math.min(6, (now.exhaustion ?? 0) + does.exhaustion) }, `${reaction.name}: exhaustion`);
      return { applied: `The attack misses by the wizard's word: ${settled.given} hit points come back to ${target.name}. ${ctx.sheet.name} gains ${does.exhaustion} level of exhaustion.` };
    }
    case "echo_takes_hit": {
      const ally = allyOf(ctx);
      if (!ally || ally.id === ctx.sheet.id) {
        return { error: `${reaction.name} sends the echo into an attack that hit another creature: pass that ally's targetCharacterId. Nothing was spent.`, retry: true };
      }
      const hidden = unseenTarget(ctx, found, ally);
      if (hidden) return hidden;
      const hit = lastHitOn(ctx, ally, label);
      if ("error" in hit) return hit;
      const swing = hit.record.swings[hit.index];
      const settled = settle(ctx, hit.record, hit.record.swings.map((entry, at) => (at === hit.index ? { ...entry, hit: false, raw: 0 } : entry)), label);
      // The same attack roll, made against the echo instead (AC 14 + the
      // proficiency bonus, 1 hit point). The echo is no creature the server
      // keeps, so what becomes of it is said for the GM to show on the board.
      const echoAc = 14 + computeSheetDerived(ctx.sheet).proficiencyBonus;
      const destroyed = swing.natural !== null && (swing.natural === 20 || (swing.natural !== 1 && swing.total >= echoAc));
      const echo =
        swing.natural === null
          ? `The echo has AC ${echoAc} and 1 hit point; the attack had no roll on record, so the GM judges whether it hits the echo.`
          : destroyed
            ? `The attack's ${swing.total} hits the echo (AC ${echoAc}, 1 hit point) and destroys it: take it off the board.`
            : `The attack's ${swing.total} misses the echo (AC ${echoAc}), which stays where it is.`;
      // Destroyed, the echo that took the hit is gone: the one nearest the
      // ally, the other of two (Legion of One) staying out, and the knight's
      // mark going only with the last (mt-fb-echo.ts destroyEcho).
      if (destroyed) {
        destroyEcho(ctx.campaign.id, ctx.sheet.id, { nearRef: ally.id }, `${reaction.name}: it took the hit`);
        // On record, so what answers the echo's destruction (Reclaim
        // Potential, trigger-table.ts own_echo_destroyed) finds it.
        recordTrigger(ctx.campaign.id, { kind: "echo_destroyed", characterId: ctx.sheet.id, forcer: { id: attackerFoeId(hit.record) ?? "", name: hit.record.attacker.name } });
      }
      return { applied: `${ctx.sheet.name}'s echo takes the attack: ${settled.given} hit points come back to ${ally.name}. HP ${settled.hp}. ${echo}` };
    }
    case "chance_miss": {
      const hit = lastHitOn(ctx, ctx.sheet, label);
      if ("error" in hit) return hit;
      // Armor of Hexes: only against the creature the warlock cursed.
      if (does.vsMark) {
        const mark = ctx.sheet.conditions.find((entry) => isConditionNamed(entry, does.vsMark!));
        const quarry = mark ? (ctx.sheet.conditionMeta as ConditionMetaMap)[mark]?.quarry : undefined;
        if (!mark || hit.record.attacker.id !== quarry) {
          return { error: `${reaction.name} answers the creature under ${ctx.sheet.name}'s ${does.vsMark}, and this hit came from another. Nothing was spent.`, refused: "rules" };
        }
      }
      const die = rollCard(ctx.campaign, ctx.turn, ctx.sheet.id, "custom", `${ctx.sheet.name}: ${reaction.name}`, does.die, null).total;
      if (die < does.min) {
        return { rolled: die, applied: `${does.die}: ${die}, under ${does.min}; the hit still lands.` };
      }
      const settled = settle(ctx, hit.record, hit.record.swings.map((entry, at) => (at === hit.index ? { ...entry, hit: false, raw: 0 } : entry)), label);
      return { rolled: die, applied: `${does.die}: ${die}, the attack misses whatever it rolled: ${settled.given} hit points come back. HP ${settled.hp}.` };
    }
    case "uncrit": {
      const target = allyOf(ctx) ?? ctx.sheet;
      if (encounter && target.id !== ctx.sheet.id && !withinFeet(encounter.id, ctx.sheet.id, target.id, does.rangeFt)) {
        return { error: `${target.name} is beyond ${does.rangeFt} feet of ${ctx.sheet.name}. Nothing was spent.`, refused: "rules" };
      }
      const hidden = unseenTarget(ctx, found, target);
      if (hidden) return hidden;
      const hit = lastHitOn(ctx, target, label, (entry) => (swing) => critTurnsNormal(entry, swing), `a critical hit on ${target.name}`);
      if ("error" in hit) return hit;
      const settled = settle(ctx, hit.record, hit.record.swings.map((entry, at) => (at === hit.index ? asNormalHit(entry) : entry)), label);
      return { applied: [`The critical ${hit.record.swings[hit.index].attack ?? hit.record.attack} on ${target.name} is a normal hit: ${settled.given} hit points come back. HP ${settled.hp}.`, ...settled.notes].join(" ") };
    }
    // Skirmisher's move, Tipsy Sway (src/lib/dm/authored-reactions-more.ts).
    case "move":
    case "redirect_miss":
      return resolveMoreReaction(ctx, reaction);
  }
}
