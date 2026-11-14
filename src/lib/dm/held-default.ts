// What a character holds before anyone has said. A sheet that marks nothing
// was read as holding every weapon it carries (src/lib/srd/armor.ts
// wearingIsExplicit), so the Hand offered each one as drawn, GAME STATE had
// no "in hand" line, and a storyteller asked to swing a quarterstaff decided
// for itself that a sling was out and put it away for the player. Every
// sheet now says: the armor and the shield the armor class counted and the
// worn rows whose magic counted stay on, as the first wear toggle keeps them
// (usage-rules.ts implicitlyWorn), and one weapon is in hand: the first the
// character is trained with that fits beside the shield (leaving a caster a
// hand free), and a second light blade beside a light main weapon, so a
// two-weapon fighter keeps both. A companion the storyteller plays is left
// as it was: it has no Hand, and its moves are the storyteller's to make.
// Everything else is packed, and drawing it is the turn's free object
// interaction (gear-hands.ts).
//
// It is a guess, and a guess must never cost anyone a turn: an archer whose
// pack lists Shortsword before Longbow was handed the sword, and the bow's
// card was shut for full hands. So every weapon row it decides carries
// `heldGuess` until someone sets a mark (keepHeldGuess below), and while it
// does the first change is free (gear-hands.ts guessedRehand). Where the
// character's own last attack roll names a weapon they carry, that is the
// one taken up (db/sheets.ts settleHeldGear reads it).
//
// Pure: no database. createSheet gives a new sheet these marks, and a fight
// starting gives them to a sheet saved before (db/encounters.ts).
import { gearKindOf, guessStands, handsFor, weaponRowOf } from "@/lib/dm/gear-hands";
import { implicitlyWorn } from "@/lib/dm/usage-rules";
import type { EquipmentItem } from "@/lib/schemas/sheet";
import { wearingIsExplicit } from "@/lib/srd/armor";
import { wearConflict, wearSlotOf } from "@/lib/srd/wear-slots";
import { isWeaponProficient } from "@/lib/srd/weapons";

// The pack with every row marked worn or not, or null when it already says
// (or carries nothing to say about).
export function defaultHeld(
  equipment: readonly EquipmentItem[],
  armor: { armorName: string | null; shieldName: string | null },
  weaponProfs: readonly string[],
  // A caster keeps a hand free for a spell's gestures (SRD 5.1, Somatic):
  // with a shield on the arm their weapon stays packed until they draw it.
  caster = false,
  // The weapon the character last attacked with, by its row's name.
  preferred: string | null = null,
): EquipmentItem[] | null {
  if (!equipment.length || wearingIsExplicit(equipment)) {
    return null;
  }
  const worn = implicitlyWorn(equipment, armor);
  const shieldHand = [...worn].some((item) => gearKindOf(item) === "shield") ? 1 : 0;
  const room = caster ? 1 : 2;
  const trained = (item: EquipmentItem) => {
    const srd = weaponRowOf(item);
    return srd ? isWeaponProficient([...weaponProfs], srd) : false;
  };
  // Only a weapon they are trained with is taken up: one they are not stays
  // packed, as nothing says they would reach for it.
  const weapons = equipment.filter((item) => gearKindOf(item) === "weapon" && handsFor(item) + shieldHand <= room && trained(item));
  const [main = null] = [...weapons.filter((item) => item.name === preferred), ...weapons];
  const lightMelee = (item: EquipmentItem) => {
    const srd = weaponRowOf(item);
    return srd?.kind === "melee" && new Set(srd.properties ?? []).has("light");
  };
  const second = main && !shieldHand && !caster && lightMelee(main) ? (weapons.find((item) => item !== main && lightMelee(item)) ?? null) : null;
  return equipment.map((item) => ({
    ...item,
    equipped: worn.has(item) || item === main || item === second,
    ...(gearKindOf(item) === "weapon" ? { heldGuess: true as const } : {}),
  }));
}

