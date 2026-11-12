// pc_attack as the model calls it: the whole declaration, one part per
// attack, resolved in order in one call (src/lib/dm/action-parts-logic.ts
// says why). Each part is one attack of handlePcAttack, exactly as its own
// call was: the budget it spends is stored before the next part is planned,
// so Extra Attack, Action Surge's action, Haste's attack and the flurry are
// counted as they always were.
//
// What a feature's first part buys is bought here, through the engine that
// sells it: use_resource spends Action Surge, and the ki and bonus action of
// Flurry of Blows. A part that is refused (a creature already down, one out
// of reach, a wrong id) costs nothing and refuses nothing after it: what it
// would have spent stays owed, and the next call may aim it elsewhere.
//
// Physical dice: the first part to park is planned, paid and parked now, and
// the parts after it wait behind it (runQueuedParts), each made once the one
// before it has landed, its damage included, as the server's dice make them in
// turn: a hidden attacker's first hit gives them away before the second
// swing is planned, and a creature the first blow killed refuses the next as
// a fresh call would. The turn waits for the rolls, and the resumed turn
// answers the call with every part (src/lib/dm/turn.ts).

import { sunBoltStrike } from "@/lib/dm/mt-mr-turn";
import { z } from "zod";
import { listMembers, type Campaign } from "@/lib/db/campaigns";
import { heldRollUserIds } from "@/lib/dice/held-rolls";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getDmTurn, getPendingRoll, listPendingForTurn, setPendingAttack, type DmTurn, type PendingRoll } from "@/lib/db/dm-turns";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import type { AttackRecord } from "@/lib/dm/attack-record";
import { ACTION_SURGED } from "@/lib/dm/action-budget";
import {
  ATTACK_FEATURE_NAMES,
  MAX_PARTS,
  namedFeatureKind,
  partAttackArgs,
  partsResult,
  type AttackFeatureKind,
} from "@/lib/dm/action-parts-logic";
import { instancesOf } from "@/lib/dm/condition-logic";
import { applyDmMutation } from "@/lib/dm/mutations";
import { handlePcAttack, PC_ATTACK_PARKED, PC_ATTACK_WAITS, pcAttackArgsSchema } from "@/lib/dm/pc-attack";
import { gatePcAttack } from "@/lib/dm/pc-attack-gate";
import { resolveSheetRef, unknownSheetRef } from "@/lib/dm/rolls";
import { getFoe } from "@/lib/dm/sheet-foe";
import { badArguments, invalidArguments, type ToolResult } from "@/lib/dm/tool-errors";
import { attacksAllowedFor, budgetFor } from "@/lib/dm/turn-budget";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeat } from "@/lib/srd/feat-effects";
import { NO_BONUS_ATTACK_FEATURE } from "@/lib/srd/authored-economy";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { resolveAttackWeapon } from "@/lib/dm/attack-logic";
import { grantedAttackFor } from "@/lib/srd/granted-attacks";
import { textKey } from "@/lib/language/text-logic";
import { openReaperShare, reaperAttackTwin } from "@/lib/dm/authored-reaper";

// A part parked for the player's physical dice: its roll takes its place
// in the call's answer when the turn resumes (src/lib/dm/turn.ts).
export const AWAITING_ROLL = "awaitingRoll";
// An attack declared behind one whose d20 waits on its player's choice: made
// once that roll lands, and its answer takes this place then (turn.ts).
export const QUEUED_BEHIND = "queuedBehindRoll";

const NEEDS = "Invalid arguments: pc_attack needs characterId and attacks, one entry per attack with its targetEnemyId.";

