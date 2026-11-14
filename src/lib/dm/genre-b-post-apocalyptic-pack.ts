// What a packmaster and their bonded beast do together once the beast stands
// on the board (src/lib/dm/genre-b-post-apocalyptic-beast.ts makes it), each
// asked at the door every character's roll or blow already goes through:
//
//   Pack Tactics Training   "You and your beast have advantage on attacks
//                           against a creature the other is adjacent to"
//                           (authored-hooks.ts authoredAttackSituation)
//   Apex Pair               "extends to all allies adjacent to your beast": an
//                           ally within 5 feet of the beast has it against a
//                           creature the beast is adjacent to
//   Coordinated Takedown    "When you and your beast hit the same target in a
//                           turn, it saves (STR) or is knocked prone and
//                           grappled" (authored-hooks.ts authoredOnHit)
//   Legend of the Pack      "attacks ... frighten (WIS save)", for its minute
//   One Blood               "While within 30 ft of your beast, you both resist
//                           all damage from creatures neither of you has yet
//                           wounded this fight" (enemy-attack.ts, the blow's flags)
//
// Rulings where the text meets the board: "adjacent" is within 5 feet. The
// beast acts on its own turn right after its packmaster, so "in a turn" is the
// round the two share: the takedown comes when the second of them hits a
// creature the first hit this round, once a round a creature. A save the text
// gives no DC is 8 + proficiency + Wisdom, the packmaster's. The grapple is
// the beast's. A creature is "wounded" by an attack of theirs that hit it.
import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { listSheets } from "@/lib/db/sheets";
import { withinFeet } from "@/lib/dm/authored-saves";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import { layEnemyConditionInstance } from "@/lib/dm/enemy-condition-lay";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { bondedBeastsOf, isBondedBeast, packmasterOf } from "@/lib/dm/genre-b-post-apocalyptic-beast";
import { bindsWorthResisting } from "@/lib/dm/legendary-logic";
import { fightMarked, markFight } from "@/lib/dm/turn-marks";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";
import { counterSaveDc } from "@/lib/srd/counter-rules";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { LEGEND_OF_THE_PACK } from "@/lib/srd/genre-b-post-apocalyptic-conditions";

const PACKMASTER = "packmaster";
const EVERY_TYPE = "acid, bludgeoning, cold, fire, force, lightning, necrotic, piercing, poison, psychic, radiant, slashing, thunder";

// The pair a character belongs to: the packmaster and their beasts, whichever
// of them is asked about. Null for everyone else.
function packOf(campaignId: string, sheet: CharacterSheet): { master: CharacterSheet; beasts: CharacterSheet[]; self: "master" | "beast" } | null {
  if (isBondedBeast(sheet)) {
    const master = packmasterOf(sheet);
    return master ? { master, beasts: bondedBeastsOf(campaignId, master.id), self: "beast" } : null;
  }
  if (!holdsGenreFeature(sheet, PACKMASTER, "Bonded Beast")) {
    return null;
  }
  return { master: sheet, beasts: bondedBeastsOf(campaignId, sheet.id), self: "master" };
}

const up = (sheet: CharacterSheet) => sheet.currentHp > 0 && !sheet.deathSaves?.dead;

// Pack Tactics Training and Apex Pair: the note of an attack rolled with
// advantage, or null.
export function packTactics(campaignId: string, encounterId: string, sheet: CharacterSheet, enemy: Pick<EncounterEnemy, "id" | "displayName">): string | null {
  const pack = packOf(campaignId, sheet);
  if (pack && holdsGenreFeature(pack.master, PACKMASTER, "Pack Tactics Training")) {
    const others = pack.self === "master" ? pack.beasts : [pack.master, ...pack.beasts.filter((beast) => beast.id !== sheet.id)].filter(up);
    const beside = others.find((other) => withinFeet(encounterId, other.id, enemy.id, 5));
    if (beside) {
      return `Pack Tactics Training: ${beside.name} is adjacent to ${enemy.displayName}: advantage`;
    }
  }
  // Apex Pair: an ally beside the beast, against a creature the beast is beside.
  for (const stale of listSheets(campaignId)) {
    if (stale.id === sheet.id || !holdsGenreFeature(stale, PACKMASTER, "Apex Pair") || !holdsGenreFeature(stale, PACKMASTER, "Pack Tactics Training")) {
      continue;
    }
    if (pack && pack.master.id === stale.id) {
      continue;
    }
    const beast = bondedBeastsOf(campaignId, stale.id).find((one) => withinFeet(encounterId, one.id, sheet.id, 5) && withinFeet(encounterId, one.id, enemy.id, 5));
    if (beast) {
      return `Apex Pair: ${sheet.name} fights beside ${beast.name}, which is adjacent to ${enemy.displayName}: advantage`;
    }
  }
  return null;
}

