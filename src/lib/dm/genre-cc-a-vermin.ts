// Pack Hunting (vermin lord 7): "You and your companion have advantage on
// attacks against a creature the other is adjacent to", wired by the
// 2026-11-13 creator audit's second genre pass. The companion is the dire rat
// Favored of the Swarm stands on the board (src/lib/dm/genre-a-summons.ts);
// "adjacent" is within 5 feet, as the packmaster's Pack Tactics Training reads
// it (src/lib/dm/genre-b-post-apocalyptic-pack.ts), and the same door asks it
// (src/lib/dm/authored-hooks.ts authoredAttackSituation).
import type { EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { withinFeet } from "@/lib/dm/authored-saves";
import { summonsOf } from "@/lib/dm/summon-store";
import { isNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";

const DIRE_RAT = "Favored of the Swarm";
const up = (sheet: CharacterSheet) => sheet.currentHp > 0 && !sheet.deathSaves?.dead;

export function packHunting(campaignId: string, encounterId: string, sheet: CharacterSheet, enemy: Pick<EncounterEnemy, "id" | "displayName">): string | null {
  const isRat = Boolean(sheet.summon?.casterId && isNamed(sheet.summon.spell, DIRE_RAT));
  const lord = isRat ? getSheetById(sheet.summon!.casterId) : sheet;
  if (!lord || !holdsGenreFeature(lord, "vermin_lord", "Pack Hunting")) {
    return null;
  }
  const partners = isRat ? [lord] : summonsOf(campaignId, lord.id, DIRE_RAT);
  const beside = partners.filter(up).find((other) => withinFeet(encounterId, other.id, enemy.id, 5));
  return beside ? `Pack Hunting: ${beside.name} is adjacent to ${enemy.displayName}: advantage` : null;
}
