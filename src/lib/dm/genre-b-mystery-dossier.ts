// The files the mystery classes keep on the people they deal with (WAVE2 D5:
// the genre text is the rule, played on the SRD 5.1 engine), and what each
// file changes of a roll:
//
//   Trauma Map (alienist)      "After 10 minutes with a patient, learn their
//                              deepest current fear": the map on file is what
//                              The Examined Mind reads ("it cannot be resisted
//                              by creatures you have a Trauma Map of")
//   Case Study (alienist)      "Pick a creature you have treated or studied;
//                              advantage on Insight and Persuasion against it
//                              permanently"
//   Nemesis Study (detective)  "Choose a named foe; advantage on all checks
//                              and saves opposing them until the case ends"
//   Sunk Cost (grifter)        "A creature that has believed one of your lies
//                              has disadvantage on Insight against you
//                              thereafter"
//   Two Steps Ahead            "you cannot be surprised by creatures you have
//     (muckraker)              investigated"
//   Working Class Hero         "Advantage on Persuasion with laborers,
//     (enforcer)               dockhands, and the working poor": the people the
//                              enforcer has on file as working folk
//   Archetype Made Flesh       "your treatments treat one target's saving
//     (alienist)               throw as if it rolled a 1"
//
// A file is a flag on the bond the engine already keeps between a character
// and a person by name (src/lib/db/relationships.ts): no new table, reverted
// with the turn that wrote it, and a creature of a fight is found by the
// person it is (its npc row) or by its own name.
//
// The doors that ask here: social_check (social-tools.ts socialEdge), a
// creature's save against a spell (forced-save.ts rollEnemySave), a save a
// creature forces on a character (forced-save.ts rollCharacterSave) and a
// grapple or shove contest (combat-actions.ts).
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { getNpcById } from "@/lib/db/npcs";
import { ensureRelationship, getRelationship, listRelationships, patchRelationship } from "@/lib/db/relationships";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { actingSheetId } from "@/lib/dm/authored-saves";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { addFlag } from "@/lib/dm/relationship-logic";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { ARCHETYPE, EXAMINED } from "@/lib/srd/genre-b-mystery-conditions";
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const FILE = { trauma: "trauma_map", study: "case_study", nemesis: "nemesis", lied: "believed_lie", investigated: "investigated", kin: "working_folk" } as const;
type FileFlag = (typeof FILE)[keyof typeof FILE];

// The name a creature of a fight is on file under: the person it is, else its own.
export function fileNameOf(enemy: Pick<EncounterEnemy, "displayName" | "npcId">): string {
  return (enemy.npcId ? getNpcById(enemy.npcId)?.name : null) ?? enemy.displayName;
}

export function onFile(campaignId: string, sheetId: string, name: string, flag: FileFlag): boolean {
  return Boolean(getRelationship(campaignId, sheetId, name)?.flags.includes(flag));
}

// Opens the file. `single`: the character keeps one such file, and the one
// before is closed (a new nemesis).
export function openFile(campaign: Campaign, sheet: Pick<CharacterSheet, "id" | "name">, name: string, flag: FileFlag, options: { single?: boolean; npcId?: string } = {}) {
  if (options.single) {
    for (const bond of listRelationships(campaign.id)) {
      if (bond.characterId === sheet.id && bond.flags.includes(flag)) {
        patchRelationship(bond.id, { flags: bond.flags.filter((entry) => entry !== flag) });
      }
    }
  }
  const bond = ensureRelationship({ campaignId: campaign.id, characterId: sheet.id, characterName: sheet.name, subjectKind: "npc", subjectName: name, ...(options.npcId ? { subjectId: options.npcId } : {}) });
  patchRelationship(bond.id, { flags: addFlag(bond.flags, flag) });
}

// The one creature a character already holds such a file on, if any.
export function fileHeld(campaignId: string, sheetId: string, flag: FileFlag): string | null {
  return listRelationships(campaignId).find((bond) => bond.characterId === sheetId && bond.flags.includes(flag))?.subjectName ?? null;
}

// ---- social_check ----

export type SocialEdge = { advantage: boolean; dcShift: number; notes: string[] };

