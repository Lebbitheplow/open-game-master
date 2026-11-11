// The post-apocalyptic classes' features built in the fifth pass of wave 2
// (WAVE2 D5: the genre text is the rule), one case per mechanism, each failing
// without it. The clause ledger (scripts/clauses/genre-post-apocalyptic.json)
// points here for the clauses these hold.
//
// Dice forced; every check reads hit points, a condition, a counter, a card
// or the d20s a roll threw.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";
import { dice, clearDice, diceLog } from "./lib/enforce-world.mjs";

const SRC = new URL("../src/", import.meta.url);
const load = (file) => import(new URL(file, SRC).href);
const { deriveHand } = await load("lib/battlemap/hand.ts");
const { FRESH_TURN } = await load("lib/battlemap/hand-core.ts");
const { ownSquareFacts } = await load("lib/battlemap/view-tactics.ts");

const { test, finish } = suite("test-genre-b-post-apocalyptic");
const rig = await clausesRig();
const { world, kit, ally } = rig;
const feature = (classId, name, level) => ({ classId, name, level, key: `${classId}::${name}` });
const run = async (name, body) => {
  try {
    await test(name, body);
  } finally {
    rig.reset();
  }
};
const lost = (enemy) => 300 - kit.enemy(enemy.id).currentHp;
const used = (hero, id) => world.sheet(hero.id).resources?.[id]?.used ?? 0;
const spendAt = async (hero, resource, faces = [], extra = {}) => {
  clearDice();
  dice(...faces);
  const out = await world.invoke("use_resource", { characterId: hero.id, resource, reason: "test", ...extra });
  clearDice();
  return out;
};
void lost; void used; void spendAt; void diceLog;

// ---- the Hand says what the roll adds ----

await run("Warlord of the Wastes: the ally's attack card carries the +1 pc_attack adds, and none once the road warrior is out of sight", async () => {
  const hero = rig.holder(feature("road_warrior", "Warlord of the Wastes", 18));
  const { near } = await rig.fight(hero);
  const card = () => {
    const board = ownSquareFacts(world.campaignId, world.encounter(), world.sheet(ally.id));
    const dealt = deriveHand(world.sheet(ally.id), { ...FRESH_TURN }, { board }).find((entry) => entry.type === "attack" && /longsword/i.test(entry.name));
    assert.ok(dealt, "the ally was dealt no longsword card");
    return dealt;
  };
  const rolled = async () => {
    rig.myTurn(ally);
    const out = await kit.swing(ally.id, near.id, [10, 3, 3, 3, 3]);
    rig.must(out.out, "pc_attack");
    return (out.toHit?.result?.total ?? out.toHit?.total) - 10;
  };
  const withAura = card();
  assert.equal(withAura.toHit, await rolled(), "the card's bonus is not the roll's");
  assert.match(withAura.description ?? "", /Warlord of the Wastes: \+1 to hit/, `the card says ${withAura.description}`);
  const bare = await rig.without(hero, { name: "Warlord of the Wastes" }, async () => card().toHit);
  assert.equal(withAura.toHit - bare, 1, `the card said +${withAura.toHit} with the warlord and +${bare} without`);
  world.patch(hero.id, { conditions: ["invisible"] });
  assert.equal(card().toHit, bare, "the card kept the +1 of a road warrior its holder cannot see");
});

// ---- the packmaster's beasts ----

const made = (out) => out.summoned ?? out.result?.summoned ?? [];
// The beasts a packmaster bonds, out of a fight.
async function bond(hero) {
  await kit.endFight();
  const out = rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: "Bonded Beast", reason: "test" }), "use_resource Bonded Beast");
  return made(out).map((entry) => world.sheet(entry.characterId));
}
// A fight with the beast on the board at (x, y).
async function packFight(hero, beast, x = 6, y = 3) {
  const foes = await rig.fight(hero);
  kit.place(beast.id, x, y);
  rig.myTurn(hero);
  return foes;
}
const d20sOfSwing = async (who, enemy, args = {}) => {
  rig.myTurn(who);
  clearDice();
  diceLog();
  dice(15, 15, 3, 3, 3, 3, 3);
  const out = await kit.attack(who.id, enemy.id, args);
  const d20s = diceLog().filter((die) => die.sides === 20).length;
  clearDice();
  rig.must(out, "pc_attack");
  return d20s;
};
const wise = (hero) => world.patch(hero.id, { abilities: { ...world.sheet(hero.id).abilities, wis: 20 } });

