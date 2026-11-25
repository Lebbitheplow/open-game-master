import type { Campaign } from "@/lib/db/campaigns";
import { cannotBeSurprised } from "@/lib/dm/surprise-guard";
import { canSurprise } from "@/lib/dm/genre-b-surprise";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { recordRoll } from "@/lib/dm/roll-record";
import { getSheetById } from "@/lib/db/sheets";
import { d20Expression } from "@/lib/dice";
import { watchfulPassivePerception } from "@/lib/bestiary/enemy-numbers";
import { passiveScore } from "@/lib/dm/check-tools";
import { getClock } from "@/lib/db/clock";
import { pacePerceptionShift } from "@/lib/dm/notice-logic";
import { applyInitiativeRefills } from "@/lib/dm/feature-spends";
import { heldDieWaits, rollExtrasFor, spendRollCarriers } from "@/lib/dm/forced-save";
import { initiativeWaits, rollCharacterD20 } from "@/lib/dm/character-roll";
import { resolveRollExpression, type RollArgs } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { dmRoll } from "@/lib/dm/roll-card";
import { getRoll } from "@/lib/db/rolls";
import { rollDecidesSurprise, rollSkill } from "@/lib/roll-parts";

// What the party's Stealth is filed as when a fight opens on its ambush.
const AMBUSH_DETAIL = "stealth, lying in wait";

// What happens as a fight opens (SRD 5.1, Combat Step by Step): who is
// surprised, decided by the hiders' Stealth against each opponent's passive
// Perception, and the initiative rolls of every character the server rolls
// for. Split from encounter-tools.ts, which calls it; it must not import
// encounter-tools (the initiative totals go back through a callback).
//
// Inside the GM call that opens the fight, every roll here joins that call's
// turn (issue #915): a creature's Stealth through dmRoll, a character's
// Stealth and initiative through the one door for a roll's record
// (roll-record.ts). No turn is handed in, so a fight opened outside a call
// (a companion turning on the party, encounter-tools.ts startFightAgainst)
// leaves them on none.

// A creature's Stealth: its block's skill, else its Dexterity.
function enemyStealth(enemy: EncounterEnemy): number {
  const skill = enemy.stats.skills?.stealth;
  return typeof skill === "number" && Number.isFinite(skill) ? skill : enemy.stats.dexMod;
}

export type Ambush = { surprisedIds: string[]; lines: string[] };

