// A roll by its parts (issue #1064).
//
// A roll's `detail` is a sentence a site writes for the table to read
// ("Longsword vs Goblin", "CON save to keep concentration (Bless)"). Rules
// read that sentence back: which weapon a character last swung, whether a
// failed save was the one that keeps concentration, which ability a save
// used. So rewording a card could quietly break a rule, and a reader found
// its fact only while the words stayed English.
//
// What a rule reads back is now stored beside the sentence, as fields
// (`rolls.parts_json`). This module is the only place that reads them, and
// the only place that still reads a sentence. A roll that has parts is read
// by its fields alone, and the door writes them for every roll it stores,
// '{}' where a roll names nothing. A roll with none is read by its words:
// one stored before the column, and the roll of a card dealt before cards
// kept their parts (src/lib/db/dm-turns.ts PendingRoll), landing after.
// scripts/test-text-comparisons.mjs lists every file that reads a stored
// roll's `detail`, and fails on one that tests it outside this module.
//
// Step 1 of the issue stored what code reads back. Step 2 moves the words:
// a family's sites say whom a roll is against, how it is aimed and its note
// as fields too, and write no sentence. Such parts are marked `worded`, and
// src/lib/roll-words.ts makes the roll's words from them, in the reader's
// language. A site whose family has not moved still writes its sentence.
//
// Pure: no database.

import type { StoredRoll } from "@/lib/db/rolls";
import { isSheetFoe } from "@/lib/dm/combat-sides-logic";
import { textKey } from "@/lib/language/text-logic";
import { rollAgainst } from "@/lib/roll-labels";
import { ACTION_WORDS_VERSION, isDamageNote, PHYSICAL, WORDS_VERSION, type RollNoteId } from "@/lib/roll-words";
import { findSkill, SRD_SKILLS } from "@/lib/srd";
import type { Ability } from "@/lib/srd/authored-effects-types";
import { ABILITY_NAMES } from "@/lib/srd/legality/types";

// What was used, by its content key where it has one. `key` is what says
// the engine knows which content row this is: a roll's words put a weapon's
// or a spell's name into another language by its key alone, and one with
// none is shown as it was written, by a person or the model
// (src/lib/roll-words.ts).
// A creature's own action ("Bite") has a kind of its own and is stored by
// the name its stat block gives it, with no key: its words look that name
// up in the creature attack names (issue #1121). It has a key only where it
// is carried under more than its own name: a beast form's "Wolf Bite" is
// the form's Bite, and the key says so.
export type RollUsed = {
  kind: "weapon" | "spell" | "feature" | "item" | "trap" | "skill" | "ability" | "tool" | "action";
  key?: string;
  name: string;
};

// The content row a name is, where the engine knows one: the table it is in
// and a name the row answers to there. For a spell that is the name it was
// cast under, which may be an alias of the row's own.
// For a creature's action it is the attack's own name, as the stat block has
// it (a beast form's "Bite", carried as "Wolf Bite").
export type RollRow = { kind: "weapon" | "spell" | "action"; name: string };

// What a rule later asks of a roll. A closed list: the save that keeps
// concentration, and the Stealth a fight's opening rolls to decide surprise
// (src/lib/dm/encounter-open.ts decideAmbush).
export type RollPurpose = "concentration" | "surprise";

// Whom a roll is against, as they were named when it was rolled: a name
// here is always shown as written. The engine's own words for a target are
// a kind with no name, which the words say in the reader's language: an
// object nobody named ("an object"), and a creature the table has not seen
// ("someone unseen"). The second is never written to a roll's or a card's
// own row: it is what a seat not owed the creature is sent, and what the
// table's event log keeps, in place of the creature's name and id
// (src/lib/hidden-names-logic.ts). A pet and a mount are a character's own
// creatures: a roll names them as that character's sheet does, with no id.
export type RollTarget = { kind: "sheet" | "enemy" | "pet" | "mount"; id?: string; name: string } | { kind: "object"; name?: string } | { kind: "unseen" };

// What is left to say of a roll. An engine's note is one of the engine's
// own, by its id (src/lib/roll-words.ts ROLL_NOTES), so the dictionaries can
// put it into the reader's language. A note a person or the model typed is
// free text, shown as written. The two are told apart by their key, never
// by reading the words.
export type RollNote = { engine: RollNoteId } | { typed: string };