await run("Bonded Beast: a beast of AC 13 + proficiency and 5 hit points a level whose bite is 1d8 + WIS; in a fight none is bonded beside one already there, nor after one fell", async () => {
  const hero = rig.holder(feature("packmaster", "Bonded Beast", 1));
  wise(hero);
  await rig.fight(hero);
  const call = () => world.invoke("use_resource", { characterId: hero.id, resource: "Bonded Beast", reason: "test" });
  const first = made(rig.must(await call(), "Bonded Beast in a fight"))[0];
  assert.ok(first, "the beast did not come to the board in a fight");
  assert.ok(!(await call()).ok, "a second beast was bonded beside the first in a fight");
  rig.must(await world.invoke("apply_damage", { characterId: first.characterId, amount: 50, type: "fire", reason: "test" }), "apply_damage");
  assert.ok(!(await call()).ok, "the fallen beast was replaced in the same fight");
  const [beast, second] = await bond(hero);
  assert.ok(beast && !second, "a 1st-level packmaster bonds other than one beast");
  assert.equal(beast.ac, 15, `the beast's AC is ${beast.ac} (13 + proficiency 2)`);
  assert.equal(beast.maxHp, 5, `the beast has ${beast.maxHp} hit points at level 1`);
  const { near } = await packFight(hero, beast);
  rig.myTurn(beast);
  const out = await kit.swing(beast.id, near.id, [10, 3, 3, 3]);
  rig.must(out.out, "the beast's pc_attack");
  assert.equal((out.toHit?.result?.total ?? out.toHit?.total) - 10, 7, "the bite's bonus is not proficiency 2 + WIS 5");
  assert.equal(lost(near), 8, `the bite dealt ${lost(near)} (a 3 and WIS +5)`);
});

await run("War Beast and Twin Bond: the beast bites for 2d8 + WIS as magic with +2 AC, and a second beast of AC 12 + proficiency and 2 hit points a level is bonded", async () => {
  const hero = rig.holder(feature("packmaster", "Twin Bond", 13));
  const [beast, scout] = await bond(hero);
  assert.equal(beast.ac, 20, `the war beast's AC is ${beast.ac} (13 + proficiency 5 + 2)`);
  assert.equal(beast.maxHp, 65, `the war beast has ${beast.maxHp} hit points`);
  assert.ok(scout, "Twin Bond bonded no second beast");
  assert.equal(scout.ac, 17, `the scout's AC is ${scout.ac} (12 + proficiency 5)`);
  assert.equal(scout.maxHp, 26, `the scout has ${scout.maxHp} hit points (2 x 13)`);
  assert.equal(scout.speed, 50, `the scout walks ${scout.speed} ft`);
  const { near } = await packFight(hero, beast);
  kit.setEnemy(near.id, { stats: { ...kit.enemy(near.id).stats, resist: "bludgeoning, piercing, and slashing from nonmagical attacks" } });
  rig.myTurn(beast);
  rig.must((await kit.swing(beast.id, near.id, [10, 3, 3, 3, 3])).out, "the war beast's pc_attack");
  assert.equal(lost(near), 9, `the war beast's bite dealt ${lost(near)} (two 3s and WIS +3, unresisted)`);
});

await run("Pack Tactics Training: the packmaster and the beast each attack with advantage a creature the other is adjacent to, and not one it is not", async () => {
  const hero = rig.holder(feature("packmaster", "Pack Tactics Training", 1));
  const [beast] = await bond(hero);
  const { near } = await packFight(hero, beast);
  assert.equal(await d20sOfSwing(hero, near), 2, "the packmaster's attack beside the beast threw one d20");
  assert.equal(await d20sOfSwing(beast, near), 2, "the beast's attack beside the packmaster threw one d20");
  kit.place(beast.id, 12, 9);
  assert.equal(await d20sOfSwing(hero, near), 1, "the packmaster kept advantage with the beast 30 feet off");
});

