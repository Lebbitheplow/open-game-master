// Watching a fight for Portent or Chronal Shift, Flash of Genius or Favored
// by the Gods. Most of a fight needs no stop, so the player presses a button
// for the fight, or the part of it, where a number or a shift may matter.
// While it is on, the turn holds an attack, a check or a save before the call
// runs, and the player may put a foretold number on that call's d20, or say
// to roll it again if it goes the wrong way, or to add to a save that fails
// (src/lib/dm/chronal-shift.ts). An area's saves are many: the player picks
// whose.
//
// Nothing is paused inside an attack. The held calls run on resume by the same
// code as any other call, with the number armed on the dice
// (src/lib/db/dice-scripts.ts), and it is paid for only if a d20 took it: a
// call the rules refuse, or a roll parked for real dice, costs nothing.

import { armForetold, disarmForetold } from "@/lib/db/dice-scripts";
import type { Campaign } from "@/lib/db/campaigns";
import { createPendingRoll, publicPendingRoll, setPendingWatch, type DmTurn, type HeldCall, type WatchChoice, type WatchPower, type WatchRoll } from "@/lib/db/dm-turns";
import { getActiveEncounter, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { spellEngineName } from "@/lib/content";
import { boardCatch } from "@/lib/dm/area-casting";
import { canHelpSaveNow, canShiftNow, inShiftReach, playerAtTable, type SaveHelp } from "@/lib/dm/chronal-shift";
import { isSheetFoe } from "@/lib/dm/combat-sides-logic";
import { kindOfId, sideOf } from "@/lib/dm/combatant";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { attackNamed } from "@/lib/dm/enemy-profile";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { zonePlacement } from "@/lib/dm/zone-args";
import { findNamed } from "@/lib/language/text-logic";
import { holdsFeature } from "@/lib/srd/feature-names";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { heroRollTag, type RollTag } from "@/lib/dice-script-logic";
import { rollsCanWait } from "@/lib/dm/after-roll";
import { canWaitOnRoll } from "@/lib/dm/after-roll-logic";
import { spendForetold } from "@/lib/dm/foretold";
import { foretoldLeft } from "@/lib/dm/foretold-logic";
import { getFoe } from "@/lib/dm/sheet-foe";
import { publishPersisted } from "@/lib/events";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { trapAt } from "@/lib/srd/table-hazards";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A stop comes before every watched roll, so it cannot ask for long.
export const WATCH_SECONDS = 20;

function holdsCondition(creature: { conditions?: readonly string[] }, ...names: string[]): boolean {
  return (creature.conditions ?? []).some((written) => isConditionNamed(written, ...names));
}

// Whether the sheet is watching this fight and could answer a stop: a
// number left (Portent), or a Chronal Shift, Flash of Genius or Favored by the
// Gods it holds. "A creature that you can see": a blinded or unconscious
// watcher sees nothing to stop. A player who has left the table would hold
// every watched roll for the stop's whole time (chronal-shift.ts playerAtTable).
function canWatch(campaignId: string, sheet: CharacterSheet, encounterId: string): boolean {
  return (
    sheet.watchingEncounterId === encounterId &&
    (foretoldLeft(sheet).length > 0 || holdsFeature(sheet, "chronal shift") || holdsFeature(sheet, "flash of genius") || holdsFeature(sheet, "favored by the gods")) &&
    sheet.currentHp > 0 &&
    !holdsCondition(sheet, "blinded", "unconscious") &&
    rollsCanWait(sheet) &&
    playerAtTable(campaignId, sheet)
  );
}

function argsOf(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// One creature's roll a call is about to make: its tag on the dice, the
// creature (for a Chronal Shift's reach and side) and its name.
type Seen = { tag: RollTag; ref: string; name: string };

// What a call is about to roll, for the player to read and the number to aim
// at. Null for a call no watch stops. `perCreature`: an area, where each
// creature caught makes its own save and the watcher picks whose; otherwise
// the rolls are one roll of the call's, whichever comes first. `rollerWaits`:
// the roller is a player whose own card answers the roll after it lands
// (after-roll.ts), so a Chronal Shift is offered there, not here.
// `riderSaves`: the save an enemy's hit may force on its target, which only
// Flash of Genius and Favored by the Gods answer here.
type About = { line: string; rollerId: string; rolls: Seen[]; perCreature: boolean; rollerWaits: boolean; riderSaves?: Seen[] };

// A creature of the fight as its save is tagged: a character fighting the
// party saves as the character it is (forced-save.ts rollEnemySave).
function foeRoll(enemy: { id: string; displayName: string; slug?: string }, kind: RollTag["kind"]): Seen {
  return { tag: { roller: isSheetFoe(enemy) ? "hero" : "enemy", kind, who: enemy.displayName }, ref: enemy.id, name: enemy.displayName };
}

const unseen = (creature: { conditions?: readonly string[] } | null | undefined) => !creature || holdsCondition(creature, "invisible", "hidden");

// Who an area call catches, before it runs: the creatures it names, else
// (a player's blast laid on the board that names nobody) those standing in
// it, as aoe_damage itself reads them (src/lib/dm/aoe-damage.ts).
function areaCatch(campaign: Campaign, args: Record<string, unknown>, sheets: readonly CharacterSheet[], encounterId: string): { enemies: EncounterEnemy[]; heroes: CharacterSheet[] } {
  const ids = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  const enemies: EncounterEnemy[] = [];
  const heroes: CharacterSheet[] = [];
  const add = (ref: string) => {
    const enemy = getFoe(ref) ?? resolveEnemyRef(encounterId, ref);
    if (enemy && enemy.status === "alive") {
      if (!enemies.some((entry) => entry.id === enemy.id)) enemies.push(enemy);
      return;
    }
    const hero = sheets.find((sheet) => sheet.id === ref) ?? findNamed(sheets, ref, (sheet) => [sheet.name]);
    if (hero && !heroes.some((entry) => entry.id === hero.id)) heroes.push(hero);
  };
  const named = [...ids(args.enemyIds), ...ids(args.characterIds), ...(typeof args.targets === "string" ? args.targets.split(",").map((part) => part.trim()).filter(Boolean) : [])];
  for (const ref of named) add(ref);
  if (named.length || typeof args.spell !== "string" || typeof args.casterCharacterId !== "string" || args.casterEnemyId) {
    return { enemies, heroes };
  }
  const caster = sheets.find((sheet) => sheet.id === args.casterCharacterId);
  if (!caster) {
    return { enemies, heroes };
  }
  const authors = spellAuthorsFor(campaign);
  const num = (value: unknown) => (typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : undefined);
  // The creatures aoe_damage will catch on the board (area-casting.ts
  // boardCatch): Ice Storm's and Entangle's as well as Fireball's, never a Web's.
  const caught = boardCatch({
    authors,
    encounterId,
    caster,
    spell: args.spell,
    runsAs: spellEngineName(args.spell, authors),
    slotLevel: num(args.level) ?? null,
    placement: zonePlacement({ atX: num(args.atX), atY: num(args.atY), towardX: num(args.towardX), towardY: num(args.towardY) }),
  })?.caught;
  if (caught && !("error" in caught)) {
    for (const ref of [...caught.enemyIds, ...caught.characterIds]) add(ref);
  }
  return { enemies, heroes };
}

function rollAbout(campaign: Campaign, call: HeldCall, sheets: readonly CharacterSheet[], encounterId: string): About | null {
  const args = argsOf(call.rawArguments);
  const sheetOf = (id: unknown) => sheets.find((sheet) => sheet.id === id);
  if (call.name === "enemy_attack") {
    const enemy = typeof args.enemyId === "string" ? getFoe(args.enemyId) : null;
    if (!enemy || unseen(enemy)) {
      return null;
    }
    const victim = sheetOf(args.targetCharacterId);
    const target = victim?.name;
    // A hit whose rider forces a save (a spider's poison): the target's save
    // is thrown inside this call, too late for any card.
    // The attack named as enemy_attack itself finds it (enemy-attack.ts).
    const named = typeof args.attack === "string" ? attackNamed(enemy.stats.attacks ?? [], args.attack) : null;
    const forcesSave = (named ? [named] : (enemy.stats.attacks ?? [])).some((attack) => attack.onHit?.save && attack.onHit.dc);
    return {
      line: `${enemy.displayName} is about to attack${target ? ` ${target}` : ""}.`,
      rollerId: enemy.id,
      // A hit it lands is answered on the reaction card (hand-react.ts), so
      // a Chronal Shift never stops here: only Portent's number does.
      rolls: [{ tag: { roller: "enemy", kind: "attack", who: enemy.displayName }, ref: enemy.id, name: enemy.displayName }],
      perCreature: false,
      rollerWaits: true,
      ...(victim && forcesSave && !unseen(victim) ? { riderSaves: [{ tag: { roller: "hero" as const, kind: "save" as const, who: victim.name }, ref: victim.id, name: victim.name }] } : {}),
    };
  }
  if (call.name === "pc_attack") {
    const hero = sheetOf(args.characterId);
    if (!hero || unseen(hero)) {
      return null;
    }
    return { line: `${hero.name} is about to attack.`, rollerId: hero.id, rolls: [{ tag: { roller: "hero", kind: "attack", who: hero.name }, ref: hero.id, name: hero.name }], perCreature: false, rollerWaits: rollsCanWait(hero) };
  }
  if (call.name === "cast_at_player") {
    // An enemy or a hazard forces one character's save, which the server rolls.
    const hero = sheetOf(args.characterId);
    if (!hero || unseen(hero)) {
      return null;
    }
    const source = typeof args.source === "string" && args.source.trim() ? ` against ${args.source.trim().slice(0, 80)}` : "";
    return { line: `${hero.name} is about to make a saving throw${source}.`, rollerId: hero.id, rolls: [{ tag: { roller: "hero", kind: "save", who: hero.name }, ref: hero.id, name: hero.name }], perCreature: false, rollerWaits: false };
  }
  if (call.name === "apply_hazard") {
    // A trap or a hazard the GM throws: each character it names saves through
    // cast_at_player (hazard-tools.ts), the save that call already stops for.
    // A fall and lost air roll no save, nor does a named trap without one
    // (or with a name no trap holds, which is refused), and the hours of cold
    // or heat roll saves no number or shift is armed for (endurance.ts). A
    // travel-formation rank names nobody until the call runs, and a formation
    // is for travel, not a fight.
    const isTrap = args.type === "trap";
    const trapName = isTrap && typeof args.trap === "string" && args.trap.trim() ? args.trap : null;
    const trap = trapName ? trapAt(trapName, campaign.id) : null;
    const saves = args.type === "generic" || (isTrap && (trapName ? Boolean(trap?.trap.save) : true));
    const heroes: CharacterSheet[] = [];
    for (const ref of saves && Array.isArray(args.characterIds) ? args.characterIds : []) {
      const hero = typeof ref === "string" ? (sheetOf(ref) ?? findNamed(sheets, ref, (sheet) => [sheet.name])) : undefined;
      if (hero && !unseen(hero) && !heroes.some((entry) => entry.id === hero.id)) heroes.push(hero);
    }
    if (!heroes.length) {
      return null;
    }
    const rolls: Seen[] = heroes.map((hero) => ({ tag: { roller: "hero" as const, kind: "save" as const, who: hero.name }, ref: hero.id, name: hero.name }));
    const named = typeof args.reason === "string" && args.reason.trim() ? args.reason.trim() : (trap?.name ?? (isTrap ? "a trap" : ""));
    const source = named ? ` against ${named.slice(0, 80)}` : "";
    const line = heroes.length === 1 ? `${heroes[0].name} is about to make a saving throw${source}.` : `${heroes.length} characters are about to make saving throws${source}.`;
    // Each character caught saves on its own, as in an area: the watcher
    // picks whose.
    return { line, rollerId: heroes[0].id, rolls, perCreature: true, rollerWaits: false };
  }
  if (call.name === "cast_at_enemy") {
    // A hero's spell at one creature: the caster's attack roll or the
    // creature's save, whichever the spell asks for. Only the ones in sight.
    // The tool sends its creatures as `targets` (cast-tools.ts); the flat
    // targetEnemyId is the older shape its handler still reads.
    const hero = sheetOf(args.characterId);
    const refs = Array.isArray(args.targets)
      ? args.targets.map((entry: unknown) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>).targetEnemyId : entry))
      : [args.targetEnemyId];
    const enemies: EncounterEnemy[] = [];
    for (const ref of refs) {
      const enemy = typeof ref === "string" ? getFoe(ref) : null;
      if (enemy && !enemies.some((entry) => entry.id === enemy.id)) enemies.push(enemy);
    }
    if (!hero || !enemies.length) {
      return null;
    }
    const spell = typeof args.spell === "string" && args.spell.trim() ? args.spell.trim().slice(0, 60) : "a spell";
    if (enemies.length > 1) {
      // Each creature it reaches saves on its own, as in an area: the
      // watcher picks whose save the number answers.
      const rolls = enemies.filter((enemy) => !unseen(enemy)).map((enemy) => foeRoll(enemy, "save"));
      if (!rolls.length) {
        return null;
      }
      return { line: `${hero.name} is about to cast ${spell} at ${enemies.map((enemy) => enemy.displayName).join(", ")}.`, rollerId: hero.id, rolls, perCreature: true, rollerWaits: false };
    }
    const [enemy] = enemies;
    const rolls: Seen[] = [
      ...(unseen(enemy) ? [] : [foeRoll(enemy, "save")]),
      ...(unseen(hero) ? [] : [{ tag: { roller: "hero" as const, kind: "attack" as const, who: hero.name }, ref: hero.id, name: hero.name }]),
    ];
    if (!rolls.length) {
      return null;
    }
    // A spell attack a player throws waits on their card (throwForChoice);
    // the creature's save does not, so the stop still answers that one.
    return { line: `${hero.name} is about to cast ${spell} at ${enemy.displayName}.`, rollerId: hero.id, rolls, perCreature: false, rollerWaits: false };
  }
  if (call.name === "aoe_damage") {
    // Each creature caught saves on its own: the watcher picks whose save
    // the number (or the shift) answers, from those they can see.
    const caught = areaCatch(campaign, args, sheets, encounterId);
    const rolls: Seen[] = [
      ...caught.enemies.filter((enemy) => !unseen(enemy)).map((enemy) => foeRoll(enemy, "save")),
      ...caught.heroes.filter((hero) => !unseen(hero)).map((hero) => ({ tag: { roller: "hero" as const, kind: "save" as const, who: hero.name }, ref: hero.id, name: hero.name })),
    ];
    if (!rolls.length) {
      return null;
    }
    const spell = typeof args.spell === "string" && args.spell.trim() ? ` against ${args.spell.trim().slice(0, 60)}` : "";
    const line = rolls.length === 1 ? `${rolls[0].name} is about to make a saving throw${spell}.` : `${rolls.length} creatures are about to make saving throws${spell}.`;
    return { line, rollerId: rolls[0].ref, rolls, perCreature: true, rollerWaits: false };
  }
  if (call.name === "request_roll") {
    const hero = sheetOf(args.characterId);
    const kind = typeof args.kind === "string" ? args.kind : "";
    const tag = hero && canWaitOnRoll(kind) && (args.visibility ?? "public") === "public" ? heroRollTag(kind, hero.name) : undefined;
    if (!hero || !tag) {
      return null;
    }
    return { line: `${hero.name} is about to roll a ${kind.replaceAll("_", " ")}.`, rollerId: hero.id, rolls: [{ tag, ref: hero.id, name: hero.name }], perCreature: false, rollerWaits: rollsCanWait(hero) };
  }
  return null;
}

