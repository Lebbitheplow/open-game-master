// The saves a GM call throws inside it, that a watch stop answers before the
// call runs (src/lib/dm/foresight.ts rollAbout): a trap or a hazard sprung on
// characters, a condition laid with the save that keeps it off, a rider
// thrown from a mount, a shape spell at an unwilling creature, a disease, a
// poison or a madness. Each lands on a roll site that carries the save's tag
// and asks what the stop armed: the character's or the creature's full save
// (src/lib/dm/forced-save.ts), or the character's d20 door for the hours of
// cold and heat (endurance.ts) and an affliction (between-io.ts:
// character-roll.ts rollCharacterD20). Without a
// stop these
// went by with the watcher's Portent, Chronal Shift, Flash of Genius or
// Favored by the Gods unasked (SRD 5.1 Portent: "any attack roll, saving
// throw, or ability check made by you or a creature that you can see").

import type { Campaign } from "@/lib/db/campaigns";
import { listEnemies, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getMounts } from "@/lib/db/mounts";
import { getParty } from "@/lib/db/party";
import { spellEngineName } from "@/lib/content";
import { bindsCreature } from "@/lib/dm/ai-boundary";
import { isSheetFoe } from "@/lib/dm/combat-sides-logic";
import { hostileTo } from "@/lib/dm/combatant";
import { enemyShapeSpellFor } from "@/lib/dm/enemy-polymorph-logic";
import { formationView } from "@/lib/dm/formation-logic";
import { withinFeet } from "@/lib/dm/authored-saves";
import { channelSaveReach } from "@/lib/dm/feature-spends";
import { exposureShrug } from "@/lib/dm/hazard-tools";
import { pickNaturalAttack } from "@/lib/dm/natural-attack";
import { findPet } from "@/lib/dm/pet-tools";
import { QUIVERING } from "@/lib/dm/srd-feature-spends";
import { unwillingSaveFor } from "@/lib/dm/hostile-buffs";
import { formationPartyIds } from "@/lib/dm/roster";
import { canonicalCondition } from "@/lib/dm/set-condition";
import { getFoe } from "@/lib/dm/sheet-foe";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { findNamed, textKey } from "@/lib/language/text-logic";
import { POISON_COAT } from "@/lib/dm/attack-onhit";
import type { RollTag } from "@/lib/dice-script-logic";
import { isConditionNamed, isNamed } from "@/lib/srd/feature-names";
import { authoredSpendFor, heldReaction } from "@/lib/srd/authored-effects";
import { resourceDef } from "@/lib/srd/class-resources";
import { trapAt } from "@/lib/srd/table-hazards";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// One creature's roll a call is about to make: its tag on the dice, the
// creature (for a Chronal Shift's reach and side) and its name.
export type Seen = { tag: RollTag; ref: string; name: string };

// What a call is about to roll (foresight.ts): `perCreature`, each creature
// caught saves on its own and the watcher picks whose; `rollerWaits`, the
// roller's own card answers it after it lands; `riderSaves`, the save an
// enemy's hit may force on its target.
// `forcerId`: the creature whose spell or ability the call is, when it names
// one (Slayer's Counter answers a save its prey forces).
export type About = { line: string; rollerId: string; rolls: Seen[]; perCreature: boolean; rollerWaits: boolean; riderSaves?: Seen[]; forcerId?: string };

export function holdsCondition(creature: { conditions?: readonly string[] }, ...names: string[]): boolean {
  return (creature.conditions ?? []).some((written) => isConditionNamed(written, ...names));
}

export const unseen = (creature: { conditions?: readonly string[] } | null | undefined) => !creature || holdsCondition(creature, "invisible", "hidden");

export function heroSave(hero: CharacterSheet): Seen {
  return { tag: { roller: "hero", kind: "save", who: hero.name }, ref: hero.id, name: hero.name };
}

// A creature of the fight as its save is tagged: a character fighting the
// party saves as the character it is (forced-save.ts rollEnemySave).
export function foeRoll(enemy: { id: string; displayName: string; slug?: string }, kind: RollTag["kind"]): Seen {
  return { tag: { roller: isSheetFoe(enemy) ? "hero" : "enemy", kind, who: enemy.displayName }, ref: enemy.id, name: enemy.displayName };
}