await run("Apex Pair: an ally adjacent to the beast attacks with advantage a creature the beast is adjacent to", async () => {
  const hero = rig.holder(feature("packmaster", "Apex Pair", 11));
  const [beast] = await bond(hero);
  const { near } = await packFight(hero, beast, 6, 3);
  kit.place(ally.id, 7, 3);
  const { on, off } = await rig.both(hero, { name: "Apex Pair" }, () => d20sOfSwing(ally, near));
  assert.equal(on, 2, "the ally beside the beast threw one d20");
  assert.equal(off, 1, "without Apex Pair the ally had advantage all the same");
});

await run("Coordinated Takedown: once the packmaster and the beast have both hit a creature in the round it saves (STR) or is knocked prone and grappled", async () => {
  const hero = rig.holder(feature("packmaster", "Coordinated Takedown", 15));
  const [beast] = await bond(hero);
  const { near } = await packFight(hero, beast);
  await rig.swing(hero, near);
  assert.ok(!kit.enemy(near.id).conditions.includes("prone"), "one hit alone took the creature down");
  rig.myTurn(beast);
  clearDice();
  dice(15, 15, 3, 3, 1);
  rig.must(await kit.attack(beast.id, near.id), "the beast's pc_attack");
  clearDice();
  const struck = kit.enemy(near.id);
  assert.ok(struck.conditions.includes("prone") && struck.conditions.includes("grappled"), `the creature holds ${JSON.stringify(struck.conditions)}`);
  assert.equal(struck.conditionMeta.grappled?.source, beast.id, "the grapple is not the beast's");
});

await run("One Blood: within 30 ft of the beast the packmaster resists a creature neither has wounded, and not once one of them has hit it", async () => {
  const hero = rig.holder(feature("packmaster", "One Blood", 20));
  const [beast] = await bond(hero);
  const { near } = await packFight(hero, beast);
  world.patch(hero.id, { currentHp: 100 });
  await rig.clubbed(near, hero);
  assert.equal(100 - world.sheet(hero.id).currentHp, 3, "an unwounded creature's club was not halved (6 to 3)");
  const bare = await rig.without(hero, { name: "One Blood" }, async () => {
    world.patch(hero.id, { currentHp: 100 });
    await rig.clubbed(near, hero);
    return 100 - world.sheet(hero.id).currentHp;
  });
  assert.equal(bare, 6, `without One Blood the club dealt ${bare}`);
  rig.myTurn(beast);
  rig.must((await kit.swing(beast.id, near.id, [15, 3, 3, 3, 3, 3])).out, "the beast's pc_attack");
  world.patch(hero.id, { currentHp: 100 });
  await rig.clubbed(near, hero);
  assert.equal(100 - world.sheet(hero.id).currentHp, 6, "a creature the beast wounded was still resisted");
});

await run("Pack Endurance: the blow that would drop the beast leaves it at 1 once a long rest, and a bare spend is refused", async () => {
  const hero = rig.holder(feature("packmaster", "Pack Endurance", 14));
  const [beast] = await bond(hero);
  await packFight(hero, beast);
  const bare = await spendAt(hero, "Pack Endurance");
  assert.ok(!bare.ok, "a bare spend of Pack Endurance went through");
  assert.equal(used(hero, "post_apocalyptic_pack_endurance"), 0, "the refused spend spent the use");
  rig.must(await world.invoke("apply_damage", { characterId: beast.id, amount: 400, type: "fire", reason: "test" }), "apply_damage");
  assert.equal(world.sheet(beast.id)?.currentHp, 1, "the beast was not held at 1");
  assert.equal(used(hero, "post_apocalyptic_pack_endurance"), 1, "the hold spent no use");
  rig.must(await world.invoke("apply_damage", { characterId: beast.id, amount: 400, type: "fire", reason: "test" }), "apply_damage");
  assert.ok(!world.sheets().some((sheet) => sheet.id === beast.id && sheet.currentHp > 0), "the beast was held a second time");
});

