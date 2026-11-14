// The steampunk classes' features that ride a weapon attack (WAVE2 D5: the
// genre text is the rule), fifth round: a die on the attack roll, one more
// attack of the Attack action, what a critical hit leaves on its target, a
// spend that is free once a turn and one that takes a disarm back
// (src/lib/srd/genre-b-steampunk-attacks.ts and the modules it names). Each
// case fails without its mechanism; the clause ledger
// (scripts/clauses/genre-steampunk.json) points here for the clauses it holds.
//
// Dice forced; every check reads a stored roll, a condition, the turn's
// budget, a counter, the pack or a card of the Hand.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";

const SRC = new URL("../src/", import.meta.url);
const { deriveHand, FRESH_TURN } = await import(new URL("lib/battlemap/hand.ts", SRC).href);
const { hudGates } = await import(new URL("lib/battlemap/hand-hud.ts", SRC).href);

const { test, finish } = suite("test-genre-b-steampunk-attacks");
const rig = await clausesRig();
const { world, kit } = rig;
const feature = (classId, name, level) => ({ classId, name, level, key: `${classId}::${name}` });
const run = async (name, body) => {
  try {
    await test(name, body);
  } finally {
    rig.reset();
  }
};
const used = (hero, id) => world.sheet(hero.id).resources?.[id]?.used ?? 0;
const carries = (hero, name) => world.sheet(hero.id).equipment.some((item) => item.name === name);
const foe = (enemy) => kit.enemy(enemy.id);
const card = (hero, turn, id) => deriveHand(world.sheet(hero.id), turn).find((entry) => entry.id === id);
// A hit on a 15 with every other die a 3.
const hit = (hero, enemy, args = {}) => kit.swing(hero.id, enemy.id, [15, 15, 3, 3, 3, 3, 3, 3, 3, 3], args);

// ---- Piston Barrage ----

await run("Piston Barrage: every melee hit of the turn carries Piston Strike's 1d6, where without it only the first does", async () => {
  const row = feature("steam_knight", "Piston Barrage", 15);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  const second = async () => {
    rig.myTurn(hero);
    const first = await hit(hero, near);
    assert.ok(first.ok && first.damage?.expression.includes("1d6"), `the first hit rolled ${first.damage?.expression ?? first.error}`);
    const next = await hit(hero, near);
    assert.ok(next.ok, `the second attack: ${next.error}`);
    return next.damage?.expression ?? "no damage roll";
  };
  const { on, off } = await rig.both(hero, row, second);
  assert.ok(on.includes("1d6"), `the second hit rolled ${on} with Piston Barrage`);
  assert.ok(!off.includes("1d6"), `the second hit rolled ${off} without it: Piston Strike is once a turn`);
});

// ---- Prodigy's Precision ----

await run("Prodigy's Precision: a tuned weapon's attack roll adds 1d4, an unarmed strike's does not, and the Hand's card prints the die", async () => {
  const row = feature("gadgeteer", "Prodigy's Precision", 3);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  const roll = async (args) => {
    rig.myTurn(hero);
    // The d20 a 10, then every die a 4: the d4 on the roll, or the damage.
    const out = await kit.swing(hero.id, near.id, [10, 4, 4, 4, 4], args);
    assert.ok(out.ok && out.toHit, `pc_attack: ${out.error}`);
    return out.toHit;
  };
  const { on, off } = await rig.both(hero, row, () => roll({}));
  assert.equal(on.total, off.total + 4, `the longsword's roll totalled ${on.total} with the feature and ${off.total} without it`);
  assert.ok(on.expression.includes("1d4") && !off.expression.includes("1d4"), `the rolls were ${on.expression} and ${off.expression}`);
  const fist = await roll({ weapon: "unarmed strike" });
  assert.ok(!fist.expression.includes("1d4"), `an unarmed strike rolled ${fist.expression}`);
  const sword = card(hero, FRESH_TURN, "attack:longsword");
  assert.equal(sword?.toHitDice, "+1d4", `the Longsword card's roll is ${sword?.roll}`);
  const bare = card(hero, FRESH_TURN, "attack:unarmed strike");
  assert.ok(bare && !bare.toHitDice, `the Unarmed strike card's roll is ${bare?.roll}`);
});

// ---- Auto-Loader Harness ----

