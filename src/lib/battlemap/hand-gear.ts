// The Hand's gear cards (issue #424): what a character does with the things
// in their hands during a fight, each sent to the tool that keeps the count
// (handle_item, use_item, stabilize, dismount), so the card costs what the
// engine charges.
//
// SRD 5.1: drawing or stowing a weapon, picking something up and handing it
// over are the one free object interaction a turn; a second takes the Use an
// Object action. Dropping something costs nothing. A shield is an action to
// don or doff; armor takes minutes, so it has no card. Drinking a potion or
// feeding one to an ally is an action, and so is stabilizing a dying ally.
// Dismounting costs half the rider's speed.
//
// Pure and database-free: scripts/test-hand-gear.mjs drives it.
import { translate } from "@/lib/messages-logic";

type T = (key: string, vars?: Record<string, string | number>) => string;
const enT: T = (key, vars) => translate("en", key, vars);
import { guessedRehand, guessStands, handsFullError, handsFullFor, spendInteraction, gearKindOf, inHand } from "@/lib/dm/gear-hands";
import type { SpendResult } from "@/lib/dm/action-budget";
import { dualWields } from "@/lib/dm/attack-rules";
import { hasFastHands } from "@/lib/dm/bonus-routes";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { wearingIsExplicit } from "@/lib/srd/armor";
import { itemTags } from "@/lib/srd/item-tags";
import { textKey } from "@/lib/language/text-logic";
import {
  budgetOf,
  costGate,
  gated,
  standingGate,
  type Gate,
  type HandCard,
  type HandChoice,
  type HandCost,
  type HandGearContext,
  type HandTurn,
} from "@/lib/battlemap/hand-core";
import type { HandGearAction } from "@/lib/battlemap/hand-intent";

// A pick of more than this many rows is cut to the first ones: the pills
// sit in the aim bar, and a pack's whole contents is not a choice.
const MAX_PICKS = 8;

const BLANK = {
  range: "Self",
  dice: "",
  roll: "no roll",
  resource: "",
  condition: "",
  toHit: null,
  damage: null,
  damageType: "",
  heals: false,
  save: null,
  melee: false,
  disabled: null,
  spent: false,
  compose: false,
} as const;

function card(
  id: string,
  name: string,
  action: HandGearAction,
  cost: HandCost,
  rules: string,
  icon: HandCard["icon"],
  extra: Partial<HandCard> = {},
  t: T = enT,
): HandCard {
  return {
    ...BLANK,
    range: t("Self", { context: "table.hand.range.self" }),
    roll: t("no roll", { context: "table.hand.roll.none" }),
    id: `gear:${id}`,
    type: "basic",
    name,
    cost,
    rules,
    icon,
    target: "none",
    intent: { card: "gear", action },
    ...extra,
  };
}

function pick(label: string, rows: Array<{ value: string; label: string; note?: string }>): HandChoice {
  return { arg: "item", label, options: rows.slice(0, MAX_PICKS) };
}

function once<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const name = textKey(key(row));
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

const rowPick = (item: EquipmentItem) => ({ value: item.name, label: item.name, ...(item.qty > 1 ? { note: `×${item.qty}` } : {}) });

// What the interaction costs now: nothing while it is unspent, the Use an
// Object action after (Fast Hands' bonus action for a thief), in the
// engine's own words when neither is left.
function interactionCost(sheet: CharacterSheet, turn: HandTurn, t: T = enT): { cost: HandCost; note: string; gate: Gate } {
  if (!turn.interactionUsed) {
    return { cost: "free", note: t("Your free object interaction this turn."), gate: null };
  }
  const result = spendInteraction(budgetOf(turn, sheet), {
    what: "another object",
    who: sheet.name,
    fastHands: hasFastHands(sheet),
    dualWielder: dualWields(sheet.feats, sheet.campaignId),
  });
  const bonus = result.ok && result.budget.bonusUsed && !turn.bonusUsed;
  return {
    cost: bonus ? "bonus" : "action",
    note: bonus
      ? t("Your free object interaction is spent: Fast Hands makes this one your bonus action.")
      : t("Your free object interaction is spent: this one takes the Use an Object action."),
    gate: interactionGate(result, sheet.name, "another object", t),
  };
}

