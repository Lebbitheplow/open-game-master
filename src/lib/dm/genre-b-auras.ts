// The mystery, post-apocalyptic and steampunk features that reach the allies
// standing near their holder (WAVE2 D5: the genre text is the rule):
//
//   Steadying Presence (alienist)  allies within 10 ft (30 ft with Group
//                                  Therapy) add +1d4 to saves against fear
//   Fear No Rust (road warrior)    allies within 10 ft add +1d4 to fear saves
//                                  while the road warrior fights on
//   Walk Through the Valley        allies within 10 ft have advantage against
//     (waste preacher)             fear (their necrotic resistance is the
//                                  holder's aura_resist row)
//   Guardian's Instinct (enforcer) allies within 10 ft gain +1 AC
//   Shield Coupling (steam knight) adjacent allies gain +1 AC while the knight
//                                  holds a shield
//   Warlord of the Wastes          allies within 30 ft who can see the road
//     (road warrior)               warrior gain +1 to attack rolls
//
// Every save a character rolls asks here through forced-save.ts rollExtrasFor
// (the one door every save's extras come from), and every attack on a
// character through ac-effects.ts acWithEffects, so the request_roll save, the
// forced save, the death save and the enemy's swing read the same aura. A new
// genre aura is a row of AURAS, never a check at one of those doors.
//
// The holder must be conscious ("while you are conscious", "while you fight
// on"), fielded, on the ally's side of the fight. On a board the tokens
// decide the reach; off one the party stands together, as the paladin's
// aura reads it (src/lib/dm/aura.ts). Two auras of one feature do not stack:
// the same feature counts once, however many hold it.
import { TESTIFIED } from "@/lib/srd/genre-b-post-apocalyptic-conditions";
import { sideOf } from "@/lib/dm/combatant";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { unseenBecause, withinFeet } from "@/lib/dm/authored-saves";
import { isIncapacitated } from "@/lib/dm/condition-logic";
import { acBreakdownFor } from "@/lib/srd";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { GenreSaveAura } from "@/lib/dm/genre-b-aura-logic";

type AuraRow = {
  feature: string;
  classId: string;
  feet: (holder: CharacterSheet) => number;
  ac?: number;
  needsShield?: boolean;
  save?: GenreSaveAura;
  // Added to the ally's attack rolls (Warlord of the Wastes).
  attack?: number;
  // Only while the ally can see the holder ("while they can see you").
  sight?: boolean;
};

const AURAS: AuraRow[] = [
  // "Allies within 10 ft add +1d4 to saves against fear and madness"; Group
  // Therapy: "Your Steadying Presence radius is 30 ft". Madness is no
  // condition a save names (roll-about.ts SAVE_AGAINST): the GM's to rule.
  { feature: "Steadying Presence", classId: "alienist", feet: (holder) => (holdsFeature(holder, "Group Therapy") ? 30 : 10), save: { feature: "Steadying Presence", die: "1d4", against: ["frightened"] } },
  // "allies within 10 ft add +1d4 to fear saves while you fight on".
  { feature: "Fear No Rust", classId: "road_warrior", feet: () => 10, save: { feature: "Fear No Rust", die: "1d4", against: ["frightened"] } },
  // "You and allies within 10 ft have ... advantage against fear".
  { feature: "Walk Through the Valley", classId: "waste_preacher", feet: () => 10, save: { feature: "Walk Through the Valley", advantage: true, against: ["frightened"] } },
  // "Allies within 10 ft gain +1 AC while you are conscious."
  { feature: "Guardian's Instinct", classId: "enforcer", feet: () => 10, ac: 1 },
  // "Adjacent allies gain +1 AC while you hold a shield."
  { feature: "Shield Coupling", classId: "steam_knight", feet: () => 5, ac: 1, needsShield: true },
  // "Allies within 30 ft gain +1 to attack rolls while they can see you."
  { feature: "Warlord of the Wastes", classId: "road_warrior", feet: () => 30, attack: 1, sight: true },
];

