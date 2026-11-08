// Watching a fight for Portent. Most of a fight needs no stop, so a wizard's
// player presses a button for the fight, or the part of it, where a number may
// matter. While it is on, the turn holds an attack, a check or one creature's
// save before the call runs, and the player may put a foretold number on that
// call's d20.
//
// Nothing is paused inside an attack. The held calls run on resume by the same
// code as any other call, with the number armed on the dice
// (src/lib/db/dice-scripts.ts), and it is paid for only if a d20 took it: a
// call the rules refuse, or a roll parked for real dice, costs nothing.

import { armForetold, disarmForetold } from "@/lib/db/dice-scripts";
import type { Campaign } from "@/lib/db/campaigns";
import { createPendingRoll, publicPendingRoll, setPendingWatch, type DmTurn, type HeldCall } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { heroRollTag, type RollTag } from "@/lib/dice-script-logic";
import { rollsCanWait } from "@/lib/dm/after-roll";
import { canWaitOnRoll } from "@/lib/dm/after-roll-logic";
import { spendForetold } from "@/lib/dm/foretold";
import { foretoldLeft } from "@/lib/dm/foretold-logic";
import { getFoe } from "@/lib/dm/sheet-foe";
import { publishPersisted } from "@/lib/events";
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A stop comes before every watched roll, so it cannot ask for long.
export const WATCH_SECONDS = 20;

function holdsCondition(creature: { conditions?: readonly string[] }, ...names: string[]): boolean {
  return (creature.conditions ?? []).some((written) => isConditionNamed(written, ...names));
}

// "a creature that you can see": the engine knows no sight lines here, so this
// reads what it does know of the watcher and of the one about to roll.
function canWatch(sheet: CharacterSheet, encounterId: string): boolean {
  return (
    sheet.watchingEncounterId === encounterId &&
    foretoldLeft(sheet).length > 0 &&
    sheet.currentHp > 0 &&
    !holdsCondition(sheet, "blinded", "unconscious") &&
    rollsCanWait(sheet)
  );
}