export type RollParts = {
  used?: RollUsed;
  targets?: RollTarget[];
  // One creature struck ("Club vs Aria") or everyone an area caught
  // ("Fireball on Goblin 1, Goblin 2"). "vs" where it is left out.
  aim?: "vs" | "on";
  // A list, in the order they are said: a roll can carry more than one
  // ("again, at disadvantage", and the feature that asked for it).
  notes?: RollNote[];
  purpose?: RollPurpose;
  // What a save resists, one of the engine's own values ("poison",
  // "frightened": src/lib/dm/roll-about.ts SAVE_AGAINST) as the resolver was
  // told it, for a feature that rolls the save again with what rode it the
  // first time.
  resists?: string;
  // The dice were the player's own, rolled at the table.
  physical?: true;
  // These parts make the roll's words (src/lib/roll-words.ts): its site wrote
  // no sentence, and the one stored as `detail` was built from them. Set by
  // the builders of a family that has moved, and by nothing else. Without it
  // the parts say only what a rule reads back, and the roll is shown by the
  // sentence its site wrote. The mark is the version of the words these
  // parts make (roll-words.ts WORDS_VERSION): rows are never rewritten, so
  // a later change to what the word-making fields mean raises it.
  worded?: number;
};

// Parts that make a roll's words: what a moved family's builders return,
// and what a site may hand the door in place of a sentence.
export type WordedParts = RollParts & { worded: typeof WORDS_VERSION | typeof ACTION_WORDS_VERSION };

// What a roll says of itself as it is recorded or dealt as a card: the
// sentence its site wrote, or parts that make its words. One of the two,
// always: a roll with neither would be stored with no words.
export type RollSaid<Parts = RollParts | null> = { detail: string; parts?: Parts } | { detail?: undefined; parts: WordedParts };

// A stored roll, as its readers here take it.
type Recorded = Pick<StoredRoll, "parts" | "detail">;

export const ABILITIES: readonly Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

// ---- What a site says as it records a roll ----

// A check by its skill, or by its ability where it names no skill.
export function checkParts(check: { skill?: string | null; ability?: Ability | null }): RollParts {
  if (check.skill) {
    return { used: { kind: "skill", key: check.skill, name: findSkill(check.skill)?.name ?? check.skill } };
  }
  return check.ability ? saveParts(check.ability) : {};
}

// A saving throw by its ability, and what it is rolled for when a rule asks.
export function saveParts(ability: Ability, purpose?: RollPurpose): RollParts {
  return { used: { kind: "ability", key: ability, name: ABILITY_NAMES[ability] ?? ability }, ...(purpose ? { purpose } : {}) };
}

// A character's attack or its damage, by what it is made with and whom it
// is against: the name it is made under, and the content row it is, as its
// key. The row is the weapon it swings as (`base`: a "Longsword +1" is a
// longsword), or the row the engine says its name is where `base` does not
// (`row`: the spell a spell attack is, the unarmed strike, a carried weapon
// swung as an improvised one). With neither, the name is one only a person
// or the model gave (an object picked up, a spell the content does not
// know): it has no key, and is shown as written. These parts make the
// roll's words, so the site writes no sentence.
export function attackParts(attack: { name: string; base?: string | null; row?: RollRow | null; spell?: boolean }, target: RollTarget, note?: RollNoteId): WordedParts {
  return strikeParts(attackUsed(attack), target, note ? [{ engine: note }] : []);
}

// What such an attack is made with. A natural attack (a beast form's, a
// summoned creature's) is its stat block's own action, carried under the
// creature's name too ("Wolf Bite"): its row is the attack ("Bite").
function attackUsed(attack: { name: string; base?: string | null; row?: RollRow | null; spell?: boolean }): RollUsed {
  const row: RollRow | null = attack.row ?? (attack.base ? { kind: "weapon", name: attack.base } : null);
  if (row?.kind === "action") {
    // A spell attack is a spell whatever its profile was built from, and an
    // action's name is no spell's key.
    return attack.spell ? { kind: "spell", name: attack.name } : actionUsed(row, attack.name);
  }
  return { kind: attack.spell || row?.kind === "spell" ? "spell" : "weapon", ...(row ? { key: textKey(row.name) } : {}), name: attack.name };
}