const SAVE_ABILITIES = new Set(["str", "dex", "con", "int", "wis", "cha"]);

// The characters' saves, one each, or several the watcher picks from.
export function heroesAbout(heroes: CharacterSheet[], against: string, many = "saving throws"): About | null {
  const seen = heroes.filter((hero, at) => !unseen(hero) && heroes.findIndex((each) => each.id === hero.id) === at);
  if (!seen.length) {
    return null;
  }
  const line = seen.length === 1 ? `${seen[0].name} is about to make ${many === "saving throws" ? "a saving throw" : many}${against}.` : `${seen.length} characters are about to make ${many}${against}.`;
  return { line, rollerId: seen[0].id, rolls: seen.map(heroSave), perCreature: seen.length > 1, rollerWaits: false };
}

export function oneFoe(enemy: EncounterEnemy | null, line: (name: string) => string, rollerId?: string): About | null {
  if (!enemy || unseen(enemy)) {
    return null;
  }
  return { line: line(enemy.displayName), rollerId: rollerId ?? enemy.id, rolls: [foeRoll(enemy, "save")], perCreature: false, rollerWaits: false };
}

// apply_hazard (src/lib/dm/hazard-tools.ts): a trap by severity or a named
// trap with a save, a generic hazard, and the hours of cold or heat, each
// character named (or the one at the front or rear of the travel formation)
// saving on its own. A fall and lost air roll no save, nor does a named trap
// without one; a character the weather cannot touch rolls none either.
function hazardAbout(campaign: Campaign, args: Record<string, unknown>, sheets: readonly CharacterSheet[]): About | null {
  const type = args.type;
  const weather = type === "extreme_cold" || type === "extreme_heat";
  const isTrap = type === "trap";
  const trapName = isTrap && typeof args.trap === "string" && args.trap.trim() ? args.trap : null;
  const trap = trapName ? trapAt(trapName, campaign.id) : null;
  const saves = type === "generic" || weather || (isTrap && (trapName ? Boolean(trap?.trap.save) : true));
  if (!saves) {
    return null;
  }
  const named = Array.isArray(args.characterIds) ? args.characterIds.filter((ref): ref is string => typeof ref === "string") : [];
  // The walker hazard-tools.ts handleApplyHazard picks for a rank.
  const placed = !named.length && (args.rank === "front" || args.rank === "rear") ? formationView(getParty(campaign.id).marchingOrder, formationPartyIds(campaign, [...sheets])).placed : [];
  const refs = named.length ? named : placed.length ? [args.rank === "front" ? placed[0] : placed[placed.length - 1]] : [];
  const heroes = refs
    .map((ref) => sheets.find((sheet) => sheet.id === ref) ?? findNamed(sheets, ref, (sheet) => [sheet.name]))
    .filter((hero): hero is CharacterSheet => Boolean(hero) && !(weather && exposureShrug(hero!, type === "extreme_cold")));
  const hours = weather ? Math.max(1, Math.min(48, Math.trunc(Number(args.hours) || 1))) : 1;
  const reason = typeof args.reason === "string" && args.reason.trim() ? args.reason.trim() : (trap?.name ?? (isTrap ? "a trap" : weather ? (type === "extreme_cold" ? "the cold" : "the heat") : ""));
  const against = reason ? ` against ${reason.slice(0, 80)}` : "";
  return heroesAbout(heroes, against, hours > 1 ? `${hours} saving throws, one an hour,` : "saving throws");
}

