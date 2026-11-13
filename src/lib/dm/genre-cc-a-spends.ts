// The dark fantasy and cyberpunk counters whose spend does what no shared
// spend kind does, wired by the 2026-11-13 creator audit's second genre pass
// (the authored spend kind "genre_cc" of
// src/lib/srd/authored-effects-genre-cc-a.ts, resolved here from
// src/lib/dm/authored-spend-effects.ts). Each refuses with nothing spent when
// what it needs is not there.
//
//   crown: The Crown Descends, "for 1 minute every enemy within 30 ft is
//     swarmed: half speed, no reactions, and 1d6 piercing at the start of each
//     of its turns": the swarmed condition (src/lib/srd/genre-cc-a-conditions.ts)
//     on every living enemy within 30 feet for ten rounds; its bite is
//     src/lib/dm/genre-cc-a-turns.ts's;
//   rat_tide: Rat Tide, "a swarm floods a 15-ft cube" (20 with Rat Tide
//     (2 uses)): the area of src/lib/battlemap/zones-genre-cc-a.ts thrown
//     onto a creature within 30 feet, and with The Walls Have Teeth the
//     enemies near it lose their reactions at once;
//   no_rest: No Rest for the Wicked, "take an extra full turn immediately
//     after killing your branded quarry": on the hunter's own turn, with a
//     creature their brand was on now dead, the turn's action, bonus action,
//     movement and reaction come back (Terminal Focus's second turn);
//   rite: The Rite Completed, "sing a fallen ally within a minute of death
//     back to 1 HP without material components": a dead character named,
//     dead no longer than a minute (src/lib/dm/revival.ts), at 1 hit point;
//   elegy: Elegy of Echoes, "repeat the last dirge you cast this turn at a
//     new target for free (3rd level or lower)": after a spell this turn, one
//     cast of 3rd level or lower costs no slot until the turn ends (the
//     slotless mark src/lib/dm/genre-b-free-cast.ts reads);
//   candle: Candle in the Dark, "emit bright warding light 20 ft for 10
//     minutes": the mark for a hundred rounds and the token's light (the
//     warding is the row's attacked_disadv, gated on the mark);
//   daemon_cache: Daemon Cache, "cast it once without a slot per long rest":
//     the cached program's cast, 3rd level or lower (5th with Daemon Cache (2
//     programs)), costs no slot (the same slotless mark).
import { getActiveEncounter, listEnemies, patchEnemyConditions } from "@/lib/db/encounters";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import { withinFeet } from "@/lib/dm/authored-saves";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { sideOf } from "@/lib/dm/combatant";
import type { ToolError } from "@/lib/dm/tool-errors";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { CANDLE, ELEGY_MARK, SWARMED } from "@/lib/srd/genre-cc-a-conditions";
import { EXIT, JURY_RIGGED, PARLEY } from "@/lib/dm/genre-cc-a-fixer";
import { reactionMove } from "@/lib/dm/authored-reactions-more";
import { getEnemy, saveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { getTokenByRef, setTokenLight } from "@/lib/db/battle-maps";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { minutesSinceDeath } from "@/lib/dm/revival";
import { holdsFeature } from "@/lib/srd/feature-names";
import { resolveSpendEffect } from "@/lib/dm/authored-spend-effects";
import { refreshTeeth } from "@/lib/dm/genre-cc-a-turns";
import { RAT_TIDE, RAT_TIDE_GROWN } from "@/lib/battlemap/zones-genre-cc-a";
import { getBattleMapForEncounter, listTokens } from "@/lib/db/battle-maps";
import { zonesAfterMove } from "@/lib/dm/zone-triggers";
import { isNamed } from "@/lib/srd/feature-names";

export type GenreCcPlay = "crown" | "rat_tide" | "no_rest" | "rite" | "elegy" | "candle" | "daemon_cache" | "parley" | "exit" | "jury_rig";

type Resolution = ToolError | { patch?: Record<string, unknown>; result: Record<string, unknown> };

const MINUTE = 10;

export function genreCcSpend(ctx: SpendContext, play: GenreCcPlay): Resolution {
  switch (play) {
    case "crown":
      return crown(ctx);
    case "rat_tide":
      return ratTide(ctx);
    case "no_rest":
      return noRest(ctx);
    case "rite":
      return riteCompleted(ctx);
    case "elegy":
      return elegy(ctx);
    case "candle":
      return candle(ctx);
    case "daemon_cache":
      return daemonCache(ctx);
    case "parley":
      return parley(ctx);
    case "exit":
      return exitStrategy(ctx);
    case "jury_rig":
      return juryRig(ctx);
  }
}

function crown(ctx: SpendContext): Resolution {
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter) {
    return { error: `${ctx.spend.name} swarms the enemies within 30 feet of ${ctx.sheet.name} in a fight, and none is running. Nothing was spent.`, refused: "rules" };
  }
  const mine = sideOf(encounter, "sheet", ctx.sheet.id);
  const foes = listEnemies(encounter.id).filter((enemy) => enemy.status === "alive" && sideOf(encounter, "enemy", enemy.id, enemy) !== mine && withinFeet(encounter.id, ctx.sheet.id, enemy.id, 30));
  if (!foes.length) {
    return { error: `No enemy stands within 30 feet of ${ctx.sheet.name} for ${ctx.spend.name} to swarm. Nothing was spent.`, refused: "rules" };
  }
  for (const enemy of foes) {
    const kept = enemy.conditions.filter((entry) => !isConditionNamed(entry, SWARMED));
    patchEnemyConditions(enemy.id, [...kept, SWARMED], { ...((enemy.conditionMeta ?? {}) as ConditionMetaMap), [SWARMED]: { rounds: MINUTE, source: ctx.sheet.id } } as typeof enemy.conditionMeta);
  }
  publishEncounter(ctx.campaign.id);
  return { result: { applied: `${ctx.spend.name}: ${foes.map((enemy) => enemy.displayName).join(", ")} ${foes.length === 1 ? "is" : "are"} swarmed for a minute: half speed, no reactions, and 1d6 piercing as each of their turns starts.` } };
}