// Each part's own fields are the single attack's, checked by its schema when
// the part is resolved (pc-attack.ts); here only what the parts share.
const partsSchema = z.object({
  characterId: z.string(),
  endTurn: z.coerce.boolean().optional(),
  attacks: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_PARTS),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function handlePcAttackParts(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  realDiceUserIds: Set<string>,
  toolCallId: string | null,
): ToolResult {
  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments || "{}");
  } catch (error) {
    return badArguments(NEEDS, error, rawArguments);
  }
  if (!isRecord(raw)) {
    return { error: NEEDS, retry: true };
  }
  // The flat shape, one attack (the console's form, a stored turn, an agent
  // program that learned it): a list of one.
  const listed = "attacks" in raw;
  if (!listed) {
    const { characterId, endTurn, ...part } = raw;
    raw = { characterId, endTurn, attacks: [part] };
  }
  const parsed = partsSchema.safeParse(raw);
  if (!parsed.success) {
    return invalidArguments(NEEDS, parsed.error, raw);
  }
  const stale = resolveSheetRef(parsed.data.characterId, sheets, sheetsById);
  if (!stale) {
    return unknownSheetRef("characterId", parsed.data.characterId, sheets);
  }
  const clash = bonusActionClash(stale, parsed.data.attacks);
  if (clash) {
    return clash;
  }
  const outcomes: Record<string, unknown>[] = [];
  let parked = false;
  const parts = parsed.data.attacks;
  for (const [at, part] of parts.entries()) {
    const { result, notes } = resolvePart(campaign, turn, stale.id, part, sheets, sheetsById, realDiceUserIds, toolCallId);
    if (result[PC_ATTACK_PARKED]) {
      parked = true;
      outcomes.push({ [AWAITING_ROLL]: true, ...(notes.length ? { spent: notes } : {}) });
      // The d20 waits on the player (their dice, or their choice on the
      // server's throw): the swings after it are made once it lands, in the
      // order declared, so none lands before it and none is aimed or paid
      // for before the player knows how it went.
      const waits = result[PC_ATTACK_WAITS];
      if (typeof waits === "string" && at < parts.length - 1) {
        queueBehind(waits, stale.id, parts.slice(at + 1));
        outcomes.push(...parts.slice(at + 1).map(() => ({ [QUEUED_BEHIND]: true })));
        break;
      }
      continue;
    }
    outcomes.push(notes.length ? { ...result, spent: notes } : result);
  }
  if (parked) {
    return { [PC_ATTACK_PARKED]: true, attacks: outcomes };
  }
  // Flurry strikes bought and not yet made are said at the top of a list's
  // answer: per part ("1 left this turn") the model ended the turn on one,
  // the ki spent (live, 3 of 10 runs). A flat call (a card, the console)
  // makes its strikes one at a time, as ever.
  const strikes = listed ? (budgetFor(getActiveEncounter(campaign.id), stale.id, attacksAllowedFor(stale), conditionTurnShape(stale.conditions))?.flurryStrikes ?? 0) : 0;
  const owed = strikes > 0 ? { owed: `${strikes} Flurry of Blows strike${strikes === 1 ? "" : "s"} paid for and not yet made: one entry each with feature "Flurry of Blows".` } : {};
  const answer = { ...partsResult(outcomes, "attacks"), ...owed };
  if (outcomes.length === 1) {
    return answer;
  }
  // What the turn still holds is said once, for the whole call, as a lone
  // attack says it (a companion's turn and the backstop read it): each
  // part's own count was true only until the next one swung, and a refused
  // part changed nothing.
  const last = outcomes.findLast((outcome) => typeof outcome.attacksRemaining === "number");
  const counted = last ? { attacksRemaining: last.attacksRemaining, ...(last.extraAttack ? { extraAttack: last.extraAttack } : {}) } : {};
  for (const outcome of outcomes) {
    delete outcome.attacksRemaining;
    delete outcome.extraAttack;
  }
  // A call nothing of which landed because the walk in fell short (the parts
  // after it had no movement left) is the refusal an endTurn still ends the
  // turn on (src/lib/dm/encounter-tools.ts endTurnAfterAttack).
  const unreached = typeof answer.error === "string" && outcomes.some((outcome) => outcome.outOfReach === true);
  return {
    ...answer,
    ...counted,
    ...(unreached ? { outOfReach: true } : {}),
  };
}

function queueBehind(pendingId: string, characterId: string, parts: Record<string, unknown>[]) {
  const pending = getPendingRoll(pendingId);
  if (pending?.attack) {
    setPendingAttack(pendingId, { ...pending.attack, queue: { characterId, parts, toolCallId: pending.toolCallId } } as AttackRecord);
  }
}

// A to-hit roll has landed (pending-roll-land.ts): the attacks queued behind
// it are made now, unless the hit parked its damage for the player, in which
// case they wait behind that roll instead, as the server's dice land the blow
// before the next swing (the blow may kill the creature the next part aims
// at, or spend the turn's Sneak Attack).
export function afterToHitLanded(campaign: Campaign, landed: PendingRoll, roll: { id: string }) {
  const record = getPendingRoll(landed.id)?.attack as AttackRecord | null | undefined;
  if (!record?.queue?.parts.length) {
    return;
  }
  const damage = listPendingForTurn(landed.turnId).find(
    (entry) => entry.status === "pending" && entry.kind === "damage" && (entry.attack as AttackRecord | null)?.toHitRollId === roll.id,
  );
  if (!damage?.attack) {
    runQueuedParts(campaign, landed);
    return;
  }
  setPendingAttack(damage.id, { ...damage.attack, queue: { ...record.queue, toolCallId: record.queue.toolCallId ?? landed.toolCallId } } as AttackRecord);
  setPendingAttack(landed.id, { ...record, queueMovedTo: damage.id } as AttackRecord);
}

