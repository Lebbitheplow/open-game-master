// Magic-User's Nemesis (Monster Slayer 11): "A reaction forces a caster or
// teleporter within 60 feet to make a Wisdom save or lose the spell."
//
// A reaction that stops an effect acts before the effect lands. The casting
// half rides the window Counterspell uses (src/lib/dm/casting-answered.ts):
// the call names the creature and the spell it is casting (targetEnemyId, and
// the spell in `variant`) before the spell is resolved, the creature makes its
// Wisdom save against the ranger's spell save DC, and on a failure the spell
// is wasted as a countered one is: its slot or use and the action it was cast
// with are spent, and the engine refuses the cast that would have followed.
// Until round 2 of the wave-2 repair the use answered the cast's record and
// undid the spell after it had landed.
//
// A teleport is instant, so it is answered from its record (last-save.ts
// recordTeleport, written at every door a token teleports through): on a
// failed save the creature is back on the square it left, and what the
// teleport cost it stays spent ("its teleport fails and is wasted").
//
// With neither a casting named nor a teleport on record the use is refused
// and nothing is spent. Planned before the use is spent; must not import
// mutations.ts.

import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef, placeToken } from "@/lib/db/battle-maps";
import { getDmTurn } from "@/lib/db/dm-turns";
import { getActiveBoard, getActiveEncounter, getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import { castingCost, checkCasting, wasteCasting } from "@/lib/dm/casting-answered";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { openTriggers } from "@/lib/dm/last-save";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { openTriggersFor, type TriggerAsk } from "@/lib/dm/reaction-triggers";
import type { ToolError } from "@/lib/dm/tool-errors";
import { computeSheetDerived } from "@/lib/srd";
import { triggerSpecFor } from "@/lib/srd/trigger-table";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const MAGIC_USERS_NEMESIS_ID = "sub_magic_users_nemesis";
const NAME = "Magic-User's Nemesis";

type Plan = { apply: () => Record<string, unknown> };
type Input = { campaign: Campaign; turnId: string; sheet: CharacterSheet; targetEnemyId?: string; variant?: string };

function wisdomSave(input: Input, creature: EncounterEnemy) {
  const derived = computeSheetDerived(input.sheet);
  const dc = derived.spellSaveDc ?? 8 + derived.proficiencyBonus + derived.abilityMods.wis;
  const save = rollEnemySave(input.campaign.id, creature, "wis", dc, { magical: true, record: { turn: getDmTurn(input.turnId) ?? undefined, detail: `${creature.displayName}: WIS save against ${input.sheet.name}'s ${NAME}` } });
  return { failed: !save.success, line: `${creature.displayName} Wisdom save ${save.total ?? "failed"} against DC ${dc}: ${save.success ? "made" : "failed"}.` };
}

// The teleport on record this use answers: the latest by a creature within 60
// feet (the one the call names, when it names one), with the square it left.
function teleportAnswered(input: Input, ask: TriggerAsk): { creature: EncounterEnemy; from: { x: number; y: number } } | null {
  const spec = triggerSpecFor(ask.name, { counterId: ask.counterId });
  const event = spec ? openTriggersFor(ask, spec).at(-1) : undefined;
  const creature = event?.creatureId ? getEnemy(event.creatureId) : null;
  const from = event ? openTriggers(input.campaign.id).find((record) => record.id === event.id)?.square : undefined;
  return creature && creature.status === "alive" && from ? { creature, from } : null;
}

export function planMagicUsersNemesis(input: Input, ask: TriggerAsk): Plan | ToolError {
  const { campaign, sheet: ranger } = input;
  const spell = (input.variant ?? "").trim();
  // A call that names a spell answers a casting; one that names none answers
  // the teleport on record, when there is one.
  const jump = spell ? null : teleportAnswered(input, ask);
  if (jump) {
    return {
      apply: () => {
        const save = wisdomSave(input, jump.creature);
        if (!save.failed) {
          return { save: `${save.line} Its teleport stands.` };
        }
        const board = getActiveBoard(campaign.id);
        const map = board ? getBattleMapForEncounter(board.id) : null;
        const token = map ? getTokenByRef(map.id, jump.creature.id) : null;
        if (token) {
          placeToken(token.id, jump.from.x, jump.from.y);
          publishBattleMapUpdate(campaign.id);
        }
        return { save: save.line, applied: `${jump.creature.displayName}'s teleport fails and is wasted: it is back at (${jump.from.x},${jump.from.y}), and what the teleport cost it stays spent.` };
      },
    };
  }
  if (!spell && !input.targetEnemyId?.trim()) {
    return {
      error: `${NAME} answers a creature casting a spell within 60 feet of ${ranger.name}, before the spell is resolved (targetEnemyId, and the spell it is casting in variant), or a creature that has just teleported there, and the server has neither. Nothing was spent.`,
      refused: "rules",
    };
  }
  const casting = checkCasting({ encounter: getActiveEncounter(campaign.id), sheet: ranger, targetEnemyId: input.targetEnemyId, spell }, NAME, "variant");
  if ("error" in casting) {
    return casting;
  }
  return {
    apply: () => {
      const save = wisdomSave(input, casting.enemy);
      if (!save.failed) {
        return { save: save.line, applied: `${casting.enemy.displayName}'s ${casting.spell} goes ahead; resolve it as it is cast.` };
      }
      wasteCasting(campaign.id, casting);
      return {
        save: save.line,
        applied: `${casting.enemy.displayName}'s ${casting.spell} fails and is wasted: the ${casting.level ? `level-${casting.level} slot` : "casting"} and ${castingCost(casting)} are spent, and the server will refuse the cast. Do not resolve the spell.`,
      };
    },
  };
}
