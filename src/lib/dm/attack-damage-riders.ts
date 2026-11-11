// What a player's attack adds to its damage before anything is rolled, read
// from the sheet alone: Rage, an ability a feature adds (Aura of Hate, Song
// of Victory), the dice a held condition rides on a hit (Hex, Hunter's
// Mark, Divine Favor), and the features' damage riders (Improved Divine
// Smite, Divine Strike, Divine Fury, Colossus Slayer, Lifedrinker, Grave
// Touched's die in Form of Dread).
//
// pc_attack folds these into the damage (pc-attack-damage.ts
// foldDamageRiders), and the Hand's attack cards print them
// (src/lib/battlemap/hand-attack-lines.ts). Every rider a player's attack
// carries from the sheet goes through here, so the card cannot leave one out:
// it printed 1d8+3+4 for a raging Zealot whose swing rolled 1d8+3+4+1d6+10.
//
// Pure: no database, so the Hand imports it.
import { riderGateHolds } from "@/lib/dm/mt-mr-turn";
import { lifedrinkerDamage, pactWeaponAttack } from "@/lib/srd/pact-weapon";
import { ragingMeleeBonus, type AttackProfile } from "@/lib/dm/attack-logic";
import { DAMAGE_TYPES } from "@/lib/dm/condition-logic";
import type { AttackKind } from "@/lib/dm/pc-attack-profile";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { subclassFeatureDescription } from "@/lib/srd/features";
import { activeConditionEffects, conditionOnHitDice } from "@/lib/srd/condition-effects";
import type { CombatRiders } from "@/lib/srd/feature-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature, isNamed } from "@/lib/srd/feature-names";
import { subclassNamed } from "@/lib/srd/subclass-name";
import { authoredDamageAbility } from "@/lib/srd/authored-effects-more";
import { textKey, words } from "@/lib/language/text-logic";
import { CALL_THE_HUNT } from "@/lib/srd/authored-effects-w2-martial";
import { lineageRiders } from "@/lib/srd/mt-species-traits";
import { graveTouchedDie } from "@/lib/dm/ar-wbf-warlock-grave-logic";

export type FeatureRider = CombatRiders["damageRiders"][number];

// Of the types offered, the one a creature takes the most of: not immune,
// then not resistant, a vulnerability best; the first when all are alike.
function bestTypeAgainst(types: string[], defenses?: Partial<Pick<EncounterEnemy["stats"], "immune" | "resist" | "vulnerable">>): string {
  const listed = (value: unknown) => words(typeof value === "string" ? value : "").map(textKey);
  const immune = listed(defenses?.immune);
  const resist = listed(defenses?.resist);
  const vulnerable = listed(defenses?.vulnerable);
  const score = (type: string) => (immune.includes(type) ? -2 : resist.includes(type) ? -1 : vulnerable.includes(type) ? 1 : 0);
  return types.reduce((best, type) => (score(type) > score(best) ? type : best), types[0]);
}

export type AttackDamageRiders = {
  rageBonus: number;
  abilityRiders: Array<{ feature: string; amount: number }>;
  onHit: ReturnType<typeof conditionOnHitDice>;
  featureRiders: FeatureRider[];
};

