// Flash of Genius on a saving throw that has already landed
// (src/lib/dm/flash-of-genius.ts): "When you or another creature you can see
// within 30 feet of you makes an ability check or a saving throw, you can use
// your reaction to add your Intelligence modifier to the roll" (Artificer 7).
// A save that could not wait on the after-the-roll card is answered through
// its record: the modifier goes on the roll as thrown, and when it reaches the
// DC the damage a success would have spared comes back. Before this the use
// and the reaction were taken on the call's word and nothing was added.
import assert from "node:assert/strict";
import { suite } from "./lib/enforce-harness.mjs";
import { openClauseRig } from "./lib/sweep-clauses-divine.mjs";

const { test, finish } = suite("test-flash-of-genius-forced-save");
const rig = await openClauseRig();
const FLASH = "art_flash_of_genius";
const FLAME = { spells: ["Sacred Flame"] };

// A 7th-level artificer (Intelligence +5), an ally beside them, and a
// creature that casts Sacred Flame (a Dexterity save or 1d8 radiant, nothing
// on a success) at the ally on its own turn.
async function stage(face, { allyAt = [4, 6] } = {}) {
  rig.reset();
  const who = rig.hero("artificer", "Battle Smith", 7);
  const ally = rig.hero("cleric", "Life Domain", 7);
  const [foe] = await rig.fight(who);
  rig.kit.place(ally.id, ...allyAt);
  rig.kit.setEnemy(foe.id, { stats: FLAME });
  rig.foesTurn(foe);
  const cast = await rig.call("cast_at_player", { characterId: ally.id, spell: "Sacred Flame", saveAbility: "dex", dc: 15, damage: "1d8", damageType: "radiant", casterEnemyId: foe.id }, [face, 6]);
  return { who, ally, foe, cast };
}

await test("with no failed save on record the use is refused and nothing is spent", async () => {
  rig.reset();
  const who = rig.hero("artificer", "Battle Smith", 7);
  const [foe] = await rig.fight(who);
  rig.foesTurn(foe);
  const out = await rig.spend(who, "Flash of Genius");
  assert.equal(out.ok, false, "Flash of Genius was spent with no roll to add to");
  assert.match(out.error, /failed/);
  assert.deepEqual([rig.res(who, FLASH).used, rig.reacted(who)], [0, false]);
});

await test("the Intelligence modifier turns an ally's failed save: the damage a success would have spared comes back", async () => {
  // A 10 on the die and Dexterity +2: 12 against DC 15, and +5 makes it 17.
  const { who, ally, cast } = await stage(10);
  assert.equal(cast.ok, true, cast.error);
  assert.equal(rig.hp(ally), 94, "the failed save cost the ally 6");
  const out = await rig.spend(who, "Flash of Genius", { targetCharacterId: ally.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(rig.hp(ally), 100, `the ally stands at ${rig.hp(ally)} after the save was made good: ${JSON.stringify(out.result).slice(0, 300)}`);
  assert.deepEqual([rig.res(who, FLASH).used, rig.reacted(who)], [1, true], "a use and the artificer's reaction");
  const again = await rig.spend(who, "Flash of Genius", { targetCharacterId: ally.id });
  assert.equal(again.ok, false, "a second use answered the same save");
});

await test("short of the DC the failure stands, and the use is spent all the same", async () => {
  // A 2 on the die: 4 against DC 15, and +5 leaves it at 9.
  const { who, ally } = await stage(2);
  const out = await rig.spend(who, "Flash of Genius", { targetCharacterId: ally.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(rig.hp(ally), 94, "the damage came back on a save still failed");
  assert.equal(rig.res(who, FLASH).used, 1);
});

await test("a creature beyond 30 feet is not answered", async () => {
  const { who, ally } = await stage(10, { allyAt: [5, 13] });
  const out = await rig.spend(who, "Flash of Genius", { targetCharacterId: ally.id });
  assert.equal(out.ok, false, "an ally 40 feet off was answered");
  assert.deepEqual([rig.res(who, FLASH).used, rig.hp(ally)], [0, 94]);
});

rig.close();
finish();
