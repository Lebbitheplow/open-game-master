// The same attack on the server's dice and on dice entered at the table leaves
// the same world. Both paths run one set of stages (src/lib/dm/attack-swing.ts,
// attack-blow.ts) on one record (attack-record.ts); each test here is a rule
// that once lived only on the server's dice, run both ways with the same faces.
//
// Real dice enter the faces the player threw: the to-hit roll, then the damage
// roll the hit asks for. A save the server rolls for the creature (a maneuver's,
// Stunning Strike's) is forced the same way on both paths.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-real-dice-parity");
const world = await openWorld({ campaign: { maxPlayers: 16 }, gameSettings: { dicePolicy: "real_allowed" } });
const kit = await combatKit(world);
const { setMemberHoldRolls, setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { getPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");
const { entryDice } = await import("../src/lib/dice.ts");

const fighter = (feats, equipment, abilities = { str: 16, dex: 16 }) =>
  world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities, proficiencies: TRAINED, equipment, feats });

const piercer = fighter(["Piercer"], [{ name: "Rapier", qty: 1 }]);
const brutal = fighter(["Brutal Attack"], [{ name: "Greatsword", qty: 1 }]);
const savage = fighter(["Savage Attacker"], [{ name: "Longsword", qty: 1 }]);
const slasher = fighter(["Slasher"], [{ name: "Greatsword", qty: 1 }]);
const crusher = fighter(["Crusher"], [{ name: "Warhammer", qty: 1 }]);
const sniper = fighter(["Stunning Sniper"], [{ name: "Longbow", qty: 1 }, { name: "Arrows", qty: 20 }]);
const netter = fighter([], [{ name: "Net", qty: 2 }]);
const master = world.addHero({ class: "fighter", subclass: "battle_master", level: 5, maxHp: 44, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1 }] });
const MASTER_FEATURES = [
  ...world.sheet(master.id).features.filter((feature) => !["Combat Superiority", "Maneuvers"].includes(feature.name)),
  { name: "Combat Superiority", source: "subclass" },
  { name: "Maneuver: Trip Attack", source: "choice" },
];
const mage = world.addHero({
  class: "wizard", level: 9, maxHp: 44, abilities: { int: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: [], cantrips: ["Fire Bolt"] },
  feats: ["Elemental Adept"],
});
world.patch(mage.id, { features: [...world.sheet(mage.id).features, { name: "Elemental Adept: fire", source: "story" }] });
const fiend = world.addHero({
  class: "warlock", subclass: "The Fiend", level: 10, maxHp: 44, abilities: { cha: 16, dex: 14 }, proficiencies: TRAINED,
  equipment: [{ name: "Dagger", qty: 1, equipped: true }],
});
world.patch(fiend.id, { features: [...world.sheet(fiend.id).features, { name: "Dark One's Blessing", source: "class", classId: "warlock" }] });
const keen = fighter(["Piercer", "Savage Attacker"], [{ name: "Rapier", qty: 1 }]);
const heroes = [piercer, brutal, savage, slasher, crusher, sniper, netter, master, mage, fiend, keen];
// Who shoots from where a shot is not at disadvantage.
const standsBack = new Set([sniper.id, mage.id]);

async function stage(hero, setEnemy = () => ({})) {
  await kit.endFight();
  for (const entry of heroes) {
    world.patch(entry.id, { currentHp: 44, conditions: [], tempHp: 0 });
  }
  world.patch(master.id, { features: MASTER_FEATURES, resources: { ...world.sheet(master.id).resources, sub_superiority_dice: { max: 4, used: 0 } } });
  await kit.fight(1, { heroFaces: Object.fromEntries(heroes.map((entry) => [entry.id, entry.id === hero.id ? 19 : 2])) });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400, ...setEnemy(kit.enemy(enemy.id)) });
  kit.place(hero.id, 5, 5);
  // A shot from beside the creature is at disadvantage; the archer stands back.
  kit.place(enemy.id, 5, standsBack.has(hero.id) ? 8 : 6);
  assert.equal(kit.current().characterId, hero.id);
  return enemy;
}

const d8s = (expression) => [...expression.matchAll(/(\d+)d8/g)].reduce((sum, match) => sum + Number(match[1]), 0);
// Each path stages its own creature, so the weapon-hit mark a hit leaves on the
// creature it struck (weapon-hit:<id>, read by the reactions that answer a
// weapon hit) names a different id on each path: it reads as "the target" here,
// and any mark naming some other creature keeps its id and fails the compare.
const marks = (enemy) => [...(world.encounter()?.turnBudget?.oncePerTurn ?? [])]
  .map((mark) => (mark === `weapon-hit:${enemy.id}` ? "weapon-hit:target" : mark))
  .sort();

