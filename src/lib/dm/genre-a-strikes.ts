// What the cyberpunk, dark fantasy and horror classes' features add to a
// character's weapon attack: the damage some hits carry (Anathema's radiant
// against fiends and undead, Gutter Fighting against a creature that has not
// acted, Cinder Palms on an unarmed strike, a pact blade's necrotic) and the
// bonus some attack rolls carry (Zeal Through Pain, Desperate Strength,
// Combat Wetware). The rows are the authored layer's (hit_rider,
// attack_bonus in src/lib/srd/authored-effects-genre-a.ts); this is their one
// reader, called by attack-damage-riders.ts, which both pc_attack (through
// pc-attack-damage.ts foldDamageRiders) and the Hand's attack cards read, so
// a card cannot print a rider the swing does not roll.
//
// Pure: the sheet, the attack's profile and what the caller knows of the
// target. Before this every one of these was a line of the GM's prompt.
import { activeAuthored, resolveFormula } from "@/lib/srd/authored-effects";
import type { CombatRiders } from "@/lib/srd/feature-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { Encounter } from "@/lib/db/encounters";
import { textKey } from "@/lib/language/text-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";

type Rider = CombatRiders["damageRiders"][number];

export type StrikeTarget = {
  // The creature's type line ("undead", "humanoid (shapechanger)").
  type?: string;
  // It has not taken a turn in this fight yet, or is surprised.
  notActed?: boolean;
  // The holder's marks whose creature this is (attack-marks.ts planMarks).
  // Absent: the caller did not plan marks, and a vsMark rider holds while
  // its mark is held.
  marked?: ReadonlySet<string>;
  // The conditions the creature carries, for a vsCondition rider.
  conditions?: readonly string[];
  // How many feet straight at the creature the attacker ran this turn
  // (mt-fb-charge.ts runToward), for an afterRunFt rider.
  ranFt?: number;
  // The attacker is aloft on the board (genre-gb-airborne.ts), for an
  // airborne rider.
  airborne?: boolean;
};

const mods = (sheet: Pick<CharacterSheet, "abilities">) =>
  Object.fromEntries(Object.entries(sheet.abilities).map(([ability, score]) => [ability, Math.floor((score - 10) / 2)]));

// A creature that has not acted in this fight: surprised, or in the first
// round with its place in the order still to come. One answer for every
// feature keyed to it (Gutter Fighting here, Assassinate's advantage in
// authored-hooks.ts).
export function enemyNotActed(encounter: Pick<Encounter, "orderReady" | "order" | "round" | "turnIndex" | "surprisedIds">, enemyId: string): boolean {
  if (encounter.round > 1) {
    return false;
  }
  if (encounter.surprisedIds.includes(enemyId)) {
    return true;
  }
  const at = encounter.orderReady ? encounter.order.findIndex((entry) => entry.kind === "enemy" && entry.enemyId === enemyId) : -1;
  return at >= 0 && at > encounter.turnIndex;
}

// The weapon an attack swings, keyed whole, to compare with a row's
// `weapons`: its own name or the SRD weapon it is built on.
function swung(profile: { weapon?: string; base?: string }): Set<string> {
  return new Set([profile.weapon ?? "", profile.base ?? ""].map(textKey).filter(Boolean));
}

// The hit riders that hold for this attack. Absent target (the Hand before a
// creature is picked): the riders that need one are left out.
export function genreStrikeRiders(
  sheet: CharacterSheet,
  profile: { weapon?: string; base?: string; ranged: boolean },
  target?: StrikeTarget,
): Rider[] {
  const out: Rider[] = [];
  const weapon = swung(profile);
  const type = textKey(target?.type ?? "");
  for (const { effect, held } of activeAuthored(sheet, "hit_rider")) {
    if (effect.when === "melee" && profile.ranged) continue;
    if (effect.when === "ranged" && !profile.ranged) continue;
    if (effect.weapons && !effect.weapons.some((name) => weapon.has(textKey(name)))) continue;
    if (effect.vsTypes && !(type && effect.vsTypes.some((kind) => type.includes(kind)))) continue;
    if (effect.vsNotActed && !target?.notActed) continue;
    if (effect.afterRunFt && (target?.ranFt ?? 0) < effect.afterRunFt) continue;
    if (effect.airborne && !target?.airborne) continue;
    if (effect.vsMark && !markRides(sheet, effect.vsMark, target)) continue;
    if (effect.vsCondition && !target?.conditions?.some((entry) => isConditionNamed(entry, effect.vsCondition!))) continue;
    out.push({
      feature: held.feature,
      dice: resolveFormula(effect.dice, held.level, mods(sheet)),
      type: effect.type ?? "",
      when: effect.when ?? "weapon",
      oncePerTurn: Boolean(effect.oncePerTurn),
    });
  }
  return out;
}

// A vsMark rider rides a hit on a target the mark names: with no target (the
// Hand before one is picked) it is left out.
function markRides(sheet: CharacterSheet, mark: string, target: StrikeTarget | undefined): boolean {
  if (!target) return false;
  const held = sheet.conditions.filter((entry) => isConditionNamed(entry, mark));
  return target.marked ? held.some((entry) => target.marked!.has(entry)) : held.length > 0;
}

// What the rows add to this attack's roll, each with the feature that adds it.
export function genreAttackBonus(sheet: CharacterSheet, profile: { ranged: boolean }): Array<{ feature: string; amount: number }> {
  return activeAuthored(sheet, "attack_bonus")
    .filter(({ effect }) => !effect.when || (effect.when === "ranged") === profile.ranged)
    .map(({ effect, held }) => ({ feature: held.feature, amount: effect.amount }));
}
