import { describeContentEntry } from "@/lib/help";
import { DAMAGE_TYPE_BLURBS, WEAPON_PROPERTY_BLURBS } from "@/lib/help/terms";
import { translate } from "@/lib/messages-logic";
import { armorNamed, type SrdArmor } from "@/lib/srd/armor";
import { packCostCopper, priceText } from "@/lib/srd/currency";
import { magicItemBonus, withoutBonus } from "@/lib/srd/item-row";
import { weaponNamed, type SrdWeapon } from "@/lib/srd/weapons";

// The ⓘ card for a carried thing. An item's facts are scattered: the Open5e
// v1 tables give a Longsword's die and a Plate's AC but no prose and (for
// armour) no weight, the v2 gear rows give prose and weight but no stats, a
// magic item gives rarity and prose, the bundled SRD tables hold the genre
// gear (a Kevlar Vest) the pack never heard of, and a homebrew entry carries
// its own SrdWeapon/SrdArmor block. This folds whatever rows were found into
// one sheet, so the card always leads with weight and value, then armour or
// weapon stats, then the long text when there is any.
//
// Pure: the dialog fetches the rows, this decides what they say, and
// scripts/test-item-sheet.mjs drives it directly.

type Row = Record<string, unknown>;
type T = (key: string, vars?: Record<string, string | number>) => string;
type Locale = "en" | "fr" | "es";

const enT: T = (key, vars) => translate("en", key, vars);

export type ItemProperty = { name: string; blurb: string | null };

export type ItemSheet = {
  // "Martial melee weapon", "Medium armor", "Wondrous item", "Adventuring gear".
  type: string | null;
  rarity: string | null;
  attunement: boolean;
  // A "+1" in the name, applied to AC or to attack and damage.
  bonus: number;
  weight: string | null;
  cost: string | null;
  armor: {
    ac: string;
    // How DEX enters the AC, in words.
    dex: string | null;
    strength: number | null;
    stealthDisadvantage: boolean;
    shield: boolean;
  } | null;
  weapon: {
    damage: string | null;
    damageType: string | null;
    damageBlurb: string | null;
    range: string | null;
    properties: ItemProperty[];
  } | null;
  description: string | null;
};

