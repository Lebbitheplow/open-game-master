// Mighty Summoner (the Circle of the Shepherd at 6th level): "Beasts and fey
// you conjure or create with a spell gain 2 extra hit points per Hit Die, and
// their natural weapons are magical for overcoming resistance and immunity to
// nonmagical attacks." The hit points are read at the summoning
// (summon-cast.ts authoredSummonHitPoints); this is the second half, read by
// pc_attack's damage (pc-attack-damage.ts strikesAsMagic). The creature types
// are the feature row's own (its summon_hp_per_hd effect), so the two halves
// cannot drift. Before this the row's note left it to the GM, and a summoned
// wolf's bite was halved by a creature resisting nonmagical attacks.

import { getSheetById } from "@/lib/db/sheets";
import { activeAuthored } from "@/lib/srd/authored-effects";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export function summonStrikesAsMagic(sheet: Pick<CharacterSheet, "summon">): boolean {
  const record = sheet.summon;
  if (!record?.casterId || !record.creatureType) {
    return false;
  }
  const caster = getSheetById(record.casterId);
  if (!caster) {
    return false;
  }
  const kind = textKey(record.creatureType);
  return activeAuthored(caster, "summon_hp_per_hd").some(({ effect }) => effect.types.some((type) => textKey(type) === kind));
}