// One thing used against one target, with what is left to say of it: the
// parts every attack and damage roll of a moved family is made of. A
// creature's action under its stat block's own name makes the second
// version of the words (roll-words.ts ACTION_WORDS_VERSION), so a reader
// built before it shows the roll by its sentence. One carried under more
// than its own name has a key and stays in the first: that reader shows it
// as written, which is what its sentence said.
export function strikeParts(used: RollUsed, target: RollTarget, notes: readonly RollNote[] = []): WordedParts {
  const bare = used.kind === "action" && !used.key;
  return { used, targets: [target], aim: "vs", ...(notes.length ? { notes: [...notes] } : {}), worded: bare ? ACTION_WORDS_VERSION : WORDS_VERSION };
}

// A creature's own attack or its damage, by the action its stat block names
// and whom it is against. The name is stored as the stat block has it, with
// no key: a bundled creature's, a content pack's and a homebrew one's are
// read the same way, through the creature attack names
// (src/lib/roll-words.ts). `notes` are said in the order given; a site
// passes one of the engine's own by its id, or none where a condition does
// not hold.
export function actionParts(attack: { name: string }, target: RollTarget, ...notes: (RollNoteId | RollNote | null | undefined | false)[]): WordedParts {
  const said = notes.filter((note): note is RollNoteId | RollNote => Boolean(note)).map((note): RollNote => (typeof note === "string" ? { engine: note } : note));
  return strikeParts(actionUsed(attack), target, said);
}

// A creature's own action as what a roll was made with. `carried`: the name
// the roll says it under, where that is more than the attack's own (a beast
// form's "Wolf Bite", a pet's "Rex's Bite"). The key then says which attack
// it is, so its words can put the attack's name into the reader's language
// and leave the creature's as written.
export function actionUsed(attack: { name: string }, carried: string = attack.name): RollUsed {
  return carried === attack.name ? { kind: "action", name: attack.name } : { kind: "action", key: textKey(attack.name), name: carried };
}

// What a creature's hit goes on to deal besides the blow, as a note: its
// damage type where it is one of the engine's own, the word its stat block
// wrote where it is not (a homebrew creature's), and "rider" where it names
// none.
export function riderNote(damageType: string | null | undefined): RollNote {
  const type = damageType?.trim();
  if (!type) {
    return { engine: "rider" };
  }
  return isDamageNote(type) ? { engine: type } : { typed: type };
}

// The same, read off an attack's profile or its record
// (src/lib/dm/attack-logic.ts AttackProfile, attack-record.ts AttackRecord):
// every site of the family words its roll through this, so none hands on
// half of what the profile says. `spell`: the attack is a spell attack,
// whether or not the content knows the spell.
export function swingParts(attack: { weapon: string; base?: string; named?: RollRow }, target: RollTarget, said: { spell?: boolean; note?: RollNoteId } = {}): WordedParts {
  return attackParts({ name: attack.weapon, base: attack.base, row: attack.named, spell: said.spell }, target, said.note);
}

// What that attack is made with, alone: for a roll its hit goes on to make
// (the damage a natural attack's rider deals, src/lib/dm/natural-onhit.ts).
export function swingUsed(attack: { weapon: string; base?: string; named?: RollRow }, spell = false): RollUsed {
  return attackUsed({ name: attack.weapon, base: attack.base, row: attack.named, spell });
}

// The same roll with one more of the engine's own notes on it ("half on a
// miss").
export function noted(parts: WordedParts, note: RollNoteId): WordedParts {
  return { ...parts, notes: [...(parts.notes ?? []), { engine: note }] };
}

// A foe as a roll's target: a creature of the fight, or a character fighting
// the party, who is struck as one (src/lib/dm/sheet-foe.ts).
export function foeTarget(foe: { id: string; displayName: string; slug?: string }): RollTarget {
  return { kind: isSheetFoe(foe) ? "sheet" : "enemy", id: foe.id, name: foe.displayName };
}