// What the files give a character swaying this person: advantage on the
// check, or the person's passive Insight at disadvantage (5 off the DC, SRD
// 5.1 Passive Checks).
export function socialEdge(campaignId: string, sheet: CharacterSheet, npcName: string, approach: "persuade" | "deceive" | "intimidate"): SocialEdge {
  const edge: SocialEdge = { advantage: false, dcShift: 0, notes: [] };
  if (holdsGenreFeature(sheet, "detective", "Nemesis Study") && onFile(campaignId, sheet.id, npcName, FILE.nemesis)) {
    edge.advantage = true;
    edge.notes.push("Nemesis Study: advantage on a check opposing their nemesis");
  }
  if (approach === "persuade" && holdsGenreFeature(sheet, "alienist", "Case Study") && onFile(campaignId, sheet.id, npcName, FILE.study)) {
    edge.advantage = true;
    edge.notes.push("Case Study: advantage on Persuasion against the creature studied");
  }
  if (approach === "persuade" && holdsGenreFeature(sheet, "enforcer", "Working Class Hero") && onFile(campaignId, sheet.id, npcName, FILE.kin)) {
    edge.advantage = true;
    edge.notes.push("Working Class Hero: advantage on Persuasion with working folk");
  }
  if (approach === "deceive" && holdsGenreFeature(sheet, "grifter", "Sunk Cost") && onFile(campaignId, sheet.id, npcName, FILE.lied)) {
    edge.dcShift = -5;
    edge.notes.push("Sunk Cost: it believed their lie before, so its Insight against them is at disadvantage (DC 5 lower)");
  }
  return edge;
}

// A lie that landed: the grifter's Sunk Cost reads it from then on.
export function noteBelievedLie(campaign: Campaign, sheet: CharacterSheet, npc: { id: string; name: string }) {
  if (holdsGenreFeature(sheet, "grifter", "Sunk Cost")) {
    openFile(campaign, sheet, npc.name, FILE.lied, { npcId: npc.id });
  }
}

// ---- rolls against a creature of the fight ----

// Nemesis Study: the detective's check or save opposing their nemesis.
export function nemesisClaim(campaignId: string, sheet: CharacterSheet, enemy: Pick<EncounterEnemy, "displayName" | "npcId"> | null | undefined): { advantage: "advantage"; reason: string } | null {
  if (!enemy || !holdsGenreFeature(sheet, "detective", "Nemesis Study") || !onFile(campaignId, sheet.id, fileNameOf(enemy), FILE.nemesis)) {
    return null;
  }
  return { advantage: "advantage", reason: "Nemesis Study: advantage on checks and saves opposing their nemesis" };
}

// A creature's save against the acting alienist's spell, undone: as if it
// rolled a 1 (Archetype Made Flesh, the mark spent by it), or not to be
// resisted at all (The Examined Mind's slotless treatment on a creature whose
// Trauma Map they hold, the mark spent). Null when neither holds.
export function treatmentUndoes(campaignId: string, enemy: EncounterEnemy, magical: boolean): { face?: 1; hard?: true; note: string } | null {
  const actorId = magical ? actingSheetId(getActiveEncounter(campaignId)) : null;
  const alienist = actorId ? getSheetById(actorId) : null;
  if (!alienist) {
    return null;
  }
  const examined = alienist.conditions.find((entry) => isConditionNamed(entry, EXAMINED));
  if (examined && onFile(campaignId, alienist.id, fileNameOf(enemy), FILE.trauma)) {
    const cleared = removeConditions(alienist.conditions, alienist.conditionMeta as ConditionMetaMap, [examined]);
    patchSheet(alienist.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
    return { hard: true, note: `The Examined Mind: ${alienist.name} holds its Trauma Map, and the treatment cannot be resisted` };
  }
  const fresh = getEnemy(enemy.id) ?? enemy;
  const mark = fresh.conditions.find((entry) => isConditionNamed(entry, ARCHETYPE));
  const meta = mark ? (fresh.conditionMeta as Record<string, { source?: string } | undefined>)?.[mark] : undefined;
  if (mark && meta?.source === alienist.id) {
    const cleared = removeConditions(fresh.conditions, fresh.conditionMeta, [mark]);
    patchEnemyConditions(fresh.id, cleared.conditions, cleared.meta);
    return { face: 1, note: `Archetype Made Flesh: the save against ${alienist.name}'s treatment counts as a roll of 1` };
  }
  return null;
}

// Two Steps Ahead: a creature the muckraker has investigated cannot surprise
// them (src/lib/dm/genre-b-surprise.ts canSurprise).
export function investigatedBy(sheet: CharacterSheet, enemy: Partial<Pick<EncounterEnemy, "displayName" | "npcId">>): boolean {
  if (!enemy.displayName || !holdsGenreFeature(sheet, "muckraker", "Two Steps Ahead")) {
    return false;
  }
  return onFile(sheet.campaignId, sheet.id, fileNameOf({ displayName: enemy.displayName, npcId: enemy.npcId }), FILE.investigated);
}
