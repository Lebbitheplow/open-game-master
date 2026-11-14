// Spell slots the cyberpunk, dark fantasy and horror counters give back, and
// the one helper every slot recovery shares (take_rest's Arcane Recovery and
// Natural Recovery go through it too, src/lib/dm/rest-tools.ts):
//   on a short rest (rest-tools.ts applySlotRecovery): The Net Remembers' "4
//     expended slot levels", Nanite Reserve's "one expended spell slot of 3rd
//     level or lower";
//   by a use_resource spend (resource-tools.ts, the recover_slots effect with
//     `now`): Overmind's and The Tomb Provides' "slot levels equal to your CHA
//     modifier";
//   at the moment it happens: Unfinished Ritual "when you drop below half HP"
//     (pc-damage.ts, genreBelowHalf) and The Debt Comes Due "when you expend
//     your last spell slot" (cast-guard.ts, debtComesDue).
// Before this each was a counter whose spend moved the counter and gave back
// no slot. Never a 6th-level slot or higher, as the SRD's own recoveries.
import { computeSheetDerived } from "@/lib/srd";
import { slotRecoveryPlan } from "@/lib/dm/rest-logic";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";

type Slots = NonNullable<CharacterSheet["spellcasting"]>["slots"];

// Expended slots back, up to `budget` slot levels, at most `maxLevel` each.
// The most slot levels the budget holds, the higher slots among plans worth
// the same (rest-logic.ts slotRecoveryPlan: lowest first once gave a wizard
// with a 1st, a 2nd and a 3rd spent the 1st and the 2nd, never the 3rd), or
// the highest that fits when only `most` slots come back ("one expended
// spell slot of 3rd level or lower" is the 3rd when one is spent).
export function recoverSlotLevels(slots: Slots, budget: number, opts: { maxLevel?: number; most?: number } = {}): { slots: Slots; regained: number[] } {
  const next: Slots = { ...slots };
  const regained: number[] = [];
  const top = Math.min(5, opts.maxLevel ?? 5);
  const order = [1, 2, 3, 4, 5].filter((level) => level <= top);
  let left = budget;
  const take = (level: number) => {
    const slot = next[String(level)];
    if (!slot || slot.used <= 0 || left < level) {
      return false;
    }
    next[String(level)] = { ...slot, used: slot.used - 1 };
    left -= level;
    regained.push(level);
    return true;
  };
  if (opts.most) {
    for (const level of [...order].reverse()) {
      while (regained.length < opts.most && take(level));
    }
    return { slots: next, regained };
  }
  const open = Object.fromEntries(order.map((level) => [String(level), next[String(level)] ?? { max: 0, used: 0 }]));
  for (const level of slotRecoveryPlan(open, budget)) {
    take(level);
  }
  return { slots: next, regained };
}

export const regainedLine = (levels: number[]) => levels.map((level) => `level ${level}`).join(", ");

// Unfinished Ritual: "1/long rest, regain expended slot levels equal to your
// CHA modifier when you drop below half HP". Spent by the drop itself, as the
// drop-to-1 holds are (genre-drop-holds.ts): only a blow that takes the
// apostate from half or more to under half, and only with a slot to give back.
export const UNFINISHED_RITUAL = "horror_unfinished_ritual";

export function genreBelowHalf(
  sheet: CharacterSheet,
  beforeHp: number,
  afterHp: number,
  max: number,
): { patch: FullPatchSheetInput; line: string } | null {
  const state = sheet.resources?.[UNFINISHED_RITUAL];
  // A drop to 0 is a drop below half too; only a hero killed outright is past it.
  if (!state || state.used >= state.max || !sheet.spellcasting || !(beforeHp >= max / 2 && afterHp < max / 2) || sheet.deathSaves?.dead) {
    return null;
  }
  const budget = Math.max(1, computeSheetDerived(sheet).abilityMods.cha);
  const back = recoverSlotLevels(sheet.spellcasting.slots, budget);
  if (!back.regained.length) {
    return null;
  }
  return {
    patch: {
      spellcasting: { ...sheet.spellcasting, slots: back.slots },
      resources: { ...sheet.resources, [UNFINISHED_RITUAL]: { max: state.max, used: state.used + 1 } },
    },
    line: `Unfinished Ritual: dropping below half, ${sheet.name} regains spell slots (${regainedLine(back.regained)}). The use is spent until a long rest.`,
  };
}

// The Debt Comes Due: "1/long rest, when you expend your last spell slot,
// immediately regain it". Asked by the cast guard once a cast's slot is paid:
// the slot paid comes straight back when it left none of the occultist's slots
// (pact slots with them) unspent.
export const DEBT_COMES_DUE = "horror_the_debt_comes_due";

export function debtComesDue(
  sheet: CharacterSheet,
  casting: NonNullable<CharacterSheet["spellcasting"]>,
  resources: CharacterSheet["resources"],
  paid: { kind: "slot" | "pact"; level: number },
): { spellcasting: NonNullable<CharacterSheet["spellcasting"]>; resources: CharacterSheet["resources"]; line: string } | null {
  const state = resources?.[DEBT_COMES_DUE];
  if (!state || state.used >= state.max) {
    return null;
  }
  const slotsLeft = Object.values(casting.slots).some((slot) => slot.used < slot.max);
  const pactLeft = casting.pact ? casting.pact.used < casting.pact.max : false;
  if (slotsLeft || pactLeft) {
    return null;
  }
  const back =
    paid.kind === "pact" && casting.pact
      ? { ...casting, pact: { ...casting.pact, used: Math.max(0, casting.pact.used - 1) } }
      : casting.slots[String(paid.level)]
        ? { ...casting, slots: { ...casting.slots, [String(paid.level)]: { ...casting.slots[String(paid.level)], used: Math.max(0, casting.slots[String(paid.level)].used - 1) } } }
        : null;
  if (!back) {
    return null;
  }
  return {
    spellcasting: back,
    resources: { ...resources, [DEBT_COMES_DUE]: { max: state.max, used: state.used + 1 } },
    line: `The Debt Comes Due: that was ${sheet.name}'s last spell slot, and it comes straight back (level ${paid.level}). The use is spent until a long rest.`,
  };
}
