// heal_area, the authored spend that heals the characters in reach (Turn the
// Tide, Balm of Peace; src/lib/srd/authored-effects-channel.ts). Before it
// both spent the use and the GM was left to roll and apply the healing from
// the card's text.
//
// Every character in reach who can use it is healed: a cleric or paladin never
// chooses to leave a hurt ally out, and nothing here reaches an enemy. One
// roll serves them all unless `each`. Each heal keeps the heal tool's rules
// (src/lib/dm/regain.ts): a character Chill Touch grips is not healed, a beast
// form heals the beast.
//
// A reach of "move" is a walk (Balm of Peace): on the board the holder walks
// up to their speed past the creatures healed, one walk that can come within 5
// feet of each (src/lib/dm/heal-walk-logic.ts), and their token ends where the
// walk does. The walk is the feature's own: it draws no opportunity attack and
// spends none of the turn's movement.

import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef, listTokens, moveToken } from "@/lib/db/battle-maps";
import { getActiveEncounter, listEnemies, type Encounter } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { footprintLookup, occupiedTiles, pcMoveBudget } from "@/lib/battlemap/view";
import { speedToTiles } from "@/lib/battlemap/movement";
import { pcMoveTraits } from "@/lib/battlemap/passage";
import { spaceOf } from "@/lib/dm/board-reach";
import { tokenSides } from "@/lib/dm/combatant";
import { effectiveMaxHp, effectiveSpeed } from "@/lib/dm/condition-logic";
import { withinFeet } from "@/lib/dm/authored-saves";
import { releaseGrapplesOutOfReach } from "@/lib/dm/grapple";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { healWalk } from "@/lib/dm/heal-walk-logic";
import { canRegain, healableHp, regainHitPoints } from "@/lib/dm/regain";
import { diceFor, rollOwnDice } from "@/lib/dm/character-roll";
import { swallowCoverBetween } from "@/lib/dm/swallow";
import type { ToolError } from "@/lib/dm/tool-errors";
import { speedFor } from "@/lib/srd";
import { resolveFormula } from "@/lib/srd/authored-effects";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";

type HealArea = Extract<SpendDoes, { kind: "heal_area" }>;

// The holder's walk on the board, or null off it (the GM narrates the path, and
// every hurt character is taken as one it passes).
function walkOf(campaign: Campaign, encounter: Encounter | null, sheet: CharacterSheet, targets: CharacterSheet[]) {
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!encounter || !map || !token) {
    return null;
  }
  const tokens = listTokens(map.id);
  const enemiesById = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  const footprintOf = footprintLookup(enemiesById);
  const traits = pcMoveTraits({
    width: map.width,
    theme: map.theme, drawnTerrain: map.drawnTerrain,
    tokens,
    mover: token,
    sheet,
    footprintOf,
    enemySize: (refId) => enemiesById.get(refId)?.stats.size,
    sideOf: tokenSides(encounter),
  });
  const board = { terrain: map.terrain, width: map.width, height: map.height, occupied: occupiedTiles(map, tokens, token, footprintOf), flying: token.movement === "fly", traits };
  const on = targets.flatMap((target) => {
    const placed = tokens.find((entry) => entry.refId === target.id);
    return placed ? [{ id: target.id, tiles: spaceOf(placed) }] : [];
  });
  const budget = speedToTiles(pcMoveBudget(campaign.id, encounter, map, sheet, token).speed);
  return { ...healWalk(board, { x: token.x, y: token.y }, budget, on), token, from: { x: token.x, y: token.y } };
}

