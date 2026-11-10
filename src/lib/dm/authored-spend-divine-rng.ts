// The ranger archetype spends of the divine package's second wave, resolved
// from src/lib/dm/authored-spend-effects.ts resolveSpendEffect (and Gathered
// Swarm's push, authored-spend-more.ts, for its "move" variant). Each refuses
// before it writes; the caller then spends the pool and the turn.
import { getActiveEncounter } from "@/lib/db/encounters";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { WEAPON_HIT } from "@/lib/dm/action-budget";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import { giveBack, swarmDieBack } from "@/lib/dm/authored-spend-more";
import { planFeatureMove } from "@/lib/dm/feature-move";
import { commandPet, PET_COMMANDS } from "@/lib/dm/pet-command";
import { petAttackedKey } from "@/lib/dm/pet-attack-cost";
import { namedOption, type ToolError } from "@/lib/dm/tool-errors";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import { holdsFeature } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";

type Resolution = ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> };

// The condition Mighty Swarm's half cover lays (src/lib/srd/authored-conditions.ts).
const SWARM_COVER = "swarm cover";

export function rangerSpend(ctx: SpendContext, does: Extract<SpendDoes, { kind: "pet_command" | "this_turn" }>): Resolution {
  switch (does.kind) {
    case "pet_command":
      return petCommand(ctx, does);
    case "this_turn":
      return thisTurn(ctx, does);
  }
}

// Ethereal Step (Horizon Walker 7): "Cast etherealness as a bonus action for
// one turn": the holder is ethereal until this turn ends (the turn has begun,
// so its end is this one's: affinity-cast.ts lays its turn the same way).
// Before this the use and the bonus action were spent and nothing marked
// the ranger.
function thisTurn(ctx: SpendContext, does: Extract<SpendDoes, { kind: "this_turn" }>): Resolution {
  const encounter = getActiveEncounter(ctx.campaign.id);
  const fighting = Boolean(encounter && (encounter.kind ?? "fight") === "fight");
  const kept = ctx.sheet.conditions.filter((entry) => textKey(entry) !== textKey(does.condition));
  const lasts = fighting ? { untilTurnEndOf: ctx.sheet.id, turnBegun: true } : { rounds: 1 };
  return {
    patch: { conditions: [...kept, does.condition], conditionMeta: { ...ctx.sheet.conditionMeta, [does.condition]: { source: ctx.sheet.id, ...lasts } } as FullPatchSheetInput["conditionMeta"] },
    result: { applied: [`${ctx.sheet.name} is ${does.condition} until the end of this turn.`] },
  };
}

// Exceptional Training (Beast Master 7): "On a turn your companion doesn't
// attack, a bonus action can command it to Dash, Disengage or Help". The
// variant names which; the spend row costs the bonus action. A companion
// that attacked this turn (pet-attack-cost.ts leaves the mark) is refused,
// nothing spent. Before this no call commanded it at all.
function petCommand(ctx: SpendContext, does: Extract<SpendDoes, { kind: "pet_command" }>): Resolution {
  const option = namedOption(ctx.spend.name, ctx.args.variant, does.options);
  if (typeof option !== "string") {
    return option;
  }
  const companion = ctx.sheet.pets.find((pet) => pet.kind === "beast_companion");
  if (!companion) {
    return { error: `${ctx.sheet.name} has no companion to command (summon_pet kind beast_companion). Nothing was spent.`, refused: "rules" };
  }
  if (companion.hp <= 0) {
    return { error: `${companion.name} is down; it cannot be commanded. Nothing was spent.`, refused: "rules" };
  }
  // The turn's own marks: a bonus-action spend is handed none (authored-spends.ts).
  const live = getActiveEncounter(ctx.campaign.id);
  const marks = ctx.marks ?? (live?.turnBudget?.ownerId === ctx.sheet.id ? live.turnBudget.oncePerTurn : []);
  if (marks.includes(petAttackedKey(companion.name))) {
    return { error: `${companion.name} attacked this turn, and ${ctx.spend.name}'s command comes on a turn it does not attack. Nothing was spent.`, refused: "rules" };
  }
  const doing = PET_COMMANDS[["dash", "disengage", "help"].indexOf(textKey(option))] ?? textKey(option);
  commandPet(ctx.campaign, ctx.sheet.id, companion.name, doing);
  return { result: { applied: [`${companion.name} takes the ${option.charAt(0).toUpperCase()}${option.slice(1)} action at ${ctx.sheet.name}'s command.`] } };
}

// Gathered Swarm: "Once per turn, a hit lets your swarm ... move you 5 feet
// without provoking". The square is x and y; it is in place of the swarm's
// damage that turn, so its die comes off the hit it rode, as the push does.
// Mighty Swarm: "when the swarm moves you, you have half cover until the
// start of your next turn". Before this the variant pushed the creature hit
// and never moved the ranger.
export function swarmCarry(ctx: SpendContext): Resolution {
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter) {
    return { error: `${ctx.spend.name} moves ${ctx.sheet.name} in a fight; there is no fight. Nothing was spent.`, refused: "rules" };
  }
  const marks = ctx.marks ?? (encounter.turnBudget?.ownerId === ctx.sheet.id ? encounter.turnBudget.oncePerTurn : []);
  const first = marks.find((mark) => mark.startsWith(WEAPON_HIT));
  if (!first) {
    return { error: `${ctx.spend.name} follows ${ctx.sheet.name}'s weapon hit this turn, and they have landed none. Nothing was spent.`, refused: "rules" };
  }
  if (ctx.args.x === undefined || ctx.args.y === undefined) {
    return { error: `${ctx.spend.name}'s move needs the square the swarm carries ${ctx.sheet.name} to: pass x and y, 5 feet away. Nothing was spent.`, retry: true };
  }
  const move = planFeatureMove(ctx.campaign, { refId: ctx.sheet.id, square: { x: ctx.args.x, y: ctx.args.y }, feet: 5, what: ctx.spend.name, teleport: false });
  if ("error" in move) {
    return move;
  }
  const lines = move.go();
  const hit = resolveTargetFoe(encounter.campaignId, encounter, first.slice(WEAPON_HIT.length));
  const refund = hit ? swarmDieBack(ctx, hit) : 0;
  if (hit && refund) {
    lines.push(...giveBack(ctx, hit.id, refund));
  }
  if (!holdsFeature(ctx.sheet, "Mighty Swarm")) {
    return { result: { applied: lines } };
  }
  lines.push(`Mighty Swarm: ${ctx.sheet.name} has half cover (+2 AC and Dexterity saves) until the start of their next turn.`);
  const kept = ctx.sheet.conditions.filter((entry) => textKey(entry) !== SWARM_COVER);
  return {
    patch: { conditions: [...kept, SWARM_COVER], conditionMeta: { ...ctx.sheet.conditionMeta, [SWARM_COVER]: { untilTurnOf: ctx.sheet.id } } as FullPatchSheetInput["conditionMeta"] },
    result: { applied: lines },
  };
}