export function attackDamageRiders(input: {
  sheet: CharacterSheet;
  profile: AttackProfile;
  riders: CombatRiders;
  kind: AttackKind;
  // The target, for the riders that read it (Colossus Slayer). Absent (the
  // Hand, which deals before a target is picked): the riders that need one
  // are left out.
  // `stats`: the creature's defenses, for a rider whose type is the
  // attacker's choice (the Nature Domain's Divine Strike).
  enemy?: Pick<EncounterEnemy, "currentHp" | "maxHp"> & { id?: string; conditions?: string[]; stats?: Partial<Pick<EncounterEnemy["stats"], "immune" | "resist" | "vulnerable">> };
  // The marking conditions (Hunter's Mark, Hex) whose die rides a hit on
  // this target (src/lib/dm/attack-marks.ts). Absent: every one does.
  marked?: Set<string>;
  // The target is surprised and the fight is in its first round (a
  // bugbear's Surprise Attack, src/lib/srd/mt-species-traits.ts). Absent
  // (the Hand): the rider is left out.
  surprised?: boolean;
}): AttackDamageRiders {
  const { sheet, profile, riders, kind, marked } = input;
  const rageBonus = ragingMeleeBonus(sheet, profile);
  const abilityRiders =
    kind === "weapon" || kind === "natural"
      ? authoredDamageAbility(sheet, { melee: !profile.ranged }, Object.fromEntries(Object.entries(sheet.abilities).map(([key, score]) => [key, Math.floor((score - 10) / 2)])))
      : [];
  const onHit = withTargetDice(attackOnHitDice(sheet, kind, !profile.ranged, marked), input.enemy?.conditions ?? []);
  // Feature damage riders ride weapon attacks, and a rider "when: attack"
  // any attack roll that hits, a spell's too (Genie's Wrath: "a hit with an
  // attack roll"); once-per-turn ones are reconciled with the turn budget
  // (pc-attack-damage.ts claimOncePerTurnRiders), as Sneak Attack is.
  const featureRiders: FeatureRider[] =
    kind === "spell" || kind === "granted"
      ? [...riders.damageRiders.filter((rider) => rider.when === "attack"), ...graveTouchedDie(sheet, profile)].map((rider) => ({ ...rider, type: riderType(sheet, rider, input.enemy?.stats) }))
      : [...riders.damageRiders, ...hunterRiders(sheet, input.enemy), ...pactRiders(sheet, kind, profile), ...heldConditionRiders(sheet), ...lineageRiders(sheet, { surprised: input.surprised }), ...graveTouchedDie(sheet, profile)]
          // Read as feature riders: a lineage's rider names no weapon of its own.
          .filter((rider: FeatureRider) => {
            if (rider.when === "melee" && profile.ranged) {
              return false;
            }
            if (rider.when === "ranged" && !profile.ranged) {
              return false;
            }
            // A rider of one weapon (the lightning launcher's extra 1d6).
            if (rider.weapon && textKey(rider.weapon) !== textKey(profile.weapon)) {
              return false;
            }
            // An authored rider's own gate holds too (Empowered Arms: the
            // arms and the visage both; mt-mr-turn.ts riderGateHolds).
            return (!rider.requiresCondition || (sheet.conditions.some((entry) => entry.toLowerCase() === rider.requiresCondition) && onQuarry(sheet, rider.requiresCondition, input.enemy?.id))) && riderGateHolds(sheet, rider.feature);
          })
          .map((rider) => ({ ...rider, type: riderType(sheet, rider, input.enemy?.stats) }));
  return { rageBonus, abilityRiders, onHit, featureRiders };
}

// A rider gated on a condition that names one creature (its meta's quarry:
// Slayer's Prey, "your first hit against it") rides a hit on that creature
// only. Before this the 1d6 landed on any creature the ranger hit. With no
// target named (the Hand, before a pick) the rider is shown.
function onQuarry(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">, condition: string, enemyId: string | undefined): boolean {
  const meta = (sheet.conditionMeta ?? {}) as Record<string, { quarry?: string } | undefined>;
  const held = sheet.conditions.find((entry) => entry.toLowerCase() === condition);
  const quarry = held ? meta[held]?.quarry : undefined;
  return !quarry || !enemyId || quarry === enemyId;
}

// The dice a held condition rides on this kind of attack's hit (Hex on any
// attack, Hunter's Mark on a weapon's, Divine Favor's radiant), the part of
// the riders a spell attack carries too.
export function attackOnHitDice(
  sheet: Pick<CharacterSheet, "conditions">,
  kind: AttackKind,
  melee: boolean,
  marked?: Set<string>,
): ReturnType<typeof conditionOnHitDice> {
  return conditionOnHitDice(sheet.conditions, {
    weapon: kind === "weapon" || kind === "natural",
    melee,
    ...(marked ? { marked: (condition: string) => marked.has(condition) } : {}),
  });
}

// The dice a condition on the TARGET adds to a hit on it (Perfected Armor's
// glow: an extra 1d6 lightning), beside the attacker's own.
function withTargetDice(own: ReturnType<typeof conditionOnHitDice>, targetConditions: string[]): ReturnType<typeof conditionOnHitDice> {
  const extra = activeConditionEffects(targetConditions).flatMap(({ row, condition }) => (row.hitDiceAgainst ? [{ ...row.hitDiceAgainst, condition }] : []));
  if (!extra.length) {
    return own;
  }
  return {
    ...own,
    suffix: `${own.suffix}${extra.map((entry) => `+${entry.dice}`).join("")}`,
    notes: [...own.notes, ...extra.map((entry) => `${entry.condition}: +${entry.dice} ${entry.type} damage`)],
    typed: [...own.typed, ...extra.map(({ dice, type }) => ({ dice, type }))],
  };
}

