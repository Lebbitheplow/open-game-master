import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { releaseLostPins } from "@/lib/dm/grappler-pin";
import { getActiveEncounter, getEnemy, listEnemies, patchEnemyConditions, patchEnemyHp } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef, removeTokenByRef } from "@/lib/db/battle-maps";
import type { DmTurn } from "@/lib/db/dm-turns";
import { autoEndOnVictory, finishEncounter, publishEncounter, resolveEnemyRef, unknownEnemyRef } from "@/lib/dm/enemy-damage";
import { resolvePcOpportunityAttacks } from "@/lib/dm/opportunity";
import { addEnemiesTool, handleAddEnemies } from "@/lib/dm/encounter-spawn";
import { handleLairAction, handleLegendaryAction, handleLegendaryResist, legendaryTools } from "@/lib/dm/legendary-tools";
import { declareIntentTool, handleDeclareIntent } from "@/lib/dm/intent-tools";
import { canonicalCondition } from "@/lib/dm/mutations";
import { conditionNameRefusal } from "@/lib/dm/set-condition";
import { instancesOf, pruneMeta, wakesOnDamage, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { petrifiedRefusal } from "@/lib/dm/damage-logic";
import { AI_BIND_REFUSAL, AI_CLEAR_REFUSAL, bindsCreature, engineKept } from "@/lib/dm/ai-boundary";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { layEnemyConditionInstance } from "@/lib/dm/enemy-condition-lay";
import { setEnemyExhaustion } from "@/lib/dm/enemy-exhaustion";
import { enemyCallOutOfTurn, enemyFleeTurnRefusal, enemyTurnRefusal } from "@/lib/dm/enemy-turn-order";
import { characterCallUnasked } from "@/lib/dm/player-word";
import { standUpIfProne } from "@/lib/dm/enemy-approach";
import { enemyMoveBudget, enemySpeedTiles } from "@/lib/dm/enemy-speed";
import { namesExhaustion, PRONE } from "@/lib/dm/vitals-logic";
import { normalizeAbility } from "@/lib/dm/arg-coerce";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { aoeDamageTool, handleAoeDamage } from "@/lib/dm/aoe-damage";
import { badArguments, type ToolResult } from "@/lib/dm/tool-errors";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { enemyExhaustion } from "@/lib/dm/monster-abilities";
import { isKnockedOut } from "@/lib/dm/knockout";
import { canEnemyAct } from "@/lib/dm/can-act";
import { releaseGrapplesHeldByAny } from "@/lib/dm/grapple";
import { standingOn } from "@/lib/dm/combatant";
import { leftBehind, swallowCoverError } from "@/lib/dm/swallow";

// Encounter tools beyond the core start/damage/attack/end set:
// reinforcements, enemy flight, enemy conditions, and multi-target AoE.
// Imports point downward only (enemy-damage, encounter-spawn, map-tools,
// db); this module must never import encounter-tools.

export const EXTRA_ENCOUNTER_TOOL_NAMES = [
  "add_enemies",
  "enemy_flees",
  "set_enemy_condition",
  "clear_enemy_condition",
  "aoe_damage",
  "legendary_action",
  "legendary_resist",
  "lair_action",
  "declare_intent",
] as const;

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

const enemyFleesTool: ToolDef = {
  type: "function",
  function: {
    name: "enemy_flees",
    description:
      "Record an enemy escaping the fight: it runs, teleports away, dives underwater, or otherwise leaves. Call it BEFORE narrating the escape; its token leaves the map. The server rolls the opportunity attacks its going draws: the result lists them, and one may stop it. When no enemies remain the encounter ends automatically with reduced XP.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        enemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
        teleport: { type: "boolean", description: "True when it teleports away: no opportunity attacks." },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: ["enemyId"],
    },
  },
};

export const extraEncounterTools: ToolDef[] = [
  addEnemiesTool,
  enemyFleesTool,
  aoeDamageTool,
  ...legendaryTools,
  declareIntentTool,
];

