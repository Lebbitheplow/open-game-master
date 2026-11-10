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

world.close();
finish();
