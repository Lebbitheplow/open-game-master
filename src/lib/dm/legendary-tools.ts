import { z } from "zod";
import { dmRoll } from "@/lib/dm/roll-card";
import { type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, orderEntryId, saveEncounter, turnKey, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { regainBlockedBy } from "@/lib/dm/vitals-logic";
import { legendaryMoveFor } from "@/lib/dm/legendary-move";
import { legendaryRoutes, routeNamed } from "@/lib/dm/legendary-route-logic";
import { nextStep, resolveSelfStep, selfStepRefusal, type SelfStep } from "@/lib/dm/legendary-steps";
import { resolveEnemyRef, unknownEnemyRef } from "@/lib/dm/enemy-damage";
import { insertCampaignMessage } from "@/lib/db/messages";
import type { DmTurn } from "@/lib/db/dm-turns";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { canEnemyAct, enemyActedThisRound, oweEnemiesAnAction } from "@/lib/dm/can-act";
import {
  abilityFromLine,
  abilityKey,
  findMonsterAbility,
  enemyHpCap,
  REGENERATION_STOPPED,
  regenerationOf,
  rollRecharges,
  type AbilityLedger,
  type MonsterAbility,
} from "@/lib/dm/monster-abilities";
import { patchEnemyConditions, patchEnemyHp } from "@/lib/db/encounters";
import { removeConditionInstances, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import {
  freshPool,
  lairForbidsRepeat,
  lairRepeatRefusal,
  lairResolution,
  legendaryLairLines,
  legendaryOpening,
  legendaryProfile,
  legendaryPurchase,
  pickLairOption,
  refillActions,
  spendLegendaryAction,
  spendResistance,
  type LegendaryPool,
} from "@/lib/dm/legendary-logic";
import { badArguments, toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { tableNoteSeq } from "@/lib/dm/narration-slot";

export { legendaryLairLines } from "@/lib/dm/legendary-logic";
export { legendaryMoveFor } from "@/lib/dm/legendary-move";

// Legendary actions, lair actions and legendary resistance as tools
// (docs/vtt-parity-implementation-plan.md 4.1). Imports point downward
// only, like encounter-tools-extra: this module never imports
// encounter-tools, which dispatches to it.

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const legendaryTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "legendary_action",
      description:
        "Spend a legendary creature's legendary action at the END of another creature's turn: one option per turn that ends. The server checks the pool, the cost and the turn. With targetCharacterId it plays an option aimed at one creature whole; otherwise make the call its result names.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          enemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
          action: { type: "string", description: "The legendary action's name as the stat block lists it." },
          use: { type: "string", description: "Which of an option's ways to play it (Tentacle Attack or Fling). Default: the first." },
          targetCharacterId: { type: "string", description: "The one creature it acts on (characterId or enemyId)." },
        },
        required: ["enemyId", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "legendary_resist",
      description:
        "Spend one use of Legendary Resistance so the creature succeeds on the save it just failed this round. The server keeps the count and the last failed save: it lifts what that save laid and gives back the HP a success would have spared. With no failed save on record, or none left, it is refused. The server already spends one on its own when a failed save would leave the creature under a binding condition; use this for anything else (a damaging save it must not fail).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { enemyId: { type: "string", description: "Exact enemyId from GAME STATE." } },
        required: ["enemyId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lair_action",
      description:
        "Resolve the lair's own action: on initiative count 20 of each round (losing ties), when the fight is in a lair, the lair itself acts once. The server announces the moment (\"Initiative 20: the lair stirs\") and refuses the call at any other. The server records it, refuses a second in the round, and says how an option with a save resolves.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { action: { type: "string", description: "The printed lair option by its list number or whole line, or your own line for a lair with none." } },
        required: ["action"],
      },
    },
  },
];

