// take_action improvise: an action no other tool names (SRD 5.1, Actions in
// Combat: "an action that you improvise ... the GM tells you whether that
// action is possible and what kind of roll you need to make, if any"). One
// call decides it and lands it, as Shove does (combat-actions.ts contest):
// the model left to land it with a second call skipped the roll, or laid
// the effect on a creature the narration then said was out of reach.
//
//   - Possible: in a fight only (out of one nothing is rationed, and a check
//     is request_roll's). On the model's turn, the thing used must be in the
//     narration of the place the party is in (improvise-logic.ts
//     unshownWords), within reach on the battle map (distanceFt, read from
//     the narration: nothing used is on the map), and beside the creature it
//     reaches; and the character's check must be able to reach the DC.
//     Each refusal spends nothing.
//   - The roll: the character's check against that DC; against a creature,
//     also a contest (SRD 5.1, Contests: "ability checks appropriate to their
//     efforts", as request_roll's contest rolls it, roll-gates.ts), which the
//     check must win: a tie leaves things as they were, so the creature
//     holds. A helpless creature makes no effort, as upstream rules it for a
//     grapple or a shove (combat-actions.ts), not as the SRD words it.
//   - A win lays the effect: a condition from improvise-logic.ts, and damage
//     the server rolls.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getEnemy, type Encounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef, moveToken } from "@/lib/db/battle-maps";
import { sceneSinceSeq } from "@/lib/db/campaigns";
import { getCurrentLocation } from "@/lib/db/locations";
import { listDmMessagesSince } from "@/lib/db/messages";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import { proneCharge } from "@/lib/battlemap/board-move";
import { speedToTiles } from "@/lib/battlemap/movement";
import { TILE_FEET } from "@/lib/battlemap/types";
import { pcMoveBudget } from "@/lib/battlemap/view";
import { movesProne } from "@/lib/battlemap/view-moves";
import { isSheetFoe } from "@/lib/dm/combat-sides-logic";
import { feetBetween } from "@/lib/dm/combat-features";
import { hostileTo } from "@/lib/dm/combatant";
import { incapacitatedBy, removeConditions } from "@/lib/dm/condition-logic";
import { checkCeiling, rollCharacterCheck } from "@/lib/dm/contest-roll";
import { applyEnemyDamage, unknownEnemyRef } from "@/lib/dm/enemy-damage";
import {
  improvisedHold,
  improvisedLasts,
  improvisedMaxSize,
  unshownWords,
  type ImprovisedCondition,
  type ImprovisedDamage,
} from "@/lib/dm/improvise-logic";
import { landTheFlightless } from "@/lib/dm/map-tools";
import { applyRiderCondition } from "@/lib/dm/pc-attack-riders";
import { rollContest, type Opponent } from "@/lib/dm/roll-gates";
import { rollCard } from "@/lib/dm/roll-card";
import { strictnessShift } from "@/lib/dm/safety-logic";
import { swallowCover, swallowerOf } from "@/lib/dm/swallow";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { publishPersisted } from "@/lib/events";
import { ABILITIES } from "@/lib/schemas/abilities";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { TableLanguage } from "@/lib/schemas/game-settings-options";
import { standUpTiles } from "@/lib/srd/authored-effects-more";
import { dcForDifficulty, type DifficultyTier } from "@/lib/srd/dc";
import { findSkill } from "@/lib/srd";
import { ABILITY_NAMES } from "@/lib/srd/legality/types";

// The scene as the story told it: the place as move_party laid it out, the
// GM's recent narration since the party came to it, and the fight's opening
// line; never a player's words, which may name what is not there.
const SCENE_MESSAGES = 100;

export function sceneNarration(campaignId: string, encounterSummary: string | null): string[] {
  // The GM's own lines, counted alone: a window over every message lost the
  // place's first description in a long fight, whose turn and roll notes
  // outnumber the narration.
  const told = listDmMessagesSince(campaignId, sceneSinceSeq(campaignId), SCENE_MESSAGES).map((message) => message.content);
  // The layout GAME STATE shows the model for this place, which the battle
  // map is drawn from: a thing it names is there even before a line of
  // narration repeats it.
  const place = getCurrentLocation(campaignId);
  return [...(place ? [place.name, place.layoutDescription] : []), ...told, ...(encounterSummary ? [encounterSummary] : [])];
}

// What the model must show of the scene; null at the console, whose DM keeps
// their free hand.
export type SceneCheck = {
  quoted: string | undefined;
  distanceFt: number | undefined;
  narration: string[];
  language: TableLanguage;
  // Off their turn, released with the reaction.
  released: boolean;
};

