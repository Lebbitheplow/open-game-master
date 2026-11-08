// A feature whose engine asks which variant had no pick on its card: Spirit
// Totem's face said "Bear" and its sentence named nothing, so the engine refused
// the card and the GM was left to guess. Each card now offers its variants, and
// each one, played as the Hand sends it, lands the condition it names.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-hand-feature-picks");
const world = await openWorld({ campaign: { maxPlayers: 20 } });
const kit = await combatKit(world);

const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { composeSentence, intentBody } = await import("../src/lib/battlemap/hand-play.ts");
const { directCardCall } = await import("../src/lib/dm/intent-logic.ts");

const abilities = { str: 16, dex: 16, con: 14, int: 16, wis: 16, cha: 16 };
const hero = (classId, subclass) =>
  world.addHero({
    user: world.owner, class: classId, subclass, level: 20, abilities, maxHp: 200, proficiencies: TRAINED,
    portrait: { url: "/uploads/test.png" }, equipment: [{ name: "Longsword", qty: 1, equipped: true }],
  });

async function stage(who) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [who.id]: 19 } });
  const [enemy] = world.enemies();
  kit.place(who.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.giveTurn(who.id);
  const sheet = world.sheet(who.id);
  world.patch(who.id, {
    conditions: [], conditionMeta: {},
    resources: Object.fromEntries(Object.entries(sheet.resources).map(([id, state]) => [id, { ...state, used: 0 }])),
  });
}

const card = (who, name) => deriveHand(world.sheet(who.id), FRESH_TURN, {}).find((entry) => entry.name === name);

// The card, its picks by label, and the condition each one lands.
const CARDS = [
  ["druid", "Circle of the Shepherd", "Spirit Totem", { Bear: "spirit totem: bear", Hawk: "spirit totem: hawk", Unicorn: "spirit totem: unicorn" }],
  ["druid", "Circle of Stars", "Starry Form", { Archer: "starry form: archer", Chalice: "starry form: chalice", Dragon: "starry form: dragon" }],
  ["monk", "Way of the Ascendant Dragon", "Aspect of the Wyrm", { Frighten: "aspect of the wyrm: frighten", Ward: "aspect of the wyrm: ward" }],
  ["monk", "Way of the Drunken Master", "Drunkard's Luck", { Attack: "drunkard's luck (attack)", Check: "drunkard's luck (check)", Save: "drunkard's luck (save)" }],
  ["sorcerer", "Wild Magic", "Tides of Chaos", { Attack: "tides of chaos (attack)", Check: "tides of chaos (check)", Save: "tides of chaos (save)" }],
  ["wizard", "Graviturgy Magic", "Adjust Density", { Lighter: "adjusted density (lighter)", Heavier: "adjusted density (heavier)" }],
];

for (const [classId, subclass, name, picks] of CARDS) {
  const who = hero(classId, subclass);
  await test(`${name} offers each variant once, names none on its face, and the pick lands.`, async () => {
    const dealt = card(who, name);
    assert.deepEqual(dealt.choice.options.map((option) => option.label), Object.keys(picks));
    assert.equal(dealt.dice, "");
    assert.equal(dealt.condition, "");
    for (const option of dealt.choice.options) {
      await stage(who);
      const choices = { choice: option.value };
      const aim = dealt.target === "ally" ? { kind: "ally", id: who.id, name: "Hero" } : null;
      assert.match(composeSentence(dealt, aim, [], choices), new RegExp(`\\(${option.label}\\)`));
      const body = intentBody(dealt, aim, [], choices);
      const call = directCardCall(
        { ...body, ...(aim ? { targetId: who.id, targetKind: "ally" } : {}) },
        who.id,
        { inFight: true },
      );
      assert.ok(call, `${name} ${option.label}: the card makes no call`);
      const out = await world.invoke(call.name, call.args);
      assert.equal(out.ok, true, `${name} ${option.label}: ${out.error}`);
      assert.ok(
        world.sheet(who.id).conditions.includes(picks[option.label]),
        `${name} ${option.label}: ${JSON.stringify(world.sheet(who.id).conditions)}`,
      );
    }
  });
}

await test("A buff for an ally lands on the ally, or on the holder aimed at themselves.", async () => {
  const wizard = hero("wizard", "Graviturgy Magic");
  const friend = hero("fighter", "Champion");
  for (const [target, holds] of [[friend, friend], [wizard, wizard]]) {
    await stage(wizard);
    world.patch(friend.id, { conditions: [], conditionMeta: {} });
    const out = await world.invoke("use_resource", { characterId: wizard.id, resource: "Adjust Density", variant: "heavier", targetCharacterId: target.id });
    assert.equal(out.ok, true, out.error);
    assert.ok(world.sheet(holds.id).conditions.includes("adjusted density (heavier)"), target === friend ? "the ally" : "the holder");
  }
});

await test("Blessing of the Trickster goes to a creature other than the cleric: the holder, named or not, is refused.", async () => {
  const cleric = hero("cleric", "Trickery Domain");
  const friend = hero("fighter", "Champion");
  const dealt = card(cleric, "Blessing of the Trickster");
  assert.equal(dealt.othersOnly, true, "the Hand leaves out the cleric's own chip");
  for (const aim of [{ targetCharacterId: cleric.id }, {}]) {
    await stage(cleric);
    const out = await world.invoke("use_resource", { characterId: cleric.id, resource: "Blessing of the Trickster", ...aim });
    assert.ok(out.error, `aimed ${JSON.stringify(aim)}: it landed on the cleric`);
    assert.ok(!world.sheet(cleric.id).conditions.includes("blessing of the trickster"));
  }
  await stage(cleric);
  world.patch(friend.id, { conditions: [], conditionMeta: {} });
  const out = await world.invoke("use_resource", { characterId: cleric.id, resource: "Blessing of the Trickster", targetCharacterId: friend.id });
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(friend.id).conditions.includes("blessing of the trickster"));
});

await test("Revelation in Flesh, spent by amount, still leaves the blank and names its pick.", () => {
  const who = hero("sorcerer", "Aberrant Mind");
  const dealt = card(who, "Revelation in Flesh");
  assert.deepEqual(dealt.choice.options.map((option) => option.label), ["Fly", "Swim", "See", "Squeeze"]);
  assert.equal(composeSentence(dealt, null, [], { choice: "swim" }), "I use Revelation in Flesh (Swim) for  points.");
});

world.close();
finish();
