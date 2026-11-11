// The Hound of Ill Omen (Shadow Magic 6): "Spend 3 sorcery points to summon a
// shadow dire wolf that chases one creature, gives your spells advantage
// against it, and blocks its escape."
//
// Before this the three points bought a mark on the quarry and nothing else:
// no creature joined the fight, so nothing chased it or bit it. The spend
// (authored-spend-effects.ts, the buff on the enemy) now also brings the
// hound in, as every creature a feature makes is (spawnSummons, the Dancing
// Item's and the steel defender's door): the SRD dire wolf's block, as a
// Medium monstrosity, with temporary hit points equal to half the sorcerer
// level, its own initiative roll, and five minutes to live. It is bound to the
// creature named (ar-ws-hound-quarry.ts): it attacks that creature alone and
// is gone when it falls.
//
// The quarry's disadvantage on saves against the sorcerer's spells is the
// mark's (authored-saves.ts, the row's enemy_save effect), as before.

import { randomUUID } from "node:crypto";
import type { Campaign } from "@/lib/db/campaigns";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { HOUND, HUNTING } from "@/lib/dm/ar-ws-hound-quarry";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { summonRecord } from "@/lib/dm/summon-rules";
import { spawnSummons } from "@/lib/dm/summon-store";
import { publishPersisted } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { findSummonForm, type SummonForm } from "@/lib/srd/summon-forms";

// Five minutes, in rounds.
const FIVE_MINUTES = 50;

// Brings the hound in beside its sorcerer, bound to `quarry`. Answers the
// line the spend's result carries.
export function summonHound(campaign: Campaign, sheet: CharacterSheet, sorcererLevel: number, quarry: EncounterEnemy): string {
  const wolf = findSummonForm("Dire Wolf");
  if (!wolf) {
    return "The SRD dire wolf is not in the creature table, so no hound stands on the board; the GM plays it.";
  }
  const form: SummonForm = {
    ...wolf,
    name: HOUND,
    size: "Medium",
    type: "monstrosity",
    traits: `${wolf.traits ? `${wolf.traits} ` : ""}It hunts ${quarry.displayName}: it moves toward that creature, attacks no other, and is gone when its quarry falls.`.slice(0, 400),
  };
  const tempHp = Math.floor(sorcererLevel / 2);
  const record = summonRecord(form, { spell: HOUND, casterId: sheet.id, casterName: sheet.name, concentration: false, castId: randomUUID().slice(0, 8) });
  const [made] = spawnSummons(campaign, sheet, { form, count: 1, record, rounds: FIVE_MINUTES, slotLevel: null, initiative: "group", conditions: [HUNTING], tempHp });
  const fresh = made ? getSheetById(made.id) : null;
  if (!fresh) {
    return "No hound could be brought to the table.";
  }
  const bound = patchSheet(fresh.id, { conditionMeta: { ...(fresh.conditionMeta as ConditionMetaMap), [HUNTING]: { quarry: quarry.id, source: sheet.id } } });
  if (bound) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: bound });
  }
  const bite = form.attacks[0];
  return `${fresh.name} bounds out of the shadows for ${quarry.displayName} (characterId ${fresh.id}): a dire wolf's block, ${fresh.currentHp} hit points and ${tempHp} temporary, ${bite ? `${bite.name} +${bite.toHit} (${bite.damage} ${bite.type})` : "its bite"}, on its own initiative for five minutes. It attacks ${quarry.displayName} alone (pc_attack under its characterId) and is gone when that creature falls.`;
}
