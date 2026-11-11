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

const { TRIGGERED_COUNTERS } = await import("../src/lib/srd/trigger-table.ts");
const { test, finish } = suite("test-authored-spend-cards");
const world = await openWorld({ campaign: { maxPlayers: 400 } });
const kit = await combatKit(world);

const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { heldAuthored, gateHolds } = await import("../src/lib/srd/authored-effects.ts");
const { resourceDef } = await import("../src/lib/srd/class-resources.ts");
const { otherPrice } = await import("../src/lib/srd/counter-rules.ts");
const { directCardCall } = await import("../src/lib/dm/intent-logic.ts");
const { groupHand } = await import("../src/lib/battlemap/hand-groups.ts");
const { splitHand } = await import("../src/lib/battlemap/hand-layout.ts");

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
        .filter((spend) => spend.pool && resourceDef(spend.pool.id)?.displayName === spend.name)
        // Not one dealt when its trigger opens (Call the Hunt on the rage just
        // entered, hand-react-triggers.ts): the own-turn Hand holds no card of it.
        .filter((spend) => !TRIGGERED_COUNTERS.includes(spend.pool.id)),
    );
    builds.push({ classId, subclass: subclass.name, hero, spends });
  }
}
const label = (build, spend) => `${build.classId}/${build.subclass}/${spend.name}`;

await test("There is a spend with a counter of its own name to check.", () => {
  assert.ok(builds.flatMap((build) => build.spends).length >= 15);
});

// Arcane Jolt either burns the creature hit or heals one near it: a card for
// each, so each posts the target it needs. Infectious Fury's damage and its
// forced attack are a card each too, the attack taking the creature struck as
// a second pick (hand-subclass.ts forcedVictim).
const AIMS = { "Arcane Jolt": 2, "Infectious Fury": 2 };

await test("Each such spend is one card (Arcane Jolt one per aim), sent by its name.", () => {
  for (const build of builds) {
    const hand = deriveHand(world.sheet(build.hero.id), FRESH_TURN, {});
    for (const spend of build.spends) {
      const cards = hand.filter((card) => card.intent.card === "feature" && card.intent.resourceId === spend.name);
      assert.equal(cards.length, AIMS[spend.name] ?? 1, `${label(build, spend)}: ${cards.length} cards`);
      assert.equal(hand.filter((card) => card.name === spend.name).length, AIMS[spend.name] ? 0 : 1, label(build, spend));
    }
  }
});

