// The natural attack a character makes an opportunity attack with while a
// creature's statistics replace their own: a beast form (Wild Shape,
// Polymorph) or a summoned creature fighting from a sheet. pc_attack swings
// those forms' own attacks (pc-attack-profile.ts); the reaction reached for
// the sheet's carried weapon, so a druid in wolf form struck with the
// scimitar that merged into the form (SRD 5.1, Wild Shape: "you can't ...
// wield ... equipment that merged into the form"). The melee attack with the
// longest reach, the first listed of those, as a creature's own opportunity
// attack is chosen (enemy-profile.ts opportunityWeapon).

import { drainedNaturalAttack } from "@/lib/srd/creature-drain-logic";
import { findBeastForm } from "@/lib/srd/beast-forms";
import type { CreatureAttack } from "@/lib/srd/creature-attacks";
import { naturalAttackProfile } from "@/lib/dm/natural-attack";
import { summonAttackProfile } from "@/lib/dm/summon-rules";
import type { AttackProfile } from "@/lib/dm/attack-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const TILE = 5;

// Its longest-reaching melee attack: a ranged one (a spit, a thrown rock
// with no reach) makes no opportunity attack.
function meleeAttackOf(attacks: CreatureAttack[]): CreatureAttack | null {
  let best: CreatureAttack | null = null;
  for (const attack of attacks) {
    if (attack.range && !attack.thrown) {
      continue;
    }
    if (!best || (attack.reach ?? TILE) > (best.reach ?? TILE)) {
      best = attack;
    }
  }
  return best;
}

// The form's opportunity attack, its profile null for a form with no melee
// attack (a frog: nothing to swing, its owner's weapons merged into it);
// null for a sheet that fights with its own weapons, or a form the tables do
// not know (pc_attack falls back to the weapons for it too).
export function naturalOpportunity(sheet: Pick<CharacterSheet, "wildShape" | "summon" | "abilities" | "conditions">): { profile: AttackProfile | null } | null {
  const shape = sheet.wildShape;
  if (shape) {
    const attacks = shape.attacks ?? findBeastForm(shape.form)?.attacks ?? null;
    if (!attacks) {
      return null;
    }
    const attack = meleeAttackOf(attacks);
    if (!attack) {
      return { profile: null };
    }
    const profile = naturalAttackProfile(attack, { weapon: `${shape.form} ${attack.name}`, note: `natural attack while transformed (${shape.form})` });
    return { profile: drainedNaturalAttack(profile, { ...sheet.abilities, ...shape.abilities }, sheet.conditions, shape.cr ?? 0) };
  }
  const summon = sheet.summon;
  if (summon) {
    const attack = meleeAttackOf(summon.attacks);
    // Its block's attack as pc_attack builds it (summon-rules.ts).
    const profile = attack ? summonAttackProfile({ name: "", summon }, attack.name) : null;
    return { profile: profile && !("error" in profile) ? drainedNaturalAttack(profile, sheet.abilities, sheet.conditions, summon.cr) : null };
  }
  return null;
}
