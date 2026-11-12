// Spending hit dice at the end of a short rest: each die heals its face plus
// the Constitution modifier (never below 0 for that die), and the healing
// stops at the character's maximum. Shared by the rest tool (the DM's
// take_rest) and the player's own choice after it
// (POST /api/campaigns/[campaignId]/sheet/hit-dice).
//
// Whose dice they are: a player on physical dice rolls their own and enters
// the faces, on their sheet for their own spend and on a roll card when the
// GM at the console spends for them while they are at the table (issue 902:
// the server rolled every die of a seat that was told it rolls its own).
// The server rolls for everyone else, and for a player who is away.
//
// SRD 5.1, Short Rest: "A character can spend one or more Hit Dice at the end
// of a short rest ... For each Hit Die spent in this way, the player rolls
// the die and adds the character's Constitution modifier to it. The player
// can decide to spend an additional Hit Die after each roll." The player
// decides; the server's own choice (spend toward half HP) stands in only for
// a character with no player at the table.

import { chefRestDie, hitDieHealingFloor } from "@/lib/srd/feat-combat";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { insertRoll } from "@/lib/db/rolls";
import { rollEnteredDice, rollExpression, type RollResult } from "@/lib/dice";
import { rollCharacterDice, type DoorLanding } from "@/lib/dm/character-roll";
import { onlineUserIds, publishPersisted, publishWithSeq } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { songOfRestDieFor } from "@/lib/srd/feature-effects";
import { healMath } from "@/lib/dm/mutation-math";
import { hitDiceHealing, hitDicePlanExpression, shortRestDicePlan } from "@/lib/dm/rest-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { healCeiling, hitDiceHealingFactor } from "@/lib/dm/afflictions";
import type { ToolError } from "@/lib/dm/tool-errors";
import { sanctuaryDieBonus } from "@/lib/dm/genie-vessel";

export type HitDiceOutcome =
  | ToolError
  | { name: string; diceSpent: number; healed: number; hp: string; rollId: string };

// What spending `requested` hit dice has this character roll: the dice (as
// many as they have left), the Constitution modifier for each, and the one
// die a song or a meal adds. Null with no die left to spend. The sheet's
// control shows a player what to roll from this (the route's GET), and the
// spend scores the faces they enter against it, so the two cannot disagree.
export function hitDiceRoll(
  sheet: CharacterSheet,
  requested: number,
  extra: { songDie?: string | null; chefDie?: string | null },
): { count: number; conMod: number; expression: string } | null {
  const available = Math.max(0, sheet.hitDice.total - sheet.hitDice.spent);
  const count = Math.min(requested, available);
  if (count < 1) {
    return null;
  }
  const conMod = computeSheetDerived(sheet).abilityMods.con;
  // Multiclass sheets draw from their per-class pools, biggest die first
  // (the same order patchSheet reconciles the spent counter in).
  const expression = `${hitDicePlanExpression(shortRestDicePlan(sheet, count), conMod)}${
    extra.songDie ? `+1${extra.songDie}` : ""
  }${extra.chefDie ? `+1${extra.chefDie}` : ""}`;
  return { count, conMod, expression };
}

