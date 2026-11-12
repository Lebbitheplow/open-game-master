// Command Undead's hourly save (School of Necromancy 14): "An undead with an
// Intelligence of 12 or higher that failed repeats the save at the end of
// every hour, breaking free on a success."
//
// Before this module the row said the GM rolls it "when an hour passes", and
// nothing rolled: a commanded wight stayed the wizard's for good. The server
// now rolls it as the campaign clock moves. Called by src/lib/db/clock.ts
// advanceClock, the one door every passing of time goes through (pass_time,
// travel, a rest, a long casting), in a fight and out of one.
//
// How the hours are kept: the commanding charm's own record
// (ConditionMeta.hourFrom) holds the clock instant its running hour began at,
// written the first time the clock moves after the command. Every full hour
// since is one save, in order, until one succeeds; the creature then goes
// back to its own side (command-undead.ts releaseCommanded), and the hours
// after that roll nothing.
//
// Rulings:
//   - "repeats the save" is the same save: Charisma against the wizard's
//     spell save DC as it stands now, with the advantage an Intelligence of 8
//     or higher gave the first one.
//   - Rounds of a fight are not counted toward the hour (six hundred of them
//     make one); the clock is what the table moves when an hour passes.
//   - A stretch longer than MAX_HOURS rolls that many saves and no more: a
//     save the creature cannot make on a 20 would otherwise be rolled for
//     every hour of a year.
//
// The rule is read from the row (save_effect hourlySaveAt), so another
// feature that commands with an hourly save needs the field and nothing here.

