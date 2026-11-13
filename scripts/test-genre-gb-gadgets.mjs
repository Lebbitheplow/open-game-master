// The gadgeteer's gadgets (steampunk, cc1113 genre-b pass GB08): the picks
// Utility Gadgets and the Third, Fourth and Fifth Gadget open
// (src/lib/srd/options.ts "gadget"), each pick's own counter
// (src/lib/srd/authored-resources.json) and use (authored-effects-genre-gb.ts),
// Smoke Discipline's wider smoke seen through by its thrower, Chain
// Deployment's second gadget on the same bonus action, and Perpetual
// Toolkit's short-rest recharge. Each case fails without its mechanism; the
// clause ledger (scripts/clauses/genre-steampunk.json) points here.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";

const SRC = new URL("../src/", import.meta.url);
const load = (file) => import(new URL(file, SRC).href);
const options = await load("lib/srd/options.ts");
const { getBattleMapForEncounter } = await load("lib/db/battle-maps.ts");

const { test, finish } = suite("test-genre-gb-gadgets");
const rig = await clausesRig();
const { world } = rig;
const feature = (classId, name, level) => ({ classId, name, level, key: `${classId}::${name}` });
const run = async (name, body) => {
  try {
    await test(name, body);
  } finally {
    rig.reset();
  }
};
const MOD = 3;

// A gadgeteer of `level` who picked these gadgets, their counters filled.
function gadgeteer(level, picks) {
  const row = feature("gadgeteer", level >= 15 ? "Chain Deployment" : "Utility Gadgets", level >= 15 ? 15 : 1);
  const hero = rig.holder(row, { level });
  const sheet = world.sheet(hero.id);
  const features = [...sheet.features, ...picks.map((name) => ({ name: options.optionFeatureName("gadget", name), source: "choice" }))];
  const resources = rig.resources.populateResources(features, level, { str: MOD, dex: MOD, con: MOD, int: MOD, wis: MOD, cha: MOD }, sheet.resources, sheet.classes);
  world.patch(hero.id, { features, resources });
  return hero;
}
const use = (hero, name, args = {}) => world.invoke("use_resource", { characterId: hero.id, resource: name, reason: "test", ...args });

await run("Utility Gadgets, Third, Fourth and Fifth Gadget: a gadgeteer picks two gadgets at 1st level, three at 6th, four at 10th and five at 14th, from the six the text names", async () => {
  const names = options.optionsOfKind("gadget").map((option) => option.n);
  assert.deepEqual(names, ["Grapnel", "Smoke Bomb", "Arc Lamp", "Ear Trumpet", "Skeleton Key", "Pocket Shield"]);
  const slots = [1, 5, 6, 9, 10, 13, 14, 20].map((level) => options.optionSlotsFor("gadgeteer", "", level, "gadget"));
  assert.deepEqual(slots, [2, 2, 3, 3, 4, 4, 5, 5], `gadget picks by level: ${slots}`);
  assert.equal(options.optionSlotsFor("machinist", "", 20, "gadget"), 0, "another class picks gadgets");
});