function str(row: Row | undefined, key: string): string {
  const value = row?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

// "Martial Melee Weapons" is a table heading; one weapon is one of them, and
// the card reads it as a sentence.
function asType(category: string): string {
  return capitalize(category.trim().toLowerCase().replace(/s$/, ""));
}

function formatPounds(pounds: number, t: T): string {
  return t("{n} lb.", { n: Number(pounds.toFixed(2)) });
}

// v1 rows say "3 lb." (armour rows say nothing), v2 rows "5.000" plus a unit,
// homebrew a bare number. A zero means "not recorded", never "weightless".
function weightOf(row: Row, t: T): string | null {
  const value = row.weight;
  if (typeof value === "number") {
    return value > 0 ? formatPounds(value, t) : null;
  }
  const text = str(row, "weight");
  if (!text) {
    return null;
  }
  const pounds = num(text);
  if (pounds === null) {
    return /^0+(\.0+)?\s*lb/i.test(text) ? null : text.replace(/lb\.$/i, t("lb."));
  }
  return pounds > 0 ? formatPounds(pounds, t) : null;
}

function localizeCoins(text: string, locale: Locale): string {
  if (locale !== "fr") return text;
  return text
    .replace(/ gp/g, " po")
    .replace(/ sp/g, " pa")
    .replace(/ cp/g, " pc")
    .replace(/ ep/g, " pe");
}

// v1 rows say "15 gp", v2 rows a bare gold figure ("0.01"), homebrew
// whatever the author typed. Unarmored Defense sits in the armour table at
// "0 gp"; a price on something nobody buys is noise. Written as every price
// is (priceText): a formatter of its own here wrote 0.15 gp as "15 cp" and
// 1.5 gp as "1.5 gp", and passed "0.05 gp" through as the pack prints it.
function costOf(row: Row, t: T, locale: Locale): string | null {
  const text = str(row, "cost");
  if (!text) {
    return null;
  }
  const copper = packCostCopper(text);
  if (copper === null) {
    return t(text);
  }
  return copper > 0 ? localizeCoins(priceText(text), locale) : null;
}

function propertyOf(raw: string, t: T): ItemProperty {
  const trimmed = raw.trim();
  const paren = trimmed.indexOf(" (");
  const base = (paren === -1 ? trimmed : trimmed.slice(0, paren)).toLowerCase();
  const suffix = paren === -1 ? "" : trimmed.slice(paren).replace("(range ", `(${t("range")} `);
  const label = t(capitalize(paren === -1 ? trimmed : trimmed.slice(0, paren)));
  const rawBlurb = WEAPON_PROPERTY_BLURBS[base] ?? null;
  return { name: `${label}${suffix}`, blurb: rawBlurb ? t(rawBlurb) : null };
}

function damageOf(dice: string, type: string, bonus: number, t: T) {
  // A Net's die is "0" (or "0 (restrains)"): it deals no damage.
  const clean = /^0\b/.test(dice) ? "" : dice;
  const lower = type.toLowerCase();
  const rawBlurb = clean ? (DAMAGE_TYPE_BLURBS[lower] ?? null) : null;
  return {
    damage: clean ? (bonus ? `${clean} + ${bonus}` : clean) : null,
    damageType: clean && lower ? t(lower) : null,
    damageBlurb: rawBlurb ? t(rawBlurb) : null,
  };
}

function weaponFromSrd(weapon: SrdWeapon, bonus: number, t: T): NonNullable<ItemSheet["weapon"]> {
  const [dice = "", ...rest] = weapon.damage.split(" ");
  return {
    ...damageOf(dice, rest.join(" "), bonus, t),
    range: weapon.rangeFt ? t("{range} ft.", { range: weapon.rangeFt }) : null,
    properties: (weapon.properties ?? []).map((entry) => propertyOf(entry, t)),
  };
}

function weaponFromPack(row: Row, bonus: number, t: T): NonNullable<ItemSheet["weapon"]> {
  const properties = Array.isArray(row.properties)
    ? row.properties.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    : [];
  // The range lives inside the property text: "thrown (range 20/60)".
  const range = properties
    .map((entry) => /\((?:range\s+)?(\d+\/\d+)\)/i.exec(entry)?.[1])
    .find(Boolean);
  return {
    ...damageOf(str(row, "damage_dice"), str(row, "damage_type"), bonus, t),
    range: range ? t("{range} ft.", { range }) : null,
    properties: properties.map((entry) => propertyOf(entry, t)),
  };
}

function armorFromSrd(armor: SrdArmor, bonus: number, t: T): NonNullable<ItemSheet["armor"]> {
  const shield = armor.category === "shield";
  const base = armor.baseAc + bonus;
  const dex = shield
    ? null
    : armor.dexCap === undefined
      ? t("Add your full Dexterity modifier.")
      : armor.dexCap === 0
        ? t("Dexterity does not add to it.")
        : t("Add your Dexterity modifier, up to +{cap}.", { cap: armor.dexCap });
  const ac = shield
    ? `+${base}`
    : armor.dexCap === undefined
      ? `${base} + ${t("Dex")}`
      : armor.dexCap === 0
        ? String(base)
        : `${base} + ${t("Dex")} (max ${armor.dexCap})`;
  return {
    ac,
    dex,
    strength: armor.strengthRequirement ?? null,
    stealthDisadvantage: Boolean(armor.stealthDisadvantage),
    shield,
  };
}

function armorFromPack(row: Row, bonus: number, t: T): NonNullable<ItemSheet["armor"]> {
  const shield = str(row, "category").toLowerCase() === "shield";
  const baseAc = num(row.base_ac) ?? 0;
  const flat = num(row.plus_flat_mod) ?? 0;
  const acString = str(row, "ac_string")
    .replace(/Dex modifier/g, t("Dex"))
    .replace(/Con modifier/g, t("Con"))
    .replace(/Wis modifier/g, t("Wis"));
  // A shield's row reads "0 +2": it adds to AC rather than setting it.
  const ac = shield && baseAc === 0 ? `+${flat + bonus}` : bonus ? `${acString} (+${bonus})` : acString;
  const usesDex = row.plus_dex_mod === true;
  const cap = num(row.plus_max) ?? 0;
  const strength = num(row.strength_requirement);
  return {
    ac,
    dex: shield
      ? null
      : !usesDex
        ? t("Dexterity does not add to it.")
        : cap > 0
          ? t("Add your Dexterity modifier, up to +{cap}.", { cap })
          : t("Add your full Dexterity modifier."),
    strength: strength && strength > 0 ? strength : null,
    stealthDisadvantage: row.stealth_disadvantage === true,
    shield,
  };
}

// The pack row type, told apart by the fields each table carries.
const isPackWeapon = (row: Row) => "damage_dice" in row;
const isPackArmor = (row: Row) => "base_ac" in row || "ac_string" in row;
const isMagic = (row: Row) => typeof row.rarity === "string" && row.rarity.trim() !== "";
const isHomebrew = (row: Row) => typeof row.itemKind === "string";

// `rows` is every content-pack or homebrew row found for the name, the
// direct slug hit first. Null when neither the rows nor the bundled tables
// know anything about it.
export function buildItemSheet(
  name: string,
  rows: Array<Row | undefined | null>,
  options?: { t?: T; locale?: Locale },
): ItemSheet | null {
  const t = options?.t ?? enT;
  const locale = options?.locale ?? "en";
  const found = rows.filter((row): row is Row => Boolean(row) && typeof row === "object");
  const bonus = magicItemBonus(name);
  const homebrew = found.find(isHomebrew);
  const packWeapon = found.find(isPackWeapon);
  const packArmor = found.find(isPackArmor);
  const magic = found.find(isMagic);

  let armor: ItemSheet["armor"] = null;
  let weapon: ItemSheet["weapon"] = null;
  let type: string | null = null;
  let srdArmor: SrdArmor | null = null;

  const brewArmor = homebrew?.armor as SrdArmor | undefined;
  const brewWeapon = homebrew?.weapon as SrdWeapon | undefined;
  if (brewArmor && typeof brewArmor.baseAc === "number") {
    armor = armorFromSrd(brewArmor, bonus, t);
    type = brewArmor.category === "shield" ? "Shield" : `${capitalize(brewArmor.category)} armor`;
  } else if (brewWeapon && typeof brewWeapon.damage === "string") {
    weapon = weaponFromSrd(brewWeapon, bonus, t);
    type = `${capitalize(brewWeapon.category)} ${brewWeapon.kind} weapon`;
  } else if (packArmor) {
    armor = armorFromPack(packArmor, bonus, t);
    type = asType(str(packArmor, "category")) || "Armor";
    if (type !== "Shield" && !/armor$/i.test(type)) {
      type = `${type} armor`;
    }
    // The pack's armour rows carry no weight; the bundled table does.
    srdArmor = armorNamed(str(packArmor, "name") || name);
  } else if (packWeapon) {
    weapon = weaponFromPack(packWeapon, bonus, t);
    type = asType(str(packWeapon, "category")) || "Weapon";
  } else if ((srdArmor = armorNamed(name))) {
    armor = armorFromSrd(srdArmor, bonus, t);
    type = srdArmor.category === "shield" ? "Shield" : `${capitalize(srdArmor.category)} armor`;
  } else {
    const srdWeapon = weaponNamed(withoutBonus(name));
    if (srdWeapon) {
      weapon = weaponFromSrd(srdWeapon, bonus, t);
      type = `${capitalize(srdWeapon.category)} ${srdWeapon.kind} weapon`;
    }
  }

  // Magic items name what they are ("Weapon (any sword)", "Wondrous item");
  // v2 gear rows carry {name} categories ("Adventuring Gear").
  if (!type && magic) {
    type = capitalize(str(magic, "type")) || null;
  }
  if (!type) {
    const category = found.map((row) => row.category).find((value) => value && typeof value === "object") as
      | { name?: string }
      | undefined;
    type = category?.name ? capitalize(category.name.toLowerCase()) : null;
  }
  if (!type && homebrew) {
    type = homebrew.itemKind === "magic_item" ? "Magic item" : capitalize(String(homebrew.itemKind));
  }
  if (type) {
    type = t(type);
  }

  const weight =
    found.map((row) => weightOf(row, t)).find(Boolean) ?? (srdArmor ? formatPounds(srdArmor.weightLb, t) : null);
  const cost = found.map((row) => costOf(row, t, locale)).find(Boolean) ?? null;
  const description = found.map((row) => describeContentEntry(row)).find(Boolean) ?? null;
  const rawRarity = magic ? capitalize(str(magic, "rarity").toLowerCase()) : null;
  const rarity = rawRarity ? t(rawRarity) : null;
  const attunement = found.some(
    (row) => row.requiresAttunement === true || /attunement/i.test(str(row, "requires_attunement")),
  );

  if (!armor && !weapon && !description && !weight && !cost && !rarity) {
    return null;
  }
  return { type, rarity, attunement, bonus, weight, cost, armor, weapon, description };
}