// The results of the attacks queued behind a to-hit roll: on its own record,
// or on the damage roll it handed the queue to (afterToHitLanded).
export function queuedResultsFor(record: AttackRecord | null | undefined): Record<string, unknown>[] | undefined {
  if (!record) {
    return undefined;
  }
  const moved = record.queueMovedTo ? (getPendingRoll(record.queueMovedTo)?.attack as AttackRecord | null | undefined) : null;
  return record.queueMovedTo ? moved?.queuedResults : record.queuedResults;
}

// The attacks queued behind a roll that has just landed (pending-roll-land.ts),
// made now as the call would have made them: each is planned against the
// fight as it stands, so one aimed at a creature the roll killed is refused
// as a fresh call would refuse it. What they did rides back on the landed
// roll's record (queuedResults) and takes their places in the call's answer
// when the turn resumes. One of them may wait on its own d20: the rest queue
// behind that one in turn.
export function runQueuedParts(campaign: Campaign, landed: PendingRoll) {
  const pending = getPendingRoll(landed.id);
  const record = pending?.attack as AttackRecord | null | undefined;
  const queue = record?.queue;
  const turn = getDmTurn(landed.turnId);
  if (!pending || !record || !queue?.parts.length || !turn) {
    return;
  }
  const sheets = listSheets(campaign.id);
  const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  // A player on physical dice rolls the queued parts too, each parked in turn.
  const realDice = heldRollUserIds(campaign.gameSettings.dicePolicy, listMembers(campaign.id));
  const results: Record<string, unknown>[] = [];
  for (const [at, part] of queue.parts.entries()) {
    const { result, notes } = resolvePart(campaign, turn, queue.characterId, part, sheets, sheetsById, realDice, queue.toolCallId ?? pending.toolCallId);
    if (result[PC_ATTACK_PARKED]) {
      results.push({ [AWAITING_ROLL]: true, ...(notes.length ? { spent: notes } : {}) });
      const waits = result[PC_ATTACK_WAITS];
      if (typeof waits === "string" && at < queue.parts.length - 1) {
        queueBehind(waits, queue.characterId, queue.parts.slice(at + 1));
        results.push(...queue.parts.slice(at + 1).map(() => ({ [QUEUED_BEHIND]: true })));
        break;
      }
      continue;
    }
    results.push(notes.length ? { ...result, spent: notes } : result);
  }
  setPendingAttack(pending.id, { ...record, queuedResults: results } as AttackRecord);
}

// A call's answer with the attacks queued behind a landed roll in their
// places: the answers they got when it landed, in order, or, where the roll
// never landed them, that they were not made.
export function fillQueuedParts(attacks: Record<string, unknown>[], from: number, results: Record<string, unknown>[] | undefined): void {
  let next = 0;
  for (let at = from + 1; at < attacks.length; at += 1) {
    if (attacks[at][AWAITING_ROLL] === true) {
      // A part still waiting on its own roll: whatever follows it is that
      // roll's to fill.
      break;
    }
    if (attacks[at][QUEUED_BEHIND] !== true) {
      continue;
    }
    attacks[at] = results?.[next] ?? { made: false, note: "This attack was not made: the roll before it never landed. Nothing was spent on it." };
    next += 1;
  }
}

