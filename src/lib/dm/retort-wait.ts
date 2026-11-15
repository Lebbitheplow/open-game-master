// An answer that would slay the creature that struck waits on the reaction
// that could still turn the hit into a miss (the lead's rulings on S20 and
// S26), and on nothing else.
//
// SRD 5.1 takes a reaction right after its trigger, before the attacker does
// anything more: Shield counts "including against the triggering attack",
// Cutting Words comes "before the GM determines whether the attack roll
// succeeds", and Fire Shield, Armor of Agathys and Thought Shield answer only a
// creature that hits. The engine lands an enemy's hit and its answers in one
// call (enemy-attack.ts, opportunity.ts) and every reaction after it, and takes
// an answer back when the reaction turns the swing into a miss
// (reaction-refund.ts settleHits). It never raises a creature an answer slew,
// though: its death let go of what it held, took its token off the board and
// may have ended the fight. So an answer that would slay its attacker, on a
// swing a reaction could still turn (reactionCouldTurn), is held on the swing
// (last-hit.ts SwingRecord.waiting) for the reaction decision that comes right
// after the hit:
//   - a reaction answers it (settleWaiting, from settleHits): a swing now a
//     miss drops it, the creature never touched; one that still hits lands
//     it, unless another reaction could still turn it;
//   - anything else done first lands it, and the creature dies as the hit
//     stood (landWaits): a call through the dispatch door that is no
//     use_reaction, in the same GM turn as in a later one (invoke-dispatch.ts);
//     the attacker's next swing of the same call (enemy-attack.ts landSwing);
//     any attack after it (enemy-attack.ts, opportunity.ts); a move on the
//     board (the move route); a turn ending (encounter-tools.ts
//     advancePointer); the fight ending (enemy-damage.ts finishEncounter, the
//     force-end route). It waited once for the rest of the GM turn that rolled
//     it: the goblin whose death waited swung again in the same reply, and a
//     reply that ended the fight dropped the answer, the goblin leaving alive.
// An answer no reaction could change lands at once, as before.

import type { Campaign } from "@/lib/db/campaigns";
import { closeStandInTurn, getDmTurn, openStandInTurn, type DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy } from "@/lib/db/encounters";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { publishWithSeq } from "@/lib/events";
import { spellFactsFor } from "@/lib/content";
import { acBreakdownFor } from "@/lib/srd";
import { reactionFreeFor } from "@/lib/dm/after-roll";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { spellHeldProblem } from "@/lib/dm/cast-rules";
import { isIncapacitated } from "@/lib/dm/condition-logic";
import { currentTurnId } from "@/lib/dm/job-control";
import { attackerFoeId, hitsWaiting, writeLastHit, type LastHit, type SwingRecord } from "@/lib/dm/last-hit";
import { cuttingWordsImmunity } from "@/lib/dm/mt-srd-reach";
import { tableNoteSeq } from "@/lib/dm/narration-slot";
import { joinRetorts, type Retort, type WaitingAnswer } from "@/lib/dm/retort-logic";
import { getFoe } from "@/lib/dm/sheet-foe";
import { landAnswer, measureRetort } from "@/lib/dm/spell-retort";
import { gateHolds, heldAuthored } from "@/lib/srd/authored-effects";
import type { ReactionDoes } from "@/lib/srd/authored-effects-types";
import { defensiveDuelistBonus } from "@/lib/srd/feat-combat";
import { holdsFeature } from "@/lib/srd/feature-names";
import { classLevelFor } from "@/lib/srd/multiclass";
import { proficiencyBonusOf } from "@/lib/srd/proficiency";
import { storerHolding } from "@/lib/srd/spell-storing";
import { subclassNamed } from "@/lib/srd/subclass-name";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The roll of the swing, as a reaction meets it, and who made it.
export type SwingRoll = { total: number; natural20: boolean; vsAc: number; melee: boolean; attackerId?: string | null };

const up = (sheet: CharacterSheet) => (sheet.currentHp > 0 || Boolean(sheet.wildShape)) && !sheet.deathSaves?.dead;

const free = (campaignId: string, sheet: CharacterSheet) => reactionFreeFor(campaignId, sheet.id) && !isIncapacitated(sheet.conditions) && !sheet.deathSaves?.dead;

