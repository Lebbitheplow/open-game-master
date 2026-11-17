import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { owedChoiceGroups } from "@/lib/srd/owed-choices";
import type { OwedContext } from "@/lib/srd/owed-picks-logic";
import { textKey } from "@/lib/language/text-logic";
import type { OwedPicks } from "@/lib/characters/seat-picks";
import { classDisplayNameFor, classLevelWords } from "@/lib/characters/class-words";
import { classWords } from "@/lib/sheet-words";
import type { Locale } from "@/lib/messages-logic";
import { translate } from "@/lib/messages-logic";
import { pluralOf } from "@/lib/messages-logic";

// The shape of a translator, as the pure builders take it
// (src/lib/story-window.ts): the reading surface passes its own, so the
// confirm sheet's sentences read the request's language.
type T = (key: string, vars?: Record<string, string | number>) => string;
const enT: T = (key, vars) => translate("en", key, vars);

// What taking a seat does to a hero, in words, for the confirm sheet a
// player reads before joining (backlog F6, JoinConfirmDialog.tsx). It
// compares the sheet as stored with the sheet the table's door admitted
// (src/lib/characters/seat-preview.ts), so it describes the real join and
// invents nothing: the adapting is src/lib/characters/adapt.ts, the rules
// check is src/lib/characters/admit.ts.
//
// Pure, for scripts/test-seat-confirm.mjs.

export type JoinChanges = {
  // One line per change, in the order a player cares about.
  changes: string[];
  // Choices the level earned and the hero has not made, as the character
  // sheet says (owedChoices): the first level-up takes the class's own.
  owed: string[];
  // The part of `owed` the character sheet makes once seated (a class
  // feature's picks, owed-choices.ts owedChoiceGroups). Absent from an
  // older host, whose every owed line waits for a level-up.
  owedOnSheet?: string[];
};

// What the confirm sheet reads (POST /sheet/preview).
export type JoinPreview = JoinChanges & {
  name: string;
  fromLevel: number;
  toLevel: number;
  // Whether the table's rules let the hero in, and what stops it if not.
  ok: boolean;
  problems: string[];
  // A table that rolls hit points rolls them when the seat is taken, so the
  // number shown here is one throw, not the one the hero keeps.
  rollsHp: boolean;
  // What the confirm sheet may pick of the owed choices before the hero
  // seats (src/lib/characters/seat-picks.ts): read off the hero as it seats
  // with nothing picked, so the pickers stay put while picks are made.
  picks?: OwedPicks;
};

type Sheet = Pick<
  CreateSheetInput,
  "class" | "subclass" | "classes" | "maxHp" | "asiChoices" | "feats" | "features" | "proficiencies" | "spellcasting"
> &
  Partial<Pick<CreateSheetInput, "featChoices" | "race">>;

const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

// The words the slot line counts with, in the reader's language where the
// dictionaries carry them (« 2 × 1er, 1 × 2e »).
export function ordinalOf(t: T, level: number): string {
  return (({ "1": t("1st"), "2": t("2nd"), "3": t("3rd"), "4": t("4th"), "5": t("5th"), "6": t("6th"), "7": t("7th"), "8": t("8th"), "9": t("9th") } as Record<string, string>)[level] ?? "") || ORDINAL[level] || String(level);
}

function spellsOf(sheet: Sheet): string[] {
  const casting = sheet.spellcasting;
  if (!casting) {
    return [];
  }
  const lists = [
    casting.cantrips,
    casting.known,
    casting.prepared,
    casting.spellbook ?? [],
    ...(casting.casters ?? []).flatMap((caster) => [caster.cantrips, caster.known, caster.prepared, caster.spellbook ?? []]),
  ];
  const seen = new Map<string, string>();
  for (const name of lists.flat()) {
    const key = textKey(name);
    if (key && !seen.has(key)) {
      seen.set(key, name.trim());
    }
  }
  return [...seen.values()];
}

function slotLine(sheet: Sheet, t: T): string {
  const slots = Object.entries(sheet.spellcasting?.slots ?? {})
    .filter(([, slot]) => slot.max > 0)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([level, slot]) => `${slot.max} × ${ordinalOf(t, Number(level))}`);
  return slots.join(", ");
}

// "fighter 3 / plague doctor 2": the classes in words, as the rest of the
// confirmation reads them. English keeps the sheet's own words (classWords);
// another language names them where the official-name maps carry it
// (class-words.ts).
function classLine(sheet: Sheet, level: number, locale: Locale): string {
  return classLevelWords({ class: sheet.class, level, classes: sheet.classes }, locale === "en" ? classWords : (id) => classDisplayNameFor(id, locale));
}

