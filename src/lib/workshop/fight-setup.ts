import type { Campaign } from "@/lib/db/campaigns";
import { getCampaignById } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef, listTokens, placeToken, removeTokenByRef, setTokenHidden, type BattleMap } from "@/lib/db/battle-maps";
import {
  getActiveEncounter,
  listEnemies,
  patchEnemyConditions,
  patchEnemyHp,
  setEnemyInitiative,
  setEnemyLook,
  type Encounter,
} from "@/lib/db/encounters";
import {
  getEncounterTemplate,
  listEncounterTemplates,
  setTemplateSetup,
  updateEncounterTemplate,
  type EncounterTemplate,
} from "@/lib/db/encounter-templates";
import { listSheets, patchSheet } from "@/lib/db/sheets";
import { testFightRun } from "@/lib/db/test-fights";
import { getDiceScript } from "@/lib/db/dice-scripts";
import { nearestOpenTile } from "@/lib/battlemap/paint";
import { occupiedTiles } from "@/lib/battlemap/view";
import { tileIndex } from "@/lib/battlemap/types";
import { publishPersisted } from "@/lib/events";
import { expandRoster, matchSlots } from "@/lib/dm/encounter-template-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { captureBoardIntoLibrary } from "@/lib/dm/map-library";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import {
  foeSlot,
  refToken,
  samePartyAsSetup,
  slotKinds,
  swapMetaIds,
  type FightSetup,
  type SetupFoe,
  type SetupHero,
  type SetupParty,
} from "@/lib/workshop/fight-setup-logic";

// Saving a test fight's moment as its prepared fight's set-up, and laying a
// set-up on a fight just deployed (issue 685). The shape and its words are
// src/lib/workshop/fight-setup-logic.ts.

type Outcome<T> = ({ ok: true } & T) | { ok: false; error: string };

// The roster slot each of the fight's enemies holds, and the seat each of
// the table's sheets holds (the order they were seated in).
function slotsOf(template: EncounterTemplate, encounter: Encounter) {
  return matchSlots(expandRoster(template.enemies), listEnemies(encounter.id));
}

function orderInitiative(encounter: Encounter, id: string): number | null {
  const entry = encounter.order.find(
    (item) => (item.kind === "pc" ? item.characterId === id && !item.reflex : item.kind === "enemy" && item.enemyId === id),
  );
  return entry ? entry.initiative : null;
}

function tileOf(map: BattleMap | null, refId: string) {
  const token = map ? getTokenByRef(map.id, refId) : null;
  return { token, at: token ? { x: token.x, y: token.y } : null };
}

// ---- saving ----

