import { getFoe } from "@/lib/dm/sheet-foe";
import { holdsFeature } from "@/lib/srd/feature-names";
import { distantStrikeSquare, distantStrikeTeleport } from "@/lib/dm/distant-strike";
import { endRageBound } from "@/lib/dm/rage-bound";
import { spendFeatureUse } from "@/lib/dm/attack-onhit";
import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, patchEnemyConditions, saveEncounter } from "@/lib/db/encounters";
import { endInvisibilityOnCast, writeMarks } from "@/lib/dm/attack-marks";
import { sanctuaryEndedByAttack } from "@/lib/dm/spell-defenses";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { markBondSpent } from "@/lib/dm/emboldening-bond";
import { BOND_SPEND } from "@/lib/dm/emboldening-bond-logic";
import { publishPersisted } from "@/lib/events";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { spendManeuverDie } from "@/lib/dm/maneuver-die";
import { strikeDamage } from "@/lib/dm/pc-attack-damage";
import { FRENZIED } from "@/lib/dm/frenzy";
import { ADVANTAGE_SOURCES, BONUS_ATTACKS, RECKLESS } from "@/lib/dm/pc-attack-options";
import { parkPcAttack, throwForChoice } from "@/lib/dm/pc-attack-parked";
import { markAffinityCast } from "@/lib/dm/affinity-cast";
import { planPcAttack, type AttackPlan } from "@/lib/dm/pc-attack-plan";
import { rollPcAttack, strikeToHit } from "@/lib/dm/pc-attack-resolve";
import { castAttackSpell } from "@/lib/dm/pc-attack-spell";
import { resolveSheetRef, unknownSheetRef } from "@/lib/dm/rolls";
import { markReactionUsed, storeBudget } from "@/lib/dm/turn-budget";
import { spendReadied } from "@/lib/dm/object-actions";
import { spendGiantKiller } from "@/lib/dm/reaction-attacks";
import { withAmmoCount } from "@/lib/srd/ammunition";
import { lineNamed } from "@/lib/srd/item-row";
import { returnsToHand, throwToGround } from "@/lib/dm/gear-ground";
import { OPEN_HAND_CHOICES } from "@/lib/dm/attack-choice-rules";
import { spendInspirationCounter } from "@/lib/dm/roll-riders";
import { spendLuckCounter } from "@/lib/srd/class-resources";
import { moteOf } from "@/lib/dm/authored-mote";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { badArguments, invalidArguments, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { attacksLeft } from "@/lib/dm/action-budget";
import { approachForAttack, withApproach } from "@/lib/dm/pc-attack-approach";
import { walkHeld } from "@/lib/dm/player-word";
import { commitConjuredStrike } from "@/lib/dm/conjured-strike";
import { swallowCover } from "@/lib/dm/swallow";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { fittedText } from "@/lib/dm/fitted-text";

// Re-exported for the callers that learned it here.
export { resolvePendingPcAttack } from "@/lib/dm/pc-attack-parked";

// The pc_attack engine: full server resolution of player attacks. The
// to-hit bonus and damage dice come from the sheet and the SRD weapon
// table, the roll is adjudicated against the enemy's real AC, and damage
// lands through applyEnemyDamage, so the model can no longer decide hits,
// invent modifiers, or forget to apply damage. Physical-dice players still
// roll their own d20 and damage via chained pending rolls. This module and
// the ones split from it must not import encounter-tools (the import points
// the other way); they do import mutations for the slot and die spends,
// exactly as cast-tools does, and mutations must never import back.
//
// One attack runs in three steps, each in its own module: every refusal,
// asked before anything is spent (pc-attack-plan.ts, with the profile in
// pc-attack-profile.ts, the damage dice in pc-attack-damage.ts, the roll's
// situation in pc-attack-situation.ts and the spell branch in
// pc-attack-spell.ts); the spends, here; and the roll, by the server
// (pc-attack-resolve.ts) or by the player's own dice (pc-attack-parked.ts).

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const pcAttackTool: ToolDef = {
  type: "function",
  function: {
    name: "pc_attack",
    description:
      "Resolve every attack a character's player declared, in one call: one entry in attacks per attack, in the order declared. That is the Attack action's swings with Extra Attack, the attacks of Action Surge's action, each Flurry of Blows strike, each Eldritch Blast beam or Scorching Ray ray, each creature of a Whirlwind Attack. The server rolls each from their sheet against the target's real AC, applies damage on a hit and reports every outcome to narrate; an entry it refuses costs nothing and leaves the rest resolved. Call it for EVERY weapon attack and attack-roll spell a player makes; never adjudicate one yourself. Off their own turn a character attacks only with a readied attack or spell, or Giant Killer's reaction (a Large or larger creature within 5 feet that just attacked them); the server checks which and spends the reaction.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "Exact characterId from GAME STATE." },
        attacks: {
          type: "array",
          minItems: 1,
          description: "The attacks, one entry each, in the order the player declared them.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              targetEnemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
              weapon: {
                type: "string",
                description:
                  "The weapon from their equipment, or 'unarmed strike' for a punch or kick in any language. Omit for their best carried weapon. Also a subclass feature's weapon: a raging Path of the Beast's 'bite', 'claws' or 'tail', a Soulknife's 'psychic blade' (feature 'Two-Weapon Fighting' for the second), a Sun Soul monk's 'radiant sun bolt'.",
              },
              approach: {
                type: "boolean",
                description:
                  "True when the player said their character moves to the target first and it is out of melee reach. Closing in or charging counts; holding still or staying put never does. The server walks them beside it out of their movement, drawing opportunity attacks, then attacks; too far to reach this turn, they close in as far as they can and nothing is attacked.",
              },
              spell: {
                type: "string",
                description:
                  "Attack-roll spell (Fire Bolt) instead of a weapon; the server rolls a known spell's dice.",
              },
              damage: {
                type: "string",
                description: "A homebrew spell attack only: its damage dice ('1d10', '4d6').",
              },
              damageType: { type: "string", description: "Spell attacks: the damage type. Grave Touched: necrotic." },
              advantage: {
                type: "string",
                enum: ["none", "advantage", "disadvantage"],
                description:
                  "Situational advantage or disadvantage from the fiction that the server cannot see. It counts only with advantageSource 'other' and advantageReason. The server already applies conditions, cover, light, range, Help, flanking, spells and every feature: never claim those.",
              },
              advantageSource: {
                type: "string",
                enum: [...ADVANTAGE_SOURCES],
                description:
                  "Where the advantage or disadvantage comes from; only 'other' counts.",
              },
              advantageReason: {
                type: "string",
                description: "The circumstance behind advantage, in a few words (\"the ogre is tangled in the curtain\").",
              },
              feature: {
                type: "string",
                description:
                  "The feature this attack is made with, by name; omit for a swing of the Attack action. Extra Attack's swings name none. 'Action Surge': an attack of the action it grants, spent on its first. 'Flurry of Blows': its two unarmed strikes, one entry each, the ki spent on the first. 'Martial Arts': the monk's bonus unarmed strike. 'Two-Weapon Fighting': the light off-hand weapon's bonus attack. 'Frenzy': a raging Berserker's bonus attack. 'Horde Breaker': once a turn, another creature within 5 feet of the first. 'Whirlwind Attack' or 'Volley': a Hunter's action, one entry per creature. Any other feat or feature granting a bonus weapon attack by its name (War Magic, Polearm Master, Crossbow Expert, Charger after a Dash). The server checks the feature and the turn and spends what it costs.",
              },
              stunningStrike: {
                type: "boolean",
                description:
                  "Monk 5+: Stunning Strike on this melee weapon hit. The server spends 1 ki on a hit and rolls the target's CON save.",
              },
              luck: {
                type: "boolean",
                description:
                  "Lucky: spend a luck point for an extra d20 on this roll, the best kept. The server checks the feat and spends the point.",
              },
              stunShot: {
                type: "boolean",
                description:
                  "Stunning Sniper feat: stun on a ranged critical hit instead of doubling the damage. The player's choice before the roll; the server checks the feat.",
              },
              charged: {
                type: "boolean",
                description:
                  "Charger: true when they moved 10+ feet straight at the target first, for +5 damage. It goes with feature 'Charger' after a Dash.",
              },
              powerAttack: {
                type: "boolean",
                description:
                  "The accuracy-for-damage trade: -5 to hit for +10 damage (Great Weapon Master, Sharpshooter). Great Weapon Master takes a heavy melee weapon, Sharpshooter a ranged one; Level Up's Powerful Attacker and Deadeye too. The player's choice before the roll; the server checks the feat and the weapon.",
              },
              reckless: {
                type: "boolean",
                description:
                  "Barbarian 2+: Reckless Attack, declared on the first attack of their turn. The server applies the advantage both ways.",
              },
              nonlethal: {
                type: "boolean",
                description:
                  "A melee attack meant to knock out: a creature it drops to 0 HP falls unconscious, not dying. It is out of the fight.",
              },
              useInspiration: {
                type: "boolean",
                description: "True when the player spends their character's Inspiration on this attack roll for advantage. Refused when they hold none.",
              },
              strokeOfLuck: {
                type: "boolean",
                description:
                  "Rogue 20: Stroke of Luck. A miss becomes a hit; the server spends the use only on a miss.",
              },
              openHand: {
                type: "string",
                enum: ["prone", "push", "no reactions"],
                description:
                  "Way of the Open Hand monk: Open Hand Technique on this Flurry of Blows strike. On a hit the server rolls the target's save or takes its reactions.",
              },
              hurlThroughHell: {
                type: "boolean",
                description:
                  "Fiend warlock 14: Hurl Through Hell on this hit; the server spends the use and resolves it.",
              },
              rapidStrike: {
                type: "boolean",
                description:
                  "Samurai 15: Rapid Strike, once a turn. The fighter forgoes this attack's advantage for one more attack of the Attack action; refused when the attack has no advantage.",
              },
              improvised: {
                type: "boolean",
                description:
                  "True when weapon names an object that is no weapon on their sheet (a chair, a bottle). It strikes as an improvised weapon.",
              },
              twoHanded: {
                type: "boolean",
                description:
                  "A versatile weapon swung in both hands (bigger damage die); not for an off-hand attack.",
              },
              smite: {
                type: "integer",
                minimum: 1,
                maximum: 9,
                description:
                  "Paladin Divine Smite: the spell slot level to burn on a hit. The server spends the slot and adds the radiant dice.",
              },
              level: {
                type: "integer",
                minimum: 1,
                maximum: 9,
                description:
                  "An attack-roll spell's slot level (Guiding Bolt, Scorching Ray); omit for the spell's own level. The server spends the slot. Each Eldritch Blast beam or Scorching Ray ray is its own entry in attacks, all from one casting.",
              },
              maneuver: {
                type: "string",
                description:
                  "A Battle Master maneuver riding this weapon attack, by name ('Trip Attack', 'Precision Attack'). Also 'Menacing Attack'. The server spends a Superiority Die and applies the die and the rider's save. Feinting Attack and Quick Toss take the bonus action; Grappling Strike keeps the die for the grapple after it. Parry, Riposte, Brace, Rally and Commander's Strike are not named here.",
              },
            },
            required: ["targetEnemyId"],
          },
        },
        endTurn: {
          type: "boolean",
          description:
            "True when the player ends their turn after these attacks. The server ends it once they resolve; never call end_turn too. A player says \"...then I end my turn\". The result names who acts next.",
        },
      },
      required: ["characterId", "attacks"],
    },
  },
};

