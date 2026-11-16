// The 5-foot slip out of a grapple or a nonmagical restraint, two features'
// alike:
//   - Revelation in Flesh (Aberrant Mind sorcerer, 14th level): "you can
//     squeeze through a space as narrow as an inch and spend 5 feet of
//     movement to escape nonmagical restraints or a grapple."
//   - Freedom of Movement (SRD 5.1): "The target can also spend 5 feet of
//     movement to automatically escape from nonmagical restraints, such as
//     manacles or a creature that has it grappled." On a character or an
//     enemy: the spell's escape was the action and a check like anyone's.
//
// take_action escape asks here first (action-tools.ts handleTakeAction for a
// character, before the action is priced; enemy-actions.ts for an enemy): a
// creature with the slip (ar-ws-revelation.ts slipFeatureOf) that is
// grappled, or held by a restraint no spell laid, is free for 5 feet of the
// turn's movement, with no action and no check. The grapple goes first (and
// the restraint its grappler held with it, grapple.ts withoutGrapple); with
// no grapple, every nonmagical restraint goes (a net, manacles, a trap's, a
// creature's grip), and with none of those a mechanical trap's own hold (a
// hunting trap's jaws, trap-escape.ts). One slip ends one of them. Slipped
// manacles fall at the creature's feet, as a slip by the DC 20 check leaves
// them (manacles.ts).
//
// Rulings, where the text leaves a choice:
//   - A grappled or restrained creature's speed is 0, and the slip is paid in
//     movement all the same, or it could never be used: the 5 feet are
//     measured against the speed the creature has once every hold the slip
//     can end is gone (a grapple and a net together each cost their 5 feet,
//     and measured one at a time the other would leave it no speed for
//     either), and charged to the turn's movement on the board.
//   - The slip is one more way out and takes none away. Where it cannot be
//     had (the restraint is a spell's, or fewer than 5 feet of movement are
//     left) nothing is charged and the call is the ordinary escape: the action
//     and its check (grapple.ts), with a line saying why the slip did not
//     answer.
//   - Out of a fight, and in a fight played with no board, no movement is
//     counted, so there is none to charge.
//
// Pure reading of the holds: ar-ws-revelation.ts squeezeHoldOf, which the
// Hand's Escape card asks too.
import { slipFeatureOf, squeezeHoldOf, spellRestraint, SQUEEZE_TILES, type SlipFeature, type SqueezeHold } from "@/lib/dm/ar-ws-revelation";
import { pcMoveBudget } from "@/lib/battlemap/view";
import { getBattleMapForEncounter, getTokenByRef, moveToken } from "@/lib/db/battle-maps";
import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy, patchEnemyConditions, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { canAct, canEnemyAct } from "@/lib/dm/can-act";
import { removeConditionInstances, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { enemyMoveBudget } from "@/lib/dm/enemy-speed";
import { withoutGrapple } from "@/lib/dm/grapple";
import { releaseLostPins } from "@/lib/dm/grappler-pin";
import { heldTurnRefusal } from "@/lib/dm/held-turn";
import { manaclesFall, manaclesHold } from "@/lib/dm/manacles";
import { trapHoldOn } from "@/lib/dm/trap-escape";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { publishEphemeral, publishPersisted } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// `done`: the call is answered here (the slip, or a refusal of the turn's own).
// `note`: the slip is held and could not answer; the ordinary escape goes on
// and carries the line. Null: not this creature's business.
export type SqueezeAnswer = { done: ToolResult } | { note: string; key: SlipFeature["key"] } | null;

type Held = { conditions: string[]; conditionMeta?: unknown };

// The hold the slip would end: the grapple or a nonmagical restraint, else a
// mechanical trap's own hold (a hunting trap's jaws: no spell laid it).
function slipHold(campaign: Campaign, held: Held): SqueezeHold | null {
  const hold = squeezeHoldOf(held);
  if (hold && hold.kind !== "spell") {
    return hold;
  }
  const trap = trapHoldOn(campaign, held);
  return trap ? { kind: "restraint", condition: trap.condition } : hold;
}

function freedOf(held: Held, hold: Extract<SqueezeHold, { kind: "grapple" | "restraint" }>) {
  const meta = held.conditionMeta as ConditionMetaMap | undefined;
  const grappler = hold.kind === "grapple" ? (meta?.[hold.condition]?.source ?? null) : null;
  const freed =
    hold.kind === "grapple"
      ? withoutGrapple(held.conditions, meta, { name: hold.condition, source: grappler })
      : removeConditionInstances(held.conditions, meta, hold.condition, (entry) => !spellRestraint(entry));
  return { freed, grappler };
}

// The creature with every hold the slip can end taken off: what its speed
// is measured on.
function unheldOf(campaign: Campaign, held: Held): { conditions: string[]; meta: ConditionMetaMap } {
  let now = { conditions: held.conditions, meta: (held.conditionMeta ?? {}) as ConditionMetaMap };
  for (let step = 0; step < 6; step += 1) {
    const hold = slipHold(campaign, { conditions: now.conditions, conditionMeta: now.meta });
    if (!hold || hold.kind === "spell") {
      break;
    }
    const next = freedOf({ conditions: now.conditions, conditionMeta: now.meta }, hold).freed;
    now = { conditions: next.conditions, meta: next.meta };
  }
  return now;
}

function slipLine(name: string, feature: string, hold: Extract<SqueezeHold, { kind: "grapple" | "restraint" }>, grappler: string | null, charged: boolean): string {
  const holder = grappler ? (getEnemy(grappler)?.displayName ?? getSheetById(grappler)?.name ?? null) : null;
  const what = hold.kind === "grapple" ? (holder ? `${holder}'s grapple` : "the grapple") : "what restrained them";
  return `${name} slips free of ${what} (${feature}): ${charged ? "5 feet of movement, " : ""}no action and no check. The server cleared ${hold.condition}${hold.kind === "grapple" ? " and the restraint that grip held" : ""}.`;
}

export function squeezeSlip(campaign: Campaign, stale: CharacterSheet, encounter: Encounter | null): SqueezeAnswer {
  const sheet = getSheetById(stale.id) ?? stale;
  const slip = slipFeatureOf(sheet);
  const hold = slip ? slipHold(campaign, sheet) : null;
  if (!slip || !hold) {
    return null;
  }
  const feature = slip.name;
  if (hold.kind === "spell") {
    return { key: slip.key, note: `${feature} slips a grapple or a nonmagical restraint; this one is ${hold.spell}'s, a spell's, so the slip does not answer it.` };
  }
  const { freed, grappler } = freedOf(sheet, hold);
  const inFight = encounter !== null && (encounter.kind ?? "fight") === "fight";
  let charged = false;
  if (inFight) {
    // Movement is the turn's: asked as a walk is (token-rules.ts walkCharacter).
    const allowed = canAct({ sheet, encounter, kind: "move" });
    if (!allowed.ok) {
      return { done: toolError(allowed) };
    }
    const heldOff = heldTurnRefusal(encounter, sheet);
    if (heldOff) {
      return { done: heldOff };
    }
    const map = getBattleMapForEncounter(encounter.id);
    const token = map ? getTokenByRef(map.id, sheet.id) : null;
    if (map && token) {
      const unheld = unheldOf(campaign, sheet);
      const left = pcMoveBudget(campaign.id, encounter, map, { ...sheet, conditions: unheld.conditions, conditionMeta: unheld.meta }, token).fullTiles;
      if (left < SQUEEZE_TILES) {
        return { key: slip.key, note: `${feature}'s slip takes 5 feet of movement and ${sheet.name} has none left this turn, so the slip does not answer.` };
      }
      moveToken(token.id, token.x, token.y, token.movedThisRound + SQUEEZE_TILES);
      charged = true;
    }
  }
  const updated = patchSheet(sheet.id, { conditions: freed.conditions, conditionMeta: freed.meta });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    if (manaclesHold(sheet) && !manaclesHold(updated)) {
      manaclesFall(campaign, { kind: "pc", sheet: updated });
    }
  }
  if (hold.kind === "grapple") {
    // Whoever had them pinned holds nothing now (grappler-pin.ts).
    releaseLostPins(campaign);
  }
  if (charged) {
    publishEphemeral(campaign.id, "battle_map_updated", {});
  }
  return {
    done: {
      ok: true,
      action: "escape",
      feature,
      success: true,
      ...(charged ? { movementSpent: "5 ft" } : {}),
      note: slipLine(sheet.name, feature, hold, grappler, charged),
    },
  };
}

