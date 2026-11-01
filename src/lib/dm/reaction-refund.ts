// Turning a re-resolved attack back into state. A reaction (Shield, Uncanny
// Dodge, Deflect Missiles, Cutting Words, Protection, Slow Fall, Feather
// Fall) corrects the swings of an attack against a character that the engine
// kept open (src/lib/dm/last-hit.ts); this module works out what the
// character should have taken and puts them there.
//
// The corrected damage is replayed on the character as they stood before
// the attack, with every open hit on them after it (hit-replay-logic.ts):
// temporary hit points first, a beast form's pool before the druid's own,
// resistance as the damage path applies it, and on a character at 0 a
// death-save failure per blow (two on a critical hit). When nothing else
// has touched them since the attack, their hit points become exactly the
// replayed ones, and what the undone part of the blow set off is undone too:
// the drop to 0 (unconscious, prone, the death track, a death by massive
// damage), the rage it ended, the Relentless Endurance it spent, and the
// concentration it broke with the effects that spell held. When something
// has, the difference is healed through the heal path instead.
//
// This module must not import mutations.ts' callers back; it calls the heal
// mutation the same way cast-tools does.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, patchEnemyConditions } from "@/lib/db/encounters";
import { listRecentRolls } from "@/lib/db/rolls";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { RAGING } from "@/lib/srd/class-resources";
import { concentrationDamageHook } from "@/lib/dm/concentration";
import { effectiveMaxHp, pcImmunities, pcResistances, removeConditions } from "@/lib/dm/condition-logic";
import { damageAdjust } from "@/lib/dm/damage-logic";
import type { DeathTrack } from "@/lib/dm/death-logic";
import { pool, replayHits, sameStanding, trackAfter, type Standing } from "@/lib/dm/hit-replay-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { hitIdOf, openHits, writeLastHit, type LastHit, type SwingRecord } from "@/lib/dm/last-hit";
import { applyDmMutation } from "@/lib/dm/mutations";
import { PRONE } from "@/lib/dm/vitals-logic";

const UNCONSCIOUS = "unconscious";
const LETHARGY = "incapacitated";

function has(list: string[], name: string): boolean {
  return list.some((entry) => entry.toLowerCase() === name);
}

// Damage that reached the character from these swings, after resistance
// and immunity, a blow of several types part by part as it landed.
export function landedBy(record: LastHit, swings: SwingRecord[]): number {
  const sheet = getSheetById(record.characterId);
  const held = sheet ? { ...sheet, conditions: record.before.conditions } : null;
  const resist = held ? pcResistances(held) : "";
  const immune = held ? pcImmunities(held) : "";
  const meet = (amount: number, type: string | undefined) => damageAdjust(amount, type, resist, immune, "").amount;
  return swings
    .filter((swing) => swing.hit)
    .reduce((sum, swing) => sum + (swing.parts?.length
      ? swing.parts.reduce((total, part) => total + meet(part.amount, part.type), 0)
      : meet(swing.raw, swing.type ?? record.type)), 0);
}

// The concentration save this attack forced, if one was rolled.
function concentrationSaveTotal(campaignId: string, record: LastHit): number | null {
  const spell = record.before.concentratingOn;
  if (!spell) {
    return null;
  }
  const save = listRecentRolls(campaignId, 40)
    .filter(
      (roll) =>
        roll.characterId === record.characterId &&
        roll.kind === "saving_throw" &&
        roll.detail.startsWith("CON save to keep concentration") &&
        roll.createdAt >= record.startedAt,
    )
    .at(-1);
  return save ? save.total : null;
}

// Puts back the concentration the attack broke, with the conditions the
// spell held on every creature and without the lethargy Haste's end laid.
function restoreConcentration(campaign: Campaign, record: LastHit): string | null {
  const spell = record.before.concentratingOn;
  const held = record.before.held;
  if (!spell) {
    return null;
  }
  const patched = patchSheet(record.characterId, { concentratingOn: spell });
  if (patched) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: patched });
  }
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
      const updated = patchSheet(holder.id, {
        conditions: [...base.conditions, ...missing],
        conditionMeta: meta as FullPatchSheetInput["conditionMeta"],
      });
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
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

function standingOf(before: LastHit["before"]): Standing<NonNullable<CharacterSheet["wildShape"]>> {
  return { currentHp: before.currentHp, tempHp: before.tempHp, wildShape: before.wildShape ?? null, track: before.deathSaves ?? null };
}

