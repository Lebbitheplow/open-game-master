// Hands and gear in a fight (issue #424): what a carried row is, what it
// takes to wear or hold it, and the one free object interaction a turn.
//
// SRD 5.1, Actions in Combat: a character may interact with one object for
// free during their move or action (draw or stow a weapon, pick something
// up, hand it over); a second object takes the Use an Object action.
// Dropping something costs nothing. Getting Into and Out of Armor: a shield
// is an action to don or doff; armor takes minutes, so it never changes
// mid-fight. Dual Wielder draws or stows two one-handed weapons where one
// would go.
//
// Pure: no database. The tool that moves the gear (gear-tool.ts), the
// attack that draws a weapon (pc-attack-plan.ts), the sheet's own toggle
// (sheet/usage) and the Hand's cards all ask here, so they charge alike.
import { spendAction, type SpendResult, type TurnBudget } from "@/lib/dm/action-budget";
import { weaponOf } from "@/lib/dm/attack-logic";
import { magicWeaponOfRow } from "@/lib/dm/gear-attack";
import type { EquipmentItem } from "@/lib/schemas/sheet";
import { armorOfRow, guessStands, isWorn, wearingIsExplicit } from "@/lib/srd/armor";
import { wearSlotOf } from "@/lib/srd/wear-slots";
import { matchWeapon, type SrdWeapon } from "@/lib/srd/weapons";
import { textKey } from "@/lib/language/text-logic";

export type GearKind = "armor" | "shield" | "weapon" | "worn" | "carried";

// The weapon a carried row swings as, the way the attack reads it: a
// homebrew block, a magic weapon's base item, the SRD table by name.
export function weaponRowOf(item: EquipmentItem): SrdWeapon | null {
  const magic = magicWeaponOfRow(item);
  return (magic.gear ? magic.srd : null) ?? weaponOf(item) ?? matchWeapon(item);
}

export function gearKindOf(item: EquipmentItem): GearKind {
  const armor = armorOfRow(item)?.armor;
  if (armor) {
    return armor.category === "shield" ? "shield" : "armor";
  }
  if (weaponRowOf(item)) {
    return "weapon";
  }
  return wearSlotOf(item) ? "worn" : "carried";
}

// How many hands a held row takes: a two-handed weapon both, anything
// else one.
export function handsFor(item: EquipmentItem): number {
  return (weaponRowOf(item)?.properties ?? []).includes("two-handed") ? 2 : 1;
}

// What the hands hold on a sheet that says what it wears: the shield on the
// arm and the weapons marked equipped. A sheet that marks nothing is read as
// holding all of it, as the armor engine reads it, and so says nothing here.
export function heldRows(equipment: readonly EquipmentItem[]): EquipmentItem[] {
  if (!wearingIsExplicit(equipment)) {
    return [];
  }
  return equipment.filter((item) => {
    const kind = gearKindOf(item);
    return (kind === "weapon" || kind === "shield") && item.equipped === true;
  });
}

// Whether the row is in hand (or worn): explicit sheets say so per row,
// a never-touched sheet holds everything.
export function inHand(item: EquipmentItem, equipment: readonly EquipmentItem[]): boolean {
  return isWorn(item, equipment);
}

// What fills the hands besides this row, when there is no room left for
// it: the shield on the arm and the weapons held. Empty when it fits. A
// two-handed weapon needs both hands; anything else one.
export function handsFullFor(equipment: readonly EquipmentItem[], row: EquipmentItem): string[] {
  const others = heldBeside(equipment, row);
  const used = others.reduce((sum, item) => sum + handsFor(item), 0);
  return used + handsFor(row) > 2 ? others.map((item) => item.name) : [];
}

// What the hands hold apart from this row, whichever copy of it was asked.
function heldBeside(equipment: readonly EquipmentItem[], row: EquipmentItem): EquipmentItem[] {
  return heldRows(equipment).filter((item) => item !== row && textKey(item.name) !== textKey(row.name));
}

// What the sheet is told when full hands stop a row it could take up for
// nothing: the row, what fills the hands, and the choices in `swaps`.
export type HandsFull = { item: string; holding: string[]; swaps: string[][] };

// The ways to make room for a row the full hands cannot take (issue 1105):
// each entry names the held weapons to put away. A dagger dragged onto two
// blades put the last one away unasked, and the drag back was refused with
// no way on; the sheet now offers these instead. Every single weapon that
// frees enough is its own choice; when none does (a two-handed weapon wants
// both hands) the one choice is all of them together. Empty when the row
// already fits, and when putting every weapon away would still leave no
// room: a shield comes off the arm by its own rule (an action in a fight),
// so it is never offered here.
export function handSwaps(equipment: readonly EquipmentItem[], row: EquipmentItem): string[][] {
  const others = heldBeside(equipment, row);
  const over = others.reduce((sum, item) => sum + handsFor(item), 0) + handsFor(row) - 2;
  if (over <= 0) {
    return [];
  }
  const weapons = others.filter((item) => gearKindOf(item) === "weapon");
  const singles = [...new Set(weapons.filter((item) => handsFor(item) >= over).map((item) => item.name))];
  if (singles.length) {
    return singles.map((name) => [name]);
  }
  const freed = weapons.reduce((sum, item) => sum + handsFor(item), 0);
  return freed >= over ? [[...new Set(weapons.map((item) => item.name))]] : [];
}

