// War Caster's spell as the opportunity attack: the door that names the
// spell (use_resource "War Caster", variant the spell) and the cast itself,
// made where the weapon would have swung (src/lib/dm/opportunity.ts on the
// battle map, reaction-spells.ts opportunity off it). The rule and the mark
// are in ar-wbf-feat-warcaster-logic.ts.
//
// The cast goes through the spell's own tool (pc_attack for a spell attack,
// cast_at_enemy for a save), so the slot, the components, the range and what
// the spell does are the ones every casting meets; the reaction is what it
// costs of the turn. SRD 5.1, Opportunity Attacks: "The attack interrupts the
// provoking creature's movement, occurring right before the creature leaves
// your reach", so the creature stands on the last square of the reach while
// the spell is measured and lands, and goes on to where it walked afterwards
// (as it does after a weapon's swing, a Sentinel's included).
import { spellFactsFor, spellMechanicsFor } from "@/lib/content";
import { getBattleMapForEncounter, getTokenByRef, moveToken } from "@/lib/db/battle-maps";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { subclassExtrasForTable } from "@/lib/db/subclass-extras";
import {
  asOpportunityCast,
  isOpportunityMark,
  opportunityMark,
  opportunitySpellOf,
  opportunitySpellProblem,
} from "@/lib/dm/ar-wbf-feat-warcaster-logic";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { handleCastAtEnemy } from "@/lib/dm/cast-at-enemy";
import { ownTurnOf } from "@/lib/dm/held-turn";
import { spellHeldProblem } from "@/lib/dm/cast-rules";
import { withOpportunityTurn } from "@/lib/dm/opportunity-strike";
import { handlePcAttack } from "@/lib/dm/pc-attack";
import { getFoe } from "@/lib/dm/sheet-foe";
import { sheetSpellAuthors } from "@/lib/dm/spell-authors";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { markReactionUsed } from "@/lib/dm/turn-budget";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeat } from "@/lib/srd/feat-use";

const WEAPON_WORDS = new Set(["weapon", "none", "attack", "melee", "off", "clear"]);

function eligible(sheet: CharacterSheet, spell: string) {
  const authors = sheetSpellAuthors(sheet);
  const facts = spellFactsFor(spell, authors);
  if (!facts) {
    return { facts: null, mech: null, problem: null };
  }
  const mech = spellMechanicsFor({ spell: facts.name, userIds: authors })?.mech ?? null;
  return { facts, mech, problem: opportunitySpellProblem(facts.name, facts.castingTime, mech) };
}

// use_resource "War Caster": name the spell the opportunity attacks cast, go
// back to the weapon, or ask what is set. Costs nothing: it is a choice, made
// ahead of the trigger because the server answers the trigger itself.
export function warCasterChoice(campaign: Campaign, stale: CharacterSheet, variant: string | undefined): ToolResult {
  const sheet = getSheetById(stale.id) ?? stale;
  if (!holdsFeat(sheet, "War Caster")) {
    return { error: `${sheet.name} does not have the War Caster feat. Nothing was spent.`, refused: "rules" };
  }
  const asked = (variant ?? "").trim();
  const current = opportunitySpellOf(sheet);
  if (!asked) {
    return {
      ok: true,
      resource: "War Caster",
      opportunityAttack: current ? `casts ${current}` : "a melee weapon attack",
      note: `Send variant with a spell of ${sheet.name}'s that has a casting time of 1 action and targets one creature to have their opportunity attacks cast it, or "weapon" to go back to the weapon. Nothing was spent.`,
    };
  }
  const kept = sheet.conditions.filter((entry) => !isOpportunityMark(entry));
  if (WEAPON_WORDS.has(textKey(asked))) {
    if (current) {
      patchSheetAudited(campaign.id, sheet.id, { conditions: kept }, { kind: "clear_condition", reason: "War Caster: the weapon again", delta: { condition: opportunityMark(current) } });
    }
    return { ok: true, resource: "War Caster", opportunityAttack: "a melee weapon attack", applied: `${sheet.name}'s opportunity attacks are made with their weapon.` };
  }
  const { facts, problem } = eligible(sheet, asked);
  if (!facts) {
    return { error: `No spell called "${asked}" is known. Send variant with one of ${sheet.name}'s spells by name, or "weapon". Nothing was spent.`, retry: true };
  }
  if (problem) {
    return { error: `${problem} (SRD 5.1 feat text: "a one-action spell targeting one creature"). Nothing was changed.`, refused: "rules" };
  }
  const unheld = spellHeldProblem(sheet, facts.name, facts, { extras: subclassExtrasForTable(campaign.id, sheet.userId) });
  if (unheld) {
    return { ...unheld, error: `${unheld.error} Nothing was changed.` };
  }
  const mark = opportunityMark(facts.name);
  patchSheetAudited(campaign.id, sheet.id, { conditions: [...kept, mark] }, { kind: "set_condition", reason: `War Caster: opportunity attacks cast ${facts.name}`, delta: { condition: mark } });
  return {
    ok: true,
    resource: "War Caster",
    opportunityAttack: `casts ${facts.name}`,
    applied: `When a creature provokes an opportunity attack from ${sheet.name}, the server casts ${facts.name} at it with their reaction in the weapon's place (its slot and components paid as any casting's are; with none to pay, or out of the spell's range, the weapon swings). It stays so until another spell or "weapon" is named.`,
  };
}

