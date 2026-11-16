import { z } from "zod";
import { petFeetTo, petReachProblem } from "@/lib/dm/pet-place";
import { recordTrigger } from "@/lib/dm/last-save";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertRoll } from "@/lib/db/rolls";
import { rollAgainst } from "@/lib/roll-labels";
import type { DmTurn } from "@/lib/db/dm-turns";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { activeAuthored } from "@/lib/srd/authored-effects";
import { enemyAcWithEffects } from "@/lib/dm/ac-effects";
import { petAttackCost } from "@/lib/dm/pet-attack-cost";
import { resolveSheetRef, unknownSheetRef } from "@/lib/dm/rolls";
import type { CharacterSheet, SheetPet } from "@/lib/schemas/sheet";
import { attackDamage, attackSummary } from "@/lib/srd/creature-attacks";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { naturalAttackProfile, pickNaturalAttack } from "@/lib/dm/natural-attack";
import { landNaturalOnHit } from "@/lib/dm/natural-onhit";
import { partyChargeAfterHit, partyChargeFor, petPounceCost } from "@/lib/dm/party-charge";
import { petBlock, petPounceKey, pounceOpen, withChargeAttack } from "@/lib/dm/party-charge-logic";
import { landBlow } from "@/lib/dm/pc-attack-damage";
import { badArguments, noneNamed, toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { swallowCoverError } from "@/lib/dm/swallow";
import { buildPet, defenseWords, DRAKE_ESSENCES, petCreatureType } from "@/lib/dm/pet-build";
import { attackContext, incapacitatedBy, mergeAdvantage, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { charmedBy } from "@/lib/dm/enemy-profile";
import { rollPetSave } from "@/lib/dm/pet-save-roll";
import { settleOnDamage } from "@/lib/dm/spell-effects";
import { spellTurnHold } from "@/lib/srd/condition-effect-queries";
import { damageAdjust } from "@/lib/dm/damage-logic";
import { findTableMonster } from "@/lib/bestiary/homebrew-monsters";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { resolveMonster } from "@/lib/bestiary";
import { commandPet, drakeSummonCost, essenceChoice } from "@/lib/dm/pet-command";
import { petResistLine, petUnderwaterSwing } from "@/lib/dm/pet-underwater";
import { petAttackBoard } from "@/lib/dm/pet-attack-board";
import { fallFromPet, ridesPet } from "@/lib/dm/pet-mount";

// The creatures bound to a character: familiars (Find Familiar, Pact of the
// Chain), the Beast Master's companion, the Drakewarden's drake, and story
// pets. Before this engine a familiar was pure narration: no stat block,
// nothing for an enemy to hit, no rules on who may even have one.
//
// Pets live on the owner's sheet (schemas/sheet.ts petSchema), so they need
// no user row and travel with the character. summon_pet validates the
// source feature and loads the stat block; pet_attack resolves a natural
// attack against an enemy with real dice; damage_pet (apply_damage with a
// petName, issue #471) routes an enemy's hit into the pet's own pool (a familiar at 0 HP vanishes, a companion drops).

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const PET_TOOL_NAMES = ["summon_pet", "pet_attack", "damage_pet", "dismiss_pet"] as const;

export const petTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "summon_pet",
      description:
        "Summon or bond a creature a feature grants: kind familiar (Find Familiar), beast_companion (Beast Master), drake (Drakewarden, its essence) or other (a story pet: a stat block's name, or hp and ac). A pet has no token: it stands with its owner, so its reach is measured from the owner's square. A story pet with no stat block cannot attack. A familiar takes a Find Familiar form (an owl, a cat, a raven; an imp, quasit, pseudodragon or sprite with Pact of the Chain); a Beast Master companion is a Medium or smaller beast of CR 1/4 or lower. A story pet named for an SRD or workshop creature (mastiff, wolf) takes that stat block, and fights with it when its CR is within what a druid of the owner's level could become. The server checks the feature and attaches the pet to their sheet. Call it BEFORE narrating the summon.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          kind: { type: "string", enum: ["familiar", "beast_companion", "drake", "other"] },
          form: { type: "string", description: "The creature ('owl', 'wolf', 'drake'); for a story pet its stat block's name when it has one." },
          name: { type: "string", description: "The pet's given name. Default: the form." },
          creatureType: {
            type: "string",
            enum: ["celestial", "fey", "fiend"],
            description: "kind=familiar only, instead of beast. Default: celestial.",
          },
          essence: {
            type: "string",
            enum: [...DRAKE_ESSENCES],
            description: "kind=drake only: its Draconic Essence, the damage type it is immune to, as the player chooses.",
          },
          hp: { type: "integer", minimum: 1, maximum: 300, description: "kind=other with no stat block only, and required for it: the pet's HP." },
          ac: { type: "integer", minimum: 1, maximum: 30, description: "kind=other with no stat block only, and required for it: the pet's armor class." },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["characterId", "kind", "form"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pet_attack",
      description:
        "Resolve a character's pet attacking an enemy, on the owner's turn in a fight; the server rolls it with the pet's real numbers. It checks the pet may attack (plain familiars cannot) and charges the owner what the pet's kind costs; a refusal spends nothing.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "The owner: exact characterId from GAME STATE." },
          petName: { type: "string", description: "Which pet, when they have several." },
          targetEnemyId: { type: "string", description: "The enemy being attacked: exact enemyId from GAME STATE." },
          attack: { type: "string", description: "Named attack when the pet has several." },
          charged: { type: "boolean", description: "No board: it ran straight at the target first (Charge, Pounce)." },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["characterId", "targetEnemyId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dismiss_pet",
      description:
        "Remove a pet from its owner's sheet when it is dismissed, sent away, or dies in the fiction. Call it when the story ends the bond.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "The owner: exact characterId from GAME STATE." },
          petName: { type: "string", description: "Which pet, when they have several." },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["characterId"],
      },
    },
  },
];

