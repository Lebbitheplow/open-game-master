// The steampunk classes' features that change a weapon attack's roll, the
// number of attacks an Attack action holds and a spend's cost, read from the
// sheet and the turn's marks alone so pc_attack, use_resource and the Hand ask
// the same reader (WAVE2 D5: the genre text is the rule):
//
//   Prodigy's Precision (gadgeteer)  "Add +1d4 to attack rolls made with
//     gadget-augmented weapons (tech blades and firearms you have tuned)."
//   Auto-Loader Harness (gadgeteer)  "Once per turn, make one extra firearm
//     attack as part of the Attack action."
//   Sky Duelist (aeronaut)           "Your critical hits with one-handed
//     weapons knock the target prone or disarm it (your choice)."
//   The Engine Eternal (steam knight) "Head of Steam is free once per turn."
//
// Before this each was its sentence in the GM's prompt: the tuned pistol
// rolled a bare d20, the harness gave no shot, the first Head of Steam cost
// the bonus action.
//
// Pure: no database, so the Hand imports it.
import type { SpendResult, TurnBudget } from "@/lib/dm/action-budget";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { weaponNamed } from "@/lib/srd/weapons";
import { textKey } from "@/lib/language/text-logic";

type Holder = Pick<CharacterSheet, "class" | "features"> & Partial<Pick<CharacterSheet, "classes" | "name">>;
// The weapon a swing is made with, by its SRD row (AttackProfile.base): absent
// for an unarmed strike, an improvised weapon or a natural one.
type Swing = { base?: string | null };

const isFirearm = (swing: Swing) => weaponNamed(swing.base ?? "")?.category === "firearm";

// Prodigy's Precision: the d4 on the attack roll of a weapon the gadgeteer has
// tuned. A gadgeteer tunes the weapons they carry (genre-b-combat.ts
// genreWornRiders reads Masterwork Arsenal the same way), so every weapon of
// the SRD table in their hands is one; a fist or a chair leg is not.
// src/lib/dm/attack-roll-extras.ts adds it to the roll and the card.
export function tunedAttackDie(sheet: Partial<Holder>, swing: Swing | undefined): { dice: string; note: string } | null {
  if (!swing?.base || !weaponNamed(swing.base) || !sheet.class || !sheet.features) {
    return null;
  }
  if (!holdsGenreFeature(sheet as Holder, "gadgeteer", "Prodigy's Precision")) {
    return null;
  }
  return { dice: "1d4", note: "Prodigy's Precision: +1d4 to the attack roll with a tuned weapon" };
}

// The turn's mark that the harness's extra attack has been made.
export const AUTO_LOADER = "auto-loader harness";
// A firearm attack was made in this turn's Attack action. Kept only for a
// holder of the harness: of the attacks the action then holds, one is the
// harness's shot, in whatever order they were made.
export const FIREARM_FIRED = "firearm-attack-made";

const holdsHarness = (sheet: Holder) => holdsGenreFeature(sheet, "gadgeteer", "Auto-Loader Harness");

// One swing of the Attack action by a holder of the Auto-Loader Harness,
// around the engine's own spend (pc-attack-spend.ts hands it spendAttack).
// Once the action's own attacks are made, one more is open, once a turn, as
// long as a firearm attack is among the turn's: this swing, or one made
// before it. The allowance is raised for this one spend and put back, so an
// Action Surge's new action counts its attacks from one as any other does.
// With no firearm attack among them the refusal says what the extra one is.
export function autoLoaderSwing(sheet: Holder, swing: Swing, budget: TurnBudget, spend: (budget: TurnBudget) => SpendResult): SpendResult {
  if (!holdsHarness(sheet)) {
    return spend(budget);
  }
  const firearm = isFirearm(swing);
  const marks = firearm && !budget.oncePerTurn.includes(FIREARM_FIRED) ? [...budget.oncePerTurn, FIREARM_FIRED] : budget.oncePerTurn;
  const marked = { ...budget, oncePerTurn: marks };
  // The action's own attacks are made, and it was the Attack action that made them.
  const gone = budget.attacksMade > 0 && budget.attacksMade >= budget.attacksAllowed && !budget.castThisAction;
  if (!gone || budget.oncePerTurn.includes(AUTO_LOADER)) {
    return spend(marked);
  }
  if (!marks.includes(FIREARM_FIRED)) {
    // Another whole action (Action Surge) or Haste's attack may still pay for it.
    const plain = spend(marked);
    return plain.ok || budget.slowed
      ? plain
      : {
          ok: false,
          error: `${sheet.name ?? "They"} has made all ${budget.attacksAllowed} attack${budget.attacksAllowed === 1 ? "" : "s"} of the Attack action. Auto-Loader Harness gives one more this turn, and it is a firearm attack: none of this turn's attacks was made with a firearm. They fire a firearm, or do something else.`,
          refused: "rules",
        };
  }
  const spent = spend({ ...marked, attacksAllowed: budget.attacksAllowed + 1, oncePerTurn: [...marks, AUTO_LOADER] });
  if (!spent.ok) {
    return spent;
  }
  const note = "Auto-Loader Harness: one extra firearm attack this turn as part of the Attack action";
  return { ...spent, budget: { ...spent.budget, attacksAllowed: budget.attacksAllowed }, note: spent.note ? `${spent.note} ${note}.` : note };
}

// What the Hand adds to the attacks a card's gate counts (hand.ts): 1 while
// the harness's extra attack is open for that weapon. `swing` null: the
// board's attack verb, open while the extra attack is unspent, whatever weapon
// the player goes on to pick.
export function autoLoaderOpen(sheet: Holder, swing: Swing | null, marks: readonly string[]): number {
  if (!holdsHarness(sheet) || marks.includes(AUTO_LOADER)) {
    return 0;
  }
  return swing === null || isFirearm(swing) || marks.includes(FIREARM_FIRED) ? 1 : 0;
}

// The mark a disarmed creature carries, the one Disarming Attack lays
// (src/lib/dm/pc-attack-riders.ts MANEUVER_RIDERS). Sky Duelist's critical
// hit lays it (src/lib/dm/genre-b-steampunk-hits.ts) and Backup Rig ends it on
// its holder (src/lib/dm/genre-b-steampunk-spends.ts).
export const DISARMED = "disarmed";

// Sky Duelist: a critical hit with a weapon held in one hand. The weapon's own
// row says so (no two-handed property): a longsword gripped in both hands is
// still a one-handed weapon, a fist or a chair leg is no weapon of the table.
export function skyDuelistCrit(sheet: Holder, swing: Swing, crit: boolean): boolean {
  const weapon = crit && swing.base ? weaponNamed(swing.base) : null;
  return Boolean(weapon && !(weapon.properties ?? []).includes("two-handed") && holdsGenreFeature(sheet, "aeronaut", "Sky Duelist"));
}

// The turn's mark that the free Head of Steam has been built.
const FREE_HEAD_OF_STEAM = "head of steam:free";

// The Engine Eternal: the once-a-turn key under which this spend costs nothing
// of the turn, or null when it costs what it always does. `marks`: the
// holder's own turn's (absent off their turn, where nothing is waived).
// src/lib/dm/authored-spends.ts charges by it and the Hand's card prices by it.
export function freeSpendKey(sheet: Holder, spendName: string, marks: readonly string[] | undefined): string | null {
  if (!marks || textKey(spendName) !== textKey("Head of Steam") || marks.includes(FREE_HEAD_OF_STEAM)) {
    return null;
  }
  return holdsGenreFeature(sheet, "steam_knight", "The Engine Eternal") ? FREE_HEAD_OF_STEAM : null;
}
