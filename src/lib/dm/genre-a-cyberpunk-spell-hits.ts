// A cyberpunk caster's once-a-turn rider on a program or a psionic that
// struck through a save (WAVE2 D5): Lethal Payload, "1/turn, a damaging
// program deals +1d8 lightning damage to one target", and Neural Spike,
// "1/turn, add your CHA modifier as psychic damage to a damaging psionic".
// A spell attack carries them on its damage roll (attack-damage-riders.ts
// reads genre-a-cyberpunk-programs.ts programRiders); a save spell has no
// such roll to ride, so landSpellDamage (src/lib/dm/cast-at-enemy-damage.ts)
// calls this once the spell's own damage has landed on a creature, as the
// other genre package's helper is called (genre-b-spell-hits.ts). Before
// this the rider rode Fire Bolt and never Acid Splash.
//
// Both paths claim the same key on the caster's turn budget
// (pc-attack-damage.ts claimOncePerTurnRiders: "rider:<feature>"), so a turn
// with a spell attack and a save spell carries the rider once. "One target":
// the first creature of a casting; a creature the spell killed takes none,
// and the claim is kept for the next.
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { claimOncePerTurn } from "@/lib/dm/action-budget";
import { applyEnemyDamage } from "@/lib/dm/enemy-damage";
import { programRiders } from "@/lib/dm/genre-a-cyberpunk-programs";
import { rollCard } from "@/lib/dm/roll-card";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The turn's claim for this rider, taken now; false when it was used this
// turn. Off their own turn a caster casts with their one reaction, once a
// round, so the rider rides; out of a fight there is no turn to count.
function claimOnce(campaignId: string, caster: CharacterSheet, feature: string): boolean {
  const encounter = getActiveEncounter(campaignId);
  const budget = budgetFor(encounter, caster.id, attacksAllowedFor(caster));
  if (!encounter || !budget) {
    return true;
  }
  const claimed = claimOncePerTurn(budget, `rider:${feature.toLowerCase()}`);
  if (!claimed) {
    return false;
  }
  storeBudget(encounter, claimed);
  return true;
}

export function programSpellLanded(input: {
  campaign: Campaign;
  turn: DmTurn;
  encounter: Encounter;
  sheet: CharacterSheet;
  enemy: EncounterEnemy;
  // The first creature of the casting (no shared roll handed in).
  first: boolean;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
}): string[] {
  const lines: string[] = [];
  if (!input.first) {
    return lines;
  }
  const caster = getSheetById(input.sheet.id) ?? input.sheet;
  for (const rider of programRiders(caster)) {
    const target = getEnemy(input.enemy.id) ?? input.enemy;
    if (target.status !== "alive" || target.currentHp <= 0) {
      break;
    }
    if (rider.oncePerTurn && !claimOnce(input.campaign.id, caster, rider.feature)) {
      continue;
    }
    // A flat number rolls no card (roll-card.ts returns it as it stands).
    const amount = rollCard(input.campaign, input.turn, caster.id, "damage", `${rider.feature} on ${target.displayName}`, rider.dice, { kind: "sheet", id: caster.id, name: caster.name }).total ?? 0;
    if (amount <= 0) {
      continue;
    }
    applyEnemyDamage(input.campaign, input.turn, getActiveEncounter(input.campaign.id) ?? input.encounter, target, amount, input.sheets, input.sheetsById, rider.type || undefined, { magical: true, spell: true });
    lines.push(`${rider.feature}: +${amount} ${rider.type ?? ""} damage`.replace("  ", " "));
  }
  return lines;
}
