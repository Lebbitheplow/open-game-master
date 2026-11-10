// Areas resolved one creature per call (SRD 5.1, Spellcasting: Areas of
// Effect; Combat: Damage Rolls):
//
//   - one casting of an area spell is one placement and one damage roll.
//     cast_at_enemy may resolve it a creature at a time; every creature it
//     names must fit the same placement as those before it, and takes the
//     same dice (aoe-shape.ts areaProblem, cast-rules.ts open casts).
//   - a concentration area that comes again (Moonbeam, Cloudkill, Sleet
//     Storm) strikes a creature on an event the spell names, entering it for
//     the first time on a turn or a turn starting or ending there: once a
//     turn. An explicit call is its caster moving the area over the creatures
//     it names. On a battle map the board's own triggers (zone-triggers.ts)
//     and an explicit call keep one ledger, the zone's, which the area keeps
//     as it moves; without a board the fight keeps it (legendary.areaStruck).

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, saveEncounter, turnKey, type Encounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import type { SpellZone } from "@/lib/battlemap/zones";
import { zoneRowFor, type ZoneNamed } from "@/lib/battlemap/zones-spells";
import { budgetApplies } from "@/lib/dm/action-budget";
import { areaProblem, creaturesInBlast, creaturesInLaidZone, spellAreaShape, type AreaShape } from "@/lib/dm/aoe-shape";
import type { XY } from "@/lib/battlemap/types";
import { openCastOf, withOpenCast, type OpenCast } from "@/lib/dm/cast-rules";
import { textKey } from "@/lib/language/text-logic";
import { currentCombatantId, storeBudget } from "@/lib/dm/turn-budget";
import { liveZones, saveZones, publishZones } from "@/lib/dm/zone-store";
import type { ToolError } from "@/lib/dm/tool-errors";
import { spellFactsFor, spellMechanicsFor } from "@/lib/content";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";

type Target = { id: string; name: string };

// ---- one placement, one roll ----

// The open casting of an area spell on its caster's own turn, or null.
export function openAreaCast(encounter: Encounter, casterId: string, spell: string): OpenCast | null {
  if (currentCombatantId(encounter) !== casterId || !budgetApplies(encounter.turnBudget, casterId, encounter.round)) {
    return null;
  }
  return openCastOf(encounter.turnBudget, spell);
}

// Why this creature cannot be another of the casting's: it does not fit one
// placement with the creatures the casting has already caught.
export function areaShareProblem(input: {
  encounter: Encounter;
  caster: { id: string; name: string };
  spell: string;
  authors: string[];
  rangeFeet: number | null;
  rangeSelf: boolean;
  target: Target;
  at?: { x: number; y: number };
}): ToolError | null {
  const open = openAreaCast(input.encounter, input.caster.id, input.spell);
  const shape = spellAreaShape(input.spell, input.authors);
  if (!open?.caught?.length || !shape) {
    return null;
  }
  const before = open.caught
    .filter((id) => id !== input.target.id)
    .map((id) => ({ id, name: getEnemy(id)?.displayName ?? getSheetById(id)?.name ?? id }));
  return areaProblem({
    encounterId: input.encounter.id,
    casterId: input.caster.id,
    casterName: input.caster.name,
    label: input.spell,
    area: { ...shape, self: shape.self || input.rangeSelf },
    rangeFeet: input.rangeFeet,
    creatures: [...before, input.target],
    ...(input.at ? { at: input.at } : {}),
  });
}

// Writes the creature caught and the casting's one damage roll onto the open
// casting, for the next call of it. Nothing to write once the casting holds
// no more.
export function recordAreaShare(campaignId: string, casterId: string, spell: string, targetId: string, roll: number | null, rollSecond: number | null = null) {
  const live = getActiveEncounter(campaignId);
  const open = live ? openAreaCast(live, casterId, spell) : null;
  if (!live?.turnBudget || !open) {
    return;
  }
  storeBudget(live, withOpenCast(live.turnBudget, {
    ...open,
    caught: [...(open.caught ?? []).filter((id) => id !== targetId), targetId],
    ...(open.roll === undefined && roll !== null ? { roll, ...(rollSecond !== null ? { rollSecond } : {}) } : {}),
  }));
}

// ---- a recurring area, once a turn ----

const strikeKey = (spell: string, casterId: string, targetId: string) => `${textKey(spell)}|${casterId}|${targetId}`;

function zoneOf(encounter: Encounter, spell: string, casterId: string): { mapId: string; zones: SpellZone[]; zone: SpellZone } | null {
  const map = getBattleMapForEncounter(encounter.id);
  if (!map) {
    return null;
  }
  const zones = liveZones(map, encounter);
  const zone = zones.find((entry) => entry.casterId === casterId && [entry.spell, entry.heldBy ?? ""].some((name) => textKey(name) === textKey(spell)));
  return zone ? { mapId: map.id, zones, zone } : null;
}

// Why a concentration area's effect cannot come again on this creature now
// (it has suffered it this turn), or null.
export function repeatStrikeProblem(encounter: Encounter, input: { spell: string; casterId: string; target: Target }): ToolError | null {
  const key = turnKey(encounter);
  const laid = zoneOf(encounter, input.spell, input.casterId);
  const struck = laid
    ? [laid.zone.struck?.[`${input.target.id}:enter`], laid.zone.struck?.[`${input.target.id}:start`]].includes(key)
    : encounter.legendary.areaStruck?.[strikeKey(input.spell, input.casterId, input.target.id)] === key;
  return struck
    ? {
        error: `${input.target.name} has already suffered ${input.spell} this turn. It comes again only when a creature enters the area for the first time on a turn or starts its turn there${laid ? " (on this battle map the server resolves both itself)" : ""}. Nothing was spent.`,
        refused: "rules",
      }
    : null;
}