export type ImproviseArgs = {
  reason?: string;
  targetEnemyId?: string;
  skill?: string;
  ability?: SaveAbility;
  contestSkill?: string;
  difficulty?: DifficultyTier;
  condition?: ImprovisedCondition;
  damage?: ImprovisedDamage;
  damageType?: string;
};

// The walk on the battle map to a thing `distanceFt` away, paid from the
// character's movement when the action is spent: the squares past the 5
// feet they reach, priced as the move route prices them (prone: standing up
// first when that fits, else crawling). `pay` is null when the walk does
// not fit, and `reachFt` is then the farthest one that does, as the board
// lights it. A readied action released with the reaction reaches 5 feet:
// the reaction moves no one (SRD 5.1, Ready). Null off the board, where
// nothing counts it.
function boardWalk(
  campaignId: string,
  encounter: Encounter,
  sheet: CharacterSheet,
  released: boolean,
): ((distanceFt: number) => { reachFt: number; pay: (() => void) | null }) | null {
  const map = getBattleMapForEncounter(encounter.id);
  const token = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!map || !token) {
    return null;
  }
  if (released) {
    return (distanceFt) => ({ reachFt: TILE_FEET, pay: distanceFt <= TILE_FEET ? () => {} : null });
  }
  const { speed, tiles, fullTiles } = pcMoveBudget(campaignId, encounter, map, sheet, token);
  return (distanceFt) => {
    const squares = Math.ceil(Math.max(0, distanceFt - TILE_FEET) / TILE_FEET);
    // A crawl costs a foot more for every foot (SRD 5.1, Being Prone).
    const charged =
      squares === 0
        ? { cost: 0, stands: false }
        : movesProne(sheet, false)
          ? proneCharge(squares, squares * 2, standUpTiles(sheet, speedToTiles(speed)), fullTiles)
          : squares <= fullTiles
            ? { cost: squares, stands: false }
            : null;
    return {
      reachFt: tiles * TILE_FEET + TILE_FEET,
      pay: charged && (() => {
        moveToken(token.id, token.x, token.y, token.movedThisRound + charged.cost);
        if (charged.stands) {
          // Read again: spending the action may have ended an invisibility.
          const current = getSheetById(sheet.id) ?? sheet;
          const stood = removeConditions(current.conditions, current.conditionMeta, ["prone"]);
          const updated = patchSheet(sheet.id, { conditions: stood.conditions, conditionMeta: stood.meta });
          if (updated) {
            publishPersisted(campaignId, "sheet_updated", { sheet: updated });
          }
        }
      }),
    };
  };
}

