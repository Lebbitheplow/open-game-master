// Doors the engine answers by a feature's name had no card in the Hand, so a
// player typed the call or asked the GM: the pact weapon's creation (only
// use_resource "Pact of the Blade"), Alter Memories (kept out of the Hand
// because the card could not tell a charmed creature), Arcane Abeyance's
// bead, Master Scrivener's scroll, War Caster's spell, Telekinetic's shove and
// Mantle of Inspiration's stride. Each is dealt now, with the pick its door
// needs, and played the way the Hand sends it does what the feature says.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { FULL_CASTER_SLOTS, slotsOf } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-hand-feature-doors");
const world = await openWorld({ campaign: { maxPlayers: 20 } });
const kit = await combatKit(world);

const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { reactionCards } = await import("../src/lib/battlemap/hand-react.ts");
const { intentBody, seenChips, handReady } = await import("../src/lib/battlemap/hand-play.ts");
const { directCardCall, directCardCalls } = await import("../src/lib/dm/intent-logic.ts");
const { iconCandidates } = await import("../src/lib/icons.ts");
const { MANTLE_STRIDE } = await import("../src/lib/battlemap/hand-feature-doors.ts");

const abilities = { str: 16, dex: 16, con: 14, int: 18, wis: 14, cha: 18 };
const hero = (extra) =>
  world.addHero({
    user: world.owner, level: 14, abilities, maxHp: 200, proficiencies: TRAINED,
    portrait: { url: "/uploads/test.png" }, ...extra,
  });

async function stage(who) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [who.id]: 19 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  kit.place(who.id, 5, 5);
  kit.place(enemy.id, 5, 7);
  kit.giveTurn(who.id);
  const sheet = world.sheet(who.id);
  world.patch(who.id, {
    conditions: [], conditionMeta: {},
    resources: Object.fromEntries(Object.entries(sheet.resources).map(([id, state]) => [id, { ...state, used: 0 }])),
  });
  return enemy;
}

const cardsOf = (who) => deriveHand(world.sheet(who.id), FRESH_TURN, {});
const card = (who, name) => cardsOf(who).find((entry) => entry.name === name);

// The card played as the Hand sends it: the pick, the aim, the square.
async function play(who, dealt, { choice, aim, area, inFight = true } = {}) {
  const body = intentBody(dealt, aim ?? null, [], { ...(choice !== undefined ? { choice } : {}), ...(area ? { area } : {}) });
  const call = directCardCall({ ...body, ...(aim ? { targetId: aim.id, targetKind: aim.kind } : {}) }, who.id, { inFight });
  assert.ok(call, `${dealt.name}: the card makes no call`);
  return world.invoke(call.name, call.args);
}

const painted = (dealt) => assert.ok(iconCandidates(dealt.icon).length > 0, `${dealt.name} has no painting`);

const casting = (extra) => ({ ability: "int", slots: slotsOf(FULL_CASTER_SLOTS[13]), known: [], cantrips: ["Fire Bolt"], ...extra });

await test("Pact of the Blade: the card creates the weapon in the form picked, and a second card dismisses it.", async () => {
  const lock = hero({ class: "warlock", features: [{ name: "Pact Boon: Pact of the Blade", source: "choice", description: "" }] });
  await stage(lock);
  const dealt = card(lock, "Pact of the Blade");
  assert.ok(dealt, "no Pact of the Blade card");
  painted(dealt);
  assert.equal(dealt.disabled, null, dealt.disabled);
  assert.ok(dealt.choice.options.some((option) => option.label === "Rapier"));
  assert.ok(!dealt.choice.options.some((option) => option.label === "Longbow"), "a ranged form is offered");
  assert.ok(!dealt.choice.options.some((option) => option.label === "Vibroknife" || option.label === "Censer Mace"), "a genre kit's blade is offered as an SRD form");
  const out = await play(lock, dealt, { choice: "Rapier" });
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(lock.id).equipment.some((item) => item.name === "Pact Rapier"), JSON.stringify(world.sheet(lock.id).equipment));
  const dismiss = card(lock, "Pact of the Blade (dismiss)");
  assert.ok(dismiss, "no dismiss card with the weapon out");
  const gone = await play(lock, dismiss);
  assert.equal(gone.ok, true, gone.error);
  assert.ok(!world.sheet(lock.id).equipment.some((item) => item.name === "Pact Rapier"));
  assert.equal(card(lock, "Pact of the Blade (dismiss)"), undefined);
});

