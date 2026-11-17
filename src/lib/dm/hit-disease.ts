import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getClock } from "@/lib/db/clock";
import { getSheetById } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { afflictCondition, dropConditions, inForce, liveAfflictions } from "@/lib/dm/afflictions";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { characterSave, publicDie, tableNote, writeAfflictions } from "@/lib/dm/between-io";
import type { Affliction } from "@/lib/dm/between-state";
import { effectiveMaxHp, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";

// A disease a monster's hit gives, with a save every 24 hours (SRD 5.1,
// Otyugh, Bite: "become poisoned until the disease is cured. Every 24 hours
// that elapse, the target must repeat the saving throw, reducing its hit
// point maximum by 5 (1d10) on a failure. The disease is cured on a success.
// The target dies if the disease reduces its hit point maximum to 0. This
// reduction to the target's hit point maximum lasts until the disease is
// cured."). Read from the block by src/lib/bestiary/affliction-text.ts.
//
// Kept as the other diseases are (afflictions.ts): a record on the clock and
// conditions on the sheet, the disease's own ("diseased (otyugh)", which a
// creature immune to disease refuses) and its poisoning, both laid under the
// disease's name so a cure takes only them. What the failed saves took off
// the maximum rides on the disease's condition (rotDrain, which
// condition-logic.ts maxHpRiders counts), so the cure gives it back whole.

const MINUTES_PER_DAY = 1440;
const ABILITY_WORD: Record<string, string> = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };

// The disease's condition, named for the creature that gave it.
export function hitDiseaseCondition(creature: string): string {
  return `diseased (${textKey(creature.replace(/\s+\d+$/, "")).slice(0, 26) || "bite"})`;
}

const isHitDisease = (entry: Affliction) => entry.kind === "disease" && entry.dice !== undefined;

// Lays the disease on a character whose save against the hit failed. Returns
// what happened, for the hit's result.
export function infectHitDisease(
  campaign: Campaign,
  turnId: string,
  target: CharacterSheet,
  input: { creature: string; ability: NonNullable<Affliction["saveAbility"]>; dc: number; dice: string },
): { line: string; conditions: string[] } {
  const name = hitDiseaseCondition(input.creature);
  const id = `hit:${textKey(name)}`.slice(0, 60);
  const list = liveAfflictions(campaign.id, target);
  if (list.some((entry) => entry.kind === "disease" && entry.id === id)) {
    return { line: `${target.name} already carries this disease; its daily save goes on.`, conditions: [] };
  }
  // The disease's own condition first: one immune to disease (Divine Health,
  // a petrified body) takes neither it nor its poisoning.
  if (!afflictCondition(campaign, turnId, target.id, name, { source: name })) {
    return { line: `${target.name} is immune to disease: the bite's disease takes no hold.`, conditions: [] };
  }
  const held = [name, ...(afflictCondition(campaign, turnId, target.id, "poisoned", { source: name }) ? ["poisoned"] : [])];
  writeAfflictions(campaign.id, target.id, [
    ...list,
    { kind: "disease", id, conditions: held, nextAt: getClock(campaign.id).instant + MINUTES_PER_DAY, dc: input.dc, saveAbility: input.ability, dice: input.dice },
  ]);
  return {
    line: `${target.name} is diseased: poisoned until it is cured, a DC ${input.dc} ${ABILITY_WORD[input.ability]} save every 24 hours on the game clock (the server rolls it), ${input.dice} off the hit point maximum on each failure, cured on a success.`,
    conditions: held,
  };
}

// One failed daily save: the dice off the maximum, on the disease's
// condition, and death at a maximum of 0. Returns the line for the table.
function eatMaximum(campaign: Campaign, sheet: CharacterSheet, condition: string, dice: string): { line: string; dead: boolean } {
  const meta = { ...(sheet.conditionMeta as ConditionMetaMap) };
  const key = Object.keys(meta).find((name) => isConditionNamed(name, condition)) ?? condition;
  const max = effectiveMaxHp(sheet);
  // No more than there is to take, so the cure gives back what it took.
  const lost = Math.min(max, publicDie(campaign, sheet, dice, `${sheet.name}: the disease eats the hit point maximum`));
  meta[key] = { ...meta[key], rotDrain: (meta[key]?.rotDrain ?? 0) + lost };
  const left = max - lost;
  const updated = patchSheetAudited(campaign.id, sheet.id, {
    conditionMeta: meta,
    ...(left <= 0
      ? { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } }
      : sheet.currentHp > left ? { currentHp: left } : {}),
  }, { kind: "condition_clock", reason: "the disease's daily save failed", delta: { rotDrain: lost } });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return left <= 0
    ? { line: `The disease takes the last of ${sheet.name}'s hit point maximum: they die.`, dead: true }
    : { line: `${sheet.name} fails the daily save against the disease: ${lost} off their hit point maximum (now ${left}).`, dead: false };
}

// The saves every 24 hours the clock moved past, each on its own day, as the
// clock moves (src/lib/db/clock.ts advanceClock): a success cures it, a
// failure eats the maximum.
export function hitDiseaseClockTick(campaignId: string, to: number) {
  const all = getClock(campaignId).afflictions ?? {};
  if (!Object.values(all).some((list) => list.some(isHitDisease))) {
    return;
  }
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return;
  }
  for (const [characterId, list] of Object.entries(all)) {
    if (!list.some(isHitDisease)) {
      continue;
    }
    const next: Affliction[] = [];
    let changed = false;
    for (const entry of list) {
      // Cured some other way (Lesser Restoration or the GM ending the
      // disease's own condition): its poisoning goes with it, and its days.
      // Read as held only by the poisoning, the cured disease kept rolling.
      const holder = isHitDisease(entry) ? getSheetById(characterId) : null;
      if (holder && entry.conditions[0] && !holder.conditions.some((name) => isConditionNamed(name, entry.conditions[0]))) {
        dropConditions(campaignId, holder.id, entry.conditions.slice(1), entry.conditions[0]);
        changed = true;
        continue;
      }
      if (!isHitDisease(entry) || entry.nextAt === undefined || entry.nextAt > to) {
        next.push(entry);
        continue;
      }
      changed = true;
      let current: Affliction | null = entry;
      while (current?.nextAt !== undefined && current.nextAt <= to) {
        const sheet = getSheetById(characterId);
        // Cured some other way (Lesser Restoration), or no one left to save.
        if (!sheet || sheet.deathSaves?.dead || !inForce(current, sheet)) {
          current = null;
          break;
        }
        const ability = current.saveAbility ?? "con";
        const save = characterSave(campaign, sheet, { ability, dc: current.dc ?? 10, detail: `${sheet.name}: daily ${ABILITY_WORD[ability]} save against the disease`, against: "disease" });
        if (save.success) {
          dropConditions(campaignId, sheet.id, current.conditions, current.conditions[0]);
          tableNote(campaign, `${sheet.name} makes the daily save and is cured of the disease; their hit point maximum is whole again.`, "cue-heal");
          current = null;
          break;
        }
        const eaten = eatMaximum(campaign, sheet, current.conditions[0] ?? "", current.dice ?? "1d10");
        tableNote(campaign, eaten.line, "cue-bell");
        current = eaten.dead ? null : { ...current, nextAt: current.nextAt + MINUTES_PER_DAY };
      }
      if (current) {
        next.push(current);
      }
    }
    if (changed) {
      writeAfflictions(campaignId, characterId, next);
    }
  }
}