export function improviseAction(
  campaign: Campaign,
  turn: DmTurn,
  sheet: CharacterSheet,
  encounter: Encounter | null,
  args: ImproviseArgs,
  scene: SceneCheck | null,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  spendAction: () => void,
): ToolResult {
  if (!encounter) {
    return {
      error: "An improvised action is a fight's: out of one nothing is rationed, so a check is request_roll's. Nothing was spent.",
      refused: "rules",
    };
  }
  const what = (args.reason ?? "").trim().slice(0, 120);
  if (!what) {
    return {
      error: "An improvised action needs what the character attempts in reason, e.g. reason: 'kicks sand in the bandit's eyes'. Nothing was spent.",
      retry: true,
    };
  }
  // Swallowed (swallow.ts): from inside, the scene the narration shows is
  // outside the swallower, so an action on it reaches nothing; one at the
  // swallower itself is checked below with its target.
  const swallower = swallowerOf(sheet);
  if (swallower && !args.targetEnemyId) {
    const name = getEnemy(swallower)?.displayName ?? "the creature that swallowed them";
    return {
      error: `${sheet.name} is inside ${name}, out of reach of anything in the scene outside it: from there only ${name} can be reached. Nothing was spent.`,
      refused: "rules",
    };
  }
  // The thing's distance on the battle map, and the walk there.
  let thingFt: number | null = null;
  let pay = () => {};
  if (scene) {
    const quoted = (scene.quoted ?? "").trim();
    if (!quoted) {
      return {
        error: "An improvised action needs scene: the thing it uses, copied from the narration ('the chandelier'). Nothing was spent.",
        retry: true,
      };
    }
    const unshown = unshownWords(quoted, scene.narration, scene.language);
    if (unshown.length > 0) {
      return {
        error: `The scene's narration never shows ${unshown.map((word) => `"${word}"`).join(", ")}. Nothing was spent. A thing the narration never shows is not there: tell the player what the scene holds instead, and never stand other words of the scene in for it. Call again only when scene held the deed or your own words for a thing the narration does show: then its words for that same thing.`,
        retry: true,
      };
    }
    const walkTo = boardWalk(campaign.id, encounter, sheet, scene.released);
    if (walkTo) {
      if (scene.distanceFt === undefined) {
        return {
          error: "An improvised action on the battle map needs distanceFt: how far the thing used is from the character, as the narration places it (0 when they hold it, 5 only when it is beside them, never a guess). Nothing was spent.",
          retry: true,
        };
      }
      const walk = walkTo(scene.distanceFt);
      if (!walk.pay) {
        return {
          error: `The thing is ${scene.distanceFt} ft from ${sheet.name}, who can reach ${walk.reachFt} ft ${scene.released ? "with the reaction, which moves no one" : "this turn (movement left plus 5 ft)"}. Nothing was spent. Tell the player it is out of reach, and what they can reach instead.`,
          refused: "rules",
        };
      }
      thingFt = scene.distanceFt;
      pay = walk.pay;
    }
  }
  // The action and the walk to what it uses are spent together.
  const spend = () => {
    spendAction();
    pay();
  };
  const check: { skill: string } | { ability: SaveAbility } | null = args.skill ? { skill: args.skill } : args.ability ? { ability: args.ability } : null;
  if (!check) {
    return {
      error: "An improvised action names the character's check: skill (athletics to topple, sleight_of_hand to untie unseen, deception to bluff) or an ability. Nothing was spent.",
      retry: true,
    };
  }
  const checkName = "skill" in check ? (findSkill(check.skill)?.name ?? check.skill) : ABILITY_NAMES[check.ability];
  // How hard the attempt itself is, against a creature too: lifting a
  // house-sized boulder to hurl it is nearly impossible whoever it is
  // hurled at, and was landed by the goblin's contest alone.
  const dc = args.difficulty ? dcForDifficulty(args.difficulty, strictnessShift(campaign.gameSettings.gm?.strictness ?? "standard")) : null;
  // "The GM tells you whether that action is possible" (SRD 5.1, Actions in
  // Combat), before any roll: a DC past the best the check can total leaves
  // nothing uncertain for the dice to decide, so nothing is spent.
  if (dc !== null) {
    const best = checkCeiling(campaign, sheet, check);
    if (best < dc) {
      return {
        error: `Impossible for ${sheet.name}: ${checkName} totals ${best} at best, and the attempt is DC ${dc}. Nothing was spent. Tell the player in the story that it cannot be done, without numbers, and what they could do instead.`,
        refused: "rules",
      };
    }
  }
  if (!args.targetEnemyId) {
    if (args.condition || args.damage) {
      return {
        error: "A condition or damage lands on a creature: give targetEnemyId, the creature the action reaches; the server rolls its side of the contest. Nothing was spent.",
        retry: true,
      };
    }
    if (dc === null) {
      return {
        error: "An improvised action that reaches no creature is a check against a DC: give difficulty (very_easy to nearly_impossible). Nothing was spent.",
        retry: true,
      };
    }
    spend();
    const mine = rollCharacterCheck(campaign, sheet, { ...check, dc }, `${sheet.name}: ${checkName} to improvise`);
    if (mine.rollId) {
      turn.rollIds.push(mine.rollId);
    }
    const success = mine.total >= dc;
    return {
      ok: true,
      action: "Improvised action",
      check: `${checkName} ${mine.total} vs DC ${dc}`,
      success,
      note: success ? `${sheet.name} manages it: ${what}. Narrate it.` : `${sheet.name} fails: ${what}. Narrate the failure.`,
    };
  }
  if (args.damage && !args.damageType?.trim()) {
    return { error: "Improvised damage needs damageType (bludgeoning for a falling beam, acid for a vat of it). Nothing was spent.", retry: true };
  }
  const enemy = resolveTargetFoe(campaign.id, encounter, args.targetEnemyId);
  if (!enemy) {
    return toolError(unknownEnemyRef(encounter.id, "targetEnemyId", args.targetEnemyId));
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is ${enemy.status}: an improvised action reaches a living creature. Nothing was spent.`, retry: true };
  }
  // Total cover both ways (swallow.ts): a creature inside a swallower is out
  // of reach from outside, and from inside only the swallower is in reach.
  const inside = swallowCover({ kind: "sheet", id: sheet.id }, { kind: isSheetFoe(enemy) ? "sheet" : "enemy", id: enemy.id });
  if (inside) {
    return { error: `${inside} Nothing was spent.`, refused: "rules" };
  }
  if (isSheetFoe(enemy) && !hostileTo(encounter, { kind: "sheet", id: sheet.id }, { kind: "sheet", id: enemy.id })) {
    return { error: `${enemy.displayName} fights on ${sheet.name}'s side: an improvised action here is aimed at a creature of the other side. Nothing was spent.`, refused: "rules" };
  }
  // What the thing does lands beside it: the creature stands within 5 feet
  // of the thing, so no farther from the character than the thing plus 5.
  // A creature with no token has no place on the board to measure.
  if (thingFt !== null) {
    const apart = feetBetween(encounter.id, sheet.id, enemy.id);
    if (apart !== null && apart > thingFt + TILE_FEET) {
      return {
        error: `${enemy.displayName} is ${apart} ft from ${sheet.name}, and the thing used ${thingFt} ft: what an improvised action does lands on a creature within 5 ft of the thing it uses. Nothing was spent. Tell the player the creature is out of its reach, and what the thing can reach instead.`,
        refused: "rules",
      };
    }
  }
  const opponent: Opponent = { name: enemy.displayName, stats: enemy.stats, conditions: enemy.conditions, enemyId: enemy.id, ...(isSheetFoe(enemy) ? { sheetId: enemy.id } : {}) };
  spend();
  // An incapacitated creature makes no effort to resist, as upstream rules a
  // grapple or a shove (combat-actions.ts). One check of the character's
  // meets the DC and beats the creature's.
  const helpless = incapacitatedBy(enemy.conditions);
  const outcome = (() => {
    // contestSkill names a skill or an ability; an ability is rolled bare.
    const resisting = ABILITIES.find((ability) => ability === args.contestSkill);
    const theirs = helpless
      ? null
      : rollContest(campaign, turn, opponent, { ...(resisting ? { ability: resisting } : { ...check, contestSkill: args.contestSkill }), roller: sheet });
    const against = [...(dc === null ? [] : [`DC ${dc}`]), theirs ? `${enemy.displayName}'s ${theirs.skill} ${theirs.total}` : `no contest (${enemy.displayName} is ${helpless})`];
    if (!theirs && dc === null) {
      return { text: against[0], won: true };
    }
    const mine = rollCharacterCheck(campaign, sheet, { ...check, ...(dc === null ? {} : { dc }) }, `${sheet.name}: ${checkName} to improvise against ${enemy.displayName}`);
    if (mine.rollId) {
      turn.rollIds.push(mine.rollId);
    }
    const won = (dc === null || mine.total >= dc) && (!theirs || mine.total > theirs.total);
    return { text: `${checkName} ${mine.total} vs ${against.join(" and ")}`, won };
  })();
  if (!outcome.won) {
    return {
      ok: true,
      action: "Improvised action",
      contest: outcome.text,
      success: false,
      note: `${enemy.displayName} holds: ${what} fails. Nothing landed; narrate the failure.`,
    };
  }
  const landed: string[] = [];
  const said: string[] = [];
  const result: Record<string, unknown> = {};
  if (args.damage && args.damageType) {
    const rolled = rollCard(campaign, turn, sheet.id, "damage", `${sheet.name}: ${what}`.slice(0, 120), args.damage, null);
    Object.assign(result, applyEnemyDamage(campaign, turn, encounter, enemy, rolled.total, sheets, sheetsById, args.damageType));
    landed.push(`${rolled.total} ${args.damageType} damage (${args.damage})`);
  }
  const fresh = resolveTargetFoe(campaign.id, encounter, enemy.id);
  if (args.condition && fresh?.status === "alive") {
    const maxSize = improvisedMaxSize(args.condition);
    const laid = applyRiderCondition(campaign, fresh, args.condition, { meta: improvisedHold(args.condition, fresh.id, sheet.id), ...(maxSize ? { maxSize } : {}) });
    if (laid.applied) {
      landed.push(improvisedLasts(args.condition, sheet.name));
      if (args.condition === "restrained") {
        said.push("It stays restrained until freed: its action and a DC 10 Strength check, which you clear with clear_condition on a success.");
      }
    } else {
      // Said apart from what landed: a refused condition is never followed
      // by "the server applied it" or a restraint that holds.
      said.push(`It is not ${args.condition}: ${laid.reason}`);
    }
    // A flyer knocked prone or held to a speed of 0 falls (token-state.ts).
    const fell = laid.applied ? landTheFlightless(campaign, encounter.id) : [];
    if (fell.length) {
      result.fell = fell.join(" ");
    }
  }
  const head = landed.length ? `${what}: ${enemy.displayName} takes ${landed.join(", ")}. The server applied it.` : `${what}: it reaches ${enemy.displayName}.`;
  return {
    ...result,
    ok: true,
    action: "Improvised action",
    contest: outcome.text,
    success: true,
    applied: landed.length || said.length ? [head, ...said].join(" ") : `${what}: it works on ${enemy.displayName}. Narrate it.`,
  };
}