// The engine's refusals the gear cards carry (src/lib/dm/gear-hands.ts),
// matched exactly and carried into the reader's words; a sentence the
// mapping has not met keeps the engine's English. Each mapping, refusal → key:
//   handsFullError, a draw with no hand free → table.hand.gear.handsFull
//   spendInteraction, the action gone → table.hand.gear.interactionSpentAction
//   spendInteraction, an attack cannot draw too → table.hand.gear.interactionSpentAttack
// The "already went on" clause names what the budget spent, which the Hand
// always builds as "an object" (budgetOf); a different wording falls back.
function handsFullReason(who: string, what: string, full: readonly string[], t: T): string {
  const items = full.join(" and ");
  if (
    handsFullError(who, what, full) ===
    `${who}'s hands are full (${items}), so ${what} cannot be drawn yet. Dropping one is free (handle_item drop); putting one away takes the object interaction.`
  ) {
    return t("{name}'s hands are full ({items}), so {what} cannot be drawn yet. Dropping one is free (handle_item drop); putting one away takes the object interaction.", { name: who, items, what });
  }
  return handsFullError(who, what, full);
}

function interactionGate(result: SpendResult, who: string, what: string, t: T): Gate {
  if (result.ok) {
    return null;
  }
  const spent = `${who}'s free object interaction this turn already went on an object`;
  if (result.error === `${spent}, and ${what} would be a second: that takes the Use an Object action, which ${who} has already spent. It can wait for their next turn.`) {
    return { reason: t("{name}'s free object interaction this turn already went on an object, and {what} would be a second: that takes the Use an Object action, which {name} has already spent. It can wait for their next turn.", { name: who, what }), spent: true };
  }
  if (result.error === `${spent}, and ${what} would be a second, which takes the Use an Object action: an attack cannot draw it as well. ${who} attacks with what they hold, or draws it on their next turn.`) {
    return { reason: t("{name}'s free object interaction this turn already went on an object, and {what} would be a second, which takes the Use an Object action: an attack cannot draw it as well. {name} attacks with what they hold, or draws it on their next turn.", { name: who, what }), spent: true };
  }
  return { reason: result.error, spent: true };
}