async function answer(hero, kind, faces) {
  const pending = listOpenPendingRolls(world.campaignId).filter((entry) => entry.kind === kind && entry.userId === hero.userId).at(-1);
  assert.ok(pending, `no ${kind} roll is parked`);
  world.signIn({ id: hero.userId });
  const out = await call(submitRoute, "POST", { dice: faces }, { campaignId: world.campaignId, pendingRollId: pending.id });
  assert.equal(out.status, 200, `${JSON.stringify(out.json)} for ${pending.expression}`);
  return { note: getPendingRoll(pending.id).combatNote ?? "", expression: pending.expression };
}

// One attack, both ways. `toHit` and `damage` are the faces on the dice;
// `after` is what the server throws for the creature once the blow lands.
// Returns what each path left: the creature, the turn's marks, the notes.
async function both(hero, { toHit, damage = [], after = [], args = {}, serverDamage = damage, setEnemy }) {
  const out = {};
  for (const real of [false, true]) {
    const enemy = await stage(hero, setEnemy);
    if (!real) {
      const swing = await kit.swing(hero.id, enemy.id, [toHit, ...serverDamage, ...after].flat(), args);
      assert.equal(swing.ok, true, swing.error);
      const said = JSON.stringify(swing.result);
      out.server = { enemy: kit.enemy(enemy.id), marks: marks(enemy), said, result: swing.result, tempHp: world.sheet(hero.id).tempHp };
      continue;
    }
    setMemberRealDice(world.campaignId, hero.userId, true);
    try {
      const parked = await world.invoke("pc_attack", { characterId: hero.id, targetEnemyId: enemy.id, ...args });
      assert.equal(parked.ok, true, parked.error);
      const hit = await answer(hero, "attack", [toHit].flat());
      const asked = listOpenPendingRolls(world.campaignId).some((entry) => entry.kind === "damage");
      world.clearDice();
      world.dice(...after);
      const blow = asked ? await answer(hero, "damage", damage) : { note: "", expression: null };
      world.clearDice();
      out.table = { enemy: kit.enemy(enemy.id), marks: marks(enemy), said: `${hit.note} ${blow.note}`, hitNote: hit.note, damageExpression: blow.expression, tempHp: world.sheet(hero.id).tempHp };
    } finally {
      setMemberRealDice(world.campaignId, hero.userId, false);
    }
  }
  return out;
}

const same = (out, read, label) => assert.deepEqual(read(out.table), read(out.server), `${label}: server ${JSON.stringify(read(out.server))}, table ${JSON.stringify(read(out.table))}`);
const hp = (side) => side.enemy.currentHp;
const conditions = (side) => [...side.enemy.conditions].sort();

await test("Piercer: a piercing critical rolls one more of the weapon's dice on real dice too, and the reroll is spent once a turn", async () => {
  // Server: d20, three d8s, then Piercer's reroll of the lowest. Table: the
  // player rerolled their 1 to a 6 and enters what they kept.
  const out = await both(piercer, { toHit: 20, damage: [6, 8, 8], serverDamage: [1, 8, 8, 6], args: { weapon: "Rapier" } });
  assert.equal(d8s(out.table.damageExpression), 3, out.table.damageExpression);
  assert.match(out.table.hitNote, /Piercer/, out.table.hitNote);
  same(out, hp, "the creature's hit points");
  same(out, (side) => side.marks, "the turn's marks");
  assert.equal(hp(out.server), 400 - (6 + 8 + 8 + abilityMod(16)));
});

await test("Brutal Attack: real dice are told to roll the damage twice, and the once-a-turn use is spent on both paths", async () => {
  const out = await both(brutal, { toHit: 15, damage: [6, 6], serverDamage: [1, 1, 6, 6], args: { weapon: "Greatsword" } });
  assert.match(out.table.hitNote, /Brutal Attack/, out.table.hitNote);
  same(out, hp, "the creature's hit points");
  same(out, (side) => side.marks, "the turn's marks");
  assert.ok(out.table.marks.includes("brutal attack:used"));
});

await test("Savage Attacker is spent by a hit, not by an attack that misses, on both paths", async () => {
  const out = await both(savage, { toHit: 2, args: { weapon: "Longsword" } });
  same(out, (side) => side.marks.includes("savage attacker:used"), "Savage Attacker after a miss");
  assert.equal(out.table.marks.includes("savage attacker:used"), false);
});

