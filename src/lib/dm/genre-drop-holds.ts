// The genre classes' "when you drop to 0 HP, drop to 1 instead" counters,
// held at the drop itself, as Relentless Endurance and Undying Sentinel are
// (src/lib/dm/pc-damage.ts calls this before the death engine sees the drop).
// Before this each was a card the Hand dealt on the holder's own turn, which
// spent the use with nothing to answer, and at 0 hit points the card was shut:
// Won't Die Here never kept a survivor up.
//
// Each counter is passive (src/lib/srd/genre-a-counter-terms.ts), so a bare
// use_resource spend is refused; this is the one door that spends it. Like the
// SRD holds, none answers a blow that kills outright (massive damage,
// Disintegrate): "drop to 0" is the trigger, and a killing blow is past it.
//
// A hold on another creature ("an ally within 30 ft") is measured on the live
// board; off a board, range is open, as the reactions read it.
import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { tilesApart } from "@/lib/dm/board-reach";
import { isMassiveDamage } from "@/lib/dm/death-logic";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import { computeSheetDerived } from "@/lib/srd";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";

type Mods = Record<string, number>;

type SelfHold = {
  id: string;
  feature: string;
  // Hit points the holder stands at, temporary hit points with them.
  hp: (level: number, mods: Mods, sheet: CharacterSheet) => number;
  tempHp?: (level: number) => number;
  // A pool that stands in for this one when the holder carries it (The One
  // Who Lives: Won't Die Here twice a day).
  pool?: (sheet: CharacterSheet) => string;
  // A condition laid with the hold (The Last Candle: the Vigil burns again).
  condition?: { name: string; rounds: number };
};

type AllyHold = { id: string; feature: string; rangeFt: number; hp: (mods: Mods) => number };

const holds = (sheet: CharacterSheet, id: string) => Boolean(sheet.resources?.[id]);

const SELF_HOLDS: SelfHold[] = [
  {
    id: "horror_won_t_die_here",
    feature: "Won't Die Here",
    // "Won't Die Here works 2/day, and each use also restores CON-mod x 5 HP."
    pool: (sheet) => (holds(sheet, "horror_the_one_who_lives") ? "horror_the_one_who_lives" : "horror_won_t_die_here"),
    hp: (_level, mods, sheet) => 1 + (holds(sheet, "horror_the_one_who_lives") ? 5 * Math.max(0, mods.con ?? 0) : 0),
  },
  // Sainted Scars (17th): "each use also grants temp HP equal to your level".
  { id: "dark_fantasy_martyr_s_endurance", feature: "Martyr's Endurance", hp: () => 1, tempHp: (level) => (level >= 17 ? level : 0) },
  { id: "dark_fantasy_deathless_vigor", feature: "Deathless Vigor", hp: () => 1, tempHp: (level) => level },
  { id: "horror_the_last_candle", feature: "The Last Candle", hp: () => 1, condition: { name: "candlelight vigil", rounds: 10 } },
];

const ALLY_HOLDS: AllyHold[] = [
  { id: "cyberpunk_one_more_dawn", feature: "One More Dawn", rangeFt: 30, hp: () => 1 },
  // "they instead drop to WIS-mod x 5 HP"
  { id: "horror_final_benediction", feature: "Final Benediction", rangeFt: 30, hp: (mods) => Math.max(1, 5 * (mods.wis ?? 0)) },
];

function feetApart(encounterId: string, a: string, b: string): number | null {
  const map = getBattleMapForEncounter(encounterId);
  const from = map ? getTokenByRef(map.id, a) : null;
  const to = map ? getTokenByRef(map.id, b) : null;
  return from && to ? tilesApart(from, to) * 5 : null;
}

function spent(sheet: CharacterSheet, id: string): CharacterSheet["resources"] | null {
  const state = sheet.resources?.[id];
  return state && state.used < state.max ? { ...sheet.resources, [id]: { max: state.max, used: state.used + 1 } } : null;
}

export type DropWrite = (target: CharacterSheet, patch: FullPatchSheetInput, delta: Record<string, unknown>) => void;

// The hold that keeps the creature up, written through `write` (pc-damage's
// own audit and publish), or null when none answers.
export function genreDropHold(
  campaign: Campaign,
  stale: CharacterSheet,
  math: { dropped: boolean; overkill: number },
  input: { disintegrate?: boolean },
  write: DropWrite,
): Record<string, unknown> | null {
  const sheet = getSheetById(stale.id) ?? stale;
  if (!math.dropped || input.disintegrate || isMassiveDamage(math.overkill, effectiveMaxHp(sheet))) {
    return null;
  }
  const max = effectiveMaxHp(sheet);
  for (const hold of SELF_HOLDS) {
    const pool = hold.pool?.(sheet) ?? hold.id;
    const resources = spent(sheet, pool);
    if (!resources) {
      continue;
    }
    const derived = computeSheetDerived(sheet);
    const level = Math.max(1, sheet.level ?? 1);
    const hp = Math.min(max, hold.hp(level, derived.abilityMods, sheet));
    const temp = hold.tempHp?.(level) ?? 0;
    const patch: FullPatchSheetInput = {
      currentHp: hp,
      resources,
      ...(temp > (sheet.tempHp ?? 0) ? { tempHp: temp } : {}),
      ...(hold.condition && !sheet.conditions.some((entry) => isConditionNamed(entry, hold.condition!.name))
        ? { conditions: [...sheet.conditions, hold.condition.name], conditionMeta: { ...(sheet.conditionMeta ?? {}), [hold.condition.name]: { rounds: hold.condition.rounds } } }
        : {}),
    };
    write(sheet, patch, { [hold.feature]: true });
    return {
      ok: true,
      hp: `${hp}/${max}`,
      held: hold.feature,
      note: `${sheet.name} should have fallen, but ${hold.feature} holds them at ${hp} HP${temp ? ` with ${temp} temporary hit points` : ""}${hold.condition ? `, and their ${hold.condition.name} burns again` : ""}. The use is spent.`,
    };
  }
  const encounter = getActiveEncounter(campaign.id);
  for (const hold of ALLY_HOLDS) {
    for (const holder of listSheets(campaign.id)) {
      if (holder.id === sheet.id || holder.currentHp <= 0 || holder.deathSaves?.dead) {
        continue;
      }
      const resources = spent(holder, hold.id);
      if (!resources) {
        continue;
      }
      const feet = encounter ? feetApart(encounter.id, holder.id, sheet.id) : null;
      if (feet !== null && feet > hold.rangeFt) {
        continue;
      }
      const hp = Math.min(max, hold.hp(computeSheetDerived(holder).abilityMods));
      write(holder, { resources }, { [hold.feature]: sheet.name });
      write(sheet, { currentHp: hp }, { [hold.feature]: holder.name });
      return {
        ok: true,
        hp: `${hp}/${max}`,
        held: hold.feature,
        note: `${sheet.name} should have fallen, but ${holder.name}'s ${hold.feature} holds them at ${hp} HP. The use is spent.`,
      };
    }
  }
  return null;
}