const slotsOf = (sheet: CharacterSheet | null) => JSON.stringify([sheet?.spellcasting?.slots ?? null, sheet?.spellcasting?.pact ?? null, sheet?.resources ?? null]);

// The cast at the creature that provoked, or null when the weapon swings
// instead: no spell named, one this casting cannot be (no slot left, out of
// range, a silence), or the caster's own turn (the cast doors price a turn's
// action there). `at` is the square the creature stood on as it left the
// reach; `reactionKey` the reaction the opportunity attack spends
// (authored-effects-more.ts opportunityReactionKey). The caller's `encounter`
// is brought level with what the cast wrote.
export function warCasterOpportunity(input: {
  campaign: Campaign;
  encounter: Encounter;
  sheet: CharacterSheet;
  enemy: EncounterEnemy;
  at: { x: number; y: number } | null;
  reactionKey: string;
  // Off the battle map use_reaction already holds a turn.
  turn?: DmTurn;
}): { note: string; dropped: boolean; result: ToolResult } | null {
  const { campaign, encounter, enemy } = input;
  const sheet = getSheetById(input.sheet.id) ?? input.sheet;
  const named = opportunitySpellOf(sheet);
  if (!named || ownTurnOf(encounter, sheet.id)) {
    return null;
  }
  const { facts, mech, problem } = eligible(sheet, named);
  if (!facts || !mech || problem) {
    return null;
  }
  const map = getBattleMapForEncounter(encounter.id);
  const token = map ? getTokenByRef(map.id, enemy.id) : null;
  const walkedTo = token && input.at && (token.x !== input.at.x || token.y !== input.at.y) ? { x: token.x, y: token.y, moved: token.movedThisRound } : null;
  if (token && input.at && walkedTo) {
    moveToken(token.id, input.at.x, input.at.y, token.movedThisRound);
  }
  const before = slotsOf(sheet);
  const args = JSON.stringify({ characterId: sheet.id, targetEnemyId: enemy.id, spell: facts.name, reason: "War Caster: the opportunity attack" });
  const cast = (turn: DmTurn): ToolResult => {
    const sheets = listSheets(campaign.id);
    const byId = new Map(sheets.map((entry) => [entry.id, entry]));
    return asOpportunityCast(sheet.id, () =>
      mech.resolution === "attack"
        ? handlePcAttack(campaign, turn, args, sheets, byId, new Set(), null, { reactionAttack: true })
        : handleCastAtEnemy(campaign, turn, args, sheets, byId, { asReaction: true }),
    );
  };
  let result: ToolResult;
  try {
    result = input.turn ? cast(input.turn) : withOpportunityTurn(campaign.id, cast);
  } finally {
    const live = map && walkedTo ? getTokenByRef(map.id, enemy.id) : null;
    if (live && walkedTo) {
      moveToken(live.id, walkedTo.x, walkedTo.y, walkedTo.moved);
    }
  }
  const refused = typeof result.error === "string";
  // A refusal that spent nothing leaves the reaction for the weapon; one
  // that came after the slot was paid (a Counterspell) was the reaction.
  if (refused && slotsOf(getSheetById(sheet.id)) === before) {
    return null;
  }
  const fresh = getActiveEncounter(campaign.id);
  if (fresh) {
    if (!fresh.reactionsUsed.includes(input.reactionKey)) {
      markReactionUsed(fresh, input.reactionKey);
    }
    Object.assign(encounter, fresh);
  }
  const after = getFoe(enemy.id);
  const dropped = !after || after.status !== "alive";
  const outcome = refused
    ? String(result.error)
    : [result.applied, result.outcome, result.narration, result.result].find((entry): entry is string => typeof entry === "string" && entry.length > 0)
      ?? (result.hit === false ? "the spell misses." : result.saved === true ? "it saves." : "the spell lands.");
  return {
    note: `${sheet.name} casts ${facts.name} at ${enemy.displayName} as it breaks away (War Caster, their reaction): ${outcome}`,
    dropped,
    result,
  };
}