// Within `feet` on the board, as each reaction's own refusal reads it
// (reaction-tools.ts, authored-reactions.ts): off the board, or a token
// missing, nothing is out of reach.
function near(encounterId: string | null, a: string, b: string | null | undefined, feet: number): boolean {
  const apart = encounterId && b ? tilesBetween(encounterId, a, b) : null;
  return apart === null || apart * 5 <= feet;
}

// A slot of any level left, the pact's included.
function slotLeft(sheet: CharacterSheet): boolean {
  const casting = sheet.spellcasting;
  return Boolean(casting && (Object.values(casting.slots ?? {}).some((slot) => slot.max > slot.used) || (casting.pact && casting.pact.max > casting.pact.used)));
}

// Shield from a slot of the character's own, or out of a Ring of Spell
// Storing they carry that holds it (SRD 5.1: "While wearing this ring, you
// can cast any spell stored in it"), cast as a reaction like any Shield.
function shieldAtHand(sheet: CharacterSheet): boolean {
  return (slotLeft(sheet) && !spellHeldProblem(sheet, "Shield", spellFactsFor("Shield"))) || storerHolding(sheet.equipment ?? [], "Shield") !== null;
}

// The Bardic Inspiration die's faces, as Cutting Words rolls it
// (reaction-tools.ts bardDie).
function bardFaces(sheet: CharacterSheet): number {
  const level = classLevelFor(sheet, "bard") || sheet.level;
  return level >= 15 ? 12 : level >= 10 ? 10 : level >= 5 ? 8 : 6;
}

// Cutting Words with a die left whose largest face turns the roll, at an
// attacker within 60 feet of the bard that can hear the words and is not
// immune to being charmed (reaction-tools.ts cuttingWords refuses the rest).
function cuttingWords(sheet: CharacterSheet, roll: SwingRoll, encounterId: string | null): boolean {
  const lore = (subclassNamed(sheet.subclass ?? "", "College of Lore") && classLevelFor(sheet, "bard") >= 3) || holdsFeature(sheet, "cutting words");
  const pool = sheet.resources?.bardic_inspiration;
  const turns = lore && Boolean(pool && pool.used < pool.max) && !roll.natural20 && roll.total - bardFaces(sheet) < roll.vsAc;
  return turns && near(encounterId, sheet.id, roll.attackerId, 60) && !cuttingWordsImmunity(roll.attackerId ? getFoe(roll.attackerId) : null);
}