const summonSchema = z.object({
  characterId: z.string(),
  kind: z.enum(["familiar", "beast_companion", "drake", "other"]),
  form: z.string().trim().min(1).max(60),
  name: z.string().trim().max(60).optional(),
  creatureType: z.enum(["celestial", "fey", "fiend"]).optional(),
  essence: z.string().trim().max(20).optional(),
  hp: z.coerce.number().int().min(1).max(300).optional(),
  ac: z.coerce.number().int().min(1).max(30).optional(),
  // kind=drake: the spell slot that pays once the free summoning is spent.
  level: z.coerce.number().int().min(1).max(9).optional(),
  reason: z.string().optional(),
});

const petAttackSchema = z.object({
  characterId: z.string(),
  petName: z.string().trim().max(60).optional(),
  targetEnemyId: z.string(),
  attack: z.string().trim().max(40).optional(),
  // A fight with no board: the pet ran straight at the target first, for its
  // Charge or Pounce (party-charge.ts). On a board the squares decide.
  charged: z.coerce.boolean().optional(),
  reason: z.string().optional(),
});

const damagePetSchema = z.object({
  characterId: z.string(),
  petName: z.string().trim().max(60).optional(),
  amount: z.coerce.number().int().min(0).max(300),
  // What the damage is, which the pet's defenses meet (issue 520): an imp
  // shrugs off fire, a fire drake its essence.
  type: z.string().trim().max(20).optional(),
  magical: z.boolean().optional(),
  reason: z.string().optional(),
});

const dismissSchema = z.object({
  characterId: z.string(),
  petName: z.string().trim().max(60).optional(),
  reason: z.string().optional(),
});

// A creature the call names that the sheet does not hold: the call's to fix,
// from the creatures they have.
export function noPet(sheet: CharacterSheet, petName?: string): ToolError {
  const held = sheet.pets.map((pet) => `${pet.name} (${pet.form})`);
  if (!petName && held.length > 1) {
    return { error: `${sheet.name} has several bound creatures; name one: ${held.join(", ")}.`, retry: true };
  }
  return {
    error: `${sheet.name} has no bound creature${petName ? ` called "${petName}"` : ""}.${
      held.length ? ` Their creatures: ${held.join(", ")}.` : " They have none."
    }`,
    retry: true,
  };
}