function resolvePart(
  campaign: Campaign,
  turn: DmTurn,
  sheetId: string,
  part: Record<string, unknown>,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  realDiceUserIds: Set<string>,
  toolCallId: string | null,
): { result: ToolResult; notes: string[] } {
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return { result: unknownSheetRef("characterId", sheetId, sheets), notes: [] };
  }
  const { named, kind } = partKind(sheet, part);
  if (named && !kind) {
    return { result: { error: `${sheet.name} has no feature called "${named}". ${FEATURE_NAMES}`, retry: true }, notes: [] };
  }
  const said: string[] = [];
  const args = partAttackArgs(sheet.id, part, kind);
  // SRD 5.1: Flurry of Blows is "two unarmed strikes" and Martial Arts' bonus
  // attack "one unarmed strike". A part naming anything else for one (the
  // monk's staff, the feature's own name) strikes unarmed, as the feature
  // does: refused, the part was lost after the flurry was bought (it was,
  // live, both ways).
  if ((kind === "flurry" || kind === "martial arts") && typeof args.weapon === "string" && !naturalAttack(sheet, args.weapon)) {
    said.push(`${kind === "flurry" ? "Flurry of Blows" : "Martial Arts"} strikes are unarmed: struck with an unarmed strike, not the ${args.weapon}.`);
    args.weapon = "unarmed strike";
  }
  if (args.stunningStrike === true && typeof args.targetEnemyId === "string" && stunnedThroughNextTurn(args.targetEnemyId, sheet.id)) {
    delete args.stunningStrike;
    said.push("Stunning Strike not used: the target is already stunned until the end of the monk's next turn, and a second stun would end with it. No ki spent.");
  }
  // What refuses the strike whatever the feature buys is asked before it is
  // bought: bought first, the Action Surge after a swing that dropped the
  // last foe spent its use on a fight already over, and a flurry aimed at a
  // creature the action's swings had killed spent the ki for strikes the
  // player had not aimed anywhere else.
  const unmade = kind === "action surge" || kind === "flurry" ? refusedBeforeBuying(campaign, sheet, args) : null;
  if (unmade) {
    return { result: unmade, notes: said };
  }
  const bought = buyFeature(campaign, turn, sheet, kind, sheets, sheetsById);
  if (bought && "refused" in bought) {
    return { result: bought.refused, notes: said };
  }
  const notes = bought ? [bought.note, ...said] : said;
  // Reaper and Improved Reaper on an attack-roll spell: the second creature
  // within 5 feet of the first, from the same casting (authored-reaper.ts).
  const twin = reaperAttackTwin(campaign, sheet, args);
  if (twin && "error" in twin) {
    return { result: twin, notes };
  }
  delete args.secondTargetEnemyId;
  const result = handlePcAttack(campaign, turn, JSON.stringify(args), sheets, sheetsById, realDiceUserIds, toolCallId, { mayWait: true });
  if (twin && typeof result.error !== "string") {
    openReaperShare(campaign, sheet, twin.spell, args.level);
    // A first roll waiting on the player's dice: the share stays open, and the
    // second creature's attack is its own pc_attack call once that roll lands.
    if (result[PC_ATTACK_PARKED]) {
      return { result, notes: [...notes, `${twin.feature}: ${twin.secondName} is struck from the same casting with its own pc_attack call (spell "${twin.spell}"), nothing more spent.`] };
    }
    const again = handlePcAttack(campaign, turn, JSON.stringify({ ...args, targetEnemyId: twin.second }), sheets, sheetsById, realDiceUserIds, toolCallId, { mayWait: true });
    return { result: { ...result, secondTarget: again, [twin.feature]: `${twin.spell} also strikes ${twin.secondName}.` }, notes };
  }
  // A feature of theirs that makes no attack of its own (Sneak Attack, a
  // rider on the swing) is no part's feature: sent back
  // with the names a part takes, so the swing is made in the next call
  // instead of read as barred by the rules.
  if (kind === "feature" && typeof result.error === "string" && result.error.includes(NO_BONUS_ATTACK_FEATURE)) {
    return { result: { error: `${named} makes no attack of its own. ${FEATURE_NAMES}`, retry: true }, notes };
  }
  return { result, notes };
}

const FEATURE_NAMES = `An attack's feature names what it is made with: ${ATTACK_FEATURE_NAMES.join(", ")}, or a feat or feature of theirs that grants a bonus attack. A swing of the Attack action names none, and a rider is none: the entry's own fields choose it, and Sneak Attack is the server's.`;

// The part's refusals that owe nothing to its feature, as handlePcAttack
// asks them first (no fight, arguments it cannot read, then
// src/lib/dm/pc-attack-gate.ts: not their turn, a target unknown, already
// down or out of every attack's way), or null.
function refusedBeforeBuying(campaign: Campaign, sheet: CharacterSheet, args: Record<string, unknown>): ToolResult | null {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter. Call start_encounter first.", retry: true };
  }
  const parsed = pcAttackArgsSchema.safeParse(args);
  if (!parsed.success) {
    return invalidArguments("Invalid arguments: pc_attack needs characterId and targetEnemyId.", parsed.error, args);
  }
  const gate = gatePcAttack({ campaign, encounter, sheet, args: parsed.data });
  return "refused" in gate ? gate.refused : null;
}

