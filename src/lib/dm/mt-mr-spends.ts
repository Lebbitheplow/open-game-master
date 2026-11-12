// What a monk's or a rogue's subclass spend does once it is paid for (wave 2,
// part mr): the "mr" kind of authored-effects-types.ts SpendDoes, by id.
// authored-spends.ts has checked the gate, the need, the pool and the turn;
// each resolver here refuses before it writes, as every resolver does.

import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { SNEAK_HIT, WEAPON_HIT } from "@/lib/dm/action-budget";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { bindsWorthResisting } from "@/lib/dm/legendary-logic";
import { computeSheetDerived } from "@/lib/srd";
import { damageDice, damageEnemy, enemyCondition, targetEnemy, type SpendContext } from "@/lib/dm/authored-spend-effects";
import { withinFeet } from "@/lib/dm/authored-saves";
import { removeConditionInstances, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { brightSquare, shadowLightProblem } from "@/lib/dm/one-with-shadows";
import { BLADE_AT, FLURRY_HEALED, holdsRow } from "@/lib/dm/mt-mr-turn";
import { destroyTrinket } from "@/lib/dm/mt-mr-trinkets";
import { aspectOfTheWyrm } from "@/lib/dm/mt-mr-dragon";
import { psionicEnergyDie } from "@/lib/dm/mt-mr-offers-logic";
import { canRegain, regainHitPoints } from "@/lib/dm/regain";
import { rollCard } from "@/lib/dm/roll-card";
import { diceFor, rollOwnDice } from "@/lib/dm/character-roll";
import { creditFeatureTeleport } from "@/lib/dm/feature-teleport";
import type { ToolError } from "@/lib/dm/tool-errors";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { martialArtsDie } from "@/lib/srd/feature-effects";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { kenseiHeld } from "@/lib/srd/mt-mr-kensei";

type Resolution = ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> };
type MrDoes = Extract<SpendDoes, { kind: "mr" }>;

// The conditions Physician's Touch ends, the worst first: one named in the
// call's variant, else the first of these the creature carries.
const PHYSICIANS_ENDS = ["paralyzed", "stunned", "blinded", "poisoned", "deafened"];

// "Hand of Healing also ends one condition" (Physician's Touch).
function physiciansTouch(ctx: SpendContext, ally: CharacterSheet): string | null {
  if (!holdsRow(ctx.sheet, "monk::Physician's Touch")) {
    return null;
  }
  const fresh = getSheetById(ally.id) ?? ally;
  const asked = textKey(ctx.args.variant ?? "");
  const carried = (name: string) => fresh.conditions.find((entry) => isConditionNamed(entry, name));
  const ends = (PHYSICIANS_ENDS.includes(asked) ? carried(asked) : null) ?? PHYSICIANS_ENDS.map(carried).find(Boolean);
  if (!ends) {
    return null;
  }
  const cleared = removeConditions(fresh.conditions, fresh.conditionMeta as ConditionMetaMap, [ends]);
  const updated = patchSheet(fresh.id, { conditions: cleared.conditions, conditionMeta: cleared.meta as CharacterSheet["conditionMeta"] });
  if (updated) {
    publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
  }
  return `Physician's Touch: ${fresh.name} is no longer ${ends}.`;
}

