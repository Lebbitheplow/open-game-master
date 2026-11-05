// What every SRD 5.1 creature that swallows prints about it, read as the
// engine plays it (src/lib/dm/swallow-logic.ts): the creature it takes, the
// save that keeps one out, the acid at the start of each of its turns, the
// damage from inside that makes it save or regurgitate, and the feet of
// movement out of its corpse. And the hit's own reading (attack-text.ts): a
// kraken's bite no longer asks the target the kraken's regurgitation save,
// and a purple worm's swallows on the failed Dexterity save it prints.
import assert from "node:assert/strict";
import fs from "node:fs";
import { readPage, rowOfBlock } from "./lib/srd-bestiary.mjs";

const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
const { swallowRuleOf, swallowActionOf } = await import("../src/lib/dm/swallow-logic.ts");

const book = JSON.parse(fs.readFileSync(new URL("../src/lib/rulebook/srd-5.1.json", import.meta.url), "utf8"));
const statsOf = (page) => {
  const parsed = parseMonster(rowOfBlock(page.title, readPage(page.md)));
  return parsed.stats ?? parsed;
};
const byName = (title) => statsOf(book.pages.find((page) => page.title === title && page.kind === "monster"));

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("every SRD creature that swallows reads to a rule", () => {
  const swallowers = book.pages.filter((page) => page.kind === "monster" && /\bswallowed\b/.test(page.md)).map((page) => page.title).sort();
  assert.deepEqual(swallowers, ["Behir", "Giant Frog", "Giant Toad", "Kraken", "Purple Worm", "Remorhaz", "Tarrasque"]);
  for (const title of swallowers) {
    const rule = swallowRuleOf(byName(title));
    assert.ok(rule, `${title} has a swallow`);
    assert.ok(rule.acid, `${title}: its acid`);
    assert.ok(rule.maxSize, `${title}: the size it takes`);
    assert.ok(rule.escapeFeet, `${title}: the way out of its corpse`);
  }
});

test("each block's own numbers", () => {
  const rule = (title, entry) => {
    const read = swallowRuleOf(byName(title), entry);
    return read && { ...read };
  };
  assert.deepEqual(rule("Behir", "Swallow"), {
    entry: "Swallow", attack: "bite", maxSize: "medium", grappledOnly: true, save: null,
    acid: { dice: "6d6", type: "acid" }, onlyOne: true, regurgitate: { damage: 30, dc: 14 }, escapeFeet: 15,
  });
  assert.deepEqual(rule("Kraken", "Bite"), {
    entry: "Bite", attack: null, maxSize: "large", grappledOnly: true, save: null,
    acid: { dice: "12d6", type: "acid" }, onlyOne: false, regurgitate: { damage: 50, dc: 25 }, escapeFeet: 15,
  });
  assert.deepEqual(rule("Purple Worm", "Bite"), {
    entry: "Bite", attack: null, maxSize: "large", grappledOnly: false, save: { ability: "dex", dc: 19 },
    acid: { dice: "6d6", type: "acid" }, onlyOne: false, regurgitate: { damage: 30, dc: 21 }, escapeFeet: 20,
  });
  assert.deepEqual(rule("Remorhaz", "Swallow"), {
    entry: "Swallow", attack: "bite", maxSize: "medium", grappledOnly: true, save: null,
    acid: { dice: "6d6", type: "acid" }, onlyOne: false, regurgitate: { damage: 30, dc: 15 }, escapeFeet: 15,
  });
  assert.deepEqual(rule("Tarrasque", "Swallow"), {
    entry: "Swallow", attack: "bite", maxSize: "large", grappledOnly: true, save: null,
    acid: { dice: "16d6", type: "acid" }, onlyOne: false, regurgitate: { damage: 60, dc: 20 }, escapeFeet: 30,
  });
  assert.deepEqual(rule("Giant Frog", "Swallow"), {
    entry: "Swallow", attack: "bite", maxSize: "small", grappledOnly: true, save: null,
    acid: { dice: "2d4", type: "acid" }, onlyOne: true, regurgitate: null, escapeFeet: 5,
  });
  assert.deepEqual(rule("Giant Toad", "Swallow"), {
    entry: "Swallow", attack: "bite", maxSize: "medium", grappledOnly: true, save: null,
    acid: { dice: "3d6", type: "acid" }, onlyOne: true, regurgitate: null, escapeFeet: 5,
  });
  // The tarrasque's own bite swallows only as its Swallow, whose numbers it takes.
  assert.equal(rule("Tarrasque", "Bite")?.entry, "Swallow");
});

test("a Swallow action is one by name; a bite that swallows is not an action of its own", () => {
  assert.equal(swallowActionOf(byName("Behir"), "Swallow")?.attack, "bite");
  assert.equal(swallowActionOf(byName("Kraken"), "Bite"), null);
  assert.equal(swallowActionOf(byName("Behir"), "Bite"), null);
});

test("a hit that swallows reads its own save, not the swallower's, and leaves the swallow to the engine", () => {
  const kraken = byName("Kraken").attacks.find((attack) => attack.name === "Bite").onHit;
  assert.equal(kraken.swallow, true);
  assert.equal(kraken.save, undefined, "the kraken's DC 25 Constitution save is its own, at a turn's end");
  assert.equal(kraken.dc, undefined);
  assert.equal(kraken.maxSize, "large");
  assert.ok(!(kraken.manual ?? []).some((line) => /swallowed|regurgitate/.test(line)), JSON.stringify(kraken.manual));
  const worm = byName("Purple Worm").attacks.find((attack) => attack.name === "Bite").onHit;
  assert.equal(worm.swallow, true, "\"or be swallowed by the worm\" swallows");
  assert.deepEqual([worm.save, worm.dc], ["dex", 19]);
});

console.log(`${passed} swallow checks passed`);
