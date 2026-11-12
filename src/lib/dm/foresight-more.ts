// The rolls a GM call throws inside it beyond a save it forces, that a
// watch stop answers before the call runs (src/lib/dm/foresight.ts
// rollAbout, after foresight-saves.ts): an action's contest or check, a hurt
// character's or creature's save as a blow lands, an item's save or check, a
// legendary action's attack and saves, a walk's save and the opportunity
// attacks it may draw. Each lands on a roll site that carries its tag: a
// character's check through character-roll.ts rollCharacterD20, a creature's
// side of a contest tagged in action-common.ts and roll-gates.ts.

import type { Campaign } from "@/lib/db/campaigns";
import { listEffects } from "@/lib/db/active-effects";
import { listEnemies, type Encounter } from "@/lib/db/encounters";
import { walkedEnemiesHeld } from "@/lib/dm/condition-tick";
import { instancesOf, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { rollExpression } from "@/lib/dice";
import { withinFeet } from "@/lib/dm/authored-saves";
import { potionPlan } from "@/lib/dm/consumables";
import { checksAbout, contestAbout, foeRoll, heroCheck, heroesAbout, heroSave, holdsCondition, oneFoe, unseen, type About, type Seen } from "@/lib/dm/foresight-saves";
import { hasTrait } from "@/lib/dm/monster-abilities";
import { getFoe } from "@/lib/dm/sheet-foe";
import { findNamed, textKey } from "@/lib/language/text-logic";
import { itemSpellCast } from "@/lib/srd/item-spells";
import { highestSlotLevel, scrollSpell } from "@/lib/srd/scrolls";
import { checklistSpell } from "@/lib/srd/spell-lists";
import { holdsFeature } from "@/lib/srd/trait-rules";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const CONTESTS = new Set(["grapple", "shove", "pin", "escape", "improvise"]);

// take_action's checks: a grapple, a shove, a pin, an escape or an
// improvised action against a creature is a contest; a Hide or a Search the
// character's own check (combat-actions.ts, grapple.ts, improvise.ts). A
// creature's grapple or shove at a character is the same contest.
function actionAbout(args: Record<string, unknown>, sheets: readonly CharacterSheet[]): About | null {
  const action = typeof args.action === "string" ? textKey(args.action) : "";
  const hero = sheets.find((sheet) => sheet.id === args.characterId);
  if (hero) {
    if (action === "hide" || action === "search") {
      return contestAbout(hero, null, ` to ${action}`);
    }
    return CONTESTS.has(action) ? contestAbout(hero, typeof args.targetEnemyId === "string" ? getFoe(args.targetEnemyId) : null, ` to ${action}`) : null;
  }
  const actor = typeof args.enemyId === "string" ? getFoe(args.enemyId) : null;
  const target = sheets.find((sheet) => sheet.id === args.targetCharacterId);
  return actor && target && (action === "grapple" || action === "shove") ? contestAbout(target, actor, ` against ${actor.displayName}'s ${action}`) : null;
}

// ---- the saves a hurt character or creature makes ----

// The most a damage call can deal: its dice at their highest, or its amount.
function damageCeiling(args: Record<string, unknown>): number {
  if (typeof args.dice === "string" && args.dice.trim()) {
    try {
      return rollExpression(args.dice, (sides) => sides).total;
    } catch {
      return 0;
    }
  }
  return Number(args.amount) || 0;
}

// apply_damage: a concentrating character's save, a raging barbarian's
// Relentless Rage or Strength of the Grave when the blow could drop them
// (pc-damage.ts), a creature's concentration or Undead Fortitude
// (enemy-damage.ts).
function damageAbout(args: Record<string, unknown>, sheets: readonly CharacterSheet[]): About | null {
  const hero = sheets.find((sheet) => sheet.id === args.characterId);
  if (hero) {
    const drops = damageCeiling(args) >= hero.currentHp + (hero.tempHp ?? 0);
    const asks = Boolean(hero.concentratingOn) || (drops && ((holdsFeature(hero, "relentless rage") && holdsCondition(hero, "raging")) || holdsFeature(hero, "strength of the grave")));
    return asks ? heroesAbout([hero], " as the blow lands") : null;
  }
  const foe = typeof args.enemyId === "string" ? getFoe(args.enemyId) : null;
  return foe && (foe.concentration || hasTrait(foe.stats, "undeadFortitude")) ? oneFoe(foe, (who) => `${who} is about to make a saving throw as the blow lands.`) : null;
}

// use_item: an unknown potion that was poison, a scroll read above the
// reader's slots, an item whose cast waits on a check (consumables.ts,
// item-use.ts).
function itemAbout(args: Record<string, unknown>, user: CharacterSheet, sheets: readonly CharacterSheet[]): About | null {
  const item = typeof args.item === "string" ? user.equipment.find((entry) => textKey(entry.name) === textKey(String(args.item))) : undefined;
  if (!item) {
    return null;
  }
  if (potionPlan(item)?.kind === "poison") {
    const drinker = sheets.find((sheet) => sheet.id === args.targetCharacterId) ?? user;
    return heroesAbout([drinker], ` against ${item.name.slice(0, 60)}`);
  }
  const scroll = scrollSpell(item);
  if (scroll && user.spellcasting && (checklistSpell(scroll)?.level ?? 1) > highestSlotLevel(user)) {
    return contestAbout(user, null, " to read the scroll");
  }
  const cast = typeof args.spell === "string" ? itemSpellCast(item, args.spell, typeof args.charges === "number" ? args.charges : undefined) : null;
  return cast && !("error" in cast) && cast.check ? contestAbout(user, null, ` to use ${item.name.slice(0, 60)}`) : null;
}

// legendary_action played whole (legendary-play.ts): its attack, and the
// saves of the character it acts on (or, named none, of those in sight).
function legendaryAbout(encounter: Encounter, args: Record<string, unknown>, sheets: readonly CharacterSheet[]): About | null {
  const enemy = typeof args.enemyId === "string" ? getFoe(args.enemyId) : null;
  if (!enemy || unseen(enemy)) {
    return null;
  }
  const named = sheets.find((sheet) => sheet.id === args.targetCharacterId);
  const heroes = named ? [named] : sheets.filter((sheet) => sheet.currentHp > 0 && withinFeet(encounter.id, enemy.id, sheet.id, 60));
  const rolls = [foeRoll(enemy, "attack"), ...heroes.filter((hero) => !unseen(hero)).map(heroSave)];
  return { line: `${enemy.displayName} is about to take a legendary action.`, rollerId: enemy.id, rolls, perCreature: true, rollerWaits: false };
}

// move_token in a fight: the mover's save in a spell's zone or a hazard on the
// way (zone-triggers.ts), and the opportunity attacks of those whose reach it
// may leave (opportunity.ts, opportunity-strike.ts).
function moveAbout(encounter: Encounter, args: Record<string, unknown>, sheets: readonly CharacterSheet[]): About | null {
  if (args.teleport === true || typeof args.token !== "string") {
    return null;
  }
  const hero = sheets.find((sheet) => sheet.id === args.token) ?? findNamed(sheets, args.token, (sheet) => [sheet.name]);
  const foe = hero ? null : (getFoe(args.token) ?? findNamed(listEnemies(encounter.id), args.token, (enemy) => [enemy.displayName]) ?? null);
  if (!hero && !foe) {
    return null;
  }
  const moverId = hero?.id ?? foe!.id;
  const near = (id: string) => withinFeet(encounter.id, moverId, id, 10);
  const rolls: Seen[] = hero
    ? [heroSave(hero), ...listEnemies(encounter.id).filter((enemy) => enemy.status === "alive" && !unseen(enemy) && near(enemy.id)).map((enemy) => foeRoll(enemy, "attack"))]
    : [foeRoll(foe!, "save"), ...sheets.filter((sheet) => sheet.currentHp > 0 && !unseen(sheet) && near(sheet.id)).map((sheet) => ({ tag: { roller: "hero" as const, kind: "attack" as const, who: sheet.name }, ref: sheet.id, name: sheet.name }))];
  // A walk with nobody in reach throws a d20 only in a zone, which the
  // stop cannot see before the path is walked; it stops only when it can.
  return rolls.length > 1 ? { line: `${hero?.name ?? foe!.displayName} is about to move.`, rollerId: moverId, rolls, perCreature: true, rollerWaits: false } : null;
}

// ---- the saves a pointer move rolls ----

// Whether a character holds something they save against as their turn ends:
// a save-ends condition (condition-tick.ts endTurnSaves) or an effect with a
// save (effect-saves.ts).
function savesAtTurnEnd(campaign: Campaign, sheet: CharacterSheet): boolean {
  const meta = sheet.conditionMeta as ConditionMetaMap;
  return (
    sheet.conditions.some((name) => instancesOf(meta[name]).some((instance) => Boolean(instance.saveEnds))) ||
    listEffects(campaign.id).some((effect) => effect.targetId === sheet.id && Boolean(effect.saveAbility) && Boolean(effect.saveDc))
  );
}

const dying = (sheet: CharacterSheet) => sheet.currentHp <= 0 && !sheet.deathSaves?.dead && !sheet.deathSaves?.stable;

// What the move off the current character's turn rolls (encounter-tools.ts
// advancePointer): their own end-of-turn saves, the saves of the enemies the
// last move walked past against the holds their turns ended under, and the
// death saves of the dying whose turns the move starts, up to the next
// character standing. The pointer move's watch stop reads it (turn-hold.ts),
// and so does the model's end_turn. The ending character is the roller, so
// their own watch never holds their own turn's end.
export function moveSavesAbout(campaign: Campaign, encounter: Encounter, sheets: readonly CharacterSheet[]): About | null {
  const current = encounter.orderReady ? encounter.order[encounter.turnIndex] : undefined;
  const leaving = current?.kind === "pc" ? sheets.find((sheet) => sheet.id === current.characterId) : undefined;
  if (!leaving) {
    return null;
  }
  const rolls: Seen[] = savesAtTurnEnd(campaign, leaving) ? [heroSave(leaving)] : [];
  for (const id of walkedEnemiesHeld(campaign, encounter)) {
    const enemy = getFoe(id);
    if (enemy && enemy.status === "alive") rolls.push(foeRoll(enemy, "save"));
  }
  for (let step = 1; step < encounter.order.length; step += 1) {
    const entry = encounter.order[(encounter.turnIndex + step) % encounter.order.length];
    const sheet = entry.kind === "pc" ? sheets.find((each) => each.id === entry.characterId) : undefined;
    if (!sheet) {
      continue;
    }
    if (!dying(sheet)) {
      break;
    }
    rolls.push({ tag: { roller: "hero", kind: "death_save", who: sheet.name }, ref: sheet.id, name: sheet.name });
  }
  const seen = rolls.filter((roll) => !unseen(sheets.find((sheet) => sheet.id === roll.ref) ?? getFoe(roll.ref)));
  if (!seen.length) {
    return null;
  }
  const line = seen.length === 1 ? `${leaving.name}'s turn is ending: ${seen[0].name} is about to make a saving throw.` : `${leaving.name}'s turn is ending: ${seen.length} creatures are about to make saving throws.`;
  return { line, rollerId: leaving.id, rolls: seen, perCreature: true, rollerWaits: false };
}

export function moreAbout(campaign: Campaign, encounter: Encounter, name: string, args: Record<string, unknown>, sheets: readonly CharacterSheet[]): About | null {
  if (name === "end_turn") {
    return moveSavesAbout(campaign, encounter, sheets);
  }
  const user = typeof args.characterId === "string" ? sheets.find((sheet) => sheet.id === args.characterId) : undefined;
  if (name === "take_action") {
    return actionAbout(args, sheets);
  }
  if (name === "stabilize" && (args.method ?? "check") === "check") {
    const healer = sheets.find((sheet) => sheet.id === args.healerId);
    return healer ? contestAbout(healer, null, " to stabilize the dying") : null;
  }
  if (name === "group_check" && Array.isArray(args.characterIds)) {
    const heroes = args.characterIds.map((ref) => sheets.find((sheet) => sheet.id === ref)).filter((hero): hero is CharacterSheet => Boolean(hero) && !unseen(hero!));
    return checksAbout(heroes[0]?.id ?? "", heroes.map(heroCheck), heroes.length === 1 ? `${heroes[0].name} is about to make an ability check.` : `${heroes.length} characters are about to make ability checks.`);
  }
  if ((name === "scene_check" || name === "social_check") && user) {
    return contestAbout(user, null, "");
  }
  if (name === "use_item" && user) {
    return itemAbout(args, user, sheets);
  }
  if (name === "apply_damage") {
    return damageAbout(args, sheets);
  }
  if (name === "legendary_action") {
    return legendaryAbout(encounter, args, sheets);
  }
  if (name === "move_token") {
    return moveAbout(encounter, args, sheets);
  }
  return null;
}