await test("Alter Memories: dealt aimed at the charmed alone, and played at one it strips the hours.", async () => {
  const wiz = hero({ class: "wizard", subclass: "School of Enchantment", spellcasting: casting({ prepared: ["Charm Person"], spellbook: ["Charm Person"] }) });
  const enemy = await stage(wiz);
  const dealt = card(wiz, "Alter Memories");
  assert.ok(dealt, "no Alter Memories card");
  painted(dealt);
  assert.equal(dealt.target, "enemy");
  const chips = [
    { id: enemy.id, name: "Charmed", kind: "enemy", conditions: ["charmed"] },
    { id: "other", name: "Free", kind: "enemy", conditions: [] },
  ];
  assert.deepEqual(seenChips(dealt, chips).map((chip) => chip.name), ["Charmed"]);
  assert.equal(handReady(dealt, chips[1]), false, "ready at a creature that is not charmed");
  kit.setEnemy(enemy.id, { conditions: ["charmed"] });
  world.dice(1);
  const out = await play(wiz, dealt, { aim: { id: enemy.id, name: enemy.displayName, kind: "enemy" } });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(world.enemies()[0].conditions.some((entry) => entry.startsWith("memory stripped")), JSON.stringify(world.enemies()[0].conditions));
});

await test("Arcane Abeyance: the card offers spells up to 4th level and casts the one picked into a bead.", async () => {
  const wiz = hero({ class: "wizard", subclass: "Chronurgy Magic", spellcasting: casting({ prepared: ["Magic Missile", "Fireball", "Cone of Cold"], spellbook: ["Magic Missile", "Fireball", "Cone of Cold"] }) });
  await stage(wiz);
  const dealt = card(wiz, "Arcane Abeyance");
  assert.ok(dealt, "no Arcane Abeyance card");
  painted(dealt);
  assert.equal(cardsOf(wiz).filter((entry) => entry.pool === "sub_arcane_abeyance").length, 1, "the counter's own card is dealt beside it");
  const offered = dealt.choice.options.map((option) => option.value);
  assert.ok(offered.includes("Fireball") && !offered.includes("Cone of Cold") && !offered.includes("Fire Bolt"), offered.join(", "));
  const out = await play(wiz, dealt, { choice: "Fireball" });
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(wiz.id).equipment.some((item) => /bead/i.test(item.name)), JSON.stringify(world.sheet(wiz.id).equipment.map((item) => item.name)));
  assert.equal(world.sheet(wiz.id).resources.sub_arcane_abeyance.used, 1);
});

await test("Master Scrivener: out of a fight the card writes a scroll of a spell from the book; in one it is shut.", async () => {
  const wiz = hero({ class: "wizard", subclass: "Order of Scribes", spellcasting: casting({ prepared: ["Magic Missile"], spellbook: ["Magic Missile", "Shield", "Fireball"] }) });
  await stage(wiz);
  const inFight = card(wiz, "Master Scrivener");
  assert.ok(inFight, "no Master Scrivener card");
  painted(inFight);
  const offered = inFight.choice.options.map((option) => option.value);
  assert.deepEqual(offered, ["Magic Missile"], "only a 1st or 2nd level book spell cast with an action");
  await kit.endFight();
  const turn = { ...FRESH_TURN, table: null };
  const dealt = deriveHand(world.sheet(wiz.id), turn, {}).find((entry) => entry.name === "Master Scrivener");
  assert.equal(dealt.disabled, null, dealt.disabled);
  const out = await play(wiz, dealt, { choice: "Magic Missile", inFight: false });
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(wiz.id).equipment.some((item) => /magic missile/i.test(item.name)), JSON.stringify(world.sheet(wiz.id).equipment.map((item) => item.name)));
  assert.equal(cardsOf(wiz).filter((entry) => entry.pool === "sub_master_scrivener").length, 1);
});

await test("War Caster: the card offers the one-action, one-creature spells and sets the one picked.", async () => {
  const caster = hero({ class: "wizard", feats: ["War Caster"], spellcasting: casting({ prepared: ["Magic Missile", "Fireball", "Hold Person"], spellbook: ["Magic Missile", "Fireball", "Hold Person"] }) });
  await stage(caster);
  const dealt = card(caster, "War Caster");
  assert.ok(dealt, "no War Caster card");
  painted(dealt);
  const offered = dealt.choice.options.map((option) => option.value);
  assert.ok(offered.includes("Fire Bolt") && offered.includes("weapon") && !offered.includes("Fireball"), offered.join(", "));
  const out = await play(caster, dealt, { choice: "Fire Bolt" });
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(caster.id).conditions.includes("opportunity spell (Fire Bolt)"));
  assert.equal(card(caster, "War Caster").dice, "Opportunity: Fire Bolt");
});

