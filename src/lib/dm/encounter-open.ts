import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { insertRoll } from "@/lib/db/rolls";
import { getSheetById } from "@/lib/db/sheets";
import { d20Expression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { watchfulPassivePerception } from "@/lib/bestiary/enemy-numbers";
import { passiveScore } from "@/lib/dm/check-tools";
import { applyInitiativeRefills } from "@/lib/dm/feature-spends";
import { heldDieWaits, rollExtrasFor, spendRollCarriers } from "@/lib/dm/forced-save";
import { initiativeWaits, rollCharacterD20 } from "@/lib/dm/character-roll";
import { resolveRollExpression, type RollArgs } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { dmRoll } from "@/lib/dm/roll-card";
import { holdsFeat } from "@/lib/srd/feat-effects";

// What happens as a fight opens (SRD 5.1, Combat Step by Step): who is
// surprised, decided by the hiders' Stealth against each opponent's passive
// Perception, and the initiative rolls of every character the server rolls
// for. Split from encounter-tools.ts, which calls it; it must not import
// encounter-tools (the initiative totals go back through a callback).

const hasAlert = (sheet: CharacterSheet) =>
  holdsFeat(sheet, "Alert");

// A creature's Stealth: its block's skill, else its Dexterity.
function enemyStealth(enemy: EncounterEnemy): number {
  const skill = enemy.stats.skills?.stealth;
  return typeof skill === "number" && Number.isFinite(skill) ? skill : enemy.stats.dexMod;
}

function publish(campaign: Campaign, roll: ReturnType<typeof insertRoll>) {
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
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
    const surprised = sheets.filter((stale) => {
      const sheet = getSheetById(stale.id) ?? stale;
      if (hasAlert(sheet) && sheet.currentHp > 0) {
        return false;
      }
      return lowest >= passiveScore(campaign, sheet, "perception");
    });
    return {
      surprisedIds: surprised.map((sheet) => sheet.id),
      lines: [
        `The enemies' Stealth: ${stealth.join(", ")}.`,
        surprised.length
          ? `${surprised.map((sheet) => sheet.name).join(", ")} ${surprised.length === 1 ? "notices" : "notice"} nothing and ${surprised.length === 1 ? "is" : "are"} surprised.`
          : "Everyone in the party notices the ambush in time.",
      ],
    };
  }
  // The Stealth that stays hidden from every one of them: a held die is
  // added only to a roll it lifts to that (forced-save.ts heldDieWaits).
  const unseen = enemies.length ? Math.max(...enemies.map((enemy) => watchfulPassivePerception(enemy.stats))) : null;
  for (const stale of sheets) {
    const sheet = getSheetById(stale.id) ?? stale;
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
    // The player's own Stealth (src/lib/dm/character-roll.ts): a seat on
    // physical dice rolls it before the surprise is decided, as it then
    // rolls its initiative.
    const outcome = rollCharacterD20(campaign, sheet, {
      kind: "skill_check",
      expression: resolved.expression,
      detail: "stealth, lying in wait",
      dc: unseen,
      settleHeldDie: waits,
    });
    publish(
      campaign,
      insertRoll({
        campaignId: campaign.id,
        characterId: sheet.id,
        requestedBy: "dm",
        kind: "skill_check",
        detail: "stealth, lying in wait",
        result: outcome,
      }),
    );
    stealth.push(outcome.total);
  }
  const lowest = stealth.length ? Math.min(...stealth) : 0;
  // A Keen sense sharpens the watch: +5 (statblock.ts watchfulPassivePerception).
  const surprised = enemies.filter((enemy) => lowest >= watchfulPassivePerception(enemy.stats));
  return {
    surprisedIds: surprised.map((enemy) => enemy.id),
    lines: [
      `The party's Stealth: ${stealth.join(", ")}.`,
      surprised.length
        ? `${surprised.map((enemy) => enemy.displayName).join(", ")} ${surprised.length === 1 ? "is" : "are"} caught unaware and surprised.`
        : "The enemies spot the ambush in time; nobody is surprised.",
    ],
  };
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
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: sheet.id,
      requestedBy: "dm",
      kind: "initiative",
      detail: resolved.detail,
      result: outcome,
    });
    publish(campaign, roll);
    note = record(sheet.id, roll.total) ?? note;
    applyInitiativeRefills(campaign, sheet.id);
    rolled.push(`${sheet.name} ${roll.total}`);
  }
  return { rolled, waiting, note };
}
