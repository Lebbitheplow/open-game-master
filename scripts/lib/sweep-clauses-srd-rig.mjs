// What the scripts/test-enforce-sweep-clauses-srd-*.mjs probe suites stage
// with: one table per probe (its own campaign, so a fight holds only the
// heroes the clause is about), a hero built by the real sheet door, a fight
// laid out by hand, and the few calls a clause is read off.
//
// Import enforce-world.mjs first in the suite, then:
//
//   const rig = await clauseRig();
//   const t = await rig.table();
//   const who = t.hero({ class: "barbarian", level: 5 });
//   const [foe] = await t.fight([who]);          // who has the floor, foe beside them
//   const save = await t.roll(who.id, { kind: "saving_throw", ability: "str", dc: 10 }, [3, 17]);
//   save.faces.length                            // 2: rolled with advantage
import assert from "node:assert/strict";
import { openWorld } from "./enforce-world.mjs";
import { combatKit, d20Faces, TRAINED, DUMMY } from "./enforce-combat.mjs";

export const SCORES = { str: 16, dex: 14, con: 14, int: 12, wis: 12, cha: 12 };
const CASTING = { bard: "cha", cleric: "wis", druid: "wis", paladin: "cha", ranger: "wis", sorcerer: "cha", warlock: "cha", wizard: "int", artificer: "int" };

export const slots = (...max) => Object.fromEntries(max.map((count, at) => [String(at + 1), { max: count, used: 0 }]));
export const feature = (name, source = "class", extra = {}) => ({ name, source, ...extra });