await run("Auto-Loader Harness: after the Attack action's two attacks one more is made with a firearm, once a turn; a third blade swing is refused", async () => {
  const row = feature("gadgeteer", "Auto-Loader Harness", 11);
  const hero = rig.holder(row, { gear: "firearm" });
  const { near } = await rig.fight(hero);
  const blade = () => hit(hero, near, { weapon: "Rapier" });
  const shot = () => hit(hero, near, { weapon: "Pistol" });
  // Blade, blade, then the harness's shot.
  assert.ok((await blade()).ok && (await blade()).ok, "the Attack action's two attacks");
  const third = await blade();
  assert.ok(!third.ok && /firearm/.test(third.error), `a third rapier swing: ${third.error ?? "accepted"}`);
  assert.equal(rig.budget().attacksMade, 2, "the refused swing was counted");
  const extra = await shot();
  assert.ok(extra.ok, `the harness's shot: ${extra.error}`);
  assert.equal(rig.budget().attacksAllowed, 2, "the Attack action still holds two attacks of its own");
  const fourth = await shot();
  assert.ok(!fourth.ok, "a second extra shot in the same turn went off");
  // The shot first: the two blade swings still follow it.
  rig.myTurn(hero);
  assert.ok((await shot()).ok && (await blade()).ok, "a shot, then a swing");
  const last = await blade();
  assert.ok(last.ok, `the third attack of a turn that opened with the shot: ${last.error}`);
  assert.ok(!(await blade()).ok, "a fourth attack went off");
  // Without the harness the third attack is refused, firearm or not.
  rig.myTurn(hero);
  const plain = await rig.without(hero, row, async () => {
    await blade();
    await blade();
    return shot();
  });
  assert.ok(!plain.ok, "without the harness a third attack went off");
});

await run("Auto-Loader Harness: the Hand keeps the firearm's card open for the extra shot and shuts the blade's", async () => {
  const hero = rig.holder(feature("gadgeteer", "Auto-Loader Harness", 11), { gear: "firearm" });
  await rig.fight(hero);
  const spent = { ...FRESH_TURN, actionUsed: true, attacksMade: 2, marks: [] };
  assert.equal(card(hero, spent, "attack:pistol")?.disabled, null, "the Pistol card is shut with the harness's shot unmade");
  assert.ok(card(hero, spent, "attack:rapier")?.disabled, "the Rapier card is open for a third swing with no shot fired");
  assert.equal(hudGates(world.sheet(hero.id), spent).attack, null, "the board's attack verb is shut with the harness's shot unmade");
  const fired = { ...spent, attacksMade: 3, marks: ["firearm-attack-made", "auto-loader harness"] };
  assert.ok(card(hero, fired, "attack:pistol")?.disabled, "the Pistol card stays open once the extra shot is made");
  assert.ok(hudGates(world.sheet(hero.id), fired).attack, "the board's attack verb stays open once the extra shot is made");
});

// ---- Sky Duelist ----

await run("Sky Duelist: a critical hit with a one-handed weapon knocks the target prone, disarms one already prone, and a two-handed weapon's does neither", async () => {
  const row = feature("aeronaut", "Sky Duelist", 17);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  const crit = (args = {}) => kit.swing(hero.id, near.id, [20, 20, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3], args);
  const first = await crit();
  assert.ok(first.ok, `pc_attack: ${first.error}`);
  assert.ok(foe(near).conditions.includes("prone"), `the critical hit left ${JSON.stringify(foe(near).conditions)}`);
  assert.ok(!foe(near).conditions.includes("disarmed"), "the critical hit knocked it prone and disarmed it");
  const again = await crit();
  assert.ok(again.ok, `the second attack: ${again.error}`);
  assert.ok(foe(near).conditions.includes("disarmed"), `a critical hit on a prone creature left ${JSON.stringify(foe(near).conditions)}`);
  // An ordinary hit leaves nothing.
  kit.setEnemy(near.id, { conditions: [], conditionMeta: {} });
  rig.myTurn(hero);
  await hit(hero, near);
  assert.deepEqual(foe(near).conditions.filter((entry) => entry === "prone" || entry === "disarmed"), [], "an ordinary hit knocked it down");
  // Without the feature, and with a two-handed weapon, the critical hit is only its dice.
  const off = await rig.without(hero, row, async () => {
    rig.myTurn(hero);
    await crit();
    return foe(near).conditions.includes("prone");
  });
  assert.equal(off, false, "without Sky Duelist the critical hit knocked it prone");
  world.patch(hero.id, { equipment: [{ name: "Greatsword", qty: 1, equipped: true }] });
  rig.myTurn(hero);
  const heavy = await crit({ weapon: "Greatsword" });
  assert.ok(heavy.ok, `the greatsword: ${heavy.error}`);
  assert.ok(!foe(near).conditions.includes("prone"), "a two-handed weapon's critical hit knocked it prone");
});

