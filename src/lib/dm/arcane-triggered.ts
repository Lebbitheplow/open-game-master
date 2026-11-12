// The effects of the arcane counters whose trigger is a record (src/lib/srd/
// trigger-table.ts), spent through use_resource once triggerRefusal has found
// one open (reaction-counters.ts planCounterReaction). Before this the use was
// taken and the effect was the counter's guidance:
//
//   Violent Attraction (Graviturgy 10): "When a creature you can see within
//     60 feet hits with a weapon attack, a reaction adds 1d10 to its damage".
//     A party member's weapon hit of this turn hurts its creature by 1d10 more;
//     a creature's weapon hit on a character lands 1d10 more on them.
//   Infectious Inspiration (Eloquence 14): "A reaction copies a successful
//     inspiration die onto another creature". A creature other than the bard
//     and the one whose roll succeeded, within 60 feet, is handed a Bardic
//     Inspiration die of the bard's size, and no use of Bardic Inspiration is
//     spent (the creature is the call's targetCharacterId).
//   Accursed Specter (Hexblade 6): a humanoid the warlock slew rises as a
//     specter under their command (src/lib/dm/summon-arcane.ts).
//
// Restore Balance is no longer here: it is used before the roll (the
// ruling on issue #908), and reaction-counters.ts refuses a spend after it.
//
// Planned before the use is spent, so a refusal costs nothing; applied once
// it is. Must not import mutations.ts.