await run("Pack Endurance: the packmaster too drops to 1 while the beast lives, and falls when it does not", async () => {
  const hero = rig.holder(feature("packmaster", "Pack Endurance", 14));
  world.patch(hero.id, { currentHp: 10 });
  rig.must(await world.invoke("apply_damage", { characterId: hero.id, amount: 30, type: "fire", reason: "test" }), "apply_damage");
  assert.equal(world.sheet(hero.id).currentHp, 0, "with no beast the packmaster was held up");
  await bond(hero);
  world.patch(hero.id, { currentHp: 10, conditions: [], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  rig.must(await world.invoke("apply_damage", { characterId: hero.id, amount: 30, type: "fire", reason: "test" }), "apply_damage");
  assert.equal(world.sheet(hero.id).currentHp, 1, "the packmaster was not held at 1 beside a living beast");
  assert.equal(used(hero, "post_apocalyptic_pack_endurance"), 1, "the hold spent no use");
});

await run("Mended Hide: a healing spell the packmaster casts on their beast heals twice as much, on an ally the same as ever", async () => {
  const hero = rig.holder(feature("packmaster", "Mended Hide", 7));
  world.patch(hero.id, { spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 } }, known: ["Cure Wounds"], prepared: ["Cure Wounds"] } });
  const [beast] = await bond(hero);
  const heal = async (target) => {
    world.patch(target.id, { currentHp: 5 });
    clearDice();
    dice(5);
    rig.must(await world.invoke("heal", { characterId: target.id, casterId: hero.id, spell: "Cure Wounds", level: 1 }), "heal");
    clearDice();
    return world.sheet(target.id).currentHp - 5;
  };
  assert.equal(await heal(ally), 8, "Cure Wounds on an ally did not heal a 5 and WIS +3");
  assert.equal(await heal(beast), 16, "Cure Wounds on the beast was not doubled");
});

await run("Call the Wild: 1d4 wolves answer for 10 minutes, 2d4 with The Pack Provides, which also gives the call back on a short rest once a day", async () => {
  const hero = rig.holder(feature("packmaster", "Call the Wild", 9));
  const out = rig.must(await spendAt(hero, "Call the Wild", [3]), "use_resource Call the Wild");
  const wolves = made(out).map((entry) => world.sheet(entry.characterId));
  assert.equal(wolves.length, 3, `a 3 on the d4 called ${wolves.length}`);
  assert.ok(wolves.every((wolf) => wolf.summon?.form === "Wolf" && wolf.conditionMeta.summoned?.rounds === 100), `the wolves: ${JSON.stringify(wolves.map((wolf) => [wolf.summon?.form, wolf.conditionMeta.summoned]))}`);
  assert.equal(used(hero, "post_apocalyptic_call_the_wild"), 1, "the call spent no use");
  const elder = rig.holder(feature("packmaster", "The Pack Provides", 18));
  const more = rig.must(await spendAt(elder, "Call the Wild", [3, 4]), "use_resource Call the Wild");
  assert.equal(made(more).length, 7, `a 3 and a 4 on 2d4 called ${made(more).length}`);
  const bare = await spendAt(elder, "The Pack Provides");
  assert.ok(!bare.ok, "a bare spend of The Pack Provides went through");
  rig.must(await world.invoke("take_rest", { kind: "short" }), "short rest");
  assert.equal(used(elder, "post_apocalyptic_call_the_wild"), 0, "the short rest did not give the call back");
  assert.equal(used(elder, "post_apocalyptic_the_pack_provides"), 1, "the day's recharge was not spent");
  world.patch(elder.id, { resources: { ...world.sheet(elder.id).resources, post_apocalyptic_call_the_wild: { max: 1, used: 1 } } });
  rig.must(await world.invoke("take_rest", { kind: "short" }), "short rest");
  assert.equal(used(elder, "post_apocalyptic_call_the_wild"), 1, "a second short rest the same day gave the call back again");
});

