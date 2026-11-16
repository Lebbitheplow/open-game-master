// What a counter's Hand card reads to say what the engine will ask: whether a
// fight is on, the beast a Wild Shape or a Polymorph becomes, the DC and the
// reach of a save it forces. Each reads the rule the engine reads
// (src/lib/srd/counter-rules.ts, src/lib/srd/wild-shape-caps.ts), so the card
// cannot offer what use_resource or cast_buff then sends back.
//
// Pure; scripts/test-counter-repairs.mjs drives it.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { HandChoice, HandTurn } from "@/lib/battlemap/hand-core";
import { beastsWithin, crWords, wildShapeCapsFor, BEAST_INDEX } from "@/lib/srd/wild-shape-caps";
import { classLevelFor, classListFor } from "@/lib/srd/multiclass";
import { subclassNamed } from "@/lib/srd/subclass-name";
import { textKey } from "@/lib/language/text-logic";
import { translate } from "@/lib/messages-logic";

// The picker's own words (table.hand.counter.*) read with the hand's
// translator, as the cards do; the beast names are the stat blocks' own and
// stay as they are (the sheet reads them back as the form's value).
type T = (key: string, vars?: Record<string, string | number>) => string;
const enT: T = (key, vars) => translate("en", key, vars);

// A fight is on (true), none is (false), or an older server's Hand cannot
// tell (null). The board view sends no table out of a fight.
export function inFightOf(turn: HandTurn): boolean | null {
  return turn.table === null ? false : turn.table ? true : null;
}

// The beasts this druid can become now (SRD 5.1, Wild Shape: the CR, swim
// and fly ceilings by druid level; Circle of the Moon's higher CR), sent as
// the form use_resource asks for. The card sent none, and every play was sent
// back for "the beast being assumed".
export function wildShapeChoice(sheet: CharacterSheet, t: T = enT): HandChoice {
  const druid = classListFor(sheet).find((entry) => textKey(entry.id) === "druid");
  const level = classLevelFor(sheet, "druid") || sheet.level;
  const moon = subclassNamed(druid?.subclass ?? sheet.subclass ?? "", "Circle of the Moon");
  return {
    arg: "variant",
    label: t("Become"),
    options: beastsWithin(wildShapeCapsFor(level, moon)).map((beast) => ({ value: beast.n, label: beast.n, note: t("CR {cr}", { cr: crWords(beast.cr) }) })),
  };
}

// Polymorph: "any beast whose challenge rating is equal to or less than the
// target's (or the target's level)". The card cannot know the target's, so it
// offers every beast, lowest first, and cast_buff holds the ceiling.
export function polymorphChoice(t: T = enT): HandChoice {
  return {
    arg: "variant",
    label: t("Become"),
    options: BEAST_INDEX.map((beast) => ({ value: beast.n, label: beast.n, note: t("CR {cr}", { cr: crWords(beast.cr) }) })),
  };
}
