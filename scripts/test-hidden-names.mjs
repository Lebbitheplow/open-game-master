// A creature the GM keeps off the board is "someone unseen" in what a
// player's seat is sent (src/lib/hidden-names-logic.ts, run on every event
// that can name one by src/lib/table-delivery.ts). The stream walk is
// scripts/test-enforce-sweep-modelio-leaks.mjs; this reads the words alone.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);
const { hideNames, namesToHide } = await import("../src/lib/hidden-names-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

test("a roll's detail, its attacker and a sheet change's reason name nobody unseen", () => {
  const roll = { roll: { detail: "Mira: DEX save vs Bandit's Light Crossbow", attacker: { name: "Bandit" }, total: 14 } };
  assert.deepEqual(hideNames(roll, ["Bandit"]), {
    roll: { detail: "Mira: DEX save vs someone unseen's Light Crossbow", attacker: { name: "Someone unseen" }, total: 14 },
  });
  assert.deepEqual(hideNames({ entry: { reason: "Bandit's Scimitar" } }, ["Bandit"]), { entry: { reason: "Someone unseen's Scimitar" } });
});

test("a sentence that opens on the name opens on Someone; one that holds it reads someone", () => {
  assert.equal(hideNames({ content: "Mira catches Bandit with an opportunity attack. Bandit staggers." }, ["Bandit"]).content, "Mira catches someone unseen with an opportunity attack. Someone unseen staggers.");
});

test("a tracker entry for the creature is marked hidden with its name", () => {
  const out = hideNames({ order: [{ name: "Bandit", hidden: false }, { name: "Goblin", hidden: false }] }, ["Bandit"]);
  assert.deepEqual(out.order, [{ name: "Someone unseen", hidden: true }, { name: "Goblin", hidden: false }]);
});

test("only whole names: Banditry is no bandit", () => {
  assert.equal(hideNames({ content: "Talk of banditry on the road." }, ["Bandit"]).content, "Talk of banditry on the road.");
});

test("nothing to hide hands the same payload back", () => {
  const payload = { content: "Goblin swings." };
  assert.equal(hideNames(payload, ["Bandit"]), payload);
  assert.equal(hideNames(payload, []), payload);
});

test("a name a creature the table sees, or a hero, also answers to is kept, and the longest name goes first", () => {
  assert.deepEqual(namesToHide(["Goblin", "Bandit Captain"], ["goblin", "Mira"]), ["Bandit Captain"]);
  assert.deepEqual(namesToHide(["Bandit", "Bandit Captain"], []), ["Bandit Captain", "Bandit"]);
  assert.equal(hideNames({ content: "Bandit Captain shouts." }, namesToHide(["Bandit", "Bandit Captain"], [])).content, "Someone unseen shouts.");
});

console.log(`hidden-names: ${passed} tests passed`);
