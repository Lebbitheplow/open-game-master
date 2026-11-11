// An artificer's Infuse Item (2nd level, src/lib/help/srd-features.json),
// written into the feature's text: at the end of a long rest, out of a fight,
// the artificer lays infusions they know in nonmagical items they carry, as
// many items at a time as the table's Infused Items (two, three from 6th
// level, four from 10th, five from 14th, six from 18th). An item bears one
// infusion and each infusion is in one item at a time; laying one past the
// limit ends the oldest. An infusion ends when its artificer forgets it, and
// as many days after the artificer's death as their Intelligence modifier
// (one at least).
//
// The counter art_infuse_item holds the infusions one long rest lays (its
// row in authored-resources.json, the Infused Items number). The mark rides
// the item's row (`infusion`, src/lib/srd/infusions.ts), so the item keeps it
// wherever it is carried, and every item engine reads it through the magic
// item finders. Called by srd-feature-spends.ts srdFeatureSpend, the
// counter's door; settleInfusions by the clock (src/lib/db/clock.ts).
import type { Campaign } from "@/lib/db/campaigns";
import { getClock } from "@/lib/db/clock";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { spendFeatureUse } from "@/lib/dm/attack-onhit";
import { usesLeft } from "@/lib/dm/bonus-routes";
import { publishSheet } from "@/lib/dm/combat-features";
import { MINUTES_PER_DAY } from "@/lib/dm/calendar";
import { listPriceCp } from "@/lib/dm/trade-value";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { findNamed, textKey } from "@/lib/language/text-logic";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";
import { matchArmor } from "@/lib/srd/armor";
import { matchResource } from "@/lib/srd/class-resources";
import { infusedItemsMax, infusionNamed, infusionOf, replicableAt, RESISTANT_TYPES, type InfusionDef, type InfusionMark } from "@/lib/srd/infusions";
import { armorOf, INFUSE_COUNTER, infusionPicks, knownInfusions, magicProblem, takesProblem, weaponOf } from "@/lib/srd/infusion-picks";
import { classLevelOf } from "@/lib/srd/trait-rules";
import { matchWeapon } from "@/lib/srd/weapons";
import { dismissStrayHomunculi, formHomunculus, HOMUNCULUS } from "@/lib/dm/infusion-servant";

const FEATURE = "Infuse Item";

type Args = { variant?: string; item?: string };

// "Resistant Armor: fire", "Resistant Armor (fire)", "Enhanced Weapon".
function parsePick(variant: string): { name: string; choice: string | null } {
  const text = variant.trim();
  if (infusionNamed(text)) {
    return { name: text, choice: null };
  }
  // The choice after a colon, or in brackets: the documented variant shape.
  const at = [text.indexOf(":"), text.indexOf("(")].filter((index) => index > 0).sort((x, y) => x - y)[0];
  return at === undefined ? { name: text, choice: null } : { name: text.slice(0, at).trim(), choice: text.slice(at + 1).replace(")", "").trim() };
}

// A row with its infusion gone: the attunement and the charges were the
// infusion's, so they go with it.
export function withoutInfusion(row: EquipmentItem): EquipmentItem {
  const rest = { ...row };
  delete rest.infusion;
  delete rest.charges;
  delete rest.attuned;
  delete rest.attuning;
  return rest;
}

type Held = { sheetId: string; index: number; mark: InfusionMark };

// Every infusion one artificer has laid, wherever its item is carried.
function infusionsBy(campaignId: string, artificerId: string): Held[] {
  return listSheets(campaignId).flatMap((stale) => {
    const sheet = getSheetById(stale.id) ?? stale;
    return sheet.equipment.flatMap((row, index) => (row.infusion?.by === artificerId ? [{ sheetId: sheet.id, index, mark: row.infusion }] : []));
  });
}

// Writes each sheet's rows through `change`, publishing the ones it changed.
function rewriteRows(campaign: Campaign, change: (row: EquipmentItem, sheet: CharacterSheet, index: number) => EquipmentItem): void {
  for (const stale of listSheets(campaign.id)) {
    const sheet = getSheetById(stale.id) ?? stale;
    const equipment = sheet.equipment.map((row, index) => change(row, sheet, index));
    if (equipment.some((row, at) => row !== sheet.equipment[at])) {
      patchSheet(sheet.id, { equipment });
      publishSheet(campaign, sheet.id);
    }
  }
}

