// What a character of the post-apocalyptic classes makes of one blow, which no
// row on the sheet can say (src/lib/classes/post-apocalyptic-features.json;
// WAVE2 D5). Two doors ask here, and a new clause of either kind is a line
// here, never a check at the door.
//
// The enemy's attack (src/lib/dm/enemy-attack.ts) asks paBlowResists as it
// builds the blow's flags, so the damage path and a reaction's replay of the
// hit meet the same clause (src/lib/dm/pc-damage.ts PcDamageInput.resists):
//
//   One Blood (packmaster)   all damage from a creature neither the packmaster
//                            nor their beast has wounded this fight
//                            (genre-b-post-apocalyptic-pack.ts oneBloodResists)
//   Salvaged Shield Node     "allies inside gain ... resistance to ranged weapon
//     (salvage tech)         damage": a ranged attack that is no spell's, on a
//                            creature carrying the dome's condition
//
// It reads an attack, the one blow the engine knows the dealer and the kind
// of: a breath or a spell's area lands through aoe_damage with neither.
//
// The damage path (src/lib/dm/pc-damage.ts) asks paDamaged once a blow has
// taken hit points and left its target standing:
//
//   Rapid Adaptation         "1/long rest, after taking elemental damage, gain
//     (aberrant)             resistance to that type until you rest": acid, cold,
//                            fire, lightning or thunder, the first such blow
//                            they do not already resist; the resistance is for
//                            what comes after it, until a long rest
//   Hardened Mutation        "1/long rest, regain expended slot levels equal to
//     (aberrant)             your CHA modifier when you drop below half HP"
//
// Both are their counter's only spend (passive in
// src/lib/srd/genre-b-counter-terms.ts): the text names the moment, and no
// call of the player's comes between a blow and what it sets off.
import type { Campaign } from "@/lib/db/campaigns";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { effectiveMaxHp, pcResistances } from "@/lib/dm/condition-logic";
import { oneBloodResists } from "@/lib/dm/genre-b-post-apocalyptic-pack";
import { textKey, words } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { RAPID_ADAPTATION, SHIELD_NODE } from "@/lib/srd/genre-b-post-apocalyptic-conditions";
import { regainSlotLevels } from "@/lib/srd/slot-levels";

const EVERY_TYPE = "acid, bludgeoning, cold, fire, force, lightning, necrotic, piercing, poison, psychic, radiant, slashing, thunder";
const ELEMENTAL = ["acid", "cold", "fire", "lightning", "thunder"];
const RAPID = "post_apocalyptic_rapid_adaptation";
const HARDENED = "post_apocalyptic_hardened_mutation";

type Uses = Record<string, { max: number; used: number }>;

export function paBlowResists(input: {
  campaignId: string;
  encounterId: string;
  attacker: Pick<EncounterEnemy, "id">;
  target: CharacterSheet;
  ranged: boolean;
  spellAttack: boolean;
}): { resists?: string[] } {
  const lines: string[] = [];
  const blood = oneBloodResists(input.campaignId, input.encounterId, input.attacker, input.target);
  if (blood) {
    lines.push(blood);
  }
  if (input.ranged && !input.spellAttack && input.target.conditions.some((entry) => isConditionNamed(entry, SHIELD_NODE))) {
    lines.push(EVERY_TYPE);
  }
  return lines.length ? { resists: lines } : {};
}

// What a blow that took hit points sets off. `before` is the sheet as the blow
// met it; `types` the damage types it carried. Returns what the tool's result
// says of it, empty when nothing answers.
export function paDamaged(campaign: Campaign, before: CharacterSheet, blow: { hpAfter: number; types: string[] }): { adapted?: string; hardened?: string } {
  const out: { adapted?: string; hardened?: string } = {};
  if (!holdsGenreFeature(before, "aberrant", "Rapid Adaptation") && !holdsGenreFeature(before, "aberrant", "Hardened Mutation")) {
    return out;
  }
  let sheet = getSheetById(before.id) ?? before;
  const write = (patch: Parameters<typeof patchSheet>[1]) => {
    const updated = patchSheet(sheet.id, patch);
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      sheet = updated;
    }
  };
  const rapid = (sheet.resources as Uses | undefined)?.[RAPID];
  const resisted = words(textKey(pcResistances(before)));
  const type = blow.types.map((entry) => textKey(entry)).find((entry) => ELEMENTAL.includes(entry) && !resisted.includes(entry));
  if (holdsGenreFeature(before, "aberrant", "Rapid Adaptation") && rapid && rapid.used < rapid.max && type) {
    const mark = `${RAPID_ADAPTATION} (${type})`;
    write({
      conditions: [...sheet.conditions.filter((entry) => !isConditionNamed(entry, mark)), mark],
      conditionMeta: { ...sheet.conditionMeta, [mark]: { untilLongRest: true, source: sheet.id } },
      resources: { ...(sheet.resources as Uses), [RAPID]: { max: rapid.max, used: rapid.used + 1 } },
    });
    out.adapted = `Rapid Adaptation: ${sheet.name} adapts to ${type} damage and resists it from now until a long rest. The use is spent.`;
  }
  const hardened = (sheet.resources as Uses | undefined)?.[HARDENED];
  const max = effectiveMaxHp(before);
  const crossed = before.currentHp * 2 >= max && blow.hpAfter * 2 < max && blow.hpAfter > 0;
  const slots = sheet.spellcasting?.slots;
  if (holdsGenreFeature(before, "aberrant", "Hardened Mutation") && hardened && hardened.used < hardened.max && crossed && slots && sheet.spellcasting) {
    const levels = Math.max(1, computeSheetDerived(sheet).abilityMods.cha ?? 0);
    const back = regainSlotLevels(slots, levels);
    if (back.regained.length) {
      write({
        spellcasting: { ...sheet.spellcasting, slots: back.slots },
        resources: { ...(sheet.resources as Uses), [HARDENED]: { max: hardened.max, used: hardened.used + 1 } },
      });
      out.hardened = `Hardened Mutation: below half their hit points, ${sheet.name} regains ${back.regained.map((level) => `a level ${level} slot`).join(", ")} (${levels} slot level${levels === 1 ? "" : "s"}). The use is spent.`;
    }
  }
  return out;
}
