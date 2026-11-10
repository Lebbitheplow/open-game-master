// What a player's attack adds to its damage before anything is rolled, read
// from the sheet alone: Rage, an ability a feature adds (Aura of Hate, Song
// of Victory), the dice a held condition rides on a hit (Hex, Hunter's
// Mark, Divine Favor), and the features' damage riders (Improved Divine
// Smite, Divine Strike, Divine Fury, Colossus Slayer, Lifedrinker).
//
// pc_attack folds these into the damage (pc-attack-damage.ts
// foldDamageRiders), and the Hand's attack cards print them
// (src/lib/battlemap/hand-attack-lines.ts). Every rider a player's attack
// carries from the sheet goes through here, so the card cannot leave one out:
// it printed 1d8+3+4 for a raging Zealot whose swing rolled 1d8+3+4+1d6+10.
//
// Pure: no database, so the Hand imports it.
import { lifedrinkerDamage, pactWeaponAttack } from "@/lib/srd/pact-weapon";
import { ragingMeleeBonus, type AttackProfile } from "@/lib/dm/attack-logic";
import { DAMAGE_TYPES } from "@/lib/dm/condition-logic";
import type { AttackKind } from "@/lib/dm/pc-attack-profile";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { subclassFeatureDescription } from "@/lib/srd/features";
import { conditionOnHitDice } from "@/lib/srd/condition-effects";
import type { CombatRiders } from "@/lib/srd/feature-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature, isNamed } from "@/lib/srd/feature-names";
import { subclassNamed } from "@/lib/srd/subclass-name";
import { authoredDamageAbility } from "@/lib/srd/authored-effects-more";

export type FeatureRider = CombatRiders["damageRiders"][number];

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
  enemy?: Pick<EncounterEnemy, "currentHp" | "maxHp">;
  // The marking conditions (Hunter's Mark, Hex) whose die rides a hit on
  // this target (src/lib/dm/attack-marks.ts). Absent: every one does.
  marked?: Set<string>;
}): AttackDamageRiders {
  const { sheet, profile, riders, kind, marked } = input;
  const rageBonus = ragingMeleeBonus(sheet, profile);
  const abilityRiders =
    kind === "weapon" || kind === "natural"
      ? authoredDamageAbility(sheet, { melee: !profile.ranged }, Object.fromEntries(Object.entries(sheet.abilities).map(([key, score]) => [key, Math.floor((score - 10) / 2)])))
      : [];
  const onHit = attackOnHitDice(sheet, kind, !profile.ranged, marked);
  // Feature damage riders ride weapon attacks only; once-per-turn ones are
  // reconciled with the turn budget (pc-attack-damage.ts
  // claimOncePerTurnRiders), as Sneak Attack is.
  const featureRiders: FeatureRider[] =
    kind === "spell" || kind === "granted"
      ? []
      : [...riders.damageRiders, ...hunterRiders(sheet, input.enemy), ...pactRiders(sheet, kind, profile)]
          .filter((rider) => {
            if (rider.when === "melee" && profile.ranged) {
              return false;
            }
            if (rider.when === "ranged" && !profile.ranged) {
              return false;
            }
            return !rider.requiresCondition || sheet.conditions.some((entry) => entry.toLowerCase() === rider.requiresCondition);
          })
          .map((rider) => ({ ...rider, type: riderType(sheet, rider) }));
  return { rageBonus, abilityRiders, onHit, featureRiders };
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
// is in its text, and "of the weapon's type" (War) or a choice of three
// (Nature) rides as the weapon's own.
function riderType(sheet: CharacterSheet, rider: FeatureRider): string {
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
    const typed = /extra \d+d\d+ ([a-z]+) damage/i.exec(text);
    if (typed && (DAMAGE_TYPES as readonly string[]).includes(typed[1].toLowerCase())) {
      return typed[1].toLowerCase();
    }
  }
  return "";
}