export function infuseItemSpend(campaign: Campaign, stale: CharacterSheet, resourceName: string, args: Args): ToolResult | null {
  if (matchResource(resourceName)?.id !== INFUSE_COUNTER) {
    return null;
  }
  const sheet = getSheetById(stale.id) ?? stale;
  if (!sheet.resources?.[INFUSE_COUNTER]) {
    return null;
  }
  if (getActiveEncounter(campaign.id)) {
    return { error: `${FEATURE} lays infusions at the end of a long rest, and a fight is on. Nothing was spent.`, refused: "rules" };
  }
  const level = classLevelOf(sheet, "artificer");
  const limit = infusedItemsMax(level);
  if ((usesLeft(sheet, INFUSE_COUNTER) ?? 0) < 1) {
    return { error: `${sheet.name} has laid the ${limit} infusions a long rest allows; the next long rest lays more. Nothing was spent.`, refused: "rules" };
  }
  const known = knownInfusions(sheet);
  const pick = parsePick(args.variant ?? "");
  const def = infusionNamed(pick.name);
  if (!def) {
    // The picks a player could make now, first: an item carried takes each.
    const picks = infusionPicks(sheet, listPriceCp);
    return picks.length
      ? { error: `${FEATURE} needs a variant: ${picks.slice(0, 6).join(" or ")}. Nothing was spent.`, retry: true }
      : { error: `${sheet.name} knows no infusion that an item they carry can take (they know ${known.map((entry) => entry.name).join(", ") || "none"}). Nothing was spent.`, refused: "rules" };
  }
  if (!known.some((entry) => entry.name === def.name)) {
    return { error: `${sheet.name} does not know ${def.name}${level < def.level ? ` (it needs a ${def.level}th level artificer)` : ""}: the infusions they know are ${known.map((entry) => entry.name).join(", ") || "none"}. Nothing was spent.`, refused: "rules" };
  }
  let choice: string | undefined;
  if (def.choose === "damage_type") {
    choice = RESISTANT_TYPES.find((type) => textKey(type) === textKey(pick.choice ?? ""));
    if (!choice) {
      return { error: `${def.name} needs its damage type after a colon in variant ("${def.name}: fire"): ${RESISTANT_TYPES.join(", ")}. Nothing was spent.`, retry: true };
    }
  }
  if (def.choose === "magic_item") {
    const offered = replicableAt(level);
    choice = offered.find((item) => textKey(item) === textKey(pick.choice ?? ""));
    if (!choice) {
      return { error: `${def.name} needs the item it replicates after a colon in variant ("${def.name}: ${offered[0]}"); at ${level}th level ${sheet.name} can replicate ${offered.join(", ")}. Nothing was spent.`, retry: true };
    }
  }
  const named = args.item?.trim();
  const eligible = (row: EquipmentItem) => !takesProblem(def, row, listPriceCp) && !magicProblem(row, sheet.id);
  const row = named
    ? findNamed(sheet.equipment, named, (entry) => [entry.name])
    : (sheet.equipment.find((entry) => entry.equipped && eligible(entry)) ?? sheet.equipment.find(eligible) ?? null);
  if (!row) {
    return { error: `${def.name} is laid in ${takesProblem(def, { name: "" } as EquipmentItem, listPriceCp) ?? "a nonmagical item"} ${sheet.name} carries${named ? `, and they carry no ${named}` : ", and they carry none that is not magic"}. Nothing was spent.`, refused: "rules" };
  }
  const takes = takesProblem(def, row, listPriceCp);
  if (takes) {
    return { error: `${def.name} is laid in ${takes}, and ${row.name} is not one. Nothing was spent.`, refused: "rules" };
  }
  const magic = magicProblem(row, sheet.id);
  if (magic) {
    return { error: `${FEATURE} lays an infusion in a nonmagical item, and ${row.name} ${magic}. Nothing was spent.`, refused: "rules" };
  }
  const now = getClock(campaign.id).instant;
  const weapon = def.takes.endsWith("weapon") ? weaponOf(row) : null;
  const suit = def.takes.startsWith("armor") || def.takes === "shield" ? armorOf(row) : null;
  const base: InfusionMark["base"] = weapon ? { kind: "weapon", name: matchWeapon(row)?.name ?? row.name } : suit ? { kind: "armor", name: matchArmor(row)?.name ?? row.name } : undefined;
  // Laid in the same minute as another, a minute after it: the oldest is
  // always one.
  const latest = Math.max(-1, ...infusionsBy(campaign.id, sheet.id).map((held) => held.mark.at));
  const mark: InfusionMark = { name: def.name, by: sheet.id, byName: sheet.name, level, at: Math.max(now, latest + 1), ...(base ? { base } : {}), ...(choice ? { choice } : {}) };

  // Each infusion in one item, one infusion an item: the same infusion
  // elsewhere ends, and the item's old infusion of this artificer's with it.
  // Rows are rewritten one for one, so the item keeps its place in the list.
  const at = sheet.equipment.indexOf(row);
  rewriteRows(campaign, (entry, holder, index) =>
    entry.infusion?.by === sheet.id && (entry.infusion.name === def.name || (holder.id === sheet.id && index === at)) ? withoutInfusion(entry) : entry,
  );
  // Past the limit the oldest ends.
  const ended: string[] = [];
  const standing = infusionsBy(campaign.id, sheet.id).sort((a, b) => a.mark.at - b.mark.at);
  const over = standing.slice(0, Math.max(0, standing.length - (limit - 1)));
  for (const gone of over) {
    ended.push(gone.mark.name);
  }
  if (over.length) {
    const goneKeys = new Set(over.map((entry) => `${entry.sheetId}:${entry.index}`));
    for (const stale of listSheets(campaign.id)) {
      const holder = getSheetById(stale.id) ?? stale;
      const equipment = holder.equipment.map((entry, index) => (goneKeys.has(`${holder.id}:${index}`) ? withoutInfusion(entry) : entry));
      if (equipment.some((entry, at) => entry !== holder.equipment[at])) {
        patchSheet(holder.id, { equipment });
        publishSheet(campaign, holder.id);
      }
    }
  }
  spendFeatureUse(campaign, sheet.id, INFUSE_COUNTER, `${FEATURE}: ${def.name}${choice ? ` (${choice})` : ""} in ${row.name}`);
  const fresh = getSheetById(sheet.id) ?? sheet;
  // The artificer's other infusions take their level now (Enhanced Weapon's
  // +2 from 10th).
  // One of a stack is infused: the rest stay a plain stack beside it.
  const equipment = fresh.equipment.flatMap((entry, index) => {
    if (index === at) {
      const laid = { ...withoutInfusion(entry), qty: 1, infusion: mark };
      return (entry.qty ?? 1) > 1 ? [{ ...entry, qty: (entry.qty ?? 1) - 1 }, laid] : [laid];
    }
    return [entry.infusion?.by === sheet.id ? { ...entry, infusion: { ...entry.infusion, level } } : entry];
  });
  patchSheet(sheet.id, { equipment });
  publishSheet(campaign, sheet.id);
  // A homunculus forms around its gem, and one whose gem lost the infusion goes.
  const servant = def.name === HOMUNCULUS ? formHomunculus(campaign, sheet.id) : null;
  dismissStrayHomunculi(campaign);
  return {
    ok: true,
    resource: FEATURE,
    ...(servant ? { servant } : {}),
    item: row.name,
    infused: `${def.name}${choice ? ` (${choice})` : ""}`,
    ...(ended.length ? { ended: `Past ${sheet.name}'s ${limit} infused items the oldest ended: ${ended.join(", ")}.` } : {}),
    note: `${row.name} is infused with ${def.name}${choice ? ` (${choice})` : ""}, a magic item for whoever holds it${def.attunement ? " once they attune to it" : ""}. It lasts until the infusion is laid elsewhere, ends past ${sheet.name}'s limit, or ${sheet.name} forgets it or dies.`,
  };
}