function ratTide(ctx: SpendContext): Resolution {
  const laid = resolveSpendEffect(ctx, { kind: "zone", lays: RAT_TIDE, rangeFt: 30, dcAbility: "dex", upgrade: { feature: "Rat Tide (2 uses)", lays: RAT_TIDE_GROWN } });
  if ("error" in laid) {
    return laid;
  }
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter) {
    return laid;
  }
  // "creatures inside save (DEX) or take 2d6 piercing and are distracted":
  // the swarm floods over everyone standing where it lands, as a creature
  // walking in meets it (the area's own enter trigger, zone-triggers.ts).
  const map = getBattleMapForEncounter(encounter.id);
  const zone = map?.spellZones.filter((entry) => entry.casterId === ctx.sheet.id && isNamed(entry.spell, ctx.spend.name)).at(-1);
  const caught: string[] = [];
  if (map && zone) {
    for (const token of listTokens(map.id)) {
      if (token.refId === ctx.sheet.id || (token.kind !== "enemy" && token.kind !== "pc") || !zone.cells.includes(token.y * map.width + token.x)) {
        continue;
      }
      caught.push(...zonesAfterMove(ctx.campaign, encounter.id, { kind: token.kind, refId: token.refId }, { x: -1, y: -1 }, [{ x: token.x, y: token.y }]));
    }
  }
  const teeth = refreshTeeth(ctx.campaign, getActiveEncounter(ctx.campaign.id) ?? encounter);
  return { ...laid, result: { ...laid.result, ...(caught.length ? { caught } : {}), ...(teeth.length ? { teeth } : {}) } };
}

const turnMark = (ctx: SpendContext, condition: string, meta: Record<string, unknown>): Resolution => {
  const kept = ctx.sheet.conditions.filter((entry) => !isConditionNamed(entry, condition));
  return { patch: { conditions: [...kept, condition], conditionMeta: { ...ctx.sheet.conditionMeta, [condition]: meta } }, result: {} } as Resolution;
};

// The mark a branded creature's death leaves on a hunter who holds No Rest
// for the Wicked, until their turn ends (genre-a-dark-fantasy-deaths.ts).
const QUARRY_SLAIN = "quarry slain";
export function quarrySlainMark(sheet: CharacterSheet): { condition: string; meta: Record<string, unknown> } | null {
  return holdsFeature(sheet, "No Rest for the Wicked") ? { condition: QUARRY_SLAIN, meta: { untilTurnEndOf: sheet.id } } : null;
}

