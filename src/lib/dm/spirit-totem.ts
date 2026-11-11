// The Shepherd druid's Spirit Totem on the board (XGtE's Circle of the
// Shepherd, written in src/lib/srd/subclasses.json): "call a spirit to a
// point within 60 feet for a minute, with a 30-foot aura you can move 60 feet
// as a bonus action". The spirit is a board area ("Spirit Totem", a row of
// src/lib/battlemap/zones-spells.ts) laid at the point and held while the
// druid carries "spirit totem: <bear|hawk|unicorn>"; the aura's readers ask
// here whether a creature stands in it:
//
//   the Bear's temporary hit points when it appears (raiseSpiritTotem), and
//   its advantage on Strength checks and saves;
//   the Hawk's advantage on Perception checks;
//   the Unicorn's advantage on checks to detect creatures (Perception and
//   Investigation) and its healing after a slot's healing spell
//   (src/lib/dm/heal-after-dra.ts);
//   Guardian Spirit's healing of the druid's summons at the end of the
//   druid's turns (guardianSpiritHeal).
//
// Before this the spirit was a condition on the druid alone: no point was
// read, nobody else gained anything, and its Unicorn and Guardian Spirit were
// left to the GM. Off the board nothing is measured: the fiction decides, and
// the druid's allies are taken to stand in it.

