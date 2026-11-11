// Improved Reaper (Death cleric 17): a 1st to 5th level necromancy spell
// that targets one creature strikes a second creature within 5 feet of the
// first from the same slot, at no further cost (the material components a
// spell consumes are the caster's to provide for each). Reaper (Death cleric
// 1) does the same for a necromancy cantrip, Moon Fire (Lunar Sorcery 1) for
// sacred flame. cast_at_enemy with two targets for a spell that reaches one
// (src/lib/dm/cast-at-enemy-targets.ts) reaches handleReaperCast, which casts once (the slot spent, if any) and opens one
// more share of that casting for the second creature (cast-guard.ts open
// casts, so nothing more is spent).

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { spellFactsFor, spellMechanicsFor, spellSchoolFor } from "@/lib/content";
import { authoredTwinSpell } from "@/lib/srd/authored-effects-more";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { withinFeet } from "@/lib/dm/authored-saves";
import { handleCastAtEnemy } from "@/lib/dm/cast-at-enemy";
import { spellReachProblem } from "@/lib/dm/cast-reach";
import { openCastOf, withOpenCast } from "@/lib/dm/cast-rules";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolResult } from "@/lib/dm/tool-errors";

// cast_at_enemy with a second target (Improved Reaper), or null when the call
// names none and the plain handler resolves it.
export function handleReaperCast(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const { secondTargetEnemyId: named, ...rest } = parsed;
  const secondTargetEnemyId = typeof named === "string" ? named.trim() : "";
  if (!secondTargetEnemyId) {
    return null;
  }
  const encounter = getActiveEncounter(campaign.id);
  const stale = resolveSheetRef(String(rest.characterId ?? ""), sheets, sheetsById);
  const sheet = stale ? (getSheetById(stale.id) ?? stale) : null;
  const spell = String(rest.spell ?? "");
  if (!encounter || !sheet) {
    return { error: "A second target is a creature in the fight: cast_at_enemy needs a caster from GAME STATE and an active encounter.", retry: true };
  }
  // Either may be any combatant: an enemy, or a character fighting on the
  // other side (src/lib/dm/combatant.ts).
  const first = resolveTargetFoe(campaign.id, encounter, String(rest.targetEnemyId ?? ""));
  const second = resolveTargetFoe(campaign.id, encounter, secondTargetEnemyId);
  if (!first || !second || second.status !== "alive" || second.id === first.id) {
    return { error: "The second target is a second living creature from GAME STATE, not the first. Nothing was spent.", retry: true };
  }
  const authors = spellAuthorsFor(campaign);
  const facts = spellFactsFor(spell, authors);
  const twin = authoredTwinSpell(sheet, { name: facts?.name ?? spell, school: spellSchoolFor(spell, authors), level: facts?.level ?? 0 });
  if (!twin) {
    return { error: `${sheet.name} cannot strike a second creature with ${spell}: that takes Reaper (a necromancy cantrip), Improved Reaper (a 1st to 5th level necromancy spell), Moon Fire (sacred flame) or Split Enchantment (an enchantment spell of 1st level or higher). Ask the player whether to cast it at one creature. Nothing was spent.`, retry: true };
  }
  const mech = spellMechanicsFor({ spell, userIds: authors })?.mech;
  if ((mech?.targets?.count ?? 1) > 1 || mech?.area) {
    return { error: `${spell} already reaches more than one creature; ${twin.feature} doubles a spell that targets only one. Ask the player whether to cast it as it is. Nothing was spent.`, retry: true };
  }
  // Reaper's and Moon Fire's second creature stands within 5 feet of the
  // first. Split Enchantment's text sets no distance between the two.
  if (!twin.anywhere && !withinFeet(encounter.id, first.id, second.id, 5)) {
    return { error: `${second.displayName} is not within 5 feet of ${first.displayName}; ${twin.feature}'s second target must be. Ask the player for another target, or whether to cast it at one creature. Nothing was spent.`, retry: true };
  }
  // The second creature is a target of the spell like the first: in the
  // spell's own range, asked before the slot is spent on the first.
  const reach = spellReachProblem({ encounterId: encounter.id, casterId: sheet.id, casterName: sheet.name, targetId: second.id, targetName: second.displayName, facts });
  if (reach) {
    return reach;
  }
  const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
  if (!budget) {
    return { error: `${twin.feature} doubles a spell ${sheet.name} casts on their own turn. Ask the player whether to cast it at one creature. Nothing was spent.`, retry: true };
  }
  const cast = handleCastAtEnemy(campaign, turn, JSON.stringify(rest), sheets, sheetsById);
  if (typeof cast.error === "string") {
    // An attack-roll spell is pc_attack's, which takes the second target too.
    return cast.error.includes("resolve it with pc_attack") ? { ...cast, error: `${cast.error} Send secondTargetEnemyId "${second.id}" with it for ${twin.feature}.` } : cast;
  }
  // One more share of the same casting, for the second creature.
  const live = getActiveEncounter(campaign.id);
  const liveBudget = live ? budgetFor(live, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions)) : null;
  const name = facts?.name ?? spell;
  if (live && liveBudget) {
    const open = openCastOf(liveBudget, name);
    const slotLevel = typeof rest.level === "number" ? rest.level : (open?.slotLevel ?? facts?.level ?? null);
    storeBudget(live, withOpenCast(liveBudget, { spell: name, slotLevel, left: (open?.left ?? 0) + 1 }));
  }
  const again = handleCastAtEnemy(campaign, turn, JSON.stringify({ ...rest, targetEnemyId: second.id }), sheets, sheetsById);
  return { ...cast, secondTarget: again, [twin.feature]: `${name} also strikes ${second.displayName}.` };
}

