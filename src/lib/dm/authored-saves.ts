// What the authored subclass features do to a creature's saving throw and to
// the damage a character's blow deals it (src/lib/srd/authored-effects.ts):
//
//   Magical Ambush: a creature the rogue is hidden from saves at
//     disadvantage against the rogue's spell.
//   Hound of Ill Omen, Eldritch Strike: the marked creature saves at
//     disadvantage against the marker's spell (Eldritch Strike's mark is
//     spent by that save).
//   Corona of Light, Elder Champion: enemies near the holder save at
//     disadvantage against spells (Corona: anyone's; Elder Champion: the
//     paladin's own).
//   Unsettling Words: the die the registry row takes off the next save is
//     spent by it.
//   Inescapable Destruction: the Death cleric's necrotic damage ignores
//     resistance.
//
// The caster is the combatant whose turn it is: a spell a character casts at
// a creature is cast on their own turn, so the pointer names them. Called
// from rollEnemySave (forced-save.ts) and applyEnemyDamage (enemy-damage.ts);
// this module must not import either.

import { sideOf } from "@/lib/dm/combatant";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getActiveEncounter, getEnemy, patchEnemyConditions, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { spaceOf, tilesApart } from "@/lib/dm/board-reach";
import { hasLineOfSightBetween } from "@/lib/battlemap/los";
import { sightTerrainFor } from "@/lib/dm/zone-rules";
import { characterSenses, enemySenses, sensesReaching } from "@/lib/dm/attack-light";