import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef, type BattleMap } from "@/lib/db/battle-maps";
import { getActiveBoard } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { chebyshev, type XY } from "@/lib/battlemap/types";
import type { SpellZone } from "@/lib/battlemap/zones";
import { zoneKey } from "@/lib/battlemap/zones-spells";
import { liveZones, publishZones } from "@/lib/dm/zone-store";
import { moveZoneTo, placeSpellZone } from "@/lib/dm/zone-cast";
import { regainHitPoints } from "@/lib/dm/regain";
import { SUMMONED } from "@/lib/dm/summon-rules";
import { choiceIn, holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import { classLevelOf } from "@/lib/srd/trait-rules";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { textKey } from "@/lib/language/text-logic";

export const TOTEM_SPELL = "Spirit Totem";
export const TOTEM_FAMILY = "spirit totem";
export const TOTEM_SPIRITS = ["bear", "hawk", "unicorn"] as const;
export type TotemSpirit = (typeof TOTEM_SPIRITS)[number];

const AURA_FEET = 30;
const CALL_FEET = 60;
const MOVE_FEET = 60;
const TILE = 5;

// The spirit a sheet's totem holds, or null.
export function spiritOf(sheet: Pick<CharacterSheet, "conditions">): TotemSpirit | null {
  for (const entry of sheet.conditions) {
    const choice = textKey(choiceIn(entry, TOTEM_FAMILY) ?? "");
    const spirit = TOTEM_SPIRITS.find((name) => name === choice);
    if (spirit) {
      return spirit;
    }
  }
  return null;
}

function boardMap(campaignId: string): BattleMap | null {
  const board = getActiveBoard(campaignId);
  return board ? getBattleMapForEncounter(board.id) : null;
}

function totemZoneOf(campaignId: string, map: BattleMap, druidId: string): SpellZone | null {
  const board = getActiveBoard(campaignId);
  return liveZones(map, board).find((zone) => zone.casterId === druidId && zoneKey(zone) === zoneKey(TOTEM_SPELL)) ?? null;
}

// Where the spirit stands: its area's point, else (a spirit called before the
// board was laid) the druid's own square.
function totemPoint(campaignId: string, map: BattleMap, druid: CharacterSheet): XY | null {
  const zone = totemZoneOf(campaignId, map, druid.id);
  if (zone) {
    return zone.origin;
  }
  const token = getTokenByRef(map.id, druid.id);
  return token ? { x: token.x, y: token.y } : null;
}

function standsWithin(map: BattleMap, refId: string, point: XY, feet: number): boolean {
  const token = getTokenByRef(map.id, refId);
  return Boolean(token && chebyshev(token.x, token.y, point.x, point.y) * TILE <= feet);
}

// Whether a creature of either side stands in this druid's aura (the Hawk's
// reaction asks it of the creature attacked, spirit-totem-hawk.ts). With no
// board nothing is measured and it does.
export function inSpiritAura(campaignId: string, druid: CharacterSheet, refId: string): boolean {
  const map = boardMap(campaignId);
  if (!map) {
    return true;
  }
  const point = totemPoint(campaignId, map, druid);
  return Boolean(point && standsWithin(map, refId, point, AURA_FEET));
}

// The druid's side: the table's characters and their summons (every sheet),
// never a creature of the fight.
function isAllySheet(sheet: CharacterSheet | null | undefined): sheet is CharacterSheet {
  return Boolean(sheet && !sheet.deathSaves?.dead);
}

// Every Spirit Totem whose aura holds this character: the druid and the
// spirit. A druid whose totem is up counts too.
export function totemsOver(campaignId: string, refId: string): Array<{ druid: CharacterSheet; spirit: TotemSpirit }> {
  const subject = getSheetById(refId);
  if (!isAllySheet(subject) || subject.campaignId !== campaignId) {
    return [];
  }
  const map = boardMap(campaignId);
  const out: Array<{ druid: CharacterSheet; spirit: TotemSpirit }> = [];
  for (const stale of listSheets(campaignId)) {
    const druid = getSheetById(stale.id) ?? stale;
    const spirit = spiritOf(druid);
    if (!spirit || druid.deathSaves?.dead || druid.currentHp <= 0) {
      continue;
    }
    if (!map) {
      out.push({ druid, spirit });
      continue;
    }
    const point = totemPoint(campaignId, map, druid);
    if (point && standsWithin(map, refId, point, AURA_FEET)) {
      out.push({ druid, spirit });
    }
  }
  return out;
}

// What the aura gives this character's rolls (forced-save.ts rollExtrasFor,
// read by rolls.ts): the Bear's Strength checks and saves, the Hawk's
// Perception, the Unicorn's checks to find a creature.
export function spiritTotemRollAdvantage(campaignId: string, sheet: Pick<CharacterSheet, "id">): { saves: string[]; checks: string[]; skills: string[]; note: string } | null {
  const over = totemsOver(campaignId, sheet.id);
  if (!over.length) {
    return null;
  }
  const saves = new Set<string>();
  const checks = new Set<string>();
  const skills = new Set<string>();
  for (const { spirit } of over) {
    if (spirit === "bear") {
      saves.add("str");
      checks.add("str");
    } else if (spirit === "hawk") {
      skills.add("perception");
    } else {
      skills.add("perception");
      skills.add("investigation");
    }
  }
  return { saves: [...saves], checks: [...checks], skills: [...skills], note: `Spirit Totem (${over.map((entry) => entry.spirit).join(", ")}): advantage in the aura` };
}

// The characters standing in the aura around a point, the druid's side only.
function alliesAround(campaignId: string, map: BattleMap | null, point: XY | null): CharacterSheet[] {
  return listSheets(campaignId)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter(isAllySheet)
    .filter((sheet) => !map || !point || standsWithin(map, sheet.id, point, AURA_FEET));
}

export type TotemCall = { spirit: TotemSpirit; at?: XY; rounds: number };

// The spend: the spirit appears at the point named (the druid's square when
// none is), within 60 feet; the druid's earlier spirit goes. The Bear gives
// each creature in its aura 5 + the druid level temporary hit points as it
// appears. Refusals come first; the druid's condition is written here, so
// the area that lasts by it holds from the moment it is laid.
export function raiseSpiritTotem(campaign: Campaign, druid: CharacterSheet, call: TotemCall): ToolError | { result: Record<string, unknown> } {
  const map = boardMap(campaign.id);
  const druidToken = map ? getTokenByRef(map.id, druid.id) : null;
  const point = call.at ?? (druidToken ? { x: druidToken.x, y: druidToken.y } : null);
  if (map && call.at) {
    if (call.at.x < 0 || call.at.y < 0 || call.at.x >= map.width || call.at.y >= map.height) {
      return { error: `(${call.at.x},${call.at.y}) is off the ${map.width}x${map.height} map; name a square on it. Nothing was spent.`, retry: true };
    }
    if (druidToken && chebyshev(druidToken.x, druidToken.y, call.at.x, call.at.y) * TILE > CALL_FEET) {
      return { error: `The spirit is called to a point within ${CALL_FEET} feet of ${druid.name}, and (${call.at.x},${call.at.y}) is ${chebyshev(druidToken.x, druidToken.y, call.at.x, call.at.y) * TILE} feet away. Name a nearer square. Nothing was spent.`, retry: true };
    }
  }
  const condition = `${TOTEM_FAMILY}: ${call.spirit}`;
  const fresh = getSheetById(druid.id) ?? druid;
  const old = fresh.conditions.filter((entry) => isConditionNamed(entry, TOTEM_FAMILY) || choiceIn(entry, TOTEM_FAMILY) !== null);
  const kept = removeConditions(fresh.conditions, fresh.conditionMeta as ConditionMetaMap, old);
  const patch: FullPatchSheetInput = {
    conditions: [...kept.conditions, condition],
    conditionMeta: { ...(kept.meta as FullPatchSheetInput["conditionMeta"]), [condition]: { rounds: call.rounds } } as FullPatchSheetInput["conditionMeta"],
  };
  const updated = patchSheet(druid.id, patch);
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  const lines: string[] = [`${druid.name} calls the ${call.spirit} spirit${point ? ` to (${point.x},${point.y})` : ""} for a minute; its aura reaches 30 feet.`];
  if (map && point) {
    const laid = placeSpellZone(campaign, { spell: TOTEM_SPELL, caster: { kind: "pc", id: druid.id, name: druid.name }, at: point, named: true });
    if (laid) {
      lines.push(laid);
    }
  }
  if (call.spirit === "bear") {
    const amount = 5 + Math.max(1, classLevelOf(druid, "druid") || druid.level);
    const gained: string[] = [];
    for (const ally of alliesAround(campaign.id, map, point)) {
      const now = getSheetById(ally.id) ?? ally;
      if (amount > now.tempHp) {
        const done = patchSheet(now.id, { tempHp: amount });
        if (done) {
          publishPersisted(campaign.id, "sheet_updated", { sheet: done });
        }
      }
      gained.push(now.name);
    }
    if (gained.length) {
      lines.push(`${gained.join(", ")}: ${amount} temporary hit points from the bear spirit.`);
    }
  }
  return { result: { applied: lines } };
}

// "A 30-foot aura you can move 60 feet as a bonus action": the spirit moves
// to the square named, no farther than 60 feet from where it stands.
export function moveSpiritTotem(campaign: Campaign, druid: CharacterSheet, named: XY | undefined): ToolError | { result: Record<string, unknown> } {
  if (!druid.conditions.some((entry) => isConditionNamed(entry, TOTEM_FAMILY) || choiceIn(entry, TOTEM_FAMILY) !== null)) {
    return { error: `${druid.name} has no spirit called; use_resource "Spirit Totem" first. Nothing was spent.`, refused: "rules" };
  }
  const map = boardMap(campaign.id);
  if (!map) {
    return { result: { applied: [`${druid.name}'s spirit moves up to ${MOVE_FEET} feet, and its aura moves with it. There is no board to move it on.`] } };
  }
  const zone = totemZoneOf(campaign.id, map, druid.id);
  // No square named (a card played with no square to pick): the spirit comes
  // to the druid, the move a player means most often.
  const self = getTokenByRef(map.id, druid.id);
  const at = named ?? (self ? { x: self.x, y: self.y } : undefined);
  if (!at) {
    return { error: `Moving the spirit needs the square it goes to: pass x and y. Nothing was spent.`, retry: true };
  }
  if (at.x < 0 || at.y < 0 || at.x >= map.width || at.y >= map.height) {
    return { error: `(${at.x},${at.y}) is off the ${map.width}x${map.height} map; name a square on it. Nothing was spent.`, retry: true };
  }
  if (!zone) {
    const spirit = spiritOf(druid) ?? "guardian";
    const laid = placeSpellZone(campaign, { spell: TOTEM_SPELL, caster: { kind: "pc", id: druid.id, name: druid.name }, at, named: true });
    return { result: { applied: [`The ${spirit} spirit stands at (${at.x},${at.y}).`, ...(laid ? [laid] : [])] } };
  }
  const feet = chebyshev(zone.origin.x, zone.origin.y, at.x, at.y) * TILE;
  if (feet > MOVE_FEET) {
    return { error: `The spirit moves up to ${MOVE_FEET} feet, and (${at.x},${at.y}) is ${feet} feet from where it stands at (${zone.origin.x},${zone.origin.y}). Nothing was spent.`, retry: true };
  }
  moveZoneTo(map, zone.id, at);
  publishZones(campaign.id);
  return { result: { applied: [`${druid.name}'s spirit moves ${feet} feet to (${at.x},${at.y}); its 30-foot aura goes with it.`] } };
}

// The druid's own summons (a "summoned" creature whose source is the druid).
function summonsOfDruid(campaignId: string, druidId: string): CharacterSheet[] {
  return listSheets(campaignId)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((sheet) => {
      const meta = (sheet.conditionMeta ?? {}) as Record<string, { source?: string } | undefined>;
      return !sheet.deathSaves?.dead && sheet.currentHp > 0 && sheet.conditions.some((entry) => isConditionNamed(entry, SUMMONED)) && meta[SUMMONED]?.source === druidId;
    });
}

// Guardian Spirit: "Summoned creatures inside your Spirit Totem aura heal half
// your druid level at the end of your turns." Called when the druid's turn
// ends (src/lib/dm/turn-heal hooks). Lines for the turn's result.
export function guardianSpiritHeal(campaign: Campaign, turnId: string | null, druid: CharacterSheet): string[] {
  if (!spiritOf(druid) || !holdsFeature(druid, "Guardian Spirit")) {
    return [];
  }
  const amount = Math.floor(Math.max(1, classLevelOf(druid, "druid") || druid.level) / 2);
  if (amount <= 0) {
    return [];
  }
  const map = boardMap(campaign.id);
  const point = map ? totemPoint(campaign.id, map, druid) : null;
  const lines: string[] = [];
  for (const summon of summonsOfDruid(campaign.id, druid.id)) {
    if (map && point && !standsWithin(map, summon.id, point, AURA_FEET)) {
      continue;
    }
    const gained = regainHitPoints(campaign, turnId, summon, amount, `Guardian Spirit (${druid.name})`);
    if (gained > 0) {
      lines.push(`${summon.name} regains ${gained} hit points in ${druid.name}'s spirit aura (Guardian Spirit).`);
    }
  }
  return lines;
}

// The Unicorn: "when you cast a spell with a slot that restores hit points,
// each creature of your choice in the aura regains hit points equal to your
// druid level". Every ally in the aura who is hurt is the default choice.
export function unicornHealing(campaign: Campaign, turnId: string | null, druid: CharacterSheet): string[] {
  if (spiritOf(druid) !== "unicorn") {
    return [];
  }
  const amount = Math.max(1, classLevelOf(druid, "druid") || druid.level);
  const map = boardMap(campaign.id);
  const point = map ? totemPoint(campaign.id, map, druid) : null;
  const lines: string[] = [];
  for (const ally of alliesAround(campaign.id, map, point)) {
    const now = getSheetById(ally.id) ?? ally;
    if (now.currentHp >= now.maxHp) {
      continue;
    }
    const gained = regainHitPoints(campaign, turnId, now, amount, `Spirit Totem: Unicorn (${druid.name})`);
    if (gained > 0) {
      lines.push(`${now.name} regains ${gained} hit points from the unicorn spirit.`);
    }
  }
  return lines;
}