// The infusions that end with time and their artificer: one whose artificer
// is gone or no longer knows it ends now; one whose artificer is dead ends
// as many days after the death as their Intelligence modifier (one at least),
// counted from `from`, the first instant the clock saw them dead. Called by
// the clock each time it moves, and by a level's change of infusions.
export function settleInfusions(campaign: Campaign, from: number, to: number): void {
  const artificers = new Map<string, CharacterSheet | null>();
  const artificer = (id: string) => {
    if (!artificers.has(id)) artificers.set(id, getSheetById(id) ?? null);
    return artificers.get(id) ?? null;
  };
  rewriteRows(campaign, (row) => {
    const held = infusionOf(row);
    if (!held) {
      return row;
    }
    const maker = artificer(held.mark.by);
    if (!maker || !knownInfusions(maker).some((def) => def.name === held.def.name)) {
      return withoutInfusion(row);
    }
    if (!maker.deathSaves?.dead) {
      return held.mark.endsAt === undefined ? row : { ...row, infusion: { ...held.mark, endsAt: undefined } };
    }
    const days = Math.max(1, computeSheetDerived(maker).abilityMods.int);
    const endsAt = held.mark.endsAt ?? from + days * MINUTES_PER_DAY;
    if (to >= endsAt) {
      return withoutInfusion(row);
    }
    return held.mark.endsAt === endsAt ? row : { ...row, infusion: { ...held.mark, endsAt } };
  });
  dismissStrayHomunculi(campaign);
}