// Whether the engine's guess at what is in hand still stands (armor.ts).
export { guessStands };

// The free first change from the engine's guess. Its pick came from list
// order, not from the player, so a weapon they take up while it stands is
// drawn as part of the same act and the guessed weapons in the way are put
// away with it (last chosen first, only as many as the hands need), with no
// object interaction spent on either. A shield stays: the armor class
// counted it, and taking it off is an action. Null when the guess is gone,
// the row is not a weapon, or the shield alone leaves no room. The pack
// comes back with every guess mark off, so the normal rule holds after.
export function guessedRehand(
  equipment: readonly EquipmentItem[],
  row: EquipmentItem,
): { equipment: EquipmentItem[]; putAway: string[] } | null {
  const at = equipment.indexOf(row);
  if (at < 0 || !guessStands(equipment) || gearKindOf(row) !== "weapon") {
    return null;
  }
  const next: EquipmentItem[] = equipment.map((item, index) => {
    const { heldGuess: _guess, ...rest } = item;
    void _guess;
    return index === at ? { ...rest, equipped: true } : rest;
  });
  const guessed = equipment
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => index !== at && item.heldGuess === true && item.equipped === true && gearKindOf(item) === "weapon");
  const putAway: string[] = [];
  while (handsFullFor(next, next[at]).length) {
    const last = guessed.pop();
    if (!last) {
      return null;
    }
    next[last.index] = { ...next[last.index], equipped: false };
    putAway.unshift(last.item.name);
  }
  return { equipment: next, putAway };
}

// What the free first change did, in the result's words. Out of a fight
// every change is free, and saying "the first change costs nothing" there
// told the reader the next one would cost something (issue 1105).
export function rehandLine(who: string, putAway: readonly string[], taken: string, inFight = true): string {
  const away = putAway.length ? `puts away ${putAway.join(" and ")} and ` : "";
  return inFight
    ? `${who} ${away}takes up ${taken}, free: nobody had said which weapon was out, so the first change from the game's pick costs nothing.`
    : `${who} ${away}takes up ${taken}.`;
}

// Whether the free first change would have to pick which weapon goes back
// in the pack: more than one held weapon would make room, and nobody said
// which. The sheet asks (sheet/usage handSwaps); handle_item is told to ask
// rather than put away the last one in the pack, as it did for a dagger
// drawn beside a scimitar and a shortsword (issue 1105).
export function rehandIsAChoice(equipment: readonly EquipmentItem[], row: EquipmentItem, rehand: { putAway: readonly string[] } | null): boolean {
  return Boolean(rehand?.putAway.length) && handSwaps(equipment, row).length > 1;
}

// The ways out of full hands, for each reader: the storyteller is told the
// tool that drops, a player never sees a tool's name (the Hand's card, the
// sheet's refusal, a card the GM's seat played).
//
// Out of a fight there is no turn and no object interaction to spend (issue
// 1105): a player was told that putting a weapon away "takes your object
// interaction this turn" while walking down a road, and had to ask the
// storyteller twice to swap one blade for another. So the readers at ease
// are told it costs nothing, and the storyteller the two calls that do it.
// While the hands are still the engine's guess the first change is free in
// a fight as well (guessedRehand above), which `firstChange` says. None of
// them opens with "No fight is running": that is how a tool says it needs a
// fight, and this refusal is about hands.
const WAYS_OUT: Record<"storyteller" | "player" | "storytellerAtEase" | "atEase" | "storytellerFirstChange" | "firstChange", string> = {
  storyteller: "Dropping one is free (handle_item drop); putting one away takes the object interaction.",
  player: "Dropping one is free; putting one away takes your object interaction this turn.",
  storytellerAtEase: "Out of a fight putting one away is free: call handle_item unequip for the one the player named, then equip again. If they named none, ask them which.",
  atEase: "Put one of them away first: out of a fight that costs nothing.",
  storytellerFirstChange: "Nobody had said which weapon was out, so putting one away costs nothing: call handle_item unequip for the one the player named, then equip again. If they named none, ask them which.",
  firstChange: "Put one of them away first: nobody had said which weapon was out, so this first change costs nothing.",
};

// Each storyteller's sentence beside the one a person reads in its place.
const FOR_PLAYER: ReadonlyArray<[string, string]> = [
  [WAYS_OUT.storyteller, WAYS_OUT.player],
  [WAYS_OUT.storytellerAtEase, WAYS_OUT.atEase],
  [WAYS_OUT.storytellerFirstChange, WAYS_OUT.firstChange],
];