await test("Telekinetic: the card at a foe rolls its Strength save and shoves it on a failure.", async () => {
  const mind = hero({ class: "fighter", feats: ["Telekinetic"] });
  const enemy = await stage(mind);
  const dealt = card(mind, "Telekinetic");
  assert.ok(dealt, "no Telekinetic card");
  painted(dealt);
  assert.equal(dealt.cost, "bonus");
  assert.ok(card(mind, "Telekinetic (ally)").othersOnly);
  world.dice(1);
  const out = await play(mind, dealt, { aim: { id: enemy.id, name: enemy.displayName, kind: "enemy" } });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.saved, false, JSON.stringify(out));
  assert.equal(out.result.moved, true);
});

await test("Mantle of Inspiration: a creature the mantle marked is dealt the stride, and its square moves it.", async () => {
  const ally = hero({ class: "fighter" });
  await stage(ally);
  world.patch(ally.id, { conditions: [MANTLE_STRIDE], conditionMeta: { [MANTLE_STRIDE]: { source: "bard", turnBegun: true } } });
  const sheet = world.sheet(ally.id);
  const turn = { ...FRESH_TURN, myTurn: false };
  const dealt = reactionCards(sheet, turn, [], []).find((entry) => entry.name === "Mantle of Inspiration (move)");
  assert.ok(dealt, "no stride card");
  painted(dealt);
  assert.equal(dealt.area.move, true);
  assert.equal(handReady(dealt, null, {}), false, "ready with no square");
  const out = await play(ally, dealt, { area: { at: { x: 5, y: 2 } } });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).conditions.includes(MANTLE_STRIDE), false);
  assert.equal(reactionCards(world.sheet(ally.id), turn, [], []).some((entry) => entry.name === "Mantle of Inspiration (move)"), false);
});

// Infectious Fury's attack: "it must use its reaction to make a melee attack
// against another creature of your choice". The card had one pick (the
// variant) and no way to name that creature, so the engine left the attack
// to a line for the GM. The attack is its own card now, aimed at the cursed
// creature with the one it strikes as a second creature it waits for.
await test("Infectious Fury: the attack card takes the creature struck as a second pick and sends both.", async () => {
  const beast = hero({ class: "barbarian", subclass: "Path of the Beast" });
  await stage(beast);
  const attack = card(beast, "Infectious Fury (Attack)");
  assert.ok(attack, `no attack card: ${cardsOf(beast).filter((entry) => entry.name.startsWith("Infectious")).map((entry) => entry.name).join(", ")}`);
  assert.ok(card(beast, "Infectious Fury (Damage)"), "the damage card is gone");
  assert.equal(attack.shares?.min, 2);
  assert.equal(attack.shares?.attacks, true, "the second pick is asked as the creature it attacks, not one more target");
  assert.equal(card(beast, "Infectious Fury (Damage)").shares, undefined);
  const cursed = { id: "cursed", name: "Goblin 1", kind: "enemy" };
  assert.equal(handReady({ ...attack, disabled: null }, cursed, {}), false, "ready with no creature to strike");
  const choices = { shares: [{ id: "victim", name: "Goblin 2", count: 1 }] };
  assert.equal(handReady({ ...attack, disabled: null }, cursed, choices), true);
  const body = intentBody(attack, cursed, [], choices);
  const calls = directCardCalls({ ...body, targetId: cursed.id, targetKind: "enemy" }, beast.id, { inFight: true });
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].args.variant, calls[0].args.targetEnemyId, calls[0].args.targetEnemyIds], ["attack", "cursed", ["cursed", "victim"]]);
  // The aim bar and the board's menu ask handReady with the shares picked: read
  // without them, the attack card's button never lit in the browser.
  const fs = await import("node:fs");
  for (const file of ["HandAimBar.tsx", "Hand.tsx"]) {
    const source = fs.readFileSync(new URL(`../src/app/campaigns/[campaignId]/${file}`, import.meta.url), "utf8");
    const asks = source.match(/handReady\((?:card|picked), aim, \{ trigger[^\n]*/g) ?? [];
    assert.ok(asks.length > 0 && asks.every((call) => /\bshares\b/.test(call)), `${file} asks handReady without the shares: ${asks.join(" | ")}`);
  }
});

// Release Tale's card was always aimed at a foe, so a tale that heals sent the
// goblin as the creature healed and the engine refused it (seen in the browser).
await test("Release Tale: the card is aimed at a friend for a tale that heals and at a foe for any other.", async () => {
  const bard = hero({ class: "bard", subclass: "College of Spirits" });
  await stage(bard);
  world.patch(bard.id, { conditions: ["spirit tale"], conditionMeta: { "spirit tale": { untilRestEnds: true, tale: 3 } } });
  assert.equal(card(bard, "Release Tale").target, "ally", "The Healer's Last Song is told at a friend");
  world.patch(bard.id, { conditions: ["spirit tale"], conditionMeta: { "spirit tale": { untilRestEnds: true, tale: 1 } } });
  assert.equal(card(bard, "Release Tale").target, "enemy", "The Burned Bridge is told at a foe");
});

finish();