import type { Campaign } from "@/lib/db/campaigns";
import { getDmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { givenDieMarks } from "@/lib/dm/ar-wbf-bard-dice-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { unseenRefusal, withinFeet } from "@/lib/dm/authored-saves";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { heaviestHit, hitIdOf, openHits, type LastHit, type SwingRecord } from "@/lib/dm/last-hit";
import { openTriggersFor, type TriggerAsk } from "@/lib/dm/reaction-triggers";
import { settleLastHit } from "@/lib/dm/reaction-refund";
import { rollCard } from "@/lib/dm/roll-card";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { summonAccursedSpecter } from "@/lib/dm/summon-arcane";
import type { ToolError } from "@/lib/dm/tool-errors";
import { classLevelFor } from "@/lib/srd/multiclass";
import { triggerSpecFor, type TriggerEvent } from "@/lib/srd/trigger-table";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type Plan = { apply: () => Record<string, unknown> };
type Input = { campaign: Campaign; turnId: string; sheet: CharacterSheet; defId: string; targetCharacterId?: string; sheets: CharacterSheet[]; sheetsById: Map<string, CharacterSheet> };

// The record an open hit or miss event is, and the swing it names.
function hitOf(campaignId: string, event: TriggerEvent): LastHit | null {
  return openHits(campaignId, event.characterId).find((record) => hitIdOf(record) === event.id) ?? null;
}

function latest(input: Input, ask: TriggerAsk): TriggerEvent | null {
  const spec = triggerSpecFor(ask.name, { counterId: ask.counterId });
  return spec ? (openTriggersFor(ask, spec).slice(-1)[0] ?? null) : null;
}

function settle(input: Input, record: LastHit, corrected: SwingRecord[], label: string) {
  return settleLastHit(input.campaign, input.turnId, record, corrected, label, input.sheets, input.sheetsById);
}

function violentAttraction(input: Input, ask: TriggerAsk): Plan | ToolError {
  const { campaign, sheet } = input;
  const encounter = getActiveEncounter(campaign.id);
  const event = latest(input, ask);
  if (!encounter || !event) {
    return { error: "Violent Attraction answers a weapon attack that hit, and none is open. Nothing was spent.", refused: "rules" };
  }
  const turn = getDmTurn(input.turnId);
  if (event.kind === "weapon_hit") {
    // A character's weapon hit of this turn: its creature takes the die.
    const striker = getSheetById(event.characterId);
    const enemy = event.creatureId ? resolveTargetFoe(campaign.id, encounter, event.creatureId) : null;
    if (!striker || !enemy || enemy.status !== "alive") {
      return { error: "Violent Attraction adds to the damage of a hit on a living creature, and the creature hit is gone. Nothing was spent.", refused: "rules" };
    }
    const unseen = unseenRefusal(encounter.id, sheet, { id: striker.id, name: striker.name }, "Violent Attraction");
    if (unseen) return unseen;
    return {
      apply: () => {
        const rolled = rollCard(campaign, turn, sheet.id, "damage", `Violent Attraction: ${striker.name}'s hit on ${enemy.displayName}`, "1d10", null).total;
        const applied = turn ? applyEnemyDamage(campaign, turn, encounter, enemy, rolled, input.sheets, input.sheetsById, undefined, { magical: true }) : {};
        publishEncounter(campaign.id);
        return { rolled: `1d10: ${rolled}`, applied: `${striker.name}'s weapon hits ${enemy.displayName} harder: ${rolled} more damage.`, ...applied };
      },
    };
  }
  const record = hitOf(campaign.id, event);
  const index = record ? heaviestHit(record.swings, (swing) => !swing.flags?.spell) : -1;
  if (!record || index < 0) {
    return { error: "Violent Attraction adds to a weapon attack's damage, and the hit on record is not one. Nothing was spent.", refused: "rules" };
  }
  const unseen = unseenRefusal(encounter.id, sheet, record.attacker, "Violent Attraction");
  if (unseen) return unseen;
  return {
    apply: () => {
      const rolled = rollCard(campaign, turn, sheet.id, "damage", `Violent Attraction: ${record.attacker.name}'s hit`, "1d10", null).total;
      const swing = record.swings[index];
      const settled = settle(input, record, record.swings.map((entry, at) => (at === index ? { ...swing, raw: swing.raw + rolled } : entry)), "violent attraction");
      return { rolled: `1d10: ${rolled}`, applied: `${record.attacker.name}'s weapon hits harder: ${rolled} more damage. HP ${settled.hp}.` };
    },
  };
}

function accursedSpecter(input: Input): Plan {
  const level = classLevelFor(input.sheet, "warlock") || input.sheet.level;
  return { apply: () => {
    const made = summonAccursedSpecter(input.campaign, input.sheet, level);
    return "error" in made ? { note: made.error } : made.result;
  } };
}

// The plan for one of these counters, or null for any other.
const INFECTIOUS = "Infectious Inspiration";
const INFECTIOUS_FEET = 60;
// 10 minutes of rounds, as a die given with Bardic Inspiration lasts (resource-tools.ts).
const DIE_ROUNDS = 100;
const DIE_FAMILY = "bardic inspiration";

function infectiousInspiration(input: Input, ask: TriggerAsk): Plan | ToolError {
  const { campaign, sheet } = input;
  const encounter = getActiveEncounter(campaign.id);
  const event = latest(input, ask);
  const target = input.targetCharacterId ? (getSheetById(input.targetCharacterId) ?? null) : null;
  if (!encounter || !event) {
    return { error: `${INFECTIOUS} answers a roll a creature has just made succeed with ${sheet.name}'s Bardic Inspiration die, and none is open. Nothing was spent.`, refused: "rules" };
  }
  if (!target) {
    return { error: `${INFECTIOUS} hands the die on to another creature: pass that creature as targetCharacterId. Nothing was spent.`, retry: true };
  }
  if (target.id === sheet.id || target.id === event.characterId) {
    return { error: `${INFECTIOUS} encourages a different creature: not ${sheet.name}, and not the one whose roll has just succeeded. Nothing was spent.`, refused: "rules" };
  }
  if (!withinFeet(encounter.id, sheet.id, target.id, INFECTIOUS_FEET)) {
    return { error: `${target.name} is beyond ${INFECTIOUS_FEET} feet of ${sheet.name}. Nothing was spent.`, refused: "rules" };
  }
  // SRD 5.1 bard, Bardic Inspiration: "A creature can have only one Bardic
  // Inspiration die at a time."
  const held = target.conditions.find((entry) => isConditionNamed(entry, DIE_FAMILY));
  if (held) {
    return { error: `${target.name} already holds an unspent inspiration die (${held}), and a creature can have only one at a time. Nothing was spent.`, refused: "rules" };
  }
  const level = classLevelFor(sheet, "bard") || sheet.level;
  const die = level >= 15 ? "d12" : level >= 10 ? "d10" : level >= 5 ? "d8" : "d6";
  const condition = `${DIE_FAMILY} (${die})`;
  return {
    apply: () => {
      const now = getSheetById(target.id) ?? target;
      const updated = patchSheet(now.id, {
        conditions: [...now.conditions, condition],
        // The bard is the die's source, as on one they hand out themselves.
        conditionMeta: { ...now.conditionMeta, [condition]: { rounds: DIE_ROUNDS, source: sheet.id, ...givenDieMarks(sheet) } },
      });
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
      return { granted: `1${die} to ${now.name}, with no use of Bardic Inspiration spent; it is spent on their next d20 roll.` };
    },
  };
}

export function planArcaneTrigger(input: Input, ask: TriggerAsk): Plan | ToolError | null {
  switch (input.defId) {
    case "sub_infectious_inspiration":
      return infectiousInspiration(input, ask);
    case "sub_violent_attraction":
      return violentAttraction(input, ask);
    case "sub_accursed_specter":
      return accursedSpecter(input);
    default:
      return null;
  }
}