export async function clauseRig() {
  const srd = await import("../../src/lib/srd/index.ts");
  const rolls = await import("../../src/lib/db/rolls.ts");
  const encounters = await import("../../src/lib/db/encounters.ts");

  async function table(options = {}) {
    const world = await openWorld({ campaign: { maxPlayers: 12 }, ...options });
    const kit = await combatKit(world);

    // A hero through the sheet door. A caster gets its casting ability and
    // three slots of each level a test names in `slots`.
    function hero(build = {}) {
      const classId = build.class ?? "fighter";
      const casting = build.spellcasting === undefined && CASTING[classId] && build.spells
        ? { ability: CASTING[classId], slots: slots(...(build.slotMax ?? [4, 3, 3, 3, 2])), prepared: build.spells, known: build.spells, cantrips: build.cantrips ?? [] }
        : build.spellcasting;
      const rest = Object.fromEntries(Object.entries(build).filter(([key]) => !["spells", "cantrips", "slotMax"].includes(key)));
      return world.addHero({
        maxHp: 80,
        proficiencies: TRAINED,
        portrait: { url: "/uploads/test.png" },
        ...rest,
        abilities: { ...SCORES, ...(build.abilities ?? {}) },
        ...(casting ? { spellcasting: casting } : {}),
      });
    }

    const sheet = (who) => world.sheet(who.id ?? who);
    const derived = (who) => srd.computeSheetDerived(sheet(who));
    // The walking speed and the armor class the engine works out, whatever
    // number the sheet was posted with.
    const speed = (who) => srd.speedFor(sheet(who));
    const ac = (who) => srd.deriveAc({ ...sheet(who), acOverride: false });
    const has = (who, condition) => sheet(who).conditions.includes(condition);
    const used = (who, id) => sheet(who).resources?.[id]?.used ?? 0;
    const max = (who, id) => sheet(who).resources?.[id]?.max ?? null;

    // A request_roll with its dice forced, and the roll the engine stored.
    async function roll(who, args, faces = []) {
      world.clearDice();
      world.diceLog();
      world.dice(...faces);
      const before = new Set(rolls.listRecentRolls(world.campaignId, 30).map((entry) => entry.id));
      const out = await world.invoke("request_roll", { characterId: who.id ?? who, reason: "test", ...args });
      const unused = world.clearDice();
      const stored = rolls.listRecentRolls(world.campaignId, 30).find((entry) => !before.has(entry.id) && entry.kind !== "damage") ?? null;
      return { out, ok: out.ok, error: out.error, stored, faces: d20Faces(stored), total: stored?.total ?? null, unused };
    }

    // A fight: the first hero has the floor at (5,5), the first foe stands
    // beside them at (6,5), the second 60 feet off at (17,5), the other
    // heroes in a column at (4,5), (4,6)... Foes are the dummy (AC 13, +4
    // club for 1d6+2) with hit points to spare.
    async function fight(heroes, { foes = 1, hp = 300, foe = {} } = {}) {
      await kit.endFight();
      const faces = Object.fromEntries(world.sheets().map((entry) => [entry.id, entry.id === heroes[0].id ? 20 : 4]));
      await kit.fight(foes, { heroFaces: faces });
      const list = world.enemies();
      list.forEach((enemy, at) => {
        kit.setEnemy(enemy.id, { maxHp: hp, currentHp: hp, stats: { ...DUMMY, ...foe } });
        kit.place(enemy.id, at === 0 ? 6 : Math.min(kit.map().width - 1, 17), 5 + (at > 1 ? at : 0));
      });
      heroes.forEach((who, at) => kit.place(who.id, at === 0 ? 5 : 4, 5 + Math.max(0, at - 1)));
      kit.giveTurn(heroes[0].id);
      world.clearDice();
      world.diceLog();
      return list.map((enemy) => kit.enemy(enemy.id));
    }

    // The foe's turn: the pointer on it, every reaction fresh.
    function foesTurn(enemy) {
      const encounter = world.encounter();
      const place = encounter.order.findIndex((entry) => entry.enemyId === enemy.id);
      encounters.saveEncounter({ ...encounter, turnIndex: place, turnBudget: null, reactionsUsed: [] });
    }

    // The dummy's club at a hero: 16 on the die is a 20 to hit, 4 + 2 damage.
    async function strike(enemy, who, faces = [16, 4], args = {}) {
      kit.freshRound();
      world.clearDice();
      world.dice(...faces);
      const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: who.id, ...args });
      world.clearDice();
      return out;
    }

    const invoke = async (name, args, faces = []) => {
      world.clearDice();
      world.diceLog();
      world.dice(...faces);
      const out = await world.invoke(name, args);
      const unused = world.clearDice();
      return { ...out, unused, rolled: world.diceLog() };
    };
    const use = (who, resource, args = {}, faces = []) => invoke("use_resource", { characterId: who.id, resource, ...args }, faces);
    const act = (who, action, args = {}, faces = []) => invoke("take_action", { characterId: who.id, action, ...args }, faces);
    const condition = (who, name, args = {}) => invoke("set_condition", { characterId: who.id, condition: name, ...args });
    const damage = (who, amount, type, args = {}) => invoke("apply_damage", { characterId: who.id, amount, ...(type ? { type } : {}), ...args });
    const rest = (kind) => invoke("take_rest", { kind });
    const budget = () => world.encounter()?.turnBudget ?? null;
    // The player's own End Turn: the enemies' turns pass unplayed and the
    // floor comes round to the next hero. The enemies are handed their turns
    // at once, so the next hero's turn has begun when this returns: what
    // waits on that turn's start or end is already marked (held-turn.ts).
    const endTurn = (who) => {
      const ended = kit.endTurn(sheet(who).userId);
      kit.handOnEnemies();
      return ended;
    };
    // A new turn for whoever holds the floor, as when the round comes back.
    const freshTurn = () => kit.freshTurn();
    const foeHas = (enemy, name) => kit.enemy(enemy.id).conditions.map((entry) => entry.toLowerCase()).includes(name);
    const lastRolls = (count = 4) => kit.lastRolls(count);

    return {
      world, kit, hero, sheet, derived, speed, ac, has, used, max, roll, fight, foesTurn, strike, invoke, use, act, condition, damage, rest, budget, lastRolls, endTurn, freshTurn, foeHas,
      swing: (who, enemy, faces = [], args = {}) => kit.swing(who.id, enemy.id, faces, args),
      patch: (who, patch) => world.patch(who.id, patch),
      enemy: (enemy) => kit.enemy(enemy.id),
    };
  }

  return { table, srd };
}

export { assert, d20Faces, TRAINED, DUMMY };