await run("A picked gadget is a bonus action with INT-mod uses back on any rest: the Pocket Shield gives +2 AC for a round, the Ear Trumpet advantage on Perception, the Skeleton Key on a Dexterity check, the Grapnel a free climb", async () => {
  const hero = gadgeteer(1, ["Pocket Shield", "Ear Trumpet", "Skeleton Key", "Grapnel"]);
  await rig.fight(hero);
  const counter = world.sheet(hero.id).resources?.steampunk_gadget_pocket_shield;
  assert.equal(counter?.max, MOD, `the Pocket Shield counter: ${JSON.stringify(counter)}`);
  const ac = world.sheet(hero.id).ac;
  rig.must(await use(hero, "Pocket Shield"), "Pocket Shield");
  assert.equal(rig.budget().bonusUsed, true, "the gadget did not spend the bonus action");
  const { acWithEffects } = await load("lib/dm/effects.ts").catch(() => ({}));
  const derived = rig.srd.deriveAc(world.sheet(hero.id));
  assert.equal(derived, ac + 2, `AC ${derived} with the shield open, ${ac} before (${acWithEffects ? "effects read" : ""})`);
  rig.myTurn(hero);
  rig.must(await use(hero, "Ear Trumpet"), "Ear Trumpet");
  assert.equal(await rig.d20sOf(hero, { kind: "skill_check", skill: "perception" }), 2, "Perception with the ear trumpet");
  rig.myTurn(hero);
  rig.must(await use(hero, "Skeleton Key"), "Skeleton Key");
  assert.equal(await rig.d20sOf(hero, { kind: "ability_check", ability: "dex" }), 2, "a Dexterity check with the skeleton key");
  rig.myTurn(hero);
  rig.must(await use(hero, "Grapnel"), "Grapnel");
  const { steampunkStride } = await load("lib/srd/genre-b-steampunk-moves.ts");
  assert.equal(steampunkStride(world.sheet(hero.id)).climbs, true, "the grapnel's round does not climb freely");
  // A gadget not picked is no use at all.
  const refused = await use(hero, "Arc Lamp");
  assert.equal(refused.ok, false, "an unpicked gadget was used");
  // The uses come back on a short rest.
  world.patch(hero.id, { resources: { ...world.sheet(hero.id).resources, steampunk_gadget_pocket_shield: { max: MOD, used: MOD } } });
  await rig.kit.endFight();
  rig.must(await world.invoke("take_rest", { kind: "short" }), "a short rest");
  assert.equal(world.sheet(hero.id).resources.steampunk_gadget_pocket_shield.used, 0, "the Pocket Shield's uses did not come back on a short rest");
});

await run("Smoke Discipline: the gadgeteer's smoke bomb fills a 15-foot radius they see through, where before 9th level it is 10 feet and blocks their sight too", async () => {
  const laid = [];
  for (const level of [1, 9]) {
    const hero = gadgeteer(level, ["Smoke Bomb", "Arc Lamp"]);
    const { near } = await rig.fight(hero);
    rig.must(await use(hero, "Smoke Bomb", { targetEnemyId: near.id }), "Smoke Bomb");
    const map = getBattleMapForEncounter(world.encounter().id);
    const smoke = map.spellZones.find((zone) => /smoke/i.test(`${zone.runsAs ?? ""} ${zone.spell ?? ""}`));
    assert.ok(smoke, `no smoke on the board at level ${level}: ${JSON.stringify(map.spellZones).slice(0, 300)}`);
    laid.push({ level, cells: smoke.cells?.length ?? 0, runsAs: smoke.runsAs, seen: smoke.seenThroughBy === hero.id });
    rig.reset();
  }
  const [plain, disciplined] = laid;
  assert.ok(disciplined.cells > plain.cells, `the 15-foot smoke covers ${disciplined.cells} squares, the 10-foot ${plain.cells}`);
  assert.deepEqual([plain.seen, disciplined.seen], [false, true], `seen through: ${JSON.stringify(laid)}`);
});

await run("Chain Deployment: a second, different gadget rides the bonus action the first spent, once a turn; without the feature it is refused", async () => {
  const row = feature("gadgeteer", "Chain Deployment", 15);
  const hero = gadgeteer(15, ["Ear Trumpet", "Arc Lamp", "Pocket Shield"]);
  await rig.fight(hero);
  const chain = async () => {
    rig.myTurn(hero);
    world.patch(hero.id, { conditions: [], conditionMeta: {} });
    rig.must(await use(hero, "Ear Trumpet"), "the first gadget");
    const second = await use(hero, "Arc Lamp");
    const third = second.ok ? await use(hero, "Pocket Shield") : null;
    return { second: second.ok, third: third?.ok ?? null };
  };
  const { on, off } = await rig.both(hero, row, chain);
  assert.deepEqual(on, { second: true, third: false }, `with Chain Deployment: ${JSON.stringify(on)}`);
  assert.equal(off.second, false, "without Chain Deployment the second gadget rode the spent bonus action");
});

rig.world.close();
finish();