// One or more hits on one character answered at once (Shield answers the
// hit it is cast against and re-checks every open hit after it). Every open
// hit from the earliest answered on is replayed as it landed and corrected
// (hit-replay-logic.ts), so a later blow that now misses takes back all it
// did, a death-save failure on a character at 0 included, and an earlier
// blow undone turns the later ones back into hit point damage. When nothing
// else has touched the character since the last of them, they are put
// exactly where the corrected blows leave them, with what a drop that no
// longer happens set off undone: the fall (unconscious, prone, the death
// track, a death by massive damage), the rage it ended, the Relentless
// Endurance it spent, and the concentration it broke with the effects that
// spell held. When something has, the hit points are healed through the heal
// path and the failures taken off the track as it stands.
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
  const last = chain[chain.length - 1];
  const start = standingOf(first.before);
  const replay = (pick: (record: LastHit) => SwingRecord[]) =>
    replayHits(
      start,
      chain.map((record) => pick(record).map((swing) => ({ hit: swing.hit, crit: swing.crit, landed: swing.hit ? landedBy(record, [swing]) : 0 }))),
      maxHp,
    );
  const was = replay((record) => record.swings);
  const now = replay(swingsOf);
  const newLanded = chain.reduce((sum, record) => sum + landedBy(record, swingsOf(record)), 0);

  // Each hit of the chain is kept as the corrected blows leave it: its swings,
  // where the character stood before it (a later hit that found them down
  // now finds them standing), and the reaction that answered it.
  const keep = () => {
    const fresh = getSheetById(sheet.id) ?? sheet;
    chain.forEach((record, at) => {
      const step = now.steps[at];
      const upAgain = was.steps[at].before.currentHp <= 0 && step.before.currentHp > 0;
      const before =
        at === 0
          ? record.before
          : {
              ...record.before,
              currentHp: step.before.currentHp,
              tempHp: step.before.tempHp,
              wildShape: step.before.wildShape,
              deathSaves: step.before.track,
              ...(upAgain ? { conditions: first.before.conditions, conditionMeta: first.before.conditionMeta } : {}),
            };
      const after =
        record === last
          ? { currentHp: fresh.currentHp, tempHp: fresh.tempHp, beastHp: fresh.wildShape?.beastHp ?? null }
          : { currentHp: step.after.currentHp, tempHp: step.after.tempHp, beastHp: step.after.wildShape?.beastHp ?? null };
      writeLastHit(campaign.id, {
        ...record,
        swings: swingsOf(record),
        before,
        after,
        answered: correctedOf.has(hitIdOf(record)) ? [...record.answered, label] : record.answered,
      });
    });
  };
  if (sameStanding(was.final, now.final)) {
    keep();
    return { given: 0, hp: `${sheet.currentHp}/${maxHp}`, notes };
  }
  const given = Math.max(0, pool(now.final) - pool(was.final));
  const untouched =
    sheet.currentHp === last.after.currentHp &&
    sheet.tempHp === last.after.tempHp &&
    (sheet.wildShape?.beastHp ?? null) === last.after.beastHp;
  if (!untouched) {
    // Something moved their hit points since the attack; give back the
    // difference through the heal path, which wakes a dying character, and
    // take the failures the corrected blows no longer dealt off the track.
    if (given > 0) {
      applyDmMutation(campaign, turnId, "heal", JSON.stringify({ characterId: sheet.id, amount: given, reason: label }), sheets, sheetsById);
    }
    const healed = getSheetById(sheet.id) ?? sheet;
    if (healed.currentHp <= 0) {
      const track = trackAfter(healed.deathSaves ?? null, was.final.track, now.final.track);
      if (track && (track.failures !== healed.deathSaves?.failures || track.dead !== healed.deathSaves?.dead)) {
        const patched = patchSheet(sheet.id, { deathSaves: track });
        if (patched) {
          publishPersisted(campaign.id, "sheet_updated", { sheet: patched });
        }
        notes.push(failuresNote(sheet.name, healed.deathSaves ?? null, track));
      }
    }
    keep();
    const after = getSheetById(sheet.id) ?? sheet;
    return { given, hp: `${after.currentHp}/${maxHp}`, notes };
  }

  const before = first.before;
  const next = now.final;
  const patch: FullPatchSheetInput = {
    currentHp: next.currentHp,
    tempHp: next.tempHp,
    ...(before.wildShape ? { wildShape: next.wildShape } : {}),
  };
  const droppedByIt = before.currentHp > 0 && sheet.currentHp === 0;
  const relentlessSpent =
    before.relentless !== null &&
    (sheet.resources?.relentless_endurance?.used ?? 0) > before.relentless.used;
  let conditions = [...sheet.conditions];
  let meta = { ...sheet.conditionMeta } as Record<string, unknown>;
  if (next.currentHp > 0 && (droppedByIt || relentlessSpent || sheet.deathSaves?.dead)) {
    // The blows no longer drop them: the fall, the death track and what the
    // drop ended are undone.
    for (const name of [UNCONSCIOUS, PRONE]) {
      if (has(conditions, name) && !has(before.conditions, name)) {
        const cleared = removeConditions(conditions, meta as CharacterSheet["conditionMeta"], [name]);
        conditions = cleared.conditions;
        meta = cleared.meta as Record<string, unknown>;
      }
    }
    const rage = before.conditions.find((name) => name.toLowerCase() === RAGING);
    if (rage && !has(conditions, RAGING)) {
      conditions = [...conditions, rage];
      meta = { ...meta, [rage]: (before.conditionMeta as Record<string, unknown>)[rage] ?? {} };
      notes.push(`${sheet.name} is still raging.`);
    }
    patch.deathSaves = before.deathSaves ?? null;
    if (relentlessSpent && before.relentless) {
      patch.resources = { ...sheet.resources, relentless_endurance: { ...before.relentless } };
      notes.push("Relentless Endurance was never needed and is unspent.");
    }
  } else if (next.currentHp === 0 && relentlessSpent) {
    // Still a drop: Relentless Endurance still holds them at 1.
    patch.currentHp = 1;
  } else if (next.currentHp === 0) {
    // Still down: the failures and the death the corrected blows no longer
    // dealt are taken off the track, the saves rolled since kept.
    const track = trackAfter(sheet.deathSaves ?? null, was.final.track, next.track);
    if (track && (track.failures !== sheet.deathSaves?.failures || track.dead !== Boolean(sheet.deathSaves?.dead) || track.stable !== Boolean(sheet.deathSaves?.stable))) {
      patch.deathSaves = track;
      notes.push(
        sheet.deathSaves?.dead && !track.dead
          ? `${sheet.name} is dying, not dead: the lighter blows were no longer enough to kill.`
          : failuresNote(sheet.name, sheet.deathSaves ?? null, track),
      );
    }
  }
  patch.conditions = conditions;
  patch.conditionMeta = meta as FullPatchSheetInput["conditionMeta"];
  const updated = patchSheet(sheet.id, patch);
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }

  // Concentration the attack broke: undone when the corrected blow would
  // not have broken it. A miss asks no save; a lighter hit asks it against
  // the lower DC, which the save already rolled is read against; a drop to
  // 0 that is undone asks the save now.
  if (before.concentratingOn && !getSheetById(sheet.id)?.concentratingOn) {
    const dc = Math.max(10, Math.floor(newLanded / 2));
    const rolled = concentrationSaveTotal(campaign.id, first);
    const wasDropped = droppedByIt && rolled === null;
    const heldNow = newLanded === 0 || (rolled !== null && rolled >= dc) || (wasDropped && next.currentHp > 0);
    if (heldNow && next.currentHp > 0) {
      const spell = restoreConcentration(campaign, first);
      if (spell) {
        notes.push(`${sheet.name} keeps concentrating on ${spell}.`);
        if (wasDropped && newLanded > 0) {
          const fresh = getSheetById(sheet.id);
          if (fresh) {
            const save = concentrationDamageHook(campaign, turnId, fresh, newLanded);
            if (save.concentrationBroken || (save.concentration as { held?: boolean } | undefined)?.held === false) {
              notes.push(`The lighter blow still asked a concentration save, and ${spell} ended.`);
            }
          }
        }
      }
    }
  }
  keep();
  const after = getSheetById(sheet.id) ?? sheet;
  const held = (entry: CharacterSheet) => entry.currentHp + entry.tempHp + (entry.wildShape?.beastHp ?? 0);
  return { given: Math.max(0, held(after) - held(sheet)), hp: `${after.currentHp}/${maxHp}`, notes };
}

// The line a refund adds when it takes death-save failures back.
function failuresNote(name: string, was: DeathTrack | null, now: DeathTrack): string {
  const back = Math.max(0, (was?.failures ?? 0) - now.failures);
  return back
    ? `${back} death-save failure${back === 1 ? "" : "s"} the blow dealt ${name} ${back === 1 ? "is" : "are"} taken back: ${now.failures} of 3.`
    : `${name}'s death track is ${now.failures} failure${now.failures === 1 ? "" : "s"} of 3.`;
}
