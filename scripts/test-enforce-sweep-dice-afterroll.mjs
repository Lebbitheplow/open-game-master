// Gap sweep, package `dice`, part 3: the choice after the roll.
//
// Lucky (src/lib/srd/authored-feats.json): "You have three luck points,
// regained on a long rest. Spend one to roll an extra d20 on your own attack
// roll, ability check or saving throw and choose which die to use".
//
// The engine offers that choice on the after-the-roll card
// (src/lib/dm/after-roll.ts): a roll that falls short waits on its player.
// Which rolls wait is decided site by site. This suite walks the sites: every
// tool that throws a d20 of a character's own (the rows of
// test-enforce-sweep-dice-sites.mjs that throw), with the character holding a
// luck point, on the server's dice, the d20 forced to a 2 so the roll falls
// short. A row ends OFFERED (a card with the Lucky choice waits on the
// player), SILENT (the d20 was thrown, the roll stood, and nobody was asked)
// or QUIET (no d20 of theirs). Every row must be OFFERED; the SILENT ones are
// in KNOWN, or in RULING where the code says why that roll never waits.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { d20sOf, forceDice, formArgs, installDiceSpy, taggedFor } from "./lib/sweep-dice.mjs";

const { test, gap, finish } = suite("test-enforce-sweep-dice-afterroll");
const spy = installDiceSpy();
const world = await openWorld({ campaign: { maxPlayers: 8 } });
const kit = await combatKit(world);
const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { adjudication } = await import("../src/lib/dm/invoke-catalog.ts");
const DEBUG = Boolean(process.env.ODM_SWEEP_DEBUG);

const GEAR = [{ name: "Longsword", qty: 1, equipped: true }];
const hero = world.addHero({ name: "Lu", class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 14 }, proficiencies: TRAINED, equipment: GEAR, feats: ["Lucky"], gold: 200 });
const ally = world.addHero({ name: "Ally", class: "fighter", level: 5, maxHp: 44, proficiencies: TRAINED, equipment: GEAR });
const BASE = world.sheet(hero.id);
const drop = () => getDatabase().prepare("DELETE FROM pending_rolls WHERE campaign_id = ?").run(world.campaignId);

let made = 0;
let fresh = "";
const prepare = (name) => async () => {
  made += 1;
  fresh = `After ${made}`;
  const out = await world.invoke(name, { ...formArgs(adjudication(name), { heroId: hero.id }), name: fresh, title: fresh });
  if (!out.ok) throw new Error(`set-up ${name} refused: ${out.error}`);
};

async function reset(stage) {
  forceDice(null);
  drop();
  await kit.endFight();
  await world.invoke("end_scene", {});
  for (const sheet of [hero, ally]) {
    world.patch(sheet.id, { currentHp: 44, tempHp: 0, conditions: [], conditionMeta: {}, deathSaves: null });
  }
  world.patch(hero.id, { feats: ["Lucky"], features: BASE.features, resources: { ...BASE.resources, luck_points: { max: 3, used: 0 } } });
  if (stage !== "out") {
    const first = stage === "fight" ? hero : ally;
    const second = stage === "fight" ? ally : hero;
    await kit.fight(1, { heroFaces: { [first.id]: 19, [second.id]: 5 } });
    const [enemy] = world.enemies();
    kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400 });
    kit.place(hero.id, 5, 5);
    kit.place(enemy.id, 5, 6);
    kit.place(ally.id, 4, 5);
    if (stage === "enemy") {
      const encounter = world.encounter();
      kit.saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => entry.kind === "enemy"), turnBudget: null });
    }
  }
  drop();
  spy.take();
}