export function joinChanges(
  stored: Sheet,
  storedLevel: number,
  seated: Sheet,
  tableLevel: number,
  // Both call shapes: the seat passes the translator first (t-first, the
  // agoLabel pattern), the suites pass the owed context alone or nothing —
  // the reading falls back to the dictionary's English.
  tOrOwed?: T | OwedContext,
  localeOrOwed?: Locale | OwedContext,
  owedArg?: OwedContext,
): JoinChanges {
  const tp = pluralOf(enT);
  const withT = typeof tOrOwed === "function";
  const t = (withT ? tOrOwed : enT) as T;
  const locale = (withT ? (localeOrOwed ?? "en") : "en") as Locale;
  const owedContext = (withT ? owedArg : localeOrOwed ?? tOrOwed ?? {}) as OwedContext;
  const changes: string[] = [];
  if (storedLevel === tableLevel) {
    changes.push(t("Plays at its own level, {level}.", { level: tableLevel }));
  } else if (storedLevel < tableLevel) {
    changes.push(t("Goes up from level {from} to {to} for this table.", { from: storedLevel, to: tableLevel }));
  } else {
    changes.push(t("Plays at level {level} here, down from {from}.", { level: tableLevel, from: storedLevel }));
  }

  const storedClasses = classLine(stored, storedLevel, locale);
  const seatedClasses = classLine(seated, tableLevel, locale);
  if ((stored.classes ?? []).length > 1 && storedClasses !== seatedClasses) {
    changes.push(t("Classes: {stored} becomes {seated}.", { stored: storedClasses, seated: seatedClasses }));
  }

  if (stored.maxHp !== seated.maxHp) {
    changes.push(t("Hit points: {stored} becomes {seated}.", { stored: stored.maxHp, seated: seated.maxHp }));
  }

  const givenBack = (stored.asiChoices ?? []).length - (seated.asiChoices ?? []).length;
  if (givenBack > 0) {
    const seatedFeats = new Set((seated.feats ?? []).map(textKey));
    const feats = (stored.feats ?? []).filter((feat) => !seatedFeats.has(textKey(feat)));
    changes.push(
      feats.length
        ? tp("Gives back {count} Ability Score Improvement this level has not earned, with {feats}.", "Gives back {count} Ability Score Improvements this level has not earned, with {feats}.", { count: givenBack, feats: feats.join(", ") })
        : tp("Gives back {count} Ability Score Improvement this level has not earned.", "Gives back {count} Ability Score Improvements this level has not earned.", { count: givenBack }),
    );
  }

  const seatedSpells = new Set(spellsOf(seated).map(textKey));
  const lostSpells = spellsOf(stored).filter((name) => !seatedSpells.has(textKey(name)));
  if (stored.spellcasting && !seated.spellcasting) {
    changes.push(t("Loses its spellcasting with the class levels it gives back."));
  } else if (lostSpells.length) {
    changes.push(tp("Gives back {count} spell this level cannot hold: {spells}.", "Gives back {count} spells this level cannot hold: {spells}.", { count: lostSpells.length, spells: lostSpells.join(", ") }));
  }

  const storedSlots = slotLine(stored, t);
  const seatedSlots = slotLine(seated, t);
  if (seated.spellcasting && storedSlots !== seatedSlots) {
    changes.push(seatedSlots ? t("Spell slots: {slots}.", { slots: seatedSlots }) : t("No spell slots at this level."));
  }

  // Owed choices read the sheet at the level it plays; the seated sheet's
  // own level field is the table's once stored, so it is given here.
  const groups = owedChoiceGroups({
    class: seated.class,
    subclass: seated.subclass ?? "",
    level: tableLevel,
    classes: seated.classes,
    features: seated.features ?? [],
    proficiencies: seated.proficiencies,
    // The picks a class feature opens (a dragon ancestor), read off the same
    // sheet (owed-picks-logic.ts): the spellbook for Spell Mastery's.
    feats: seated.feats,
    spellcasting: seated.spellcasting,
    featChoices: seated.featChoices,
    race: seated.race,
    // The species' and background's own grants are no class picks, and
    // the languages they leave open are owed (owed-languages.ts).
    background: (seated as { background?: string }).background,
    racialChoices: (seated as { racialChoices?: { skills?: string[] } | null }).racialChoices,
    backgroundChoices: (seated as { backgroundChoices?: { skills?: string[] } | null }).backgroundChoices,
  } as Parameters<typeof owedChoiceGroups>[0], owedContext);

  return { changes, owed: [...groups.levelUp, ...groups.onSheet], owedOnSheet: groups.onSheet };
}
