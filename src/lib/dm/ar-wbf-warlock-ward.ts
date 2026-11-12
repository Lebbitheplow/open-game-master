// Among the Dead (Undying warlock): "An undead that targets you directly with
// an attack or a harmful spell must first make a Wisdom save against your
// spell save DC or choose another target or lose the attack or spell; this
// doesn't protect you from area effects, and an undead that succeeds, or that
// you target with an attack or harmful spell, is immune for 24 hours."
//
// The save is thrown here for both doors a creature targets one character
// through: enemy_attack (src/lib/dm/enemy-attack.ts) and a spell at one
// character (src/lib/dm/cast-at-player.ts). It lived in enemy-attack.ts alone,
// so an undead's Hold Person or Magic Missile asked no save. An area never
// comes here: its door takes a list of creatures and wards none of them.
// Whether a ward stands at all (the creature's type, the immunity a made save
// or the warlock's own attack left) is authored-hooks.ts authoredIncomingAttack.
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { authoredIncomingAttack, WARD_WITHSTOOD } from "@/lib/dm/authored-hooks";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// `lost`: the line for an attack or spell the failed save took; `note`: the
// line for a made save, which leaves the creature immune for 24 hours.
export function authoredWardSave(
  campaign: Campaign,
  turn: DmTurn,
  attacker: EncounterEnemy,
  target: CharacterSheet,
  what: "attack" | "spell" = "attack",
): { lost: string | null; note: string | null } {
  const ward = authoredIncomingAttack({ campaignId: campaign.id, encounterId: "", attacker, target }).ward;
  if (!ward) {
    return { lost: null, note: null };
  }
  const save = rollEnemySave(campaign.id, attacker, ward.save as "wis", ward.dc, {
    magical: true,
    record: { turn, detail: `${attacker.displayName}: ${ward.save.toUpperCase()} save against ${ward.feature}` },
  });
  if (!save.success) {
    const act = what === "spell" ? `cast at ${target.name}; the spell is lost` : `attack ${target.name}; the attack is lost`;
    return { lost: `${ward.feature}: ${attacker.displayName} fails its ${ward.save.toUpperCase()} save (DC ${ward.dc}) and cannot bring itself to ${act}.`, note: null };
  }
  patchEnemyConditions(attacker.id, [...attacker.conditions.filter((entry) => textKey(entry) !== textKey(WARD_WITHSTOOD)), WARD_WITHSTOOD], {
    ...(attacker.conditionMeta as ConditionMetaMap),
    [WARD_WITHSTOOD]: { source: target.id, rounds: 14400 },
  } as typeof attacker.conditionMeta);
  return { lost: null, note: `${ward.feature}: ${attacker.displayName} makes its ${ward.save.toUpperCase()} save (DC ${ward.dc}) and is immune to it for 24 hours.` };
}
