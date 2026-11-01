// The attacks a held condition grants, as Hand cards (Spiritual Weapon's
// weapon, Starry Form's Archer, Flame Blade). pc_attack has resolved them by
// name since the conditions were written (src/lib/dm/pc-attack-profile.ts),
// but the Hand dealt no card for them: a cleric who cast Spiritual Weapon
// from the Hand spent the slot and the bonus action and had no way to make
// the strike the casting includes, then or on a later turn.
//
// The numbers are pc_attack's own: the spell attack bonus of the class whose
// list carries the spell, the dice of the slot the condition was laid from,
// the casting ability on the damage. So is the cost: the attack that comes
// with its activation (its condition still at its full duration, so laid
// this turn) rides the activation's own bonus action once; after that a
// bonus-action attack is a bonus action, and any other is one of the Attack
// action's swings (src/lib/dm/pc-attack-spend.ts). Where a weapon the spell
// made strikes from is the engine's to judge: it moves the weapon and
// measures the reach from it. Pure.
import { computeSheetDerived, spellAbilityFor, spellAttackFor } from "@/lib/srd";
import { activeConditionEffects } from "@/lib/srd/condition-effects";
import type { GrantedAttack } from "@/lib/srd/condition-effect-types";
import { grantedAttackDice } from "@/lib/srd/granted-attacks";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { textKey } from "@/lib/language/text-logic";
import { addFlat, attackGate, costGate, gated, signed, standingGate, type HandCard, type HandTurn } from "@/lib/battlemap/hand-core";

type GrantedMeta = { rounds?: number; spell?: string; slotLevel?: number };

// The once-a-turn mark pc_attack leaves when the strike rode the activation.
export function grantedRideMark(name: string): string {
  return `granted:${name.toLowerCase()}`;
}

// Whether this strike would ride the activation's own action now, as
// pc-attack-spend.ts ridesActivation asks it.
function ridesActivation(attack: GrantedAttack, meta: GrantedMeta | undefined, turn: HandTurn): boolean {
  const whole = attack.withActivation;
  if (!whole || (meta?.rounds ?? 0) < whole) return false;
  const spent = attack.activation === "action" ? turn.actionUsed : turn.bonusUsed;
  return spent && !(turn.marks ?? []).includes(grantedRideMark(attack.name));
}

function rangeOf(attack: GrantedAttack): string {
  if (attack.from) {
    return attack.ranged ? `${attack.from.reachFeet} ft` : `${attack.from.reachFeet} ft of it`;
  }
  return attack.ranged ? `${attack.rangeFeet ?? 60} ft` : "5 ft";
}

function rulesOf(attack: GrantedAttack, rides: boolean): string {
  const from = attack.from;
  const label = from?.label ?? "the weapon";
  const where = from
    ? rides
      ? `It strikes a creature within ${from.reachFeet} ft of ${label}.`
      : `Moves up to ${from.moveFeet} ft, then strikes a creature within ${from.reachFeet} ft of ${label}.`
    : "";
  // Arcane Sword's casting is an action: its strike spends no bonus action
  // either, and the card said "no second bonus action" of one never spent.
  const cost = rides
    ? attack.activation === "action"
      ? "Comes with the casting."
      : "Comes with the casting: no second bonus action."
    : attack.bonusAction
      ? "A bonus action."
      : attack.wholeAction
        ? "Takes your action: no swing of the Attack action, so Extra Attack adds none."
        : "";
  return [where, cost].filter(Boolean).join(" ");
}

export function grantedAttackCards(sheet: CharacterSheet, turn: HandTurn, allowed = 1): HandCard[] {
  const derived = computeSheetDerived(sheet);
  const metaOf = (sheet.conditionMeta ?? {}) as Record<string, GrantedMeta | undefined>;
  const seen = new Set<string>();
  const cards: HandCard[] = [];
  for (const { row, condition } of activeConditionEffects(sheet.conditions)) {
    const attack = row.grantedAttack;
    if (!attack || seen.has(textKey(attack.name))) continue;
    seen.add(textKey(attack.name));
    const meta = metaOf[condition];
    const spell = meta?.spell ?? attack.name;
    const dice = grantedAttackDice(attack, sheet.level, meta?.slotLevel ?? null);
    const ability = sheet.spellcasting ? spellAbilityFor(sheet, spell) : null;
    const damage = attack.abilityToDamage && ability ? addFlat(dice, derived.abilityMods[ability]) : dice;
    const toHit = spellAttackFor(sheet, spell) ?? derived.spellAttack;
    const rides = ridesActivation(attack, meta, turn);
    const cost = rides ? "free" : attack.bonusAction ? "bonus" : "action";
    const card: HandCard = {
      id: `attack:granted:${textKey(attack.name).replace(/\s+/g, "-")}`,
      type: "attack",
      name: attack.name,
      cost,
      range: rangeOf(attack),
      dice: `${damage} ${attack.type}`.trim(),
      roll: toHit === null ? "spell attack" : `${signed(toHit)} to hit`,
      rules: rulesOf(attack, rides),
      resource: "",
      condition: "",
      icon: { kind: "spell", key: meta?.spell ?? attack.name, family: null },
      target: "enemy",
      toHit,
      damage,
      damageType: attack.type,
      heals: false,
      save: null,
      melee: !attack.ranged,
      disabled: null,
      spent: false,
      compose: false,
      intent: { card: "attack", weapon: attack.name },
      ...(attack.wholeAction ? { wholeAction: true } : {}),
    };
    const noBonus = toHit === null
      ? { reason: `${sheet.name}'s sheet has no spell attack bonus (no spellcasting ability), so ${attack.name} cannot be rolled.`, spent: false }
      : null;
    cards.push(
      gated(
        card,
        standingGate(sheet, turn, attack.bonusAction ? "bonus" : "attack"),
        noBonus,
        rides
          ? null
          : attack.bonusAction
            ? costGate("bonus", turn, sheet, `the ${attack.name} attack`)
            : attack.wholeAction
              ? costGate("action", turn, sheet, `the ${attack.name} attack`)
              : attackGate(turn, allowed, sheet),
      ),
    );
  }
  return cards;
}