function noRest(ctx: SpendContext): Resolution {
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter || !ctx.marks) {
    return { error: `${ctx.spend.name} is an extra turn taken on ${ctx.sheet.name}'s own turn in a fight. Nothing was spent.`, refused: "rules" };
  }
  const meta = (ctx.sheet.conditionMeta ?? {}) as ConditionMetaMap;
  const held = ctx.sheet.conditions.find((entry) => isConditionNamed(entry, QUARRY_SLAIN));
  const slain = held ? getEnemy(String(meta[held]?.quarry ?? "")) : null;
  if (!held || !slain) {
    return { error: `${ctx.spend.name} follows the kill of ${ctx.sheet.name}'s branded quarry, and no creature their brand was on has fallen. Nothing was spent.`, refused: "rules" };
  }
  saveEncounter({ ...encounter, turnBudget: null, reactionsUsed: encounter.reactionsUsed.filter((id) => id !== ctx.sheet.id) });
  publishEncounter(ctx.campaign.id);
  const left = removeConditions(ctx.sheet.conditions, meta, [held]);
  return { patch: { conditions: left.conditions, conditionMeta: left.meta }, result: { applied: [`${ctx.spend.name}: ${slain.displayName} is dead, and ${ctx.sheet.name} takes an extra full turn now: their action, bonus action, movement and reaction are fresh.`] } };
}

function riteCompleted(ctx: SpendContext): Resolution {
  const target = ctx.args.targetCharacterId ? getSheetById(ctx.args.targetCharacterId) : null;
  if (!target || target.campaignId !== ctx.campaign.id || target.id === ctx.sheet.id) {
    return { error: `${ctx.spend.name} sings a fallen ally back: name them by targetCharacterId. Nothing was spent.`, retry: true };
  }
  if (!target.deathSaves?.dead) {
    return { error: `${target.name} is not dead; ${ctx.spend.name} sings back an ally dead less than a minute. Nothing was spent.`, refused: "rules" };
  }
  const since = minutesSinceDeath(ctx.campaign.id, target.id);
  if (since !== null && since > 1) {
    return { error: `${target.name} died ${since} minutes ago; ${ctx.spend.name} reaches only an ally dead within the minute. Nothing was spent.`, refused: "rules" };
  }
  const conditions = target.conditions.filter((entry) => !isConditionNamed(entry, "unconscious"));
  patchSheetAudited(ctx.campaign.id, target.id, { currentHp: 1, deathSaves: { successes: 0, failures: 0, stable: false, dead: false }, conditions }, { kind: "heal", reason: `${ctx.spend.name} by ${ctx.sheet.name}`, delta: { hp: 1 } });
  return { result: { applied: [`${ctx.spend.name}: ${target.name} is sung back to life at 1 hit point; no material component is spent.`] } };
}

function elegy(ctx: SpendContext): Resolution {
  const encounter = getActiveEncounter(ctx.campaign.id);
  const budget = encounter?.turnBudget;
  if (!encounter || !ctx.marks || !budget || !budget.castThisAction) {
    return { error: `${ctx.spend.name} repeats a dirge ${ctx.sheet.name} cast this turn, and they have cast none. Nothing was spent.`, refused: "rules" };
  }
  const marked = turnMark(ctx, ELEGY_MARK, { untilTurnEndOf: ctx.sheet.id });
  return "error" in marked ? marked : { ...marked, result: { applied: [`${ctx.spend.name}: ${ctx.sheet.name}'s next dirge of 3rd level or lower this turn, at a new target, costs no slot.`] } };
}

function candle(ctx: SpendContext): Resolution {
  const encounter = getActiveEncounter(ctx.campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, ctx.sheet.id) : null;
  if (token && token.lightRadius < 4) {
    setTokenLight(token.id, 4, 0, 0, 0);
    publishBattleMapUpdate(ctx.campaign.id);
  }
  const marked = turnMark(ctx, CANDLE, { rounds: 100 });
  return "error" in marked ? marked : { ...marked, result: { applied: [`${ctx.spend.name}: ${ctx.sheet.name} sheds bright warding light for 20 feet for 10 minutes; hostile undead and fiends within it attack at disadvantage.`] } };
}