// Hunter's Prey, Colossus Slayer (SRD 5.1, Hunter 3): once per turn, 1d8
// more on a weapon hit against a creature below its hit point maximum. The
// pick is a "Hunter's Prey: Colossus Slayer" choice feature (options.ts).
function hunterRiders(sheet: CharacterSheet, enemy: Pick<EncounterEnemy, "currentHp" | "maxHp"> | undefined): FeatureRider[] {
  const slayer = holdsFeature(sheet, "Colossus Slayer");
  if (!slayer || !enemy || enemy.currentHp >= enemy.maxHp) {
    return [];
  }
  return [{ feature: "Colossus Slayer", dice: "1d8", type: "", when: "weapon", oncePerTurn: true }];
}

// The held conditions whose die rides one weapon hit a turn, as a feature
// rider the turn budget spends on the first hit (pc-attack-damage.ts
// claimOncePerTurnRiders); as a held condition's die it rode every hit.
//   Giant's Might (Rune Knight 3): "Once on each of your turns, one of your
//   attacks with a weapon or an unarmed strike can deal an extra 1d6 damage to
//   a target on a hit" (1d8 from 10th level, Runic Juggernaut's 1d10 at 18th,
//   the die the condition the spend laid names).
//   Call the Hunt (Path of the Beast 14): an ally who answered it "can, once on
//   each of its turns, roll a d6 and add it to the damage of an attack that
//   hits", until the barbarian's rage ends (rage-bound.ts ends the condition).
//   The rider rides weapon, natural and unarmed hits; a spell's is not read.
const HELD_RIDERS: Array<{ condition: string; dice: string; feature: string }> = [
  { condition: "giant's might (1d10)", dice: "1d10", feature: "Giant's Might" },
  { condition: "giant's might (1d8)", dice: "1d8", feature: "Giant's Might" },
  { condition: "giant's might", dice: "1d6", feature: "Giant's Might" },
  { condition: CALL_THE_HUNT, dice: "1d6", feature: "Call the Hunt" },
];
function heldConditionRiders(sheet: CharacterSheet): FeatureRider[] {
  const riders: FeatureRider[] = [];
  for (const row of HELD_RIDERS) {
    if (riders.some((rider) => rider.feature === row.feature)) continue;
    if (sheet.conditions.some((entry) => textKey(entry) === textKey(row.condition))) {
      riders.push({ feature: row.feature, dice: row.dice, type: "", when: "weapon", oncePerTurn: true });
    }
  }
  return riders;
}

// Lifedrinker (SRD 5.1, warlock invocation): a pact weapon hit deals extra
// necrotic damage equal to the Charisma modifier, at least 1
// (src/lib/srd/pact-weapon.ts).
function pactRiders(sheet: CharacterSheet, kind: AttackKind, profile: AttackProfile): FeatureRider[] {
  const amount = pactWeaponAttack(sheet, kind, profile) ? lifedrinkerDamage(sheet) : null;
  return amount ? [{ feature: "Lifedrinker", dice: String(amount), type: "necrotic", when: "melee", oncePerTurn: false }] : [];
}

// A Divine Strike rider's damage type. The domains share the name and the
// dice but not the type, so the parsed rider carries none; the sheet's own
// domain says which: the SRD Life Domain's is radiant, an authored domain's
// is in its text, and "of the weapon's type" (War) rides as the weapon's own.
// A choice ("cold, fire or lightning damage", Nature) is the type the
// creature's defenses let the most of through, the first named when they
// are alike: before this the Nature strike dealt the weapon's type, and a
// creature immune to slashing took nothing of it.
function riderType(sheet: CharacterSheet, rider: FeatureRider, defenses?: Partial<Pick<EncounterEnemy["stats"], "immune" | "resist" | "vulnerable">>): string {
  if (rider.type || !isNamed(rider.feature, "divine strike")) {
    return rider.type;
  }
  const domains = [
    { id: sheet.class, subclass: sheet.subclass },
    ...(sheet.classes ?? []).map((entry) => ({ id: entry.id, subclass: entry.subclass })),
  ].filter((entry) => entry.id.toLowerCase() === "cleric" && entry.subclass);
  for (const { subclass } of domains) {
    if (subclassNamed(subclass, "Life Domain")) {
      return "radiant";
    }
    const text = subclassFeatureDescription("cleric", subclass, "Divine Strike") ?? "";
    const typed = /extra \d+d\d+ (.+?) damage/i.exec(text);
    const choices = typed ? words(typed[1]).map(textKey).filter((word) => (DAMAGE_TYPES as readonly string[]).includes(word)) : [];
    if (choices.length) {
      return bestTypeAgainst(choices, defenses);
    }
  }
  return "";
}