export function gearCards(sheet: CharacterSheet, turn: HandTurn, context: HandGearContext = {}, t: T = enT): HandCard[] {
  const standing = standingGate(sheet, turn, "action", t);
  const free = standingGate(sheet, turn, "free", t);
  const interaction = interactionCost(sheet, turn, t);
  const touch = { cost: interaction.cost, resource: interaction.cost === "free" ? "Interaction" : "", interaction: true };
  const cards: HandCard[] = [];
  const equipment = sheet.equipment;
  const explicit = wearingIsExplicit(equipment);
  const weapons = once(equipment.filter((item) => gearKindOf(item) === "weapon"), (item) => item.name);
  const held = weapons.filter((item) => inHand(item, equipment));
  const stowed = explicit ? weapons.filter((item) => item.equipped !== true) : [];
  // While the hands are the engine's guess, the first draw or stow is free
  // and a draw puts the guessed weapons in its way away (gear-hands.ts
  // guessedRehand), as handle_item charges it.
  const guess = guessStands(equipment);
  const guessNote = "Free this once: nobody has said which weapon is out, so the first change from the game's pick costs nothing.";
  const handle = guess ? { cost: "free" as const, resource: "", interaction: false } : touch;

  // The shield: on the arm or off it, an action either way.
  const shield = equipment.find((item) => gearKindOf(item) === "shield");
  if (shield) {
    const worn = inHand(shield, equipment);
    cards.push(
      gated(
        card(
          worn ? "doff-shield" : "don-shield",
          worn ? t("Take off {name}", { name: shield.name }) : t("Strap on {name}", { name: shield.name }),
          worn ? "unequip" : "equip",
          "action",
          worn ? t("An action to take it off: your AC drops by its bonus, and the hand is free.") : t("An action to strap it on: its bonus to AC, and that hand is taken."),
          { kind: "item", key: shield.name, family: "item-armor" },
          { choice: pick(t("Shield"), [rowPick(shield)]) },
          t,
        ),
        standing,
        costGate("action", turn, sheet, worn ? `taking off ${shield.name}` : `strapping on ${shield.name}`, t),
      ),
    );
  }

  if (stowed.length) {
    // Only what a free hand can take; with none free, the card says how to
    // free one (dropping is free, putting one away is the interaction).
    const fits = stowed.filter((item) => (guess ? guessedRehand(equipment, item) !== null : !handsFullFor(equipment, item).length));
    const full: Gate = fits.length ? null : { reason: handsFullReason(sheet.name, "another weapon", handsFullFor(equipment, stowed[0]), t), spent: false };
    cards.push(
      gated(
        card("draw", t("Draw a weapon"), "equip", handle.cost, `${guess ? guessNote : interaction.note} ${t("A hand holds one weapon; a two-handed one takes both.")}`, { kind: "action", key: "use-object" }, {
          resource: handle.resource,
          interaction: handle.interaction,
          choice: pick(t("Weapon"), (fits.length ? fits : stowed).map(rowPick)),
        }, t),
        standing,
        full,
        guess ? null : interaction.gate,
      ),
    );
  }
  if (held.length) {
    cards.push(
      gated(
        card("stow", t("Stow a weapon"), "unequip", handle.cost, `${guess ? guessNote : interaction.note} ${t("Sheathed or slung, it is ready to draw again.")}`, { kind: "action", key: "use-object" }, {
          resource: handle.resource,
          interaction: handle.interaction,
          choice: pick(t("Weapon"), held.map(rowPick)),
        }, t),
        standing,
        guess ? null : interaction.gate,
      ),
    );
    // Letting go costs nothing, and the thing lies where it fell.
    cards.push(
      gated(
        card("drop", t("Drop"), "drop", "free", t("Free: it falls at your feet and lies there to be picked up."), { kind: "action", key: "use-object" }, {
          choice: pick(t("Item"), held.map(rowPick)),
        }, t),
        free,
      ),
    );
  }

  const reach = (context.drops ?? []).filter((drop) => drop.reach);
  if (reach.length) {
    cards.push(
      gated(
        card("pick-up", t("Pick up"), "pick_up", touch.cost, `${interaction.note} ${t("Something within 5 feet of you.")}`, { kind: "action", key: "use-object" }, {
          resource: touch.resource,
          interaction: touch.interaction,
          choice: pick(t("Item"), once(reach, (drop) => drop.name).map((drop) => ({ value: drop.id, label: drop.name }))),
        }, t),
        standing,
        interaction.gate,
      ),
    );
  }

  // Something passed to an ally within 5 feet: a weapon, a potion, a scroll.
  const passable = once(
    equipment.filter((item) => {
      const kind = gearKindOf(item);
      if (kind === "armor" || kind === "shield" || (kind === "worn" && item.equipped === true)) return false;
      const tags = itemTags(item);
      return kind === "weapon" || tags.includes("potion") || tags.includes("scroll") || tags.includes("consumable");
    }),
    (item) => item.name,
  );
  if (passable.length && (context.allies ?? 0) > 0) {
    cards.push(
      gated(
        card("hand", t("Hand to an ally"), "hand", touch.cost, `${interaction.note} ${t("They must be within 5 feet; it is theirs to use on their turn.")}`, { kind: "action", key: "help" }, {
          resource: touch.resource,
          interaction: touch.interaction,
          target: "ally",
          range: t("5 ft"),
          choice: pick(t("Item"), passable.map(rowPick)),
        }, t),
        standing,
        interaction.gate,
      ),
    );
  }

  // A potion, drunk or poured down an ally's throat: an action (use_item).
  const potions = once(equipment.filter((item) => itemTags(item).includes("potion")), (item) => item.name);
  if (potions.length) {
    cards.push(
      gated(
        card("potion", t("Drink a potion"), "use", "action", t("An action, for you or an ally within reach: a dying ally drinks too."), { kind: "item", key: potions[0].name, family: "item-gear" }, {
          target: "ally",
          range: t("Touch"),
          choice: pick(t("Potion"), potions.map(rowPick)),
        }, t),
        standing,
        costGate("action", turn, sheet, "drinking a potion", t),
      ),
    );
  }

  // Basics that only matter now and then.
  const dying = context.dying ?? [];
  if (dying.some((ally) => ally.id !== sheet.id)) {
    cards.push(
      gated(
        {
          ...BLANK,
          id: "basic:stabilize",
          type: "basic",
          name: t("Stabilize"),
          cost: "action",
          range: t("Touch"),
          dice: t("Medicine DC 10"),
          roll: t("skill check"),
          rules: t("An action: a DC 10 Medicine check, or a healer's kit with no roll, and they stop dying."),
          icon: { kind: "action", key: "help" },
          target: "ally",
          intent: { card: "basic", action: "stabilize" },
        },
        standing,
        costGate("action", turn, sheet, "stabilizing", t),
      ),
    );
  }
  if (context.mount) {
    cards.push(
      gated(
        {
          ...BLANK,
          id: "basic:dismount",
          type: "basic",
          name: t("Dismount"),
          cost: "free",
          range: t("Self", { context: "table.hand.range.self" }),
          rules: t("Off {mount}: half your speed.", { mount: context.mount }),
          icon: { kind: "action", key: "stand-up" },
          target: "none",
          intent: { card: "basic", action: "dismount" },
        },
        standingGate(sheet, turn, "move", t),
      ),
    );
  }
  return cards;
}