const rows = [];
const row = (id, kind, tool, stage, args, setup) => rows.push({ id, kind, tool, stage, args, setup });
const SAVE = { saveAbility: "dex", dc: 15, damage: "2d6", halfOnSave: true };
// The character's own checks and saves the GM asks for.
row("request_roll.skill_check", "ability check", "request_roll", "out", (c) => ({ characterId: c.heroId, kind: "skill_check", skill: "perception", dc: 15, reason: "listening" }));
row("request_roll.ability_check", "ability check", "request_roll", "out", (c) => ({ characterId: c.heroId, kind: "ability_check", ability: "str", dc: 15, reason: "the bars" }));
row("request_roll.saving_throw", "saving throw", "request_roll", "out", (c) => ({ characterId: c.heroId, kind: "saving_throw", ability: "dex", dc: 15, reason: "the blade" }));
row("request_roll.initiative", "ability check", "request_roll", "out", (c) => ({ characterId: c.heroId, kind: "initiative", reason: "initiative" }));
row("group_check", "ability check", "group_check", "out", (c) => ({ skill: "athletics", dc: 15, characterIds: [c.heroId], reason: "the wall" }));
row("scene_check", "ability check", "scene_check", "out", (c) => ({ characterId: c.heroId, skill: "athletics", dc: 15, approach: "the cart" }), prepare("start_scene"));
row("social_check", "ability check", "social_check", "out", (c) => ({ characterId: c.heroId, npc: fresh, approach: "persuade", reason: "the guard" }), prepare("set_npc"));
row("haggle", "ability check", "haggle", "out", (c) => ({ characterId: c.heroId, shop: fresh, skill: "persuasion" }), prepare("open_shop"));
row("relationship_beat.flirt", "ability check", "relationship_beat", "out", (c) => ({ characterId: c.heroId, subject: fresh, beat: "flirt", note: "by the fire" }), prepare("set_npc"));
row("stabilize.check", "ability check", "stabilize", "out", (c) => ({ characterId: c.allyId, healerId: c.heroId, method: "check", reason: "the bleeding" }), () => world.patch(ally.id, { currentHp: 0, conditions: ["unconscious"], deathSaves: { successes: 0, failures: 1 } }));
for (const [action, extra] of Object.entries({ grapple: (c) => ({ targetEnemyId: c.enemyId }), shove: (c) => ({ targetEnemyId: c.enemyId, shove: "prone" }), search: () => ({ skill: "perception" }), escape: () => ({}) })) {
  row(`take_action.${action}`, "ability check", "take_action", "fight", (c) => ({ characterId: c.heroId, action, reason: "the sweep", ...extra(c) }), action === "escape" ? (c) => world.patch(hero.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: c.enemyId, sourceName: "Goblin", escapeDc: 15 } } }) : undefined);
}
// Their attacks.
row("pc_attack.weapon", "attack roll", "pc_attack", "fight", (c) => ({ characterId: c.heroId, targetEnemyId: c.enemyId, weapon: "Longsword" }));
row("opportunity_attack", "attack roll", "move_token", "enemy", (c) => ({ token: c.enemyId, x: 5, y: 12, reason: "it runs" }));
row("damage_object.weapon", "attack roll", "damage_object", "out", (c) => ({ name: "a door", material: "iron", size: "medium", ac: 19, characterId: c.heroId, weapon: "Longsword", reason: "breaking in" }));
// Saves something forces on them.
row("cast_at_player.hazard", "saving throw", "cast_at_player", "out", (c) => ({ characterId: c.heroId, ...SAVE, damageType: "fire", source: "a gout of flame" }));
row("cast_at_player.enemy", "saving throw", "cast_at_player", "enemy", (c) => ({ characterId: c.heroId, casterEnemyId: c.enemyId, enemyAbility: "Web", saveAbility: "dex", dc: 15, condition: "restrained" }));
row("aoe_damage.enemy", "saving throw", "aoe_damage", "enemy", (c) => ({ casterEnemyId: c.enemyId, enemyAbility: "Fire Breath", ...SAVE, type: "fire", characterIds: [c.heroId] }));
row("apply_hazard.generic", "saving throw", "apply_hazard", "out", (c) => ({ type: "generic", characterIds: [c.heroId], ...SAVE, damageType: "fire", reason: "the sweep" }));
row("apply_hazard.trap", "saving throw", "apply_hazard", "out", (c) => ({ type: "trap", trap: "Poison Needle", characterIds: [c.heroId], reason: "the lock" }));
row("death_save", "saving throw", "end_turn", "ally", (c) => ({ characterId: c.allyId }), () => world.patch(hero.id, { currentHp: 0, conditions: ["unconscious"], deathSaves: { successes: 0, failures: 0 } }));

