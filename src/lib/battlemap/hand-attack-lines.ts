// What an attack card says it rolls, read from the helpers pc_attack applies
// and never worked out here: the damage riders the sheet carries
// (src/lib/dm/attack-damage-riders.ts: Rage, Aura of Hate, Hex, Improved
// Divine Smite, Divine Strike, Divine Fury), the conditions on the attack
// roll (src/lib/dm/attack-roll-extras.ts: Bless, Bane, True Strike), and the
// ranges a ranged or thrown attack reaches (src/lib/dm/attack-rules.ts).
// Every attack card goes through here (hand.ts attackCards, hand-class.ts
// bonusStrikeCards, hand-spells.ts spellCard), so a card cannot drift from the
// roll again: the cards had their own sums, and left out the dice the engine
// added on its own.
//
// Pure; scripts/test-hand-attack-lines.mjs drives it.
import type { AttackProfile } from "@/lib/dm/attack-logic";
import { attackDamageRiders, attackOnHitDice } from "@/lib/dm/attack-damage-riders";
import { attackRollExtras, splitRollSuffix } from "@/lib/dm/attack-roll-extras";
import { longRangeTilesOf } from "@/lib/dm/attack-rules";
import type { AttackKind } from "@/lib/dm/pc-attack-profile";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { CombatRiders } from "@/lib/srd/feature-effects";
import { addFlat, type HandCard, type HandTurn } from "@/lib/battlemap/hand-core";

export type AttackDamageLine = {
  // The expression the hit rolls, before Sneak Attack and a target's own
  // riders (Colossus Slayer), which the notes name.
  damage: string;
  notes: string[];
};

// The damage a hit rolls with what the sheet adds to it. A once-a-turn rider
// (Divine Strike, Divine Fury) rides the next hit while the turn has not
// spent it, so it is in the line until the turn's mark says it landed.
export function attackDamageLine(input: {
  sheet: CharacterSheet;
  turn: HandTurn;
  profile: AttackProfile;
  riders: CombatRiders;
  kind: AttackKind;
}): AttackDamageLine {
  const { turn, profile } = input;
  const read = attackDamageRiders(input);
  let damage = addFlat(profile.damageExpression, read.rageBonus);
  const notes: string[] = [];
  if (read.rageBonus) notes.push(`Rage +${read.rageBonus}.`);
  for (const rider of read.abilityRiders) {
    damage = addFlat(damage, rider.amount);
    notes.push(`${rider.feature} +${rider.amount}.`);
  }
  damage = `${damage}${read.onHit.suffix}`;
  notes.push(...read.onHit.notes.map((note) => `${note}.`));
  const spent = new Set(turn.marks ?? []);
  for (const rider of read.featureRiders) {
    if (rider.oncePerTurn && spent.has(`rider:${rider.feature.toLowerCase()}`)) continue;
    damage = `${damage}+${rider.dice}`;
    notes.push(`${rider.feature} +${rider.dice}${rider.type ? ` ${rider.type}` : ""}${rider.oncePerTurn ? " on the first hit this turn" : ""}.`);
  }
  return { damage, notes };
}

// The to-hit line: the profile's bonus with the flat part of the held
// conditions, and their dice beside it (Bless's +1d4), with the advantage
// they give, as the roll is made.
export function attackRollLine(sheet: CharacterSheet, toHit: number): Pick<HandCard, "toHit" | "toHitDice" | "rollAdvantage"> & { notes: string[] } {
  const extras = attackRollExtras(sheet);
  const split = splitRollSuffix(extras.diceSuffix);
  return {
    toHit: toHit + split.flat,
    ...(split.dice ? { toHitDice: split.dice } : {}),
    ...(extras.advantageSources.length ? { rollAdvantage: extras.advantageSources } : {}),
    notes: extras.notes.map((note) => `${note}.`),
  };
}

// A spell attack's lines: the roll as a weapon's (Bless), and the dice a
// held condition rides on its hit (Hex), which pc_attack adds to a spell
// attack too. Chill Touch's card said 4d8 while the hexed target took 4d8+1d6.
export function spellAttackLines(sheet: CharacterSheet, toHit: number, melee: boolean): ReturnType<typeof attackRollLine> & { onHit: string } {
  const rolled = attackRollLine(sheet, toHit);
  const onHit = attackOnHitDice(sheet, "spell", melee);
  return { ...rolled, notes: [...rolled.notes, ...onHit.notes.map((note) => `${note}.`)], onHit: onHit.suffix };
}

// "+9 to hit", "+9+1d4 to hit".
export function toHitWords(line: Pick<HandCard, "toHit" | "toHitDice">): string {
  const bonus = line.toHit ?? 0;
  return `${bonus >= 0 ? "+" : ""}${bonus}${line.toHitDice ?? ""} to hit`;
}

// How far a weapon reaches, in the card's range line, and the feet the
// preview reads: a thrown weapon reaches in melee and is thrown out to its
// long range ("5 ft / 20/60 ft"), a ranged one shoots to its long range
// ("80/320 ft"). The card printed the normal range alone, and pc_attack took
// a dagger thrown 30 feet that the card said reached 20.
export function attackReach(profile: AttackProfile): Pick<HandCard, "range" | "shot"> {
  const reachFt = profile.reachTiles * 5;
  if (!profile.ranged && !profile.thrown) return { range: `${reachFt} ft` };
  const normalFt = profile.rangeTiles * 5;
  const longFt = longRangeTilesOf(profile) * 5;
  const span = longFt > normalFt ? `${normalFt}/${longFt} ft` : `${normalFt} ft`;
  return {
    range: profile.ranged ? span : `${reachFt} ft / ${span}`,
    shot: { reachFt: profile.ranged ? 0 : reachFt, normalFt, longFt, thrown: !profile.ranged },
  };
}