// Hand of Healing: "heal a creature within 5 feet for your martial arts die
// plus your Wisdom modifier, or replace one Flurry of Blows attack with it".
// `flurry`: the form that gives up a Flurry of Blows strike, with no action
// and no ki (one strike of a flurry; every strike from Flurry of Healing and
// Harm).
function handOfHealing(ctx: SpendContext, flurry: boolean, reachFt: number): Resolution {
  const { campaign, sheet } = ctx;
  const name = ctx.spend.name;
  const ally = ctx.args.targetCharacterId ? getSheetById(ctx.args.targetCharacterId) : sheet;
  if (!ally || ally.campaignId !== campaign.id || ally.deathSaves?.dead) {
    return { error: `${name} heals a living creature at the table: pass targetCharacterId. Nothing was spent.`, retry: true };
  }
  const encounter = getActiveEncounter(campaign.id);
  // The touch: an ally 20 feet off was healed before.
  if (encounter && ally.id !== sheet.id && !withinFeet(encounter.id, sheet.id, ally.id, reachFt)) {
    return { error: `${ally.name} is beyond ${reachFt} feet of ${sheet.name}; ${name} is a touch. Nothing was spent.`, refused: "rules" };
  }
  if (!canRegain(ally)) {
    return { error: `${ally.name} cannot regain hit points right now, so ${name} would heal nothing. Nothing was spent.`, refused: "rules" };
  }
  const budget = flurry && encounter ? budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions)) : null;
  if (flurry) {
    if (!encounter || !budget || (budget.flurryStrikes ?? 0) < 1) {
      return { error: `${name} takes the place of a Flurry of Blows strike, and ${sheet.name} has none paid for and unmade: use_resource Ki with variant "flurry of blows" after the Attack action first. Nothing was spent.`, refused: "rules" };
    }
    if (!holdsRow(sheet, "monk::Flurry of Healing and Harm") && budget.oncePerTurn.includes(FLURRY_HEALED)) {
      return { error: `${name} takes the place of one strike of a Flurry of Blows, and ${sheet.name} has given one up to it already. Nothing was spent.`, refused: "rules" };
    }
  }
  const dice = `1${martialArtsDie(ctx.held.level)}+${ctx.mods.wis ?? 0}`.replace("+-", "-");
  // The monk's own dice (character-roll.ts rollOwnDice), whoever is healed.
  const rolled = rollOwnDice(campaign, sheet, diceFor(`${name}: healing`, sheet, ally), dice, { turn: ctx.turn }).total;
  const gained = regainHitPoints(campaign, ctx.turnId, ally, rolled, `${name} (${sheet.name})`);
  const ended = physiciansTouch(ctx, ally);
  if (flurry && encounter && budget) {
    storeBudget(encounter, { ...budget, flurryStrikes: (budget.flurryStrikes ?? 1) - 1, oncePerTurn: [...budget.oncePerTurn, FLURRY_HEALED] });
  }
  return {
    result: {
      healed: `${ally.name} regains ${gained} hit points (${rolled} rolled).`,
      ...(ended ? { ended } : {}),
      ...(flurry && budget ? { flurry: `One Flurry of Blows strike given up for it (${(budget.flurryStrikes ?? 1) - 1} left).` } : {}),
    },
  };
}

// The creature a spend that rides a hit lands on: the one named, which a hit
// of this turn must have struck.
function struckEnemy(ctx: SpendContext) {
  const enemy = targetEnemy(ctx);
  if ("error" in enemy) {
    return enemy;
  }
  if (ctx.marks && !ctx.marks.includes(`${WEAPON_HIT}${enemy.id}`)) {
    return { error: `${ctx.spend.name} rides a hit, and ${enemy.displayName} is not a creature ${ctx.sheet.name} has hit this turn. Nothing was spent.`, refused: "rules" } as ToolError;
  }
  return enemy;
}

// Hand of Harm: the martial arts die plus Wisdom in necrotic on the creature
// an unarmed strike hit; with Physician's Touch it "can poison the target
// until the end of your next turn" (variant "no poison" leaves that out).
function handOfHarm(ctx: SpendContext): Resolution {
  const enemy = struckEnemy(ctx);
  if ("error" in enemy) {
    return enemy;
  }
  const dice = `1${martialArtsDie(ctx.held.level)}+${ctx.mods.wis ?? 0}`.replace("+-", "-");
  const rolled = damageDice(ctx, enemy, dice);
  const dealt = damageEnemy(ctx, enemy, rolled, "necrotic");
  const poisons = holdsRow(ctx.sheet, "monk::Physician's Touch") && textKey(ctx.args.variant ?? "") !== "no poison";
  const poisoned = poisons && getActiveEncounter(ctx.campaign.id) ? enemyCondition(ctx, enemy, "poisoned", { untilTurnEndOf: ctx.sheet.id }) : null;
  return {
    result: {
      rolled: `${dice}: ${rolled} necrotic`,
      ...dealt,
      ...(poisoned === null ? {} : { poisoned: poisoned ? `Physician's Touch: ${enemy.displayName} is poisoned until the end of ${ctx.sheet.name}'s next turn.` : `${enemy.displayName} cannot be poisoned.` }),
    },
  };
}

