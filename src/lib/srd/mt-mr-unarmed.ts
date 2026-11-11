// What a monk's subclass makes of the unarmed strike (wave 2, part mr).
// "Those strikes can use Wisdom for attack and damage rolls and deal force
// damage" (Arms of the Astral Self, while the arms last), and "your unarmed
// strikes can deal acid, cold, fire, lightning or poison damage instead of
// bludgeoning" (Draconic Disciple's Draconic Strike). Both were narrated: the
// strike swung with Dexterity and bludgeoned whatever the monk had summoned
// or chosen, so resistance and the to-hit number were the GM's to remember.
//
// Pure. The attack profile reads it (src/lib/dm/pc-attack-profile.ts, as
// AttackStance.unarmedForm of attack-logic.ts), and the dragon monk's aura
// and breath read the chosen type (src/lib/dm/mt-mr-dragon.ts).

import { textKey } from "@/lib/language/text-logic";
import { hasCondition, heldAuthored, type AuthoredSheet } from "@/lib/srd/authored-effects";

// The types Draconic Strike offers (the row's choices, authored-effects-w2-mt-mr.ts).
export const DRACONIC_TYPES = ["Acid", "Cold", "Fire", "Lightning", "Poison"];
export const ASTRAL_ARMS = "arms of the astral self";

export type UnarmedForm = {
  // Another ability's modifier, used for the attack and the damage when it
  // beats the strike's own (Wisdom under the arms).
  mod?: number;
  ability?: string;
  // The damage the strike deals in place of bludgeoning.
  damageType?: string;
  source: string;
};

// The damage type the monk chose for Draconic Strike (use_resource "Draconic
// Strike" with the type as its variant), or null with none chosen.
export function draconicStrikeType(sheet: AuthoredSheet): string | null {
  const held = heldAuthored(sheet).find((row) => row.key === "monk::Draconic Disciple");
  const chosen = textKey(held?.choice ?? "");
  return DRACONIC_TYPES.some((type) => textKey(type) === chosen) ? chosen : null;
}

export function unarmedForm(sheet: AuthoredSheet, mods: Record<string, number>): UnarmedForm | undefined {
  if (hasCondition(sheet, ASTRAL_ARMS) && heldAuthored(sheet).some((row) => row.key === "monk::Arms of the Astral Self")) {
    return { mod: mods.wis ?? 0, ability: "WIS", damageType: "force", source: "Arms of the Astral Self" };
  }
  const type = draconicStrikeType(sheet);
  return type ? { damageType: type, source: "Draconic Strike" } : undefined;
}