// The creature a call names, by its whole name or form; with no name, the
// only one there is. Never the nearest name, nor the first of several.
// A watch stop names the pet the same way (foresight-saves.ts).
export function findPet(sheet: CharacterSheet, petName?: string): SheetPet | null {
  const wanted = textKey(petName ?? "");
  if (!wanted) {
    return sheet.pets.length === 1 ? sheet.pets[0] : null;
  }
  return sheet.pets.find((pet) => textKey(pet.name) === wanted || textKey(pet.form) === wanted) ?? null;
}

function publishSheet(campaign: Campaign, sheetId: string) {
  const sheet = getSheetById(sheetId);
  if (sheet) {
    publishPersisted(campaign.id, "sheet_updated", { sheet });
  }
}

// The stat blocks a summon produces live in src/lib/dm/pet-build.ts.
export { buildPet };

export function handleSummonPet(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  let args: z.infer<typeof summonSchema>;
  try {
    args = summonSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: summon_pet needs characterId, kind, and form.", error, rawArguments);
  }
  const stale = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = stale ? (getSheetById(stale.id) ?? stale) : null;
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  if (sheet.pets.length >= 3) {
    return { error: `${sheet.name} already has ${sheet.pets.length} bound creatures (${sheet.pets.map((pet) => pet.name).join(", ")}); one is dismissed first. Ask the player which.`, retry: true };
  }
  // One creature per source: a second familiar replaces the first (5e: the
  // ritual re-shapes the same spirit), companions and drakes are unique. A
  // story pet may be a monster this table's DMs built in the workshop.
  const authors = spellAuthorsFor(campaign);
  const built = buildPet(sheet, args, {
    tableMonster: (name) => findTableMonster(authors, name),
    // A companion's skills come from its published block (pet-build.ts).
    blockSkills: (name) => resolveMonster(name, campaign.gameSettings)?.stats.skills ?? null,
  });
  if ("error" in built) {
    return built;
  }
  // Drake Companion's action and its once-a-long-rest or spell slot
  // (pet-command.ts drakeSummonCost), asked before anything is written.
  const cost = built.kind === "drake" ? drakeSummonCost(sheet, args.level, getActiveEncounter(campaign.id)) : null;
  if (cost && "error" in cost) {
    return cost;
  }
  const paid = cost ? cost.commit() : [];
  const fresh = getSheetById(sheet.id) ?? sheet;
  const remaining = fresh.pets.filter((pet) => pet.kind !== built.kind || built.kind === "other");
  const pets = [...remaining, built];
  // Bond of Fang and Scale: the ranger resists the essence summoned with.
  const features = built.kind === "drake" && built.immune ? essenceChoice(fresh, built.immune) : null;
  patchSheet(sheet.id, { pets, ...(features ? { features } : {}) });
  publishSheet(campaign, sheet.id);
  return {
    ok: true,
    ...(paid.length ? { cost: paid.join(" ") } : {}),
    pet: `${built.name} (${built.form}${built.creatureType ? `, a ${built.creatureType}` : ""}): ${built.hp} HP, AC ${built.ac}, speed ${built.speed} ft`,
    ...(built.attacks.length
      ? {
          attacks: built.attacks.map(attackSummary).join(", "),
        }
      : { attacks: "none: this creature cannot attack" }),
    ...(defenseWords(built) ? { defenses: defenseWords(built) } : {}),
    ...(built.notes ? { notes: built.notes } : {}),
  };
}