// One with the Blade's Deft Strike: "1 ki adds your martial arts die to a
// hit's damage once per turn", a hit with a kensei weapon, of its type.
function deftStrike(ctx: SpendContext): Resolution {
  const held = kenseiHeld(ctx.sheet);
  if (!held.length) {
    return { error: `${ctx.spend.name} rides a hit with a kensei weapon, and ${ctx.sheet.name} holds none of the kensei weapons they chose. Nothing was spent.`, refused: "rules" };
  }
  const enemy = struckEnemy(ctx);
  if ("error" in enemy) {
    return enemy;
  }
  const dice = `1${martialArtsDie(ctx.held.level)}`;
  const rolled = damageDice(ctx, enemy, dice);
  return { result: { rolled: `${dice}: ${rolled}`, ...damageEnemy(ctx, enemy, rolled, held[0].damageType) } };
}

export const CLOAK_OF_SHADOWS = "Cloak of Shadows";

// Cloak of Shadows: "become invisible in dim light or darkness until you
// attack, cast, or step into light". The light is the spend's need; an attack
// or a spell ends any invisibility but Greater Invisibility's
// (attack-marks.ts); stepping into light is cloakIntoLight below. No count of
// rounds: the instance carries the feature as its source.
function cloakOfShadows(ctx: SpendContext): Resolution {
  const { sheet } = ctx;
  const meta = { ...(sheet.conditionMeta as ConditionMetaMap), invisible: { source: CLOAK_OF_SHADOWS } };
  return {
    patch: {
      conditions: sheet.conditions.some((entry) => isConditionNamed(entry, "invisible")) ? sheet.conditions : [...sheet.conditions, "invisible"],
      conditionMeta: meta as CharacterSheet["conditionMeta"],
    },
    result: { applied: `${sheet.name} is invisible until they attack, cast a spell or step into bright light.` },
  };
}