export const pcAttackArgsSchema = z.object({
  characterId: z.string(),
  targetEnemyId: z.string(),
  weapon: z.string().max(80).optional(),
  // The move to the target the player declared (pc-attack-approach.ts).
  approach: z.coerce.boolean().optional(),
  // The player ends their turn with this attack (encounter-tools.ts).
  endTurn: z.coerce.boolean().optional(),
  spell: z.string().max(80).optional(),
  damage: z.string().max(30).optional(),
  damageType: z.string().max(30).optional(),
  advantage: z.enum(["none", "advantage", "disadvantage"]).optional(),
  improvised: z.coerce.boolean().optional(),
  twoHanded: z.coerce.boolean().optional(),
  offHand: z.coerce.boolean().optional(),
  smite: z.coerce.number().int().min(1).max(9).optional(),
  maneuver: z.string().max(60).optional(),
  advantageSource: z.enum(ADVANTAGE_SOURCES).optional(),
  advantageReason: fittedText(200).optional(),
  bonusAttack: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.enum(BONUS_ATTACKS).optional(),
  ),
  stunningStrike: z.coerce.boolean().optional(),
  powerAttack: z.coerce.boolean().optional(),
  // Stunning Sniper: a ranged critical hit stuns instead of doubling.
  stunShot: z.coerce.boolean().optional(),
  // Lucky: a luck point for an extra d20 on this attack roll, the best kept.
  luck: z.coerce.boolean().optional(),
  // Charger: they ran at least 10 feet straight at the target before the
  // bonus-action attack, for its +5.
  charged: z.coerce.boolean().optional(),
  reckless: z.coerce.boolean().optional(),
  nonlethal: z.coerce.boolean().optional(),
  hordeBreaker: z.coerce.boolean().optional(),
  useInspiration: z.coerce.boolean().optional(),
  strokeOfLuck: z.coerce.boolean().optional(),
  openHand: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.enum(OPEN_HAND_CHOICES).optional(),
  ),
  hurlThroughHell: z.coerce.boolean().optional(),
  rapidStrike: z.coerce.boolean().optional(),
  whirlwind: z.coerce.boolean().optional(),
  volley: z.coerce.boolean().optional(),
  // A part declared as a Flurry of Blows strike (pc-attack-parts.ts): it
  // takes a strike the ki paid for even while the Attack action has a swing
  // left, so the player's one swing and then a flurry is that.
  flurryStrike: z.coerce.boolean().optional(),
  // Attack-roll spells: the slot level cast from.
  level: z.coerce.number().int().min(1).max(9).optional(),
});