// set_condition (or set_enemy_condition) of a condition that binds: the
// model's binding lands only on a failed save the server rolls first
// (src/lib/dm/ai-gate.ts bind, encounter-tools-extra.ts).
function bindAbout(name: string, args: Record<string, unknown>, sheets: readonly CharacterSheet[]): About | null {
  const wanted = canonicalCondition(String(args.condition ?? ""));
  // As the gate reads it (ai-gate.ts): the first three letters, any case.
  const ability = textKey(String(args.saveAbility ?? "")).slice(0, 3);
  if (!bindsCreature(wanted) || !SAVE_ABILITIES.has(ability) || !(Number(args.saveDc) >= 1)) {
    return null;
  }
  const hero = name === "set_condition" && typeof args.characterId === "string" ? sheets.find((sheet) => sheet.id === args.characterId) : undefined;
  if (hero) {
    return heroesAbout([hero], ` against being ${wanted}`);
  }
  return typeof args.enemyId === "string" ? oneFoe(getFoe(args.enemyId), (who) => `${who} is about to make a saving throw against being ${wanted}.`) : null;
}

// cast_buff of a shape spell: Polymorph at a creature of the fight makes it
// save (enemy-polymorph.ts), and a spell at a character fighting the caster
// asks that character's save as an unwilling creature (hostile-buffs.ts).
function shapeAbout(campaign: Campaign, encounter: Encounter, args: Record<string, unknown>, sheets: readonly CharacterSheet[]): About | null {
  const caster = sheets.find((sheet) => sheet.id === args.characterId);
  if (!caster || typeof args.spell !== "string" || !args.spell.trim()) {
    return null;
  }
  const spell = args.spell.trim().slice(0, 60);
  const engine = spellEngineName(spell, spellAuthorsFor(campaign));
  // Dispel Magic on a spell above its slot asks the caster's check (dispel.ts).
  if (isNamed(engine, "dispel magic")) {
    return contestAbout(caster, null, ` to end the spell`);
  }
  if (typeof args.targetEnemyId === "string" && enemyShapeSpellFor(engine)) {
    return oneFoe(getFoe(args.targetEnemyId), (who) => `${caster.name} is about to cast ${spell} at ${who}.`, caster.id);
  }
  if (!unwillingSaveFor(engine) || !Array.isArray(args.targetCharacterIds)) {
    return null;
  }
  const targets = args.targetCharacterIds
    .map((ref) => sheets.find((sheet) => sheet.id === ref))
    .filter((target): target is CharacterSheet => Boolean(target) && target!.id !== caster.id && hostileTo(encounter, { kind: "sheet", id: caster.id }, { kind: "sheet", id: target!.id }));
  return heroesAbout(targets, ` against ${spell}`);
}

// ---- the saves a character's own call makes creatures roll ----

// The creatures a call aims at, by the ids it sends.
function namedFoes(args: Record<string, unknown>): EncounterEnemy[] {
  const refs = [args.targetEnemyId, ...(Array.isArray(args.targetEnemyIds) ? args.targetEnemyIds : [])];
  const foes: EncounterEnemy[] = [];
  for (const ref of refs) {
    const foe = typeof ref === "string" ? getFoe(ref) : null;
    if (foe && foe.status === "alive" && !foes.some((entry) => entry.id === foe.id)) foes.push(foe);
  }
  return foes;
}

// The living creatures of the fight within `feet` of the character, as an
// area feature finds them on the board (off the board, all of them).
function foesNear(encounter: Encounter, user: CharacterSheet, feet: number): EncounterEnemy[] {
  return listEnemies(encounter.id).filter((enemy) => enemy.status === "alive" && withinFeet(encounter.id, user.id, enemy.id, feet));
}

function foesAbout(user: CharacterSheet, foes: EncounterEnemy[], what: string): About | null {
  const seen = foes.filter((foe) => !unseen(foe));
  if (!seen.length) {
    return null;
  }
  const against = ` against ${what.slice(0, 60)}`;
  const line = seen.length === 1 ? `${seen[0].displayName} is about to make a saving throw${against}.` : `${seen.length} creatures are about to make saving throws${against}.`;
  return { line, rollerId: user.id, rolls: seen.map((foe) => foeRoll(foe, "save")), perCreature: seen.length > 1, rollerWaits: false };
}