// A monk under Cloak of Shadows who has moved onto a bright square is seen
// again. Called where a character's token lands (the move route and
// token-rules.ts), beside One with Shadows' own ending.
export function cloakIntoLight(campaignId: string, sheetId: string): string | null {
  const sheet = getSheetById(sheetId);
  const held = sheet?.conditions.find((entry) => isConditionNamed(entry, "invisible"));
  if (!sheet || !held || !shadowLightProblem(campaignId, sheet)) {
    return null;
  }
  const cleared = removeConditionInstances(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, held, (entry) => textKey(entry.source ?? "") === textKey(CLOAK_OF_SHADOWS));
  if (!cleared.removed) {
    return null;
  }
  const updated = patchSheet(sheetId, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
  return `${sheet.name} steps into the light, and Cloak of Shadows' invisibility ends.`;
}

// Where a feature's teleport lands (move_token with the feature as its
// spell): Shadow Step goes "between two patches of dim light or darkness",
// so a bright square is refused before the step is taken.
export function featureLandingRefusal(campaignId: string, sheet: Pick<CharacterSheet, "id" | "name">, feature: string, at: { x: number; y: number }): ToolError | null {
  if (textKey(feature) !== "shadow step" || !brightSquare(campaignId, sheet, at)) {
    return null;
  }
  return { error: `(${at.x},${at.y}) is in bright light, and Shadow Step lands only in dim light or darkness. Pick a square in shadow.`, retry: true };
}

// "As an action you can destroy one to ask its spirit a question" (Tokens of
// the Departed): the trinket goes, and the answer is the GM's to give.
function questionSpirit(ctx: SpendContext): Resolution {
  const left = destroyTrinket(ctx.campaign, ctx.sheet.id);
  if (left === null) {
    return { error: `${ctx.sheet.name} carries no soul trinket to destroy. Nothing was spent.`, refused: "rules" };
  }
  return { result: { applied: `${ctx.sheet.name} destroys a soul trinket (${left} left) and asks its spirit one question: it appears and answers in a language it knew, briefly or cryptically, with what it knew in life, then is gone.` } };
}


// Soul Blades' Psychic Teleportation: "throws a blade to teleport yourself up
// to 10 times your die roll in feet". The die is rolled here and the step is
// credited for move_token (feature-teleport.ts), as Shadow Step's is.
function psychicTeleport(ctx: SpendContext): Resolution {
  const die = `1${psionicEnergyDie(ctx.held.level)}`;
  const rolled = rollCard(ctx.campaign, ctx.turn, ctx.sheet.id, "custom", `${ctx.spend.name}: distance`, die, null).total;
  const feet = rolled * 10;
  creditFeatureTeleport(ctx.sheet.id, ctx.spend.name, feet);
  return {
    result: {
      rolled: `${die}: ${rolled}`,
      teleport: `${ctx.sheet.name} throws a psychic blade and may teleport up to ${feet} feet to an unoccupied space they can see: if a battle map is live, move their token with move_token, teleport true, spell "${ctx.spend.name}" and casterCharacterId ${ctx.sheet.id}.`,
    },
  };
}

// Rend Mind: "a sneak attack with Psychic Blades can stun a creature for a
// minute on a failed Wisdom save". It answers the turn's Sneak Attack on the
// creature named, made with a psychic blade; the DC is 8 + proficiency +
// Dexterity, as the published feature's.
function rendMind(ctx: SpendContext): Resolution {
  const enemy = targetEnemy(ctx);
  if ("error" in enemy) {
    return enemy;
  }
  const marks = ctx.marks ?? [];
  if (!marks.includes(`${SNEAK_HIT}${enemy.id}`) || !marks.includes(`${BLADE_AT}${enemy.id}`)) {
    return { error: `${ctx.spend.name} answers a Sneak Attack made with a psychic blade, and ${ctx.sheet.name} has landed none on ${enemy.displayName} this turn: pc_attack with weapon "psychic blade" first. Nothing was spent.`, refused: "rules" };
  }
  const derived = computeSheetDerived(ctx.sheet);
  const dc = 8 + derived.proficiencyBonus + derived.abilityMods.dex;
  const save = rollEnemySave(ctx.campaign.id, enemy, "wis", dc, {
    resist: bindsWorthResisting(["stunned"]),
    against: "stunned",
    origin: { ref: ctx.sheet.id },
    record: { turn: ctx.turn ?? undefined, detail: `${enemy.displayName}: WIS save against ${ctx.spend.name}` },
  });
  if (save.success) {
    return { result: { save: `${enemy.displayName} resists (WIS ${save.total} vs DC ${dc}).` } };
  }
  const landed = enemyCondition(ctx, enemy, "stunned", { rounds: 10 });
  return { result: { save: `WIS ${save.total} vs DC ${dc}: failed.`, applied: landed ? `${enemy.displayName} is stunned for a minute.` : `${enemy.displayName} cannot be stunned.` } };
}

// Wings Unfurled: "a flying speed equal to your walking speed until the end
// of the turn". The condition is the one the board reads for manifested
// wings (battlemap/types.ts), and it goes as this turn ends: turnBegun marks
// the turn it waits for as the one under way (turn-end.ts).
function wingsUnfurled(ctx: SpendContext): Resolution {
  const { sheet } = ctx;
  const name = "wings unfurled";
  return {
    patch: {
      conditions: [...sheet.conditions.filter((entry) => !isConditionNamed(entry, name)), name],
      conditionMeta: { ...sheet.conditionMeta, [name]: { untilTurnEndOf: sheet.id, turnBegun: true } },
    },
    result: { applied: `${sheet.name} flies at their walking speed until the end of this turn; aloft when it ends, they fall.` },
  };
}

export function mrSpend(ctx: SpendContext, does: MrDoes): Resolution {
  switch (does.id) {
    case "wyrm_frighten":
      return aspectOfTheWyrm(ctx, false);
    case "wyrm_ward":
      return aspectOfTheWyrm(ctx, true);
    case "wings_unfurled":
      return wingsUnfurled(ctx);
    case "rend_mind":
      return rendMind(ctx);
    case "psychic_teleport":
      return psychicTeleport(ctx);
    case "question_spirit":
      return questionSpirit(ctx);
    case "cloak_of_shadows":
      return cloakOfShadows(ctx);
    case "hand_of_healing":
      return handOfHealing(ctx, false, does.rangeFt ?? 5);
    case "flurry_healing":
      return handOfHealing(ctx, true, does.rangeFt ?? 5);
    case "hand_of_harm":
      return handOfHarm(ctx);
    case "deft_strike":
      return deftStrike(ctx);
  }
}