// The side lying in wait rolls Stealth, each creature once; every opponent
// whose passive Perception is below all of them notices no threat and is
// surprised (a Stealth total that meets the passive score stays hidden, as
// the Hide action reads it). A character with the Alert feat, conscious,
// is never surprised.
export function decideAmbush(
  campaign: Campaign,
  hiders: "enemies" | "party",
  enemies: EncounterEnemy[],
  sheets: CharacterSheet[],
): Ambush {
  const stealth: number[] = [];
  if (hiders === "enemies") {
    for (const enemy of enemies) {
      const outcome = dmRoll(campaign.id, null, "skill_check", `${enemy.displayName}: stealth, lying in wait`, d20Expression(enemyStealth(enemy)));
      stealth.push(outcome.total);
    }
    const lowest = Math.min(...stealth);
    // A party jumped on a fast march watches with -5 (notice-logic.ts).
    const pace = pacePerceptionShift(getClock(campaign.id).travelPace);
    const surprised = sheets.filter((stale) => {
      const sheet = getSheetById(stale.id) ?? stale;
      if (cannotBeSurprised(sheet, enemies)) {
        return false;
      }
      const passive = passiveScore(campaign, sheet, "perception") + pace;
      // Only the hiders that can surprise this one count: Anticipate
      // Violence and Scent the Wind (src/lib/dm/genre-b-surprise.ts).
      const counted = stealth.filter((_, index) => canSurprise(sheet, enemies[index]));
      if (counted.length < stealth.length) {
        return counted.length > 0 && Math.min(...counted) >= passive;
      }
      return lowest >= passive;
    });
    return {
      surprisedIds: surprised.map((sheet) => sheet.id),
      lines: [
        `The enemies' Stealth: ${stealth.join(", ")}${pace ? " (the party marches at a fast pace: -5 to passive Perception)" : ""}.`,
        surprised.length
          ? `${surprised.map((sheet) => sheet.name).join(", ")} ${surprised.length === 1 ? "notices" : "notice"} nothing and ${surprised.length === 1 ? "is" : "are"} surprised.`
          : "Everyone in the party notices the ambush in time.",
      ],
    };
  }
  // The Stealth that stays hidden from every one of them: a held die is
  // added only to a roll it lifts to that (forced-save.ts heldDieWaits).
  const unseen = enemies.length ? Math.max(...enemies.map((enemy) => watchfulPassivePerception(enemy.stats))) : null;
  const reused: string[] = [];
  for (const stale of sheets) {
    const sheet = getSheetById(stale.id) ?? stale;
    // The Stealth check the GM already asked of them in this same turn is the
    // one that decides the surprise: "I sneak up behind him" was rolled once
    // on the GM's request_roll, and then again here as the fight opened, a
    // second card for the same creep (issue 1109).
    const crept = stealthThisTurn(sheet.id);
    if (crept !== null) {
      stealth.push(crept);
      reused.push(sheet.name);
      continue;
    }
    const waits = heldDieWaits(sheet, unseen);
    const resolved = resolveRollExpression(
      { kind: "skill_check", skill: "stealth", characterId: sheet.id } as RollArgs,
      sheet,
      { ...rollExtrasFor(campaign, sheet, "skill_check"), keepHeldDie: waits },
    );
    if ("error" in resolved || "autoFail" in resolved) {
      // A character who cannot hide gives the ambush away.
      stealth.push(0);
      continue;
    }
    spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
    // Filed as the ambush's own, so a call run again does not take it for
    // the GM's earlier ask (stealthThisTurn below).
    const parts = { ...resolved.parts, purpose: "surprise" as const };
    // The player's own Stealth (src/lib/dm/character-roll.ts): a seat on
    // physical dice rolls it before the surprise is decided, as it then
    // rolls its initiative.
    const outcome = rollCharacterD20(campaign, sheet, {
      kind: "skill_check",
      expression: resolved.expression,
      detail: AMBUSH_DETAIL,
      parts,
      dc: unseen,
      settleHeldDie: waits,
    });
    // Their own dice, through the door above: entered at the table, they
    // are on record and sent as theirs.
    recordRoll({
      campaignId: campaign.id,
      characterId: sheet.id,
      requestedBy: "dm",
      kind: "skill_check",
      detail: AMBUSH_DETAIL,
      parts,
      result: outcome,
    });
    stealth.push(outcome.total);
  }
  const lowest = stealth.length ? Math.min(...stealth) : 0;
  // A Keen sense sharpens the watch: +5 (statblock.ts watchfulPassivePerception).
  const surprised = enemies.filter((enemy) => lowest >= watchfulPassivePerception(enemy.stats));
  return {
    surprisedIds: surprised.map((enemy) => enemy.id),
    lines: [
      `The party's Stealth: ${stealth.join(", ")}${reused.length ? ` (${reused.join(" and ")}'s Stealth check of this turn stands: it was not rolled again)` : ""}.`,
      surprised.length
        ? `${surprised.map((enemy) => enemy.displayName).join(", ")} ${surprised.length === 1 ? "is" : "are"} caught unaware and surprised.`
        : "The enemies spot the ambush in time; nobody is surprised.",
    ],
  };
}

// The total of the Stealth check this character already made in the GM call's
// own turn, on a request_roll: the newest one, or null. Read from the turn
// the running call belongs to (held-call.ts), so a fight a person opens at
// the console, on no turn, rolls as before. The ambush's own roll is not one
// of these: a call run again after a player's dice landed finds its own
// rolls by their place, not here.
function stealthThisTurn(characterId: string): number | null {
  const turn = globalThis.__odmHeldCallTurn?.() ?? null;
  for (const id of [...(turn?.rollIds ?? [])].reverse()) {
    const roll = getRoll(id);
    if (roll && roll.characterId === characterId && roll.kind === "skill_check" && rollSkill(roll, ["stealth"]) && !rollDecidesSurprise(roll)) {
      return roll.total;
    }
  }
  return null;
}

// Initiative for every character whose dice the server rolls (a player who
// holds their own rolls is left to request_roll), rolled as request_roll
// would roll it: effects, Alert, Feral Instinct, the dice card, and the
// uses a roll of initiative gives back. `record` files each total with the
// fight and returns its note.
export function rollOpeningInitiative(
  campaign: Campaign,
  sheets: CharacterSheet[],
  heldUserIds: Set<string>,
  record: (characterId: string, total: number) => string | null,
): { rolled: string[]; waiting: CharacterSheet[]; note: string | null } {
  const rolled: string[] = [];
  const waiting: CharacterSheet[] = [];
  let note: string | null = null;
  for (const stale of sheets) {
    const sheet = getSheetById(stale.id) ?? stale;
    // One whose initiative would wait on what they hold (Lucky, Bardic
    // Inspiration: WAVE1 R4) is asked through request_roll with the rest the
    // opening leaves out (initiative-ask.ts), so the fight opens and their
    // card waits in it as a real-dice seat's does.
    if (heldUserIds.has(sheet.userId) || sheet.deathSaves?.dead || initiativeWaits(campaign, sheet)) {
      waiting.push(sheet);
      continue;
    }
    const resolved = resolveRollExpression(
      { kind: "initiative", characterId: sheet.id } as RollArgs,
      sheet,
      rollExtrasFor(campaign, sheet, "initiative"),
    );
    if ("error" in resolved || "autoFail" in resolved) {
      waiting.push(sheet);
      continue;
    }
    spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
    // Thrown by the server, and still the player's to answer with what they
    // hold (Lucky, Bardic Inspiration: WAVE1 R4) before the order locks.
    const outcome = rollCharacterD20(campaign, sheet, { kind: "initiative", expression: resolved.expression, detail: resolved.detail, mayWait: false });
    const roll = recordRoll({
      campaignId: campaign.id,
      characterId: sheet.id,
      requestedBy: "dm",
      kind: "initiative",
      detail: resolved.detail,
      result: outcome,
    });
    note = record(sheet.id, roll.total) ?? note;
    applyInitiativeRefills(campaign, sheet.id);
    rolled.push(`${sheet.name} ${roll.total}`);
  }
  return { rolled, waiting, note };
}