const enemyRefArgsSchema = z.object({
  enemyId: z.string(),
  condition: z.string().optional(),
  rounds: z.coerce.number().int().min(1).max(100).optional(),
  saveAbility: z.preprocess(
    normalizeAbility,
    z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional(),
  ),
  saveDc: z.coerce.number().int().min(1).max(30).optional(),
  // Who put the condition there: the grappler, the charmer, the source of
  // the fear. Kept as the condition's source.
  sourceCharacterId: z.string().max(80).optional(),
  sourceEnemyId: z.string().max(80).optional(),
  // Exhaustion only: the level it now has (1 to 6).
  level: z.coerce.number().int().min(1).max(6).optional(),
  // From magic: Magic Resistance applies to the save against it.
  magical: z.coerce.boolean().optional(),
  // enemy_flees only: it teleports out of the fight instead of walking out.
  teleport: z.coerce.boolean().optional(),
  reason: z.string().optional(),
});

// A step no reach on this board follows: where a creature leaving the fight
// goes, for the opportunity attacks its going draws.
function pastEveryReach(map: { width: number; height: number }, from: { x: number; y: number }): { x: number; y: number } {
  return { x: from.x, y: from.y - (map.width + map.height) };
}

function handleEnemyFlees(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter: enemy_flees works only in a fight.", retry: true };
  }
  let args: z.infer<typeof enemyRefArgsSchema>;
  try {
    args = enemyRefArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: enemy_flees needs enemyId.", error, rawArguments);
  }
  const enemy = resolveEnemyRef(encounter.id, args.enemyId);
  if (!enemy) {
    return unknownEnemyRef(encounter.id, "enemyId", args.enemyId);
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is already ${enemy.status}.`, retry: true };
  }
  // A creature lying knocked out cannot run (issue #667): it is unconscious
  // and stays where it fell until it comes to, or is carried off.
  if (isKnockedOut(enemy)) {
    return { error: `${enemy.displayName} is knocked out: unconscious, they cannot flee. They stay where they fell.`, refused: "rules" };
  }
  // A creature goes on its own turn while initiative runs (SRD 5.1: it moves
  // on its turn), at the console too (enemy-turn-order.ts
  // enemyFleeTurnRefusal). A legendary creature may still go on a legendary
  // action, as on move_token.
  const early = encounter.legendary.pools[enemy.id] ? null : enemyFleeTurnRefusal(encounter, enemy, turn);
  if (early) {
    return early;
  }
  // Fleeing is a walk out of the fight, held to what holds its walk on the
  // board (can-act.ts canEnemyAct "move", and its speed): a Hold Person'd
  // bandit captain escaped on the AI's word while move_token would not move
  // it a square.
  const walks = canEnemyAct({ enemy, encounter, kind: "move" });
  if (!walks.ok) {
    return { error: `${walks.error} It cannot flee.`, refused: "rules" };
  }
  // A teleport is not a walk: speed 0 does not hold it (a grappled mage's
  // Misty Step), and it draws nothing (SRD 5.1, Opportunity Attacks: "You
  // also don't provoke an opportunity attack when you teleport").
  const teleports = args.teleport === true;
  if (!teleports && enemySpeedTiles(enemy) === 0) {
    const held = enemy.conditions.find((entry) => isConditionNamed(entry, "grappled", "restrained"));
    return {
      error: `${enemy.displayName}'s speed is 0${held ? ` (${held})` : ""}: it cannot run from the fight. It breaks free first (take_action escape), or leaves by magic it casts (teleport: true).`,
      refused: "rules",
    };
  }
  // The walk out takes it out of every reach it stands in, and draws what any
  // walk of its own draws (SRD 5.1, Opportunity Attacks: "when a hostile
  // creature that you can see moves out of your reach"). The token was taken
  // off the board where it stood, so a wounded gnoll beside the fighter left
  // the fight untouched, and the swing asked for afterwards was refused: it
  // had already fled. A Disengage it took this turn holds, as on move_token.
  const map = getBattleMapForEncounter(encounter.id);
  const token = map ? getTokenByRef(map.id, enemy.id) : null;
  const struck = map && token && !teleports
    ? resolvePcOpportunityAttacks(campaign, enemy.id, { x: token.x, y: token.y }, pastEveryReach(map, token), undefined, enemyMoveBudget(encounter, enemy, token).disengaged)
    : [];
  const swings = struck.length
    ? { opportunityAttacks: struck, opportunityNote: "The server already rolled and applied these; narrate them, and do not call pc_attack for them." }
    : {};
  const after = getEnemy(enemy.id) ?? enemy;
  // Cut down on the way out: it never left. The victory an opportunity
  // attack holds for the turn's end is settled here, where the turn is.
  if (after.status !== "alive" || isKnockedOut(after)) {
    publishEncounter(campaign.id);
    return {
      ok: true,
      stopped: enemy.displayName,
      note: `${enemy.displayName} was struck down as it broke away: it did not escape.`,
      ...swings,
      ...autoEndOnVictory(campaign, turn, encounter, sheets, sheetsById),
    };
  }
  // Stopped where it stands: Sentinel and Hold the Line leave a creature they
  // hit with speed 0 for the rest of the turn (opportunity-strike.ts).
  const live = getActiveEncounter(campaign.id) ?? encounter;
  if (!teleports && (!canEnemyAct({ enemy: after, encounter: live, kind: "move" }).ok || enemySpeedTiles(after) === 0)) {
    publishEncounter(campaign.id);
    return {
      ok: true,
      stopped: enemy.displayName,
      note: `${enemy.displayName} was stopped as it broke away: its speed is 0 for the rest of the turn, and it is still in the fight where it stood.`,
      ...swings,
    };
  }
  patchEnemyHp(after.id, after.currentHp, "fled");
  // Gone from the fight, it holds nobody (grapple.ts releaseGrapplesHeldByAny).
  releaseGrapplesHeldByAny(campaign, [enemy.id]);
  // What it swallowed stays, prone where it stood (swallow.ts): asked while
  // its token is still there to stand them beside.
  const behind = leftBehind(campaign, encounter.id, enemy, "flees");
  if (map) {
    removeTokenByRef(map.id, enemy.id);
    publishBattleMapUpdate(campaign.id);
  }
  publishEncounter(campaign.id);
  const base: Record<string, unknown> = {
    ok: true,
    fled: enemy.displayName,
    note: `${enemy.displayName} has escaped and is out of the fight.`,
    ...swings,
    ...(behind ? { swallowedFreed: behind } : {}),
  };
  // The fight ends when nobody is left standing on the foes' side: one
  // lying knocked out does not hold it open (issue #667: it did, and the
  // fight never ended), nor does a creature the party dominates; a character
  // fighting against the party does (combatant.ts standingOn).
  if (!standingOn(campaign.id, getActiveEncounter(campaign.id) ?? encounter, "foe").length) {
    Object.assign(
      base,
      finishEncounter(campaign, turn, encounter, "enemies_fled", sheets, sheetsById),
    );
  }
  return base;
}