// A character as a roll's target.
export function sheetTarget(sheet: { id: string; name: string }): RollTarget {
  return { kind: "sheet", id: sheet.id, name: sheet.name };
}

// A character's own creature as a roll's target: a pet or a mount, by the
// name it is kept under on its owner's sheet.
export function keptTarget(kind: "pet" | "mount", creature: { name: string }): RollTarget {
  return { kind, name: creature.name };
}

// ---- What a rule reads back ----

// The skill a check was made with, when it is one of these; with no list,
// whichever skill it was.
export function rollSkill(roll: Recorded, among?: readonly string[]): string | null {
  if (roll.parts) {
    const used = roll.parts.used;
    return used?.kind === "skill" && used.key && (!among || among.includes(used.key)) ? used.key : null;
  }
  return sentenceSkill(roll.detail, among ?? SRD_SKILLS.map((skill) => skill.id));
}

// The ability a save or a bare ability check was made with.
export function rollAbility(roll: Recorded, among: readonly Ability[] = ABILITIES): Ability | null {
  if (roll.parts) {
    const used = roll.parts.used;
    return used?.kind === "ability" && among.includes(used.key as Ability) ? (used.key as Ability) : null;
  }
  return sentenceAbility(roll.detail, among);
}

// What a save was against, for the traits keyed to it, when it was told.
export function rollResists(roll: Recorded): string | undefined {
  return roll.parts ? roll.parts.resists : VERSUS.exec(roll.detail)?.[1];
}

// Whether a save was the one a concentrating caster makes to keep the spell.
export function rollKeepsConcentration(roll: Recorded): boolean {
  return roll.parts ? roll.parts.purpose === "concentration" : roll.detail.includes(KEEPS_CONCENTRATION);
}

// Whether a Stealth check was the one a fight's opening rolled for its
// ambush, not one the GM asked for before it.
export function rollDecidesSurprise(roll: Recorded): boolean {
  return roll.parts ? roll.parts.purpose === "surprise" : roll.detail.includes(AMBUSH_STEALTH);
}

// The carried row an attack roll was made with, when it is still carried. A
// pack's rows have no ids, so the row is found by the name it is carried
// under, which the roll stored whole.
export function rollWeaponRow<Row extends { name: string }>(roll: Recorded, carried: readonly Row[]): Row | null {
  if (roll.parts) {
    const used = roll.parts.used;
    return used?.kind === "weapon" ? (carried.find((row) => row.name === used.name) ?? null) : null;
  }
  return carried.find((row) => roll.detail.startsWith(rollAgainst(row.name, ""))) ?? null;
}

// Whether the dice were the player's own.
export function rollPhysical(roll: Recorded): boolean {
  return roll.parts ? roll.parts.physical === true : roll.detail.endsWith(PHYSICAL);
}

// ---- A roll stored before its parts: the sentence, as it was read ----

// The words every site that rolls this save wrote into it.
const KEEPS_CONCENTRATION = "to keep concentration";

// The words an ambush's Stealth is filed under (encounter-open.ts).
const AMBUSH_STEALTH = "lying in wait";

// What follows "vs" to the end of a save's words ("DEX save vs. frightened").
const VERSUS = /\bvs\.? (.+)$/i;

// A skill by its id or its name in the words ("Grapple: athletics",
// "Sleight of Hand to palm the key").
function sentenceSkill(detail: string, among: readonly string[]): string | null {
  const words = textKey(detail);
  return among.find((id) => words.includes(id) || words.includes(textKey(findSkill(id)?.name ?? id))) ?? null;
}

// An ability by its code or its name in the words ("DEX save vs. Fireball",
// a request's bare "dex", "Strength check").
const ABILITY_WORD = new RegExp(`\\b(?:${[...ABILITIES, ...ABILITIES.map((id) => ABILITY_NAMES[id])].join("|")})\\b`, "gi");
function sentenceAbility(detail: string, among: readonly Ability[]): Ability | null {
  for (const [word] of detail.matchAll(ABILITY_WORD)) {
    const key = word.toLowerCase();
    const ability = ABILITIES.find((id) => id === key || ABILITY_NAMES[id].toLowerCase() === key);
    if (ability && among.includes(ability)) {
      return ability;
    }
  }
  return null;
}