// ---- The Engine Eternal ----

await run("The Engine Eternal: the first Head of Steam of a turn costs no bonus action, the second costs it, and the Hand prices the card the same way", async () => {
  const row = feature("steam_knight", "The Engine Eternal", 20);
  const hero = rig.holder(row);
  await rig.fight(hero);
  const build = () => world.invoke("use_resource", { characterId: hero.id, resource: "Head of Steam", reason: "test" });
  assert.equal(card(hero, FRESH_TURN, "feature:authored:head-of-steam")?.cost, "free", "the Head of Steam card's cost on a fresh turn");
  rig.must(await build(), "the first Head of Steam");
  assert.ok(world.sheet(hero.id).conditions.includes("head of steam"), "no pressure was built");
  assert.ok(!rig.budget().bonusUsed, "the first Head of Steam of the turn spent the bonus action");
  assert.equal(card(hero, { ...FRESH_TURN, marks: rig.budget().oncePerTurn }, "feature:authored:head-of-steam")?.cost, "bonus", "the card's cost once the free one is built");
  world.patch(hero.id, { conditions: [], conditionMeta: {} });
  rig.must(await build(), "the second Head of Steam");
  assert.equal(rig.budget().bonusUsed, true, "the second Head of Steam of the turn was free too");
  // The next turn has its own free one; without the feature there is none.
  rig.myTurn(hero);
  world.patch(hero.id, { conditions: [], conditionMeta: {} });
  rig.must(await build(), "Head of Steam on the next turn");
  assert.ok(!rig.budget().bonusUsed, "the next turn's first Head of Steam spent the bonus action");
  const plain = await rig.without(hero, row, async () => {
    rig.myTurn(hero);
    world.patch(hero.id, { conditions: [], conditionMeta: {} });
    rig.must(await build(), "Head of Steam without The Engine Eternal");
    return rig.budget().bonusUsed;
  });
  assert.equal(plain, true, "without The Engine Eternal the Head of Steam was free");
});

// ---- Backup Rig ----

await run("Backup Rig: a weapon let fall is in the hand again at no cost, a disarmed mark is ended, and a gadgeteer who is not disarmed spends nothing", async () => {
  // A shield stays on the arm, so what is held is written on the sheet and
  // the sword coming back shows as held.
  const hero = rig.holder(feature("gadgeteer", "Backup Rig", 13), { gear: "shield" });
  await rig.fight(hero);
  const rigUp = () => world.invoke("use_resource", { characterId: hero.id, resource: "Backup Rig", reason: "test" });
  const early = await rigUp();
  assert.ok(!early.ok && /not been disarmed/.test(early.error), `Backup Rig with nothing lost: ${early.error ?? "accepted"}`);
  assert.equal(used(hero, "steampunk_backup_rig"), 0, "the refused use was spent");
  rig.must(await world.invoke("handle_item", { characterId: hero.id, action: "drop", item: "Longsword", reason: "knocked from the hand" }), "handle_item drop");
  assert.ok(!carries(hero, "Longsword"), "the longsword is still carried after the drop");
  rig.myTurn(hero);
  rig.must(await rigUp(), "Backup Rig");
  const sword = world.sheet(hero.id).equipment.find((item) => item.name === "Longsword");
  assert.ok(sword?.equipped, `the longsword came back as ${JSON.stringify(sword ?? null)}`);
  assert.equal(used(hero, "steampunk_backup_rig"), 1, "the use was not spent");
  const budget = rig.budget();
  assert.ok(!budget.actionUsed && !budget.bonusUsed && !budget.interactionUsed, `the rig cost part of the turn: ${JSON.stringify(budget)}`);
  // The mark a Disarming Attack leaves.
  world.patch(hero.id, { resources: { ...world.sheet(hero.id).resources, steampunk_backup_rig: { max: 1, used: 0 } }, conditions: ["disarmed"], conditionMeta: {} });
  // The Hand deals the card while the mark is carried, and not before.
  assert.ok(card(hero, FRESH_TURN, "feature:steampunk_backup_rig"), "no Backup Rig card for a disarmed gadgeteer");
  rig.must(await rigUp(), "Backup Rig against the disarmed mark");
  assert.ok(!world.sheet(hero.id).conditions.includes("disarmed"), "the disarmed mark stayed");
  assert.ok(!card(hero, FRESH_TURN, "feature:steampunk_backup_rig"), "the Backup Rig card is dealt with nothing to take back");
});

rig.world.close();
finish();