// "Within 30 feet" and "a creature you can see", for Chronal Shift: the
// board's reach and sight (chronal-shift.ts inShiftReach).
function shiftReaches(campaignId: string, wizard: CharacterSheet, roll: Seen, sheets: readonly CharacterSheet[]): boolean {
  const creature = sheets.find((sheet) => sheet.id === roll.ref) ?? getFoe(roll.ref);
  return Boolean(creature) && inShiftReach(campaignId, wizard, creature!);
}

// The character saves a Flash of Genius (an ally's in sight within 30 feet, or
// the artificer's own) or a Favored by the Gods (the sorcerer's own) may
// answer: a player's save, which no card will offer once the call throws it.
function savesHelped(campaignId: string, encounter: Encounter, sheet: CharacterSheet, power: SaveHelp, about: About, sheets: readonly CharacterSheet[]): Seen[] {
  if (about.rollerWaits && !about.riderSaves) {
    return [];
  }
  const side = (ref: string) => sideOf(encounter, kindOfId(encounter.id, ref) ?? "enemy", ref);
  return [...(about.rollerWaits ? [] : about.rolls), ...(about.riderSaves ?? [])].filter((roll) => {
    const saver = roll.tag.roller === "hero" && roll.tag.kind === "save" ? sheets.find((entry) => entry.id === roll.ref) : null;
    if (!saver) {
      return false;
    }
    return power === "favored_by_the_gods" ? saver.id === sheet.id : side(saver.id) === side(sheet.id) && inShiftReach(campaignId, sheet, saver);
  });
}