// The moment on a test table, in the set-up's terms. Refused before the
// fight's order is in (there is no moment to keep yet) and once the fight
// is over (the moment is gone).
export function captureFightSetup(test: Campaign, party: SetupParty): Outcome<{ setup: FightSetup }> {
  const encounter = getActiveEncounter(test.id);
  if (!encounter || encounter.kind === "scene") {
    return { ok: false, error: "No fight is running at this table to save." };
  }
  if (!encounter.orderReady) {
    return { ok: false, error: "Wait until every initiative is in, then save the moment." };
  }
  // The test table holds one prepared fight: the copy it plays.
  const copy = listEncounterTemplates(test.id)[0];
  if (!copy) {
    return { ok: false, error: "This table has no prepared fight to save the moment for." };
  }
  const map = getBattleMapForEncounter(encounter.id);
  const slots = slotsOf(copy, encounter);
  const kinds = new Map(slotKinds(expandRoster(copy.enemies)).map((entry) => [entry.slot, entry]));
  const sheets = listSheets(test.id);
  const ids = new Map<string, string>();
  for (const [slot, enemy] of slots) ids.set(enemy.id, refToken({ kind: "slot", slot }));
  sheets.forEach((sheet, seat) => ids.set(sheet.id, refToken({ kind: "seat", seat })));

  const foes: SetupFoe[] = [...slots].map(([slot, enemy]) => {
    const { token, at } = tileOf(map, enemy.id);
    const kind = kinds.get(slot);
    return {
      slot,
      ...(kind ? { monster: kind.monster.slice(0, 80), nth: kind.nth } : {}),
      name: enemy.displayName.slice(0, 60),
      ...(enemy.gender ? { gender: enemy.gender } : {}),
      ...(enemy.race ? { race: enemy.race.slice(0, 40) } : {}),
      hp: Math.max(0, enemy.currentHp),
      maxHp: Math.max(1, enemy.maxHp),
      status: enemy.status,
      conditions: enemy.conditions.slice(0, 15),
      conditionMeta: swapMetaIds(enemy.conditionMeta, ids),
      hidden: Boolean(token?.hidden),
      at,
      initiative: orderInitiative(encounter, enemy.id) ?? enemy.initiative,
    };
  });
  const heroes: SetupHero[] = sheets.slice(0, 16).map((sheet, seat) => heroState(sheet, seat, encounter, map, ids));
  return {
    ok: true,
    setup: {
      version: 1,
      savedAt: new Date().toISOString(),
      party,
      foes,
      heroes,
      settings: { companions: test.gameSettings.companions },
      // What the test table's dice script still holds: a face already spent
      // belongs to the moment that spent it.
      dice: diceOf(test.id),
    },
  };
}

function diceOf(campaignId: string): FightSetup["dice"] {
  const script = getDiceScript(campaignId);
  return script && (script.seed !== null || script.queue.length) ? { seed: script.seed, queue: script.queue } : null;
}

function heroState(sheet: CharacterSheet, seat: number, encounter: Encounter, map: BattleMap | null, ids: ReadonlyMap<string, string>): SetupHero {
  const slotsUsed: Record<string, number> = {};
  for (const [level, slot] of Object.entries(sheet.spellcasting?.slots ?? {})) {
    if (slot.used > 0) slotsUsed[level] = slot.used;
  }
  const resourcesUsed: Record<string, number> = {};
  for (const [id, resource] of Object.entries(sheet.resources ?? {})) {
    if (resource.used > 0) resourcesUsed[id] = resource.used;
  }
  return {
    seat,
    name: sheet.name.slice(0, 60),
    at: tileOf(map, sheet.id).at,
    initiative: orderInitiative(encounter, sheet.id),
    currentHp: Math.max(0, sheet.currentHp),
    tempHp: Math.max(0, sheet.tempHp),
    conditions: sheet.conditions.slice(0, 15),
    conditionMeta: swapMetaIds(sheet.conditionMeta ?? {}, ids),
    deathSaves: sheet.deathSaves ?? null,
    exhaustion: sheet.exhaustion ?? 0,
    concentratingOn: sheet.concentratingOn ?? null,
    slotsUsed,
    pactUsed: sheet.spellcasting?.pact ? sheet.spellcasting.pact.used : null,
    resourcesUsed,
    hitDiceSpent: sheet.hitDice?.spent ?? 0,
  };
}

// "Save as this fight's set-up" on a test table: the moment goes onto the
// workshop's own prepared fight. A fight played on the generator's map
// keeps that map too ("Keep this map", the report's gap 5): the board goes
// into the workshop's map library and the fight is drawn on it from now on,
// so the positions saved with the set-up mean the same ground next time.
export function saveTestAsSetup(test: Campaign, userId: string): Outcome<{ setup: FightSetup; templateId: string; workshopId: string; keptMap: boolean }> {
  if (test.kind !== "playtest" || test.ownerUserId !== userId) {
    return { ok: false, error: "Only a test fight's author can save its moment." };
  }
  const run = testFightRun(test.id);
  const source = run ? getEncounterTemplate(run.templateId) : null;
  const workshop = source ? getCampaignById(source.campaignId) : null;
  if (!run || !source || !workshop || workshop.kind !== "workshop") {
    return { ok: false, error: "The prepared fight this test was made from is gone from the workshop." };
  }
  const captured = captureFightSetup(test, run.party);
  if (!captured.ok) {
    return captured;
  }
  let keptMap = false;
  if (!source.map.mapId) {
    const kept = captureBoardIntoLibrary(test, `${source.name} (tested)`.slice(0, 80), workshop.id);
    if ("error" in kept) {
      return { ok: false, error: kept.error };
    }
    updateEncounterTemplate(source.id, {
      name: source.name,
      enemies: source.enemies,
      battlefield: source.battlefield,
      map: { ...source.map, mapId: kept.map.id },
      notes: source.notes,
      extras: source.extras,
    });
    keptMap = true;
  }
  setTemplateSetup(source.id, captured.setup);
  return { ok: true, setup: captured.setup, templateId: source.id, workshopId: workshop.id, keptMap };
}