// The damage roll's reason is the line the player's roll card shows under its
// title (PendingRollCard.tsx). Only the model's note said how the feats change
// the dice, so a player whose GM did not pass it on entered dice the spent
// feats never touched.
async function parkedDamageReason(hero, weapon, { hold = false } = {}) {
  const enemy = await stage(hero);
  if (hold) {
    setMemberHoldRolls(world.campaignId, hero.userId, true);
  } else {
    setMemberRealDice(world.campaignId, hero.userId, true);
  }
  try {
    const parked = await world.invoke("pc_attack", { characterId: hero.id, targetEnemyId: enemy.id, weapon });
    assert.equal(parked.ok, true, parked.error);
    const toHit = listOpenPendingRolls(world.campaignId).filter((entry) => entry.kind === "attack" && entry.userId === hero.userId).at(-1);
    assert.ok(toHit, "no attack roll is parked");
    world.signIn({ id: hero.userId });
    // A held roll is released whole and thrown by the server: a 15 hits.
    world.clearDice();
    world.dice(15);
    const out = await call(submitRoute, "POST", hold ? { fallback: "digital" } : { dice: [15] }, { campaignId: world.campaignId, pendingRollId: toHit.id });
    world.clearDice();
    assert.equal(out.status, 200, JSON.stringify(out.json));
    const damage = listOpenPendingRolls(world.campaignId).filter((entry) => entry.kind === "damage" && entry.userId === hero.userId).at(-1);
    assert.ok(damage, `no damage roll is parked: ${getPendingRoll(toHit.id).combatNote}`);
    // Landed, so the next test finds no damage roll left waiting.
    const landed = await call(submitRoute, "POST", { fallback: "digital" }, { campaignId: world.campaignId, pendingRollId: damage.id });
    assert.equal(landed.status, 200, JSON.stringify(landed.json));
    return damage.reason;
  } finally {
    setMemberRealDice(world.campaignId, hero.userId, false);
    setMemberHoldRolls(world.campaignId, hero.userId, false);
  }
}