// use_resource on a feature that makes creatures save: Intimidating
// Presence, Quivering Palm's second use, a Channel Divinity turning or fear,
// an authored feature whose effect is a save or a burst (authored-spends.ts).
function featureAbout(encounter: Encounter, args: Record<string, unknown>, user: CharacterSheet): About | null {
  const resource = typeof args.resource === "string" ? args.resource : "";
  const variant = typeof args.variant === "string" ? args.variant : undefined;
  const named = namedFoes(args);
  const authored = resource ? authoredSpendFor(user, resourceDef(resource)?.displayName ?? resource)?.spend : undefined;
  let reach: number | null = null;
  if (authored) {
    const does = authored.does;
    if (does.kind === "save_effect") {
      reach = does.rangeFt ?? 30;
    } else if ("burst" in does && does.burst) {
      reach = does.burst.rangeFt;
    } else {
      return null;
    }
  } else if (isNamed(resource, "intimidating presence")) {
    reach = 30;
  } else if (isNamed(resource, "quivering palm")) {
    // Its first use sets the vibrations; only ending them asks the save.
    return foesAbout(user, named.filter((foe) => holdsCondition(foe, QUIVERING)), "Quivering Palm");
  } else {
    reach = channelSaveReach(resource, variant);
  }
  if (reach === null) {
    return null;
  }
  return foesAbout(user, named.length ? named : foesNear(encounter, user, reach), authored?.name ?? resource);
}

// use_reaction: Hellish Rebuke at the creature that hurt the character, or
// an authored reaction whose answer is a save (authored-reactions.ts).
function reactionAbout(encounter: Encounter, args: Record<string, unknown>, user: CharacterSheet): About | null {
  const feature = typeof args.feature === "string" ? args.feature : "";
  const named = namedFoes(args);
  if (isNamed(feature, "hellish rebuke")) {
    return foesAbout(user, named, "Hellish Rebuke");
  }
  const does = feature ? heldReaction(user, feature)?.reaction.does : undefined;
  if (!does || !("save" in does) || !does.save) {
    return null;
  }
  const reach = "rangeFt" in does && typeof does.rangeFt === "number" ? does.rangeFt : 60;
  return foesAbout(user, named.length ? named : foesNear(encounter, user, reach), feature);
}

// pet_attack: the pet's attack roll, and the save its hit may force (an
// imp's poison, natural-onhit.ts). The pet is no sheet, so only a foretold
// number answers its own roll here.
function petAbout(args: Record<string, unknown>, owner: CharacterSheet): About | null {
  const pet = findPet(owner, typeof args.petName === "string" ? args.petName : undefined);
  const attack = pet ? pickNaturalAttack(pet.attacks, typeof args.attack === "string" ? args.attack : undefined) : undefined;
  const enemy = typeof args.targetEnemyId === "string" ? getFoe(args.targetEnemyId) : null;
  if (!pet || !attack || !enemy) {
    return null;
  }
  const rolls: Seen[] = [{ tag: { roller: "hero", kind: "attack", who: pet.name }, ref: `pet:${owner.id}:${pet.name}`, name: pet.name }];
  if (attack.onHit?.save && !unseen(enemy)) rolls.push(foeRoll(enemy, "save"));
  return { line: `${pet.name} is about to attack ${enemy.displayName}.`, rollerId: owner.id, rolls, perCreature: rolls.length > 1, rollerWaits: false };
}

const SAVE_MANEUVERS = ["trip attack", "menacing attack", "pushing attack", "disarming attack", "goading attack"];

// pc_attack's hits that make the creature hit save: Stunning Strike, Open
// Hand Technique's push or knock-down, a Battle Master maneuver's rider, a
// coat of poison on the weapon (pc-attack-riders.ts, attack-blow.ts,
// attack-onhit.ts). The creatures that may save, each once.
export function attackRiderFoes(args: Record<string, unknown>, hero: CharacterSheet): EncounterEnemy[] {
  const entries = Array.isArray(args.attacks) ? args.attacks.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object") : [args];
  const coated = holdsCondition(hero, POISON_COAT);
  const foes: EncounterEnemy[] = [];
  for (const entry of entries) {
    const rider =
      coated ||
      entry.stunningStrike === true ||
      (typeof entry.openHand === "string" && !isNamed(entry.openHand, "no reactions")) ||
      (typeof entry.maneuver === "string" && SAVE_MANEUVERS.some((name) => isNamed(String(entry.maneuver), name)));
    const ref = entry.targetEnemyId ?? args.targetEnemyId;
    const foe = rider && typeof ref === "string" ? getFoe(ref) : null;
    if (foe && !unseen(foe) && !foes.some((each) => each.id === foe.id)) foes.push(foe);
  }
  return foes;
}

