// A death by the sixth level of exhaustion (SRD 5.1, Exhaustion: "6:
// Death"), whichever door brought it: set_condition and the hourly saves
// (set-condition.ts raiseExhaustion), a day short of food or water
// (supplies.ts), a frenzy outliving its rage (frenzy.ts), a disease's or a
// madness's toll (afflictions.ts), Necrotic Husk's level (reaction-counters.ts).
// Each wrote the dead sheet (vitals-logic.ts exhaustionPatch), and only
// set_condition went on to the rest: the spell held on a corpse
// (Concentration: "You lose concentration on a spell if you ... die"), no
// moment of death was written for a revival spell's window, and the
// character's story never said they died. The one path all five take.
import type { Campaign } from "@/lib/db/campaigns";
import { breakConcentration } from "@/lib/dm/concentration";
import { recordDeath } from "@/lib/dm/death";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// `before`: the sheet as it was before the level landed; `level`: the level
// the write reached. True when this write was the death.
export function settleExhaustionDeath(campaign: Campaign, turnId: string | null, before: CharacterSheet, level: number): boolean {
  if (level < 6 || before.deathSaves?.dead) {
    return false;
  }
  breakConcentration(campaign, turnId, before.id, "died of exhaustion");
  recordDeath(campaign, before, "exhaustion");
  return true;
}