// ---- laying ----

export type LayOptions = {
  // A test table: the party and the enemies' initiative are laid too, the
  // party only when it is the one the set-up was saved with.
  test?: { party: SetupParty };
};

// `order`: each seated hero's initiative from the set-up, for the test
// table's order to be collected again from (src/lib/workshop/fight-setup-order.ts).
export type LayOutcome = { laid: boolean; heroes: "laid" | "fresh" | "none"; notes: string[]; order: Map<string, number> };

// Lays a set-up on the fight its prepared fight just deployed. Best effort,
// like the rest of a plan (src/lib/dm/template-apply.ts): a slot the roster
// no longer has, a seat with nobody in it or a tile that is now rock is
// skipped, never a reason to undo a fight that has begun. A foe lands by its
// kind and number in the roster, so "a slot the roster no longer has" is a
// creature it no longer has.
export function layFightSetup(campaign: Campaign, template: EncounterTemplate, setup: FightSetup, options: LayOptions = {}): LayOutcome {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || encounter.kind === "scene") {
    return { laid: false, heroes: "none", notes: [], order: new Map() };
  }
  const map = getBattleMapForEncounter(encounter.id);
  const roster = expandRoster(template.enemies);
  const slots = matchSlots(roster, listEnemies(encounter.id));
  // Each saved foe's creature at this fight: the one of its kind and number
  // in today's roster (fight-setup-logic.ts foeSlot), never whatever holds
  // its old slot number since the roster was edited. Its ref token, kept in
  // other creatures' condition meta, names it by its saved slot.
  const placed = setup.foes.flatMap((foe) => {
    const slot = foeSlot(foe, roster);
    const enemy = slot === null ? undefined : slots.get(slot);
    return enemy ? [{ foe, enemy }] : [];
  });
  const sheets = listSheets(campaign.id);
  const sameParty = options.test ? samePartyAsSetup(setup, options.test.party) : false;
  const ids = new Map<string, string>();
  for (const { foe, enemy } of placed) ids.set(refToken({ kind: "slot", slot: foe.slot }), enemy.id);
  if (sameParty) {
    sheets.forEach((sheet, seat) => ids.set(refToken({ kind: "seat", seat }), sheet.id));
  }

  // Where each creature the set-up names stands, laid once everyone moving
  // has been lifted off the board: one at a time, a saved tile was still held
  // by a creature not yet moved, which the deploy stood anywhere, and the
  // first came down beside it.
  const moves: Array<{ refId: string; at: { x: number; y: number } }> = [];
  const standAt = (refId: string, at: { x: number; y: number } | null) => {
    if (at) moves.push({ refId, at });
  };

  for (const { foe, enemy } of placed) {
    if (foe.gender !== undefined || foe.race !== undefined) setEnemyLook(enemy.id, { gender: foe.gender, race: foe.race });
    if (foe.status !== "alive") {
      // Down or gone when the moment was saved: out of the fight from its
      // start, its token with it.
      patchEnemyHp(enemy.id, 0, foe.status);
      if (map) removeTokenByRef(map.id, enemy.id);
      continue;
    }
    patchEnemyHp(enemy.id, Math.min(enemy.maxHp, Math.max(1, foe.hp)), "alive");
    patchEnemyConditions(enemy.id, foe.conditions, swapMetaIds(foe.conditionMeta, ids));
    standAt(enemy.id, foe.at);
    const token = map ? getTokenByRef(map.id, enemy.id) : null;
    if (token && token.hidden !== foe.hidden) setTokenHidden(token.id, foe.hidden);
    if (options.test && foe.initiative !== null) setEnemyInitiative(enemy.id, foe.initiative);
  }

  let heroes: LayOutcome["heroes"] = "none";
  const notes: string[] = [];
  if (options.test) {
    heroes = sameParty ? "laid" : "fresh";
    for (const hero of setup.heroes) {
      const sheet = sheets[hero.seat];
      if (!sheet) continue;
      standAt(sheet.id, hero.at);
      if (sameParty) {
        const updated = patchSheet(sheet.id, heroPatch(sheet, hero, ids));
        if (updated) publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
    }
    if (!sameParty && setup.heroes.length) {
      notes.push("This test seats another party than the set-up was saved with, so the heroes start fresh where the set-up stood them.");
    }
  }
  if (map && moves.length) {
    const tokens = listTokens(map.id);
    const moving = new Set(moves.map((move) => move.refId));
    const taken = occupiedTiles(map, tokens.filter((token) => !moving.has(token.refId)), null);
    for (const move of moves) {
      const token = getTokenByRef(map.id, move.refId);
      if (!token) continue;
      const from = { x: Math.min(map.width - 1, move.at.x), y: Math.min(map.height - 1, move.at.y) };
      const spot = nearestOpenTile(map.terrain, map.width, map.height, from, taken);
      taken.add(tileIndex(map.width, spot.x, spot.y));
      placeToken(token.id, spot.x, spot.y);
    }
  }
  if (map) publishBattleMapUpdate(campaign.id);
  publishEncounter(campaign.id);
  const order = new Map(
    sameParty
      ? setup.heroes.flatMap((hero) => (sheets[hero.seat] && hero.initiative !== null ? [[sheets[hero.seat].id, hero.initiative] as const] : []))
      : [],
  );
  return { laid: true, heroes, notes, order };
}