export function handlePetAttack(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  let args: z.infer<typeof petAttackSchema>;
  try {
    args = petAttackSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: pet_attack needs characterId and targetEnemyId.", error, rawArguments);
  }
  const stale = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = stale ? (getSheetById(stale.id) ?? stale) : null;
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  const pet = findPet(sheet, args.petName);
  if (!pet) {
    return noPet(sheet, args.petName);
  }
  if (pet.hp <= 0) {
    return { error: `${pet.name} is down; it cannot attack.`, refused: "rules" };
  }
  // SRD 5.1, Conditions: an incapacitated creature "can't take actions or
  // reactions" (paralyzed, stunned, unconscious, petrified are incapacitated
  // too). A familiar held by Hold Monster went on biting.
  const stopped = incapacitatedBy(pet.conditions ?? []);
  if (stopped) {
    return { error: `${pet.name} is ${stopped} and cannot attack. Nothing was spent.`, refused: "rules" };
  }
  // A turn's action lost (Stinking Cloud's retching, pet-zones.ts).
  const lost = spellTurnHold(pet.conditions ?? [], "attack");
  if (lost) {
    return { error: `${pet.name} is ${lost} and takes no action this turn. Nothing was spent.`, refused: "rules" };
  }
  if (!pet.attacks.length) {
    return {
      error:
        pet.kind === "familiar"
          ? // It told the model the familiar delivers touch spells, which the
            // engine never does: a familiar has no square on the board, and a
            // touch spell is measured from its caster (issue 659).
            `${pet.name} is an ordinary familiar and cannot attack (only Pact of the Chain forms fight). It can scout and lend its senses instead; the server measures a touch spell from its caster, not from the familiar.`
          : `${pet.name} has no attacks on record, so it cannot attack.`,
      refused: "rules",
    };
  }
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "pet_attack needs an active encounter and a target.", retry: true };
  }
  const enemy = resolveTargetFoe(encounter.campaignId, encounter, args.targetEnemyId);
  if (!enemy || enemy.status !== "alive") {
    return { error: "pet_attack needs a living targetEnemyId from GAME STATE.", retry: true };
  }
  // A creature inside a swallower is out of the pet's reach (swallow.ts).
  // The pet has no square of its own, so it strikes from outside.
  const inside = swallowCoverError(null, enemy.id);
  if (inside) {
    return inside;
  }
  // Commanding the pet is the owner's to do, on the owner's turn, and costs
  // what the feature says (src/lib/dm/pet-attack-cost.ts). A Pounce's bite at
  // the creature the pet's own charge left prone this turn is the pet's bonus
  // action instead, once (party-charge.ts).
  const turnNow = encounter.turnBudget?.ownerId === sheet.id ? encounter.turnBudget : null;
  const named = pickNaturalAttack(pet.attacks, args.attack);
  const pounce = named && !turnNow?.oncePerTurn.includes(petPounceKey(pet.name)) ? pounceOpen(turnNow, petBlock(pet), named.name, pet.name, enemy) : null;
  const charge = pounce ? petPounceCost(encounter, sheet.id, pet.name, pounce) : petAttackCost(sheet, pet, encounter);
  if ("error" in charge) {
    return toolError(charge);
  }
  const attack = pickNaturalAttack(pet.attacks, args.attack);
  if (!attack) {
    const names = pet.attacks.map((entry) => entry.name);
    return args.attack
      ? noneNamed(`${pet.name} has no attack called`, args.attack, names)
      : { error: `${pet.name} has several attacks; name one: ${names.join(", ")}.`, retry: true };
  }
  // The pet stands with its owner (pet-place.ts, ruling D2): its reach is
  // measured from the owner's square.
  const tooFar = petReachProblem(encounter.id, sheet, pet.name, attack, { id: enemy.id, name: enemy.displayName });
  if (tooFar) {
    return tooFar;
  }
  // SRD 5.1, Charmed: "can't attack the charmer".
  if (charmedBy(pet.conditions ?? [], (pet.conditionMeta ?? {}) as ConditionMetaMap, enemy.id)) {
    return { error: `${pet.name} is charmed by ${enemy.displayName} and cannot attack it. Nothing was spent.`, refused: "rules" };
  }
  if (attack.proneTargetsOnly && !enemy.conditions.includes("prone")) {
    return { error: `${pet.name}'s ${attack.name} strikes only a prone creature, and ${enemy.displayName} is not prone. Nothing was spent.`, refused: "rules" };
  }
  // The pet's Charge, Pounce or Trampling Charge after a run straight at the
  // target, its owner's walk (the pet stands with its owner): the extra dice
  // on the blow, the save once it lands (party-charge.ts).
  const run = pounce ? null : partyChargeFor({ encounter, budget: turnNow, block: petBlock(pet), attack: attack.name, who: pet.name, walkerId: sheet.id, enemyId: enemy.id, claimed: args.charged === true });
  const swung = run ? withChargeAttack(attack, run) : attack;

  // Both sides' conditions as they meet this attacker (SRD 5.1, Conditions),
  // read as every other attack reads them (condition-logic.ts
  // attackContext): a restrained, stunned or paralyzed target is struck with
  // advantage, a prone one with advantage within 5 feet, a dodging or
  // invisible one with disadvantage, a hit within 5 feet on a paralyzed or
  // unconscious one is a critical hit; one warded by Protection from Evil
  // and Good turns a fiend or fey familiar's strike, by the kind the caster
  // made it (pet-build.ts petCreatureType). Only the warding spells counted.
  const feetTo = petFeetTo(encounter.id, sheet, enemy.id);
  const ranged = Boolean(attack.range) && !(attack.thrown && feetTo !== null && feetTo <= (attack.reach ?? 5));
  // The light, its senses, the target's cover and the bow's range, read from
  // its owner's square as the hero's attack reads them (pet-attack-board.ts).
  const board = petAttackBoard({ campaign, encounterId: encounter.id, ownerId: sheet.id, pet, enemy, attack, ranged, feetTo });
  const incoming = attackContext({
    attackerConditions: pet.conditions ?? [],
    targetConditions: enemy.conditions,
    melee: !ranged,
    adjacent: feetTo === null ? !ranged : feetTo <= 5,
    requested: "none",
    attackerType: petCreatureType(pet),
    attackerSenses: board.attackerSenses,
    targetSeesAttacker: board.targetSeesAttacker,
  });
  incoming.notes.push(...board.notes);
  // Its owner's water is its own (pet-underwater.ts): a bite without a
  // swimming speed at disadvantage, a shot past normal range a miss.
  const water = petUnderwaterSwing(campaign, sheet.id, pet, { attack: attack.name, ranged, beyondNormal: ranged && feetTo !== null && feetTo > (attack.range ?? feetTo) });
  if (water?.note) {
    incoming.notes.push(water.note);
  }
  if (water?.misses) {
    const economy = charge.commit();
    commandPet(campaign, sheet.id, pet.name);
    return { ok: true, attack: `${pet.name}: ${attack.name}`, hit: false, missed: water.note, economy };
  }
  const advantage = mergeAdvantage([...incoming.sources, ...board.sources, ...(water?.disadvantage ? ["disadvantage" as const] : [])]);
  // Tagged as an ally's attack, so a foretold number a watch stop armed for
  // the pet lands on its d20 (foresight-saves.ts).
  const hitOutcome = rollExpression(d20Expression(attack.toHit, advantage), undefined, { purpose: { roller: "hero", kind: "attack", who: pet.name } });
  const hitRoll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "attack",
    detail: rollAgainst(attack.name, enemy.displayName),
    result: hitOutcome,
    attacker: { kind: "pet", id: sheet.id, name: pet.name },
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll: hitRoll,
    source: "digital",
  });
  turn.rollIds.push(hitRoll.id);

  const economy = charge.commit();
  // Commanded, the creature is not dodging this turn (pet-command.ts).
  commandPet(campaign, sheet.id, pet.name);

  // The enemy's real AC today: a spell or an effect on it counts, and its cover.
  const vsAc = enemyAcWithEffects(campaign.id, enemy) + board.cover;
  const hit = hitOutcome.crit !== "nat1" && (hitOutcome.crit === "nat20" || hitOutcome.total >= vsAc);
  const crit = hit && (hitOutcome.crit === "nat20" || incoming.autoCrit);
  if (!hit) {
    return {
      ok: true,
      attack: `${pet.name}: ${attack.name}`,
      rolled: hitOutcome.total,
      vsAc,
      hit: false,
      ...(incoming.notes.length ? { situation: incoming.notes.join("; ") } : {}),
      economy,
    };
  }
  // The hit's dice and any rider dice of another type; a critical doubles
  // the dice, never the flat bonus (SRD 5.1).
  const { expression } = attackDamage(swung);
  const variant = campaign.gameSettings.variantRules;
  const damageOutcome = rollExpression(
    crit ? critDamageExpression(expression, 0, { powerfulCritical: variant.powerfulCritical, multiplyNumeric: variant.criticalDamageMods }) : expression,
  );
  const damageRoll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "damage",
    detail: rollAgainst(`${attack.name}${crit ? " (CRIT)" : ""}`, enemy.displayName),
    result: damageOutcome,
    attacker: { kind: "pet", id: sheet.id, name: pet.name },
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll: damageRoll,
    source: "digital",
  });
  turn.rollIds.push(damageRoll.id);
  // Exceptional Training (Beast Master 7): the companion's attacks count as
  // magical against resistance.
  const magical = activeAuthored(sheet, "pet_magical").some(({ effect }) => effect.pets.includes(pet.kind));
  // Each damage type of the blow meets the creature's resistances on its own
  // (a flying snake's bite: 1 piercing and 3d4 poison).
  const profile = naturalAttackProfile(swung, { weapon: `${pet.name} ${attack.name}`, note: `${pet.name}'s own attack` });
  const applied = landBlow({
    campaign,
    turn,
    encounter,
    enemy,
    sheets,
    sheetsById,
    profile,
    typedRiders: profile.gearTyped ?? [],
    damageOutcome,
    dealt: Math.max(0, damageOutcome.total),
    crit,
    critExtraDice: 0,
    magical,
  });
  publishEncounter(campaign.id);
  // What the hit carries besides its damage: an imp's poison, a quasit's.
  const onHit = attack.onHit && !applied.dead
    ? landNaturalOnHit(campaign, {
        turn,
        attacker: { kind: "pet", sheetId: sheet.id, name: pet.name },
        holderId: null,
        attack: `${pet.name}'s ${attack.name}`,
        enemyId: enemy.id,
        onHit: attack.onHit,
      })
    : [];
  // The charge is spent on this hit (a kill too); its save, push and pounce.
  const charged = run
    ? partyChargeAfterHit(campaign, turn, { attacker: { kind: "pet", sheetId: sheet.id, name: pet.name }, ownerId: sheet.id, pusherId: sheet.id, who: pet.name, enemyId: enemy.id, trait: run, bonusCall: "pet_attack attack" })
    : [];
  return {
    ok: true,
    attack: `${pet.name}: ${attack.name}`,
    rolled: hitOutcome.total,
    vsAc,
    hit: true,
    ...(crit ? { crit: true } : {}),
    ...applied,
    ...(onHit.length ? { onHit } : {}),
    ...(charged.length ? { charge: charged } : {}),
    economy,
  };
}

