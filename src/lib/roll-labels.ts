// How a roll is worded wherever it is stored or shown: the detail the engine
// writes, the chronicle card, cinematic mode's toast and chronicle line. An
// attack or damage roll records its attacker, who goes in front, and its
// detail says what was used and against whom, so each creature is named
// once. Every other roll, and one stored before the attacker was recorded,
// keeps the sheet it concerns (characterId) in front, as it always has.
// Pure (type imports only), so client components and test scripts import it.
// The kind words are the dictionaries' (rollmap.kind.*); the surface that
// shows them passes its translator.

import type { StoredRoll } from "@/lib/db/rolls";
import { contentName } from "@/lib/content/names";
import { textKey } from "@/lib/language/text-logic";

type Worded = Pick<StoredRoll, "kind" | "detail" | "attacker">;

// The shape of a translator, as the pure sentence builders take it.
type T = ((key: string, vars?: Record<string, string | number>) => string) & { locale?: "en" | "fr" };

function localizeRollWhat(what: string, locale: "en" | "fr"): string {
  if (locale !== "fr" || !what) return what;
  const key = textKey(what);
  const w = contentName("weapons", key, "fr");
  if (w !== key) return w;
  const s = contentName("spells", key, "fr");
  if (s !== key) return s;
  return what;
}

function localizeDetail(detail: string, locale: "en" | "fr"): string {
  if (locale !== "fr" || !detail) return detail;
  const vsAt = detail.indexOf(" vs ");
  if (vsAt > 0) {
    return `${localizeRollWhat(detail.slice(0, vsAt), locale)} c/ ${detail.slice(vsAt + 4)}`;
  }
  const onAt = detail.indexOf(" on ");
  if (onAt > 0) {
    return `${localizeRollWhat(detail.slice(0, onAt), locale)} sur ${detail.slice(onAt + 4)}`;
  }
  return localizeRollWhat(detail, locale);
}

// One target: "Club vs Aria".
export function rollAgainst(what: string, target: string): string {
  return `${what} vs ${target}`;
}

// An area's creatures, or what a fall lands on: "Fireball on Goblin 1, Goblin 2".
// An area that caught only creatures the table cannot see names none.
export function rollOn(what: string, targets: string[]): string {
  return targets.length ? `${what} on ${targets.join(", ")}` : what;
}

// Who made the roll: its attacker, else the sheet it concerns.
export function rollerName(roll: Pick<StoredRoll, "attacker">, sheetName: string | undefined): string | undefined {
  return roll.attacker ? roll.attacker.name : sheetName;
}

// A roll kind as the table reads it, on every card and in cinematic mode.
export const ROLL_KIND_KEYS: Record<string, string> = {
  skill_check: "Skill check",
  saving_throw: "Saving throw",
  ability_check: "Ability check",
  attack: "Attack roll",
  damage: "Damage",
  initiative: "Initiative",
  custom: "Roll",
};

// The kinds' English words, pinned: stored rolls from before the kinds were
// keyed keep reading, and the chronicle the model reads stays the protocol's.
export const ROLL_KIND_LABELS: Record<string, string> = {
  skill_check: "Skill check",
  saving_throw: "Saving throw",
  ability_check: "Ability check",
  attack: "Attack roll",
  damage: "Damage",
  initiative: "Initiative",
  custom: "Roll",
};

export function rollKindLabel(t: T, kind: string): string {
  return t(ROLL_KIND_KEYS[kind] ?? "Roll");
}

// The chronicle card's line: "Goblin · Attack roll (Club vs Aria)".
export function rollCardLabel(t: T, roll: Worded, sheetName: string | undefined): string {
  const who = rollerName(roll, sheetName);
  const locale = t.locale ?? "en";
  const detail = roll.detail ? localizeDetail(roll.detail.replaceAll("_", " "), locale) : "";
  return `${who ? `${who} · ` : ""}${rollKindLabel(t, roll.kind)}${detail ? ` (${detail})` : ""}`;
}

// Cinematic mode's roll pill, up to the dice: "Goblin · Club vs Aria".
export function rollToastLead(t: T, roll: Worded & Pick<StoredRoll, "requestedBy">, sheetName: string | undefined): string {
  const who = rollerName(roll, sheetName);
  const locale = t.locale ?? "en";
  const what = localizeDetail(roll.detail.trim(), locale) || rollKindLabel(t, roll.kind);
  return `${who ? `${who} · ` : roll.requestedBy === "dm" ? t("The GM · ") : ""}${what}`;
}

// Cinematic mode's chronicle line, up to the dice. A roll without an
// attacker keeps the reading it always had: its detail alone, which for a
// roll stored before the attacker was recorded still opens with the roller's
// name.
export function rollChronicleLead(t: T, roll: Worded, sheetName: string | undefined): string {
  const label = rollKindLabel(t, roll.kind);
  const locale = t.locale ?? "en";
  const detail = localizeDetail(roll.detail.trim(), locale);
  if (roll.attacker) {
    return `${roll.attacker.name} · ${detail || label}`;
  }
  return detail || (sheetName ? `${sheetName} · ${label}` : label);
}
