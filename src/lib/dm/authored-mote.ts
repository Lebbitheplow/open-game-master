// Mote of Potential (College of Creation 3): the Bardic Inspiration die a
// Creation bard gives carries a mote (the condition's meta `mote`, written by
// use_resource in resource-tools.ts), and the roll that spends the die sets
// it off:
//
//   - an ability check rolls the die twice and keeps the higher
//     (src/lib/dm/rolls.ts folds "2dXkh1" into the expression);
//   - a saving throw gives the one who rolled temporary hit points equal to
//     the die's roll plus the bard's Charisma modifier (moteAfterRoll, from
//     request_roll and every forced save);
//   - an attack roll's mote bursts on the target and every foe within 5 feet
//     of it: a Constitution save against the bard's spell save DC, or thunder
//     damage equal to what the die showed on the attack (moteBurst, from
//     pc_attack).
//
// The published subclass words the check and the save this way; the
// authored line ("extra damage on an attack, temporary hit points on a
// check, or an ally bonus on a save") is read through it.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import { getActiveEncounter, getEnemy, listEnemies, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import type { RollResult } from "@/lib/dice";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { withinFeet } from "@/lib/dm/authored-saves";
import { rollEnemySave } from "@/lib/dm/forced-save";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { rollAgainst } from "@/lib/roll-labels";

// `rolled`: what the die showed on the attack roll that spent it (withMoteRoll).
export type HeldMote = { bardId: string; die: string; sides: number; rolled?: number };

// The mote riding one of the conditions a roll spends ("a|b|c", as
// resolveRollExpression and the attack's riders list them), or null. Read
// before the spend clears the condition.
export function moteOf(sheet: Pick<CharacterSheet, "conditionMeta">, spent: string | string[] | undefined): HeldMote | null {
  const names = Array.isArray(spent) ? spent : (spent ?? "").split("|");
  const meta = sheet.conditionMeta as ConditionMetaMap & Record<string, { mote?: boolean; source?: string } | undefined>;
  for (const name of names) {
    const match = /^bardic inspiration \((d(\d{1,2}))\)$/i.exec(name.trim());
    const entry = meta[name];
    if (match && entry?.mote && entry.source) {
      return { bardId: entry.source, die: match[1].toLowerCase(), sides: Number(match[2]) };
    }
  }
  return null;
}

// The value the die showed in a roll: its term's subtotal, or a fresh roll
// when the expression did not keep it apart.
function dieValue(campaign: Campaign, sheetId: string, outcome: RollResult | null, mote: HeldMote): number {
  const term = outcome?.terms.find((entry) => entry.kind === "dice" && entry.sides === mote.sides);
  return term && term.kind === "dice" ? term.subtotal : rollCard(campaign, null, sheetId, "custom", "Mote of Potential", `1${mote.die}`, null).total;
}

// After a saving throw that spent a mote die: its temporary hit points.
export function moteAfterRoll(
  campaign: Campaign,
  stale: CharacterSheet,
  mote: HeldMote | null,
  kind: string,
  outcome: RollResult,
): string | null {
  if (!mote || kind !== "saving_throw") {
    return null;
  }
  const bard = getSheetById(mote.bardId);
  const sheet = getSheetById(stale.id) ?? stale;
  const cha = bard ? computeSheetDerived(bard).abilityMods.cha : 0;
  const amount = Math.max(1, dieValue(campaign, sheet.id, outcome, mote) + cha);
  if (amount > sheet.tempHp) {
    const updated = patchSheet(sheet.id, { tempHp: amount });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  return `Mote of Potential: ${sheet.name} gains ${amount} temporary hit points.`;
}

// The mote with the number its die showed on the attack roll that spent it
// (attack-swing.ts judgeSwing, the one place every attack roll is read): the
// burst deals "thunder damage equal to the die's roll".
export function withMoteRoll(mote: HeldMote, toHit: RollResult): HeldMote {
  const term = toHit.terms.find((entry) => entry.kind === "dice" && entry.sides === mote.sides && mote.sides !== 20);
  return term && term.kind === "dice" ? { ...mote, rolled: term.subtotal } : mote;
}

// After an attack roll that spent a mote die: "the mote bursts and each
// creature of your choice within 5 feet of the target makes a Constitution
// save against your spell save DC or takes thunder damage equal to the die's
// roll". The bard's choice is read as every foe there, the target with them,
// and no friend: the burst is the bard's weapon, and a table that wants a foe
// spared says so to the GM. Off the board nothing can be measured, so the
// target alone is caught.
export function moteBurst(campaign: Campaign, turn: DmTurn, mote: HeldMote | null, target: EncounterEnemy): string | null {
  const encounter = getActiveEncounter(campaign.id);
  const bard = mote ? getSheetById(mote.bardId) : null;
  if (!mote || !encounter) {
    return null;
  }
  const mapped = Boolean(getBattleMapForEncounter(encounter.id));
  const caught = listEnemies(encounter.id).filter(
    (enemy) => enemy.status === "alive" && (enemy.id === target.id || (mapped && withinFeet(encounter.id, target.id, enemy.id, 5))),
  );
  if (!caught.length) {
    return null;
  }
  const derived = bard ? computeSheetDerived(bard) : null;
  const dc = derived?.spellSaveDc ?? 8 + (derived?.proficiencyBonus ?? 2) + (derived?.abilityMods.cha ?? 0);
  // One number for every creature: the die's roll on the attack, or a roll of
  // the die when the attack's dice did not keep it apart.
  let amount = mote.rolled ?? null;
  const sheets = listSheets(campaign.id);
  const sheetsById = new Map(sheets.map((entry) => [entry.id, entry]));
  const lines: string[] = [];
  for (const enemy of caught) {
    const save = rollEnemySave(campaign.id, enemy, "con", dc, {
      magical: true,
      record: { turn, detail: `${enemy.displayName}: CON save against the mote's burst` },
    });
    if (save.success) {
      lines.push(`${enemy.displayName} shrugs it off (CON ${save.total} vs DC ${dc})`);
      continue;
    }
    // The mote is the bard's: the burst is theirs.
    amount ??= rollCard(campaign, turn, bard?.id ?? null, "damage", rollAgainst("Mote of Potential", enemy.displayName), `1${mote.die}`, bard ? sheetAttacker(bard) : null).total;
    const dealt = Math.max(1, amount);
    applyEnemyDamage(campaign, turn, encounter, getEnemy(enemy.id) ?? enemy, dealt, sheets, sheetsById, "thunder", { magical: true });
    lines.push(`${enemy.displayName} takes ${dealt} thunder damage`);
  }
  publishEncounter(campaign.id);
  return `Mote of Potential: the mote bursts. ${lines.join("; ")}.`;
}