// What the first part of a feature buys before it swings: Action Surge's
// action, and the flurry's strikes. Null when the part buys nothing (or its
// feature is bought already this turn).
function buyFeature(
  campaign: Campaign,
  turn: DmTurn,
  sheet: CharacterSheet,
  kind: AttackFeatureKind | null,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): { note: string } | { refused: ToolResult } | null {
  if (kind !== "action surge" && kind !== "flurry") {
    return null;
  }
  const budget = budgetFor(getActiveEncounter(campaign.id), sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
  if (kind === "action surge" && budget?.oncePerTurn.includes(ACTION_SURGED)) {
    return null;
  }
  if (kind === "flurry" && (budget?.flurryStrikes ?? 0) > 0) {
    return null;
  }
  const call =
    kind === "action surge"
      ? { characterId: sheet.id, resource: "Action Surge", reason: "the attacks of the action it grants" }
      : { characterId: sheet.id, resource: "Ki", variant: "flurry of blows", reason: "Flurry of Blows" };
  const { result } = applyDmMutation(campaign, turn.id, "use_resource", JSON.stringify(call), sheets, sheetsById);
  if (typeof result.error === "string") {
    return { refused: result };
  }
  return { note: kind === "action surge" ? "Action Surge: one use spent, and its action opened" : "Flurry of Blows: 1 ki and the bonus action spent" };
}

// SRD 5.1 monk, Stunning Strike: stunned "until the end of your next turn".
// A stun this monk laid during this same turn (its next turn not yet begun,
// src/lib/dm/turn-end.ts) ends exactly when a second one would.
function stunnedThroughNextTurn(enemyId: string, monkId: string): boolean {
  const enemy = getFoe(enemyId);
  const held = enemy?.conditions.find((entry) => textKey(entry) === "stunned");
  if (!enemy || !held) {
    return false;
  }
  return instancesOf(enemy.conditionMeta[held]).some((entry) => entry.untilTurnEndOf === monkId && entry.source === monkId && !entry.turnBegun);
}

// A name a monk's strike keeps: an unarmed strike, or an attack a
// condition grants (Alter Self's natural weapons). SRD 5.1 gives no race a
// natural weapon, so everything else a part names is struck unarmed.
function naturalAttack(sheet: CharacterSheet, weapon: string): boolean {
  // A Sun Soul monk's bolt takes a flurry strike's place (mt-mr-turn.ts sunBoltStrike).
  return resolveAttackWeapon([], [], weapon).unarmed || grantedAttackFor(sheet.conditions, weapon, "") !== null || sunBoltStrike(sheet, weapon);
}

// The feature a part names, and what the engine reads it as: one of the
// rules' own, a feat or feature the sheet holds, or none (refused).
function partKind(sheet: CharacterSheet, part: Record<string, unknown>): { named: string | null; kind: AttackFeatureKind | null } {
  const named = typeof part.feature === "string" && part.feature.trim() ? part.feature.trim() : null;
  return { named, kind: named ? (namedFeatureKind(named) ?? (holdsFeat(sheet, named) ? "feature" : null)) : null };
}

const BONUS_ACTION_KINDS: ReadonlySet<AttackFeatureKind> = new Set(["flurry", "martial arts", "frenzy", "off-hand", "feature"]);

// Two features that each take the bonus action, in one call: a turn has one
// bonus action, so in order the first spent it and the second, what the
// player declared, was refused (live: Martial Arts, then Flurry of Blows).
// Refused whole before anything is rolled or spent. Several parts of one
// feature (Flurry's two strikes) are one bonus action.
function bonusActionClash(sheet: CharacterSheet, parts: readonly Record<string, unknown>[]): ToolResult | null {
  const features = new Map<string, string>();
  for (const part of parts) {
    const { named, kind } = partKind(sheet, part);
    if (named && kind && BONUS_ACTION_KINDS.has(kind)) {
      features.set(kind === "feature" ? textKey(named) : kind, named);
    }
  }
  if (features.size < 2) {
    return null;
  }
  return {
    error: `${[...features.values()].join(" and ")} each take the bonus action, and ${sheet.name} has one a turn: send the parts of the one the player chose. Nothing was rolled or spent.`,
    retry: true,
  };
}