// What a seat's hero takes from the set-up: what was spent and what was
// suffered, never the pools themselves (the sheet's own).
function heroPatch(sheet: CharacterSheet, hero: SetupHero, ids: ReadonlyMap<string, string>): FullPatchSheetInput {
  const patch: FullPatchSheetInput = {
    currentHp: Math.min(sheet.maxHp, hero.currentHp),
    tempHp: hero.tempHp,
    conditions: hero.conditions,
    conditionMeta: swapMetaIds(hero.conditionMeta, ids),
    deathSaves: hero.deathSaves,
    exhaustion: hero.exhaustion,
    concentratingOn: hero.concentratingOn,
  };
  if (sheet.spellcasting) {
    const slots = Object.fromEntries(
      Object.entries(sheet.spellcasting.slots).map(([level, slot]) => [level, { ...slot, used: Math.min(slot.max, hero.slotsUsed[level] ?? 0) }]),
    );
    const pact = sheet.spellcasting.pact ? { ...sheet.spellcasting.pact, used: Math.min(sheet.spellcasting.pact.max, hero.pactUsed ?? 0) } : undefined;
    patch.spellcasting = { ...sheet.spellcasting, slots, ...(pact ? { pact } : {}) };
  }
  if (sheet.resources && Object.keys(sheet.resources).length) {
    patch.resources = Object.fromEntries(
      Object.entries(sheet.resources).map(([id, resource]) => [id, { ...resource, used: Math.min(resource.max, hero.resourcesUsed[id] ?? 0) }]),
    );
  }
  if (sheet.hitDice) {
    patch.hitDice = { ...sheet.hitDice, spent: Math.min(sheet.hitDice.total, hero.hitDiceSpent) };
  }
  return patch;
}
