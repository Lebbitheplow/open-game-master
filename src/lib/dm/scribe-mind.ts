// An Order of Scribes wizard's Manifest Mind on the board. The mind was a
// condition on the wizard and nothing else, so the 60 feet it appears within,
// the 30 feet it moves, the 300 feet it may stray and the spells "cast from
// its space" were the GM's to imagine. It is a token now: a prop (a Tiny
// spectral object, no stat block), kept beside the condition MANIFEST_MIND,
// which stays what the other features ask (One with the Word). A token whose
// wizard no longer holds the condition is no mind, and is cleared where it is
// read. Everything that places, moves, reads or removes the mind goes
// through here:
//   - use_resource Manifest Mind (authored-spend-effects.ts) manifests it;
//   - move_token moves it (map-tools.ts handleMoveToken), 30 feet for the
//     wizard's bonus action;
//   - a spell that does not reach from the wizard is measured from it, and a
//     use of Manifest Mind casting is spent (cast-reach.ts spellReachProblem,
//     zone-cast.ts placementReachProblem, pc-attack-plan.ts);
//   - the wizard's turn end (turn-end.ts) ends it beyond 300 feet.

import { getBattleMapForEncounter, getTokenByRef, insertToken, listTokens, moveToken, removeTokenByRef, setTokenLight, type BattleMap } from "@/lib/db/battle-maps";
import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, type Encounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { publishEphemeral } from "@/lib/events";
import { blocksMove, tileAt, tileIndex, type BattleToken } from "@/lib/battlemap/types";
import { footprintLookup, occupiedTiles } from "@/lib/battlemap/view";
import { spendAction } from "@/lib/dm/action-budget";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import { spendFeatureUse } from "@/lib/dm/attack-onhit";
import { tilesApart } from "@/lib/dm/board-reach";
import { usesLeft } from "@/lib/dm/bonus-routes";
import { removeConditions } from "@/lib/dm/condition-logic";
import { ownTurnOf } from "@/lib/dm/held-turn";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { isConditionNamed, isNamed } from "@/lib/srd/feature-names";
import type { SpellFacts } from "@/lib/srd/spell-facts";
import { textKey } from "@/lib/language/text-logic";

export const MIND_CONDITION = "manifest mind";
const MIND_REF = "mind:";
const CASTS = "sub_manifest_mind_casts";
const FEET = 5;
// "within 60 feet of you", "move up to 30 feet", "more than 300 feet away".
const MANIFEST_TILES = 60 / FEET;
const MOVE_TILES = 30 / FEET;
const LEASH_TILES = 300 / FEET;

type Square = { x: number; y: number };
type Resolution = ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> };

const refuse = (text: string): ToolError => ({ error: `${text} Nothing was spent.`, refused: "rules" });
const apart = (a: Square, b: Square) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const published = (campaignId: string) => publishEphemeral(campaignId, "battle_map_updated", {});
const holdsMind = (sheet: Pick<CharacterSheet, "conditions"> | null) => Boolean(sheet?.conditions.some((name) => isConditionNamed(name, MIND_CONDITION)));

export function mindRefOf(sheetId: string): string {
  return `${MIND_REF}${sheetId}`;
}

function mindOwnerOf(token: Pick<BattleToken, "kind" | "refId">): string | null {
  return token.kind === "prop" && token.refId.startsWith(MIND_REF) ? token.refId.slice(MIND_REF.length) : null;
}

// The wizard's mind on this map, or null. A token left behind by a mind that
// ended (One with the Word dismissed it, its hour ran out) is cleared here.
export function mindToken(mapId: string, sheetId: string): BattleToken | null {
  const token = getTokenByRef(mapId, mindRefOf(sheetId));
  if (token && !holdsMind(getSheetById(sheetId))) {
    removeTokenByRef(mapId, token.refId);
    return null;
  }
  return token;
}

function openAt(encounterId: string, map: BattleMap, at: Square, mover: BattleToken | null): boolean {
  if (at.x < 0 || at.y < 0 || at.x >= map.width || at.y >= map.height || blocksMove(tileAt(map.terrain, map.width, at.x, at.y))) {
    return false;
  }
  const enemiesById = new Map(listEnemies(encounterId).map((enemy) => [enemy.id, enemy]));
  return !occupiedTiles(map, listTokens(map.id), mover, footprintLookup(enemiesById)).has(tileIndex(map.width, at.x, at.y));
}