// The resolved name of a call that is its caster's held area coming again
// for nothing (Moonbeam while they concentrate on it), or null.
export function freeRepeatOf(campaign: Campaign, casterId: string | null | undefined, spell: string): string | null {
  return freeRepeatFor(spellAuthorsFor(campaign), casterId, spell);
}

function freeRepeatFor(authors: string[], casterId: string | null | undefined, spell: string): string | null {
  const caster = casterId ? getSheetById(casterId) : null;
  const resolved = caster?.concentratingOn ? spellMechanicsFor({ spell, userIds: authors }) : null;
  return resolved?.mech.repeat === "free" && textKey(caster?.concentratingOn ?? "") === textKey(resolved.name) ? resolved.name : null;
}

// Whether a player's spell laid on a square of the battle map, naming
// nobody, catches the creatures standing in it. An instant blast does. A
// spell that also leaves a lasting area does when its area catches them as
// it appears (Ice Storm's hail, Entangle, a Wall of Fire: zones-spells.ts
// catchesWhenLaid): gating on any zone row let Ice Storm roll its dice and
// spend its slot on nobody. A Web catches nobody when cast, and a held area
// coming again (Insect Plague's swarm) strikes only the creatures it names,
// entering or ending a turn there. `authors`: the table's (spellAuthorsFor),
// for a workshop copy.
export function boardCatchesCast(authors: string[], casterId: string, spell: ZoneNamed): boolean {
  const row = zoneRowFor(spell);
  if (!row) {
    return true;
  }
  return Boolean(row.catchesWhenLaid) && !freeRepeatFor(authors, casterId, typeof spell === "string" ? spell : spell.spell);
}

// Who a player's spell laid on the battle map, naming nobody, catches as it
// is cast: one reader for aoe_damage and the Portent stop (foresight.ts
// areaCatch), so the stop asks about the saves the casting then rolls. The
// burst its text prints (aoe-shape.ts creaturesInBlast), else the squares
// its lasting area is laid on (creaturesInLaidZone: Entangle, Grease, a
// wall). Null when it catches nobody as it is cast, or has no area to read.
// `blast` is the burst, for the refusal of one laid on nobody.
export function boardCatch(input: {
  authors: string[];
  encounterId: string;
  caster: { id: string; name: string };
  spell: string;
  runsAs?: string;
  slotLevel?: number | null;
  placement: { at?: XY; toward?: XY };
}): { caught: { enemyIds: string[]; characterIds: string[] } | ToolError | null; blast: AreaShape | null } | null {
  const named = { spell: input.spell, ...(input.runsAs ? { runsAs: input.runsAs } : {}) };
  if (!boardCatchesCast(input.authors, input.caster.id, named)) {
    return null;
  }
  const blast = spellAreaShape(input.spell, input.authors);
  if (blast) {
    const range = spellFactsFor(input.spell, input.authors)?.range;
    return {
      blast,
      caught: creaturesInBlast({
        encounterId: input.encounterId,
        casterId: input.caster.id,
        casterName: input.caster.name,
        label: input.spell,
        area: blast,
        rangeFeet: range?.kind === "feet" ? range.feet : null,
        ...input.placement,
      }),
    };
  }
  if (!zoneRowFor(named)) {
    return null;
  }
  return {
    blast: null,
    caught: creaturesInLaidZone({ encounterId: input.encounterId, casterId: input.caster.id, label: input.spell, spell: named, slotLevel: input.slotLevel, ...input.placement }),
  };
}

// The first creature of an aoe_damage call the held area may not strike now.
export function repeatStrikesProblem(encounter: Encounter, spell: string, casterId: string, targets: Target[]): ToolError | null {
  for (const target of targets) {
    const problem = repeatStrikeProblem(encounter, { spell, casterId, target });
    if (problem) {
      return { ...problem, error: `${problem.error} Leave ${target.name} out of the call.` };
    }
  }
  return null;
}

// Marks the creatures an explicit call struck, as the board marks entering.
export function markRepeatStruck(campaign: Campaign, spell: string, casterId: string, targetIds: string[]) {
  const live = getActiveEncounter(campaign.id);
  if (!live || !targetIds.length) {
    return;
  }
  const key = turnKey(live);
  const laid = zoneOf(live, spell, casterId);
  if (laid) {
    laid.zone.struck = { ...(laid.zone.struck ?? {}), ...Object.fromEntries(targetIds.map((id) => [`${id}:enter`, key])) };
    saveZones(laid.mapId, laid.zones);
    publishZones(campaign.id);
    return;
  }
  // Only this turn's strikes matter; older ones go as the ledger is written.
  const kept = Object.fromEntries(Object.entries(live.legendary.areaStruck ?? {}).filter(([, turn]) => turn === key));
  for (const id of targetIds) {
    kept[strikeKey(spell, casterId, id)] = key;
  }
  saveEncounter({ ...live, legendary: { ...live.legendary, areaStruck: kept } });
}