// The watcher for this call and the choices they are offered, or null. A
// wizard holding a number is asked first, then one holding a Chronal Shift
// that reaches a roll a card will not already offer, then an artificer's
// Flash of Genius or a divine soul's Favored by the Gods on a save.
function watcherFor(campaignId: string, encounter: Encounter, about: About, ownCard: boolean, sheets: readonly CharacterSheet[]): { watcher: CharacterSheet; power: WatchPower; choices: WatchChoice[] } | null {
  const side = (ref: string) => sideOf(encounter, kindOfId(encounter.id, ref) ?? "enemy", ref);
  const choicesOf = (rolls: Seen[], reverseFor: (roll: Seen) => WatchRoll["reverse"]): WatchChoice[] => {
    const one = (roll: Seen): WatchRoll => ({ tag: roll.tag, reverse: reverseFor(roll) });
    return about.perCreature ? rolls.map((roll) => ({ name: roll.name, rolls: [one(roll)] })) : [{ name: rolls[0].name, rolls: rolls.map(one) }];
  };
  for (const sheet of sheets) {
    if (!canWatch(campaignId, sheet, encounter.id) || (ownCard && sheet.id === about.rollerId)) {
      continue;
    }
    if (foretoldLeft(sheet).length > 0) {
      return { watcher: sheet, power: "portent", choices: choicesOf(about.rolls, () => "success") };
    }
    // A foe's success is rolled again, an ally's failure; a roll the
    // roller's own card answers once it lands is offered there instead.
    const mine = side(sheet.id);
    const reach = about.rollerWaits || about.rolls.every((roll) => roll.tag.roller === "enemy" && roll.tag.kind === "attack")
      ? []
      : about.rolls.filter((roll) => !(roll.tag.roller === "enemy" && roll.tag.kind === "attack") && shiftReaches(campaignId, sheet, roll, sheets));
    if (reach.length && canShiftNow(campaignId, sheet)) {
      return { watcher: sheet, power: "chronal_shift", choices: choicesOf(reach, (roll) => (side(roll.ref) === mine ? "failure" : "success")) };
    }
    for (const power of ["flash_of_genius", "favored_by_the_gods"] as const) {
      const saves = canHelpSaveNow(campaignId, sheet, power) ? savesHelped(campaignId, encounter, sheet, power, about, sheets) : [];
      if (saves.length) {
        return { watcher: sheet, power, choices: choicesOf(saves, () => "failure") };
      }
    }
  }
  return null;
}

