// The saves a GM call throws inside it, that a watch stop answers before the
// call runs (src/lib/dm/foresight.ts rollAbout): a trap or a hazard sprung on
// characters, a condition laid with the save that keeps it off, a rider
// thrown from a mount, a shape spell at an unwilling creature, a disease, a
// poison or a madness. Each lands on a roll site that carries the save's tag
// and asks what the stop armed: the character's or the creature's full save
// (src/lib/dm/forced-save.ts), or throwWatchedSave there for the hours of
// cold and heat (endurance.ts) and an affliction (between-io.ts). Without a
// stop these
// went by with the watcher's Portent, Chronal Shift, Flash of Genius or
// Favored by the Gods unasked (SRD 5.1 Portent: "any attack roll, saving
// throw, or ability check made by you or a creature that you can see").

import type { Campaign } from "@/lib/db/campaigns";
import type { Encounter, EncounterEnemy } from "@/lib/db/encounters";
import { getMounts } from "@/lib/db/mounts";
import { getParty } from "@/lib/db/party";
import { spellEngineName } from "@/lib/content";
import { bindsCreature } from "@/lib/dm/ai-boundary";
import { isSheetFoe } from "@/lib/dm/combat-sides-logic";
import { hostileTo } from "@/lib/dm/combatant";
import { enemyShapeSpellFor } from "@/lib/dm/enemy-polymorph-logic";
import { formationView } from "@/lib/dm/formation-logic";
import { exposureShrug } from "@/lib/dm/hazard-tools";
import { unwillingSaveFor } from "@/lib/dm/hostile-buffs";
import { formationPartyIds } from "@/lib/dm/roster";
import { canonicalCondition } from "@/lib/dm/set-condition";
import { getFoe } from "@/lib/dm/sheet-foe";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { findNamed, textKey } from "@/lib/language/text-logic";
import type { RollTag } from "@/lib/dice-script-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { trapAt } from "@/lib/srd/table-hazards";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// One creature's roll a call is about to make: its tag on the dice, the
// creature (for a Chronal Shift's reach and side) and its name.
export type Seen = { tag: RollTag; ref: string; name: string };

// What a call is about to roll (foresight.ts): `perCreature`, each creature
// caught saves on its own and the watcher picks whose; `rollerWaits`, the
// roller's own card answers it after it lands; `riderSaves`, the save an
// enemy's hit may force on its target.
export type About = { line: string; rollerId: string; rolls: Seen[]; perCreature: boolean; rollerWaits: boolean; riderSaves?: Seen[] };

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
function heroesAbout(heroes: CharacterSheet[], against: string, many = "saving throws"): About | null {
  const seen = heroes.filter((hero, at) => !unseen(hero) && heroes.findIndex((each) => each.id === hero.id) === at);
  if (!seen.length) {
    return null;
  }
  const line = seen.length === 1 ? `${seen[0].name} is about to make ${many === "saving throws" ? "a saving throw" : many}${against}.` : `${seen.length} characters are about to make ${many}${against}.`;
  return { line, rollerId: seen[0].id, rolls: seen.map(heroSave), perCreature: seen.length > 1, rollerWaits: false };
}

function oneFoe(enemy: EncounterEnemy | null, line: (name: string) => string, rollerId?: string): About | null {
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
  if (name === "afflict" && args.save !== false && (args.kind === "disease" || args.kind === "poison" || (args.kind === "madness" && Number(args.saveDc) >= 1))) {
    // A disease's infection, a poison's save, a madness's when its source
    // allows one (afflictions.ts, between-io.ts characterSave).
    const hero = sheets.find((sheet) => sheet.id === args.characterId);
    const what = typeof args.name === "string" && args.name.trim() ? args.name.trim().slice(0, 60) : args.kind === "madness" ? "madness" : `a ${args.kind}`;
    return hero ? heroesAbout([hero], ` against ${what}`) : null;
  }
  return null;
}
