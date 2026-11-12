// An artificer's Spell-Storing Item (11th level, src/lib/help/srd-features.json):
// "After a long rest you store a 1st or 2nd-level artificer spell in an item,
// and whoever holds it can cast it a number of times based on your
// Intelligence." The numbers, written into the feature's text: a spell of one
// action from the artificer's list, laid in a weapon or a spellcasting focus
// the artificer carries; it can be cast twice the artificer's Intelligence
// modifier in times (once at least), with the artificer's spell save DC,
// attack bonus and modifier, and it stays until those castings are spent or
// the feature is used again.
//
// The spell rides the item's row as a Ring of Spell Storing's does
// (storedSpells, with `uses`: src/lib/srd/spell-storing.ts isStoringItem), so
// it is cast the same way, with use_item and the spell, by whoever holds the
// item, and each casting counts down there (ring-store.ts takeFromRing).
// Called by srd-feature-spends.ts srdFeatureSpend, the counter's door.
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { spellFactsFor } from "@/lib/content";
import { spendFeatureUse } from "@/lib/dm/attack-onhit";
import { usesLeft } from "@/lib/dm/bonus-routes";
import { publishSheet } from "@/lib/dm/combat-features";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { findNamed, textKey } from "@/lib/language/text-logic";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { computeSheetDerived, spellAttackFor, spellSaveDcFor } from "@/lib/srd";
import { matchResource } from "@/lib/srd/class-resources";
import { hasItemTag } from "@/lib/srd/item-tags";
import { isStoringItem } from "@/lib/srd/spell-storing";
import { matchWeapon } from "@/lib/srd/weapons";
import { spellOnCasterList } from "@/lib/srd/spell-prep";
import { classLevelOf } from "@/lib/srd/trait-rules";
import { STORABLE_SPELLS } from "@/lib/srd/authored-effects-w2-arcane";

const COUNTER = "art_spell_storing_item";
const FEATURE = "Spell-Storing Item";

type Args = { variant?: string; item?: string };

// What can hold the spell: a weapon, or a focus an artificer casts through.
const holdsSpell = (item: EquipmentItem) => Boolean(matchWeapon(item)) || hasItemTag(item, "tools") || hasItemTag(item, "arcane_focus");

export function spellStoringItemSpend(campaign: Campaign, stale: CharacterSheet, resourceName: string, args: Args): ToolResult | null {
  if (matchResource(resourceName)?.id !== COUNTER) {
    return null;
  }
  const sheet = getSheetById(stale.id) ?? stale;
  if (!sheet.resources?.[COUNTER]) {
    return null;
  }
  if (getActiveEncounter(campaign.id)) {
    return { error: `${FEATURE} is laid in an item at the end of a long rest, and a fight is on. Nothing was spent.`, refused: "rules" };
  }
  if ((usesLeft(sheet, COUNTER) ?? 0) < 1) {
    return { error: `${sheet.name} has stored a spell since their last long rest. Nothing was spent.`, refused: "rules" };
  }
  const wanted = (args.variant ?? "").trim();
  const facts = wanted ? spellFactsFor(wanted, spellAuthorsFor(campaign)) : null;
  if (!facts) {
    return { error: `${FEATURE} needs the spell to store: name a 1st or 2nd-level artificer spell of one action in variant. Nothing was spent.`, retry: true };
  }
  // The artificer's list as the cast guard reads it; a spell the artificer
  // has ready is on it too (a table with no content pack lists no spell
  // under the artificer).
  const view = { classId: "artificer", level: classLevelOf(sheet, "artificer"), subclass: "", ability: "int" } as unknown as Parameters<typeof spellOnCasterList>[0];
  const ready = [...(sheet.spellcasting?.prepared ?? []), ...(sheet.spellcasting?.known ?? [])].some((name) => textKey(name) === textKey(facts.name));
  const onList = ready || STORABLE_SPELLS.some((name) => textKey(name) === textKey(facts.name)) || spellOnCasterList(view, facts);
  if (!onList || facts.level < 1 || facts.level > 2 || facts.castingTime !== "action") {
    return { error: `${facts.name} cannot be stored: ${FEATURE} takes a 1st or 2nd-level spell of the artificer's list that is cast with one action. Nothing was spent.`, refused: "rules" };
  }
  const named = args.item?.trim();
  const item = named ? findNamed(sheet.equipment, named, (row) => [row.name]) : (sheet.equipment.find((row) => row.equipped && holdsSpell(row)) ?? sheet.equipment.find(holdsSpell) ?? null);
  if (!item || !holdsSpell(item)) {
    return { error: `${FEATURE} lays the spell in a weapon or a spellcasting focus ${sheet.name} carries${named ? `, and ${named} is neither` : ", and they carry none"}. Nothing was spent.`, refused: "rules" };
  }
  const derived = computeSheetDerived(sheet);
  const intMod = derived.abilityMods.int;
  const entry = {
    spell: facts.name,
    level: facts.level,
    saveDc: spellSaveDcFor(sheet, facts.name) ?? 8 + derived.proficiencyBonus + intMod,
    attackBonus: spellAttackFor(sheet, facts.name) ?? derived.proficiencyBonus + intMod,
    abilityMod: intMod,
    by: sheet.name,
    uses: Math.max(1, 2 * intMod),
  };
  // "Until you use this feature again": the last item's spell goes, wherever
  // the item went since.
  for (const stale of listSheets(campaign.id)) {
    const holder = getSheetById(stale.id) ?? stale;
    const cleared = holder.equipment.map((row) => (isStoringItem(row) ? { ...row, storedSpells: (row.storedSpells ?? []).filter((one) => !(typeof one.uses === "number" && one.by === sheet.name)) } : row));
    if (holder.id !== sheet.id && cleared.some((row, at) => row !== holder.equipment[at])) {
      patchSheet(holder.id, { equipment: cleared.map((row) => (row.storedSpells?.length ? row : { ...row, storedSpells: undefined })) });
      publishSheet(campaign, holder.id);
    }
  }
  spendFeatureUse(campaign, sheet.id, COUNTER, `${FEATURE}: ${facts.name} in ${item.name}`);
  const now = getSheetById(sheet.id) ?? sheet;
  const equipment = now.equipment
    .map((row) => (isStoringItem(row) ? { ...row, storedSpells: (row.storedSpells ?? []).filter((one) => !(typeof one.uses === "number" && one.by === sheet.name)) } : row))
    .map((row) => (row.name === item.name ? { ...row, storedSpells: [entry] } : row.storedSpells?.length === 0 ? { ...row, storedSpells: undefined } : row));
  patchSheet(sheet.id, { equipment });
  publishSheet(campaign, sheet.id);
  return {
    ok: true,
    resource: FEATURE,
    item: item.name,
    stored: `${facts.name} (level ${facts.level}, save DC ${entry.saveDc}, attack +${entry.attackBonus}), ${entry.uses} ${entry.uses === 1 ? "casting" : "castings"}`,
    note: `${facts.name} is stored in ${item.name}. Whoever holds it casts it with use_item, item "${item.name}" and spell "${facts.name}", with ${sheet.name}'s numbers and no slot; the item holds it until its castings are spent or ${FEATURE} is used again.`,
  };
}
