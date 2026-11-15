// The monster rules the 2026-11-15 audit found the engine getting wrong
// (lens "monsters", E01 and on), each held here as the SRD 5.1 block reads.
// The creatures are the rulebook's own pages read as the engine reads a pack
// row (statblock.ts parseMonster), so the suite needs no content pack.
// Dice forced; every check reads a stored row.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { readPage, rowOfBlock } from "./lib/srd-bestiary.mjs";

const { test, finish } = suite("test-audit1115-monsters");

const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
const { parseSaveEffect } = await import("../src/lib/dm/save-effect.ts");

const book = JSON.parse(fs.readFileSync(new URL("../src/lib/rulebook/srd-5.1.json", import.meta.url), "utf8"));
function srd(title) {
  const page = book.pages.find((entry) => entry.title === title && entry.kind === "monster");
  const parsed = parseMonster(rowOfBlock(title, readPage(page.md)));
  return parsed.stats ?? parsed;
}

const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const kit = await combatKit(world);
const kara = world.addHero({ name: "Kara", class: "fighter", level: 10, maxHp: 90, abilities: { str: 16, wis: 10 }, proficiencies: TRAINED });
const bram = world.addHero({ name: "Bram", class: "fighter", level: 10, maxHp: 90, abilities: { str: 16, wis: 10 }, proficiencies: TRAINED });

// One creature of the rulebook's, on its own turn, beside the heroes.
async function stage(title) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [foe] = world.enemies();
  const stats = srd(title);
  kit.setEnemy(foe.id, { ac: stats.ac, maxHp: stats.maxHp, stats });
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 5, 6);
  kit.place(foe.id, 7, 5);
  kit.enemyTurn(foe.id);
  return kit.enemy(foe.id);
}

test("E01 the block's 24-hour immunity is read: Frightful Presence after a success or its end, the harpy's song after a success", () => {
  const presence = parseSaveEffect(
    "Each creature of the dragon's choice that is within 120 feet of the dragon and aware of it must succeed on a DC 19 Wisdom saving throw or become frightened for 1 minute. A creature can repeat the saving throw at the end of each of its turns, ending the effect on itself on a success. If a creature's saving throw is successful or the effect ends for it, the creature is immune to the dragon's Frightful Presence for the next 24 hours.",
  );
  assert.deepEqual(presence.immuneAfter, { rounds: 14400, onEnd: true });
  assert.equal(presence.condition, "frightened");
  assert.equal(presence.rounds, 10);
  const song = parseSaveEffect(
    "The harpy sings a magical melody. Every humanoid and giant within 300 feet of the harpy that can hear the song must succeed on a DC 11 Wisdom saving throw or be charmed until the song ends. If a creature's saving throw is successful, the creature is immune to the harpy's song for the next 24 hours.",
  );
  assert.deepEqual(song.immuneAfter, { rounds: 14400, onEnd: false });
  assert.equal(parseSaveEffect("must succeed on a DC 13 Constitution saving throw or be poisoned for 1 minute.").immuneAfter, undefined);
});

await test("E01 a hero who makes the save against a dragon's Frightful Presence is immune to it: the next round's use is refused with nothing spent", async () => {
  const dragon = await stage("Adult Red Dragon");
  world.dice(20);
  const first = await world.invoke("cast_at_player", { casterEnemyId: dragon.id, enemyAbility: "Frightful Presence", characterId: kara.id });
  world.clearDice();
  assert.equal(first.ok, true, first.error);
  assert.equal(first.result.saved, true);
  assert.match(String(first.result.immune), /immune to it for 24 hours/);
  kit.freshRound();
  kit.enemyTurn(dragon.id);
  world.dice(1);
  const again = await world.invoke("cast_at_player", { casterEnemyId: dragon.id, enemyAbility: "Frightful Presence", characterId: kara.id });
  world.clearDice();
  assert.equal(again.ok, false, "the immune hero is not asked the save again");
  assert.match(String(again.error), /immune to it for 24 hours.*Nothing was spent/);
  assert.ok(!world.sheet(kara.id).conditions.includes("frightened"));
  assert.equal(world.encounter().legendary.acted?.ids?.includes(dragon.id) ?? false, false, "the dragon keeps its action");
});

await test("E01 the area form passes over the immune hero and asks the other, whose failure lays the fear and, the effect ending, immunity too", async () => {
  const dragon = await stage("Adult Red Dragon");
  world.dice(20);
  await world.invoke("cast_at_player", { casterEnemyId: dragon.id, enemyAbility: "Frightful Presence", characterId: kara.id });
  world.clearDice();
  kit.freshRound();
  kit.enemyTurn(dragon.id);
  world.dice(1);
  const area = await world.invoke("aoe_damage", { casterEnemyId: dragon.id, enemyAbility: "Frightful Presence", characterIds: [kara.id, bram.id] });
  world.clearDice();
  assert.equal(area.ok, true, area.error);
  const rows = area.result.results ?? [];
  const karaRow = rows.find((row) => row.target === "Kara");
  assert.ok(karaRow?.immune, JSON.stringify(rows));
  assert.ok(!world.sheet(kara.id).conditions.includes("frightened"), "the immune hero is not frightened");
  assert.ok(world.sheet(bram.id).conditions.includes("frightened"), "the other failed and is frightened");
  assert.ok(world.sheet(bram.id).conditions.includes("immune to frightful presence"), "and is immune once the fear ends");
});

finish();
