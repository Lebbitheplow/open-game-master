// Every legendary option of the SRD 5.1 bestiary has a way to play it
// through the engine (issue 685 audit, 4.G): src/lib/dm/legendary-route-logic.ts
// reads each line into steps by mechanism (an attack, a save, a check, a
// move, a teleport, a spell, a heal, a ward, negative energy, a drain, a
// cloud, a throw, a swallow), and the GM's card and the console play them.
//
// The pages are the rulebook's own (src/lib/rulebook/srd-5.1.json), read as
// the engine reads a pack row (statblock.ts parseMonster), so the suite says
// the same with no content pack. It fails when an option is left with no
// route, or a route names an attack, an ability, a spell list or an area the
// block does not have.
//
// And how an option plays at the table (issue 685 review): never inside the
// creature's own turn, even after it has acted (SRD 5.1, Legendary Actions:
// "only at the end of another creature's turn"), and what a line lays "until
// the end of the <creature>'s next turn" holds through that turn and ends
// with it, played on a table through the GM's console.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import { openWorld } from "./lib/enforce-world.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { readPage, rowOfBlock } = await import("./lib/srd-bestiary.mjs");
const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
const { legendaryOpening, legendaryProfile } = await import("../src/lib/dm/legendary-logic.ts");
const { legendaryRoutes, routeNeeds } = await import("../src/lib/dm/legendary-route-logic.ts");
const { legendaryMoveFor } = await import("../src/lib/dm/legendary-move.ts");
const { findMonsterAbility } = await import("../src/lib/dm/monster-abilities.ts");
const { zoneRowFor } = await import("../src/lib/battlemap/zones-spells.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const book = JSON.parse(fs.readFileSync(new URL("../src/lib/rulebook/srd-5.1.json", import.meta.url), "utf8"));
const PAGES = book.pages.filter((page) => ["monsters", "creatures", "npcs"].includes(page.chapter) && page.kind === "monster");

// Every legendary creature the pages print, with its block as the engine
// fights with it.
const CREATURES = [];
for (const page of PAGES) {
  const block = readPage(page.md);
  if (!block?.legendary?.options?.length) {
    continue;
  }
  const parsed = parseMonster(rowOfBlock(page.title, block));
  const stats = parsed.stats ?? parsed;
  CREATURES.push({ name: page.title, stats, options: legendaryProfile(stats)?.actions ?? [] });
}

const byName = (name) => CREATURES.find((creature) => creature.name === name);
const routesOf = (creature, option) => legendaryRoutes(creature.stats, creature.options.find((entry) => entry.name === option));

await test("the pages hold the SRD's legendary creatures, every option read off its block", () => {
  assert.ok(CREATURES.length >= 30, `only ${CREATURES.length} legendary creatures`);
  for (const name of ["Aboleth", "Adult Red Dragon", "Ancient Gold Dragon", "Androsphinx", "Gynosphinx", "Kraken", "Lich", "Mummy Lord", "Solar", "Tarrasque", "Unicorn", "Vampire"]) {
    assert.ok(byName(name), `${name} is missing`);
    assert.ok(byName(name).options.length >= 2, `${name} reads ${byName(name).options.length} options`);
  }
});

await test("no SRD 5.1 legendary option is left with no way to play it through the engine", () => {
  const unrouted = [];
  for (const creature of CREATURES) {
    for (const option of creature.options) {
      if (!legendaryRoutes(creature.stats, option).length) {
        unrouted.push(`${creature.name}: ${option.name}`);
      }
    }
  }
  assert.deepEqual(unrouted, []);
});

await test("every route names what the block has: its attacks, its abilities' saves, its spells, an area row, a move it can make", () => {
  const wrong = [];
  const kinds = new Set();
  for (const creature of CREATURES) {
    const attacks = [...(creature.stats.attacks ?? []), ...(creature.stats.legendaryAttacks ?? [])].map((attack) => attack.name);
    for (const option of creature.options) {
      for (const route of legendaryRoutes(creature.stats, option)) {
        for (const step of route.steps) {
          kinds.add(step.kind);
          const where = `${creature.name}: ${option.name} (${route.use}) ${step.kind}`;
          if ((step.kind === "attack" || step.kind === "swallow") && !attacks.includes(step.attack)) wrong.push(`${where}: no attack ${step.attack}`);
          if (step.kind === "save") {
            const ability = findMonsterAbility(creature.stats, step.ability);
            if (!ability?.save || !ability.dc) wrong.push(`${where}: ${step.ability} has no save and DC`);
          }
          if (step.kind === "spell") {
            const spells = creature.stats.spellcasting?.spells ?? [];
            if (!spells.some((spell) => !step.cantrip || spell.level === 0)) wrong.push(`${where}: nothing on its list to cast`);
          }
          if (step.kind === "cloud" && !zoneRowFor({ spell: step.zone })) wrong.push(`${where}: no area row for ${step.zone}`);
          if (step.kind === "move" && legendaryMoveFor({ stats: creature.stats, conditions: [] }, step).tiles < 1) wrong.push(`${where}: moves nowhere`);
          if (step.kind === "check" && !step.ability) wrong.push(`${where}: no ability`);
        }
      }
    }
  }
  assert.deepEqual(wrong, []);
  // Every mechanism the SRD needs is one the engine plays.
  assert.deepEqual([...kinds].sort(), ["attack", "check", "cloud", "drain", "fling", "heal", "move", "noRegain", "save", "spell", "swallow", "teleport", "ward"]);
});

await test("each SRD option is played by what it does", () => {
  const steps = (creature, option) => routesOf(byName(creature), option).map((route) => [route.use, route.steps.map((step) => step.kind).join("+")]);
  assert.deepEqual(steps("Adult Red Dragon", "Detect"), [["Detect", "check"]]);
  assert.deepEqual(steps("Adult Red Dragon", "Tail Attack"), [["Tail", "attack"]]);
  assert.deepEqual(steps("Adult Red Dragon", "Wing Attack"), [["Wing Attack", "save+move"]]);
  assert.deepEqual(steps("Aboleth", "Tail Swipe"), [["Tail", "attack"]]);
  assert.deepEqual(steps("Aboleth", "Psychic Drain"), [["Psychic Drain", "drain"]]);
  assert.deepEqual(steps("Androsphinx", "Teleport"), [["Teleport", "teleport"]]);
  assert.deepEqual(steps("Androsphinx", "Cast a Spell"), [["Cast a Spell", "spell"]]);
  assert.deepEqual(steps("Kraken", "Tentacle Attack or Fling"), [["Tentacle", "attack"], ["Fling", "fling"]]);
  assert.deepEqual(steps("Kraken", "Lightning Storm"), [["Lightning Storm", "save"]]);
  assert.deepEqual(steps("Kraken", "Ink Cloud"), [["Ink Cloud", "cloud"]]);
  assert.deepEqual(steps("Lich", "Cantrip"), [["Cantrip", "spell"]]);
  assert.deepEqual(steps("Lich", "Paralyzing Touch"), [["Paralyzing Touch", "attack"]]);
  assert.deepEqual(steps("Lich", "Frightening Gaze"), [["Frightening Gaze", "save"]]);
  assert.deepEqual(steps("Lich", "Disrupt Life"), [["Disrupt Life", "save"]]);
  assert.deepEqual(steps("Mummy Lord", "Attack"), [["Rotting Fist", "attack"], ["Dreadful Glare", "save"]]);
  assert.deepEqual(steps("Mummy Lord", "Blinding Dust"), [["Blinding Dust", "save"]]);
  assert.deepEqual(steps("Mummy Lord", "Blasphemous Word"), [["Blasphemous Word", "save"]]);
  assert.deepEqual(steps("Mummy Lord", "Channel Negative Energy"), [["Channel Negative Energy", "noRegain"]]);
  assert.deepEqual(steps("Mummy Lord", "Whirlwind of Sand"), [["Whirlwind of Sand", "move"]]);
  assert.deepEqual(steps("Solar", "Searing Burst"), [["Searing Burst", "save"]]);
  assert.deepEqual(steps("Solar", "Blinding Gaze"), [["Blinding Gaze", "save"]]);
  assert.deepEqual(steps("Tarrasque", "Attack"), [["Claw", "attack"], ["Tail", "attack"]]);
  assert.deepEqual(steps("Tarrasque", "Move"), [["Move", "move"]]);
  assert.deepEqual(steps("Tarrasque", "Chomp"), [["Bite", "attack"], ["Swallow", "swallow"]]);
  assert.deepEqual(steps("Unicorn", "Shimmering Shield"), [["Shimmering Shield", "ward"]]);
  assert.deepEqual(steps("Unicorn", "Heal Self"), [["Heal Self", "heal"]]);
  assert.deepEqual(steps("Vampire", "Move"), [["Move", "move"]]);
  assert.match(steps("Vampire", "Unarmed Strike")[0][0], /^Unarmed Strike/);
  assert.match(steps("Vampire", "Bite")[0][0], /^Bite/);
});

await test("the numbers each route carries are the line's", () => {
  const [detect] = routesOf(byName("Aboleth"), "Detect");
  assert.deepEqual(detect.steps[0], { kind: "check", ability: "wis", skill: "perception" });
  const [wing] = routesOf(byName("Adult Red Dragon"), "Wing Attack");
  assert.deepEqual(wing.steps[1], { kind: "move", feet: null, fraction: 0.5, mode: "fly", provokes: true, optional: true });
  assert.equal(legendaryMoveFor({ stats: byName("Adult Red Dragon").stats, conditions: [] }, wing.steps[1]).tiles, 8, "half of a fly 80 ft.");
  const [vampire] = routesOf(byName("Vampire"), "Move");
  assert.equal(vampire.steps[0].provokes, false, "without provoking opportunity attacks");
  assert.equal(legendaryMoveFor({ stats: byName("Vampire").stats, conditions: [] }, vampire.steps[0]).tiles, 6);
  const [tarrasque] = routesOf(byName("Tarrasque"), "Move");
  assert.equal(tarrasque.steps[0].provokes, true);
  assert.equal(legendaryMoveFor({ stats: byName("Tarrasque").stats, conditions: [] }, tarrasque.steps[0]).tiles, 4, "half of 40 ft.");
  const [whirlwind] = routesOf(byName("Mummy Lord"), "Whirlwind of Sand");
  assert.deepEqual(whirlwind.steps[0], { kind: "move", feet: 60, fraction: 1, mode: "walk", provokes: false, optional: false });
  assert.deepEqual(routesOf(byName("Solar"), "Teleport")[0].steps[0], { kind: "teleport", feet: 120 });
  assert.deepEqual(routesOf(byName("Lich"), "Cantrip")[0].steps[0], { kind: "spell", cantrip: true });
  assert.deepEqual(routesOf(byName("Gynosphinx"), "Cast a Spell")[0].steps[0], { kind: "spell", cantrip: false });
  assert.deepEqual(routesOf(byName("Unicorn"), "Heal Self")[0].steps[0], { kind: "heal", dice: "2d8+2" });
  assert.deepEqual(routesOf(byName("Unicorn"), "Shimmering Shield")[0].steps[0], { kind: "ward", ac: 2, feet: 60 });
  assert.deepEqual(routesOf(byName("Mummy Lord"), "Channel Negative Energy")[0].steps[0], { kind: "noRegain", feet: 60 });
  assert.deepEqual(routesOf(byName("Aboleth"), "Psychic Drain")[0].steps[0], { kind: "drain", dice: "3d6", type: "psychic" });
  assert.deepEqual(routesOf(byName("Kraken"), "Ink Cloud")[0].steps[0], { kind: "cloud", zone: "ink cloud" });
  assert.deepEqual(routesOf(byName("Kraken"), "Tentacle Attack or Fling")[1].steps[0], { kind: "fling", feet: 60, dice: "1d6", dc: 18, maxSize: "large" });
  assert.deepEqual(routesOf(byName("Tarrasque"), "Chomp")[1].steps[0], { kind: "swallow", attack: "Bite", maxSize: "large", entry: "Swallow" });
  assert.equal(routesOf(byName("Kraken"), "Lightning Storm")[0].steps[0].most, 3, "three bolts");
  assert.equal(routesOf(byName("Lich"), "Frightening Gaze")[0].steps[0].most, 1);
  assert.equal(routesOf(byName("Solar"), "Blinding Gaze")[0].steps[0].most, 1);
  assert.equal(routesOf(byName("Lich"), "Disrupt Life")[0].steps[0].most, null, "everyone caught");
});

await test("what each route asks the card for", () => {
  assert.deepEqual(routeNeeds(routesOf(byName("Adult Red Dragon"), "Tail Attack")[0]), { target: "one", rows: true, square: "none", spell: false });
  assert.deepEqual(routeNeeds(routesOf(byName("Adult Red Dragon"), "Wing Attack")[0]), { target: "many", rows: true, square: "optional", spell: false });
  assert.deepEqual(routeNeeds(routesOf(byName("Adult Red Dragon"), "Detect")[0]), { target: "none", rows: false, square: "none", spell: false });
  assert.deepEqual(routeNeeds(routesOf(byName("Vampire"), "Move")[0]), { target: "none", rows: false, square: "required", spell: false });
  assert.deepEqual(routeNeeds(routesOf(byName("Lich"), "Cantrip")[0]), { target: "many", rows: true, square: "none", spell: true });
  assert.equal(routeNeeds(routesOf(byName("Lich"), "Frightening Gaze")[0]).target, "one");
});

await test("a homebrew option the reader cannot read has no route: a spend and a line for the GM", () => {
  const stats = { attacks: [{ name: "Claw", toHit: 5, damage: "1d6", type: "slashing" }], traits: ["Legendary action: Hum. The creature hums a tune nobody remembers."], specials: [] };
  assert.deepEqual(legendaryRoutes(stats, { name: "Hum", cost: 1, text: "The creature hums a tune nobody remembers." }), []);
  // In another language too.
  assert.deepEqual(legendaryRoutes(stats, { name: "Zarpazo", cost: 1, text: "La criatura ataca con su garra." }), []);
});

// ---- at the table ----

await test("no option is taken inside the creature's own turn, before it acts or after (SRD 5.1: at the end of another creature's turn)", () => {
  const dragon = { id: "d", displayName: "The dragon" };
  const at = (legendary, actedThisRound = false) =>
    legendaryOpening({ turn: "2:k", round: 2, onPointer: false, actedThisRound, legendary }, dragon).refusal;
  // Kara's turn, nobody held: its end is open.
  assert.equal(at({}), null);
  assert.ok(legendaryOpening({ turn: "2:d", round: 2, onPointer: true, actedThisRound: false, legendary: {} }, dragon).refusal);
  // Its turn begun, held for the GM or handed to the AI: refused before it acts...
  assert.ok(at({ due: ["d"] }));
  assert.ok(at({ handoff: { turnId: "t", enemyIds: ["d"] } }));
  // ...and after, while no creature has acted since: the GM's Tail and then a
  // legendary Detect went through inside one turn.
  assert.match(at({ due: ["d"], acted: { round: 2, ids: ["g", "d"] } }, true)?.error ?? "", /the end of its own turn is not one/);
  assert.ok(at({ handoff: { turnId: "t", enemyIds: ["d"] }, acted: { round: 2, ids: ["d"] } }, true));
  // Another creature held with it has acted since: that turn's end is open.
  assert.equal(at({ due: ["d", "g"], acted: { round: 2, ids: ["d", "g"] } }, true), null);
  // Its turn handed on: the next turn's end is open.
  assert.equal(at({ acted: { round: 2, ids: ["d"] } }, true), null);
});

const campaigns = await import("../src/lib/db/campaigns.ts");
const { acWithEffects } = await import("../src/lib/dm/ac-effects.ts");
const { regainBlockedBy } = await import("../src/lib/dm/vitals-logic.ts");
const { endOwnTurn } = await import("../src/lib/dm/encounter-tools.ts");

// The SRD options legendary-play.ts lays a lasting mark for itself (a ward,
// negative energy), each with its whole line: the profile's text is cut short.
const LASTING = CREATURES.flatMap((creature) =>
  creature.options
    .filter((option) => legendaryRoutes(creature.stats, option).some((route) => route.steps.some((step) => step.kind === "ward" || step.kind === "noRegain")))
    .map((option) => ({ creature, option, line: (creature.stats.fullLegendary ?? []).find((entry) => entry.startsWith(option.name)) ?? option.text })),
);

await test("what an option lays until the end of the creature's next turn holds through that turn and ends with it", async () => {
  assert.deepEqual(LASTING.map(({ creature, option }) => `${creature.name}: ${option.name}`).sort(), ["Mummy Lord: Channel Negative Energy", "Unicorn: Shimmering Shield"]);
  // The creature after Kara in the order, and before her: the round turns
  // over after its turn in the one, as Kara's turn ends in the other, and a
  // count of rounds ended the line at one of those, early or late.
  const cases = LASTING.flatMap((entry) => [{ ...entry, first: false }, { ...entry, first: true }]);
  const wrong = [];
  for (const { creature, option, line, first } of cases) {
    assert.match(line, /\buntil the end of the [a-z ]+'s next turn\b/i, `${creature.name}: ${option.name}`);
    const where = `${creature.name}: ${option.name}${first ? ", acting first" : ""}`;
    const [route] = legendaryRoutes(creature.stats, option);
    const step = route.steps[0];
    // Kara on her turn at a table a person runs, the creature beside her.
    const world = await openWorld({ campaign: { maxPlayers: 8 } });
    const kit = await combatKit(world);
    const kara = world.addHero({ name: "Kara", maxHp: 150 });
    const gm = world.addUser("gm");
    const status = world.campaign().status;
    campaigns.setCampaignStatus(world.campaignId, "lobby");
    assert.ok(campaigns.joinByInviteCode(gm.id, world.campaign().inviteCode).campaign);
    campaigns.setCampaignStatus(world.campaignId, status);
    campaigns.setDmMode(world.campaignId, "human", gm.id);
    await kit.fight(1, { heroFaces: { [kara.id]: 19 }, enemyFace: 1 });
    const [foe] = world.enemies();
    kit.setEnemy(foe.id, { ac: creature.stats.ac, maxHp: creature.stats.maxHp, stats: creature.stats });
    kit.place(kara.id, 5, 5);
    kit.place(foe.id, 6, 5);
    if (first) {
      const encounter = world.encounter();
      const order = [...encounter.order].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "enemy" ? -1 : 1));
      kit.saveEncounter({ ...encounter, order });
    }
    kit.giveTurn(kara.id);
    const ac = acWithEffects(world.campaignId, world.sheet(kara.id));
    const holds = () =>
      step.kind === "ward" ? acWithEffects(world.campaignId, world.sheet(kara.id)) === ac + step.ac : Boolean(regainBlockedBy(world.sheet(kara.id)));

    const handler = await world.route("campaigns/[campaignId]/dm/invoke");
    world.signIn({ id: gm.id });
    const aimed = routeNeeds(route).target === "one" ? { targetCharacterId: kara.id } : { characterIds: [kara.id] };
    const response = await handler.POST(
      new Request("http://odm.test/dm/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "legendary_action", args: { enemyId: foe.id, action: option.name, ...aimed } }),
      }),
      { params: Promise.resolve({ campaignId: world.campaignId }) },
    );
    assert.equal(response.status, 200, `${where}: ${JSON.stringify(await response.json())}`);
    assert.ok(holds(), `${where}: laid on Kara`);
    // Kara's turn ends: the creature's next turn has begun, not ended.
    assert.equal(endOwnTurn(world.campaignId, kara.userId), true);
    if (!holds()) {
      wrong.push(`${where}: gone before the creature's turn ended`);
    }
    // The GM hands its turn on: its next turn is over, and so is the line.
    kit.handOnEnemies();
    if (holds()) {
      wrong.push(`${where}: still there after the creature's turn ended`);
    }
  }
  assert.deepEqual(wrong, []);
});

console.log(`\n${passed} legendary route checks passed`);
