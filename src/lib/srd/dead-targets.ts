// The cards whose engine path takes a dead creature, never a living one: a
// spell whose mechanics revive (spell-mech-rows.ts `revive`, the field
// heal-spell.ts castHealingSpell routes to its revive on: Revivify, Raise
// Dead, Resurrection, True Resurrection), and the counters listed here, each
// resolved by a door that refuses the living (Hand of Ultimate Mercy:
// src/lib/dm/ultimate-mercy.ts, routed in feature-spends.ts by this list).
//
// The Hand reads the same facts: such a card is aimed at the dead allies
// (handTargets.ts deadAllyTargets), and every other ally card at the living.
// Before this the Hand had no chip for the dead, so Revivify's card offered
// only the living, which the engine refused, and Hand of Ultimate Mercy was
// dealt no card at all.
//
// Pure: no database, so the Hand imports it.

export const DEAD_TARGET_COUNTERS: readonly string[] = ["sub_wholeness_of_body_mercy"];

export function takesTheDead(input: { revives?: unknown; counterId?: string }): boolean {
  return Boolean(input.revives) || (input.counterId !== undefined && DEAD_TARGET_COUNTERS.includes(input.counterId));
}