function argsOf(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// What a call is about to roll, for the player to read and the number to aim
// at. Null for a call no watch stops. A save is stopped where one creature
// makes it and the call names that creature: an area's many saves would need
// the player to pick whose, and its call does not say which comes first.
function rollAbout(call: HeldCall, sheets: readonly CharacterSheet[]): { tag: RollTag; also?: RollTag[]; line: string; rollerId: string } | null {
  const args = argsOf(call.rawArguments);
  const sheetOf = (id: unknown) => sheets.find((sheet) => sheet.id === id);
  if (call.name === "enemy_attack") {
    const enemy = typeof args.enemyId === "string" ? getFoe(args.enemyId) : null;
    if (!enemy || holdsCondition(enemy, "invisible", "hidden")) {
      return null;
    }
    const target = sheetOf(args.targetCharacterId)?.name;
    return {
      tag: { roller: "enemy", kind: "attack", who: enemy.displayName },
      line: `${enemy.displayName} is about to attack${target ? ` ${target}` : ""}.`,
      rollerId: enemy.id,
    };
  }
  if (call.name === "pc_attack") {
    const hero = sheetOf(args.characterId);
    if (!hero || holdsCondition(hero, "invisible", "hidden")) {
      return null;
    }
    return { tag: { roller: "hero", kind: "attack", who: hero.name }, line: `${hero.name} is about to attack.`, rollerId: hero.id };
  }
  if (call.name === "cast_at_player") {
    // An enemy or a hazard forces one character's save, which the server rolls.
    const hero = sheetOf(args.characterId);
    if (!hero || holdsCondition(hero, "invisible", "hidden")) {
      return null;
    }
    const source = typeof args.source === "string" && args.source.trim() ? ` against ${args.source.trim().slice(0, 80)}` : "";
    return { tag: { roller: "hero", kind: "save", who: hero.name }, line: `${hero.name} is about to make a saving throw${source}.`, rollerId: hero.id };
  }
  if (call.name === "cast_at_enemy") {
    // A hero's spell at one creature: the caster's attack roll or the
    // creature's save, whichever the spell asks for. Only the ones in sight.
    const hero = sheetOf(args.characterId);
    const enemy = typeof args.targetEnemyId === "string" ? getFoe(args.targetEnemyId) : null;
    if (!hero || !enemy) {
      return null;
    }
    const tags: RollTag[] = [
      ...(holdsCondition(enemy, "invisible", "hidden") ? [] : [{ roller: "enemy" as const, kind: "save" as const, who: enemy.displayName }]),
      ...(holdsCondition(hero, "invisible", "hidden") ? [] : [{ roller: "hero" as const, kind: "attack" as const, who: hero.name }]),
    ];
    const [tag, ...also] = tags;
    if (!tag) {
      return null;
    }
    const spell = typeof args.spell === "string" && args.spell.trim() ? args.spell.trim().slice(0, 60) : "a spell";
    return { tag, ...(also.length ? { also } : {}), line: `${hero.name} is about to cast ${spell} at ${enemy.displayName}.`, rollerId: hero.id };
  }
  if (call.name === "aoe_damage") {
    // An area with one creature in it: that one's save. With more, whose
    // save the number should take is the player's to say, and the call does
    // not say which is rolled first.
    const enemyIds = Array.isArray(args.enemyIds) ? args.enemyIds.filter((id): id is string => typeof id === "string") : [];
    const heroIds = Array.isArray(args.characterIds) ? args.characterIds.filter((id): id is string => typeof id === "string") : [];
    if (enemyIds.length + heroIds.length !== 1) {
      return null;
    }
    const enemy = enemyIds[0] ? getFoe(enemyIds[0]) : null;
    const hero = heroIds[0] ? sheetOf(heroIds[0]) : null;
    const name = enemy?.displayName ?? hero?.name;
    if (!name || holdsCondition(enemy ?? hero ?? {}, "invisible", "hidden")) {
      return null;
    }
    const spell = typeof args.spell === "string" && args.spell.trim() ? ` against ${args.spell.trim().slice(0, 60)}` : "";
    return { tag: { roller: enemy ? "enemy" : "hero", kind: "save", who: name }, line: `${name} is about to make a saving throw${spell}.`, rollerId: enemy?.id ?? hero?.id ?? "" };
  }
  if (call.name === "request_roll") {
    const hero = sheetOf(args.characterId);
    const kind = typeof args.kind === "string" ? args.kind : "";
    const tag = hero && canWaitOnRoll(kind) && (args.visibility ?? "public") === "public" ? heroRollTag(kind, hero.name) : undefined;
    if (!hero || !tag) {
      return null;
    }
    return { tag, line: `${hero.name} is about to roll a ${kind.replaceAll("_", " ")}.`, rollerId: hero.id };
  }
  return null;
}

// Holds the calls and parks the turn on the watcher's choice, when someone
// watching could put a number on the first of them. True when it did.
export function parkForWatch(campaign: Campaign, turn: DmTurn, calls: readonly HeldCall[]): boolean {
  const [first] = calls;
  const encounter = first ? getActiveEncounter(campaign.id) : null;
  if (!first || !encounter) {
    return false;
  }
  const sheets = listSheets(campaign.id);
  const about = rollAbout(first, sheets);
  if (!about) {
    return false;
  }
  // A wizard's own check waits on its own card already (invoke-roll.ts).
  const ownCard = first.name === "request_roll";
  const watcher = sheets.find((sheet) => canWatch(sheet, encounter.id) && !(ownCard && sheet.id === about.rollerId));
  if (!watcher) {
    return false;
  }
  const pending = createPendingRoll({
    campaignId: campaign.id,
    turnId: turn.id,
    toolCallId: null,
    userId: watcher.userId,
    characterId: watcher.id,
    kind: "custom",
    detail: about.line,
    expression: "1d20",
    advantage: "none",
    dc: null,
    reason: about.line,
    parkedFor: "watch",
  });
  const deadline = new Date(Date.now() + WATCH_SECONDS * 1000).toISOString();
  const held = setPendingWatch(pending.id, { calls: [...calls], tag: about.tag, ...(about.also ? { also: about.also } : {}), line: about.line, face: null, deadline });
  publishPersisted(campaign.id, "roll_pending", { pendingRoll: publicPendingRoll(held ?? pending) });
  // Past the deadline the roll goes ahead on its own and nothing is spent.
  const timer = setTimeout(() => {
    void import("@/lib/dm/foresight-release").then(({ releaseWatchWhenDue }) => releaseWatchWhenDue(pending.id));
  }, WATCH_SECONDS * 1000);
  timer.unref?.();
  return true;
}

// Runs one held call with the chosen number armed on its first matching d20,
// and pays for the number if a die took it. The line is for the model's answer.
export async function runWithForetold<T>(
  campaign: Campaign,
  turnId: string,
  choice: { watcherId: string; face: number; tags: readonly RollTag[]; line: string } | null,
  run: () => Promise<T>,
): Promise<{ result: T; portent: string | null }> {
  // Spent some other way since it was chosen (the counter moved, an undo): the
  // die rolls honestly rather than show a number nobody paid for.
  const holder = choice ? getSheetById(choice.watcherId) : null;
  if (!choice || !holder || !foretoldLeft(holder).includes(choice.face)) {
    return { result: await run(), portent: null };
  }
  armForetold(campaign.id, { face: choice.face, tags: choice.tags });
  let used = false;
  let result: T;
  try {
    result = await run();
  } finally {
    used = disarmForetold(campaign.id);
  }
  if (!used || !spendForetold(campaign, choice.watcherId, choice.face, turnId, choice.line)) {
    return { result, portent: null };
  }
  const name = getSheetById(choice.watcherId)?.name ?? "A wizard";
  return { result, portent: `${name} foretold this roll with Portent: its d20 shows ${choice.face}.` };
}