await test("The damage roll card tells a real-dice player to roll twice for Savage Attacker and reroll a die for Piercer", async () => {
  const reason = await parkedDamageReason(keen, "Rapier");
  assert.match(reason, /^Rapier damage against .+\. Before you enter your dice: /, reason);
  assert.match(reason, /roll the weapon's dice a second time and keep the better total \(Savage Attacker\), then reroll the lowest damage die once and keep the new roll \(Piercer\)\.$/, reason);
  // Without a feat that changes the dice the card says only what the roll is for.
  const plain = await parkedDamageReason(master, "Longsword");
  assert.doesNotMatch(plain, /Before you enter/, plain);
  // A held roll is thrown by the server, so there are no dice to reroll.
  const held = await parkedDamageReason(keen, "Rapier", { hold: true });
  assert.doesNotMatch(held, /Before you enter/, held);
});

await test("Stunning Sniper: a critical shot on real dice asks for undoubled damage and stuns the creature", async () => {
  const out = await both(sniper, { toHit: 20, damage: [5], args: { weapon: "Longbow", stunShot: true } });
  assert.equal(d8s(out.table.damageExpression), 1, out.table.damageExpression);
  same(out, hp, "the creature's hit points");
  same(out, conditions, "the creature's conditions");
  assert.ok(conditions(out.table).includes("stunned"), JSON.stringify(conditions(out.table)));
});

await test("Slasher: a slashing hit on real dice slows the creature, once a turn, and a critical shakes it", async () => {
  const hit = await both(slasher, { toHit: 15, damage: [3, 3], args: { weapon: "Greatsword" } });
  same(hit, conditions, "the creature's conditions");
  same(hit, (side) => side.marks, "the turn's marks");
  assert.ok(conditions(hit.table).includes("hamstrung"));
  const crit = await both(slasher, { toHit: 20, damage: [3, 3, 3, 3], args: { weapon: "Greatsword" } });
  same(crit, conditions, "the creature's conditions on a critical");
  assert.ok(conditions(crit.table).includes("shaken"));
});

await test("Crusher: a bludgeoning hit on real dice moves the creature 5 feet once a turn, and a critical exposes it", async () => {
  const out = await both(crusher, { toHit: 20, damage: [4, 4], args: { weapon: "Warhammer" } });
  same(out, conditions, "the creature's conditions");
  same(out, (side) => side.marks, "the turn's marks");
  assert.ok(out.table.marks.includes("crusher:used"));
  assert.match(out.table.said, /Crusher: .* moved 5 feet|Crusher: .* could not be moved/, out.table.said);
});

await test("A Battle Master's Trip Attack on real dice spends the die, adds it, and the creature saves or falls prone", async () => {
  // d20, the longsword's d8, the Superiority Die; then the creature's STR save, a 1.
  const out = await both(master, { toHit: 15, damage: [4, 5], after: [1], args: { weapon: "Longsword", maneuver: "Trip Attack" } });
  same(out, hp, "the creature's hit points");
  same(out, conditions, "the creature's conditions");
  assert.ok(conditions(out.table).includes("prone"), out.table.said);
  assert.match(out.table.said, /Trip Attack: .* fails the STR save/, out.table.said);
});

await test("A net on real dice restrains the creature and asks for no damage roll", async () => {
  // A net is thrown at disadvantage within 5 feet of the creature, and its
  // normal range is 5 feet: both dice are entered.
  const out = await both(netter, { toHit: [18, 18], args: { weapon: "Net" } });
  assert.equal(out.table.damageExpression, null, "no damage roll was parked");
  same(out, hp, "the creature's hit points");
  same(out, conditions, "the creature's conditions");
  assert.ok(conditions(out.table).includes("restrained"));
});

await test("The turn remembers a real-dice swing as it remembers the server's", async () => {
  for (const real of [false, true]) {
    const enemy = await stage(savage);
    if (real) {
      setMemberRealDice(world.campaignId, savage.userId, true);
      await world.invoke("pc_attack", { characterId: savage.id, targetEnemyId: enemy.id, weapon: "Longsword" });
      await answer(savage, "attack", [3]);
      setMemberRealDice(world.campaignId, savage.userId, false);
    } else {
      await kit.swing(savage.id, enemy.id, [3], { weapon: "Longsword" });
    }
    const struck = world.encounter().turnBudget.struck ?? [];
    assert.equal(struck.length, 1, `${real ? "real" : "server"} dice: ${JSON.stringify(struck)}`);
    assert.equal(struck[0].hit, false);
  }
});

await test("Elemental Adept's fire passes a creature's fire resistance on real dice too", async () => {
  const resistsFire = (enemy) => ({ stats: { ...enemy.stats, resist: "fire" } });
  // Fire Bolt's 2d10 for a 9th-level caster.
  const out = await both(mage, { toHit: 18, damage: [5, 5], args: { spell: "Fire Bolt" }, setEnemy: resistsFire });
  same(out, hp, "the creature's hit points");
  assert.equal(hp(out.table), 400 - 10, out.table.said);
});

await test("Dark One's Blessing: a kill on real dice gives the Fiend warlock temporary hit points", async () => {
  const lastBreath = () => ({ currentHp: 1, maxHp: 1 });
  const out = await both(fiend, { toHit: 15, damage: [3], args: { weapon: "Dagger" }, setEnemy: lastBreath });
  same(out, (side) => side.tempHp, "the warlock's temporary hit points");
  assert.equal(out.table.tempHp, abilityMod(16) + 10, out.table.said);
});

await test("Mote of Potential: a saving throw entered on real dice gives the bard's temporary hit points, as the server's throw does", async () => {
  const bard = world.addHero({ class: "bard", subclass: "College of Creation", level: 3, abilities: { cha: 16 } });
  await kit.endFight();
  for (const real of [false, true]) {
    world.patch(savage.id, { tempHp: 0, conditions: [], conditionMeta: {} });
    const given = await world.invoke("use_resource", { characterId: bard.id, resource: "Bardic Inspiration", targetCharacterId: savage.id });
    assert.equal(given.ok, true, given.error);
    if (real) {
      setMemberRealDice(world.campaignId, savage.userId, true);
      try {
        await world.invoke("request_roll", { characterId: savage.id, kind: "saving_throw", ability: "con", dc: 10, reason: "poison" });
        await answer(savage, "saving_throw", [10, 4]);
      } finally {
        setMemberRealDice(world.campaignId, savage.userId, false);
      }
    } else {
      world.clearDice();
      world.dice(10, 4);
      await world.invoke("request_roll", { characterId: savage.id, kind: "saving_throw", ability: "con", dc: 10, reason: "poison" });
      world.clearDice();
    }
    assert.equal(world.sheet(savage.id).tempHp, 4 + abilityMod(16), `${real ? "real" : "server"} dice`);
  }
});

// Dice the server throws for a parked damage roll (the lead's "Roll
// digitally", every face set to the server, a held roll released) take the
// feats the hit already spent, as its own throw of the damage does
// (attack-blow.ts throwDamage). They were thrown plain, so Piercer, Brutal
// Attack, Savage Attacker and Great Weapon Fighting were spent for nothing.
async function serverThrownDamage(hero, weapon, body, faces, { hold = false } = {}) {
  const enemy = await stage(hero);
  (hold ? setMemberHoldRolls : setMemberRealDice)(world.campaignId, hero.userId, true);
  try {
    const parked = await world.invoke("pc_attack", { characterId: hero.id, targetEnemyId: enemy.id, weapon });
    assert.equal(parked.ok, true, parked.error);
    const toHit = listOpenPendingRolls(world.campaignId).filter((entry) => entry.kind === "attack" && entry.userId === hero.userId).at(-1);
    world.signIn({ id: hero.userId });
    world.clearDice();
    world.dice(15);
    const hit = await call(submitRoute, "POST", hold ? { fallback: "digital" } : { dice: [15] }, { campaignId: world.campaignId, pendingRollId: toHit.id });
    assert.equal(hit.status, 200, JSON.stringify(hit.json));
    const damage = listOpenPendingRolls(world.campaignId).filter((entry) => entry.kind === "damage" && entry.userId === hero.userId).at(-1);
    assert.ok(damage, `no damage roll is parked: ${getPendingRoll(toHit.id).combatNote}`);
    world.clearDice();
    world.dice(...faces);
    const landed = await call(submitRoute, "POST", body, { campaignId: world.campaignId, pendingRollId: damage.id });
    world.clearDice();
    assert.equal(landed.status, 200, JSON.stringify(landed.json));
    return 400 - kit.enemy(enemy.id).currentHp;
  } finally {
    setMemberRealDice(world.campaignId, hero.userId, false);
    setMemberHoldRolls(world.campaignId, hero.userId, false);
  }
}

await test("A parked damage roll the server throws still takes the Piercer and Brutal Attack the hit spent", async () => {
  // Rapier 1d8+3: a 1, and Piercer's reroll of it to a 6.
  assert.equal(await serverThrownDamage(piercer, "Rapier", { fallback: "digital" }, [1, 6]), 6 + abilityMod(16), "Roll digitally");
  assert.equal(await serverThrownDamage(piercer, "Rapier", { dice: ["digital"] }, [1, 6]), 6 + abilityMod(16), "every face set to the server");
  // Greatsword 2d6+3 released by a player who holds their rolls: 1 and 1,
  // then Brutal Attack's second roll of 6 and 6.
  assert.equal(await serverThrownDamage(brutal, "Greatsword", { fallback: "digital" }, [1, 1, 6, 6], { hold: true }), 12 + abilityMod(16), "a held roll released");
});

// SRD 5.1, Halfling Lucky: a natural 1 on an attack roll, ability check or
// saving throw is rolled again, and the new roll must be used. Its "r1" made
// the card ask for a d20 per possible reroll, and the route then refused the
// faces: a halfling on real dice could not answer a roll that came up 1, nor
// (on the card) one that did not.
await test("A halfling on real dice enters one d20 for an attack and a save, and a 1 kept after Lucky's reroll stays a 1", async () => {
  const before = world.sheet(piercer.id).features;
  world.patch(piercer.id, { features: [...before, { name: "Lucky (reroll nat 1 on d20)", source: "race" }] });
  try {
    const enemy = await stage(piercer);
    setMemberRealDice(world.campaignId, piercer.userId, true);
    try {
      const parked = await world.invoke("pc_attack", { characterId: piercer.id, targetEnemyId: enemy.id, weapon: "Rapier" });
      assert.equal(parked.ok, true, parked.error);
      const toHit = listOpenPendingRolls(world.campaignId).filter((entry) => entry.kind === "attack").at(-1);
      assert.match(toHit.expression, /^1d20r1/, toHit.expression);
      assert.deepEqual(entryDice(toHit.expression), [20], "the card asks for one d20");
      const missed = await answer(piercer, "attack", [1]);
      assert.match(missed.note, /MISS \(natural 1\)/, missed.note);
      await kit.endFight();
      await world.invoke("request_roll", { characterId: piercer.id, kind: "saving_throw", ability: "dex", dc: 10, reason: "a falling beam" });
      const save = listOpenPendingRolls(world.campaignId).filter((entry) => entry.kind === "saving_throw").at(-1);
      assert.deepEqual(entryDice(save.expression), [20], save.expression);
      await answer(piercer, "saving_throw", [14]);
    } finally {
      setMemberRealDice(world.campaignId, piercer.userId, false);
    }
  } finally {
    world.patch(piercer.id, { features: before });
  }
});

finish();
