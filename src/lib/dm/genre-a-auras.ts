// The auras of the cyberpunk, dark fantasy and horror classes that ride
// another character's save or check (the authored kind aura_roll, rows in
// src/lib/srd/authored-effects-genre-a.ts): Combat Calm, Immuno-Shield,
// Litany of Defense, Flinchless, Iron Will, Candlelight Vigil, Master of the
// Board. Every holder in the campaign standing within the aura's reach of the
// roller on the fight's board lends it (out of a fight the party stands
// together); a holder at 0 hit points lends nothing. rollExtrasFor
// (forced-save.ts) asks once per roll, and roll-feature-riders.ts applies
// what fits (src/lib/srd/genre-a-lent.ts), so a GM's request_roll, a forced
// save and a save-ends re-roll all read the same auras.
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { withinFeet } from "@/lib/dm/authored-saves";
import { sideOf } from "@/lib/dm/combatant";
import { activeAuthored } from "@/lib/srd/authored-effects";
import { horrorLentRolls } from "@/lib/dm/genre-a-horror-board";
import type { LentRoll } from "@/lib/srd/genre-a-lent";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export function lentRolls(campaignId: string, roller: CharacterSheet): LentRoll[] {
  const out: LentRoll[] = [];
  const encounter = getActiveEncounter(campaignId);
  const side = encounter ? sideOf(encounter, "sheet", roller.id, roller) : null;
  for (const stale of listSheets(campaignId)) {
    const holder = stale.id === roller.id ? roller : (getSheetById(stale.id) ?? stale);
    if (holder.currentHp <= 0 || holder.deathSaves?.dead) {
      continue;
    }
    const self = holder.id === roller.id;
    if (!self && encounter && sideOf(encounter, "sheet", holder.id, holder) !== side) {
      continue;
    }
    for (const { effect, held } of activeAuthored(holder, "aura_roll")) {
      if (self ? !effect.self : encounter && !withinFeet(encounter.id, holder.id, roller.id, effect.rangeFt)) {
        continue;
      }
      const { die } = effect;
      out.push({
        roll: effect.roll,
        ...(effect.against ? { against: effect.against } : {}),
        ...(effect.magical ? { magical: true as const } : {}),
        ...(effect.abilities ? { abilities: effect.abilities } : {}),
        ...(effect.skills ? { skills: effect.skills } : {}),
        ...(die ? { die } : {}),
        note: `${held.feature} (${self ? "their own" : `${holder.name}'s, within ${effect.rangeFt} ft`}): ${die ? `+${die}` : "advantage"}`,
      });
    }
  }
  // What the roller's own horror features lend from where they stand
  // (Alone in the Dark: src/lib/dm/genre-a-horror-board.ts).
  out.push(...horrorLentRolls(campaignId, roller));
  return out;
}