// An enemy's slip, on its own turn (enemy-actions.ts asks it before the
// escape's action is paid): its movement on the board, as a walk of its is
// counted (enemy-speed.ts enemyMoveBudget).
export function enemySqueezeSlip(campaign: Campaign, stale: EncounterEnemy, encounter: Encounter): SqueezeAnswer {
  const enemy = getEnemy(stale.id) ?? stale;
  const slip = slipFeatureOf(enemy);
  const hold = slip ? slipHold(campaign, enemy) : null;
  if (!slip || !hold) {
    return null;
  }
  const feature = slip.name;
  if (hold.kind === "spell") {
    return { key: slip.key, note: `${feature} slips a grapple or a nonmagical restraint; this one is ${hold.spell}'s, a spell's, so the slip does not answer it.` };
  }
  const allowed = canEnemyAct({ enemy, encounter, kind: "move" });
  if (!allowed.ok) {
    return { done: toolError(allowed) };
  }
  const { freed, grappler } = freedOf(enemy, hold);
  let charged = false;
  if ((encounter.kind ?? "fight") === "fight") {
    const map = getBattleMapForEncounter(encounter.id);
    const token = map ? getTokenByRef(map.id, enemy.id) : null;
    if (map && token) {
      const left = enemyMoveBudget(encounter, { ...enemy, conditions: unheldOf(campaign, enemy).conditions }, token).tilesLeft;
      if (left < SQUEEZE_TILES) {
        return { key: slip.key, note: `${feature}'s slip takes 5 feet of movement and ${enemy.displayName} has none left this turn, so the slip does not answer.` };
      }
      moveToken(token.id, token.x, token.y, token.movedThisRound + SQUEEZE_TILES);
      charged = true;
    }
  }
  patchEnemyConditions(enemy.id, freed.conditions, freed.meta);
  publishEncounter(campaign.id);
  if (manaclesHold(enemy) && !manaclesHold({ conditions: freed.conditions, conditionMeta: freed.meta })) {
    manaclesFall(campaign, { kind: "enemy", enemy });
  }
  if (hold.kind === "grapple") {
    releaseLostPins(campaign);
  }
  if (charged) {
    publishEphemeral(campaign.id, "battle_map_updated", {});
  }
  return {
    done: {
      ok: true,
      action: "escape",
      feature,
      success: true,
      cost: "no action",
      ...(charged ? { movementSpent: "5 ft" } : {}),
      note: slipLine(enemy.displayName, feature, hold, grappler, charged),
    },
  };
}
