// The numbers the server derives for a new character (hit points, armor
// class, coin), each with the one line that says where it comes from. The
// builder shows them; it never lets them be typed, because the server works
// them out again from the same choices when the character is saved.
//
// The lines live in the dictionaries under `builder.derived.*`; each builder
// takes the translator from the component that draws it (the agoLabel
// pattern in home/types.ts), so a language switch rewords the review with
// the rest of the builder. Pure otherwise: no React, no database.
import { contentName } from "@/lib/content/names";
import type { Locale } from "@/lib/messages-logic";
import { fixedDieValue, type HpMethod } from "@/lib/srd/hit-points";
import { formatPrice } from "@/lib/srd/currency";
import { describeWealthDice, startingWealthDice } from "@/lib/srd/starting-wealth";
import type { PurseView } from "./EquipmentSection";
import type { TableRulesState } from "./useTableRules";

// The reading takes the translator from the component that draws the line;
// a test passes translate("en", ...).
type Translator = (key: string, vars?: Record<string, string | number>) => string;

export type DerivedLine = { value: string; reason: string };

export function hitPointsLine(t: Translator, input: {
  hitDie: number;
  level: number;
  maxHp: number;
  range: { min: number; max: number };
  method: HpMethod;
  // A stored character keeps the hit points it came home with.
  kept: boolean;
  // Built in the library, where no table has chosen a method yet.
  atTable: boolean;
  // A class list's dice (backlog F9), the first class's first: each later
  // level counts its own class's die.
  dice?: number[];
}): DerivedLine {
  const { hitDie, level, maxHp, range, method } = input;
  const mixed = new Set(input.dice ?? []).size > 1;
  if (input.kept) {
    return {
      value: String(maxHp),
      reason: t("Kept from the stored character while its level and Constitution stand."),
    };
  }
  const first = t("1st level is the d{die}'s maximum plus Constitution", { die: hitDie });
  if (level <= 1) {
    return { value: String(maxHp), reason: `${first}.` };
  }
  if (mixed) {
    const dice = [...new Set(input.dice)].map((die) => `d${die}`).join(", ");
    const how =
      method === "rolled"
        ? t("rolled by the server when you save")
        : method === "max"
          ? t("at its highest face", { context: "builder.derived.hp.mixedMax" })
          : t("at the table's average");
    return {
      value: method === "rolled" ? t("{min} to {max}", { min: range.min, max: range.max }) : String(maxHp),
      reason: t("{first}; each later level its own class's die ({dice}), {how}, plus Constitution (at least 1).", { first, dice, how }),
    };
  }
  if (method === "rolled") {
    return {
      value: t("{min} to {max}", { min: range.min, max: range.max }),
      reason: t("{first}; the server rolls a d{die} for each later level when you save (every level adds at least 1).", { first, die: hitDie }),
    };
  }
  const later =
    method === "max"
      ? t("each later level the die's highest face, {face}", { face: hitDie })
      : t("each later level the table's average, {average}", { average: fixedDieValue(hitDie) });
  const atTable = input.atTable ? ` ${t("A table that rolls or maximises hit points works them its own way when this character joins.")}` : "";
  return {
    value: String(maxHp),
    reason: t("{first}; {later}, plus Constitution (at least 1).{tail}", { first, later, tail: atTable }),
  };
}

const ABILITY_ABBR_FR: Record<string, string> = { STR: "FOR", WIS: "SAG" };

export function localizeAcPart(part: string, t: Translator, locale: Locale): string {
  if (locale !== "fr") return part;
  const match = /^(.+?)\s+(\+?\d+)$/.exec(part);
  if (!match) return part;
  const [, rawName, num] = match;
  if (rawName === "STR" || rawName === "WIS") {
    return `${ABILITY_ABBR_FR[rawName] ?? rawName} ${num}`;
  }
  if (rawName === "DEX" || rawName === "CON" || rawName === "INT" || rawName === "CHA") {
    return part;
  }
  const translated = t(rawName);
  const name = translated !== rawName ? translated : contentName("items", rawName, locale);
  return `${name} ${num}`;
}

export function localizeAcParts(parts: readonly string[], t: Translator, locale: Locale): string[] {
  return parts.map((part) => localizeAcPart(part, t, locale));
}

export function armorClassLine(t: Translator, ac: number, parts: string[] | undefined, locale: Locale = "en"): DerivedLine {
  return {
    value: String(ac),
    reason: parts?.length
      ? t("From what is worn: {parts}.", { parts: localizeAcParts(parts, t, locale).join(" + ") })
      : t("10 plus Dexterity with nothing worn."),
  };
}

// The purse as the gear step and the review show it.
export function purseViewFor(t: Translator, input: {
  purse: {
    gold: number;
    copper: number;
    spentCopper: number;
    problems: string[];
    method: string;
    receipt?: PurseView["receipt"];
  };
  keepsStoredGear: boolean;
  backgroundName: string;
  backgroundPurse: number;
  classId: string;
  className: string;
  table: TableRulesState;
}): PurseView {
  const { purse, table } = input;
  const spent = purse.spentCopper ? ` ${t("Bought: {price}.", { price: formatPrice(purse.spentCopper) })}` : "";
  const rolledTable = !input.keepsStoredGear && purse.method === "rolled";
  const dice = describeWealthDice(startingWealthDice(input.classId));
  const source = input.keepsStoredGear
    ? t("The coin this character already carries; gear added now is paid from it.{spent}", { spent })
    : rolledTable
      ? table.wealth
        ? t("This table rolls a {className}'s starting wealth in place of the class kit, and every item is bought from it.{spent}", { className: input.className, spent })
        : t("This table rolls a {className}'s starting wealth ({dice}) in place of the class kit. Roll it, then buy your gear.", { className: input.className, dice })
      : t("The {background} background's purse of {amount} gp. The class and background kit is free; anything more is bought from the purse.{spent}", { background: input.backgroundName, amount: input.backgroundPurse, spent });
  return {
    gold: purse.gold,
    copper: purse.copper,
    source,
    problems: [...new Set(purse.problems)],
    ...(purse.receipt ? { receipt: purse.receipt } : {}),
    wealth: rolledTable
      ? {
          dice,
          rolled: table.wealth ? { faces: table.wealth.faces, gold: table.wealth.gold } : null,
          busy: table.wealthBusy,
          error: table.wealthError,
          onRoll: table.rollWealth,
        }
      : null,
  };
}
