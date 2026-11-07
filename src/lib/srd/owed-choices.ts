// The choices a character's levels have earned and not yet made
// (docs/dnd-rules-audit-2026-10-09-extent.md, F24): the class's skill picks,
// an Ability Score Improvement, the expertise a rogue or bard picks, a
// subclass at its class's level, and the picks a class feature opens (a
// dragon ancestor, invocations, a fighting style: owed-picks-logic.ts, which
// the sheet takes outside a level-up, issue #833). Level-up leaves them open
// rather than refusing the level (a companion levels without them); the
// class's own carry to the next level-up, which takes them, a class
// feature's are made on the sheet, and the sheet shows both until then.
//
// Pure: the sheet dialog asks the same as the server.

import { asiOwed } from "@/lib/srd/asi-ledger";
import { expertiseAllowed, expertiseSlotsFor, subclassLevelFor, THIEVES_TOOLS } from "@/lib/srd/features";
import { classListFor } from "@/lib/srd/multiclass";
import { SRD_CLASSES } from "@/lib/srd";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { classWords } from "@/lib/sheet-words";
import { owedPickLines, type OwedContext } from "@/lib/srd/owed-picks-logic";

type Owing = Pick<CharacterSheet, "class" | "subclass" | "level" | "classes" | "features" | "proficiencies"> &
  Partial<Pick<CharacterSheet, "feats" | "spellcasting" | "featChoices" | "race" | "campaignId">>;

export function owedChoices(sheet: Owing, context: OwedContext = {}): string[] {
  const groups = owedChoiceGroups(sheet, context);
  return [...groups.levelUp, ...groups.onSheet];
}

// The owed choices by where they are made: the next level-up takes the
// skills, improvements, expertise and a subclass (its own pickers); a class
// feature's picks (a dragon ancestor, an invocation, a fighting style, a
// language) are made on the character sheet, since a level-up may never
// offer them (POST /sheet/owed). The sheet and the join confirmation say each
// where it is made (owedChoicesSentences, joinOwedNote).
export type OwedChoiceGroups = { levelUp: string[]; onSheet: string[] };

export function owedChoiceGroups(sheet: Owing, context: OwedContext = {}): OwedChoiceGroups {
  const classes = classListFor(sheet);
  const out: string[] = [];
  // The first class's skill picks: as many of its list as it offers.
  const first = SRD_CLASSES.find((entry) => entry.id === (classes[0]?.id ?? sheet.class));
  if (first?.skillChoices?.count) {
    const offered = new Set(first.skillChoices.from.map((id) => id.replace(/_/g, " ")));
    const held = sheet.proficiencies.skills.filter((skill) => offered.has(skill.toLowerCase().replace(/_/g, " "))).length;
    if (held < first.skillChoices.count) {
      const left = first.skillChoices.count - held;
      out.push(`${left} ${first.name} skill${left === 1 ? "" : "s"}`);
    }
  }
  const asi = asiOwed(sheet, classes);
  if (asi > 0) {
    out.push(`${asi} Ability Score Improvement${asi === 1 ? "" : "s"} (two points, or a feat)`);
  }
  const held = sheet.proficiencies.expertise ?? [];
  const slots = classes.reduce((sum, entry) => sum + expertiseSlotsFor(entry.id, entry.level), 0);
  const classIds = classes.map((entry) => entry.id);
  const open = [...sheet.proficiencies.skills, THIEVES_TOOLS].filter((pick) => expertiseAllowed(pick, sheet.proficiencies.skills, classIds) && !held.includes(pick)).length;
  const expertise = Math.min(Math.max(0, slots - held.length), open);
  if (expertise > 0) {
    out.push(`expertise in ${expertise} more ${expertise === 1 ? "proficiency" : "proficiencies"}`);
  }
  for (const entry of classes) {
    if (subclassOwed(entry, entry.level)) {
      // The class by its words: the sheet dialog and the join confirmation
      // read this line, and printed "a subclass for plague_doctor".
      out.push(`a subclass for ${classWords(entry.id)} (due at ${classWords(entry.id)} level ${subclassLevelFor(entry.id)})`);
    }
  }
  return { levelUp: out, onSheet: owedPickLines(sheet, context) };
}

