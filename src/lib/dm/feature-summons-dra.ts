// The creatures a druid's or artificer's feature makes, as allies with their
// stat blocks, the way the steel defender is made (src/lib/dm/summon-defender.ts):
//
//   Summon Wildfire Spirit: "summon a wildfire spirit companion that acts on
//   your turn, with a fiery teleport that damages creatures around its
//   arrival". A Small elemental beside the druid (AC 13, 5 + five times the
//   druid level hit points, Flame Seed at the druid's spell attack for 1d6 +
//   the proficiency bonus fire), acting right after them; as it arrives each
//   creature of the fight within 10 feet of it makes a Dexterity save against
//   the druid's spell save DC or takes 2d6 fire.
//   Eldritch Cannon: "a Small or Tiny cannon (AC 18, hit points five times your
//   artificer level) in an unoccupied space within 5 feet that lasts an hour".
//   A construct beside the artificer, and the "eldritch cannon" area marking
//   its square, which the Force Ballista fires from (conjured-strike.ts) and
//   Fortified Position's cover is measured from.
//
// Before this both were a condition on their maker: nothing joined the
// table, nothing burned, and the cannon had no AC, no hit points and no
// square.

import { randomUUID } from "node:crypto";
import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import { chebyshev } from "@/lib/battlemap/types";
import { computeSheetDerived } from "@/lib/srd";
import { classLevelOf } from "@/lib/srd/trait-rules";
import type { SummonForm } from "@/lib/srd/summon-forms";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { summonRecord } from "@/lib/dm/summon-rules";
import { removeSummon, spawnSummons, summonsOf } from "@/lib/dm/summon-store";
import { resolveCounterSave } from "@/lib/dm/counter-saves";
import { placeSpellZone } from "@/lib/dm/zone-cast";
import { holdsFeature } from "@/lib/srd/feature-names";

export const WILDFIRE_SPIRIT = "Wildfire Spirit";
export const ELDRITCH_CANNON = "Eldritch Cannon";
const WILDFIRE_SPELL = "Summon Wildfire Spirit";

function levelIn(sheet: CharacterSheet, classId: string): number {
  return Math.max(1, classLevelOf(sheet, classId) || sheet.level);
}

export function wildfireSpiritForm(sheet: CharacterSheet): SummonForm {
  const derived = computeSheetDerived(sheet);
  const pb = derived.proficiencyBonus;
  const level = levelIn(sheet, "druid");
  return {
    name: WILDFIRE_SPIRIT,
    type: "elemental",
    size: "Small",
    cr: 0,
    ac: 13,
    hp: 5 + 5 * level,
    speed: 30,
    fly: 30,
    abilities: { str: 10, dex: 14, con: 14, int: 13, wis: 15, cha: 11 },
    attacks: [{ name: "Flame Seed", toHit: derived.spellAttack ?? 2 + pb + derived.abilityMods.wis, damage: `1d6+${pb}`, type: "fire", range: 60 }],
    immune: "fire",
    conditionImmune: "charmed, frightened, grappled, prone, restrained",
    traits: `Fiery Teleport: the spirit and each willing creature within 5 ft. teleport up to 15 ft.; each creature within 5 ft. of where it left saves (DEX) or takes 1d6 + ${pb} fire. It acts right after the druid and obeys their commands.`,
  };
}