import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { CHARMED, releaseCommanded } from "@/lib/dm/command-undead";
import { instancesOf, packInstances, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { tableNoteSeq } from "@/lib/dm/narration-slot";
import { sheetFoeView } from "@/lib/dm/sheet-foe";
import { publishWithSeq } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";
import { heldAuthored } from "@/lib/srd/authored-effects";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import { isConditionNamed } from "@/lib/srd/feature-names";

const MAX_HOURS = 240;
const HOUR = 60;

type HourlyRule = Extract<SpendDoes, { kind: "save_effect" }> & { hourlySaveAt: NonNullable<Extract<SpendDoes, { kind: "save_effect" }>["hourlySaveAt"]> };

// The commanding spend of this name on the holder's sheet, when its row
// carries an hourly save.
function hourlyRule(holder: CharacterSheet, feature: string): HourlyRule | null {
  for (const held of heldAuthored(holder)) {
    for (const spend of held.entry.spends ?? []) {
      if (textKey(spend.name) === textKey(feature) && spend.does.kind === "save_effect" && spend.does.commands && spend.does.hourlySaveAt) {
        return spend.does as HourlyRule;
      }
    }
  }
  return null;
}

// "Your spell save DC", as the spend that laid the charm reads it
// (authored-spend-effects.ts saveDc).
function ruleDc(holder: CharacterSheet, rule: HourlyRule): number {
  const derived = computeSheetDerived(holder);
  if (rule.dcAbility === "spell") {
    return derived.spellSaveDc ?? 8 + derived.proficiencyBonus + Math.max(derived.abilityMods.int, derived.abilityMods.wis, derived.abilityMods.cha);
  }
  return 8 + derived.proficiencyBonus + derived.abilityMods[rule.dcAbility];
}

type Commanded = {
  // The creature as the save reads it; a sheet's foe view is made only once
  // its charm is known to be a commanding one.
  view: () => EncounterEnemy;
  conditions: string[];
  meta: ConditionMetaMap;
  write: (meta: ConditionMetaMap) => void;
};

// Every creature that could carry a commanding charm: the fight's standing
// creatures, and the campaign's sheets (one fighting the party is commanded
// as a creature is, sheet-foe.ts).
function charmedCreatures(campaign: Campaign): Commanded[] {
  const encounter = getActiveEncounter(campaign.id);
  const charmed = (conditions: string[]) => conditions.some((entry) => isConditionNamed(entry, CHARMED));
  const enemies = (encounter ? listEnemies(encounter.id) : [])
    .filter((enemy) => enemy.status === "alive" && charmed(enemy.conditions))
    .map((enemy): Commanded => ({
      view: () => enemy,
      conditions: enemy.conditions,
      meta: (enemy.conditionMeta ?? {}) as ConditionMetaMap,
      write: (meta) => patchEnemyConditions(enemy.id, enemy.conditions, meta as EncounterEnemy["conditionMeta"]),
    }));
  const sheets = listSheets(campaign.id)
    .filter((sheet) => charmed(sheet.conditions))
    .map((sheet): Commanded => ({
      view: () => sheetFoeView(encounter?.id ?? "", sheet),
      conditions: sheet.conditions,
      meta: (sheet.conditionMeta ?? {}) as ConditionMetaMap,
      write: (meta) => {
        patchSheet(sheet.id, { conditionMeta: meta });
      },
    }));
  return [...enemies, ...sheets];
}

// The clock moved from `from` to `to` (in-world minutes): each commanded
// creature the rule covers repeats its save for every hour that ended in the
// stretch. Returns what the saves decided, for the tool that moved the clock;
// the table is told the outcome without the numbers.
export function commandedHourlySaves(campaignId: string, from: number, to: number): string[] {
  const campaign = getCampaignById(campaignId);
  if (!campaign || to <= from) {
    return [];
  }
  const told: string[] = [];
  const table: string[] = [];
  for (const creature of charmedCreatures(campaign)) {
    const key = creature.conditions.find((entry) => isConditionNamed(entry, CHARMED));
    const list = key ? instancesOf(creature.meta[key]) : [];
    const at = list.findIndex((entry) => Boolean(entry.source && entry.spell && hourlyRule(getSheetById(entry.source) ?? ({} as CharacterSheet), entry.spell)));
    const instance: ConditionMeta | undefined = list[at];
    const holder = instance?.source ? getSheetById(instance.source) : null;
    const rule = holder && instance?.spell ? hourlyRule(holder, instance.spell) : null;
    if (!key || !instance || !holder || !rule) {
      continue;
    }
    const view = creature.view();
    const scoreOf = (ability: string) => Number((view.stats.abilities as Record<string, number> | undefined)?.[ability] ?? 10);
    if (scoreOf(rule.hourlySaveAt.ability) < rule.hourlySaveAt.atLeast) {
      continue;
    }
    const began = instance.hourFrom ?? from;
    const ended = Math.floor((to - began) / HOUR);
    const keep = (hourFrom: number) => creature.write({ ...creature.meta, [key]: packInstances(list.map((entry, index) => (index === at ? { ...entry, hourFrom } : entry))) as ConditionMeta });
    if (ended < 1) {
      if (instance.hourFrom === undefined) {
        keep(began);
      }
      continue;
    }
    const dc = ruleDc(holder, rule);
    const keen = rule.advantageAt ? scoreOf(rule.advantageAt.ability) >= rule.advantageAt.atLeast : false;
    const ability = rule.save.toUpperCase();
    const name = view.displayName;
    const feature = instance.spell ?? "the command";
    let freedAt = 0;
    let last: number | null = null;
    for (let hour = 1; hour <= Math.min(ended, MAX_HOURS) && !freedAt; hour += 1) {
      const save = rollEnemySave(campaign.id, view, rule.save, dc, { ...(keen ? { advantage: true } : {}), against: CHARMED });
      last = save.total ?? null;
      freedAt = save.success ? hour : 0;
    }
    const rolled = freedAt || Math.min(ended, MAX_HOURS);
    if (freedAt) {
      releaseCommanded(campaign, holder.id, feature);
      told.push(`${name} repeats its ${ability} save against ${feature} at the end of ${ended === 1 ? "the hour" : `hour ${freedAt} of ${ended}`} (${last ?? "made"} vs DC ${dc}) and breaks free: it no longer obeys ${holder.name}.`);
      table.push(`${name} breaks free of ${holder.name}'s ${feature} as ${ended === 1 ? "the hour" : `hour ${freedAt}`} ends.`);
    } else {
      keep(began + ended * HOUR);
      told.push(`${name} repeats its ${ability} save against ${feature} at the end of ${rolled === 1 ? `the hour (${last ?? "failed"} vs DC ${dc})` : `each of ${rolled} hours (DC ${dc})`} and fails: it still obeys ${holder.name}.`);
    }
  }
  if (table.length) {
    const seq = tableNoteSeq(campaign.id);
    const message = insertCampaignMessage({ campaignId: campaign.id, seq, authorType: "system", glyph: "cue-bell", content: table.join(" ") });
    publishWithSeq(campaign.id, seq, "message_added", { message });
  }
  return told;
}