// The refusal for a draw with no hand free, with the ways out: dropping
// costs nothing, putting one away is the object interaction.
export function handsFullError(
  who: string,
  what: string,
  full: readonly string[],
  verb: "drawn" | "strapped on" = "drawn",
  reader: keyof typeof WAYS_OUT = "storyteller",
): string {
  return `${who}'s hands are full (${full.join(" and ")}), so ${what} cannot be ${verb} yet. ${WAYS_OUT[reader]}`;
}

// A tool's refusal shown to a person rather than the storyteller (a card the
// GM's seat played resolves through the tools): the hands-full ways out in
// a player's words.
export function handsFullForPlayer(text: string): string {
  return FOR_PLAYER.reduce((words, [told, read]) => words.split(told).join(read), text);
}

// Takes a weapon in hand: the row marked equipped. A hand must be free for
// it (SRD 5.1: putting another away is an object interaction of its own, so
// it is never folded into the draw); with none, the names that fill them.
// A sheet that never said what it held starts saying so: the armor and the
// shield it was wearing stay on (src/lib/dm/usage-rules.ts implicitlyWorn
// reads it the same way).
export function drawRow(
  equipment: readonly EquipmentItem[],
  row: EquipmentItem,
  wornBefore: ReadonlySet<EquipmentItem> | null,
): { equipment: EquipmentItem[]; full: string[] } {
  const explicit = wearingIsExplicit(equipment);
  const next = equipment.map((item) =>
    item === row
      ? { ...item, equipped: true }
      : explicit
        ? item
        : { ...item, equipped: wornBefore?.has(item) ?? gearKindOf(item) === "armor" },
  );
  const drawn = next[equipment.indexOf(row)];
  const full = drawn ? handsFullFor(next, drawn) : [];
  return full.length ? { equipment: [...equipment], full } : { equipment: next, full: [] };
}

// Something taken up (picked up off the ground, handed over) is held when
// a hand is free for it, as a weapon picked up is in the hand that took it;
// with the hands full it goes to the pack. A sheet that never said what it
// holds holds everything already.
export function holdIfFree(equipment: readonly EquipmentItem[], name: string): { equipment: EquipmentItem[]; held: boolean } {
  const rows = [...equipment];
  if (!wearingIsExplicit(rows)) {
    return { equipment: rows, held: true };
  }
  const row = rows.find((item) => textKey(item.name) === textKey(name));
  if (!row || gearKindOf(row) !== "weapon") {
    return { equipment: rows, held: false };
  }
  if (row.equipped === true) {
    return { equipment: rows, held: true };
  }
  const used = heldRows(rows).reduce((sum, item) => sum + handsFor(item), 0);
  if (used + handsFor(row) > 2) {
    return { equipment: rows, held: false };
  }
  return { equipment: rows.map((item) => (item === row ? { ...item, equipped: true } : item)), held: true };
}

// The one free object interaction. A second object takes the Use an Object
// action (or a Thief's Fast Hands bonus action), unless `withAction` is
// false: an attack that draws its weapon is the Attack action and cannot be
// Use an Object as well.
export function spendInteraction(
  budget: TurnBudget,
  input: {
    what: string;
    who: string;
    // A one-handed weapon drawn or stowed: Dual Wielder takes two with the
    // one interaction.
    oneHandedWeapon?: boolean;
    dualWielder?: boolean;
    fastHands?: boolean;
    withAction?: boolean;
  },
): SpendResult {
  const used = budget.interaction;
  if (!used) {
    return {
      ok: true,
      budget: { ...budget, interaction: { what: input.what, weapons: input.oneHandedWeapon ? 1 : 0 } },
      note: `${input.who}'s free object interaction this turn`,
    };
  }
  if (input.dualWielder && input.oneHandedWeapon && used.weapons === 1) {
    return {
      ok: true,
      budget: { ...budget, interaction: { what: `${used.what} and ${input.what}`, weapons: 2 } },
      note: `Dual Wielder: a second one-handed weapon with the same interaction`,
    };
  }
  const second = `${input.who}'s free object interaction this turn already went on ${used.what}`;
  if (input.withAction !== false) {
    const action = spendAction(budget, "action", "use an object", input.who);
    if (action.ok) {
      return { ...action, note: action.note ?? `${input.who}'s action (Use an Object): ${second}` };
    }
    if (input.fastHands) {
      const bonus = spendAction(budget, "bonus", "Fast Hands (use an object)", input.who);
      if (bonus.ok) {
        return { ...bonus, note: `${input.who}'s bonus action (Fast Hands): ${second}` };
      }
    }
    return {
      ok: false,
      error: `${second}, and ${input.what} would be a second: that takes the Use an Object action, which ${input.who} has already spent. It can wait for their next turn.`,
      refused: "rules",
    };
  }
  return {
    ok: false,
    error: `${second}, and ${input.what} would be a second, which takes the Use an Object action: an attack cannot draw it as well. ${input.who} attacks with what they hold, or draws it on their next turn.`,
    refused: "rules",
  };
}