// Protection, from a fighter carrying a shield within 5 feet of the struck
// (SRD 5.1: "a creature you can see attacks a target other than you that is
// within 5 feet of you ... You must be wielding a shield").
function protects(ally: CharacterSheet, struck: CharacterSheet, encounterId: string | null): boolean {
  return holdsFeature(ally, "protection") && Boolean(acBreakdownFor(ally).shieldName) && near(encounterId, ally.id, struck.id, 5);
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

// An authored reaction its holder takes for a hit on another creature, in
// the reach authored-reactions.ts holds it to: an AC raise with a range, the
// disadvantage of one that covers allies (Warding Flare with Improved
// Flare), Runic Shield's reroll of a hit within 60 feet (or one that answers
// a roller within its range), a penalty off the roll, a forced miss of an
// attacker within its range.
function turnsAllysHit(does: ReactionDoes, holder: CharacterSheet, struck: CharacterSheet, roll: SwingRoll, encounterId: string | null): boolean {
  switch (does.kind) {
    case "ac_vs_hit":
      return does.rangeFt !== undefined && near(encounterId, holder.id, struck.id, does.rangeFt);
    case "disadv_vs_hit":
      return (Boolean(does.anyAlly) || (does.allyWith !== undefined && holdsFeature(holder, does.allyWith))) && (does.rangeFt === undefined || near(encounterId, holder.id, struck.id, does.rangeFt));
    case "reroll_hit":
      return does.roller ? near(encounterId, holder.id, roll.attackerId, does.rangeFt) : near(encounterId, holder.id, struck.id, does.rangeFt);
    case "attack_penalty":
      return true;
    case "force_miss":
      return does.rangeFt === undefined || near(encounterId, holder.id, roll.attackerId, does.rangeFt);
    default:
      return false;
  }
}

// The holder's own authored reactions with a use left and their gate open
// that `fits` (turnsOwnHit for their own hit, turnsAllysHit for another's).
function authoredTurns(sheet: CharacterSheet, fits: (does: ReactionDoes) => boolean): boolean {
  return heldAuthored(sheet).some((held) =>
    (held.entry.reactions ?? []).some((reaction) => {
      const pool = reaction.pool;
      const state = pool && "id" in pool ? sheet.resources?.[pool.id] : null;
      const left = !pool || !("id" in pool) || Boolean(state && state.max - state.used >= (pool.amount ?? 1));
      return (reaction.usedBy ?? "holder") === "holder" && fits(reaction.does) && left && gateHolds(reaction.gate, sheet, held);
    }),
  );
}

// Whether a reaction could still turn this swing into a miss: the struck
// character's own while their reaction is theirs (Shield from a slot or a
// ring, Cutting Words with a die, Defensive Duelist with a finesse weapon in
// hand, a held feature's reaction that acts on the roll), judged as they
// stood before the blow; or an ally's, in its reach (Cutting Words,
// Protection, the ally's own feature that covers another creature's hit).
export function reactionCouldTurn(campaignId: string, struck: CharacterSheet, roll: SwingRoll): boolean {
  const encounterId = getActiveEncounter(campaignId)?.id ?? null;
  if (free(campaignId, struck)) {
    const shield = !roll.natural20 && roll.total < roll.vsAc + 5 && shieldAtHand(struck);
    const duelist = defensiveDuelistBonus(struck, proficiencyBonusOf(struck));
    const parry = roll.melee && !roll.natural20 && duelist !== null && roll.total < roll.vsAc + duelist;
    if (shield || parry || cuttingWords(struck, roll, encounterId) || authoredTurns(struck, turnsOwnHit)) {
      return true;
    }
  }
  return listSheets(campaignId).some(
    (ally) =>
      ally.id !== struck.id &&
      up(ally) &&
      free(campaignId, ally) &&
      (cuttingWords(ally, roll, encounterId) || protects(ally, struck, encounterId) || authoredTurns(ally, (does) => turnsAllysHit(does, ally, struck, roll, encounterId))),
  );
}

const rollOf = (record: LastHit, swing: SwingRecord): SwingRoll => ({ total: swing.total, natural20: swing.natural === 20, vsAc: swing.vsAc, melee: !(swing.ranged ?? record.ranged), attackerId: attackerFoeId(record) });

// While answers land, what a death among them sets off (the fight's end,
// enemy-damage.ts finishEncounter) lands none of them again.
let landing = false;

function landingOnce<T>(none: T, run: () => T): T {
  if (landing) {
    return none;
  }
  landing = true;
  try {
    return run();
  } finally {
    landing = false;
  }
}

// The answers land, each read as any answer is (spell-retort.ts
// measureRetort), so a later reaction that turns the swing takes them back.
function landWaiting(campaign: Campaign, turn: DmTurn, answers: WaitingAnswer[], sheets: CharacterSheet[], sheetsById: Map<string, CharacterSheet>, holdVictory: boolean): { lines: string[]; retort: Retort | null } {
  let retort: Retort | null = null;
  const lines: string[] = [];
  for (const answer of answers) {
    const measured = measureRetort(answer.enemyId, () => landAnswer(campaign, turn, answer, sheets, sheetsById, holdVictory), (out) => (out.length ? [answer.by] : []));
    lines.push(...measured.result);
    retort = joinRetorts(retort, measured.retort);
  }
  return { lines, retort };
}

// The swing with its waiting answers landed and kept as its answer.
function landed(campaign: Campaign, turn: DmTurn, swing: SwingRecord, lines: string[], sheets: CharacterSheet[], sheetsById: Map<string, CharacterSheet>, holdVictory = false): SwingRecord {
  const plain = { ...swing };
  delete plain.waiting;
  if (!swing.hit || !swing.waiting?.length) {
    return plain;
  }
  const out = landWaiting(campaign, turn, swing.waiting, sheets, sheetsById, holdVictory);
  lines.push(...out.lines);
  const retort = joinRetorts(swing.retort ?? null, out.retort);
  return retort ? { ...plain, retort } : plain;
}

// A swing of the attack still being rolled, before the attacker swings again
// (enemy-attack.ts, through the hit log): what waited on it lands, the lines
// added to `lines`.
export function landSwing(campaign: Campaign, turn: DmTurn, swing: SwingRecord, lines: string[], sheets: CharacterSheet[], sheetsById: Map<string, CharacterSheet>): SwingRecord {
  return swing.waiting?.length ? landed(campaign, turn, swing, lines, sheets, sheetsById) : swing;
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
  landingOnce(undefined, () => {
    for (const step of steps) {
      const struck = getSheetById(step.record.characterId);
      step.corrected = step.corrected.map((swing) => {
        if (!swing.waiting?.length) {
          return swing;
        }
        if (!swing.hit) {
          notes.push(...swing.waiting.map(neverCame));
          const plain = { ...swing };
          delete plain.waiting;
          return plain;
        }
        if (!turn || (struck && reactionCouldTurn(campaign.id, struck, rollOf(step.record, swing)))) {
          return swing;
        }
        return landed(campaign, turn, swing, notes, sheets, sheetsById);
      });
      // A retaliation for the whole attack: no hit of it left, it never
      // came; one that no reaction could turn any longer, it lands.
      const after = step.record.afterWaiting;
      if (after?.length) {
        const hits = step.corrected.filter((swing) => swing.hit);
        if (!hits.length) {
          notes.push(...after.map(neverCame));
          step.record = withoutAfterWaiting(step.record, null);
        } else if (turn && !hits.some((swing) => struck && reactionCouldTurn(campaign.id, struck, rollOf(step.record, swing)))) {
          const out = landWaiting(campaign, turn, after, sheets, sheetsById, false);
          notes.push(...out.lines);
          step.record = withoutAfterWaiting(step.record, out.retort);
        }
      }
    }
  });
}

function neverCame(answer: WaitingAnswer): string {
  const enemy = getEnemy(answer.enemyId);
  return `${answer.by} never came: the hit it answered now misses, and ${enemy?.displayName ?? "the creature"} takes none of its ${answer.amount} ${answer.type} damage.`;
}

// The record with its waiting retaliation gone, and what it did on landing
// kept with the attack's other retaliations (LastHit.afterHit).
function withoutAfterWaiting(record: LastHit, retort: Retort | null): LastHit {
  const plain = { ...record };
  delete plain.afterWaiting;
  const afterHit = joinRetorts(record.afterHit ?? null, retort);
  return afterHit ? { ...plain, afterHit } : plain;
}

// The GM turn a landing is filed under: the one given, the one running, or
// a stand-in opened for it as an opportunity attack's is (a move on the
// board has none, opportunity-strike.ts).
function inTurn<T>(campaignId: string, given: DmTurn | null, run: (turn: DmTurn) => T): T {
  const running = currentTurnId();
  const turn = given ?? (running ? getDmTurn(running) : null);
  if (turn) {
    return run(turn);
  }
  const standIn = openStandInTurn(campaignId);
  try {
    return run(standIn);
  } finally {
    closeStandInTurn(standIn);
  }
}

// Something other than a reaction is being done: every answer still waiting
// lands first, its hit past the moment a reaction could turn it. Returns the
// lines. `holdVictory`: a last foe's fall leaves the fight's end to the GM's
// next turn, for a landing amid code that holds the encounter it read.
// `tell`: the lines go to the table as a note, where no GM reads a call's
// result.
export function landWaits(campaign: Campaign, turn: DmTurn | null, options: { holdVictory?: boolean; tell?: boolean } = {}): string[] {
  return landingOnce<string[]>([], () => {
    const waiting = hitsWaiting(campaign.id);
    if (!waiting.length) {
      return [];
    }
    const lines = inTurn(campaign.id, turn, (at) => {
      const sheets = listSheets(campaign.id);
      const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
      const told: string[] = [];
      for (const record of waiting) {
        const swings = record.swings.map((swing) => (swing.waiting?.length ? landed(campaign, at, swing, told, sheets, sheetsById, options.holdVictory) : swing));
        // The attack's retaliation lands with its swings' answers, while a
        // hit of it stands.
        const after = record.afterWaiting?.length && swings.some((swing) => swing.hit) ? landWaiting(campaign, at, record.afterWaiting, sheets, sheetsById, Boolean(options.holdVictory)) : null;
        told.push(...(after?.lines ?? []));
        writeLastHit(campaign.id, { ...withoutAfterWaiting(record, after?.retort ?? null), swings });
      }
      return told;
    });
    if (options.tell && lines.length) {
      const seq = tableNoteSeq(campaign.id);
      const message = insertCampaignMessage({ campaignId: campaign.id, seq, authorType: "system", glyph: "cue-battle", content: lines.join(" ") });
      publishWithSeq(campaign.id, seq, "message_added", { message });
    }
    return lines;
  });
}
