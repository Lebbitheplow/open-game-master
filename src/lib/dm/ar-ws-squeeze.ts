// Revelation in Flesh's slip (Aberrant Mind sorcerer, 14th level): "you can
// squeeze through a space as narrow as an inch and spend 5 feet of movement to
// escape nonmagical restraints or a grapple."
//
// take_action escape asks here first (action-tools.ts handleTakeAction, before
// the action is priced): a sorcerer in the squeezing form who is grappled, or
// held by a restraint no spell laid, is free for 5 feet of the turn's
// movement, with no action and no check. The grapple goes first (and the
// restraint its grappler held with it, grapple.ts withoutGrapple); with no
// grapple, every nonmagical restraint goes (a net, a trap's, a creature's
// grip). One slip ends one of the two.
//
// Rulings, where the text leaves a choice:
//   - A grappled or restrained creature's speed is 0, and the slip is paid in
//     movement all the same, or it could never be used: the 5 feet are
//     measured against the speed the sorcerer has once the hold the slip ends
//     is gone, and charged to the turn's movement on the board.
//   - The slip is one more way out and takes none away. Where it cannot be
//     had (the restraint is a spell's, or fewer than 5 feet of movement are
//     left) nothing is charged and the call is the ordinary escape: the action
//     and its check (grapple.ts characterEscape), with a line saying why the
//     slip did not answer.
//   - Out of a fight, and in a fight played with no board, no movement is
//     counted, so there is none to charge.
//
// Pure reading of the sheet: ar-ws-revelation.ts squeezeHoldOf, which the
// Hand's Escape card asks too.
import { squeezeHoldOf, spellRestraint, SQUEEZE_TILES } from "@/lib/dm/ar-ws-revelation";
import { pcMoveBudget } from "@/lib/battlemap/view";
import { getBattleMapForEncounter, getTokenByRef, moveToken } from "@/lib/db/battle-maps";
import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy, type Encounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { canAct } from "@/lib/dm/can-act";
import { removeConditionInstances, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { withoutGrapple } from "@/lib/dm/grapple";
import { releaseLostPins } from "@/lib/dm/grappler-pin";
import { heldTurnRefusal } from "@/lib/dm/held-turn";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { publishEphemeral, publishPersisted } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const FEATURE = "Revelation in Flesh";

// `done`: the call is answered here (the slip, or a refusal of the turn's own).
// `note`: the form is held and the slip could not answer; the ordinary escape
// goes on and carries the line. Null: not this sorcerer's business.
export type SqueezeAnswer = { done: ToolResult } | { note: string } | null;

export function squeezeSlip(campaign: Campaign, stale: CharacterSheet, encounter: Encounter | null): SqueezeAnswer {
  const sheet = getSheetById(stale.id) ?? stale;
  const hold = squeezeHoldOf(sheet);
  if (!hold) {
    return null;
  }
  if (hold.kind === "spell") {
    return { note: `${FEATURE} slips a grapple or a nonmagical restraint; this one is ${hold.spell}'s, a spell's, so the slip does not answer it.` };
  }
  const meta = sheet.conditionMeta as ConditionMetaMap | undefined;
  const grappler = hold.kind === "grapple" ? (meta?.[hold.condition]?.source ?? null) : null;
  const freed =
    hold.kind === "grapple"
      ? withoutGrapple(sheet.conditions, meta, { name: hold.condition, source: grappler })
      : removeConditionInstances(sheet.conditions, meta, hold.condition, (entry) => !spellRestraint(entry));
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
      const left = pcMoveBudget(campaign.id, encounter, map, { ...sheet, conditions: freed.conditions, conditionMeta: freed.meta }, token).fullTiles;
      if (left < SQUEEZE_TILES) {
        return { note: `${FEATURE}'s slip takes 5 feet of movement and ${sheet.name} has none left this turn, so the slip does not answer.` };
      }
      moveToken(token.id, token.x, token.y, token.movedThisRound + SQUEEZE_TILES);
      charged = true;
    }
  }
  const updated = patchSheet(sheet.id, { conditions: freed.conditions, conditionMeta: freed.meta });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  if (hold.kind === "grapple") {
    // Whoever had them pinned holds nothing now (grappler-pin.ts).
    releaseLostPins(campaign);
  }
  if (charged) {
    publishEphemeral(campaign.id, "battle_map_updated", {});
  }
  const holder = grappler ? (getEnemy(grappler)?.displayName ?? getSheetById(grappler)?.name ?? null) : null;
  const what = hold.kind === "grapple" ? (holder ? `${holder}'s grapple` : "the grapple") : "what restrained them";
  return {
    done: {
      ok: true,
      action: "escape",
      feature: FEATURE,
      success: true,
      ...(charged ? { movementSpent: "5 ft" } : {}),
      note: `${sheet.name} slips free of ${what} (${FEATURE}): ${charged ? "5 feet of movement, " : ""}no action and no check. The server cleared ${hold.condition}${hold.kind === "grapple" ? " and the restraint that grip held" : ""}.`,
    },
  };
}