// The pools a fight starts with: one per enemy the stat block calls
// legendary; the lair flag when the fight is in one. Reinforcements get
// theirs as they arrive (issue #667: one brought in by add_enemies had
// none, so legendary_resist refused it until its first turn).
//
// `carried`: what a creature come back from an earlier fight kept (issue
// #667, foe-return.ts): the legendary resistances it had left and the uses
// and spell slots it had spent, all of which come back with a long rest
// (SRD 5.1 "3/Day", spell slots), not with a new fight.
export function initLegendaryPools(
  encounter: Encounter,
  enemies: EncounterEnemy[],
  lair: boolean,
  carried: ReadonlyMap<string, { resistances?: number; abilities?: AbilityLedger }> = new Map(),
): void {
  for (const enemy of enemies) {
    const profile = legendaryProfile(enemy.stats);
    const kept = carried.get(enemy.id);
    if (profile) {
      const pool = freshPool(profile);
      encounter.legendary.pools[enemy.id] =
        kept?.resistances === undefined ? pool : { ...pool, resistances: Math.min(pool.resistances, Math.max(0, kept.resistances)) };
    }
    const ledger = kept?.abilities;
    if (ledger && (Object.keys(ledger.uses ?? {}).length || Object.keys(ledger.slots ?? {}).length)) {
      encounter.legendary.abilities = { ...(encounter.legendary.abilities ?? {}), [enemy.id]: ledger };
    }
  }
  encounter.legendary.lair = lair || enemies.some((enemy) => (legendaryProfile(enemy.stats)?.lairActions.length ?? 0) > 0);
}

// The enemy whose turn begins gets its legendary actions back, and rolls
// the d6 for each Recharge ability it has spent (SRD 5.1, Recharge X-Y).
// The caller saves the encounter. Returns a line per recharge roll.
export function refillLegendaryForTurn(encounter: Encounter, enemy: EncounterEnemy | undefined): string[] {
  if (!enemy) {
    return [];
  }
  const profile = legendaryProfile(enemy.stats);
  if (profile) {
    encounter.legendary.pools[enemy.id] = refillActions(encounter.legendary.pools[enemy.id], profile);
  }
  const lines: string[] = [];
  // Regeneration (SRD 5.1, trolls, vampires): hit points back at the start
  // of its turn, unless the damage that stops it landed since its last turn
  // (the condition enemy-damage.ts sets, which ends as this turn starts;
  // `enemy` is read from before that, so it still shows).
  const regeneration = regenerationOf(enemy.stats);
  // A5e's Bloodied Regeneration works only at half its hit points or fewer.
  const bloodied = !regeneration?.whileBloodied || enemy.currentHp <= Math.floor(enemy.maxHp / 2);
  if (regeneration && enemy.currentHp > 0 && bloodied) {
    // Chill Touch, negative energy: a creature they hold cannot regain hit points.
    if (enemy.conditions.includes(REGENERATION_STOPPED) || regainBlockedBy({ conditions: enemy.conditions, currentHp: 1 }) !== null) {
      lines.push(`${enemy.displayName} does not regenerate this turn.`);
    } else if (enemy.currentHp < enemyHpCap(enemy)) {
      // Never past the maximum, which exhaustion 4 halves. What the block
      // asks that the server cannot see ("isn't in sunlight or running
      // water") is the DM's to hold it to.
      const healed = Math.min(enemyHpCap(enemy), enemy.currentHp + regeneration.amount);
      patchEnemyHp(enemy.id, healed, "alive");
      lines.push(
        `${enemy.displayName} regenerates ${healed - enemy.currentHp} hit points.${regeneration.onlyIf ? ` Its Regeneration works only if ${regeneration.onlyIf}: if it does not, take them back with apply_damage.` : ""}`,
      );
    }
  }
  const ledger = encounter.legendary.abilities?.[enemy.id];
  if (!ledger?.spent?.length) {
    return lines;
  }
  const abilities = [
    ...(enemy.stats.specials ?? []),
    ...(enemy.stats.traits ?? []).map(abilityFromLine).filter((entry): entry is MonsterAbility => entry !== null),
  ];
  const rolled = rollRecharges(enemy.displayName, abilities, ledger, () => dmRoll(encounter.campaignId, null, "custom", `${enemy.displayName}: recharge`, "1d6").total);
  encounter.legendary.abilities = { ...(encounter.legendary.abilities ?? {}), [enemy.id]: rolled.ledger ?? {} };
  return [...lines, ...rolled.lines];
}