// Rolls `requested` hit dice for one character (as many as they have left),
// heals them, and writes the spend with an audit entry the lead can undo.
export function spendHitDice(input: {
  campaign: Campaign;
  turnId: string | null;
  sheetId: string;
  requested: number;
  songDie: string | null;
  // Chef's meal: an extra d8 for every creature that spends a die.
  chefDie?: string | null;
  reason: string;
  requestedBy: "dm" | "player";
  // The player's own dice, one entry for each die of the roll (hitDiceRoll):
  // a face they rolled, or null for a die the server draws. Left out, the
  // server rolls them all.
  faces?: ReadonlyArray<number | null>;
  // The GM's spend for a player who is at the table: the roll goes through
  // the one door a character's own dice do (character-roll.ts), so a seat on
  // physical dice gets a card for it and the rest waits on their dice.
  mayWait?: boolean;
}): HitDiceOutcome {
  const { campaign } = input;
  const sheet = getSheetById(input.sheetId);
  if (!sheet) {
    return { error: "Character not found.", retry: true };
  }
  if (sheet.deathSaves?.dead) {
    return { error: `${sheet.name} is dead and spends no hit dice.`, refused: "rules" };
  }
  if (sheet.currentHp <= 0) {
    return {
      error: `${sheet.name} is unconscious at 0 hit points; hit dice cannot be spent until they are healed or stable and awake.`,
      refused: "rules",
    };
  }
  const ask = hitDiceRoll(sheet, input.requested, input);
  if (!ask) {
    return { error: `${sheet.name} has no hit dice left; they come back with a long rest.`, refused: "rules" };
  }
  const { count, conMod, expression } = ask;
  // Inside a Genie's Sanctuary Vessel each die restores the warlock's
  // proficiency bonus more (genie-vessel.ts): a flat amount, added below,
  // with nothing in it for the player to roll.
  const sanctuary = sanctuaryDieBonus(sheet);
  const detail = `short rest: ${count} hit ${count === 1 ? "die" : "dice"}${
    input.songDie ? ` + Song of Rest ${input.songDie}` : ""
  }${input.chefDie ? ` + Chef ${input.chefDie}` : ""}${sanctuary ? ` + Sanctuary Vessel ${sanctuary.bonus} a die` : ""}`;
  let outcome: RollResult;
  // How dice the player rolled came in; null for the server's own.
  let landing: DoorLanding | null = null;
  if (input.faces) {
    try {
      outcome = rollEnteredDice(expression, input.faces);
    } catch (error) {
      return { error: `${error instanceof Error ? error.message : "Those dice cannot be read."} ${sheet.name} rolls ${expression}. No hit die was spent.`, retry: true };
    }
    const typed = input.faces.filter((face) => face !== null).length;
    // As a roll card's dice are marked (pending-roll-land.ts): physical only
    // when every face was the player's, and thrown on the stage only when
    // none was.
    landing = typed ? { physical: typed === input.faces.length, source: "physical" } : null;
  } else if (input.mayWait) {
    ({ outcome, landing } = rollCharacterDice(campaign, sheet, { kind: "custom", expression, detail }));
  } else {
    outcome = rollExpression(expression);
  }
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: input.requestedBy,
    kind: "custom",
    detail: landing?.physical ? `${detail} (physical)` : detail,
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: landing?.source ?? "digital" });
  // Each die is floored at 0 on its own; the total is not what is floored.
  // Sewer plague: hit dice heal half the normal number (afflictions.ts).
  // Durable floors each die at twice the Constitution modifier; Stalwart
  // adds it (src/lib/srd/feat-combat.ts).
  const rolled = hitDiceHealing(outcome, conMod, (input.songDie ? 1 : 0) + (input.chefDie ? 1 : 0));
  const floored = hitDieHealingFloor(sheet, conMod);
  const withFeat = (floored ? Math.max(rolled, count * floored.floor) + count * floored.extra : rolled) + count * (sanctuary?.bonus ?? 0);
  const healed = Math.floor(withFeat * hitDiceHealingFactor(sheet));
  // Pale Tincture's damage is beyond what hit dice heal (afflictions.ts).
  const ceiling = healCeiling(campaign.id, sheet);
  const math = healMath(Math.min(sheet.currentHp, ceiling), ceiling, healed);
  const patch = {
    currentHp: math.currentHp,
    hitDice: { ...sheet.hitDice, spent: sheet.hitDice.spent + count },
  };
  const updated = patchSheet(sheet.id, patch);
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId: input.turnId,
    ...(input.requestedBy === "player" ? { actor: "player" } : {}),
    kind: "rest_short",
    delta: patch,
    reason: input.reason,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return {
    name: sheet.name,
    diceSpent: count,
    healed: math.currentHp - sheet.currentHp,
    hp: `${math.currentHp}/${ceiling}`,
    rollId: roll.id,
  };
}

// Whether a player at the table chooses this character's hit dice: its owner
// is connected to the campaign right now. The server spends for anyone else.
export function playerChoosesHitDice(campaignId: string, sheet: Pick<CharacterSheet, "userId">): boolean {
  return Boolean(sheet.userId) && onlineUserIds(campaignId).includes(sheet.userId);
}

// The best Song of Rest die anyone conscious in the party brings. Not a
// limited resource: it applies at every short rest, so there is no counter
// to spend, and one die goes to each creature that spent a Hit Die.
// Chef's meal: a cook in the party who is up to cooking (src/lib/srd/
// feat-combat.ts). The die every creature spending a Hit Die adds.
export function partyChefDie(sheets: Array<Pick<CharacterSheet, "id">>): string | null {
  for (const stale of sheets) {
    const sheet = getSheetById(stale.id);
    if (!sheet || sheet.currentHp <= 0 || sheet.deathSaves?.dead) {
      continue;
    }
    const die = chefRestDie(sheet);
    if (die) {
      return die;
    }
  }
  return null;
}

export function partySongOfRestDie(sheets: Array<Pick<CharacterSheet, "id">>): string | null {
  let best: string | null = null;
  for (const stale of sheets) {
    const sheet = getSheetById(stale.id);
    if (!sheet || sheet.currentHp <= 0 || sheet.deathSaves?.dead) {
      continue;
    }
    const die = songOfRestDieFor(sheet);
    if (die && (!best || Number(die.slice(1)) > Number(best.slice(1)))) {
      best = die;
    }
  }
  return best;
}
