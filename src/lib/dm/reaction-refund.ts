// Turning a re-resolved attack back into state. A reaction (Shield, Uncanny
// Dodge, Deflect Missiles, Cutting Words, Protection, Slow Fall, Feather
// Fall) corrects the swings of an attack against a character that the engine
// kept open (src/lib/dm/last-hit.ts); this module works out what the
// character should have taken and puts them there.
//
// The fight is replayed on the character from where the first hit answered
// found them (hit-replay-logic.ts): each open hit's swings as the damage path
// lands them (an Arcane Ward first, each type against their defenses as
// pc-damage.ts reads them, temporary hit points, a beast form's pool, and on
// a character at 0 a death-save failure per blow, two on a critical hit),
// and between the hits, and since the last, whatever else changed them (an
// area spell, a breath, healing, temporary hit points, their death saves),
// carried as the change it made. Only the corrected swings' own part is taken
// back; everything else since stays. What the undone part of a blow set off
// is undone too: the drop to 0 (unconscious, prone, the death track, a death
// by massive damage), the rage it ended, the Relentless Endurance, Undying
// Sentinel, Death Ward or Relentless Rage that held them up, a Warding Bond's share, and the
// concentration it broke with the effects that spell held.
//
// This module must not import mutations.ts' callers back; it calls the heal
// mutation the same way cast-tools does.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, patchEnemyConditions } from "@/lib/db/encounters";
import { getAuditPreImage, listAuditSince } from "@/lib/db/sheet-audit";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { RAGING } from "@/lib/srd/class-resources";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { WARD_POOL } from "@/lib/dm/arcane-ward";
import { concentrationDamageHook } from "@/lib/dm/concentration";
import { effectiveMaxHp, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { DeathTrack } from "@/lib/dm/death-logic";
import { scaledParts } from "@/lib/dm/enemy-hit";
import {
  carryGaps,
  hitsWith,
  pool,
  replayHit,
  sameStanding,
  strike,
  up,
  type Gap,
  type ReplaySwing,
  type Standing,
  type SwingOutcome,
} from "@/lib/dm/hit-replay-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { answerLabel, carryCuts, hitIdOf, openHits, wardHpOf, writeLastHit, type LastHit, type SwingRecord } from "@/lib/dm/last-hit";
import { applyDmMutation, audit } from "@/lib/dm/mutations";
import { blowDefenses, meetDefenses, WILDFIRE_SPIRIT } from "@/lib/dm/pc-damage";
import { PRONE } from "@/lib/dm/vitals-logic";

const UNCONSCIOUS = "unconscious";
const LETHARGY = "incapacitated";
const DEATH_WARD = "death ward";
const WARDING_BOND = "warding bond";

type Shape = NonNullable<CharacterSheet["wildShape"]>;

function has(list: string[], name: string): boolean {
  return list.some((entry) => entry.toLowerCase() === name);
}

// A condition as the list holds it, by its name.
function heldAs(list: string[], name: string): string | undefined {
  return list.find((entry) => isConditionNamed(entry, name));
}

// A swing as the replay needs it: what of its damage gets through the
// character's defenses as they stood for that hit (their conditions then, a
// form they wore), read by the damage path's own rules (pc-damage.ts) with
// the blow's flags and a reaction's resistance against it, a blow of several
// types part by part. `landedAs` is the swing as it was kept before this
// correction: a blow's ordinary damage (a critical only because they lay at
// 0) comes off by what a reaction took off the blow itself (Cutting Words).
function replaySwing(campaignId: string, sheet: CharacterSheet, record: LastHit, swing: SwingRecord, landedAs: SwingRecord | undefined): ReplaySwing {
  const held = { ...sheet, conditions: record.before.conditions, conditionMeta: record.before.conditionMeta, wildShape: record.before.wildShape ?? null };
  const defenses = blowDefenses(campaignId, held, { ...(swing.flags ?? {}), ...(swing.resists?.length ? { resists: swing.resists } : {}) });
  const type = swing.type ?? record.type;
  // A blow of several types halved or cut whole (Uncanny Dodge) keeps its
  // parts in proportion.
  const landing = (raw: number, parts: SwingRecord["parts"]) => {
    const scaled = parts?.length ? scaledParts(parts, raw) : undefined;
    return (past: number) => meetDefenses(defenses, raw, type || undefined, scaled, raw - past).amount;
  };
  // Every cut a reaction took off the blow comes off the ordinary one the same
  // way (last-hit.ts carryCuts), the ones before this correction with this
  // one; a record that kept no cuts takes off what this correction took.
  const cut = landedAs ? Math.max(0, landedAs.raw - swing.raw) : 0;
  const carried = swing.ordinary && swing.normal ? carryCuts(swing, swing.ordinary.raw, swing.normal.from) : null;
  const ordinaryRaw = swing.ordinary ? (carried ?? Math.max(0, swing.ordinary.raw - cut)) : 0;
  return {
    hit: swing.hit,
    crit: swing.crit,
    raw: swing.hit ? swing.raw : 0,
    land: landing(swing.raw, swing.parts),
    ...(swing.hit && swing.ordinary ? { ordinary: { raw: ordinaryRaw, land: landing(ordinaryRaw, ordinaryRaw !== swing.ordinary.raw ? undefined : swing.ordinary.parts) } } : {}),
    ...(swing.hit && swing.standingAdvantage ? { standingHit: hitsWith(swing, swing.standingAdvantage) } : {}),
  };
}

// The audit kind of what a reaction itself writes to a sheet: the hit points
// it gives back, the use or die it spends, the concentration it restores.
// Kept so "Revert this turn" takes it back with the reaction; never read as
// a change between hits (changesAfter), since the corrected hit carries it.
export const REACTION_AUDIT = "reaction";

// A reaction's own change to a sheet, written and kept in the audit.
export function reactionPatch(campaign: Campaign, turnId: string, sheetId: string, patch: FullPatchSheetInput, reason: string): CharacterSheet | null {
  const before = getSheetById(sheetId);
  const updated = patchSheet(sheetId, patch);
  if (before && updated) {
    audit(campaign, turnId, before, REACTION_AUDIT, { reaction: reason }, reason, patch as Record<string, unknown>);
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return updated;
}

// The sheet fields a change between two hits can move that the replay
// carries (Standing).
const STANDING_FIELDS = ["currentHp", "tempHp", "wildShape", "deathSaves", "resources"];

// The changes the audit kept on the character after a hit and before the
// next began (or since), oldest first, each as the change it made: where
// its pre-image found them and where its patch left them, with the damage
// that went past 0 hit points (the damage path's overkill, which the hit
// points cannot show). A pre-image taken before an earlier change of the
// same call (a beast form that breaks, then the hit points under it) is read
// on from where that change left them. The window is the hits' sequence
// numbers, or their times on records written before them.
function changesAfter(campaignId: string, record: LastHit, next: LastHit | null): Gap<Shape>[] {
  const after = (entry: { seq: number; createdAt: string }) => (record.seqs ? entry.seq > record.seqs.close : entry.createdAt > record.at);
  const beforeNext = (entry: { seq: number; createdAt: string }) =>
    !next || (next.seqs ? entry.seq <= next.seqs.open : entry.createdAt < next.startedAt);
  const changes: Gap<Shape>[] = [];
  let running: CharacterSheet | null = null;
  let lastRead: Standing<Shape> | null = null;
  for (const entry of listAuditSince(campaignId, record.startedAt)) {
    if (entry.characterId !== record.characterId || entry.kind === REACTION_AUDIT || !after(entry) || !beforeNext(entry) || !entry.patchKeys.some((key) => STANDING_FIELDS.includes(key))) {
      continue;
    }
    const image = getAuditPreImage(entry.id);
    if (!image) {
      continue;
    }
    const read = standingOfSheet(image.before);
    if (!running || !lastRead || !sameStanding(read, lastRead)) {
      running = image.before;
    }
    lastRead = read;
    const from = standingOfSheet(running);
    running = { ...running, ...image.patch } as CharacterSheet;
    changes.push({ from, to: standingOfSheet(running), pastZero: Math.max(0, Number(entry.delta.overkill) || 0) });
  }
  return changes;
}

// Puts back the concentration the attack broke, with the conditions the
// spell held on every creature and without the lethargy Haste's end laid.
function restoreConcentration(campaign: Campaign, turnId: string, record: LastHit, label: string): string | null {
  const spell = record.before.concentratingOn;
  const held = record.before.held;
  if (!spell) {
    return null;
  }
  reactionPatch(campaign, turnId, record.characterId, { concentratingOn: spell }, `${answerLabel(label)}: concentration kept`);
  const encounter = getActiveEncounter(campaign.id);
  for (const holder of held?.holders ?? []) {
    const wanted = holder.conditions.filter((name) => held!.names.includes(name.toLowerCase()));
    if (holder.kind === "sheet") {
      const now = getSheetById(holder.id);
      if (!now) {
        continue;
      }
      const missing = wanted.filter((name) => !has(now.conditions, name.toLowerCase()));
      const lethargy = has(now.conditions, LETHARGY) && !has(holder.conditions, LETHARGY);
      if (!missing.length && !lethargy) {
        continue;
      }
      const base = lethargy ? removeConditions(now.conditions, now.conditionMeta, [LETHARGY, "lethargic"]) : { conditions: now.conditions, meta: now.conditionMeta };
      const meta = { ...base.meta } as Record<string, unknown>;
      for (const name of missing) {
        meta[name] = holder.meta[name] ?? {};
      }
      reactionPatch(campaign, turnId, holder.id, {
        conditions: [...base.conditions, ...missing],
        conditionMeta: meta as FullPatchSheetInput["conditionMeta"],
      }, `${answerLabel(label)}: concentration kept`);
    } else if (encounter) {
      const enemy = getEnemy(holder.id);
      if (!enemy || enemy.status !== "alive") {
        continue;
      }
      const missing = wanted.filter((name) => !has(enemy.conditions, name.toLowerCase()));
      const lethargy = has(enemy.conditions, LETHARGY) && !has(holder.conditions, LETHARGY);
      if (!missing.length && !lethargy) {
        continue;
      }
      const base = lethargy ? removeConditions(enemy.conditions, enemy.conditionMeta, [LETHARGY, "lethargic"]) : { conditions: enemy.conditions, meta: enemy.conditionMeta };
      const meta = { ...base.meta } as Record<string, unknown>;
      for (const name of missing) {
        meta[name] = holder.meta[name] ?? {};
      }
      patchEnemyConditions(holder.id, [...base.conditions, ...missing], meta as typeof enemy.conditionMeta);
      publishEncounter(campaign.id);
    }
  }
  return spell;
}

export type Settled = {
  // Hit points (and temporary hit points) given back.
  given: number;
  hp: string;
  notes: string[];
};

// Applies corrected swings to the character the record is about, and keeps
// the corrected record so a second reaction starts from it. `label` names
// the reaction, which the record remembers as answered.
export function settleLastHit(
  campaign: Campaign,
  turnId: string,
  record: LastHit,
  corrected: SwingRecord[],
  label: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Settled {
  return settleHits(campaign, turnId, [{ record, corrected }], label, sheets, sheetsById);
}

// The open hits on the character from the earliest one answered on, in the
// order they landed: what changing that one changes (hit-replay-logic.ts).
function chainFrom(campaignId: string, answers: Array<{ record: LastHit }>): LastHit[] {
  const ids = new Set(answers.map((answer) => hitIdOf(answer.record)));
  // Damage from no attack (last-hit.ts openEffect) is a link of the chain
  // like a hit: replayed as it was dealt, and kept as the corrected fight has it.
  const open = openHits(campaignId, answers[0].record.characterId);
  const from = open.findIndex((record) => ids.has(hitIdOf(record)));
  const chain = from >= 0 ? open.slice(from) : [];
  for (const answer of answers) {
    if (!chain.some((record) => hitIdOf(record) === hitIdOf(answer.record))) {
      chain.push(answer.record);
    }
  }
  return chain;
}

function standingOf(before: LastHit["before"]): Standing<Shape> {
  return {
    currentHp: before.currentHp,
    tempHp: before.tempHp,
    wildShape: before.wildShape ?? null,
    track: before.deathSaves ?? null,
    ward: before.ward ?? null,
  };
}

function standingOfSheet(sheet: CharacterSheet): Standing<Shape> {
  return { currentHp: sheet.currentHp, tempHp: sheet.tempHp, wildShape: sheet.wildShape ?? null, track: sheet.deathSaves ?? null, ward: wardHpOf(sheet) };
}

// Where a hit left them: its record's own account, read with the replay of
// its swings for what a record written before it kept no more of.
function standingAfter(record: LastHit, replayed: Standing<Shape>): Standing<Shape> {
  const form = replayed.wildShape ?? record.before.wildShape ?? null;
  return {
    currentHp: record.after.currentHp,
    tempHp: record.after.tempHp,
    wildShape: record.after.beastHp !== null && form ? { ...form, beastHp: record.after.beastHp } : null,
    track: record.after.track !== undefined ? record.after.track : replayed.track,
    ward: record.after.ward !== undefined ? record.after.ward : (replayed.ward ?? null),
  };
}

// One hit of the fight being replayed: what it did as kept, what the
// corrected swings do, and what changed them after it.
type Step = {
  record: LastHit;
  corrected: SwingRecord[];
  // Where it left them besides its swings: held up at 1 (Relentless
  // Endurance, Death Ward, Relentless Rage) when it dropped them, or a
  // rider's damage on top (a bite's poison on a failed save).
  heldAt: number | null;
  rider: number;
  // As kept: where it found and left them, and each swing's outcome.
  was: { swings: SwingOutcome[]; landed: number };
  // Corrected: where it found them, where it left them, each swing.
  now: { before: Standing<Shape>; after: Standing<Shape>; swings: SwingOutcome[]; dropped: boolean; landed: number; heldUsed: boolean };
  // After it, until the next hit or now: the damage each change dealt in
  // the corrected fight.
  gap: { dealt: number[] };
};

// One or more hits on one character answered at once (Shield answers the
// hit it is cast against and re-checks every open hit after it). The fight
// is replayed from the earliest answered on (see the head of this file), and
// the character is put where the corrected fight leaves them. Every hit of
// it is kept as the corrected fight has it, so a second reaction starts from
// there.
export function settleHits(
  campaign: Campaign,
  turnId: string,
  answers: Array<{ record: LastHit; corrected: SwingRecord[] }>,
  label: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Settled {
  const notes: string[] = [];
  const sheet = answers.length ? getSheetById(answers[0].record.characterId) : null;
  if (!sheet) {
    return { given: 0, hp: "", notes };
  }
  const maxHp = effectiveMaxHp(sheet);
  const chain = chainFrom(campaign.id, answers);
  const correctedOf = new Map(answers.map((answer) => [hitIdOf(answer.record), answer.corrected]));
  const swingsOf = (record: LastHit) => correctedOf.get(hitIdOf(record)) ?? record.swings;
  const first = chain[0];
  const nowStanding = standingOfSheet(sheet);

  // Each hit as it was kept and as it now is, and the gap after it carried.
  // The holds that kept them up in the fight as it was (one each for a
  // Relentless Endurance, a Death Ward, a Relentless Rage spent) stand ready
  // in the corrected one, whichever hit now needs them.
  const steps: Step[] = [];
  let holds = 0;
  let state = standingOf(first.before);
  chain.forEach((record, at) => {
    const corrected = swingsOf(record);
    const actualBefore = standingOf(record.before);
    const was = replayHit(actualBefore, record.swings.map((swing) => replaySwing(campaign.id, sheet, record, swing, swing)), maxHp);
    const left = standingAfter(record, was.after);
    const heldAt = was.dropped && up(left) && !was.after.track?.dead ? left.currentHp : null;
    const rider = heldAt === null ? Math.max(0, pool(was.after) - pool(left)) : 0;
    if (heldAt !== null) {
      holds += 1;
    }
    const before = state;
    const hit = replayHit(before, corrected.map((swing, index) => replaySwing(campaign.id, sheet, record, swing, record.swings[index])), maxHp);
    let after = hit.after;
    let heldUsed = false;
    if (hit.dropped && holds > 0 && !after.track?.dead) {
      after = { ...after, currentHp: heldAt ?? 1, track: null };
      holds -= 1;
      heldUsed = true;
    }
    if (rider > 0 && corrected.some((swing) => swing.hit)) {
      after = strike(after, rider, (past) => past, false, maxHp).next;
    }
    const next = chain[at + 1] ?? null;
    const gap = carryGaps(after, { kept: left, to: next ? standingOf(next.before) : nowStanding, changes: changesAfter(campaign.id, record, next) }, maxHp);
    state = gap.next;
    steps.push({
      record,
      corrected,
      heldAt,
      rider,
      was: { swings: was.swings, landed: was.swings.reduce((sum, swing) => sum + swing.landed, 0) },
      now: { before, after, swings: hit.swings, dropped: hit.dropped, landed: hit.swings.reduce((sum, swing) => sum + swing.landed, 0), heldUsed },
      gap: { dealt: gap.dealt },
    });
  });
  const final = state;

  // Each hit of the chain is kept as the corrected fight has it: its
  // swings, where it found and left them (a later hit that found them down
  // now finds them standing, with the conditions they had standing), the
  // damage past 0 after it, and the reaction that answered it.
  const keep = () => {
    for (const step of steps) {
      const { record, now } = step;
      const upAgain = !up(standingOf(record.before)) && up(now.before);
      writeLastHit(campaign.id, {
        ...record,
        swings: step.corrected,
        before: {
          ...record.before,
          currentHp: now.before.currentHp,
          tempHp: now.before.tempHp,
          wildShape: now.before.wildShape,
          deathSaves: now.before.track,
          ward: now.before.ward ?? null,
          ...(upAgain ? { conditions: first.before.conditions, conditionMeta: first.before.conditionMeta } : {}),
        },
        after: {
          currentHp: now.after.currentHp,
          tempHp: now.after.tempHp,
          beastHp: now.after.wildShape?.beastHp ?? null,
          track: now.after.track,
          ward: now.after.ward ?? null,
        },
        answered: correctedOf.has(hitIdOf(record)) ? [...record.answered, label] : record.answered,
      });
    }
  };
  if (sameStanding(final, nowStanding) && !steps.some((step) => step.heldAt !== null && !step.now.heldUsed)) {
    keep();
    return { given: 0, hp: `${sheet.currentHp}/${maxHp}`, notes };
  }

  // Where the corrected fight leaves them.
  const patch: FullPatchSheetInput = {
    currentHp: final.currentHp,
    tempHp: final.tempHp,
    ...(final.wildShape || sheet.wildShape ? { wildShape: final.wildShape } : {}),
  };
  const ward = sheet.resources?.[WARD_POOL];
  if (ward && final.ward !== undefined && final.ward !== null && final.ward !== nowStanding.ward) {
    patch.resources = { ...sheet.resources, [WARD_POOL]: { max: ward.max, used: Math.max(0, Math.min(ward.max, ward.max - final.ward)) } };
  }
  let conditions = [...sheet.conditions];
  let meta = { ...sheet.conditionMeta } as Record<string, unknown>;
  const before = first.before;
  const fellThen = !up(nowStanding) || Boolean(sheet.deathSaves?.dead) || steps.some((step) => step.heldAt !== null);
  const fallsNow = !up(final) || steps.some((step) => step.now.dropped);
  if (up(final) && fellThen && !fallsNow) {
    // The blows no longer drop them: the fall, the death track and what the
    // drop ended are undone.
    for (const name of [UNCONSCIOUS, PRONE]) {
      if (has(conditions, name) && !has(before.conditions, name)) {
        const cleared = removeConditions(conditions, meta as CharacterSheet["conditionMeta"], [name]);
        conditions = cleared.conditions;
        meta = cleared.meta as Record<string, unknown>;
      }
    }
    for (const kept of [RAGING, DEATH_WARD]) {
      const was = heldAs(before.conditions, kept);
      if (was && !has(conditions, kept)) {
        conditions = [...conditions, was];
        meta = { ...meta, [was]: (before.conditionMeta as Record<string, unknown>)[was] ?? {} };
        notes.push(kept === RAGING ? `${sheet.name} is still raging.` : `Death Ward was never needed and still holds on ${sheet.name}.`);
      }
    }
    patch.deathSaves = null;
  } else if (up(final)) {
    if (sheet.deathSaves) {
      patch.deathSaves = null;
    }
  } else if (final.track && !sameTrack(final.track, sheet.deathSaves ?? null)) {
    // Still down: the failures and the death the corrected blows no longer
    // dealt are taken off the track, the saves rolled since kept.
    patch.deathSaves = final.track;
    notes.push(
      sheet.deathSaves?.dead && !final.track.dead
        ? `${sheet.name} is dying, not dead: the lighter blows were no longer enough to kill.`
        : failuresNote(sheet.name, sheet.deathSaves ?? null, final.track),
    );
  }
  // A hold the fight as it was spent, and the corrected one never needed.
  const unneeded = steps.filter((step) => step.heldAt !== null).length - steps.filter((step) => step.now.heldUsed).length;
  if (unneeded > 0) {
    const relentless = sheet.resources?.relentless_endurance;
    if (before.relentless && relentless && relentless.used > before.relentless.used) {
      patch.resources = { ...(patch.resources ?? sheet.resources), relentless_endurance: { ...before.relentless } };
      notes.push("Relentless Endurance was never needed and is unspent.");
    }
    const sentinel = sheet.resources?.sub_undying_sentinel;
    if (typeof before.undyingSentinel === "number" && sentinel && sentinel.used > before.undyingSentinel) {
      patch.resources = { ...(patch.resources ?? sheet.resources), sub_undying_sentinel: { ...sentinel, used: before.undyingSentinel } };
      notes.push("Undying Sentinel was never needed and is unspent.");
    }
    const grave = sheet.resources?.sub_strength_of_the_grave;
    if (typeof before.strengthOfTheGrave === "number" && grave && grave.used > before.strengthOfTheGrave) {
      patch.resources = { ...(patch.resources ?? sheet.resources), sub_strength_of_the_grave: { ...grave, used: before.strengthOfTheGrave } };
      notes.push("Strength of the Grave was never needed and is unspent.");
    }
    const revival = sheet.resources?.sub_blazing_revival;
    const revived = typeof before.blazingRevival === "number" && revival && revival.used > before.blazingRevival;
    if (revived) {
      patch.resources = { ...(patch.resources ?? sheet.resources), sub_blazing_revival: { ...revival, used: before.blazingRevival as number } };
      notes.push("Blazing Revival was never needed and is unspent.");
    }
    const rage = sheet.resources?.relentless_rage;
    if (typeof before.relentlessRage === "number" && rage && rage.used > before.relentlessRage) {
      patch.resources = { ...(patch.resources ?? sheet.resources), relentless_rage: { ...rage, used: before.relentlessRage } };
      notes.push("Relentless Rage was never needed: its next save is as easy as before.");
    }
    if (!fallsNow) {
      const warded = heldAs(before.conditions, DEATH_WARD);
      if (warded && !has(conditions, DEATH_WARD)) {
        conditions = [...conditions, warded];
        meta = { ...meta, [warded]: (before.conditionMeta as Record<string, unknown>)[warded] ?? {} };
        notes.push(`Death Ward was never needed and still holds on ${sheet.name}.`);
      }
      // The spirit that gave itself up for a fall that no longer happens.
      const spirit = revived ? heldAs(before.conditions, WILDFIRE_SPIRIT) : null;
      if (spirit && !has(conditions, WILDFIRE_SPIRIT)) {
        conditions = [...conditions, spirit];
        meta = { ...meta, [spirit]: (before.conditionMeta as Record<string, unknown>)[spirit] ?? {} };
        notes.push(`${sheet.name}'s wildfire spirit is back.`);
      }
    }
  }
  patch.conditions = conditions;
  patch.conditionMeta = meta as FullPatchSheetInput["conditionMeta"];
  reactionPatch(campaign, turnId, sheet.id, patch, `${answerLabel(label)}: the blow corrected`);

  bondShareBack(campaign, turnId, steps, label, sheets, sheetsById);
  concentrationBack(campaign, turnId, steps, final, notes, label);
  keep();
  const after = getSheetById(sheet.id) ?? sheet;
  const held = (entry: CharacterSheet) => entry.currentHp + entry.tempHp + (entry.wildShape?.beastHp ?? 0);
  return { given: Math.max(0, held(after) - held(sheet)), hp: `${after.currentHp}/${maxHp}`, notes };
}

function sameTrack(a: DeathTrack | null, b: DeathTrack | null): boolean {
  return (
    (a?.failures ?? 0) === (b?.failures ?? 0) &&
    (a?.successes ?? 0) === (b?.successes ?? 0) &&
    Boolean(a?.dead) === Boolean(b?.dead) &&
    Boolean(a?.stable) === Boolean(b?.stable)
  );
}

// Warding Bond: the cleric who bound them took the same damage each blow
// dealt them (pc-damage.ts wardingBondShare). What the corrected blows no
// longer dealt comes back to the cleric through the heal path.
function bondShareBack(campaign: Campaign, turnId: string, steps: Step[], label: string, sheets: CharacterSheet[], sheetsById: Map<string, CharacterSheet>) {
  const back = new Map<string, number>();
  for (const step of steps) {
    const bond = heldAs(step.record.before.conditions, WARDING_BOND);
    const casterId = bond ? (step.record.before.conditionMeta as ConditionMetaMap)[bond]?.source : undefined;
    if (!casterId || casterId === step.record.characterId) {
      continue;
    }
    const less = step.was.landed - step.now.landed;
    if (less > 0) {
      back.set(casterId, (back.get(casterId) ?? 0) + less);
    }
  }
  for (const [casterId, amount] of back) {
    const caster = getSheetById(casterId);
    if (caster && !caster.deathSaves?.dead) {
      applyDmMutation(campaign, turnId, "heal", JSON.stringify({ characterId: casterId, amount, reason: `${answerLabel(label)}: the Warding Bond's share of a blow undone` }), sheets, sheetsById);
    }
  }
}

// Concentration the fight broke: given back when the blow that broke it is
// one a reaction corrected and the corrected fight would not have broken it.
// SRD 5.1: each source of damage asks its own save, DC 10 or half the damage
// it dealt. The save that blow rolled is read against its corrected damage;
// a drop to 0 that is undone, and every later source that now finds them
// still concentrating (a later blow, the damage in a gap), ask theirs now.
// A break nothing in this fight made (damage between the hits, the GM)
// stands.
function concentrationBack(campaign: Campaign, turnId: string, steps: Step[], final: Standing<Shape>, notes: string[], label: string) {
  const first = steps[0]?.record;
  const spell = first?.before.concentratingOn;
  const sheet = first ? getSheetById(first.characterId) : null;
  if (!spell || !sheet || sheet.concentratingOn || !up(final)) {
    return;
  }
  const at = steps.findIndex((step) => step.record.swings.some((swing) => swing.concentration?.broke));
  if (at < 0) {
    return;
  }
  const breaking = steps[at];
  const index = breaking.record.swings.findIndex((swing) => swing.concentration?.broke);
  const outcome = breaking.now.swings[index];
  const asked: number[] = [];
  if (outcome.dropped) {
    return;
  }
  if (outcome.landed > 0) {
    const rolled = breaking.record.swings[index].concentration?.save ?? null;
    if (rolled !== null) {
      if (rolled < Math.max(10, Math.floor(outcome.landed / 2))) {
        return;
      }
    } else {
      asked.push(outcome.landed);
    }
  }
  // Every source after it in the corrected fight.
  for (let step = at; step < steps.length; step += 1) {
    const { now, gap } = steps[step];
    if (step > at && now.dropped) {
      return;
    }
    now.swings.forEach((swing, swingAt) => {
      if ((step > at || swingAt > index) && swing.landed > 0 && swing.standing) {
        asked.push(swing.landed);
      }
    });
    asked.push(...gap.dealt);
  }
  const restored = restoreConcentration(campaign, turnId, first, label);
  if (!restored) {
    return;
  }
  notes.push(`${sheet.name} keeps concentrating on ${restored}.`);
  for (const damage of asked) {
    const fresh = getSheetById(sheet.id);
    if (!fresh?.concentratingOn) {
      break;
    }
    const save = concentrationDamageHook(campaign, turnId, fresh, damage);
    if (save.concentrationBroken || (save.concentration as { held?: boolean } | undefined)?.held === false) {
      notes.push(`A blow that now lands on ${sheet.name} still asks a concentration save, and ${restored} ends.`);
      break;
    }
  }
}

// The line a refund adds when it takes death-save failures back.
function failuresNote(name: string, was: DeathTrack | null, now: DeathTrack): string {
  const back = Math.max(0, (was?.failures ?? 0) - now.failures);
  return back
    ? `${back} death-save failure${back === 1 ? "" : "s"} the blow dealt ${name} ${back === 1 ? "is" : "are"} taken back: ${now.failures} of 3.`
    : `${name}'s death track is ${now.failures} failure${now.failures === 1 ? "" : "s"} of 3.`;
}