await test("The card keeps its counter's id and uses line, so an arranged seat holds and no raw counter id shows, spent or not.", () => {
  for (const build of builds) {
    const hand = deriveHand(world.sheet(build.hero.id), FRESH_TURN, {});
    for (const spend of build.spends) {
      for (const card of hand.filter((entry) => entry.intent.card === "feature" && entry.intent.resourceId === spend.name)) {
        assert.equal(card.id, `feature:${spend.pool.id}${AIMS[spend.name] ? `:${card.intent.variant}` : ""}`, label(build, spend));
        assert.match(card.resource, /^Uses \d+\/\d+$/, label(build, spend));
      }
      const spent = { ...world.sheet(build.hero.id), resources: { ...world.sheet(build.hero.id).resources, [spend.pool.id]: { ...world.sheet(build.hero.id).resources[spend.pool.id], used: 99 } } };
      // A counter whose text names another price the sheet can pay ("once
      // per long rest or for 7 sorcery points") stays open with its uses spent.
      const paysOtherwise = Boolean(otherPrice(resourceDef(spend.pool.id), spent));
      for (const card of deriveHand(spent, FRESH_TURN, {}).filter((entry) => entry.intent.card === "feature" && entry.intent.resourceId === spend.name)) {
        if (paysOtherwise) {
          assert.equal(card.disabled, null, `${label(build, spend)}: its other price pays, yet ${card.disabled}`);
          continue;
        }
        assert.ok(card.disabled && !card.disabled.includes(spend.pool.id.replace(/_/g, " ")), `${label(build, spend)}: ${card.disabled}`);
      }
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

// What the Creation bard's player types in the card's box.
const CREATED = "Crowbar";

await test("A card played as the Hand sends it does what the spend says: a capstone's condition lands.", async () => {
  const capstones = ["Elder Champion", "Avenging Angel", "Invincible Conqueror", "Living Legend", "Mortal Bulwark", "Exalted Champion", "Dread Lord"];
  const played = [];
  for (const build of builds) {
    for (const spend of build.spends) {
      // A spend that rides a weapon hit waits for one (Arcane Jolt, Wails
      // from the Grave: "after a sneak attack"); its own suite lands the hit.
      // One that rides a natural weapon's hit likewise (Infectious Fury: the
      // clause suite's infectious-fury probe lands the claws first).
      // An Arcane Shot rides a bow's arrow and an option the archer chose
      // (the clause suite's arcane-shot probes fire the arrow first).
      if (spend.name === "Arcane Jolt" || spend.name === "Arcane Shot" || spend.afterWeaponHit || spend.afterNaturalHit) continue;
      const enemy = await stage(build.hero);
      // Psionic Recovery brings energy back, and is refused at a full pool.
      if (spend.name === "Psionic Recovery") {
        const { resources } = world.sheet(build.hero.id);
        world.patch(build.hero.id, { resources: { ...resources, sub_psionic_energy: { ...resources.sub_psionic_energy, used: 1 } } });
      }
      // Power Surge: "Once per turn when you deal damage to a creature or
      // object with a wizard spell". The wizard's Magic Missile hurts the
      // creature first, as the spends sweep stages it (sweep-spends-walk.mjs).
      if (spend.afterSpellDamage) {
        // These heroes are made with no spells: the wizard is given the one.
        world.patch(build.hero.id, {
          equipment: [{ name: "Component pouch", qty: 1 }],
          spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Magic Missile"], known: ["Magic Missile"], cantrips: [] },
        });
        const cast = await play(build.hero, "cast_at_enemy", { characterId: build.hero.id, targetEnemyId: enemy.id, spell: "Magic Missile" });
        assert.equal(cast.ok, true, `${label(build, spend)}: the staging's Magic Missile: ${cast.error}`);
      }
      const card = deriveHand(world.sheet(build.hero.id), FRESH_TURN, {}).find((entry) => entry.name === spend.name);
      const intent = {
        ...card.intent,
        ...(card.target === "enemy" ? { targetId: enemy.id, targetKind: "enemy" } : {}),
        ...(card.target === "ally" ? { targetId: build.hero.id, targetKind: "ally" } : {}),
        // A card with a pick posts the player's pick.
        ...(card.choice ? { [card.choice.arg]: card.choice.options[0].value } : {}),
        // Performance of Creation: "Create a nonmagical item worth no more than
        // 20 times your bard level as an action". Which item is the player's to
        // say, so its card opens the box (compose) and the name typed there is
        // the spend's variant; with none the engine asks for it, spending nothing.
        ...(spend.does.kind === "create_item" ? { variant: CREATED } : {}),
      };
      if (spend.does.kind === "create_item") {
        assert.equal(card.compose, true, `${label(build, spend)}: the card must let the player name the item`);
        const bare = directCardCall(card.intent, build.hero.id, { inFight: true });
        const refused = await play(build.hero, bare.name, bare.args);
        assert.equal(refused.ok, false, `${label(build, spend)}: made an item nobody named`);
        assert.equal(world.sheet(build.hero.id).resources[spend.pool.id].used, 0, `${label(build, spend)}: the unnamed item spent the use`);
      }
      const call = directCardCall(intent, build.hero.id, { inFight: true });
      assert.ok(call, `${label(build, spend)}: the card makes no call`);
      const out = await play(build.hero, call.name, call.args);
      assert.equal(out.ok, true, `${label(build, spend)}: ${out.error}`);
      const pool = world.sheet(build.hero.id).resources[spend.pool.id];
      assert.ok(pool.used > 0, `${label(build, spend)}: nothing spent`);
      if (spend.does.kind === "create_item") {
        assert.ok(world.sheet(build.hero.id).equipment.some((item) => item.name === CREATED), `${label(build, spend)}: the named item is not in the pack`);
      }
      // "as a bonus action you can regain one spent die": the die is back,
      // not only the recovery's own use spent (it answered "1 die back" and
      // returned none).
      if (spend.name === "Psionic Recovery") {
        assert.equal(world.sheet(build.hero.id).resources.sub_psionic_energy.used, 0, `${label(build, spend)}: no Psionic Energy die came back`);
      }
      if (capstones.includes(spend.name)) {
        assert.ok(out.state.conditions.includes(spend.does.condition), `${label(build, spend)}: ${JSON.stringify(out.state.conditions)}`);
        played.push(spend.name);
      }
    }
  }
  assert.deepEqual([...played].sort(), [...capstones].sort());
});

await test("Arcane Jolt is played from its cards: the force card burns the creature, the healing card heals the ally, and neither costs the action.", async () => {
  const build = builds.find((entry) => entry.spends.some((spend) => spend.name === "Arcane Jolt"));
  assert.ok(build, "a Battle Smith");
  const ally = world.addHero({ user: world.owner, class: "fighter", subclass: "Champion", level: 5, abilities, maxHp: 60, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" } });
  for (const variant of ["burn", "heal"]) {
    const enemy = await stage(build.hero);
    kit.place(ally.id, 4, 5);
    world.patch(ally.id, { currentHp: 20 });
    const turn = { ...FRESH_TURN, actionUsed: true };
    const jolted = (played) => deriveHand(world.sheet(build.hero.id), played, {}).find((entry) => entry.intent.card === "feature" && entry.intent.resourceId === "Arcane Jolt" && entry.intent.variant === variant);
    assert.match(jolted(turn).disabled, /rides a weapon hit/, "shut before any hit");
    world.patch(build.hero.id, { equipment: [{ name: "Longsword +1", qty: 1, equipped: true }] });
    world.dice(18, 4);
    const struck = await world.invoke("pc_attack", { characterId: build.hero.id, targetEnemyId: enemy.id, weapon: "Longsword +1" });
    world.clearDice();
    assert.equal(struck.ok, true, struck.error);
    const card = jolted({ ...turn, marks: [`weapon-hit:${enemy.id}`] });
    assert.ok(card, variant);
    assert.equal(card.cost, "free", variant);
    assert.equal(card.disabled, null, `${variant}: ${card.disabled}`);
    assert.equal(card.target, variant === "burn" ? "enemy" : "ally");
    const intent = { ...card.intent, targetId: variant === "burn" ? enemy.id : ally.id, targetKind: variant === "burn" ? "enemy" : "ally" };
    const call = directCardCall(intent, build.hero.id, { inFight: true });
    assert.ok(call, `${variant}: the card makes no call`);
    const out = await play(build.hero, call.name, call.args);
    assert.equal(out.ok, true, `${variant}: ${out.error}`);
    assert.equal(world.sheet(build.hero.id).resources.art_arcane_jolt.used, 1);
    if (variant === "burn") assert.ok(world.enemies()[0].currentHp < 300, "the creature burns");
    else assert.ok(world.sheet(ally.id).currentHp > 20, "the ally heals");
  }
});

await test("Cauterizing Flames is played from its cards: the fire card burns the creature, the healing card heals the ally, and each takes the reaction.", async () => {
  const druid = world.addHero({ user: world.owner, class: "druid", subclass: "Circle of Wildfire", level: 10, abilities, maxHp: 60, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" } });
  const ally = world.addHero({ user: world.owner, class: "fighter", subclass: "Champion", level: 5, abilities, maxHp: 60, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" } });
  const offTurn = { ...FRESH_TURN, myTurn: false };
  const flames = (turn) => deriveHand(world.sheet(druid.id), turn, {}).filter((entry) => entry.intent.card === "reaction" && entry.intent.feature === "Cauterizing Flames");
  for (const [variant, target] of [["burn", "enemy"], ["heal", "ally"]]) {
    const enemy = await stage(druid);
    kit.place(ally.id, 4, 5);
    world.patch(ally.id, { currentHp: 20 });
    // Cauterizing Flames answers a creature standing in one of the druid's
    // spectral flames (src/lib/dm/cauterizing-flames.ts): one under each, as
    // two deaths there would leave them.
    const flamesAt = [kit.token(enemy.id), kit.token(ally.id)].map((token) => ({ x: token.x, y: token.y, untilRound: 99 }));
    const now = world.sheet(druid.id);
    world.patch(druid.id, { conditions: [...now.conditions.filter((entry) => entry !== "spectral flames"), "spectral flames"], conditionMeta: { ...now.conditionMeta, "spectral flames": { flames: flamesAt } } });
    assert.equal(flames(FRESH_TURN).length, 2, "a card for each aim");
    const card = flames(offTurn).find((entry) => entry.intent.variant === variant);
    assert.ok(card, variant);
    assert.equal(card.cost, "reaction", variant);
    assert.equal(card.disabled, null, `${variant}: ${card.disabled}`);
    assert.equal(card.target, target);
    assert.equal(card.name, variant === "burn" ? "Cauterizing Flames (fire)" : "Cauterizing Flames (healing)");
    assert.match(card.dice, variant === "burn" ? /^2d10\+3 fire$/ : /^heals 2d10\+3$/);
    assert.match(card.resource, /^Uses \d+\/\d+$/);
    // Nothing fixes the aim, even with the creature's hit open on the druid.
    const { reactionAim } = await import("../src/lib/battlemap/hand-react.ts");
    assert.equal(reactionAim(card, [{ characterId: druid.id, attackerId: enemy.id, attacker: "Goblin" }], druid.id, world.sheets()), null, variant);
    const intent = { ...card.intent, targetId: target === "enemy" ? enemy.id : ally.id, targetKind: target };
    const call = directCardCall(intent, druid.id, { inFight: true });
    assert.equal(call.name, "use_reaction");
    // Played off the druid's turn, as its trigger comes.
    kit.giveTurn(ally.id);
    const out = await play(druid, call.name, call.args);
    assert.equal(out.ok, true, `${variant}: ${out.error}`);
    assert.equal(world.sheet(druid.id).resources.sub_cauterizing_flames.used, 1);
    assert.ok(world.encounter().reactionsUsed.includes(druid.id), "the reaction is spent");
    if (variant === "burn") assert.ok(world.enemies()[0].currentHp < 300, "the creature burns");
    else assert.ok(world.sheet(ally.id).currentHp > 20, "the ally heals");
    assert.equal(flames({ ...FRESH_TURN, reactionUsed: true }).every((entry) => entry.disabled), true, "the reaction is gone");
  }
});

await test("use_reaction names the way a counted reaction with two ways goes, and asks when none is named.", async () => {
  const druid = world.sheets().find((sheet) => sheet.subclass === "Circle of Wildfire") ?? world.addHero({ user: world.owner, class: "druid", subclass: "Circle of Wildfire", level: 10, abilities, maxHp: 60, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" } });
  await stage(druid);
  const asked = await world.invoke("use_reaction", { characterId: druid.id, feature: "Cauterizing Flames" });
  assert.equal(asked.ok, false);
  assert.match(asked.error, /needs a variant: heal or burn/);
  assert.equal(world.sheet(druid.id).resources.sub_cauterizing_flames.used, 0, "the refusal costs nothing");
});

await test("An Artillerist holds one Eldritch Cannon counter, and the card and the spend use it.", () => {
  const build = builds.find((entry) => entry.subclass === "Artillerist");
  assert.ok(build, "an Artillerist");
  const sheet = world.sheet(build.hero.id);
  const cannons = Object.keys(sheet.resources).filter((id) => resourceDef(id)?.displayName === "Eldritch Cannon");
  assert.deepEqual(cannons, ["sub_eldritch_cannon"]);
  assert.equal(resourceDef("art_eldritch_cannon") ?? null, null);
});

await test("A capstone is dealt in its counter's place, among the feature cards, so a crowded fan keeps it.", () => {
  const capstones = ["Elder Champion", "Avenging Angel", "Invincible Conqueror", "Living Legend", "Mortal Bulwark", "Exalted Champion", "Dread Lord"];
  let checked = 0;
  for (const build of builds.filter((entry) => entry.classId === "paladin")) {
    const stale = world.sheet(build.hero.id);
    world.patch(build.hero.id, { resources: Object.fromEntries(Object.entries(stale.resources).map(([id, state]) => [id, { ...state, used: 0 }])) });
    const sheet = world.sheet(build.hero.id);
    const hand = deriveHand(sheet, FRESH_TURN, {});
    // Channel Divinity's options are dealt after the feature cards.
    const options = hand.findIndex((card) => card.id.startsWith("option:"));
    const { units } = groupHand(hand, sheet);
    // A fan of six: the weapon, the class's own features, the capstone.
    const { fan } = splitHand(units, 6);
    for (const spend of build.spends.filter((entry) => capstones.includes(entry.name))) {
      const at = hand.findIndex((card) => card.name === spend.name);
      assert.ok(options < 0 || at < options, `${label(build, spend)}: dealt at ${at}, after the options at ${options}`);
      assert.ok(fan.some((unit) => unit.name === spend.name), `${label(build, spend)}: behind More in ${JSON.stringify(fan.map((unit) => unit.name))}`);
      checked += 1;
    }
  }
  assert.ok(checked >= 5, String(checked));
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