// The open square within 60 feet of the wizard nearest `toward` (a creature
// it is sent at), else the nearest to the wizard.
function manifestSquare(encounterId: string, map: BattleMap, wizard: BattleToken, toward: BattleToken | null): Square | null {
  let best: { at: Square; score: number } | null = null;
  for (let x = wizard.x - MANIFEST_TILES; x <= wizard.x + MANIFEST_TILES; x += 1) {
    for (let y = wizard.y - MANIFEST_TILES; y <= wizard.y + MANIFEST_TILES; y += 1) {
      const at = { x, y };
      if (!openAt(encounterId, map, at, null)) continue;
      const score = toward ? tilesApart({ ...wizard, x, y }, toward) * 1000 + apart(at, wizard) : apart(at, wizard);
      if (!best || score < best.score) best = { at, score };
    }
  }
  return best?.at ?? null;
}

// use_resource Manifest Mind: the condition, and the token at x/y (within 60
// feet) or beside the creature named, else beside the wizard.
export function mindSpend(ctx: SpendContext): Resolution {
  const { sheet, campaign } = ctx;
  const meta = { ...(sheet.conditionMeta ?? {}), [MIND_CONDITION]: { rounds: 600 } };
  const patch: FullPatchSheetInput = { conditions: [...new Set([...sheet.conditions, MIND_CONDITION])], conditionMeta: meta as FullPatchSheetInput["conditionMeta"] };
  const encounter = getActiveEncounter(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const wizard = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!encounter || !map || !wizard) {
    return { patch, result: { applied: `${sheet.name}'s spellbook mind hovers within 60 feet of them (no board to place it on): it sheds dim light in 10 feet and sees in darkness to 60 feet.` } };
  }
  let at: Square | null;
  if (typeof ctx.args.x === "number" && typeof ctx.args.y === "number") {
    at = { x: ctx.args.x, y: ctx.args.y };
    if (apart(at, wizard) > MANIFEST_TILES) return refuse(`The mind appears within 60 feet of ${sheet.name}, and (${at.x},${at.y}) is ${apart(at, wizard) * FEET} feet away.`);
    if (!openAt(encounter.id, map, at, null)) return refuse(`(${at.x},${at.y}) is no open square for the mind.`);
  } else {
    const toward = ctx.args.targetEnemyId ? resolveTargetFoe(campaign.id, encounter, ctx.args.targetEnemyId) : null;
    at = manifestSquare(encounter.id, map, wizard, toward ? getTokenByRef(map.id, toward.id) : null);
    if (!at) return refuse(`There is no open square within 60 feet of ${sheet.name} for the mind.`);
  }
  removeTokenByRef(map.id, mindRefOf(sheet.id));
  const placed = insertToken({ mapId: map.id, campaignId: campaign.id, kind: "prop", refId: mindRefOf(sheet.id), name: `${sheet.name}'s spellbook mind`, x: at.x, y: at.y });
  // "It sheds dim light in a 10-foot radius": no bright light, two tiles dim.
  setTokenLight(placed.id, 0, 0, 0, 10 / FEET);
  published(campaign.id);
  return {
    patch,
    result: {
      applied: `${sheet.name}'s spellbook mind hovers at (${at.x},${at.y}), ${apart(at, wizard) * FEET} feet from them: a Tiny spectral object shedding dim light in 10 feet that sees in darkness to 60 feet. move_token "${sheet.name}'s spellbook mind" moves it up to 30 feet for their bonus action; a wizard spell that does not reach from ${sheet.name} is cast from its space, for a use of Manifest Mind casting. It ends if it is ever more than 300 feet from them.`,
      mindAt: at,
    },
  };
}

// Takes the mind off the board and the condition off the wizard. The line,
// or null when there was nothing to end.
function endMind(campaign: Campaign, mapId: string, sheetId: string, why: string): string | null {
  removeTokenByRef(mapId, mindRefOf(sheetId));
  const sheet = getSheetById(sheetId);
  if (!sheet || !holdsMind(sheet)) return null;
  const marks = sheet.conditions.filter((name) => isConditionNamed(name, MIND_CONDITION));
  const cleared = removeConditions(sheet.conditions, sheet.conditionMeta as Parameters<typeof removeConditions>[1], marks);
  patchSheetAudited(campaign.id, sheetId, { conditions: cleared.conditions, conditionMeta: cleared.meta }, { kind: "condition_clock", reason: `their spellbook mind is gone: ${why}`, delta: { ended: marks } });
  published(campaign.id);
  return `${sheet.name}'s spellbook mind is gone: ${why}.`;
}