// The pack with the guess's marks taken off, as it was before the engine
// chose: for choosing again (a fight starting, with a newer last attack).
export function unguessed(equipment: readonly EquipmentItem[]): EquipmentItem[] {
  return equipment.map((item) => {
    const { equipped: _equipped, heldGuess: _guess, ...rest } = item;
    void _equipped;
    void _guess;
    return rest;
  });
}

// The pack a write leaves, with the guess kept only while nobody has set a
// mark. Every path that changes what is held or worn (the sheet's toggle,
// handle_item, an attack that draws, a pick-up, a lead's edit) goes through
// patchSheet, which calls this, so none of them has to remember the flag:
// the moment the held and worn rows differ from before, the guess is gone
// from every row. A write that leaves them as they were keeps the flags the
// sheet had, and never adds one (only the guess itself, `guessing`, does).
export function keepHeldGuess(before: readonly EquipmentItem[], after: EquipmentItem[], guessing = false): EquipmentItem[] {
  if (guessing || !after.some((item) => item.heldGuess === true)) {
    return after;
  }
  // Only rows the sheet already had: gaining a cloak that arrives worn
  // (wearGained) is nobody setting a mark, and leaves the guess standing.
  const had = new Set(before.map((item) => item.name));
  const held = (rows: readonly EquipmentItem[]) => rows.filter((item) => item.equipped === true && had.has(item.name)).map((item) => item.name).sort();
  const was = held(before);
  const now = held(after);
  const moved = !guessStands(before) || was.length !== now.length || was.some((name, at) => name !== now[at]);
  const flagged = new Set(before.filter((item) => item.heldGuess === true).map((item) => item.name));
  return after.map((item) => {
    if (item.heldGuess !== true || (!moved && flagged.has(item.name))) {
      return item;
    }
    const { heldGuess: _guess, ...rest } = item;
    void _guess;
    return rest;
  });
}

// What gained gear arrives as on a sheet that says what it wears. A sheet
// with no marks reads every row as worn (armor.ts isWorn), which is how a
// bought cloak always counted; now that every sheet carries marks, a row
// gained unmarked read as packed, and a magic cloak from the shop added
// nothing until the player found its toggle. So a gained row with a place on
// the body other than armor or a shield arrives worn when its place has room,
// as it did before. A suit, a shield and a weapon arrive packed: donning one
// takes minutes or an action, and drawing a weapon is the turn's object
// interaction (gear-hands.ts). A row is gained when it carries no mark and
// the pack did not already hold an unmarked row of its name: a sheet marked
// before every row was (one toggle pressed on an older sheet) keeps its
// unmarked rows as they read, packed.
export function wearGained(
  before: readonly EquipmentItem[],
  after: EquipmentItem[],
  // The same rows with a workshop item's gear stamped on (db/homebrew.ts
  // hydrateHomebrewGear, one for one): a bought homebrew cloak says it is a
  // cloak only there. The marks are written on `after`.
  seen: readonly EquipmentItem[] = after,
): EquipmentItem[] {
  // A write whose pack marks nothing (a lead's whole pack typed in, an import)
  // says the sheet has not said what it wears; it stays that way.
  if (!wearingIsExplicit(before) || !wearingIsExplicit(after) || !after.some((item) => item.equipped === undefined)) {
    return after;
  }
  const unmarked = new Map<string, number>();
  for (const item of before) {
    if (item.equipped === undefined) {
      unmarked.set(item.name, (unmarked.get(item.name) ?? 0) + 1);
    }
  }
  const next = [...after];
  const view = after.map((item, at) => (seen[at]?.name === item.name ? seen[at] : item));
  next.forEach((item, at) => {
    if (item.equipped !== undefined) {
      return;
    }
    const left = unmarked.get(item.name) ?? 0;
    if (left > 0) {
      unmarked.set(item.name, left - 1);
      return;
    }
    const row = view[at];
    const slot = wearSlotOf(row);
    const worn = Boolean(slot) && slot !== "armor" && slot !== "shield" && gearKindOf(row) !== "weapon" && !wearConflict(row, view);
    next[at] = { ...item, equipped: worn };
    view[at] = { ...row, equipped: worn };
  });
  return next;
}