// The same feature through pc_attack, for an attack-roll spell (Chill Touch,
// Inflict Wounds): before this pc_attack let secondTargetEnemyId fall, so
// Reaper's cantrip and Improved Reaper's Inflict Wounds struck one creature
// while a save spell struck two. The checks are handleReaperCast's, asked
// before the first attack so a refusal costs nothing: a spell the feature
// doubles, that targets one creature, a second living creature within 5 feet
// of the first, on the caster's own turn. `strikeSecond` then opens one more
// share of the casting (nothing more is spent) and makes its attack.
export function reaperAttackTwin(
  campaign: Campaign,
  sheet: CharacterSheet,
  args: Record<string, unknown>,
): { error: string; retry: true } | { feature: string; spell: string; second: string; secondName: string } | null {
  const secondRef = typeof args.secondTargetEnemyId === "string" ? args.secondTargetEnemyId.trim() : "";
  if (!secondRef) {
    return null;
  }
  const spell = typeof args.spell === "string" ? args.spell.trim() : "";
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || !spell) {
    return { error: "A second target is for a spell cast at a creature in the fight: name the spell, and start the encounter. Nothing was spent.", retry: true };
  }
  const first = resolveTargetFoe(campaign.id, encounter, String(args.targetEnemyId ?? ""));
  const second = resolveTargetFoe(campaign.id, encounter, secondRef);
  if (!first || !second || second.status !== "alive" || second.id === first.id) {
    return { error: "The second target is a second living creature from GAME STATE, not the first. Nothing was spent.", retry: true };
  }
  const authors = spellAuthorsFor(campaign);
  const facts = spellFactsFor(spell, authors);
  const twin = authoredTwinSpell(sheet, { name: facts?.name ?? spell, school: spellSchoolFor(spell, authors), level: typeof args.level === "number" ? args.level : (facts?.level ?? 0) });
  if (!twin) {
    return { error: `${sheet.name} cannot strike a second creature with ${spell}: that takes Reaper (a necromancy cantrip), Improved Reaper (a 1st to 5th level necromancy spell) or Moon Fire (sacred flame). Ask the player whether to cast it at one creature. Nothing was spent.`, retry: true };
  }
  const mech = spellMechanicsFor({ spell, userIds: authors })?.mech;
  if ((mech?.targets?.count ?? 1) > 1 || mech?.area) {
    return { error: `${spell} already reaches more than one creature; ${twin.feature} doubles a spell that targets only one. Nothing was spent.`, retry: true };
  }
  if (!withinFeet(encounter.id, first.id, second.id, 5)) {
    return { error: `${second.displayName} is not within 5 feet of ${first.displayName}; ${twin.feature}'s second target must be. Ask the player for another target, or whether to cast it at one creature. Nothing was spent.`, retry: true };
  }
  if (!budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions))) {
    return { error: `${twin.feature} doubles a spell ${sheet.name} casts on their own turn. Nothing was spent.`, retry: true };
  }
  return { feature: twin.feature, spell: facts?.name ?? spell, second: second.id, secondName: second.displayName };
}

// After the first attack landed or missed: one more share of the casting for
// the second creature, so its attack spends no slot and no action.
export function openReaperShare(campaign: Campaign, sheet: CharacterSheet, spell: string, level: unknown) {
  const live = getActiveEncounter(campaign.id);
  const fresh = getSheetById(sheet.id) ?? sheet;
  const budget = live ? budgetFor(live, fresh.id, attacksAllowedFor(fresh), conditionTurnShape(fresh.conditions)) : null;
  if (!live || !budget) {
    return;
  }
  const open = openCastOf(budget, spell);
  const slotLevel = typeof level === "number" ? level : (open?.slotLevel ?? spellFactsFor(spell, spellAuthorsFor(campaign))?.level ?? null);
  storeBudget(live, withOpenCast(budget, { ...(open ?? {}), spell, slotLevel, left: (open?.left ?? 0) + 1 }));
}
