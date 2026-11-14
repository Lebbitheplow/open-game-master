// What the enforcer's later features add to the blows and walks around them
// (WAVE2 D5: the mystery classes' text is the rule, played on the SRD 5.1
// engine; src/lib/classes/mystery-features.json):
//
//   Meat Shield    "Bodyguard works for allies within 10 ft; you move up to
//                  10 ft to intercept": the reach is Bodyguard's own row
//                  (src/lib/srd/authored-effects-genre.ts, 10 feet from 6th
//                  level); the step is here, taken as the blow is taken
//   Solidarity     "When you use Bodyguard, the attacker takes your STR mod +
//                  proficiency in damage"
//   Picket Stance  "Enemies leaving your reach provoke opportunity attacks
//                  even if they Disengage"
//
// Before this each was its sentence in the GM's prompt: Bodyguard refused an
// ally two squares off, the attacker took nothing, and a goblin that
// Disengaged walked away from the picket untouched.
//
// Bodyguard's reaction asks bodyguardExtras once (authored-reactions.ts
// take_for_ally); the enemy's walk asks picketHolds (map-tools.ts, through
// opportunity.ts resolvePcOpportunityAttacks). A new rider on Bodyguard is a
// branch here, never a check in the reaction.
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getBattleMapForEncounter, getTokenByRef, listTokens, placeToken } from "@/lib/db/battle-maps";
import { getEnemy, listEnemies, type Encounter } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { footprintLookup, occupiedTiles } from "@/lib/battlemap/view";
import { tilesApart } from "@/lib/dm/board-reach";
import { checkPlacement } from "@/lib/dm/board-logic";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { attackerFoeId, type LastHit } from "@/lib/dm/last-hit";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { resolveOpportunityAttacks } from "@/lib/dm/opportunity";
import { computeSheetDerived } from "@/lib/srd";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const ENFORCER = "enforcer";
// "you move up to 10 ft to intercept": two squares.
const INTERCEPT_TILES = 2;

type Holder = Pick<CharacterSheet, "id" | "name" | "class" | "features"> & Partial<Pick<CharacterSheet, "classes">>;

// Picket Stance: this character's opportunity attack answers a creature that
// Disengaged before it left their reach.
export function picketHolds(sheet: Holder): boolean {
  return holdsGenreFeature(sheet, ENFORCER, "Picket Stance");
}

// Whether anyone at the table holds the picket, so a Disengaged walk is still
// read for the reaches it leaves.
export function picketStands(campaignId: string): boolean {
  return listSheets(campaignId).some((stale) => picketHolds(getSheetById(stale.id) ?? stale));
}

// The square beside the ally nearest the enforcer, within the two squares the
// intercept covers, that the board lets a token stand on.
function interceptSquare(encounter: Encounter, holderId: string, allyId: string): { from: { x: number; y: number }; to: { x: number; y: number } } | null {
  const map = getBattleMapForEncounter(encounter.id);
  const mine = map ? getTokenByRef(map.id, holderId) : null;
  const theirs = map ? getTokenByRef(map.id, allyId) : null;
  if (!map || !mine || !theirs || tilesApart(mine, theirs) <= 1) {
    return null;
  }
  const tokens = listTokens(map.id);
  const enemies = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  const occupied = occupiedTiles(map, tokens, mine, footprintLookup(enemies));
  let best: { x: number; y: number; steps: number } | null = null;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const x = theirs.x + dx;
      const y = theirs.y + dy;
      const steps = Math.max(Math.abs(x - mine.x), Math.abs(y - mine.y));
      if ((!dx && !dy) || steps > INTERCEPT_TILES || (best && best.steps <= steps)) {
        continue;
      }
      if ("ok" in checkPlacement({ terrain: map.terrain, width: map.width, height: map.height, occupied, x, y })) {
        best = { x, y, steps };
      }
    }
  }
  return best ? { from: { x: mine.x, y: mine.y }, to: { x: best.x, y: best.y } } : null;
}

// What follows a Bodyguard that took an ally's blow: the step to the ally's
// side and what the attacker takes for it. Empty for a holder with neither
// feature, so the reaction's other holders (a same-named feature of another
// class) read nothing here.
export function bodyguardExtras(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter | null,
  holder: CharacterSheet,
  ally: Pick<CharacterSheet, "id" | "name">,
  record: Pick<LastHit, "attacker">,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!encounter) {
    return out;
  }
  if (holdsGenreFeature(holder, ENFORCER, "Meat Shield")) {
    const step = interceptSquare(encounter, holder.id, ally.id);
    const map = step ? getBattleMapForEncounter(encounter.id) : null;
    const token = map ? getTokenByRef(map.id, holder.id) : null;
    if (step && token) {
      placeToken(token.id, step.to.x, step.to.y);
      publishBattleMapUpdate(campaign.id);
      // A step taken with the reaction is the enforcer's own movement (SRD
      // 5.1, Opportunity Attacks: only a creature moved "without using your
      // movement, action, or reaction" provokes none), so a reach it leaves
      // answers it.
      const struck = resolveOpportunityAttacks(campaign, holder.id, step.from, step.to, false);
      out.intercept = `Meat Shield: ${holder.name} moves to ${ally.name}'s side to take the blow.`;
      if (struck.notes.length) {
        out.opportunityAttacks = struck.notes;
      }
    }
  }
  if (holdsGenreFeature(holder, ENFORCER, "Solidarity")) {
    const foeId = attackerFoeId(record);
    const attacker = foeId ? getEnemy(foeId) : null;
    if (attacker && attacker.status === "alive") {
      const derived = computeSheetDerived(holder);
      const amount = Math.max(0, derived.abilityMods.str + derived.proficiencyBonus);
      if (amount > 0) {
        // The text names no damage type: it lands untyped, as dealt.
        out.solidarity = applyEnemyDamage(campaign, turn, encounter, attacker, amount, sheets, sheetsById);
        publishEncounter(campaign.id);
      }
    }
  }
  return out;
}