// ---- the checks a call throws inside it ----

export function heroCheck(hero: CharacterSheet): Seen {
  return { tag: { roller: "hero", kind: "check", who: hero.name }, ref: hero.id, name: hero.name };
}

// One character's check, or a contest between a character and a creature:
// each side's d20 is its own, and the watcher picks whose.
export function checksAbout(rollerId: string, rolls: Seen[], line: string): About | null {
  return rolls.length ? { line, rollerId, rolls, perCreature: rolls.length > 1, rollerWaits: false } : null;
}

export function contestAbout(hero: CharacterSheet, foe: EncounterEnemy | null, what: string): About | null {
  const rolls = [...(unseen(hero) ? [] : [heroCheck(hero)]), ...(foe && !unseen(foe) ? [foeRoll(foe, "check")] : [])];
  const line = foe ? `${hero.name} and ${foe.displayName} are about to roll a contest${what}.` : `${hero.name} is about to make an ability check${what}.`;
  return checksAbout(hero.id, rolls, line);
}

export function savesAbout(campaign: Campaign, encounter: Encounter, name: string, args: Record<string, unknown>, sheets: readonly CharacterSheet[]): About | null {
  if (name === "apply_hazard") {
    return hazardAbout(campaign, args, sheets);
  }
  if (name === "set_condition" || name === "set_enemy_condition") {
    return bindAbout(name, args, sheets);
  }
  if (name === "dismount" && (args.cause === "forced-move" || args.cause === "rider-prone")) {
    // Thrown from the saddle: the DC 10 Dexterity save to land on their feet
    // (SRD 5.1, Mounted Combat; mount-tools.ts).
    const rider = sheets.find((sheet) => sheet.id === args.characterId);
    return rider && getMounts(campaign.id)[rider.id] ? heroesAbout([rider], " to land on their feet") : null;
  }
  if (name === "cast_buff") {
    return shapeAbout(campaign, encounter, args, sheets);
  }
  const user = typeof args.characterId === "string" ? sheets.find((sheet) => sheet.id === args.characterId) : undefined;
  if (name === "use_resource" && user) {
    // Indomitable's reroll is the user's own save; Insightful Fighting a
    // contest with the creature (feature-spends.ts, authored-spend-effects.ts).
    if (isNamed(String(args.resource ?? ""), "indomitable")) {
      return heroesAbout([user], " again");
    }
    if (isNamed(String(args.resource ?? ""), "insightful fighting")) {
      return contestAbout(user, namedFoes(args)[0] ?? null, " to read the creature");
    }
    return featureAbout(encounter, args, user);
  }
  if (name === "use_reaction" && user) {
    // Counterspell against a higher spell asks the caster's check (reaction-spells.ts).
    if (isNamed(String(args.feature ?? ""), "counterspell")) {
      return contestAbout(user, null, " to counter the spell");
    }
    return reactionAbout(encounter, args, user);
  }
  if (name === "pet_attack" && user) {
    return petAbout(args, user);
  }
  if (name === "afflict" && args.save !== false && (args.kind === "disease" || args.kind === "poison" || (args.kind === "madness" && Number(args.saveDc) >= 1))) {
    // A disease's infection, a poison's save, a madness's when its source
    // allows one (afflictions.ts, between-io.ts characterSave).
    const hero = sheets.find((sheet) => sheet.id === args.characterId);
    const what = typeof args.name === "string" && args.name.trim() ? args.name.trim().slice(0, 60) : args.kind === "madness" ? "madness" : `a ${args.kind}`;
    return hero ? heroesAbout([hero], ` against ${what}`) : null;
  }
  return null;
}