// Holds the calls and parks the turn on the watcher's choice, when someone
// watching could answer the first of them. True when it did.
export function parkForWatch(campaign: Campaign, turn: DmTurn, calls: readonly HeldCall[]): boolean {
  const [first] = calls;
  const encounter = first ? getActiveEncounter(campaign.id) : null;
  if (!first || !encounter) {
    return false;
  }
  const sheets = listSheets(campaign.id);
  const about = rollAbout(campaign, first, sheets, encounter.id);
  if (!about) {
    return false;
  }
  // A wizard's own check waits on its own card already (invoke-roll.ts).
  const found = watcherFor(campaign.id, encounter, about, first.name === "request_roll", sheets);
  if (!found) {
    return false;
  }
  const { watcher, power, choices } = found;
  const pending = createPendingRoll({
    campaignId: campaign.id,
    turnId: turn.id,
    toolCallId: null,
    userId: watcher.userId,
    characterId: watcher.id,
    kind: "custom",
    detail: about.line,
    expression: "1d20",
    advantage: "none",
    dc: null,
    reason: about.line,
    parkedFor: "watch",
  });
  const deadline = new Date(Date.now() + WATCH_SECONDS * 1000).toISOString();
  const [lead, ...also] = choices[0].rolls.map((roll) => roll.tag);
  const held = setPendingWatch(pending.id, { calls: [...calls], tag: lead, ...(also.length ? { also } : {}), line: about.line, face: null, deadline, power, choices });
  publishPersisted(campaign.id, "roll_pending", { pendingRoll: publicPendingRoll(held ?? pending) });
  // Past the deadline the roll goes ahead on its own and nothing is spent.
  const timer = setTimeout(() => {
    void import("@/lib/dm/foresight-release").then(({ releaseWatchWhenDue }) => releaseWatchWhenDue(pending.id));
  }, WATCH_SECONDS * 1000);
  timer.unref?.();
  return true;
}

// Runs one held call with the chosen number armed on its first matching d20,
// and pays for the number if a die took it. The line is for the model's answer.
export async function runWithForetold<T>(
  campaign: Campaign,
  turnId: string,
  choice: { watcherId: string; face: number; tags: readonly RollTag[]; line: string } | null,
  run: () => Promise<T>,
): Promise<{ result: T; portent: string | null }> {
  // Spent some other way since it was chosen (the counter moved, an undo): the
  // die rolls honestly rather than show a number nobody paid for.
  const holder = choice ? getSheetById(choice.watcherId) : null;
  if (!choice || !holder || !foretoldLeft(holder).includes(choice.face)) {
    return { result: await run(), portent: null };
  }
  armForetold(campaign.id, { face: choice.face, tags: choice.tags });
  let used = false;
  let result: T;
  try {
    result = await run();
  } finally {
    used = disarmForetold(campaign.id);
  }
  if (!used || !spendForetold(campaign, choice.watcherId, choice.face, turnId, choice.line)) {
    return { result, portent: null };
  }
  const name = getSheetById(choice.watcherId)?.name ?? "A wizard";
  return { result, portent: `${name} foretold this roll with Portent: its d20 shows ${choice.face}.` };
}
