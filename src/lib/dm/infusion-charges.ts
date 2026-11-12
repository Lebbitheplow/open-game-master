// The charges of an artificer's infused items (src/lib/srd/infusions.ts),
// spent where the infusion's text spends them, by the wearer's own choice
// made as a player would make it: only when it changes the outcome.
//
//   - Mind Sharpener: "When the wearer fails a Constitution saving throw to
//     maintain concentration on a spell, the wearer can use its reaction to
//     expend 1 of the item's charges to succeed instead." Asked by the
//     concentration save (src/lib/dm/concentration.ts).
//   - Armor of Magical Strength: a charge adds the wearer's Intelligence
//     modifier to a Strength saving throw. Asked by every save the engine
//     rolls for a character (src/lib/dm/forced-save.ts rollCharacterSave),
//     when the bonus turns a failure into a success.
//
// Must not import forced-save.ts or concentration.ts, which import this.
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { markReactionUsed } from "@/lib/dm/turn-budget";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";
import { chargeRuleOf, chargesLeft } from "@/lib/srd/item-charge-rules";
import { priceTheAction, publishSheet } from "@/lib/dm/combat-features";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { infusionWorn, RADIANT_LIT } from "@/lib/srd/infusions";

// The worn infused item of this name with a charge left, and how many.
export function chargedInfusion(sheet: Pick<CharacterSheet, "equipment">, name: string): { row: EquipmentItem; left: number } | null {
  const row = infusionWorn(sheet.equipment, name);
  const rule = row ? chargeRuleOf(row) : null;
  const left = row && rule ? chargesLeft(row, rule) : 0;
  return row && left > 0 ? { row, left } : null;
}

// One charge off the row, wherever it now sits in the list.
export function spendInfusionCharge(campaign: Campaign, sheetId: string, row: EquipmentItem, left: number): void {
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return;
  }
  const at = sheet.equipment.findIndex((entry) => entry.name === row.name && entry.infusion?.name === row.infusion?.name && entry.infusion?.at === row.infusion?.at);
  if (at < 0) {
    return;
  }
  patchSheet(sheet.id, { equipment: sheet.equipment.map((entry, index) => (index === at ? { ...entry, charges: left - 1 } : entry)) });
  publishSheet(campaign, sheet.id);
}

// Spell-Refueling Ring: "recover one expended spell slot as an action. The
// recovered slot can be of 3rd level or lower." The highest such slot spent,
// or null when none is.
export function refuelLevel(sheet: Pick<CharacterSheet, "spellcasting">): number | null {
  const slots = sheet.spellcasting?.slots ?? {};
  const spent = [3, 2, 1].find((level) => (slots[String(level)]?.used ?? 0) > 0);
  return spent ?? null;
}

export function recoverSlot(campaign: Campaign, sheetId: string, level: number): void {
  const sheet = getSheetById(sheetId);
  const slot = sheet?.spellcasting?.slots?.[String(level)];
  if (!sheet?.spellcasting || !slot || slot.used < 1) {
    return;
  }
  patchSheet(sheet.id, { spellcasting: { ...sheet.spellcasting, slots: { ...sheet.spellcasting.slots, [String(level)]: { ...slot, used: slot.used - 1 } } } });
  publishSheet(campaign, sheet.id);
}

// Radiant Weapon's light, lit or put out with the bonus action
// (`variant` "out" puts it out; anything else, or none, turns it over).
export function radiantLight(campaign: Campaign, stale: CharacterSheet, variant: string | undefined): ToolResult {
  const sheet = getSheetById(stale.id) ?? stale;
  const row = infusionWorn(sheet.equipment, "Radiant Weapon");
  if (!row) {
    return { error: `${sheet.name} wields no Radiant Weapon (an artificer's infusion, wielded and attuned). Nothing was spent.`, refused: "rules" };
  }
  const lit = sheet.conditions.some((entry) => textKey(entry) === RADIANT_LIT);
  const light = variant ? !["out", "off", "dark", "douse", "extinguish"].includes(textKey(variant)) && (!lit || ["on", "light", "lit"].includes(textKey(variant))) : !lit;
  if (light === lit) {
    return { error: `${row.name} is ${lit ? "already shedding light" : "already dark"}. Nothing was spent.`, refused: "rules" };
  }
  const priced = priceTheAction(sheet, getActiveEncounter(campaign.id), "Radiant Weapon", "bonus");
  if ("error" in priced) {
    return priced;
  }
  priced.commit();
  patchSheet(sheet.id, { conditions: light ? [...sheet.conditions, RADIANT_LIT] : sheet.conditions.filter((entry) => textKey(entry) !== RADIANT_LIT) });
  publishSheet(campaign, sheet.id);
  return { ok: true, resource: "Radiant Weapon", item: row.name, applied: light ? `${row.name} sheds bright light 30 feet around ${sheet.name} and dim light 30 feet beyond.` : `${row.name}'s light goes out.` };
}

// Whether the wearer's reaction is free: always out of a fight.
function reactionFree(campaign: Campaign, sheetId: string): boolean {
  const live = getActiveEncounter(campaign.id);
  return !live || !live.reactionsUsed.includes(sheetId);
}

export function mindSharpenerSave(campaign: Campaign, sheet: CharacterSheet): string | null {
  const held = chargedInfusion(sheet, "Mind Sharpener");
  if (!held || sheet.currentHp <= 0 || !reactionFree(campaign, sheet.id)) {
    return null;
  }
  spendInfusionCharge(campaign, sheet.id, held.row, held.left);
  const live = getActiveEncounter(campaign.id);
  if (live) {
    markReactionUsed(live, sheet.id);
  }
  return `Mind Sharpener (${held.row.name}): ${sheet.name}'s reaction and a charge (${held.left - 1} left) turn the failed save into a success`;
}

// The bonus a charge of Armor of Magical Strength adds to this Strength
// save, spent when it lifts the total to the DC; null otherwise.
export function magicalStrengthSave(campaign: Campaign, sheet: CharacterSheet, ability: string, total: number, dc: number): { bonus: number; note: string } | null {
  if (ability !== "str" || total >= dc) {
    return null;
  }
  const held = chargedInfusion(sheet, "Armor of Magical Strength");
  const bonus = held ? computeSheetDerived(sheet).abilityMods.int : 0;
  if (!held || bonus <= 0 || total + bonus < dc) {
    return null;
  }
  spendInfusionCharge(campaign, sheet.id, held.row, held.left);
  return { bonus, note: `Armor of Magical Strength (${held.row.name}): a charge (${held.left - 1} left) adds +${bonus}, Intelligence, to the Strength save` };
}
