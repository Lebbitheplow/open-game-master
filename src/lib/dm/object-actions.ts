// Use an Object, Search and Ready: the actions of SRD 5.1's "Actions in
// Combat" that had no engine before. The battle-map hand offered "I ready an
// action" and "I use an object", and use_item let a character drink a potion
// every turn, off their turn, or at 0 hit points, for free.
//
//   - Use an Object: drinking a potion, or feeding one to a creature within
//     reach, is an action; so is any other object that needs one. Haste's
//     extra action may pay for it.
//   - Search: an action, a Wisdom (Perception) or Intelligence
//     (Investigation) check.
//   - Ready: the action now, a trigger named, and the response later with
//     the reaction. Ready commits to one action (SRD 5.1): the character
//     carries "readied" until the start of their next turn with what they
//     readied in its metadata (readied-kinds.ts), and that action's own
//     tool releases it off their turn for the reaction (readied-release.ts;
//     a readied attack through pc_attack, src/lib/dm/pc-attack-plan.ts).

import { coatsAsBonusAction, drinksAsBonusAction } from "@/lib/srd/feat-combat";
import { isBasicPoison } from "@/lib/dm/attack-onhit";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { spendAction } from "@/lib/dm/action-budget";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { canAct } from "@/lib/dm/can-act";
import { heldTurnRefusal } from "@/lib/dm/held-turn";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { findCarriedItem, itemUseProblem, thrownFlaskProblem } from "@/lib/dm/item-logic";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { READIED, READIED_WORDS, RELEASE_TOOLS, type Readiable } from "@/lib/dm/readied-kinds";
import { dropReadied, readiedReleaseFor } from "@/lib/dm/readied-release";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { spellDrawnMark } from "@/lib/srd/item-cast-credit";
import { hasItemTag } from "@/lib/srd/item-tags";
import { gearWeaponFor } from "@/lib/srd/gear-weapons";
import { withAmmoCount } from "@/lib/srd/ammunition";
import { saveEquipment } from "@/lib/dm/gear-store";
import { lightOil, spreadGear } from "@/lib/dm/gear-zones";
import { matchGear } from "@/lib/srd/adventuring-gear";
import { scrollSpell } from "@/lib/srd/scrolls";

// The tinderbox, by its catalog row: "using it to light a torch, or anything
// else with abundant, exposed fuel, takes an action".
const TINDERBOX = matchGear("Tinderbox");

// Haste's extra action names this use by these words (action-budget.ts).
const USE_AN_OBJECT = "use an object";

// The readied condition a Ready action leaves on the character.
export { READIED };

// ---- use_item: what using a carried item costs ----