// A failed save that would leave a legendary creature under a condition
// is the moment a monster burns a resistance; the server does it so the
// model never forgets. Returns true when a resistance was spent.
export function autoLegendaryResistance(campaign: Campaign, encounter: Encounter, enemy: EncounterEnemy): boolean {
  const pool = encounter.legendary.pools[enemy.id];
  if (!pool) {
    return false;
  }
  const spent = spendResistance(pool);
  if (!spent) {
    return false;
  }
  encounter.legendary.pools[enemy.id] = spent;
  saveEncounter(encounter);
  publishPersisted(campaign.id, "encounter_updated", { encounter: activePublicEncounter(campaign.id) });
  return true;
}

function publishEncounter(campaign: Campaign) {
  publishPersisted(campaign.id, "encounter_updated", { encounter: activePublicEncounter(campaign.id) });
}

const actionSchema = z.object({
  enemyId: z.string().min(1),
  action: z.string().trim().min(1).max(80),
  // Which way to play an option that offers more than one ("Rotting Fist"
  // or "Dreadful Glare"): legendary-route-logic.ts. The first otherwise.
  use: z.string().trim().max(80).optional(),
});

export function handleLegendaryAction(campaign: Campaign, rawArguments: string, turn: DmTurn | null = null): ToolResult {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter: legendary actions are taken only in a fight.", retry: true };
  }
  let args: z.infer<typeof actionSchema>;
  try {
    args = actionSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: legendary_action needs enemyId and action.", error, rawArguments);
  }
  const enemy = resolveEnemyRef(encounter.id, args.enemyId);
  if (!enemy) {
    return unknownEnemyRef(encounter.id, "enemyId", args.enemyId);
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is ${enemy.status}.`, retry: true };
  }
  const profile = legendaryProfile(enemy.stats);
  if (!profile || !profile.actions.length) {
    return { error: `${enemy.displayName} has no legendary actions. It acts on its own turn.`, retry: true };
  }
  // A legendary action is still an action of the creature's: not while it
  // is incapacitated, and not while it is surprised.
  const allowed = canEnemyAct({ enemy, encounter, kind: "legendary" });
  if (!allowed.ok) {
    return toolError(allowed);
  }
  const current = encounter.order[encounter.turnIndex];
  const opening = legendaryOpening(
    {
      turn: turnKey(encounter),
      round: encounter.round,
      // The pointer never rests on an enemy; the rest of its own turn is the
      // turn handed on and not yet taken (legendary-logic.ts).
      onPointer: Boolean(current && orderEntryId(current) === enemy.id),
      actedThisRound: enemyActedThisRound(encounter, enemy.id),
      legendary: encounter.legendary,
    },
    enemy,
  );
  if (opening.refusal) {
    return opening.refusal;
  }
  const { key, taken } = opening;
  const pool: LegendaryPool = encounter.legendary.pools[enemy.id] ?? freshPool(profile);
  const outcome = spendLegendaryAction(pool, profile, args.action);
  if (!outcome.ok) {
    return toolError(outcome);
  }
  // The way it is played (legendary-route-logic.ts): what a later call
  // makes is bought here, what needs nothing more is made here.
  const routes = legendaryRoutes(enemy.stats, outcome.action);
  const route = routeNamed(routes, args.use);
  if (args.use && !route) {
    return {
      error: `${outcome.action.name} is played as ${routes.map((entry) => entry.use).join(" or ") || "it reads"}; "${args.use}" is not one of them. Nothing was spent.`,
      retry: true,
    };
  }
  const own = route?.steps.find((step): step is SelfStep => step.kind === "check" || step.kind === "heal" || step.kind === "cloud") ?? null;
  const ownAbility = own?.kind === "cloud" ? findMonsterAbility(enemy.stats, outcome.action.name) : null;
  const ownRefusal = own ? selfStepRefusal(campaign, enemy, own, outcome.action.name) : null;
  if (ownRefusal) {
    return ownRefusal;
  }
  encounter.legendary.pools[enemy.id] = outcome.pool;
  encounter.legendary.opportunities = { key, ids: [...taken, enemy.id] };
  const purchase = legendaryPurchase(enemy.stats, outcome.action, route);
  const attack = purchase.kind === "attack" ? purchase.attack : null;
  const ability = purchase.kind === "ability" ? purchase.ability : null;
  if (attack) {
    // The attack this action buys is on top of the creature's one action a
    // round, so enemy_attack is owed one more, and it is one swing.
    oweEnemiesAnAction(encounter, [enemy.id]);
    encounter.legendary.strikes = [...(encounter.legendary.strikes ?? []), enemy.id];
  }
  // An ability with its own numbers (Wing Attack's save) is bought for
  // aoe_damage or cast_at_player naming it; a cantrip or a spell from its
  // list for the call that casts it (enemy-casting.ts).
  const bought = ability ? abilityKey(ability.name) : purchase.kind === "cantrip" || purchase.kind === "spell" ? purchase.kind : null;
  if (bought) {
    const ledger = encounter.legendary.abilities?.[enemy.id] ?? {};
    encounter.legendary.abilities = {
      ...(encounter.legendary.abilities ?? {}),
      [enemy.id]: { ...ledger, bought: [...(ledger.bought ?? []), bought] },
    };
  }
  // What a later call makes is remembered with its price, so that call
  // refused gives the action back (legendary-purchase.ts, and the card's
  // one call in legendary-play.ts).
  const first = route?.steps[0];
  const move = first?.kind === "move" ? legendaryMoveFor(enemy, first) : null;
  if (route && !own) {
    encounter.legendary.purchases = {
      ...(encounter.legendary.purchases ?? {}),
      [enemy.id]: {
        action: outcome.action.name,
        cost: outcome.action.cost,
        key,
        strike: Boolean(attack),
        bought,
        ...(move ? { move } : {}),
        ...(first?.kind === "teleport" ? { teleportFeet: first.feet } : {}),
      },
    };
  }
  saveEncounter(encounter);
  const made = own ? resolveSelfStep(campaign, turn, enemy, own, outcome.action.name, ownAbility?.dc ?? null) : {};
  publishEncounter(campaign);
  const next = own ? null : nextStep(enemy, first);
  return {
    ok: true,
    enemy: enemy.displayName,
    action: outcome.action.name,
    text: outcome.action.text,
    remaining: outcome.pool.actions,
    ...(routes.length > 1 && route ? { played: route.use } : {}),
    ...made,
    ...(next ? { next } : {}),
    // An option the server cannot read: spent, and the rest is the GM's.
    ...(!routes.length ? { manual: `The server cannot read what ${outcome.action.name} does: resolve it by hand from its line.` } : {}),
  };
}

const resistSchema = z.object({ enemyId: z.string().min(1) });

export function handleLegendaryResist(campaign: Campaign, rawArguments: string): ToolResult {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter: Legendary Resistance is spent only in a fight.", retry: true };
  }
  let args: z.infer<typeof resistSchema>;
  try {
    args = resistSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: legendary_resist needs enemyId.", error, rawArguments);
  }
  const enemy = resolveEnemyRef(encounter.id, args.enemyId);
  if (!enemy) {
    return unknownEnemyRef(encounter.id, "enemyId", args.enemyId);
  }
  const pool = encounter.legendary.pools[enemy.id];
  if (!pool) {
    return { error: `${enemy.displayName} has no Legendary Resistance: the save stands as rolled.`, retry: true };
  }
  // Legendary Resistance answers a save the creature has just failed: the
  // server keeps the last one (src/lib/dm/forced-save.ts) and turns exactly
  // that failure into a success, once.
  const failed = encounter.legendary.failedSave;
  if (!failed || failed.enemyId !== enemy.id || failed.round !== encounter.round || failed.resisted) {
    return {
      error: `${enemy.displayName} has no failed save to turn into a success this round. Legendary Resistance answers a save the server just rolled and the creature failed. Nothing was spent.`,
      retry: true,
    };
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} already fell to that save; Legendary Resistance is spent before the effect lands. Nothing was spent.`, retry: true };
  }
  const spent = spendResistance(pool);
  if (!spent) {
    return { error: `${enemy.displayName} has no Legendary Resistance left.`, retry: true };
  }
  // Settle the save as a success: what it laid comes off, and the hit points
  // a success would have spared come back.
  let conditions = enemy.conditions;
  let meta = enemy.conditionMeta as ConditionMetaMap;
  const lifted: string[] = [];
  for (const name of failed.conditions ?? []) {
    const out = removeConditionInstances(conditions, meta, name, (entry) =>
      (!failed.spell || !entry.spell || textKey(entry.spell) === textKey(failed.spell)) && (!failed.source || !entry.source || entry.source === failed.source),
    );
    if (out.removed > 0) {
      lifted.push(name);
    }
    conditions = out.conditions;
    meta = out.meta;
  }
  if (lifted.length) {
    patchEnemyConditions(enemy.id, conditions, meta);
  }
  const refund = Math.min(failed.refund ?? 0, Math.max(0, enemyHpCap(enemy) - enemy.currentHp));
  if (refund > 0) {
    patchEnemyHp(enemy.id, enemy.currentHp + refund, "alive");
  }
  encounter.legendary.pools[enemy.id] = spent;
  encounter.legendary.failedSave = { ...failed, resisted: true };
  saveEncounter(encounter);
  publishEncounter(campaign);
  return {
    ok: true,
    enemy: enemy.displayName,
    remaining: spent.resistances,
    save: failed.detail,
    ...(lifted.length ? { lifted: lifted.join(", ") } : {}),
    ...(refund > 0 ? { restored: `${refund} hit points a success would have spared` } : {}),
    note: "The failed save is now a success and the server has settled it as one; narrate the effect shrugged off.",
  };
}