// What playing a packed weapon's card does while the hands are still the
// engine's guess: the words for the card, or null when the normal draw holds.
export function guessDrawNote(sheet: CharacterSheet, weapon: string): string | null {
  const row = sheet.equipment.find((item) => textKey(item.name) === textKey(weapon));
  const guessed = row && row.equipped !== true ? guessedRehand(sheet.equipment, row) : null;
  if (!row || !guessed) return null;
  const away = guessed.putAway.length ? `puts away ${guessed.putAway.join(" and ")} and ` : "";
  return `Packed away: playing it ${away}takes it up, free this once, as nobody has said which weapon is out.`;
}

// Where a carried weapon is, for its attack card: in hand, or packed away
// so the attack draws it. Nothing on a sheet that has not said what it holds,
// nor for a name no weapon row carries (a lineage's claws, a beast's bite).
export function wieldOf(sheet: CharacterSheet, weapon: string): "in-hand" | "stowed" | undefined {
  if (!wearingIsExplicit(sheet.equipment)) return undefined;
  const row = sheet.equipment.find((item) => textKey(item.name) === textKey(weapon));
  if (!row || gearKindOf(row) !== "weapon") return undefined;
  return row.equipped === true ? "in-hand" : "stowed";
}

// The Attack action draws the weapon it swings with when a hand is free and
// the interaction is too (pc-attack-plan.ts); otherwise a stowed weapon is
// not swung this turn, in the engine's own words.
export function undrawnGate(sheet: CharacterSheet, turn: HandTurn, weapon: string, t: T = enT): Gate {
  if (!wearingIsExplicit(sheet.equipment)) return null;
  const row = sheet.equipment.find((item) => textKey(item.name) === textKey(weapon));
  if (!row || gearKindOf(row) !== "weapon" || row.equipped === true) return null;
  // The engine's guess at what is in hand never shuts a card: the first
  // weapon played while it stands is taken up free (gear-hands.ts).
  if (guessedRehand(sheet.equipment, row)) return null;
  const full = handsFullFor(sheet.equipment, row);
  if (full.length) return { reason: handsFullReason(sheet.name, row.name, full, t), spent: false };
  if (!turn.interactionUsed) return null;
  const result = spendInteraction(budgetOf(turn, sheet), { what: `drawing ${row.name}`, who: sheet.name, withAction: false });
  return interactionGate(result, sheet.name, `drawing ${row.name}`, t);
}