// Everything that can refuse a use_item, asked before anything is spent:
// the item has to be one that is used up, the user has to be able to act,
// a creature fed a potion has to be within reach, and in a fight the use
// is the user's action. Returns the charge to commit once the item is used.
export function prepareUseItem(
  campaign: Campaign,
  sheet: CharacterSheet,
  target: CharacterSheet,
  itemName: string,
): ToolError | { commit: () => ToolResult } {
  const carried = findCarriedItem(sheet.equipment, itemName);
  const problem = carried ? itemUseProblem(carried) : null;
  if (problem) {
    return { ...problem, error: `${sheet.name} does not use up ${carried?.name ?? itemName}: ${problem.error}` };
  }
  const encounter = getActiveEncounter(campaign.id);
  // A flask thrown in a fight is pc_attack's, asked before the action is
  // priced so nothing is spent (item-logic.ts).
  const thrown = thrownFlaskProblem(sheet.name, carried?.name ?? itemName, Boolean(encounter));
  if (thrown) {
    return thrown;
  }
  // Off their turn, the use of an item they readied is their reaction, and
  // nothing of the acting combatant's turn (readied-release.ts).
  const readied = readiedReleaseFor(sheet, encounter, "item");
  if (readied && "error" in readied) {
    return toolError(readied);
  }
  if (!readied) {
    const allowed = canAct({ sheet, encounter, kind: "action" });
    if (!allowed.ok) {
      return toolError(allowed);
    }
    const heldOff = heldTurnRefusal(encounter, sheet);
    if (heldOff) {
      return heldOff;
    }
  }
  if (target.id !== sheet.id && encounter) {
    const apart = tilesBetween(encounter.id, sheet.id, target.id);
    if (apart !== null && apart > 1) {
      return {
        error: `${target.name} is ${apart * 5} ft from ${sheet.name}; feeding them a potion needs them within 5 ft. ${sheet.name} moves next to them first.`,
        retry: true,
      };
    }
  }
  if (readied) {
    return { commit: () => readied.release() };
  }
  const budget = budgetFor(
    encounter,
    sheet.id,
    attacksAllowedFor(sheet),
    conditionTurnShape(sheet.conditions),
  );
  if (!budget || !encounter) {
    return { commit: () => ({}) };
  }
  // Rapid Drinker drinks a potion as a bonus action; Poisoner coats a
  // weapon as one (src/lib/srd/feat-combat.ts).
  const name = carried?.name ?? itemName;
  // A scroll's spell paid its action this turn, and the scroll came back when the
  // cast did not happen (item-use.ts takeBackItemCast): this reading is on it.
  const scroll = carried ? scrollSpell(carried) : null;
  const mark = scroll ? spellDrawnMark(scroll) : "";
  if (mark && budget.oncePerTurn.includes(mark)) {
    return {
      commit: () => {
        storeBudget(encounter, { ...budget, oncePerTurn: budget.oncePerTurn.filter((entry) => entry !== mark) });
        return {};
      },
    };
  }
  const drinking = drinksAsBonusAction(sheet) && Boolean(carried && hasItemTag(carried, "potion"));
  const asBonus = drinking || (coatsAsBonusAction(sheet) && isBasicPoison(carried ?? { name }, sheet.campaignId));
  const price = asBonus
    ? spendAction(budget, "bonus", `${drinking ? "Rapid Drinker" : "Poisoner"} (${USE_AN_OBJECT})`, sheet.name)
    : spendAction(budget, "action", USE_AN_OBJECT, sheet.name);
  if (!price.ok) {
    return toolError(price);
  }
  return {
    commit: () => {
      const live = getActiveEncounter(campaign.id);
      if (live) {
        storeBudget(live, price.budget);
      }
      return { cost: price.note ?? `${sheet.name}'s action (Use an Object)` };
    },
  };
}

// ---- take_action use_object, search, ready ----

type Priced = { spend: () => void };

// Use an Object for a thing that is not used up: a lever, a stuck door, a
// rope to throw. A consumable goes through use_item, which charges the same
// action, so the model is pointed there rather than paying twice.
export function objectAction(
  campaign: Campaign,
  turn: DmTurn,
  sheet: CharacterSheet,
  item: string | undefined,
  reason: string | undefined,
  priced: Priced,
  // What it costs, for the result: a Thief's Fast Hands makes it the bonus
  // action.
  cost = "their action",
): ToolResult {
  const carried = item ? findCarriedItem(sheet.equipment, item) : null;
  // A flask put to anything but a creature: acid on a lock, alchemist's fire
  // on a web, oil poured on the floor. use_item sends a flask in a fight
  // here or to pc_attack (item-logic.ts thrownFlaskProblem), and pc_attack
  // takes only creatures, so this is where it is spent; it shatters whatever
  // it strikes.
  if (carried && gearWeaponFor(carried.name)?.thrown) {
    const index = sheet.equipment.indexOf(carried);
    priced.spend();
    saveEquipment(campaign, turn, sheet, withAmmoCount(sheet.equipment, index, (carried.qty ?? 1) - 1), "use_item", { item: carried.name }, (reason ?? `Used ${carried.name}`).slice(0, 200));
    // Oil poured out lies as a pool on the board until fire lights it
    // (gear-zones.ts); the other flasks leave nothing on the ground.
    const pool = spreadGear(campaign, sheet, carried.name);
    return {
      ok: true,
      action: "Use an Object",
      used: carried.name,
      remaining: Math.max(0, (carried.qty ?? 1) - 1),
      ...(pool ? { spread: pool } : {}),
      applied: `${sheet.name} spends ${cost} on ${carried.name}${reason ? ` (${reason.slice(0, 80)})` : ""}, and the flask is spent. Narrate what it does to the object or the ground; an object's AC and hit points (SRD 5.1 Objects) are yours to rule.`,
    };
  }
  // A torch or a tinderbox put to poured oil within 5 feet lights it
  // ("If lit, the oil burns for 2 rounds"). Neither is used up by it.
  const kindles = carried && (gearWeaponFor(carried.name)?.type === "fire" || matchGear(carried.name) === TINDERBOX);
  const lit = kindles ? lightOil(campaign, sheet.id, 1) : null;
  if (carried && lit) {
    priced.spend();
    return { ok: true, action: "Use an Object", applied: `${sheet.name} spends ${cost} putting ${carried.name} to the oil. ${lit}` };
  }
  if (carried && !itemUseProblem(carried)) {
    return {
      error: `${carried.name} is used up when it is used: call use_item for it, which spends ${sheet.name}'s action (Use an Object) itself.`,
      retry: true,
    };
  }
  priced.spend();
  const what = (item ?? reason ?? "an object").slice(0, 80);
  return {
    ok: true,
    action: "Use an Object",
    applied: `${sheet.name} spends ${cost} on ${what}. Narrate what the object does; anything with a roll or a rules effect goes through its own tool.`,
  };
}

