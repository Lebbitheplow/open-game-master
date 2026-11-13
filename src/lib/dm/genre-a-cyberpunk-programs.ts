// What a cyberpunk caster's features add to their programs and psionics, the
// spells they cast (WAVE2 D5: "Casts wizard-list spells as intrusion
// programs", "sorcerer-list spells as psionics"). Read where a spell attack
// is built, so the swing and the Hand's card carry the same:
//   program_rider (Lethal Payload, "1/turn, a damaging program deals +1d8
//     lightning damage to one target"; Neural Spike, "1/turn, add your CHA
//     modifier as psychic damage to a damaging psionic"): a feature rider of
//     the spell attack (attack-damage-riders.ts), its own type, claimed once
//     a turn on the turn budget as Divine Strike's is;
//   program_crit (Flatline Protocol, "Your programs score a critical on 19-20
//     against constructs and spellcasters"): the attack's critical range
//     (attack-record.ts), against a creature of those types or one whose
//     block casts spells.
//   heal_floor (Perfected Formula, "Your healing dice each count as at least
//     half their maximum"): every die of the holder's heals, a counter's
//     (resource-tools.ts heal_target) and a spell's (heal-spell.ts), floored
//     at half its faces.
// Pure: the sheet and the target come in as values.
import { activeAuthored, resolveFormula } from "@/lib/srd/authored-effects";
import type { CombatRiders } from "@/lib/srd/feature-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { textKey } from "@/lib/language/text-logic";

type Rider = CombatRiders["damageRiders"][number];

const mods = (sheet: Pick<CharacterSheet, "abilities">) =>
  Object.fromEntries(Object.entries(sheet.abilities).map(([ability, score]) => [ability, Math.floor((score - 10) / 2)]));

export function programRiders(sheet: CharacterSheet): Rider[] {
  return activeAuthored(sheet, "program_rider").map(({ effect, held }) => ({
    feature: held.feature,
    dice: resolveFormula(effect.dice, held.level, mods(sheet)),
    type: effect.type,
    when: "weapon",
    oncePerTurn: Boolean(effect.oncePerTurn),
  }));
}

export function programCritRange(sheet: CharacterSheet, target: { stats?: { type?: string; spellcasting?: unknown } } | undefined): number {
  let low = 20;
  const type = textKey(target?.stats?.type ?? "");
  for (const { effect } of activeAuthored(sheet, "program_crit")) {
    const typed = effect.vsTypes.some((kind) => type.includes(kind));
    if (typed || (effect.casters && Boolean(target?.stats?.spellcasting))) {
      low = Math.min(low, effect.low);
    }
  }
  return low;
}

// "3d6+4" becomes "3d6f3+4" for a holder of a heal_floor row.
export function healDiceFloor(sheet: CharacterSheet, expression: string): string {
  if (!activeAuthored(sheet, "heal_floor").length) {
    return expression;
  }
  return expression.replace(/(\d{1,3})d(\d{1,3})(?:f\d{1,3})?(?![\df])/gi, (_term, count: string, sides: string) => `${count}d${sides}f${Math.ceil(Number(sides) / 2)}`);
}