export type PcAttackArgs = z.infer<typeof pcAttackArgsSchema>;

// Sentinel the turn loop checks: a parked pc_attack pushes no tool result
// now; the resumed turn answers it with the adjudicated roll.
export const PC_ATTACK_PARKED = "_parked";
// A parked d20 of the pc_attack tool's own (`mayWait`), with the parked roll's
// id: the attacks declared after it wait behind it (pc-attack-parts.ts), on
// the player's physical dice as on the server's throw that waits for their
// after-the-roll choice (pc-attack-parked.ts throwForChoice). Each later part
// is then planned once the one before it has landed, reading the attacker and
// the creature as that left them (a hidden archer's hit gives them away
// before the sword swings), as the server's dice make the parts in turn.
export const PC_ATTACK_WAITS = "_waitsOnChoice";

export function handlePcAttack(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  realDiceUserIds: Set<string>,
  toolCallId: string | null,
  // The engine's own attacks (Confusion's random target): `anySide` lets the
  // target be an ally (pc-attack-gate.ts). `reactionAttack`: a reaction feature's
  // attack, paid for by its caller, which touches neither the turn nor a readied action.
  // `mayWait`: the pc_attack tool's own attacks, whose d20 may wait on the
  // player's choice (pc-attack-parked.ts throwForChoice); an attack the engine
  // makes inside another call never waits.
  engine: { anySide?: boolean; reactionAttack?: boolean; mayWait?: boolean } = {},
): ToolResult {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter. Call start_encounter first.", retry: true };
  }
  // A condition that rode a rage now over goes before the riders are read
  // (rage-bound.ts: Call the Hunt's d6).
  endRageBound(campaign.id);
  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments || "{}");
  } catch (error) {
    return badArguments("Invalid arguments: pc_attack needs characterId and targetEnemyId.", error, rawArguments);
  }
  const parsed = pcAttackArgsSchema.safeParse(raw);
  if (!parsed.success) {
    return invalidArguments("Invalid arguments: pc_attack needs characterId and targetEnemyId.", parsed.error, raw);
  }
  const args: PcAttackArgs = parsed.data;
  const staleSheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = staleSheet ? (getSheetById(staleSheet.id) ?? staleSheet) : null;
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  // Swallowed: from inside, only the creature that swallowed them
  // (src/lib/dm/swallow.ts).
  const inside = swallowCover({ kind: "sheet", id: sheet.id }, { kind: "enemy", id: resolveEnemyRef(encounter.id, args.targetEnemyId)?.id ?? args.targetEnemyId });
  if (inside) {
    return { error: `${inside} Nothing was spent.`, refused: "rules" };
  }

  // The move to the target the player declared, when the swing needs it
  // (src/lib/dm/pc-attack-approach.ts): the plan is asked first (it spends
  // nothing), and only a refusal for reach alone walks: asked again with
  // reach set aside, anything else that would refuse the swing (the turn's
  // attacks spent, a feature they lack) refuses it where they stand. The
  // attack is then planned from where it is made.
  if (args.approach) {
    const dry = planPcAttack({ campaign, turn, encounter, sheet, args, sheets, sheetsById, anySide: engine.anySide, reactionAttack: engine.reactionAttack });
    if ("refused" in dry) {
      const beside = planPcAttack({ campaign, turn, encounter, sheet, args, sheets, sheetsById, skipReach: true, anySide: engine.anySide, reactionAttack: engine.reactionAttack });
      if ("refused" in beside) {
        return beside.refused;
      }
      // Their player said they stay where they are: the swing from here was
      // refused for reach, and no walk is made to fix that (the walk drew
      // opportunity attacks for a fight its player never moved in).
      const held = walkHeld(campaign.id, turn, sheet, " Nothing was moved or attacked.");
      if (held) {
        return { ...held, error: `${dry.refused.error} ${held.error}` };
      }
      const approach = approachForAttack(campaign, encounter, sheet, args, dry.refused);
      if (!approach) {
        return dry.refused;
      }
      if ("refused" in approach) {
        return approach.refused;
      }
      const attack = attackFrom(campaign, turn, sheet, args, sheets, sheetsById, realDiceUserIds, toolCallId, engine);
      return attack[PC_ATTACK_PARKED] ? attack : withApproach(attack, approach.walked);
    }
  }
  // Distant Strike: a swing refused for reach alone, at a creature within
  // the ranger's 10-foot teleport of a square beside it, teleports them
  // there first (src/lib/dm/distant-strike.ts).
  if (!args.approach && !engine.reactionAttack && holdsFeature(sheet, "Distant Strike")) {
    const dry = planPcAttack({ campaign, turn, encounter, sheet, args, sheets, sheetsById, anySide: engine.anySide, reactionAttack: engine.reactionAttack });
    if ("refused" in dry) {
      const beside = planPcAttack({ campaign, turn, encounter, sheet, args, sheets, sheetsById, skipReach: true, anySide: engine.anySide, reactionAttack: engine.reactionAttack });
      const enemyId = resolveEnemyRef(encounter.id, args.targetEnemyId)?.id;
      const square = !("refused" in beside) && enemyId ? distantStrikeSquare(encounter.id, sheet.id, enemyId) : null;
      if (square) {
        const line = distantStrikeTeleport(campaign.id, encounter.id, sheet.id, square);
        const attack = attackFrom(campaign, turn, sheet, args, sheets, sheetsById, realDiceUserIds, toolCallId, engine);
        return attack[PC_ATTACK_PARKED] || !line ? attack : { ...attack, teleport: line };
      }
    }
  }
  return attackFrom(campaign, turn, sheet, args, sheets, sheetsById, realDiceUserIds, toolCallId, engine);
}

