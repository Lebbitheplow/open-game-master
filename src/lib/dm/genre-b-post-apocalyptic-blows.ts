// What a character of the post-apocalyptic classes resists of one blow because
// of who dealt it or how, which no resistance on the sheet can say: the enemy's
// attack (src/lib/dm/enemy-attack.ts) asks here as it builds the blow's flags,
// so the damage path and a reaction's replay of the hit meet the same clause
// (src/lib/dm/pc-damage.ts PcDamageInput.resists).
//
//   One Blood (packmaster)  all damage from a creature neither the packmaster
//                           nor their beast has wounded this fight
//                           (genre-b-post-apocalyptic-pack.ts oneBloodResists)
//
// A new clause of this kind is a line here, never a check in enemy-attack.ts.
// It reads an attack, the one blow the engine knows the dealer of: a breath or
// a spell's area lands through aoe_damage with no creature named as its source.
import type { EncounterEnemy } from "@/lib/db/encounters";
import { oneBloodResists } from "@/lib/dm/genre-b-post-apocalyptic-pack";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export function paBlowResists(input: {
  campaignId: string;
  encounterId: string;
  attacker: Pick<EncounterEnemy, "id">;
  target: CharacterSheet;
  ranged: boolean;
  spellAttack: boolean;
}): { resists?: string[] } {
  const lines = [oneBloodResists(input.campaignId, input.encounterId, input.attacker, input.target)].filter((line): line is string => Boolean(line));
  return lines.length ? { resists: lines } : {};
}
