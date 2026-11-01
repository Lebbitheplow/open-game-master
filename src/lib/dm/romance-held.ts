import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getAiTurns } from "@/lib/db/advances";
import { getActiveEncounter } from "@/lib/db/encounters";
import { listRelationships, type Relationship } from "@/lib/db/relationships";
import { heldStepOf, listHeldSteps, saveHeldStep } from "@/lib/db/romance-held";
import { listSheets } from "@/lib/db/sheets";
import { heroFell } from "@/lib/characters/fallen-logic";
import { APPROVAL_MAX, canAdvanceRomance, type RomanceStage } from "@/lib/dm/relationship-logic";
import { heldStepCue, heldStepDue, heldStepNote, heldStepStands, type HeldRung, type HeldStep } from "@/lib/dm/romance-held-logic";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { publishEphemeral } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A romantic step asked mid-fight, held on the bond until the fight is over
// (issue 640; the rules are romance-held-logic.ts). romance_advance holds one
// it is asked while a fight is on; the end of every fight (enemy-damage.ts
// afterTheFight, the lead's force-end included) starts the answer owed; the
// next AI turn's director notes and the console's Waiting on you say so until
// romance_advance answers it.

function romanceOn(campaign: Campaign): boolean {
  return campaign.gameSettings.relationships !== "off" && campaign.gameSettings.romance !== "off";
}

// The seam: holds `to` on the bond as the ask waiting for its answer, the
// latest ask replacing an earlier one. Issue 641's claims reader holds a step
// it finds in a fight's narration through here too (source "claim"). Null
// when there is nothing to hold: no fight on, romance off, or the ask is not
// the bond's next step.
export function holdRomanceStep(
  campaign: Campaign,
  relationship: Pick<Relationship, "id" | "romance" | "status">,
  to: HeldRung,
  note: string | undefined,
  source: HeldStep["source"],
): HeldStep | null {
  const step: HeldStep = { to, note: note?.trim() ?? "", source, heldAt: new Date().toISOString(), releasedAt: null };
  if (!romanceOn(campaign) || !getActiveEncounter(campaign.id) || !heldStepStands(step, relationship)) {
    return null;
  }
  saveHeldStep(relationship.id, step);
  publishEphemeral(campaign.id, "relationships_updated", {});
  return step;
}

// romance_advance while a fight is on: the step is held, not rolled. Only
// the ask's shape is judged now (the next rung, a bond still open); whether
// the feeling is there is judged when it is answered, so the meter is read
// at its best here.
export function holdForTheFight(
  campaign: Campaign,
  turn: Pick<DmTurn, "actor">,
  sheet: Pick<CharacterSheet, "name">,
  subject: string,
  relationship: Relationship,
  to: HeldRung,
  note: string | undefined,
): ToolResult {
  const shape = canAdvanceRomance(relationship.romance, to, APPROVAL_MAX, relationship.status);
  if (!shape.ok) {
    return toolError(shape);
  }
  holdRomanceStep(campaign, relationship, to, note, "call");
  return {
    ok: true,
    held: true,
    character: sheet.name,
    subject,
    requested: to,
    romance: relationship.romance,
    note: heldStepNote(sheet.name, subject, to, turn.actor === "human_dm"),
  };
}

// romance_advance reaching a verdict on the step a bond held: whatever the
// answer, it is owed no longer.
export function settleHeldStep(campaignId: string, relationshipId: string, to: RomanceStage) {
  const held = heldStepOf(relationshipId);
  if (held && held.to === to) {
    saveHeldStep(relationshipId, null);
    publishEphemeral(campaignId, "relationships_updated", {});
  }
}

// The held steps still owed an answer now: a fight is not on, romance is,
// the bond still asks it and its character lives, and the GM has not let it
// pass for ANSWER_TURNS of the AI's turns.
function owedAnswers(campaign: Campaign, { due }: { due: boolean }): Array<{ bond: Relationship; step: HeldStep }> {
  if (!romanceOn(campaign)) {
    return [];
  }
  const held = listHeldSteps(campaign.id);
  if (!held.size || getActiveEncounter(campaign.id)) {
    return [];
  }
  const aiTurns = getAiTurns(campaign.id);
  const fallen = new Set(listSheets(campaign.id).filter(heroFell).map((sheet) => sheet.id));
  return listRelationships(campaign.id).flatMap((bond) => {
    const step = held.get(bond.id);
    if (!step || fallen.has(bond.characterId) || !heldStepStands(step, bond) || (due && !heldStepDue(step, false, aiTurns))) {
      return [];
    }
    return [{ bond, step }];
  });
}

function cue({ bond, step }: { bond: Relationship; step: HeldStep }): string {
  return heldStepCue(bond.characterName, bond.characterId, bond.subjectName, step);
}

// The fight is over: each step held in it is owed its answer from now.
// Returns the GM's reminders, for the end of the fight's own result.
export function releaseHeldSteps(campaign: Campaign): string[] {
  const held = listHeldSteps(campaign.id);
  if (!held.size) {
    return [];
  }
  const aiTurns = getAiTurns(campaign.id);
  for (const [id, step] of held) {
    if (step.releasedAt === null) {
      saveHeldStep(id, { ...step, releasedAt: aiTurns });
    }
  }
  // The console's Waiting on you reads the bonds again.
  publishEphemeral(campaign.id, "relationships_updated", {});
  return owedAnswers(campaign, { due: true }).map(cue);
}

// The director notes on the turns after the fight: one per answer owed.
export function heldStepNotes(campaign: Campaign): string[] {
  return owedAnswers(campaign, { due: true }).map(cue);
}

// For the compact tool profile: an answer is owed, so the romance tool's
// group is offered.
export function romanceAnswerOwed(campaign: Campaign): boolean {
  return owedAnswers(campaign, { due: true }).length > 0;
}

// What the console shows under Waiting on you, by bond id: every held step
// still asked once the fight is over. A person answers when they choose, so
// no count of AI turns runs it out there.
export function heldAsks(campaign: Campaign): Map<string, HeldRung> {
  return new Map(owedAnswers(campaign, { due: false }).map(({ bond, step }) => [bond.id, step.to]));
}