export function healArea(ctx: SpendContext, does: HealArea): ToolError | { result: Record<string, unknown> } {
  const { campaign, sheet } = ctx;
  const encounter = getActiveEncounter(campaign.id);
  const hurt = (entry: CharacterSheet) => {
    const hp = healableHp(entry, effectiveMaxHp(entry));
    return canRegain(entry) && hp.current < hp.max && (!does.belowHalf || hp.current <= hp.max / 2) && !(does.hears && entry.conditions.some((name) => isConditionNamed(name, "deafened")));
  };
  const party = listSheets(campaign.id)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((entry) => !entry.deathSaves?.dead && !(does.othersOnly && entry.id === sheet.id))
    // Nobody across a swallower's wall is in reach (swallow.ts).
    .filter((entry) => entry.id === sheet.id || !swallowCoverBetween(sheet.id, entry.id))
    .filter(hurt);
  const walks = does.rangeFt === "move";
  const walk = walks ? walkOf(campaign, encounter, sheet, party) : null;
  const rangeFt = typeof does.rangeFt === "number" ? does.rangeFt : effectiveSpeed(sheet.conditions, speedFor(sheet));
  const inReach = walk
    ? walk.order.map((id) => party.find((entry) => entry.id === id)!)
    : party.filter((entry) => entry.id === sheet.id || walks || !encounter || withinFeet(encounter.id, sheet.id, entry.id, rangeFt));
  // "Creatures of your choice" (Turn the Tide): the one named, when one is;
  // every hurt ally in reach healed whoever was named was the bug.
  const named = does.chosen && ctx.args.targetCharacterId ? textKey(ctx.args.targetCharacterId) : null;
  const targets = named ? inReach.filter((entry) => entry.id === ctx.args.targetCharacterId || textKey(entry.name) === named) : inReach;
  if (named && !targets.length) {
    // Said in words a player reads too (the Hand shows the refusal): "only
    // nobody are" was the sentence when no one in reach was hurt.
    const open = inReach.map((entry) => `${entry.name} (${entry.id})`).join(", ");
    const within = open ? `of the characters it heals, only ${open} ${inReach.length === 1 ? "is" : "are"} within ${rangeFt} feet` : `nobody it heals is within ${rangeFt} feet`;
    return { error: `${ctx.spend.name} cannot heal ${ctx.args.targetCharacterId}: ${within}. Nothing was spent.`, retry: true };
  }
  if (!targets.length) {
    const who = does.belowHalf ? "at or under half their hit points" : "hurt";
    const reach = walks ? `${sheet.name} can walk past in ${rangeFt} feet` : `within ${rangeFt} feet${does.othersOnly ? ` of ${sheet.name}` : ""}`;
    return { error: `${ctx.spend.name} heals characters ${who}${does.hears ? " who can hear" : ""} ${reach}, and nobody is. Nothing was spent.`, refused: "rules" };
  }
  const dice = resolveFormula(does.formula, ctx.held.level, ctx.mods);
  // The holder's own dice, whoever they heal (character-roll.ts rollOwnDice):
  // one roll shared out, or one for each creature, which a seat on physical
  // dice rolls one after another.
  const roll = (target?: CharacterSheet) =>
    Math.max(1, Number(rollOwnDice(campaign, sheet, target ? diceFor(`${ctx.spend.name}: healing`, sheet, target) : `${ctx.spend.name}: healing`, dice, { turn: ctx.turn }).total));
  const shared = does.each ? 0 : roll();
  const healed: string[] = [];
  for (const target of targets) {
    // A total shared out (Clockwork Cavalcade's 100 hit points among the
    // creatures in the cube), not each one's.
    const share = does.divided ? Math.max(1, Math.floor(shared / targets.length)) : shared;
    const gained = regainHitPoints(campaign, ctx.turnId, target, does.each ? roll(target) : share, `${ctx.spend.name} (${sheet.name})`);
    const now = getSheetById(target.id) ?? target;
    const hp = healableHp(now, effectiveMaxHp(now));
    healed.push(`${now.name} +${gained} (${hp.current}/${hp.max})`);
  }
  const moved = walk && (walk.end.x !== walk.from.x || walk.end.y !== walk.from.y);
  if (walk && moved) {
    // The feature's own walk: no opportunity attack, and the round's movement
    // count stands, as a reaction's move does (authored-reactions-more.ts).
    moveToken(walk.token.id, walk.end.x, walk.end.y, walk.token.movedThisRound);
    releaseGrapplesOutOfReach(campaign);
    publishBattleMapUpdate(campaign.id);
  }
  const path = walk
    ? moved
      ? `${sheet.name} walks past ${targets.map((entry) => entry.name).join(", then ")} to (${walk.end.x},${walk.end.y}), drawing no opportunity attacks; the token is moved.`
      : `${sheet.name} heals from where they stand.`
    : does.note;
  // The holder's own patch is written after this by the caller from a fresh
  // read, so their own healing above is kept.
  return { result: { healed, ...(path ? { applied: path } : {}) } };
}
