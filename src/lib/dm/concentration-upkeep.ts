// Concentration upkeep as durations run out: a caster whose spell no longer
// holds anything on the board stops concentrating. Split from
// condition-tick.ts, which calls this after every tick of the round clock
// and the in-world clock.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveBoard, getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import { zoneKey, zoneOwnKey, zoneRowFor } from "@/lib/battlemap/zones-spells";
import { liveZones } from "@/lib/dm/zone-store";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { spellEngineName, spellMechanicsFor } from "@/lib/content";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { instancesOf, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { breakConcentration } from "@/lib/dm/concentration";
import { heldBySpell } from "@/lib/dm/spell-effects";
import { summonsOf } from "@/lib/dm/summon-store";
import { summonSpellFor } from "@/lib/srd/summon-spells";
import { textKey } from "@/lib/language/text-logic";

// A conjuring spell places no condition: what it holds is the creatures it
// brought. When the last of them has faded (its hour run out on the clock,
// or its rounds at the wrap) the spell has ended, and so has the
// concentration on it. Called after every sweep of the summons.
export function endConcentrationOnFadedSummons(campaign: Campaign, lines: string[]) {
  for (const stale of listSheets(campaign.id)) {
    const sheet = getSheetById(stale.id) ?? stale;
    const spell = sheet.concentratingOn;
    // A table's workshop copy of a summoning spell summons as the spell it
    // runs as, under its own name.
    if (!spell || sheet.deathSaves?.dead || !summonSpellFor(spellEngineName(spell, spellAuthorsFor(campaign)))) {
      continue;
    }
    if (summonsOf(campaign.id, sheet.id, spell).length) {
      continue;
    }
    if (breakConcentration(campaign, null, sheet.id, `${spell} has run its course`)) {
      lines.push(`${sheet.name} stops concentrating: ${spell} has run its course.`);
    }
  }
}

// Whether this caster's spell still lays its area on the ground: on a
// board, a square of it stands there (fire can burn a whole web away); off
// one, nothing records the area, so nothing says it has gone. The area
// itself ends with the concentration (zone-store.ts), its duration on the
// concentration clock.
function areaStands(campaign: Campaign, casterId: string, spell: string): boolean {
  // A table's workshop copy lays the area of the spell it runs as.
  if (!zoneRowFor({ spell, runsAs: spellEngineName(spell, spellAuthorsFor(campaign)) })) {
    return false;
  }
  const board = getActiveBoard(campaign.id);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  if (!map) {
    return true;
  }
  const wanted = zoneKey(spell);
  return liveZones(map, board).some((zone) => zone.casterId === casterId && zoneOwnKey(zone) === wanted && zone.cells.length > 0);
}

// Concentration lasts no longer than the spell. When durations have run out,
// a caster whose spell is known to hold conditions in place, and whose
// conditions nobody holds any more, is no longer concentrating. A spell the
// content pack cannot describe, one that places no condition, or one whose
// area still stands, is left alone: there is nothing here to say it has
// ended.
export function endSpentConcentration(campaign: Campaign, lines: string[]) {
  const sheets = listSheets(campaign.id).map((stale) => getSheetById(stale.id) ?? stale);
  const casters = sheets.filter((sheet) => sheet.concentratingOn && !sheet.deathSaves?.dead);
  if (!casters.length) {
    return;
  }
  const encounter = getActiveEncounter(campaign.id);
  // Every condition on the board with its metadata, so each caster counts
  // only what their own casting holds (a condition records its spell and
  // caster, src/lib/dm/spell-effects.ts), not a same-named one from elsewhere.
  const held = [
    ...sheets.map((sheet) => ({ conditions: sheet.conditions, meta: sheet.conditionMeta as ConditionMetaMap })),
    ...(encounter ? listEnemies(encounter.id) : [])
      .filter((enemy) => enemy.status === "alive")
      .map((enemy) => ({ conditions: enemy.conditions ?? [], meta: enemy.conditionMeta as ConditionMetaMap })),
  ];
  for (const caster of casters) {
    const spell = caster.concentratingOn ?? "";
    const resolved = spellMechanicsFor({ spell, userIds: spellAuthorsFor(campaign) });
    const places = new Set(
      [
        resolved?.mech.buff?.condition,
        ...(resolved?.mech.buff?.variants ?? []),
        ...(resolved?.mech.buff?.bySlot ?? []).map(([, name]) => name),
        resolved?.mech.condition?.name,
        ...(resolved?.mech.condition?.also ?? []),
      ]
        .filter((name): name is string => Boolean(name))
        .map((name) => name.toLowerCase()),
    );
    if (!places.size) {
      continue;
    }
    // A spell that lays an area holds the area as well as whom it caught: a
    // Web nobody is stuck in still stands for its hour, and the next
    // creature to walk in can be caught (SRD 5.1). A buff on the caster
    // (Spirit Guardians) is still its own record and ends with it.
    if (!resolved?.mech.buff && areaStands(campaign, caster.id, spell)) {
      continue;
    }
    const spellNames = new Set([textKey(spell), textKey(resolved?.name ?? spell)]);
    // Every instance counts: a target another caster also holds still
    // carries this caster's own (src/lib/dm/condition-logic.ts instancesOf).
    const stillHeld = held.some(({ conditions, meta }) =>
      conditions.some((name) => instancesOf(meta[name]).some((instance) => heldBySpell(name, instance, spellNames, places, caster.id))),
    );
    if (stillHeld) {
      continue;
    }
    if (breakConcentration(campaign, null, caster.id, "the spell ran its course")) {
      lines.push(`${caster.name} is no longer concentrating on ${spell} (the spell has ended).`);
    }
  }
}