export function handleDamagePet(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  let args: z.infer<typeof damagePetSchema>;
  try {
    args = damagePetSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: apply_damage on a pet needs the owner's characterId and an amount.", error, rawArguments);
  }
  const stale = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = stale ? (getSheetById(stale.id) ?? stale) : null;
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  const pet = findPet(sheet, args.petName);
  if (!pet) {
    return noPet(sheet, args.petName);
  }
  return hurtPet(campaign, sheet, pet, { parts: [{ amount: args.amount, type: args.type }], magical: args.magical === true });
}

// Damage landing on a pet, by type: apply_damage with a petName, and what a
// pet's own save leaves of an area or a spell (src/lib/dm/pet-save.ts), so
// both meet the same defenses and the same end at 0 hit points.
export function hurtPet(
  campaign: Campaign,
  owner: CharacterSheet,
  pet: SheetPet,
  input: { parts: Array<{ amount: number; type?: string }>; magical: boolean },
): Record<string, unknown> & { ok: true } {
  // The record as it stands now: an area lands on several pets of one owner,
  // and each write must keep the others.
  const sheet = getSheetById(owner.id) ?? owner;
  const at = sheet.pets.findIndex((entry) => entry.name === pet.name && entry.kind === pet.kind);
  const current = at >= 0 ? sheet.pets[at] : pet;
  // The damage meets the pet's own defenses, as a character's meets theirs:
  // an imp takes no fire, a drake none of its essence. Two types are two
  // shares, each meeting its own (Flame Strike's fire and radiant).
  const adjusted = input.parts.map((part) =>
    damageAdjust(part.amount, part.type, petResistLine(campaign.id, sheet.id, current), current.immune ?? "", current.vulnerable ?? "", { magical: input.magical }),
  );
  const dealt = adjusted.reduce((sum, entry) => sum + entry.amount, 0);
  const types = input.parts.map((part) => part.type?.trim() ?? "").filter(Boolean);
  const typed = types.length ? { type: types.join(" and ") } : {};
  const notes = adjusted.map((entry) => entry.note).filter(Boolean);
  const defended = notes.length ? { defenses: `${current.name} is ${notes.join("; ")}.` } : {};
  const hp = Math.max(0, current.hp - dealt);
  const others = sheet.pets.filter((_, index) => index !== at);
  // Drake Companion: it lasts "until it drops to 0 hit points": then it is
  // gone, until the ranger summons it again.
  if (hp <= 0 && current.kind === "drake") {
    // Its rider comes down with it (pet-mount.ts).
    const ridden = ridesPet(campaign.id, sheet.id, current);
    patchSheet(sheet.id, { pets: others });
    publishSheet(campaign, sheet.id);
    const fall = ridden ? fallFromPet(campaign, sheet.id) : null;
    return { ok: true, pet: current.name, damage: dealt, ...typed, ...defended, vanished: `${current.name} drops to 0 hit points and is gone. ${sheet.name} can summon it again (summon_pet).`, ...(fall ? { fall } : {}) };
  }
  if (hp <= 0 && current.kind === "familiar") {
    // A familiar at 0 HP vanishes; the spell brings it back later.
    patchSheet(sheet.id, { pets: others });
    publishSheet(campaign, sheet.id);
    return {
      ok: true,
      pet: current.name,
      damage: dealt,
      ...typed,
      ...defended,
      vanished: `${current.name} drops and dissolves into shimmering mist. ${sheet.name} can resummon it by casting Find Familiar again (10 gp of incense, one hour).`,
    };
  }
  // A hurt creature wakes from Sleep, and gets the save Hideous Laughter
  // gives when it takes damage: what the effect's instance says, read as a
  // character's is (spell-effects.ts settleOnDamage), the save its own.
  const settled = dealt > 0 && current.conditions?.length
    ? settleOnDamage(current.conditions, (current.conditionMeta ?? {}) as ConditionMetaMap, (entry, name) =>
        Boolean(entry.saveOnDamage) && rollPetSave(campaign, null, sheet, current, { ability: entry.saveOnDamage!.ability, dc: entry.saveOnDamage!.dc, magical: Boolean(entry.spell), source: name, advantage: entry.saveOnDamage!.advantage, detail: `${current.name}: ${entry.saveOnDamage!.ability.toUpperCase()} save to end ${name}, hurt` }).success)
    : null;
  const ended = settled?.changed ? (current.conditions ?? []).filter((name) => !settled.conditions.includes(name)) : [];
  const pets = sheet.pets.map((entry, index) => (index === at ? { ...entry, hp, ...(settled?.changed ? { conditions: settled.conditions, conditionMeta: settled.meta } : {}) } : entry));
  patchSheet(sheet.id, { pets });
  publishSheet(campaign, sheet.id);
  // Damage to a pet is the trigger its owner's reaction answers (a drake's
  // resistance, src/lib/dm/last-save.ts).
  if (dealt > 0) {
    recordTrigger(campaign.id, { kind: "pet_damage", characterId: sheet.id, forcer: { id: sheet.id, name: sheet.name }, petName: current.name, damage: { amount: dealt, type: types.join(" and ") } });
  }
  return {
    ok: true,
    pet: current.name,
    damage: dealt,
    ...typed,
    ...defended,
    hp: `${hp}/${current.maxHp}`,
    ...(hp <= 0 ? { down: `${current.name} falls unconscious at 0 HP.` } : {}),
    ...(ended.length ? { conditionEnded: `${current.name} is no longer ${ended.join(" or ")}.` } : {}),
  };
}

export function handleDismissPet(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  let args: z.infer<typeof dismissSchema>;
  try {
    args = dismissSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: dismiss_pet needs characterId.", error, rawArguments);
  }
  const stale = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = stale ? (getSheetById(stale.id) ?? stale) : null;
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  const pet = findPet(sheet, args.petName);
  if (!pet) {
    return noPet(sheet, args.petName);
  }
  patchSheet(sheet.id, { pets: sheet.pets.filter((entry) => entry !== pet) });
  publishSheet(campaign, sheet.id);
  return { ok: true, dismissed: `${pet.name} (${pet.form})` };
}
