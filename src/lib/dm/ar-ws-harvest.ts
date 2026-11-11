// A spell's kill, from every path a character's spell deals damage by.
//
// Grim Harvest (School of Necromancy 2): "Once per turn, killing a creature
// with a spell of 1st level or higher restores twice the spell's level in hit
// points, three times for necromancy spells." The harvest itself is paid by
// the kill hook (authored-hooks.ts authoredOnKill), which takes the spell
// that killed. Before this module only cast_at_enemy told the hook about the
// spell, and it told it the spell's own level: a Fireball through aoe_damage
// and a Ray of Sickness through pc_attack restored nothing, and a Magic
// Missile cast with a 3rd-level slot restored what a 1st-level one does.
//
// Every path that kills with a character's spell names the spell here:
//   - cast_at_enemy (cast-at-enemy-damage.ts landSpellDamage),
//   - aoe_damage with a caster (aoe-damage.ts), through spellKill,
//   - a spell attack through pc_attack (attack-blow.ts landSwingBlow, which
//     both dice paths end in), through authoredOnHit,
//   - Prismatic Spray's rays (prismatic.ts), Fire Shield's retort and Bestow
//     Curse's burn (spell-retort.ts),
//   - a running spell, whose damage lands through spell-aura.ts hurtEnemy and
//     answers a line rather than a death: an area on the board
//     (zone-triggers.ts), an aura and a hold as a turn starts (spell-aura.ts)
//     and Acid Arrow's second burn (spell-turn-end.ts), through
//     runningSpellKill.
// A new spell damage path calls spellKill, or passes killingSpell to the hook.
//
// Ruling: "the spell's level" is the level the spell was cast at. SRD 5.1,
// Casting a Spell at a Higher Level: "When a spellcaster casts a spell using
// a slot that is of a higher level than the spell, the spell assumes the
// higher level for that casting." A cantrip has no slot and is never of 1st
// level or higher, however strong its caster.

import { spellFactsFor, spellMechanicsFor, spellSchoolFor } from "@/lib/content";
import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { authoredOnKill } from "@/lib/dm/authored-hooks";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";

export type KillingCast = {
  spell: string;
  // The spell's own level, where the caller has already resolved it.
  spellLevel?: number;
  // The slot the casting spent, or nothing for a casting that spent none
  // (a cantrip, an item's charge, a granted attack of a spell already cast).
  slotLevel?: number | null;
};

// The level and school the kill hook reads for a casting.
export function killingSpell(campaign: Pick<Campaign, "ownerUserId" | "dmUserId" | "assistantDmUserId">, cast: KillingCast): { level: number; school: string | null } {
  const authors = spellAuthorsFor(campaign);
  const own = cast.spellLevel ?? spellMechanicsFor({ spell: cast.spell, userIds: authors })?.spellLevel ?? spellFactsFor(cast.spell, authors)?.level ?? 1;
  return { level: own >= 1 ? Math.max(own, cast.slotLevel ?? 0) : 0, school: spellSchoolFor(cast.spell, authors) ?? null };
}

// A character's spell dropped the creature to 0: the lines of every feature
// that answers a kill (Grim Harvest for the spell, and the ones that answer
// any kill: Keeper of Souls, Hexblade's Curse).
export function spellKill(campaign: Campaign, encounter: Encounter, enemy: EncounterEnemy, casterId: string, cast: KillingCast): string[] {
  return authoredOnKill(campaign, encounter, enemy, casterId, false, killingSpell(campaign, cast));
}

// The same for a running spell's damage (spell-aura.ts hurtEnemy), which
// tells its caller a line and not whether the creature died: the creature is
// read again. `enemy` is the creature as it stood before the damage. Nothing
// for a spell no character cast (a monster's area).
export function runningSpellKill(campaign: Campaign, encounter: Encounter, enemy: EncounterEnemy, casterId: string | null | undefined, cast: KillingCast): string[] {
  const now = getEnemy(enemy.id);
  if (!casterId || !getSheetById(casterId) || enemy.status !== "alive" || !now || now.status === "alive") {
    return [];
  }
  return spellKill(campaign, encounter, now, casterId, cast);
}