// As a turn ends: a mind more than 300 feet from its wizard ends.
export function mindTurnEnd(campaign: Campaign, combatantIds: string[]): string[] {
  const encounter = getActiveEncounter(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  if (!map) return [];
  const lines: string[] = [];
  for (const id of combatantIds) {
    const mind = mindToken(map.id, id);
    const wizard = mind ? getTokenByRef(map.id, id) : null;
    if (mind && wizard && apart(mind, wizard) > LEASH_TILES) {
      const line = endMind(campaign, map.id, id, "it was more than 300 feet from them");
      if (line) lines.push(line);
    }
  }
  return lines;
}

// move_token on the mind: null when the token named is no mind, so the
// door's own resolution runs. "When you use a bonus action, you can move it
// up to 30 feet": on the wizard's own turn, for the bonus action. `forced`
// is the table's own hand, which costs nothing.
export function moveMind(campaign: Campaign, encounter: Encounter, map: BattleMap, args: { token: string; x: number; y: number; forced?: boolean }): ToolResult | null {
  const wanted = args.token.trim();
  const mind = listTokens(map.id).find((token) => mindOwnerOf(token) !== null && (token.id === wanted || token.refId === wanted || textKey(token.name) === textKey(wanted)));
  const ownerId = mind ? mindOwnerOf(mind) : null;
  if (!mind || !ownerId || !mindToken(map.id, ownerId)) {
    return null;
  }
  const wizard = getSheetById(ownerId);
  if (!openAt(encounter.id, map, args, mind)) {
    return { error: `(${args.x},${args.y}) is no open square on the ${map.width}x${map.height} map for the mind. Nothing was moved.`, retry: true };
  }
  if (!args.forced) {
    if (!wizard || !ownTurnOf(encounter, ownerId)) {
      return { error: `${mind.name} moves on its wizard's own turn, for their bonus action. Nothing was moved.`, refused: "rules" };
    }
    if (apart(mind, args) > MOVE_TILES) {
      return { error: `${mind.name} moves up to 30 feet for a bonus action, and (${args.x},${args.y}) is ${apart(mind, args) * FEET} feet off. Nothing was moved.`, retry: true };
    }
    const budget = budgetFor(encounter, ownerId, attacksAllowedFor(wizard), conditionTurnShape(wizard.conditions));
    const spent = budget ? spendAction(budget, "bonus", "moving the spellbook mind", wizard.name) : null;
    if (!spent) {
      return { error: `${mind.name} moves for ${wizard.name}'s bonus action on their own turn. Nothing was moved.`, refused: "rules" };
    }
    if (!spent.ok) return toolError(spent);
    storeBudget(encounter, spent.budget);
  }
  moveToken(mind.id, args.x, args.y, mind.movedThisRound);
  published(campaign.id);
  const own = getTokenByRef(map.id, ownerId);
  if (own && apart(args, own) > LEASH_TILES) {
    return { moved: endMind(campaign, map.id, ownerId, "it went more than 300 feet from them") ?? `${mind.name} is gone.` };
  }
  return { moved: `${mind.name} is at (${args.x},${args.y})${own ? `, ${apart(args, own) * FEET} feet from ${wizard?.name ?? "its wizard"}` : ""}${args.forced ? "" : `, for ${wizard?.name}'s bonus action`}.` };
}

// "While it is manifested you can cast a wizard spell from its space": a
// spell that does not reach from the wizard is tried from the mind's square
// (`reachesFrom` asks the door's own range and line with the mind's ref in
// the caster's place). When it reaches, one use of Manifest Mind casting is
// spent here, as the spell is cast, and the mind's square is returned; null
// leaves the door's own refusal standing. Every door that measures a
// character's spell from where they stand asks this when it would refuse.
export function castFromMind(input: {
  encounterId: string;
  casterId: string;
  facts: Pick<SpellFacts, "name" | "classes"> | null;
  reachesFrom: (mind: BattleToken) => boolean;
}): Square | null {
  const map = getBattleMapForEncounter(input.encounterId);
  const mind = map ? mindToken(map.id, input.casterId) : null;
  const sheet = mind ? getSheetById(input.casterId) : null;
  const campaign = sheet ? getCampaignById(sheet.campaignId) : null;
  if (!mind || !sheet || !campaign || !input.facts || !input.facts.classes.some((name) => isNamed(name, "wizard"))) {
    return null;
  }
  if ((usesLeft(sheet, CASTS) ?? 0) < 1 || !input.reachesFrom(mind)) {
    return null;
  }
  return spendFeatureUse(campaign, sheet.id, CASTS, `Manifest Mind casting: ${input.facts.name}`) ? { x: mind.x, y: mind.y } : null;
}
