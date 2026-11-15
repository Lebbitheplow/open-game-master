// An answer that would slay the creature that struck waits on the reaction
// that could still turn the hit into a miss (the lead's ruling on S20).
//
// SRD 5.1 decides a reaction to a hit before the hit does anything: Shield
// counts "including against the triggering attack", Cutting Words comes
// "before the GM determines whether the attack roll succeeds", and Fire
// Shield, Armor of Agathys and Thought Shield answer only a creature that
// hits. The engine lands an enemy's hit and its answers in one call
// (enemy-attack.ts, opportunity.ts) and every reaction after it, and takes an
// answer back when the reaction turns the swing into a miss
// (reaction-refund.ts settleHits). It never raises a creature an answer slew,
// though: its death let go of what it held, took its token off the board and
// may have ended the fight. So an answer that would slay its attacker, on a
// swing a reaction could still turn (reactionCouldTurn), is held on the swing
// (last-hit.ts SwingRecord.waiting) and lands when the hit is settled:
//   - a reaction answers it (settleWaiting, from settleHits): a swing now a
//     miss drops it, the creature never touched; one that still hits lands
//     it, unless another reaction could still turn it;
//   - the hit stops being correctable (landClosedWaits, from the one door
//     every call takes, invoke-dispatch.ts): it is no longer open
//     (last-hit.ts openHits), or a call of a later GM turn that is no
//     reaction comes first. Within the GM turn that rolled it the hit stays
//     open, as it does for the reactions themselves.
// An answer no reaction could change lands at once, as before.

