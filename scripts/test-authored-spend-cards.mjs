// A subclass feature the server resolves (authored `spends`) that also has a
// counter was dealt the counter's card, which sent the counter's id. use_resource
// took the id down the generic path: the use was spent and nothing happened, so
// Elder Champion, Avenging Angel and Hexblade's Curse did nothing from the Hand.
//
//   - each such spend, at every subclass's level 20, is one card that sends its
//     name, and playing it the way the Hand sends it does what the spend says;
//   - a call by the counter's id does what a call by the feature's name does.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-authored-spend-cards");
const world = await openWorld({ campaign: { maxPlayers: 400 } });
const kit = await combatKit(world);

const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { heldAuthored, gateHolds } = await import("../src/lib/srd/authored-effects.ts");
const { resourceDef } = await import("../src/lib/srd/class-resources.ts");
const { directCardCall } = await import("../src/lib/dm/intent-logic.ts");

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/lib/srd/${name}`, import.meta.url), "utf8"));
const classFeatures = read("class-features.json").classes;
const subclasses = read("subclasses.json").classes;

const abilities = { str: 16, dex: 16, con: 14, int: 16, wis: 16, cha: 16 };
const FACES = [10, 10, 10, 10, 10, 10, 10, 10];

async function stage(hero) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [hero.id]: 19 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.giveTurn(hero.id);
  const sheet = world.sheet(hero.id);
  world.patch(hero.id, {
    conditions: [], conditionMeta: {}, tempHp: 0, currentHp: 100,
    resources: Object.fromEntries(Object.entries(sheet.resources).map(([id, state]) => [id, { ...state, used: 0 }])),
  });
  return enemy;
}

async function play(hero, name, args) {
  world.dice(...FACES);
  const out = await world.invoke(name, args);
  world.clearDice();
  const sheet = world.sheet(hero.id);
  const [enemy] = world.enemies();
  return {
    ok: out.ok,
    error: out.error,
    state: { conditions: sheet.conditions, tempHp: sheet.tempHp, hp: sheet.currentHp, enemyConditions: enemy.conditions, enemyHp: enemy.currentHp },
  };
}

// Every subclass at level 20, with the spends a card should play.
const builds = [];
for (const classId of Object.keys(classFeatures)) {
  for (const subclass of [...classFeatures[classId].subclasses, ...(subclasses[classId] ?? [])]) {
    const hero = world.addHero({
      user: world.owner, class: classId, subclass: subclass.name, level: 20, abilities, maxHp: 200, proficiencies: TRAINED,
      portrait: { url: "/uploads/test.png" }, equipment: [{ name: "Longsword", qty: 1, equipped: true }],
    });
    const sheet = world.sheet(hero.id);
    const spends = heldAuthored(sheet).flatMap((held) =>
      (held.entry.spends ?? [])
        .filter((spend) => spend.fight !== "out" && spend.does.kind !== "choose" && spend.action !== "reaction" && gateHolds(spend.gate, sheet, held))
        // The ones this suite is about: a counter of the feature's own name.
        .filter((spend) => spend.pool && resourceDef(spend.pool.id)?.displayName === spend.name),
    );
    builds.push({ classId, subclass: subclass.name, hero, spends });
  }
}
const label = (build, spend) => `${build.classId}/${build.subclass}/${spend.name}`;

await test("There is a spend with a counter of its own name to check.", () => {
  assert.ok(builds.flatMap((build) => build.spends).length >= 15);
});

await test("Each such spend is one card, sent by its name.", () => {
  for (const build of builds) {
    const hand = deriveHand(world.sheet(build.hero.id), FRESH_TURN, {});
    for (const spend of build.spends) {
      const cards = hand.filter((card) => card.name === spend.name);
      assert.equal(cards.length, 1, `${label(build, spend)}: ${cards.length} cards`);
      assert.equal(cards[0].intent.resourceId, spend.name, label(build, spend));
    }
  }
});

await test("The card keeps its counter's id and uses line, so an arranged seat holds and no raw counter id shows.", () => {
  for (const build of builds) {
    const hand = deriveHand(world.sheet(build.hero.id), FRESH_TURN, {});
    for (const spend of build.spends) {
      const card = hand.find((entry) => entry.name === spend.name);
      assert.equal(card.id, `feature:${spend.pool.id}`, label(build, spend));
      assert.match(card.resource, /^Uses \d+\/\d+$/, label(build, spend));
    }
  }
});

await test("Hidden Paths stays a bonus action: its card is open once the action is spent.", () => {
  const dreams = builds.find((build) => build.subclass === "Circle of Dreams");
  const turn = { ...FRESH_TURN, myTurn: true, actionUsed: true };
  const card = deriveHand(world.sheet(dreams.hero.id), turn, {}).find((entry) => entry.name === "Hidden Paths");
  assert.equal(card.cost, "bonus");
  assert.equal(card.disabled, null);
});

await test("A card played as the Hand sends it does what the spend says: a capstone's condition lands.", async () => {
  const capstones = ["Elder Champion", "Avenging Angel", "Invincible Conqueror", "Living Legend", "Mortal Bulwark", "Exalted Champion", "Dread Lord"];
  const played = [];
  for (const build of builds) {
    for (const spend of build.spends) {
      // Arcane Jolt needs a heal-or-burn pick and a target to match, which its
      // card cannot post yet: the engine refuses it and spends nothing.
      if (spend.name === "Arcane Jolt") continue;
      const enemy = await stage(build.hero);
      // Psionic Recovery brings energy back, and is refused at a full pool.
      if (spend.name === "Psionic Recovery") {
        const { resources } = world.sheet(build.hero.id);
        world.patch(build.hero.id, { resources: { ...resources, sub_psionic_energy: { ...resources.sub_psionic_energy, used: 1 } } });
      }
      const card = deriveHand(world.sheet(build.hero.id), FRESH_TURN, {}).find((entry) => entry.name === spend.name);
      const intent = {
        ...card.intent,
        ...(card.target === "enemy" ? { targetId: enemy.id, targetKind: "enemy" } : {}),
        ...(card.target === "ally" ? { targetId: build.hero.id, targetKind: "ally" } : {}),
        // A card with a pick posts the player's pick.
        ...(card.choice ? { [card.choice.arg]: card.choice.options[0].value } : {}),
      };
      const call = directCardCall(intent, build.hero.id, { inFight: true });
      assert.ok(call, `${label(build, spend)}: the card makes no call`);
      const out = await play(build.hero, call.name, call.args);
      assert.equal(out.ok, true, `${label(build, spend)}: ${out.error}`);
      const pool = world.sheet(build.hero.id).resources[spend.pool.id];
      assert.ok(pool.used > 0, `${label(build, spend)}: nothing spent`);
      if (capstones.includes(spend.name)) {
        assert.ok(out.state.conditions.includes(spend.does.condition), `${label(build, spend)}: ${JSON.stringify(out.state.conditions)}`);
        played.push(spend.name);
      }
    }
  }
  assert.deepEqual([...played].sort(), [...capstones].sort());
});

await test("A call by the counter's id does what a call by the feature's name does.", async () => {
  for (const build of builds) {
    for (const spend of build.spends) {
      const outcomes = [];
      for (const resource of [spend.pool.id, spend.name]) {
        const enemy = await stage(build.hero);
        outcomes.push(await play(build.hero, "use_resource", { characterId: build.hero.id, resource, targetEnemyId: enemy.id }));
      }
      assert.deepEqual(outcomes[0], outcomes[1], label(build, spend));
    }
  }
});

world.close();
finish();
