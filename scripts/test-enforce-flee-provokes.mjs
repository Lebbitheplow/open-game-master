// An enemy that flees the fight draws the opportunity attacks its walk out
// draws. SRD 5.1, Opportunity Attacks: "You can make an opportunity attack
// when a hostile creature that you can see moves out of your reach." Every
// other walk of an enemy's went through that rule (move_token, the walk-up
// of enemy_attack, the flight of a turned or frightened creature);
// enemy_flees took the token off the board where it stood, so a wounded
// gnoll beside the fighter left untouched, and the swing the player asked
// for afterwards was refused because it had already fled.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, DUMMY, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-flee-provokes");
const world = await openWorld({ campaign: { maxPlayers: 4 } });
const kit = await combatKit(world);

const hero = world.addHero({
  name: "Kara", class: "fighter", level: 5, maxHp: 80, proficiencies: TRAINED,
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});
const warden = world.addHero({
  name: "Orin", class: "fighter", level: 4, maxHp: 40, proficiencies: TRAINED, feats: ["Sentinel"],
  abilities: { str: 16, dex: 10, con: 14, int: 10, wis: 10, cha: 10 },
  equipment: [{ name: "Mace", qty: 1, equipped: true }],
});

// `count` dummies (30 ft, AC 13) on an open field, the first at (5,7), both
// heroes far off until a test stands one beside it.
async function stage(count = 1, patch = {}) {
  await kit.endFight();
  await kit.fight(count, { heroFaces: { [hero.id]: 20, [warden.id]: 18 } });
  const enemies = world.enemies();
  kit.setEnemy(enemies[0].id, { stats: { ...DUMMY }, maxHp: 40, ...patch });
  kit.place(hero.id, 19, 0);
  kit.place(warden.id, 19, 14);
  kit.place(enemies[0].id, 5, 7);
  return enemies.map((enemy) => kit.enemy(enemy.id));
}

const flee = (enemy) => world.invoke("enemy_flees", { enemyId: enemy.id, reason: "its nerve breaks" });
const reacted = (sheet) => world.encounter().reactionsUsed.some((key) => key.includes(sheet.id));

await test("An enemy fleeing from beside a character takes their opportunity attack as it goes, and still escapes if it lives.", async () => {
  const [gnoll] = await stage(2);
  kit.place(hero.id, 6, 7);
  kit.dice(15, 4);
  const out = await flee(gnoll);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.fled, gnoll.displayName);
  assert.equal(out.result.opportunityAttacks?.length, 1, JSON.stringify(out.result));
  assert.match(out.result.opportunityAttacks[0], /^Kara catches .+ with an opportunity attack as it breaks away/);
  assert.match(out.result.opportunityNote, /already rolled and applied/);
  assert.equal(reacted(hero), true, "the swing cost no reaction");
  const after = kit.enemy(gnoll.id);
  assert.equal(after.status, "fled");
  assert.ok(after.currentHp < 40, `the blow was not kept on the creature that got away: ${after.currentHp}`);
  assert.equal(kit.token(gnoll.id) ?? null, null, "its token stayed on the board");
});

await test("A miss lets it go, with the reaction spent.", async () => {
  const [gnoll] = await stage(2);
  kit.place(hero.id, 6, 7);
  kit.dice(2);
  const out = await flee(gnoll);
  assert.equal(out.result.fled, gnoll.displayName);
  assert.match(out.result.opportunityAttacks[0], /misses/);
  assert.equal(kit.enemy(gnoll.id).currentHp, 40);
  assert.equal(reacted(hero), true);
});

await test("One with nobody in reach of it flees as before: no swing, no reaction spent.", async () => {
  const [gnoll] = await stage(2);
  const out = await flee(gnoll);
  assert.equal(out.result.fled, gnoll.displayName);
  assert.equal(out.result.opportunityAttacks, undefined);
  assert.equal(reacted(hero), false);
});

await test("A Disengage it took this turn holds: it flees from beside a character untouched.", async () => {
  const [gnoll] = await stage(2);
  kit.place(hero.id, 6, 7);
  const off = await world.invoke("take_action", { enemyId: gnoll.id, action: "disengage" });
  assert.equal(off.ok, true, off.error);
  const out = await flee(gnoll);
  assert.equal(out.result.fled, gnoll.displayName);
  assert.equal(out.result.opportunityAttacks, undefined);
  assert.equal(reacted(hero), false);
});

await test("A character whose reaction is spent makes no swing.", async () => {
  const [gnoll] = await stage(2);
  kit.place(hero.id, 6, 7);
  kit.saveEncounter({ ...world.encounter(), reactionsUsed: [...world.encounter().reactionsUsed, hero.id] });
  const out = await flee(gnoll);
  assert.equal(out.result.fled, gnoll.displayName);
  assert.equal(out.result.opportunityAttacks, undefined);
});

await test("Struck down on the way out, it has not fled: it is dead, and the fight goes on while another stands.", async () => {
  const [gnoll] = await stage(2, { maxHp: 40, currentHp: 3 });
  kit.place(hero.id, 6, 7);
  kit.dice(15, 6);
  const out = await flee(gnoll);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.fled, undefined, JSON.stringify(out.result));
  assert.equal(out.result.stopped, gnoll.displayName);
  assert.match(out.result.note, /did not escape/);
  assert.equal(kit.enemy(gnoll.id).status, "dead");
  assert.notEqual(world.encounter(), null, "the fight ended with an enemy still standing");
});

await test("The last enemy struck down as it flees ends the fight as a victory, not a rout.", async () => {
  const [gnoll] = await stage(1, { maxHp: 40, currentHp: 3 });
  kit.place(hero.id, 6, 7);
  kit.dice(15, 6);
  const out = await flee(gnoll);
  assert.equal(out.result.stopped, gnoll.displayName);
  assert.equal(out.result.encounterOver, true, JSON.stringify(out.result));
  assert.equal(world.encounter(), null);
});

await test("A Sentinel's hit stops it where it stands: speed 0 for the turn, still in the fight, its token on the board.", async () => {
  const [gnoll] = await stage(2);
  kit.place(warden.id, 6, 7);
  kit.dice(15, 3);
  const out = await flee(gnoll);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.fled, undefined, JSON.stringify(out.result));
  assert.equal(out.result.stopped, gnoll.displayName);
  assert.match(out.result.note, /still in the fight/);
  assert.match(out.result.opportunityAttacks[0], /Sentinel/);
  assert.equal(kit.enemy(gnoll.id).status, "alive");
  assert.deepEqual({ x: kit.token(gnoll.id).x, y: kit.token(gnoll.id).y }, { x: 5, y: 7 });
  // The turn is not over for it: the same call again is the rules saying no.
  const again = await flee(gnoll);
  assert.equal(again.refused, "rules");
});

await finish();