function handleEnemyCondition(
  campaign: Campaign,
  action: "set" | "clear",
  rawArguments: string,
  ctx: { turn: DmTurn; sheets: CharacterSheet[]; sheetsById: Map<string, CharacterSheet> },
): ToolResult {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter: an enemy's condition is set only in a fight.", retry: true };
  }
  let args: z.infer<typeof enemyRefArgsSchema>;
  try {
    args = enemyRefArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: needs enemyId and condition.", error, rawArguments);
  }
  const enemy = resolveEnemyRef(encounter.id, args.enemyId);
  if (!enemy) {
    return unknownEnemyRef(encounter.id, "enemyId", args.enemyId);
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is ${enemy.status}.`, retry: true };
  }
  const wanted = canonicalCondition(args.condition ?? "");
  if (!wanted) {
    return { error: "A condition name is required.", retry: true };
  }

  if (action === "set") {
    // "exhaustion 2", the form the engine itself writes, names exhaustion
    // and its level.
    const exhaustion = namesExhaustion(args.condition ?? "");
    const misnamed = exhaustion ? null : conditionNameRefusal(args.condition ?? "");
    if (misnamed) {
      return misnamed;
    }
    const named = exhaustion ? "exhaustion" : wanted;
    if (enemy.stats.conditionImmune.toLowerCase().includes(named)) {
      return {
        error: `${enemy.displayName} is immune to ${named} (immunities: ${enemy.stats.conditionImmune}).`,
        refused: "rules",
      };
    }
    // SRD 5.1, Conditions, Petrified: "immune to poison and disease".
    const stone = petrifiedRefusal(enemy.conditions, named);
    if (stone) {
      return { error: `${enemy.displayName} cannot be ${named}: ${stone}.`, refused: "rules" };
    }
    // Laid by a creature on the other side of a swallower's wall: it does
    // not land (swallow.ts).
    const layer = (args.sourceCharacterId ?? args.sourceEnemyId ?? "").trim();
    const walled = layer ? swallowCoverError(layer, enemy.id) : null;
    if (walled) {
      return walled;
    }
    // Exhaustion is a level, not a flag: the table applies (enemy-exhaustion.ts).
    if (exhaustion) {
      // A bare "exhaustion" is one more level; "exhaustion 2" is that level.
      const written = isConditionNamed(args.condition ?? "", "exhaustion") ? undefined : enemyExhaustion([args.condition ?? ""]);
      return setEnemyExhaustion(campaign, ctx.turn, encounter, enemy, args.level ?? written, ctx.sheets, ctx.sheetsById);
    }
    // The model does not bind a creature by saying so: the creature's save
    // is rolled first, and the condition lands only on a failure
    // (src/lib/dm/ai-boundary.ts). The console keeps its free hand.
    let initialSave: string | null = null;
    if (ctx.turn.actor === "ai" && bindsCreature(wanted)) {
      if (!args.saveAbility || !args.saveDc) {
        return AI_BIND_REFUSAL(enemy.displayName, wanted);
      }
      const save = rollEnemySave(campaign.id, enemy, args.saveAbility, args.saveDc, {
        resist: true,
        against: wanted,
        magical: args.magical === true,
        record: { turn: ctx.turn, detail: `${enemy.displayName}: ${args.saveAbility.toUpperCase()} save against being ${wanted}` },
      });
      initialSave = `${args.saveAbility.toUpperCase()} save ${save.total ?? "failed outright"} vs DC ${args.saveDc}`;
      if (save.success) {
        return { ok: true, name: enemy.displayName, saved: true, note: `${enemy.displayName} makes the ${initialSave}${save.legendaryResistance ? " (Legendary Resistance)" : ""}: no ${wanted}.` };
      }
    }
    const source = (args.sourceCharacterId ?? args.sourceEnemyId ?? "").trim();
    const wakes = wakesOnDamage(wanted, enemy.currentHp);
    const incoming =
      args.rounds || (args.saveAbility && args.saveDc) || source || wakes
        ? {
            ...(source ? { source } : {}),
            ...(args.rounds ? { rounds: args.rounds } : {}),
            ...(args.saveAbility && args.saveDc
              ? { saveEnds: { ability: args.saveAbility, dc: args.saveDc } }
              : {}),
            ...(wakes ? { endsOnDamage: true } : {}),
          }
        : undefined;
    const laid = layEnemyConditionInstance(campaign, enemy, wanted, incoming);
    if (!laid) {
      return { ok: true, note: `${enemy.displayName} is already ${wanted}.` };
    }
    const { released } = laid;
    return {
      ok: true,
      name: enemy.displayName,
      condition: wanted,
      ...(initialSave ? { save: `fails the ${initialSave}` } : {}),
      ...(released.length ? { released: released.join(" ") } : {}),
      ...(args.rounds ? { duration: `${args.rounds} rounds, expires automatically` } : {}),
      ...(args.saveAbility && args.saveDc
        ? {
            duration: `until it succeeds on a ${args.saveAbility.toUpperCase()} save (DC ${args.saveDc}), re-rolled automatically at the end of each of its turns`,
          }
        : {}),
      ...(wakes ? { wakes: "Any damage wakes it, and the server ends it then." } : {}),
    };
  }

  // The condition by its whole name, as the character-side clear_condition
  // finds it; a miss lists what the enemy holds.
  const matches = (entry: string) => entry === wanted || canonicalCondition(entry) === wanted || isConditionNamed(entry, wanted);
  const removed = enemy.conditions.filter(matches);
  if (!removed.length) {
    return {
      error: `${enemy.displayName} is not ${wanted}.`,
      retry: true,
      currentConditions: enemy.conditions,
    };
  }
  // The AI clearing prone is the enemy standing up, which costs half its
  // speed on its own turn, as its own walk charges it (enemy-approach.ts) and
  // a character's clear_condition does (stand-up.ts). The console stays free.
  if (wanted === PRONE && ctx.turn.actor === "ai" && encounter.orderReady) {
    const early = enemyTurnRefusal(encounter, enemy, ctx.turn);
    if (early) {
      return early;
    }
    const stood = standUpIfProne(encounter.id, enemy);
    if (!stood.stood) {
      const speed = enemySpeedTiles(enemy) * 5;
      return {
        error: speed
          ? `${enemy.displayName} has too little movement left this turn to stand: it costs half its speed (${Math.ceil(speed / 10) * 5} ft). It stays prone and takes its turn from there.`
          : `${enemy.displayName} cannot stand up at speed 0. It stays prone and takes its turn from there.`,
        retry: true,
      };
    }
    publishEncounter(campaign.id);
    publishBattleMapUpdate(campaign.id);
    return { ok: true, name: enemy.displayName, cleared: removed.join(", "), stood: "stood up for half its speed" };
  }
  // The model does not lift what the engine keeps: a save, a duration or a
  // spell decides when it ends (src/lib/dm/ai-boundary.ts).
  if (ctx.turn.actor === "ai") {
    const kept = removed.find((name) => bindsCreature(canonicalCondition(name)) && instancesOf((enemy.conditionMeta as ConditionMetaMap)[name]).some(engineKept));
    if (kept) {
      return AI_CLEAR_REFUSAL(enemy.displayName, kept);
    }
  }
  const remaining = enemy.conditions.filter((entry) => !matches(entry));
  patchEnemyConditions(enemy.id, remaining, pruneMeta(remaining, enemy.conditionMeta));
  // A grapple let go ends the Grappler's own pin restraint (grappler-pin.ts).
  releaseLostPins(campaign);
  publishEncounter(campaign.id);
  return { ok: true, name: enemy.displayName, cleared: removed.join(", ") };
}

export function applyExtraEncounterCall(
  campaign: Campaign,
  turn: DmTurn,
  toolName: string,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): { result: ToolResult } | null {
  switch (toolName) {
    case "add_enemies":
      return { result: handleAddEnemies(campaign, rawArguments, sheets) };
    case "enemy_flees":
      return { result: handleEnemyFlees(campaign, turn, rawArguments, sheets, sheetsById) };
    case "set_enemy_condition":
      return { result: handleEnemyCondition(campaign, "set", rawArguments, { turn, sheets, sheetsById }) };
    case "clear_enemy_condition":
      return { result: handleEnemyCondition(campaign, "clear", rawArguments, { turn, sheets, sheetsById }) };
    case "aoe_damage": {
      // An enemy's breath or spell is its action, on its own turn; a
      // character's spell waits for their player's word.
      const early =
        enemyCallOutOfTurn(campaign.id, turn, rawArguments, "casterEnemyId") ??
        characterCallUnasked(campaign.id, turn, rawArguments, "casterCharacterId");
      return { result: early ? early : handleAoeDamage(campaign, turn, rawArguments, sheets, sheetsById) };
    }
    case "legendary_action":
      return { result: handleLegendaryAction(campaign, rawArguments, turn) };
    case "legendary_resist":
      return { result: handleLegendaryResist(campaign, rawArguments) };
    case "lair_action":
      return { result: handleLairAction(campaign, turn, rawArguments) };
    case "declare_intent":
      return { result: handleDeclareIntent(campaign, rawArguments, sheets, sheetsById) };
    default:
      return null;
  }
}