const woundKey = (masterId: string, enemyId: string) => `pack-wounded:${masterId}:${enemyId}`;
const hitKey = (masterId: string, enemyId: string, who: "master" | "beast") => `pack-hit:${masterId}:${enemyId}:${who}`;
const takedownKey = (masterId: string, enemyId: string) => `pack-takedown:${masterId}:${enemyId}`;

// A hit by the packmaster or a beast of theirs: the creature is wounded (One
// Blood), the takedown comes when both have hit it this round, and a beast
// grown monstrous frightens it.
export function packOnHit(campaign: Campaign, encounter: Encounter, sheet: CharacterSheet, struck: EncounterEnemy): string[] {
  const pack = packOf(campaign.id, sheet);
  if (!pack) {
    return [];
  }
  const lines: string[] = [];
  const { master } = pack;
  markFight(encounter.id, woundKey(master.id, struck.id), "1");
  const enemy = getEnemy(struck.id);
  if (!enemy || enemy.status !== "alive") {
    return lines;
  }
  const derived = computeSheetDerived(master);
  const dc = counterSaveDc("wis", derived, derived.abilityMods.wis ?? 0);
  const round = String(encounter.round);
  markFight(encounter.id, hitKey(master.id, enemy.id, pack.self), round);
  const partner = pack.self === "master" ? "beast" : "master";
  if (
    holdsGenreFeature(master, PACKMASTER, "Coordinated Takedown") &&
    fightMarked(encounter.id, hitKey(master.id, enemy.id, partner), round) &&
    !fightMarked(encounter.id, takedownKey(master.id, enemy.id), round)
  ) {
    markFight(encounter.id, takedownKey(master.id, enemy.id), round);
    const holder = pack.self === "beast" ? sheet : pack.beasts[0];
    const save = rollEnemySave(campaign.id, enemy, "str", dc, {
      resist: bindsWorthResisting(["grappled"]),
      origin: { ref: master.id },
      record: { detail: `${enemy.displayName}: STR save against Coordinated Takedown` },
    });
    let fresh = getEnemy(enemy.id) ?? enemy;
    if (save.success) {
      lines.push(`Coordinated Takedown: ${enemy.displayName} keeps its feet (STR ${save.total} vs DC ${dc}).`);
    } else {
      const laid: string[] = [];
      if (!immuneToCondition(fresh, "prone")) {
        layEnemyConditionInstance(campaign, fresh, "prone", { source: master.id });
        laid.push("knocked prone");
        fresh = getEnemy(enemy.id) ?? fresh;
      }
      if (holder && !immuneToCondition(fresh, "grappled")) {
        layEnemyConditionInstance(campaign, fresh, "grappled", { source: holder.id, escapeDc: dc });
        laid.push(`grappled by ${holder.name}`);
      }
      lines.push(`Coordinated Takedown: ${enemy.displayName} is ${laid.join(" and ") || "unmoved, immune to both"} (STR ${save.total} vs DC ${dc}).`);
    }
  }
  // Legend of the Pack: the monstrous beast's attacks frighten.
  if (pack.self === "beast" && sheet.conditions.some((entry) => isConditionNamed(entry, LEGEND_OF_THE_PACK))) {
    const fresh = getEnemy(enemy.id) ?? enemy;
    const save = rollEnemySave(campaign.id, fresh, "wis", dc, {
      resist: bindsWorthResisting(["frightened"]),
      against: "frightened",
      origin: { ref: sheet.id },
      record: { detail: `${fresh.displayName}: WIS save against Legend of the Pack` },
    });
    const after = getEnemy(enemy.id) ?? fresh;
    if (save.success || immuneToCondition(after, "frightened")) {
      lines.push(`Legend of the Pack: ${after.displayName} ${save.success ? "holds its nerve" : "cannot be frightened"} (WIS ${save.total} vs DC ${dc}).`);
    } else {
      // For the minute the beast stays monstrous.
      layEnemyConditionInstance(campaign, after, "frightened", { source: sheet.id, rounds: 10 });
      lines.push(`Legend of the Pack: ${after.displayName} is frightened of ${sheet.name} (WIS ${save.total} vs DC ${dc}).`);
    }
  }
  if (lines.length) {
    publishEncounter(campaign.id);
  }
  return lines;
}

// One Blood: the damage types this blow is resisted in, all of them or none.
export function oneBloodResists(campaignId: string, encounterId: string, attacker: Pick<EncounterEnemy, "id">, target: CharacterSheet): string | null {
  const pack = packOf(campaignId, target);
  if (!pack || !holdsGenreFeature(pack.master, PACKMASTER, "One Blood") || !up(pack.master)) {
    return null;
  }
  const near = pack.self === "master" ? pack.beasts.some((beast) => withinFeet(encounterId, pack.master.id, beast.id, 30)) : withinFeet(encounterId, pack.master.id, target.id, 30);
  if (!near || fightMarked(encounterId, woundKey(pack.master.id, attacker.id), "1")) {
    return null;
  }
  return EVERY_TYPE;
}