import type { Advantage } from "@/lib/dice";
import { activeAuthored, hasCondition } from "@/lib/srd/authored-effects";
import { removeConditions, sightBlockedBy, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { textKey, words } from "@/lib/language/text-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { ownTurnOf } from "@/lib/dm/held-turn";

// The character whose turn it is, when the pointer rests on one and their
// turn has begun (held-turn.ts ownTurnOf): in the goblins' pass before Brom
// nobody of the party is acting, and Brom's features read as his.
export function actingSheetId(encounter: Encounter | null): string | null {
  if (!encounter?.orderReady) {
    return null;
  }
  const entry = encounter.order[encounter.turnIndex];
  return entry?.kind === "pc" && ownTurnOf(encounter, entry.characterId) ? entry.characterId : null;
}

// Whether two combatants stand within `feet` of each other on the live
// board. With no board there is nothing to measure, and the fiction decides.
export function withinFeet(encounterId: string, fromRef: string, toRef: string, feet: number): boolean {
  const map = getBattleMapForEncounter(encounterId);
  if (!map) {
    return true;
  }
  const from = getTokenByRef(map.id, fromRef);
  const to = getTokenByRef(map.id, toRef);
  if (!from || !to) {
    return false;
  }
  return tilesApart(from, to) <= Math.floor(feet / 5);

}

// Whether one creature can see another on the board: line of sight between
// their tokens through walls and the zones that block sight (zone-rules.ts),
// for a reaction whose text says "a creature you can see". Off the board, or
// with a token missing, it is open: nothing says they cannot.
export function seesOnBoard(encounterId: string, fromRef: string, toRef: string): boolean {
  const map = getBattleMapForEncounter(encounterId);
  if (!map || fromRef === toRef) {
    return true;
  }
  const from = getTokenByRef(map.id, fromRef);
  const to = getTokenByRef(map.id, toRef);
  // A token off the board's edge (a creature parked out of the scene) is not
  // judged: nothing on the board stands between.
  const off = (token: { x: number; y: number }) => token.x < 0 || token.y < 0 || token.x >= map.width || token.y >= map.height;
  if (!from || !to || off(from) || off(to)) {
    return true;
  }
  // `self`: an area its own caster sees through does not stand in their way (zones.ts seenThroughBy).
  return hasLineOfSightBetween(sightTerrainFor(map, { self: fromRef }), map.width, spaceOf(from), spaceOf(to));
}

// Why a character cannot see a creature for a feature whose text says "you
// can see" (Nature's Wrath, Champion Challenge, Conquering Presence, Abjure
// Enemy), or null when they can: the conditions first (blinded, an invisible
// or hidden creature: condition-logic.ts sightBlockedBy), then the board's
// line of sight. The board alone let an invisible goblin be taken.
// Either side may look: a character, or a creature of the fight (Charm Animals
// and Plants asks whether the beast can see the cleric). Blindsight or
// truesight that reaches the other sees past invisibility (attack-light.ts
// sensesReaching, the rule an attack roll reads too).
type Looker = { id: string; conditions: string[]; name?: string; displayName?: string } & (
  | Pick<CharacterSheet, "features" | "race">
  | Pick<EncounterEnemy, "stats">
);

const lookerName = (looker: Looker) => looker.displayName ?? looker.name ?? "";

export function unseenBecause(encounterId: string, viewer: Looker, seen: Looker, options: { hidden?: boolean } = {}): string | null {
  return unseenByConditions(encounterId, viewer, seen, options) ?? (seesOnBoard(encounterId, viewer.id, seen.id) ? null : "no line of sight");
}

// The conditions' part alone: blinded, invisible, hidden, and the senses that see past them.
export function unseenByConditions(encounterId: string | null, viewer: Looker, seen: Looker, options: { hidden?: boolean }): string | null {
  const senses = "stats" in viewer ? enemySenses(viewer) : characterSenses(viewer);
  const reach = sensesReaching(encounterId, { refId: viewer.id, senses }, { refId: seen.id });
  const blocked = sightBlockedBy(viewer.conditions, seen.conditions, { ...reach, hidden: options.hidden });
  if (!blocked) {
    return null;
  }
  return blocked === "blinded" ? `${lookerName(viewer)} is blinded` : `${lookerName(seen)} is ${blocked}`;
}

// Why a character cannot see a creature for a reaction whose text says "a
// creature you can see", or null: the conditions as a Channel Divinity reads
// them (an invisible attacker, a blinded holder), then the board's line of
// sight. The board alone let a blinded rogue Uncanny Dodge. Hiding does not
// count: the attack gave the attacker away, and an ally hides from the foes,
// not from its friends. The player's Hand deals by the same answer
// (battlemap/view.ts `unseen`, which asks the same two parts).
export function reactionUnseen(encounterId: string, holderId: string, seenId: string): { why: string | null } | null {
  const looker = getSheetById(holderId);
  const other = getEnemy(seenId) ?? getSheetById(seenId);
  const why = looker && other ? unseenByConditions(encounterId, looker, other, { hidden: false }) : null;
  return why || !seesOnBoard(encounterId, holderId, seenId) ? { why } : null;
}

// The refusal for a reaction its holder cannot see the creature for, or null.
export function unseenRefusal(encounterId: string | undefined, holder: { id: string; name: string }, seen: { id: string | null; name: string }, feature: string): { error: string; refused: "rules" } | null {
  const unseen = encounterId && seen.id ? reactionUnseen(encounterId, holder.id, seen.id) : null;
  if (!unseen) {
    return null;
  }
  const lead = unseen.why ? `${holder.name} cannot see ${seen.name} (${unseen.why})` : `${holder.name} has no line of sight to ${seen.name}`;
  return { error: `${lead}, and ${feature} answers a creature they can see. Nothing was spent.`, refused: "rules" };
}

function sourcedMark(enemy: EncounterEnemy, name: string): { condition: string; source: string | undefined } | null {
  const condition = enemy.conditions.find((entry) => textKey(entry) === name);
  if (!condition) {
    return null;
  }
  return { condition, source: (enemy.conditionMeta as ConditionMetaMap)[condition]?.source };
}

function fielded(campaignId: string): CharacterSheet[] {
  return listSheets(campaignId)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((sheet) => !sheet.deathSaves?.dead && sheet.currentHp > 0);
}

export function authoredEnemySave(
  campaignId: string,
  enemy: EncounterEnemy,
  // `channel`: a save against a Channel Divinity option, which an enemy_save
  // row with `channel` answers as it answers a spell (Elder Champion).
  options: { magical?: boolean; damageType?: string; channel?: boolean } = {},
): { sources: Advantage[]; notes: string[] } {
  const sources: Advantage[] = [];
  const notes: string[] = [];
  const encounter = getActiveEncounter(campaignId);
  const actorId = actingSheetId(encounter);
  const spent: string[] = [];
  // Unsettling Words: the registry row has taken its die off this save.
  for (const condition of enemy.conditions) {
    if (/^unsettled \(d\d+\)$/i.test(condition.trim())) {
      spent.push(condition);
    }
  }
  if (encounter && (options.magical || options.channel)) {
    for (const holder of fielded(campaignId)) {
      for (const { effect, held } of activeAuthored(holder, "enemy_save")) {
        if (!options.magical && !effect.channel) {
          continue;
        }
        const mine = holder.id === actorId;
        if (effect.when === "hidden") {
          if (mine && hasCondition(holder, "hidden")) {
            sources.push("disadvantage");
            notes.push(`${held.feature}: ${holder.name} is hidden from it; disadvantage on the save`);
          }
        } else if (effect.when === "marked" && effect.mark) {
          const mark = sourcedMark(enemy, effect.mark);
          if (mine && mark && mark.source === holder.id) {
            sources.push("disadvantage");
            notes.push(`${held.feature}: disadvantage on the save against ${holder.name}'s spell`);
          }
        } else if (effect.when === "near") {
          // Corona of Light: "disadvantage on saving throws against any
          // spell that deals fire or radiant damage"; before this every
          // spell's save in the light was at disadvantage.
          const typed = !effect.damageTypes || effect.damageTypes.some((type) => words(options.damageType ?? "").map(textKey).includes(type));
          if (typed && (effect.anyCaster || mine) && withinFeet(encounter.id, holder.id, enemy.id, effect.rangeFt ?? 10)) {
            sources.push("disadvantage");
            notes.push(`${held.feature}: disadvantage on the save within ${effect.rangeFt ?? 10} feet of ${holder.name}`);
          }
        }
      }
      // Eldritch Strike: the fighter's mark, spent by the save against their spell.
      for (const { effect, held } of activeAuthored(holder, "mark")) {
        if (effect.effect !== "save_disadv" || holder.id !== actorId || !options.magical) {
          continue;
        }
        const mark = sourcedMark(enemy, effect.condition);
        if (mark && mark.source === holder.id) {
          sources.push("disadvantage");
          notes.push(`${held.feature}: disadvantage on this save against ${holder.name}'s spell`);
          spent.push(mark.condition);
        }
      }
    }
  }
  if (spent.length) {
    const cleared = removeConditions(enemy.conditions, enemy.conditionMeta, spent);
    patchEnemyConditions(enemy.id, cleared.conditions, cleared.meta);
  }
  return { sources, notes };
}

// Inescapable Destruction: the acting character's damage of this type
// ignores the creature's resistance to it.
export function authoredIgnoresResistance(campaignId: string, damageType: string | undefined): string | null {
  const type = (damageType ?? "").trim().toLowerCase();
  if (!type) {
    return null;
  }
  const actorId = actingSheetId(getActiveEncounter(campaignId));
  const actor = actorId ? getSheetById(actorId) : null;
  if (!actor) {
    return null;
  }
  const held = activeAuthored(actor, "ignore_resist").find(({ effect }) => effect.types.includes(type));
  return held ? held.held.feature : null;
}

function reach(range: number | Array<[number, number]>, level: number): number {
  if (typeof range === "number") {
    return range;
  }
  let feet = range[0]?.[1] ?? 10;
  for (const [atLevel, value] of range) {
    if (level >= atLevel) {
      feet = value;
    }
  }
  return feet;
}

// Resistances an ally's aura grants the character now: Aura of Warding
// (spell damage) and Shielding Storm (the storm's type).
export function authoredAuraResistances(campaignId: string, sheet: CharacterSheet, options: { spell?: boolean } = {}): string[] {
  const out: string[] = [];
  const encounter = getActiveEncounter(campaignId);
  // An aura covers the holder's own side of a fight (src/lib/dm/combatant.ts).
  const side = encounter ? sideOf(encounter, "sheet", sheet.id, sheet) : null;
  for (const holder of fielded(campaignId)) {
    if (encounter && holder.id !== sheet.id && sideOf(encounter, "sheet", holder.id, holder) !== side) {
      continue;
    }
    for (const { effect, held } of activeAuthored(holder, "aura_resist")) {
      const inRange =
        holder.id === sheet.id ||
        !encounter ||
        withinFeet(encounter.id, holder.id, sheet.id, reach(effect.rangeFt, held.level));
      if (!inRange) {
        continue;
      }
      if (effect.spells) {
        if (options.spell) {
          out.push(
            "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
            "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
          );
        }
        continue;
      }
      if (effect.typeFrom && holder.id !== sheet.id) {
        const aura = holder.conditions.find((entry) => isConditionNamed(entry, effect.typeFrom!.condition));
        const kind = aura ? /\(([^)]+)\)/.exec(aura)?.[1] : undefined;
        const type = kind ? effect.typeFrom.map[textKey(kind)] : undefined;
        if (type) {
          out.push(type);
        }
      }
    }
  }
  return [...new Set(out)];
}