// Where the sheet's reader makes the class feature's picks: right there
// (their own sheet, on a host that takes them), on the player's own sheet
// (anyone else reading it), or at a level-up that offers them (a host older
// than the sheet's owed picks, which has no route for them).
export type OwedPicksWhere = "here" | "owner" | "level-up";

// The "Choices owed" lines, each true for what it lists: one for what the
// next level-up takes, one for the class feature's picks, saying where those
// are made. "The next level-up takes them" once closed a list whose picks
// the sheet itself offered just below.
export function owedChoicesSentences(groups: OwedChoiceGroups, where: OwedPicksWhere): string[] {
  const lines: string[] = [];
  if (groups.levelUp.length) {
    lines.push(`Earned and not yet made: ${groups.levelUp.join("; ")}. The next level-up takes them.`);
  }
  if (groups.onSheet.length) {
    const lead = groups.levelUp.length ? "A class feature's picks, also owed" : "Earned and not yet made";
    const list = `${lead}: ${groups.onSheet.join("; ")}.`;
    lines.push(
      where === "here"
        ? `${list} Made below, now, without waiting for a level-up.`
        : where === "owner"
          ? `${list} Made on the player's own sheet, without waiting for a level-up.`
          : `${list} Made when a level-up offers the choice.`,
    );
  }
  return lines;
}

// The join confirmation's word on the choices the seat leaves open, said
// where each is made. `onSheet` is the part the character sheet makes (a
// host older than it sends none, so all are the level-up's, as there).
export function joinOwedNote(name: string, owed: string[], onSheet: string[] = []): string {
  const sheetSide = owed.filter((line) => onSheet.includes(line));
  const levelUp = owed.filter((line) => !onSheet.includes(line));
  const lead = `This level earned them and ${name} has not made them yet.`;
  if (!sheetSide.length) {
    return `${lead} The first level-up at this table offers every one, with the usual pickers, and the character sheet lists them until then.`;
  }
  if (!levelUp.length) {
    return `${lead} Once seated, they are made on the character sheet under Choices owed, without waiting for a level-up.`;
  }
  return `${lead} The first level-up at this table offers ${levelUp.join("; ")}. The rest (${sheetSide.join("; ")}) are made on the character sheet under Choices owed once seated, without waiting for a level-up.`;
}

// After the confirm sheet's own pickers: what stays for the first level-up,
// and what the character sheet makes once seated.
export function joinOwedLeft(owed: string[], onSheet: string[] = []): string[] {
  const levelUp = owed.filter((line) => !onSheet.includes(line));
  const sheetSide = owed.filter((line) => onSheet.includes(line));
  return [
    ...(levelUp.length ? [`Left for the first level-up: ${levelUp.join("; ")}.`] : []),
    ...(sheetSide.length ? [`Made on the character sheet once seated: ${sheetSide.join("; ")}.`] : []),
  ];
}

// Whether a class at this class level owes its subclass: it has none, and it
// stands at its subclass level or past it. Past it too, because a character
// gets there without one (a level 1 build seated at a level 5 table), and the
// server takes the pick late. The level-up dialog asks this of the level it
// is about to give, so it offers the step whenever the sheet lists the pick
// as owed; it used to ask only at the exact level, which left such a
// character without a subclass for good, since once play starts the
// level-up is a player's only door to one.
export function subclassOwed(entry: { id: string; subclass?: string }, classLevel: number): boolean {
  const at = subclassLevelFor(entry.id);
  return at !== null && !(entry.subclass ?? "").trim() && at <= classLevel;
}