const lairSchema = z.object({ action: z.string().trim().min(1).max(300) });

export function handleLairAction(campaign: Campaign, turn: DmTurn | null, rawArguments: string): ToolResult {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter: lair actions are taken only in a fight.", retry: true };
  }
  let args: z.infer<typeof lairSchema>;
  try {
    args = lairSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: lair_action needs an action.", error, rawArguments);
  }
  if (!encounter.legendary.lair) {
    return { error: "This fight is not in a lair: there are no lair actions, and the enemies act on their own turns.", retry: true };
  }
  // Initiative count 20, losing ties: the move that passed it opened the
  // lair's moment, and the next move closes it (encounter-tools.ts).
  const due = encounter.legendary.lairDue;
  if (due === undefined) {
    return {
      error: "The lair acts on initiative count 20 (losing ties): after every creature at 20 or higher has had its turn, before anyone lower. That moment has not come with this turn; the server announces it (\"Initiative 20: the lair stirs\"). Nothing was done.",
      retry: true,
    };
  }
  if (encounter.legendary.lairUsedRound === due) {
    return { error: `The lair already acted this round (round ${due}).`, retry: true };
  }
  // A block that prints its lair options is held to them.
  const enemies = listEnemies(encounter.id);
  const options = legendaryLairLines(enemies);
  const picked = options.length ? pickLairOption(options, args.action) : args.action;
  if (!picked) {
    return { error: `The lair's options are printed in its block; send one's number (or its whole line): ${options.map((line, at) => `${at + 1}. ${line}`).join(" ")}`, retry: true };
  }
  const repeated = lairRepeatRefusal(options, picked, encounter.legendary, due, lairForbidsRepeat(enemies));
  if (repeated) {
    return { error: repeated, retry: true };
  }
  encounter.legendary.lairUsedRound = due;
  encounter.legendary.lairLast = picked;
  saveEncounter(encounter);
  const seq = tableNoteSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    glyph: "cue-battle",
    content: `Lair action (initiative 20, round ${due}): ${picked}`,
    ...(turn ? { dmTurnId: turn.id } : {}),
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
  publishEncounter(campaign);
  const resolution = options.length ? lairResolution(picked) : null;
  return {
    ok: true,
    round: due,
    note: `The lair acts on initiative 20 of round ${due}: ${picked}`,
    ...(resolution ? { next: resolution } : {}),
    lairActions: options,
  };
}