export function searchAction(
  campaign: Campaign,
  turn: DmTurn,
  sheet: CharacterSheet,
  skill: "perception" | "investigation",
  priced: Priced,
): Record<string, unknown> {
  priced.spend();
  const check = rollCharacterCheck(
    campaign,
    sheet,
    { skill },
    `${sheet.name}: Search (${skill === "perception" ? "Perception" : "Investigation"})`,
  );
  if (check.rollId) {
    turn.rollIds.push(check.rollId);
  }
  return {
    ok: true,
    action: "Search",
    skill,
    total: check.total,
    ...(check.notes.length ? { notes: check.notes } : {}),
    note: `${sheet.name} searches: ${skill} ${check.total}. Compare it with the DC of what is there to find (a hidden creature's Stealth, a trap's DC); what they do not beat stays unfound.`,
  };
}

// Ready commits to one action (SRD 5.1): `holds` is what the trigger
// releases, an attack unless the DM named another (take_action's `readied`;
// a spell goes through readySpell instead).
export function readyAction(
  campaign: Campaign,
  sheet: CharacterSheet,
  trigger: string | undefined,
  inFight: boolean,
  priced: Priced,
  holds: Exclude<Readiable, "spell"> = "attack",
): ToolResult {
  const named = (trigger ?? "").trim();
  if (!inFight) {
    return { error: "Ready is an action in a fight, where turns are taken in order; there is no active fight.", refused: "rules" };
  }
  if (!named) {
    return {
      error: "Ready needs the trigger it waits for, e.g. trigger: 'when the goblin steps through the door'. Nothing was spent.",
      retry: true,
    };
  }
  priced.spend();
  const fresh = getSheetById(sheet.id) ?? sheet;
  const meta: ConditionMetaMap = {
    ...(fresh.conditionMeta as ConditionMetaMap),
    [READIED]: { untilTurnOf: sheet.id, source: named.slice(0, 80), ...(holds === "attack" ? {} : { holds }) },
  };
  const conditions = fresh.conditions.some((entry) => entry.trim().toLowerCase() === READIED) ? fresh.conditions : [...fresh.conditions, READIED];
  const updated = patchSheet(sheet.id, { conditions, conditionMeta: meta });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return {
    ok: true,
    action: "Ready",
    readied: holds,
    trigger: named.slice(0, 80),
    applied: `${sheet.name} has readied ${READIED_WORDS[holds]} until the start of their next turn, for: ${named.slice(0, 80)}. You judge the trigger. When it happens, release it off their turn with ${RELEASE_TOOLS[holds]}: the server spends their reaction and nothing of the acting combatant's turn. Any other action, or a second release, is refused. If the trigger never comes, the readied action is lost.`,
  };
}

// Spends a readied action: the off-turn attack it allowed has been made.
export function spendReadied(campaign: Campaign, sheetId: string) {
  dropReadied(campaign.id, sheetId);
}