import type { Campaign } from "@/lib/db/campaigns";
import { getDmTurn, type DmTurn } from "@/lib/db/dm-turns";
import { getEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { spellFactsFor } from "@/lib/content";
import { reactionFreeFor } from "@/lib/dm/after-roll";
import { spellHeldProblem } from "@/lib/dm/cast-rules";
import { isIncapacitated } from "@/lib/dm/condition-logic";
import { owningTurnOf } from "@/lib/dm/job-control";
import { hitIdOf, hitsWaiting, openHits, writeLastHit, type LastHit, type SwingRecord } from "@/lib/dm/last-hit";
import { joinRetorts, type Retort, type WaitingAnswer } from "@/lib/dm/retort-logic";
import { landAnswer, measureRetort } from "@/lib/dm/spell-retort";
import { gateHolds, heldAuthored } from "@/lib/srd/authored-effects";
import type { ReactionDoes } from "@/lib/srd/authored-effects-types";
import { defensiveDuelistBonus } from "@/lib/srd/feat-combat";
import { holdsFeature } from "@/lib/srd/feature-names";
import { classLevelFor } from "@/lib/srd/multiclass";
import { proficiencyBonusOf } from "@/lib/srd/proficiency";
import { subclassNamed } from "@/lib/srd/subclass-name";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The roll of the swing, as a reaction meets it.
export type SwingRoll = { total: number; natural20: boolean; vsAc: number; melee: boolean };

const up = (sheet: CharacterSheet) => (sheet.currentHp > 0 || Boolean(sheet.wildShape)) && !sheet.deathSaves?.dead;

const free = (campaignId: string, sheet: CharacterSheet) => reactionFreeFor(campaignId, sheet.id) && !isIncapacitated(sheet.conditions) && !sheet.deathSaves?.dead;

// A slot of any level left, the pact's included.
function slotLeft(sheet: CharacterSheet): boolean {
  const casting = sheet.spellcasting;
  return Boolean(casting && (Object.values(casting.slots ?? {}).some((slot) => slot.max > slot.used) || (casting.pact && casting.pact.max > casting.pact.used)));
}

// The Bardic Inspiration die's faces, as Cutting Words rolls it
// (reaction-tools.ts bardDie).
function bardFaces(sheet: CharacterSheet): number {
  const level = classLevelFor(sheet, "bard") || sheet.level;
  return level >= 15 ? 12 : level >= 10 ? 10 : level >= 5 ? 8 : 6;
}

// Cutting Words with a die left whose largest face turns the roll.
function cuttingWords(sheet: CharacterSheet, roll: SwingRoll): boolean {
  const lore = (subclassNamed(sheet.subclass ?? "", "College of Lore") && classLevelFor(sheet, "bard") >= 3) || holdsFeature(sheet, "cutting words");
  const pool = sheet.resources?.bardic_inspiration;
  return lore && Boolean(pool && pool.used < pool.max) && !roll.natural20 && roll.total - bardFaces(sheet) < roll.vsAc;
}

// An authored reaction that acts on the roll of a hit on its holder and so
// can make it a miss (reaction-kinds.ts timingOfDoes): an AC raise,
// disadvantage, a reroll the roller must keep, a forced or chanced miss, a
// penalty off the roll, a redirect after the hit.
function turnsOwnHit(does: ReactionDoes): boolean {
  switch (does.kind) {
    case "ac_vs_hit":
    case "disadv_vs_hit":
    case "force_miss":
    case "chance_miss":
    case "attack_penalty":
      return true;
    case "reroll_hit":
      return Boolean(does.roller);
    case "redirect":
      return !does.within;
    default:
      return false;
  }
}

function authoredTurns(sheet: CharacterSheet): boolean {
  return heldAuthored(sheet).some((held) =>
    (held.entry.reactions ?? []).some((reaction) => {
      const pool = reaction.pool;
      const state = pool && "id" in pool ? sheet.resources?.[pool.id] : null;
      const left = !pool || !("id" in pool) || Boolean(state && state.max - state.used >= (pool.amount ?? 1));
      return (reaction.usedBy ?? "holder") === "holder" && turnsOwnHit(reaction.does) && left && gateHolds(reaction.gate, sheet, held);
    }),
  );
}

// Whether a reaction could still turn this swing into a miss: the struck
// character's own while their reaction is theirs (Shield with a slot left,
// Cutting Words with a die, Defensive Duelist with a finesse weapon in hand,
// a held feature's reaction that acts on the roll), judged as they stood
// before the blow; or an ally's Cutting Words or Protection.
export function reactionCouldTurn(campaignId: string, struck: CharacterSheet, roll: SwingRoll): boolean {
  if (free(campaignId, struck)) {
    const shield = !roll.natural20 && roll.total < roll.vsAc + 5 && slotLeft(struck) && !spellHeldProblem(struck, "Shield", spellFactsFor("Shield"));
    const duelist = defensiveDuelistBonus(struck, proficiencyBonusOf(struck));
    const parry = roll.melee && !roll.natural20 && duelist !== null && roll.total < roll.vsAc + duelist;
    if (shield || parry || cuttingWords(struck, roll) || authoredTurns(struck)) {
      return true;
    }
  }
  return listSheets(campaignId).some((ally) => ally.id !== struck.id && up(ally) && free(campaignId, ally) && (cuttingWords(ally, roll) || holdsFeature(ally, "protection")));
}

const rollOf = (record: LastHit, swing: SwingRecord): SwingRoll => ({ total: swing.total, natural20: swing.natural === 20, vsAc: swing.vsAc, melee: !(swing.ranged ?? record.ranged) });

// The answers land, each read as any answer is (spell-retort.ts
// measureRetort), so a later reaction that turns the swing takes them back.
function landWaiting(campaign: Campaign, turn: DmTurn, answers: WaitingAnswer[], sheets: CharacterSheet[], sheetsById: Map<string, CharacterSheet>): { lines: string[]; retort: Retort | null } {
  let retort: Retort | null = null;
  const lines: string[] = [];
  for (const answer of answers) {
    const measured = measureRetort(answer.enemyId, () => landAnswer(campaign, turn, answer, sheets, sheetsById), (out) => (out.length ? [answer.by] : []));
    lines.push(...measured.result);
    retort = joinRetorts(retort, measured.retort);
  }
  return { lines, retort };
}

// The swing with its waiting answers landed and kept as its answer.
function landed(campaign: Campaign, turn: DmTurn, swing: SwingRecord, lines: string[], sheets: CharacterSheet[], sheetsById: Map<string, CharacterSheet>): SwingRecord {
  const plain = { ...swing };
  delete plain.waiting;
  if (!swing.hit || !swing.waiting?.length) {
    return plain;
  }
  const out = landWaiting(campaign, turn, swing.waiting, sheets, sheetsById);
  lines.push(...out.lines);
  const retort = joinRetorts(swing.retort ?? null, out.retort);
  return retort ? { ...plain, retort } : plain;
}

// A reaction has answered these hits (reaction-refund.ts settleHits, with
// each hit's swings as now corrected): a swing it turned into a miss drops
// what waited on it, the creature untouched; one that still hits lands it,
// unless a reaction could still turn it.
export function settleWaiting(
  campaign: Campaign,
  turnId: string,
  steps: Array<{ record: LastHit; corrected: SwingRecord[] }>,
  notes: string[],
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
) {
  const turn = getDmTurn(turnId);
  for (const step of steps) {
    const struck = getSheetById(step.record.characterId);
    step.corrected = step.corrected.map((swing) => {
      if (!swing.waiting?.length) {
        return swing;
      }
      if (!swing.hit) {
        for (const answer of swing.waiting) {
          const enemy = getEnemy(answer.enemyId);
          notes.push(`${answer.by} never came: the hit it answered now misses, and ${enemy?.displayName ?? "the creature"} takes none of its ${answer.amount} ${answer.type} damage.`);
        }
        const plain = { ...swing };
        delete plain.waiting;
        return plain;
      }
      if (!turn || (struck && reactionCouldTurn(campaign.id, struck, rollOf(step.record, swing)))) {
        return swing;
      }
      return landed(campaign, turn, swing, notes, sheets, sheetsById);
    });
  }
}

// Before a call that is no reaction: every waiting answer of a hit no
// longer open, or of a hit rolled in another GM turn, lands first (the hit
// stops being correctable as the next thing is done). Returns the lines for
// the call's result.
export function landClosedWaits(campaign: Campaign, turn: DmTurn, sheets: CharacterSheet[], sheetsById: Map<string, CharacterSheet>): string[] {
  const waiting = hitsWaiting(campaign.id);
  if (!waiting.length) {
    return [];
  }
  const now = owningTurnOf(turn.id);
  const lines: string[] = [];
  for (const record of waiting) {
    const open = openHits(campaign.id, record.characterId).some((hit) => hitIdOf(hit) === hitIdOf(record));
    if (open && record.dmTurn && record.dmTurn === now) {
      continue;
    }
    writeLastHit(campaign.id, { ...record, swings: record.swings.map((swing) => (swing.waiting?.length ? landed(campaign, turn, swing, lines, sheets, sheetsById) : swing)) });
  }
  return lines;
}