const LUCKY = '"Spend one to roll an extra d20 on your own attack roll, ability check or saving throw and choose which die to use" (Lucky, src/lib/srd/authored-feats.json)';
// None left: every site throws a character's d20 through
// src/lib/dm/character-roll.ts, which waits on the card.
const KNOWN = {
};
// Rolls the code says never wait, with its words. Initiative and the death
// save were here, until the maintainer's decision R4 (2026-11-09 gap sweep):
// "After-the-roll holders (Lucky, Bardic Inspiration, and the rest in
// after-roll-logic.ts) are asked on initiative (a Dexterity check) and death
// saves (a saving throw) too; the 20 second clock keeps a table from
// waiting."
const RULING = {
};

async function play(entry) {
  await reset(entry.stage);
  const c = { heroId: hero.id, allyId: ally.id, enemyId: world.enemies()[0]?.id };
  if (entry.setup) await entry.setup(c);
  drop();
  spy.take();
  // The character's d20 shows a 2; a creature's shows a 19.
  forceDice({ d20: 2, enemyD20: 19, other: 3 }, { record: true, creatureSites: /action-common|roll-gates/ });
  let out;
  try {
    out = await world.invoke(entry.tool, entry.args(c));
  } finally {
    forceDice(null);
  }
  const mine = d20sOf(spy.take()).filter((die) => taggedFor(die, hero.name) || (!die.purpose && !/roll-gates|action-common|roll-card|enemy-|npc/.test(die.file)));
  const card = listOpenPendingRolls(world.campaignId).find((pending) => pending.userId === hero.userId && pending.thrown?.options?.some((option) => option.id === "lucky"));
  const verdict = card ? "OFFERED" : mine.length ? "SILENT" : "QUIET";
  if (DEBUG) console.log(`  ${verdict.padEnd(7)} ${entry.id} [${entry.kind}] sites=${[...new Set(mine.map((die) => `${die.file.replace("src/lib/dm/", "")}#${die.fn}`))].join(",")} ${out.ok ? JSON.stringify(out.result).slice(0, 110) : `[${String(out.error).slice(0, 140)}]`}`);
  return { verdict, mine, out };
}

const tally = { OFFERED: 0, SILENT: 0, QUIET: 0 };
for (const entry of rows) {
  const run = async () => {
    const got = await play(entry);
    tally[got.verdict] += 1;
    if (got.verdict === "QUIET") throw new Error(`${entry.id}: no d20 of the character's was thrown${got.out.ok ? "" : `: ${got.out.error}`}`);
    return got;
  };
  if (KNOWN[entry.id]) {
    await gap(`afterroll.${entry.id}`, KNOWN[entry.id], async () => {
      const got = await run();
      assert.equal(got.verdict, "OFFERED", `a failed ${entry.kind} thrown by ${[...new Set(got.mine.map((die) => `${die.file}#${die.fn}`))].join(", ")} stood, and a holder of a luck point was never asked`);
    });
  } else if (RULING[entry.id]) {
    await test(`${entry.id}: never waits, as the code says (${RULING[entry.id]})`, async () => {
      const got = await run();
      assert.equal(got.verdict, "SILENT", `the ruling for ${entry.id} no longer describes the engine: move the row out of RULING`);
    });
  } else {
    await test(`${entry.id}: a failed ${entry.kind} waits on its player's luck point (${LUCKY})`, async () => {
      const got = await run();
      assert.equal(got.verdict, "OFFERED", `${entry.id}: ${got.verdict}`);
    });
  }
}

console.log(`rows: ${rows.length} ${JSON.stringify(tally)}`);
world.close();
finish();