function attackFrom(
  campaign: Campaign,
  turn: DmTurn,
  sheet: CharacterSheet,
  args: PcAttackArgs,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  realDiceUserIds: Set<string>,
  toolCallId: string | null,
  engine: { anySide?: boolean; reactionAttack?: boolean; mayWait?: boolean } = {},
): ToolResult {
  // The walk may have changed the fight: read it again.
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter. Call start_encounter first.", retry: true };
  }
  // ---- refusals: everything that can stop this attack, before any spend ----
  // Asked in one place, in order, by planPcAttack (src/lib/dm/pc-attack-plan.ts).

  const plan = planPcAttack({ campaign, turn, encounter, sheet: getSheetById(sheet.id) ?? sheet, args, sheets, sheetsById, anySide: engine.anySide, reactionAttack: engine.reactionAttack });
  if ("refused" in plan) {
    return plan.refused;
  }

  // ---- spends: nothing below refuses the attack ----

  // A Creation bard's mote rides the inspiration die the roll spends
  // (src/lib/dm/authored-mote.ts); it bursts once the attack is rolled.
  const mote = moteOf(sheet, plan.attackRiders.spent);
  const countered = spendPcAttack(plan);
  // Counterspell stopped the spell after it was paid for: no roll follows,
  // parked or digital.
  if (countered) {
    return countered;
  }
  // An attack the rules make and miss (pc-attack-plan.ts missesBecause):
  // spent above, with no roll to make.
  if (plan.missesBecause) {
    return {
      attacker: sheet.name,
      weapon: plan.profile.weapon,
      target: plan.enemy.displayName,
      hit: false,
      ...(plan.budget && attacksLeft(plan.budget) > 0 && plan.budget.attacksMade > 0 ? { attacksRemaining: attacksLeft(plan.budget) } : {}),
      note: `${plan.missesBecause} The attack misses; narrate the miss.`,
    };
  }
  const strike = { ...strikeToHit(plan), ...strikeDamage(plan) };

  // Physical dice: park the to-hit roll for the player; the submit route
  // adjudicates it and, on a hit, parks the damage roll too.
  if (realDiceUserIds.has(sheet.userId)) {
    const parked = parkPcAttack(plan, strike, toolCallId, mote);
    return engine.mayWait ? { [PC_ATTACK_PARKED]: true, [PC_ATTACK_WAITS]: parked.id } : { [PC_ATTACK_PARKED]: true };
  }
  // The server's dice, for a player who may still change a miss once they see
  // it: the roll waits thrown, or resolves with that throw. Only on the
  // attacker's own turn (a turn budget): a readied strike or Giant Killer is
  // made on another's turn, and a roll waiting past it would never land.
  const choice = engine.mayWait && !engine.reactionAttack && plan.budget ? throwForChoice(plan, strike, toolCallId, mote) : null;
  if (choice && "parked" in choice) {
    return { [PC_ATTACK_PARKED]: true, [PC_ATTACK_WAITS]: choice.parked.id };
  }
  return rollPcAttack(plan, strike, mote, choice?.thrown ?? null);
}