// The auras that cover this character now, from the other characters of the
// campaign who hold one.
function coveringAuras(campaignId: string, target: Pick<CharacterSheet, "id">): AuraRow[] {
  const encounter = getActiveEncounter(campaignId);
  const side = encounter ? sideOf(encounter, "sheet", target.id) : null;
  const found = new Set<AuraRow>();
  for (const stale of listSheets(campaignId)) {
    if (stale.id === target.id) {
      continue;
    }
    const holder = getSheetById(stale.id) ?? stale;
    if (holder.deathSaves?.dead || holder.currentHp <= 0 || isIncapacitated(holder.conditions)) {
      continue;
    }
    if (encounter && sideOf(encounter, "sheet", holder.id, holder) !== side) {
      continue;
    }
    for (const row of AURAS) {
      if (found.has(row) || !holdsGenreFeature(holder, row.classId, row.feature)) {
        continue;
      }
      if (row.needsShield && !acBreakdownFor(holder).shieldName) {
        continue;
      }
      if (encounter && !withinFeet(encounter.id, holder.id, target.id, row.feet(holder))) {
        continue;
      }
      const looker = row.sight && encounter ? getSheetById(target.id) : null;
      if (looker && encounter && unseenBecause(encounter.id, looker, holder, { hidden: false })) {
        continue;
      }
      found.add(row);
    }
  }
  return [...found.values()];
}

// The conscious characters on this one's side who hold a genre feature and
// stand within `feet` of them (off the board, every one): Stand at the Dawn's
// preacher (src/lib/dm/genre-b-drops.ts), as the auras above read them.
export function nearbyHolders(campaignId: string, target: Pick<CharacterSheet, "id">, classId: string, feature: string, feet: number): CharacterSheet[] {
  const row: AuraRow = { feature, classId, feet: () => feet };
  const encounter = getActiveEncounter(campaignId);
  const side = encounter ? sideOf(encounter, "sheet", target.id) : null;
  return listSheets(campaignId)
    .filter((stale) => stale.id !== target.id)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((holder) => !holder.deathSaves?.dead && holder.currentHp > 0 && !isIncapacitated(holder.conditions))
    .filter((holder) => !encounter || sideOf(encounter, "sheet", holder.id, holder) === side)
    .filter((holder) => holdsGenreFeature(holder, row.classId, row.feature))
    .filter((holder) => !encounter || withinFeet(encounter.id, holder.id, target.id, feet));
}

// The save riders the auras give: rolls.ts adds a die or advantage to a save
// against what each names (genre-b-aura-logic.ts saveAuraRiders).
export function genreBSaveAuras(campaignId: string, target: Pick<CharacterSheet, "id">): GenreSaveAura[] {
  const auras = coveringAuras(campaignId, target).flatMap((row) => (row.save ? [row.save] : []));
  // Testify's mark, which the save it answers spends (genre-b-post-apocalyptic-spends.ts).
  const testified = getSheetById(target.id)?.conditions.find((entry) => isConditionNamed(entry, TESTIFIED));
  return testified ? [...auras, { feature: "Testify", advantage: true, against: ["frightened"], spends: testified }] : auras;
}

// The AC the auras add to an attack on this character.
export function genreBAuraAc(campaignId: string, target: Pick<CharacterSheet, "id">): number {
  return coveringAuras(campaignId, target).reduce((sum, row) => sum + (row.ac ?? 0), 0);
}

// What the auras add to this character's attack rolls (src/lib/dm/pc-attack-damage.ts,
// the turn's swing and a reaction's alike).
export function genreBAuraAttack(campaignId: string, attacker: Pick<CharacterSheet, "id">): { bonus: number; features: string[] } {
  const rows = coveringAuras(campaignId, attacker).filter((row) => row.attack);
  return { bonus: rows.reduce((sum, row) => sum + (row.attack ?? 0), 0), features: rows.map((row) => row.feature) };
}