// The druid's spirit: a new one replaces the old. Returns the lines and the
// creature, or the refusal; the Wild Shape use and the action are the
// spend's (authored-spends.ts).
export function summonWildfireSpirit(campaign: Campaign, turnId: string, sheet: CharacterSheet): { result: Record<string, unknown> } {
  const replaced = summonsOf(campaign.id, sheet.id, WILDFIRE_SPELL);
  for (const old of replaced) {
    removeSummon(campaign, old);
  }
  const form = wildfireSpiritForm(sheet);
  const record = summonRecord(form, { spell: WILDFIRE_SPELL, casterId: sheet.id, casterName: sheet.name, concentration: false, castId: randomUUID().slice(0, 8) });
  const [made] = spawnSummons(campaign, sheet, { form, count: 1, record, rounds: 600, slotLevel: null, initiative: "caster", overrides: { level: sheet.level } });
  const lines: string[] = [];
  // "Damages creatures around its arrival": each creature of the fight within
  // 10 feet of where it appears.
  const encounter = getActiveEncounter(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const spot = map && made ? getTokenByRef(map.id, made.id) : null;
  if (encounter && map && spot) {
    const caught = listEnemies(encounter.id)
      .filter((enemy) => enemy.status === "alive")
      .filter((enemy) => {
        const token = getTokenByRef(map.id, enemy.id);
        return token && chebyshev(token.x, token.y, spot.x, spot.y) <= 2;
      })
      .map((enemy) => enemy.id);
    if (caught.length) {
      const dc = computeSheetDerived(sheet).spellSaveDc ?? 13;
      const burned = resolveCounterSave(campaign, sheet, { name: `${WILDFIRE_SPIRIT}'s arrival`, save: "dex", dc, dice: "2d6", type: "fire", half: false, magical: true }, { turnId, targetEnemyIds: caught });
      if (!("error" in burned)) {
        lines.push(...((burned.result.applied as string[] | undefined) ?? []));
      }
    }
  }
  return {
    result: {
      summoned: made ? { characterId: made.id, name: made.name, hp: `${made.currentHp}/${made.maxHp}`, ac: made.ac } : null,
      creature: `${form.name}: ${form.hp} HP, AC ${form.ac}, speed 30 ft., fly 30 ft. Flame Seed +${form.attacks[0].toHit} (${form.attacks[0].damage} fire, 60 ft.).`,
      ...(replaced.length ? { replaced: "The earlier spirit is gone; one at a time." } : {}),
      ...(lines.length ? { arrival: lines } : {}),
      note: "The wildfire spirit is an ally on the board, acting right after its druid; it attacks with pc_attack under its own characterId.",
    },
  };
}

export function eldritchCannonForm(sheet: CharacterSheet): SummonForm {
  const level = levelIn(sheet, "artificer");
  return {
    name: ELDRITCH_CANNON,
    type: "construct",
    size: "Small",
    cr: 0,
    ac: 18,
    hp: 5 * level,
    speed: 15,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    attacks: [],
    immune: "poison, psychic",
    conditionImmune: "all conditions",
    traits: "A magical cannon: a bonus action of its artificer, within 60 feet, activates it (Flamethrower, Force Ballista or Protector). Mending repairs it.",
  };
}

// The artificer's cannon: one at a time, two with Fortified Position (the
// oldest goes when a third is made).
export function createEldritchCannon(campaign: Campaign, sheet: CharacterSheet): { result: Record<string, unknown> } {
  const standing = summonsOf(campaign.id, sheet.id, ELDRITCH_CANNON);
  const keep = holdsFeature(sheet, "fortified position") ? 1 : 0;
  const gone = standing.slice(0, Math.max(0, standing.length - keep));
  for (const old of gone) {
    removeSummon(campaign, old);
  }
  const form = eldritchCannonForm(sheet);
  const record = summonRecord(form, { spell: ELDRITCH_CANNON, casterId: sheet.id, casterName: sheet.name, concentration: false, castId: randomUUID().slice(0, 8) });
  const [made] = spawnSummons(campaign, sheet, { form, count: 1, record, rounds: 600, slotLevel: null, initiative: "caster", overrides: { level: sheet.level } });
  const encounter = getActiveEncounter(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const spot = map && made ? getTokenByRef(map.id, made.id) : null;
  const laid = spot ? placeSpellZone(campaign, { spell: ELDRITCH_CANNON, caster: { kind: "pc", id: sheet.id, name: sheet.name }, at: { x: spot.x, y: spot.y }, named: true }) : null;
  return {
    result: {
      summoned: made ? { characterId: made.id, name: made.name, hp: `${made.currentHp}/${made.maxHp}`, ac: made.ac } : null,
      creature: `${form.name}: AC ${form.ac}, ${form.hp} hit points, an hour.`,
      ...(gone.length ? { replaced: `The earlier cannon is gone; ${keep ? "two" : "one"} at a time.` } : {}),
      ...(laid ? { board: laid } : {}),
    },
  };
}
