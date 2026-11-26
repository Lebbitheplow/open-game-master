// The checks the 2026-11-13 creator audit's second genre pass wired: what a
// genre feature says of a check after it is rolled, or of the check a creature
// makes against the holder (WAVE2 D5: the genre text is the rule, played on
// the SRD 5.1 engine).
//
//   rerollFailedCheck: "reroll a failed <skill> check" (the grifter's Silver
//     Tongue: Deception or Persuasion; the fixer's Grease the Wheels reads the
//     same last failed check, src/lib/dm/genre-a-cyberpunk-spends.ts). The
//     holder's last check that missed its DC, with one of the skills named,
//     rolled again through the check's own door; the new roll stands. Refused
//     with nothing spent when the last failed check was another;
//   observersDisadvantaged: Patient Hands, "observers have disadvantage to
//     catch you": the creature that contests the grifter's Sleight of Hand
//     (request_roll's againstEnemyId or againstMonster, src/lib/dm/roll-gates.ts
//     rollContest) rolls its side at disadvantage.
import type { Campaign } from "@/lib/db/campaigns";
import { latestRoll } from "@/lib/db/rolls";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import type { ToolError } from "@/lib/dm/tool-errors";
import { rollSkill } from "@/lib/roll-parts";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { findSkill } from "@/lib/srd";

export function rerollFailedCheck(campaign: Campaign, sheet: CharacterSheet, label: string, skills: readonly string[]): ToolError | { result: Record<string, unknown> } {
  const failed = latestRoll(campaign.id, 60, (roll) => roll.characterId === sheet.id && (roll.kind === "skill_check" || roll.kind === "ability_check") && roll.dc !== null && roll.total < roll.dc);
  // The skill the check was made with, off its fields (src/lib/roll-parts.ts).
  const skill = failed ? rollSkill(failed, skills) : null;
  if (!failed || !skill) {
    const list = skills.map((id) => findSkill(id)?.name ?? id).join(" or ");
    return { error: `${sheet.name}'s last check that failed was no ${list} check, so ${label} has nothing to reroll. Nothing was spent.`, refused: "rules" };
  }
  const dc = failed.dc!;
  const again = rollCharacterCheck(campaign, sheet, { skill, dc }, `${label} reroll`);
  const made = again.total >= dc;
  return { result: { reroll: `${label}: the ${findSkill(skill)?.name ?? skill} check is rolled again, ${again.total} against DC ${dc}: ${made ? "it succeeds" : "it fails again"}.` } };
}

type Roller = { class?: string; classes?: CharacterSheet["classes"]; features?: CharacterSheet["features"] } | null | undefined;

export function observersDisadvantaged(roller: Roller, skill: string | null): boolean {
  return Boolean(roller?.class && roller.features && skill === "sleight_of_hand" && holdsGenreFeature({ class: roller.class, classes: roller.classes, features: roller.features }, "grifter", "Patient Hands"));
}