function daemonCache(ctx: SpendContext): Resolution {
  const grown = holdsFeature(ctx.sheet, "Daemon Cache (2 programs)");
  const mark = grown ? "slotless cast (5th)" : "slotless cast (3rd)";
  const marked = turnMark(ctx, mark, { rounds: 14400 });
  return "error" in marked ? marked : { ...marked, result: { applied: [`${ctx.spend.name}: ${ctx.sheet.name}'s cached program (${grown ? "5th" : "3rd"} level or lower) is cast once with no slot.`] } };
}

// Neutral Ground: the creature named accepted the parley; it cannot attack
// the fixer until their next turn starts.
function parley(ctx: SpendContext): Resolution {
  const encounter = getActiveEncounter(ctx.campaign.id);
  const enemy = ctx.args.targetEnemyId && encounter ? getEnemy(ctx.args.targetEnemyId) : null;
  if (!enemy || enemy.status !== "alive") {
    return { error: `${ctx.spend.name} names the creature that accepted ${ctx.sheet.name}'s parley: pass its targetEnemyId. Nothing was spent.`, retry: true };
  }
  const kept = enemy.conditions.filter((entry) => !isConditionNamed(entry, PARLEY));
  patchEnemyConditions(enemy.id, [...kept, PARLEY], { ...((enemy.conditionMeta ?? {}) as ConditionMetaMap), [PARLEY]: { source: ctx.sheet.id, untilTurnOf: ctx.sheet.id } } as typeof enemy.conditionMeta);
  publishEncounter(ctx.campaign.id);
  return { result: { applied: [`${ctx.spend.name}: ${enemy.displayName} accepts the parley and cannot attack ${ctx.sheet.name} until their next turn.`] } };
}

// Exit Strategy: the move the fight's start allows, up to the fixer's speed,
// drawing no opportunity attack (the reactions' own move, reactionMove).
function exitStrategy(ctx: SpendContext): Resolution {
  const held = ctx.sheet.conditions.find((entry) => isConditionNamed(entry, EXIT));
  if (!held) {
    return { error: `${ctx.spend.name} is the move ${ctx.sheet.name} makes as initiative is rolled, before their first turn. Nothing was spent.`, refused: "rules" };
  }
  const moved = reactionMove({ campaign: ctx.campaign, encounter: ctx.encounter ?? getActiveEncounter(ctx.campaign.id), sheet: ctx.sheet, args: ctx.args } as unknown as Parameters<typeof reactionMove>[0], ctx.spend.name, "opened", "full");
  if ("error" in moved) {
    return moved as ToolError;
  }
  const left = removeConditions(ctx.sheet.conditions, ctx.sheet.conditionMeta as ConditionMetaMap, [held]);
  return { patch: { conditions: left.conditions, conditionMeta: left.meta }, result: { applied: [String((moved as { applied?: unknown }).applied ?? "")] } };
}

// Jury-Rig: the tinkered tool's +1d4 for an hour (600 rounds) on the
// character named, or the rigger.
function juryRig(ctx: SpendContext): Resolution {
  const target = ctx.args.targetCharacterId ? getSheetById(ctx.args.targetCharacterId) : ctx.sheet;
  if (!target || target.campaignId !== ctx.campaign.id) {
    return { error: `${ctx.spend.name} tunes a tool for a character: name them by targetCharacterId. Nothing was spent.`, retry: true };
  }
  const kept = target.conditions.filter((entry) => !isConditionNamed(entry, JURY_RIGGED));
  patchSheetAudited(ctx.campaign.id, target.id, { conditions: [...kept, JURY_RIGGED], conditionMeta: { ...target.conditionMeta, [JURY_RIGGED]: { rounds: 600 } } as never }, { kind: "set_condition", reason: ctx.spend.name, delta: { condition: JURY_RIGGED } });
  return { result: { applied: [`${ctx.spend.name}: ${target.name}'s checks with a tool gain +1d4 for an hour.`] } };
}