// What the attack costs, paid now that nothing can refuse it: the turn
// budget, the cast or the reaction, the round from the quiver, Precision
// Attack's die, and the conditions this roll uses up. Returns the refusal of
// a spell Counterspell stopped (spent, and nothing else follows), or null.
// A weapon thrown is not spent but no longer held: a net, a dagger or a
// javelin thrown at range, a carried weapon thrown as an improvised one, a
// torch hurled; unless its own text brings it back (a Dwarven Thrower). A
// flask shatters instead (spent above), and a swing within reach keeps the
// weapon in hand.
function throwsAway(plan: AttackPlan): boolean {
  return (
    plan.special === "net" ||
    (plan.kind === "weapon" && plan.atRange && plan.profile.thrown && !plan.profile.gearWeapon?.spent && !plan.profile.returns && !returnsToHand(plan.profile.weapon))
  );
}

function spendPcAttack(plan: AttackPlan): ToolError | null {
  const { campaign, turn, encounter, sheet, budget, ammo, context } = plan;
  const thrownAway = throwsAway(plan);
  if (budget) {
    // The weapon thrown still counts as the one that was in the first hand
    // when two-weapon fighting asks for a second (attack-rules.ts
    // offHandProblem): a dagger thrown, then the off-hand dagger.
    if (thrownAway) {
      budget.thrownAway = (budget.thrownAway ?? 0) + 1;
    }
    storeBudget(encounter, budget);
  }
  // Spiritual Weapon's weapon flies to the square it strikes from (issue
  // 659), now that nothing can refuse the attack.
  if (plan.conjured) {
    context.notes.push(commitConjuredStrike(campaign, encounter, sheet, plan.conjured));
  }
  // A feature bonus attack's use, and the mark that opened it
  // (src/lib/dm/feature-bonus-attacks.ts).
  const featureBonus = plan.options.featureBonus;
  if (featureBonus?.counter && spendFeatureUse(campaign, sheet.id, featureBonus.counter, featureBonus.feature)) {
    context.notes.push(`${featureBonus.feature}: one use spent`);
  }
  if (featureBonus?.consume) {
    const now = getSheetById(sheet.id);
    if (now) {
      const cleared = removeConditions(now.conditions, now.conditionMeta, [featureBonus.consume]);
      patchSheet(now.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
    }
  }
  if (plan.castsSpell) {
    const countered = castAttackSpell(plan);
    if (countered) {
      return countered;
    }
    // A spell attack of a Draconic sorcerer's dragon's type, cast now that
    // nothing refused it, opens Elemental Affinity's resistance
    // (src/lib/dm/affinity-cast.ts). Not in the plan: a plan is a dry run
    // (an approach asks it first) and may still be refused after it.
    if (plan.kind === "spell") {
      markAffinityCast(campaign, sheet, plan.profile.damageType);
      // A two-type spell's second type rides as a typed rider.
      for (const rider of plan.profile.gearTyped ?? []) {
        markAffinityCast(campaign, sheet, rider.type);
      }
    }
  } else if (!budget) {
    markReactionUsed(encounter, sheet.id);
    // The readied action (or the Giant Killer answer) this attack is spends
    // with it.
    if (plan.extras.giantKiller) {
      spendGiantKiller(campaign.id, sheet.id, plan.enemy.id);
    } else if (!plan.extras.reactionAttack) {
      spendReadied(campaign, sheet.id);
    }
    // An attack made off their own turn shows on no turn budget, so a rage
    // it feeds is marked the way damage taken marks it.
    const ragingAs = sheet.conditions.find((entry) => entry.trim().toLowerCase() === "raging");
    if (ragingAs) {
      const meta = sheet.conditionMeta as ConditionMetaMap;
      patchSheet(sheet.id, {
        conditionMeta: { ...meta, [ragingAs]: { ...meta[ragingAs], stoked: true } },
      });
    }
    if (plan.extras.turnRiders) {
      storeBudget(encounter, plan.extras.turnRiders);
    }
    context.notes.push(
      plan.extras.reactionAttack
        ? `made as a reaction: ${sheet.name}'s reaction is spent until their next turn starts`
        : `made off their own turn: ${sheet.name}'s reaction is spent until their next turn starts`,
    );
  }
  // The weapon drawn for this attack is in hand from now on (issue #424).
  if (plan.drawn) {
    patchSheet(sheet.id, { equipment: plan.drawn.equipment });
    context.notes.push(plan.drawn.note);
  }
  if (ammo && ammo.ok) {
    const carried = plan.drawn?.equipment ?? sheet.equipment;
    const equipment = withAmmoCount(carried, ammo.index, ammo.remaining);
    patchSheet(sheet.id, { equipment });
    // Tallied under the line's name as it reads NOW: a quiver written
    // "Arrows (20)" is renamed by every shot, and the tally follows it so the
    // end of the fight finds the line it has to refill. The last one spent
    // takes the line off the sheet, so the tally keeps the line itself.
    const emptied = ammo.remaining <= 0;
    const before = `${sheet.id}|${ammo.name}`;
    const after = `${sheet.id}|${emptied ? ammo.name : (equipment[ammo.index]?.name ?? ammo.name)}`;
    const tally = { ...encounter.ammoSpent };
    const spentOf = (entry: (typeof tally)[string] | undefined) => (typeof entry === "object" ? entry.spent : (entry ?? 0));
    const spentSoFar = spentOf(tally[before]);
    delete tally[before];
    const spent = spentOf(tally[after]) + spentSoFar + 1;
    tally[after] = emptied && carried[ammo.index] ? { spent, line: carried[ammo.index] } : spent;
    encounter.ammoSpent = tally;
    saveEncounter(encounter);
  }
  // A flask shatters on impact or on the floor: one is spent whatever the
  // roll (src/lib/srd/gear-weapons.ts). An object picked up is no line.
  if (plan.profile.gearWeapon?.spent) {
    const now = getSheetById(sheet.id) ?? sheet;
    const index = lineNamed(now.equipment, plan.profile.weapon);
    if (index >= 0) {
      patchSheet(sheet.id, { equipment: withAmmoCount(now.equipment, index, (now.equipment[index].qty ?? 1) - 1) });
      context.notes.push(`one ${plan.profile.weapon} spent`);
    }
  }
  // A weapon thrown leaves the hand whatever the roll and lies at the
  // creature it was thrown at (gear-ground.ts).
  if (thrownAway) {
    const thrown = throwToGround(campaign, turn, sheet, plan.profile.weapon, plan.enemy.id);
    if (thrown) {
      context.notes.push(thrown);
    }
  }
  if (plan.maneuver?.precision) {
    // Validated above, so this spend lands; were it to fail the roll simply
    // goes without the die. The shared door names the maneuver (maneuver-die.ts).
    if (spendManeuverDie(campaign, turn.id, sheet, plan.maneuver.name)) {
      plan.maneuver = null;
    }
  }

  // Striking from hiding spends the hiding (the attack gives them away
  // whether it lands or not), and one-shot riders like True Strike and a
  // held Help are spent by this roll: clear them all together.
  // Skulker keeps the hiding through a ranged attack's roll; a hit spends it
  // (pc-attack-plan.ts hitSpent).
  const keepsHiding = plan.hitSpent.includes("hidden");
  const spentConditions = [
    ...(!keepsHiding && sheet.conditions.some((entry) => entry.toLowerCase() === "hidden") ? ["hidden"] : []),
    // An attack ends the attacker's own Sanctuary (spell-defenses.ts).
    ...sanctuaryEndedByAttack(sheet),
    ...(plan.helped ? [plan.helped] : []),
    ...plan.attackRiders.spent,
  ];
  // Emboldening Bond's d4 is spent by stamping its turn, not by taking the bond off.
  markBondSpent(campaign.id, sheet.id, plan.attackRiders.spent);
  if (spentConditions.length) {
    // Read again when the bond was stamped just above, so the stamp stays.
    const meta = plan.attackRiders.spent.includes(BOND_SPEND) ? (getSheetById(sheet.id) ?? sheet).conditionMeta : sheet.conditionMeta;
    const cleared = removeConditions(sheet.conditions, meta, spentConditions);
    const revealed = patchSheet(sheet.id, {
      conditions: cleared.conditions,
      conditionMeta: cleared.meta,
    });
    if (revealed) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: revealed });
    }
  }
  // An attack ends Invisibility, each source but Greater Invisibility's
  // (attack-marks.ts); a spell attack's cast has already done it.
  endInvisibilityOnCast(campaign.id, sheet.id);
  // A luck point spent on this roll (Lucky).
  if (plan.extras.luck) {
    const fresh = getSheetById(sheet.id) ?? sheet;
    const lucked = spendLuckCounter(fresh.resources);
    if (lucked) {
      const spent = patchSheet(sheet.id, { resources: lucked });
      if (spent) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: spent });
      }
    }
  }
  // Inspiration spent for this roll's advantage.
  if (plan.extras.inspired) {
    const fresh = getSheetById(sheet.id) ?? sheet;
    const spent = patchSheet(sheet.id, { resources: spendInspirationCounter(fresh.resources) });
    if (spent) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: spent });
    }
  }
  markAttackOptions(plan);
  writeMarks(campaign.id, sheet.id, plan.marks.assign);
  // The target's one-shot conditions this roll uses up (Guiding Bolt).
  if (plan.targetSpent.length) {
    const target = getFoe(plan.enemy.id);
    if (target) {
      const cleared = removeConditions(target.conditions, target.conditionMeta, plan.targetSpent);
      patchEnemyConditions(target.id, cleared.conditions, cleared.meta);
      publishEncounter(campaign.id);
    }
  }
  return null;
}

// What a feature option leaves on the attacker once the attack is paid for:
// Reckless Attack's opening (attacks against them have advantage until
// their next turn starts), and the frenzy a Berserker's rage now carries,
// which costs a level of exhaustion when the rage ends (src/lib/dm/frenzy.ts).
function markAttackOptions(plan: AttackPlan) {
  const { campaign, sheet, options } = plan;
  if (!options.declaresReckless && options.bonusAttack !== "frenzy") {
    return;
  }
  const fresh = getSheetById(sheet.id) ?? sheet;
  const meta = { ...(fresh.conditionMeta as ConditionMetaMap) };
  const conditions = [...fresh.conditions];
  if (options.declaresReckless && !conditions.some((entry) => entry.toLowerCase() === RECKLESS)) {
    conditions.push(RECKLESS);
    meta[RECKLESS] = { untilTurnOf: sheet.id };
  }
  if (options.bonusAttack === "frenzy" && !conditions.some((entry) => entry.toLowerCase() === FRENZIED)) {
    conditions.push(FRENZIED);
  }
  const marked = patchSheet(sheet.id, { conditions, conditionMeta: meta });
  if (marked) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: marked });
  }
}