await run("Shared Fury: the beast's bite gains the +2 as the packmaster's blow does", async () => {
  const hero = rig.holder(feature("packmaster", "Shared Fury", 3));
  const [beast] = await bond(hero);
  const { near } = await packFight(hero, beast);
  rig.must(await spendAt(hero, "Shared Fury"), "use_resource Shared Fury");
  assert.ok(world.sheet(beast.id).conditions.includes("shared fury"), `the beast holds ${JSON.stringify(world.sheet(beast.id).conditions)}`);
  rig.myTurn(beast);
  rig.must((await kit.swing(beast.id, near.id, [15, 3, 3, 3])).out, "the beast's pc_attack");
  assert.equal(lost(near), 8, `the furious bite dealt ${lost(near)} (a 3, WIS +3 and 2)`);
});

await run("Legend of the Pack: the beast's hit points double, its bite deals +2d8 and a creature it hits saves (WIS) or is frightened; once the beast fell in the fight it is refused, nothing spent", async () => {
  const hero = rig.holder(feature("packmaster", "Legend of the Pack", 15));
  const [beast] = await bond(hero);
  const { near } = await packFight(hero, beast);
  rig.must(await spendAt(hero, "Legend of the Pack"), "use_resource Legend of the Pack");
  const grown = world.sheet(beast.id);
  assert.equal(grown.maxHp, 150, `the monstrous beast has ${grown.maxHp} hit points (2 x 75)`);
  assert.equal(grown.currentHp, 150, `and stands at ${grown.currentHp}`);
  rig.myTurn(beast);
  clearDice();
  dice(15, 15, 3, 3, 3, 3, 1, 1);
  rig.must(await kit.attack(beast.id, near.id), "the beast's pc_attack");
  clearDice();
  assert.equal(lost(near), 15, `the monstrous bite dealt ${lost(near)} (2d8 of the war beast, WIS +3, and 2d8 more)`);
  const struck = kit.enemy(near.id);
  assert.ok(struck.conditions.includes("frightened"), `the creature holds ${JSON.stringify(struck.conditions)}`);
  assert.equal(struck.conditionMeta.frightened?.source, beast.id, "the fear is not of the beast");
  const { legendEnded } = await load("lib/dm/genre-b-post-apocalyptic-beast.ts");
  const { getCampaignById } = await load("lib/db/campaigns.ts");
  legendEnded(getCampaignById(world.campaignId), world.sheet(beast.id), ["legend of the pack"]);
  assert.equal(world.sheet(beast.id).maxHp, 75, "the beast kept its doubled hit points after the minute");
  rig.must(await world.invoke("apply_damage", { characterId: beast.id, amount: 400, type: "fire", reason: "test" }), "apply_damage");
  world.patch(hero.id, { resources: { ...world.sheet(hero.id).resources, post_apocalyptic_legend_of_the_pack: { max: 1, used: 0 } } });
  rig.myTurn(hero);
  const none = await spendAt(hero, "Legend of the Pack");
  assert.ok(!none.ok, "the legend grew a beast that fell in this fight");
  assert.equal(used(hero, "post_apocalyptic_legend_of_the_pack"), 0, "the refused spend spent its use");
});

await run("Blood Bond: the packmaster's reaction splits a hit on their beast between them, and is refused for any other ally", async () => {
  const hero = rig.holder(feature("packmaster", "Blood Bond", 7));
  const [beast] = await bond(hero);
  const { near } = await packFight(hero, beast);
  world.patch(ally.id, { currentHp: 100 });
  await rig.clubbed(near, ally);
  kit.giveTurn(ally.id);
  const other = await world.invoke("use_reaction", { characterId: hero.id, feature: "Blood Bond", targetCharacterId: ally.id, reason: "test" });
  assert.ok(!other.ok, "Blood Bond took a hit meant for an ally who is not the beast");
  await rig.clubbed(near, world.sheet(beast.id));
  const hurt = world.sheet(beast.id).currentHp;
  assert.equal(35 - hurt, 6, `the club took ${35 - hurt} off the beast`);
  kit.giveTurn(ally.id);
  world.patch(hero.id, { currentHp: 100 });
  const out = await world.invoke("use_reaction", { characterId: hero.id, feature: "Blood Bond", targetCharacterId: beast.id, reason: "test" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(beast.id).currentHp, 32, "the beast did not keep half of the 6");
  assert.equal(world.sheet(hero.id).currentHp, 97, "the packmaster did not take the other half");
});

world.close();
finish();
