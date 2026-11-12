// What the scripts/test-enforce-sweep-limits-*.mjs suites share on top of
// enforce-world.mjs and enforce-combat.mjs: a table with one holder of any
// subclass feature, the hit it answers staged the way a fight stages it, and
// the same attack rolled on the server's dice and on dice entered at the table.
//
// Import enforce-world.mjs first, then:
//
//   const table = await limitsTable(world);
//   const who = table.hero({ class: "cleric", subclass: "Light Domain" });
//   const [enemy] = await table.stage([who, ally]);
//   await table.strike(enemy, ally);
//   table.offered(who, "Warding Flare");
import assert from "node:assert/strict";
import fs from "node:fs";
import { combatKit, TRAINED } from "./enforce-combat.mjs";
import { call } from "./enforce-campaign.mjs";

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../../src/lib/srd/${name}`, import.meta.url), "utf8"));

// Every authored subclass feature's own words: "Subclass/Feature" to
// { classId, subclass, level, text }. The text is the rule a finding quotes.
export function authoredText() {
  const out = new Map();
  for (const [classId, list] of Object.entries(read("subclasses.json").classes)) {
    for (const subclass of list) {
      for (const [level, features] of Object.entries(subclass.levels)) {
        for (const feature of features) {
          out.set(`${classId}::${feature.n}`, { classId, subclass: subclass.name, level: Number(level), text: feature.d });
        }
      }
    }
  }
  return out;
}

// Every class with every subclass it has: the SRD's and the authored ones.
export function everySubclass() {
  const srd = read("class-features.json").classes;
  const authored = read("subclasses.json").classes;
  const out = [];
  for (const classId of Object.keys(srd)) {
    for (const subclass of [...srd[classId].subclasses, ...(authored[classId] ?? [])]) {
      out.push({ classId, subclass: subclass.name });
    }
  }
  return out;
}

export const ABILITIES = { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 };

export async function limitsTable(world) {
  const kit = await combatKit(world);
  const { deriveHand, FRESH_TURN } = await import("../../src/lib/battlemap/hand.ts");
  const { reactionCards } = await import("../../src/lib/battlemap/hand-react.ts");
  const { activePublicEncounter } = await import("../../src/lib/db/encounter-view.ts");
  const { buildPlayerMapView } = await import("../../src/lib/battlemap/view.ts");
  const campaigns = await import("../../src/lib/db/campaigns.ts");
  const pending = await import("../../src/lib/db/dm-turns.ts");
  const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");

  // A level 20 hero of a seat of their own (so the board's view is theirs),
  // sturdy enough to take a club and keep standing.
  const hero = (extra = {}) =>
    world.addHero({
      level: 20, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED, abilities: ABILITIES,
      portrait: { url: "/uploads/test.png" }, equipment: [{ name: "Longsword", qty: 1, equipped: true }],
      ...extra,
    });

  // A fresh fight for these heroes against `count` dummies (AC 13, +4 club
  // for 1d6+2), the enemies due and everybody at 50 hit points with every
  // counter whole. The first hero stands at (5, 2); a test places the rest.
  async function stage(heroes, { count = 1, first = null, hp = 50 } = {}) {
    await kit.endFight();
    const faces = Object.fromEntries(world.sheets().map((sheet) => [sheet.id, sheet.id === first?.id ? 19 : 3]));
    await kit.fight(count, { heroFaces: faces });
    const foes = world.enemies();
    foes.forEach((enemy, at) => {
      kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
      kit.place(enemy.id, 8 + at * 2, 2);
    });
    // Everybody this fight is not about stands in the far corner, on one
    // tile: scattered, thirty bystanders fill the board, and one of them is
    // always beside somebody (a shot at disadvantage, a reach never empty).
    const board = kit.map();
    const cast = new Set(heroes.map((who) => who.id));
    for (const sheet of world.sheets()) {
      if (!cast.has(sheet.id) && kit.token(sheet.id)) {
        kit.place(sheet.id, board.width - 1, board.height - 1);
      }
    }
    if (process.env.SWEEP_LIMITS_DEBUG) console.log(`board ${board.width}x${board.height}`);
    heroes.forEach((who, at) => {
      kit.place(who.id, 5, 2 + at);
      const sheet = world.sheet(who.id);
      world.patch(who.id, {
        currentHp: hp, tempHp: 0, conditions: [], conditionMeta: {}, deathSaves: null, exhaustion: 0, concentratingOn: null,
        resources: Object.fromEntries(Object.entries(sheet.resources ?? {}).map(([id, state]) => [id, { ...state, used: 0 }])),
      });
    });
    if (first) {
      kit.giveTurn(first.id);
    }
    kit.freshRound();
    return foes.map((enemy) => kit.enemy(enemy.id));
  }

  // The dummy's club: a 16 on the die is a 20, through AC 12, for 4 + 2.
  async function strike(enemy, target, faces = [16, 4]) {
    kit.freshRound();
    world.clearDice();
    world.dice(...faces);
    const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
    world.clearDice();
    assert.equal(out.ok, true, `the staged hit was refused: ${out.error}`);
    return out;
  }

  const hits = () => activePublicEncounter(world.campaignId)?.lastHits ?? [];
  const view = (who) => buildPlayerMapView(world.campaignId, world.sheet(who.id).userId);
  // The reaction cards the Hand deals this hero now, with the board's own
  // distances and sight, as the table's screen passes them.
  function offered(who, name, { board = true } = {}) {
    const seen = board ? view(who) : null;
    const encounter = activePublicEncounter(world.campaignId);
    return reactionCards(
      world.sheet(who.id),
      { ...FRESH_TURN, myTurn: false },
      encounter?.lastHits ?? [],
      world.sheets(),
      "you",
      seen?.feet,
      encounter?.lastSaves ?? [],
      // Everybody the aim bar offers, friend or foe (a redirect's picker).
      [...world.enemies().filter((enemy) => enemy.status === "alive").map((enemy) => ({ id: enemy.id })), ...world.sheets().map((sheet) => ({ id: sheet.id }))],
    ).filter((card) => !name || card.name === name || card.intent?.feature === name);
  }

  const used = (who, id) => world.sheet(who.id).resources?.[id]?.used ?? 0;
  const reacted = (who) => world.encounter()?.reactionsUsed.includes(who.id) ?? false;

  // What a refused call must leave alone: the holder's counters, slots,
  // reaction and turn, and every hit point on the table.
  function ledger(who) {
    const sheet = world.sheet(who.id);
    const encounter = world.encounter();
    return JSON.stringify({
      resources: sheet.resources,
      slots: sheet.spellcasting?.slots ?? null,
      reaction: encounter?.reactionsUsed.includes(who.id) ?? false,
      budget: encounter?.turnBudget ?? null,
      hp: world.sheets().map((entry) => [entry.id, entry.currentHp, entry.tempHp]),
      foes: world.enemies().map((enemy) => [enemy.id, enemy.currentHp, [...enemy.conditions].sort()]),
    });
  }

  // ---- dice entered at the table ----

  async function withRealDice(who, run) {
    campaigns.setMemberRealDice(world.campaignId, world.sheet(who.id).userId, true);
    try {
      return await run();
    } finally {
      campaigns.setMemberRealDice(world.campaignId, world.sheet(who.id).userId, false);
    }
  }
  const openRolls = (who, kind) =>
    pending.listOpenPendingRolls(world.campaignId).filter((entry) => (!kind || entry.kind === kind) && (!who || entry.userId === world.sheet(who.id).userId));
  // Enters faces (or a body such as { fallback: "digital" }) for a parked roll.
  // The board indoors and dark everywhere but where `lamps` shine (the
  // lights_json the fog of war and attack-light.ts read: a tile and two radii
  // in squares), with every carried light out and no spell areas: a board
  // split into lit and dark parts. No lamps is a board dark all over.
  const { getDatabase } = await import("../../src/lib/db/core.ts");
  const maps = await import("../../src/lib/db/battle-maps.ts");
  const { clearLitTilesCache } = await import("../../src/lib/battlemap/lit-cache.ts");
  function lightBoard(lamps = []) {
    const board = kit.map();
    maps.setBattleMapOutdoors(board.id, false);
    const lights = lamps.map(({ x, y, bright = 1, dim = bright }) => ({ x, y, brightRadius: bright, dimRadius: dim }));
    getDatabase().prepare(`UPDATE battle_maps SET ambient = 'dark', lights_json = ?, zones_json = '[]' WHERE id = ?`).run(JSON.stringify(lights), board.id);
    for (const token of maps.listTokens(board.id)) maps.setTokenLight(token.id, 0);
    clearLitTilesCache();
  }

  async function enter(who, roll, body) {
    world.signIn({ id: world.sheet(who.id).userId });
    const out = await call(submitRoute, "POST", Array.isArray(body) ? { dice: body } : body, { campaignId: world.campaignId, pendingRollId: roll.id });
    return { status: out.status, json: out.json, roll: pending.getPendingRoll(roll.id), note: pending.getPendingRoll(roll.id)?.combatNote ?? "" };
  }

  return {
    kit, hero, stage, strike, hits, view, offered, used, reacted, ledger,
    withRealDice, openRolls, enter, deriveHand, FRESH_TURN, reactionCards, lightBoard,
    publicEncounter: () => activePublicEncounter(world.campaignId),
  };
}
