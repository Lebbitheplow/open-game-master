// The effects of the arcane counters whose trigger is a record (src/lib/srd/
// trigger-table.ts), spent through use_resource once triggerRefusal has found
// one open (reaction-counters.ts planCounterReaction). Before this the use was
// taken and the effect was the counter's guidance:
//
//   Restore Balance (Clockwork Soul 1): "A reaction cancels advantage or
//     disadvantage on a roll within 60 feet". The attack that hit is settled
//     on its first die, as a roll with neither is made of one.
//   Violent Attraction (Graviturgy 10): "When a creature you can see within
//     60 feet hits with a weapon attack, a reaction adds 1d10 to its damage".
//     A party member's weapon hit of this turn hurts its creature by 1d10 more;
//     a creature's weapon hit on a character lands 1d10 more on them.
//   Accursed Specter (Hexblade 6): a humanoid the warlock slew rises as a
//     specter under their command (src/lib/dm/summon-arcane.ts).
//
// Planned before the use is spent, so a refusal costs nothing; applied once
// it is. Must not import mutations.ts.

import type { Campaign } from "@/lib/db/campaigns";
import { getDmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { unseenRefusal } from "@/lib/dm/authored-saves";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { heaviestHit, hitIdOf, openHits, plainOfReroll, type LastHit, type SwingRecord } from "@/lib/dm/last-hit";
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
type Input = { campaign: Campaign; turnId: string; sheet: CharacterSheet; defId: string; sheets: CharacterSheet[]; sheetsById: Map<string, CharacterSheet> };

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

function restoreBalance(input: Input, ask: TriggerAsk): Plan | ToolError {
  const event = latest(input, ask);
  const record = event ? hitOf(input.campaign.id, event) : null;
  const index = record ? record.swings.findIndex((swing) => swing.advantage && swing.advantage !== "none" && swing.natural !== null) : -1;
  if (!record || index < 0) {
    return { error: "Restore Balance answers an attack roll made with advantage or disadvantage, and the server holds none it can settle again. Nothing was spent.", refused: "rules" };
  }
  const swing = record.swings[index];
  // Neither advantage nor disadvantage: the roll is the first die alone.
  const kept = swing.faces[0] ?? swing.natural!;
  const total = swing.total - swing.natural! + kept;
  const lands = kept === 20 || (kept !== 1 && total >= swing.vsAc);
  if (!swing.hit && lands) {
    // A miss whose first die hits: the damage was never rolled, so the
    // engine cannot land it after the fact. Said before anything is spent.
    return { error: `Without its ${swing.advantage}, ${record.attacker.name}'s ${total} would hit AC ${swing.vsAc}, and the server does not land a missed attack's damage after it is resolved. Nothing was spent.`, refused: "rules" };
  }
  return {
    apply: () => {
      if (!swing.hit) {
        return { applied: `Without its ${swing.advantage}, ${record.attacker.name}'s attack is a ${total} against AC ${swing.vsAc}: it still misses.` };
      }
      const corrected = lands
        ? { ...plainOfReroll(swing, kept), total, natural: kept, faces: [kept], advantage: "none" as const }
        : { ...swing, hit: false, raw: 0, total, natural: kept, faces: [kept], advantage: "none" as const };
      const settled = settle(input, record, record.swings.map((entry, at) => (at === index ? corrected : entry)), "restore balance");
      return lands
        ? { applied: `Without its ${swing.advantage}, the attack is a ${total} against AC ${swing.vsAc}: it still hits${settled.given ? `, ${settled.given} hit points come back` : ""}. HP ${settled.hp}.` }
        : { applied: `Without its ${swing.advantage}, the attack is a ${total} against AC ${swing.vsAc}: it misses, and ${settled.given} hit points come back. HP ${settled.hp}.` };
    },
  };
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
export function planArcaneTrigger(input: Input, ask: TriggerAsk): Plan | ToolError | null {
  switch (input.defId) {
    case "sub_restore_balance":
      return restoreBalance(input, ask);
    case "sub_violent_attraction":
      return violentAttraction(input, ask);
    case "sub_accursed_specter":
      return accursedSpecter(input);
    default:
      return null;
  }
}
