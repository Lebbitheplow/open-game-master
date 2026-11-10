// The named leftovers of the Channel Divinity and class-feature pull requests
// (#809, #831, #832, #856, #859, #860, #866): /tmp/odm-gapstudy/limits.md is
// the list. Where a limit is a qualifier of the text ("of your choice", "you
// can see"), the row walks every spend of the authored table whose own words
// carry that qualifier, not only the feature the pull request named.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { limitsSuite } from "./lib/sweep-limits.mjs";
import { authoredText, limitsTable } from "./lib/sweep-limits-world.mjs";

const KNOWN = {
};
const RULING = {
  "831-out-of-a-fight": "pull request #831, Known limits: \"Out of a fight, an area option is paid for and left to the story, as a buff aimed at a creature already is. Nature's Wrath is refused without a fight, like other single-target save_effect rows.\" (pinned by scripts/test-channel-table.mjs \"Out of a fight, an area option is paid for and left to the GM's story.\")",
  "832-picker-caps-at-12": "pull request #832, Known limits: \"The picker's limit: it caps at 12 creatures, the most a card's intent carries.\" (src/lib/battlemap/hand-intent.ts .max(12))",
  "859-faithful-summons-choice": "src/lib/dm/faithful-summons.ts: the four beasts are wolves, chosen for the player; pull request #859 asked for \"a card the player answers at 0 hit points or a ruling on defaults\"",
};
const SKIP = {
  "831-you-can-see:barbarian::Mighty Impel/Mighty Impel": "its \"you can see\" is the space the creature is moved to, not the creature (\"move it to an unoccupied space you can see within 30 feet of you\"); the generator's pattern caught the wrong noun.",
  "831-within-feet:barbarian::Mighty Impel/Mighty Impel": "its first \"within\" is \"within your reach\"; the 30 feet is where the creature lands.",
  "831-within-feet:warlock::Master of Hexes/Master of Hexes": "its 30 feet is measured from the creature that died (\"another creature you can see within 30 feet of it\"), which is gone from the board when the curse moves.",
  "832-gm-form-lists-enemies-only": "a property of the console's form (a field of kind \"enemies\" lists the encounter's enemies); the tool takes a character fighting for the foes by id, and only the browser harness can open the form.",
  "809-foretold-number-on-the-sheet": "who may read another seat's sheet is the sheet route's business as another member; left to the modelio package's leak rows, which walk every payload a seat receives.",
  "856-lucky-and-bardic-watch": "a design note for a follow-up, superseded by the after-the-roll choice (#848, src/lib/dm/after-roll-logic.ts); nothing of its own to hold.",
};

const { row, finish } = limitsSuite("test-enforce-sweep-limits-features", { KNOWN, RULING, SKIP });
const world = await openWorld({ campaign: { maxPlayers: 60 } });
const table = await limitsTable(world);
const { kit } = table;
const TEXT = authoredText();
const text = (key) => `"${TEXT.get(key)?.text ?? "?"}" (src/lib/srd/subclasses.json, ${key})`;
const { authoredRows } = await import("../src/lib/srd/authored-effects.ts");
const show = (out) => (out.ok ? JSON.stringify(out.result).slice(0, 260) : String(out.error));

const friend = table.hero({ class: "fighter", subclass: "Champion" });
const foe = (id) => kit.enemy(id);
const channel = async (who, variant, faces = [], more = {}) => {
  world.clearDice();
  world.dice(...faces);
  const out = await world.invoke("use_resource", { characterId: who.id, resource: "Channel Divinity", variant, ...more });
  world.clearDice();
  return out;
};
// The holder at (5, 5) on their own turn, with foes beside them.
async function stage(who, count = 2) {
  const foes = await table.stage([who, friend], { count, first: who });
  kit.place(who.id, 5, 5);
  kit.place(friend.id, 4, 5);
  foes.forEach((enemy, at) => kit.place(enemy.id, 6 + (at % 3), 5 + Math.floor(at / 3)));
  return foes;
}

// ---- #831, #832: "of your choice" ----

const CHOSEN = [
  ["Order's Demand", { class: "cleric", subclass: "Order Domain" }, "order's demand", "charmed", "cleric::Channel Divinity: Order's Demand"],
  ["Champion Challenge", { class: "paladin", subclass: "Oath of the Crown" }, "champion challenge", "champion challenge", "paladin::Channel Divinity: Champion Challenge"],
  ["Dreadful Aspect", { class: "paladin", subclass: "Oathbreaker" }, "dreadful aspect", "frightened", null],
  ["Conquering Presence", { class: "paladin", subclass: "Oath of Conquest" }, "conquering presence", "frightened", null],
];
const holders = {};
for (const [name, build, variant, condition, key] of CHOSEN) {
  const who = table.hero(build);
  holders[name] = who;
  await row(`831-of-your-choice:${name}`, {
    pr: 831,
    limit: "\"Of your choice\": the rules let the player choose which creatures Order's Demand and Champion Challenge affect. Here they take every foe in reach, as Dreadful Aspect already does.",
    rule: key ? text(key) : `${name}: "each creature of your choice" (the class's Channel Divinity option)`,
  }, async () => {
    const [picked, spared] = await stage(who);
    const out = await channel(who, variant, [1, 1], { targetEnemyIds: [picked.id] });
    assert.equal(out.ok, true, out.error);
    assert.ok(foe(picked.id).conditions.includes(condition), `the chosen creature is untouched: ${show(out)}`);
    assert.ok(!foe(spared.id).conditions.includes(condition), "the creature not chosen is taken too");
  });
}

await row("831-of-your-choice:every authored area", {
  pr: 831,
  limit: "\"Of your choice\": a choice would need a way to name several targets in use_resource, plus a picker on the card.",
  rule: "Every area spend whose own words say \"of your choice\" lets the player choose (src/lib/srd/subclasses.json against the row's `chosen`).",
}, () => {
  const missing = [];
  for (const entry of authoredRows()) {
    const words = TEXT.get(entry.key)?.text ?? "";
    if (!/of (your|the \w+'s) choice/i.test(words)) continue;
    for (const spend of entry.entry.spends ?? []) {
      if (spend.does.kind === "save_area" && !spend.does.chosen) missing.push(`${entry.key}: ${spend.name}`);
    }
  }
  assert.deepEqual(missing, []);
});

await row("832-other-features-ignore-the-list", {
  pr: 832,
  limit: "Other features that take one creature or every creature ignore the list, apart from the refusals above.",
  rule: "A list of creatures sent to a feature that takes one is refused, with nothing spent (pull request #832).",
}, async () => {
  const ancients = table.hero({ class: "paladin", subclass: "Oath of the Ancients" });
  const [one, two] = await stage(ancients);
  const before = table.ledger(ancients);
  const out = await channel(ancients, "nature's wrath", [1, 1], { targetEnemyIds: [one.id, two.id] });
  assert.equal(out.ok, false, `a single-creature option took a list: ${show(out)}`);
  assert.equal(table.ledger(ancients), before);
  const light = table.hero({ class: "cleric", subclass: "Light Domain" });
  const [near, other] = await stage(light);
  const ledger = table.ledger(light);
  const some = await channel(light, "radiance of the dawn", [1, 1, 5, 5], { targetEnemyIds: [near.id] });
  assert.equal(some.ok, false, `an every-creature option took a chosen few: ${show(some)}`);
  assert.equal(table.ledger(light), ledger);
  assert.ok(other);
});

await row("832-picker-caps-at-12", {
  pr: 832,
  limit: "The picker's limit: it caps at 12 creatures, the most a card's intent carries.",
  rule: text("cleric::Channel Divinity: Order's Demand"),
}, async () => {
  const who = holders["Order's Demand"];
  await kit.endFight();
  // A fight holds eight creatures at most (start_encounter: "keep encounters
  // to 8 combatants or fewer"), so the card's twelve is never the bar.
  await world.beginFight([{ monster: "goblin", count: 8 }], { heroFaces: { [who.id]: 19 } });
  kit.openField();
  for (const sheet of world.sheets()) kit.place(sheet.id, 19, 14);
  kit.place(who.id, 5, 5);
  kit.giveTurn(who.id);
  const sheet = world.sheet(who.id);
  world.patch(who.id, { conditions: [], resources: { ...sheet.resources, channel_divinity: { ...sheet.resources.channel_divinity, used: 0 } } });
  const foes = world.enemies();
  foes.forEach((enemy, at) => kit.place(enemy.id, 6 + (at % 4), 4 + Math.floor(at / 4)));
  const out = await channel(who, "order's demand", new Array(8).fill(1), { targetEnemyIds: foes.map((enemy) => enemy.id) });
  assert.equal(out.ok, true, out.error);
  assert.equal(foes.filter((enemy) => foe(enemy.id).conditions.includes("charmed")).length, 8, "every creature a fight can hold is chosen");
});
await row("832-gm-form-lists-enemies-only", { pr: 832, limit: "The GM's form lists encounter enemies only.", rule: "-" }, async () => {});

// ---- #831: Champion Challenge's leash ----

const crown = holders["Champion Challenge"];
await row("831-champion-challenge-walks-away", {
  pr: 831,
  limit: "Champion Challenge's movement limit: a challenged creature can't willingly move more than 30 feet from the paladin. That limit is shown on the condition but not enforced when the creature moves.",
  rule: text("paladin::Channel Divinity: Champion Challenge"),
}, async () => {
  const [near] = await stage(crown, 1);
  const out = await channel(crown, "champion challenge", [1]);
  assert.equal(out.ok, true, out.error);
  assert.ok(foe(near.id).conditions.includes("champion challenge"), "the challenge");
  // The creature walks 50 feet off under its own power (two moves of 25).
  const moves = [];
  for (const x of [11, 16]) {
    moves.push(await world.invoke("move_token", { token: near.id, x, y: 5 }));
  }
  const at = kit.token(near.id);
  const feet = Math.max(Math.abs(at.x - 5), Math.abs(at.y - 5)) * 5;
  assert.ok(feet <= 30, `the challenged creature walked to ${feet} feet from the paladin (${moves.map((move) => (move.ok ? "moved" : move.error)).join(" / ").slice(0, 300)})`);
});

await row("831-challenge-let-go-at-turn-end", {
  pr: 831,
  limit: "The challenge is also let go at the end of the turn in which a creature is carried out of range, not at the moment it leaves.",
  rule: "Oath of the Crown, Champion Challenge: \"This effect ends on the creature if you are incapacitated or die or if the creature is more than 30 feet away from you.\"",
}, async () => {
  const [near] = await stage(crown, 1);
  assert.equal((await channel(crown, "champion challenge", [1])).ok, true);
  const shoved = await world.invoke("move_token", { token: near.id, x: 14, y: 5, forced: true });
  assert.equal(shoved.ok, true, shoved.error);
  assert.ok(!foe(near.id).conditions.includes("champion challenge"), "45 feet from the paladin, carried there, the creature is still challenged until a turn ends");
});

// ---- #831, #860: "you can see", "can hear you" ----

// Every spend aimed at one creature whose own words ask that the holder see
// it: named while invisible, it is refused with nothing spent.
const sightRows = [];
for (const entry of authoredRows()) {
  const words = TEXT.get(entry.key);
  if (!words || !/(creature|undead|target|foe|enemy)[^.;]{0,30}you can see|you can see[^.;]{0,40}(creature|undead|target|within)/i.test(words.text)) continue;
  for (const spend of entry.entry.spends ?? []) {
    const does = spend.does;
    const single = (does.kind === "save_effect") || (does.kind === "buff" && (does.target === "enemy" || does.quarry || does.mark));
    if (single && spend.fight !== "out" && !spend.gm) sightRows.push({ entry, spend, words });
  }
}
const openGate = (who, gate = {}) => {
  const sheet = world.sheet(who.id);
  // A barbarian's options ask for the rage, on the spend or on its feature.
  const conditions = [...sheet.conditions, ...(gate.raging || sheet.class === "barbarian" ? ["raging"] : []), ...(gate.condition ? [gate.condition] : [])];
  world.patch(who.id, { conditions });
};

// The same walk for "within N feet": every spend aimed at one creature whose
// own words give a reach refuses a creature beyond it, with nothing spent.
const reachRows = [];
for (const entry of authoredRows()) {
  const words = TEXT.get(entry.key);
  const feet = Number(/within (\d+) feet/i.exec(words?.text ?? "")?.[1] ?? 0);
  if (!feet || feet > 60) continue;
  for (const spend of entry.entry.spends ?? []) {
    const kind = spend.does.kind;
    const single = kind === "save_effect" || (kind === "buff" && (spend.does.target === "enemy" || spend.does.quarry || spend.does.mark));
    if (single && spend.fight !== "out" && !spend.gm) reachRows.push({ entry, spend, words, feet });
  }
}
for (const { entry, spend, words, feet } of reachRows) {
  await row(`831-within-feet:${entry.key}/${spend.name}`, {
    pr: "808/831",
    limit: "Any targeting clause with a geometric qualifier (closest, between, adjacent to the target, in a line); a text clause listed under known limits.",
    rule: `"${words.text}" (src/lib/srd/subclasses.json, ${entry.key})`,
  }, async () => {
    const who = table.hero({ class: entry.classId, subclass: entry.entry.subclass });
    // A feature with an option to choose first (the totem): the one this spend is named for.
    const choose = (entry.entry.spends ?? []).find((other) => other.does.kind === "choose");
    if (choose) {
      await kit.endFight();
      const option = choose.does.options.find((name) => spend.name.toLowerCase().includes(name.toLowerCase())) ?? choose.does.options[0];
      const picked = await world.invoke("use_resource", { characterId: who.id, resource: choose.name, variant: option });
      if (!picked.ok) throw new Error(`the rig: ${choose.name} (${option}) was refused: ${picked.error}`);
    }
    const args = (enemy) => ({ characterId: who.id, resource: spend.name, targetEnemyId: enemy.id, ...(spend.does.variants ? { variant: Object.keys(spend.does.variants)[0] } : {}) });
    const setUp = async (apart) => {
      const [enemy] = await table.stage([who, friend], { first: who });
      kit.place(who.id, 1, 5);
      kit.place(friend.id, 1, 6);
      kit.place(enemy.id, 1 + apart, 5);
      openGate(who, spend.gate);
      if (spend.does.types?.length) kit.setEnemy(enemy.id, { stats: { type: spend.does.types[0] } });
      return enemy;
    };
    const near = await setUp(1);
    world.dice(1, 1, 1, 1);
    const control = await world.invoke("use_resource", args(near));
    world.clearDice();
    assert.equal(control.ok, true, `on a creature 5 feet away the spend is refused, so this row proves nothing: ${control.error}`);
    const far = await setUp(feet / 5 + 3);
    const before = table.ledger(who);
    world.dice(1, 1, 1, 1);
    const out = await world.invoke("use_resource", args(far));
    world.clearDice();
    assert.equal(out.ok, false, `a creature ${feet + 15} feet away is taken: ${show(out)}`);
    assert.equal(table.ledger(who), before, "the refusal spent something");
  });
}

for (const { entry, spend, words } of sightRows) {
  await row(`831-you-can-see:${entry.key}/${spend.name}`, {
    pr: "831/860",
    limit: "Sight follows each text. \"Can hear you\" (Turn the Tide) and \"can see\" limits are not checked.",
    rule: `"${words.text}" (src/lib/srd/subclasses.json, ${entry.key})`,
  }, async () => {
    const who = table.hero({ class: entry.classId, subclass: entry.entry.subclass });
    const args = (enemy) => ({ characterId: who.id, resource: spend.name, targetEnemyId: enemy.id, ...(does(spend).variants ? { variant: Object.keys(does(spend).variants)[0] } : {}) });
    const [seen] = await stage(who, 1);
    openGate(who, spend.gate);
    if (does(spend).types?.length) kit.setEnemy(seen.id, { stats: { type: does(spend).types[0] } });
    world.dice(1, 1, 1, 1);
    const control = await world.invoke("use_resource", args(seen));
    world.clearDice();
    assert.equal(control.ok, true, `on a creature in plain sight the spend is refused, so this row proves nothing: ${control.error}`);
    const [hidden] = await stage(who, 1);
    openGate(who, spend.gate);
    if (does(spend).types?.length) kit.setEnemy(hidden.id, { stats: { type: does(spend).types[0] } });
    kit.setEnemy(hidden.id, { conditions: ["invisible"] });
    const before = table.ledger(who);
    world.dice(1, 1, 1, 1);
    const out = await world.invoke("use_resource", args(hidden));
    world.clearDice();
    assert.equal(out.ok, false, `an invisible creature is taken: ${show(out)}`);
    assert.equal(table.ledger(who), before, "the refusal spent something");
  });
}
function does(spend) {
  return spend.does;
}

const twilight = table.hero({ class: "cleric", subclass: "Twilight Domain" });
await row("860-twilight-shroud", {
  pr: 860,
  limit: "Twilight Shroud (17th level, half cover inside the sanctuary) still reads as GM narration, as before.",
  rule: text("cleric::Twilight Shroud"),
}, async () => {
  const [enemy] = await stage(twilight, 1);
  const up = await channel(twilight, "twilight sanctuary");
  assert.equal(up.ok, true, up.error);
  kit.place(enemy.id, 4, 6);
  const out = await table.strike(enemy, friend, [10, 4]);
  assert.equal(out.result.vsAc, 14, `an ally in the sanctuary is attacked at AC ${out.result.vsAc}, not 12 + 2 of half cover`);
});

const redeemer = table.hero({ class: "paladin", subclass: "Oath of Redemption" });
const crownTide = crown;
await row("860-can-hear-you", {
  pr: 860,
  limit: "\"Can hear you\" (Turn the Tide) and \"can see\" limits are not checked.",
  rule: `${text("paladin::Channel Divinity: Turn the Tide")}; the published feature: "each creature of your choice that can hear you within 30 feet"`,
}, async () => {
  await stage(crownTide, 1);
  world.patch(friend.id, { currentHp: 10, conditions: ["deafened"], conditionMeta: { deafened: { rounds: 10 } } });
  world.patch(crownTide.id, { currentHp: 100 });
  const before = table.ledger(crownTide);
  const out = await channel(crownTide, "turn the tide", [4]);
  assert.equal(world.sheet(friend.id).currentHp, 10, `a deafened ally is healed: ${show(out)}`);
  assert.ok(out.ok === false && table.ledger(crownTide) === before, "with nobody who can hear, the use is spent");
  assert.ok(redeemer);
});

await row("831-out-of-a-fight", {
  pr: 831,
  limit: "Out of a fight, an area option is paid for and left to the story. Nature's Wrath is refused without a fight.",
  rule: text("cleric::Channel Divinity: Radiance of the Dawn"),
}, async () => {
  await kit.endFight();
  const light = table.hero({ class: "cleric", subclass: "Light Domain" });
  const out = await channel(light, "radiance of the dawn");
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(light.id).resources.channel_divinity.used, 1);
  const ancients = table.hero({ class: "paladin", subclass: "Oath of the Ancients" });
  const wrath = await channel(ancients, "nature's wrath");
  assert.equal(wrath.ok, false);
  assert.equal(world.sheet(ancients.id).resources.channel_divinity.used, 0);
});

await row("860-control-undead-guidance-only", {
  pr: 860,
  limit: "Same shape: every resource whose spend only returns guidance text (Control Undead is named in #864).",
  rule: text("paladin::Channel Divinity: Control Undead"),
}, async () => {
  const oathbreaker = holders["Dreadful Aspect"];
  const [zombie] = await stage(oathbreaker, 1);
  kit.setEnemy(zombie.id, { cr: 0.25, stats: { type: "undead", cr: 0.25, abilities: { str: 13, dex: 6, con: 16, int: 3, wis: 6, cha: 5 } } });
  const out = await channel(oathbreaker, "control undead", [2], { targetEnemyId: zombie.id });
  assert.equal(out.ok, true, out.error);
  assert.ok(foe(zombie.id).conditions.includes("charmed"), `the spend returned words and the undead is as it was: ${show(out)}`);
});

// ---- #866 ----

await row("866-tides-after-a-surge", {
  pr: 866,
  limit: "The use does not come back after a Wild Magic Surge. No GM tool gives a feature use back (update_sheet refuses counters).",
  rule: text("sorcerer::Tides of Chaos"),
}, async () => {
  await kit.endFight();
  const sorcerer = table.hero({ class: "sorcerer", subclass: "Wild Magic", spellcasting: { ability: "cha", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: ["Shield", "Mage Armor"], cantrips: ["Fire Bolt"] } });
  const tides = await world.invoke("use_resource", { characterId: sorcerer.id, resource: "Tides of Chaos", variant: "attack" });
  assert.equal(tides.ok, true, tides.error);
  const usedOf = () => world.sheet(sorcerer.id).resources.sub_tides_of_chaos.used;
  assert.equal(usedOf(), 1);
  const early = await world.invoke("use_resource", { characterId: sorcerer.id, resource: "Wild Magic Surge" });
  assert.equal(early.ok, false, "a surge with no spell cast gives the use back");
  const cast = await world.invoke("use_spell_slot", { characterId: sorcerer.id, spell: "Mage Armor", level: 1 });
  assert.equal(cast.ok, true, cast.error);
  const surge = await world.invoke("use_resource", { characterId: sorcerer.id, resource: "Wild Magic Surge" });
  assert.equal(surge.ok, true, surge.error);
  assert.equal(usedOf(), 0, "the GM's surge does not give Tides of Chaos back");
});

// ---- #859 ----

await row("859-faithful-summons", {
  pr: 859,
  limit: "Faithful Summons (Circle of the Shepherd 14) brings four beasts of the druid's choice. That choice can't be made automatically, so it needs either a card the player answers at 0 hit points or a ruling on defaults.",
  rule: text("druid::Faithful Summons"),
}, async () => {
  const druid = table.hero({ class: "druid", subclass: "Circle of the Shepherd" });
  await table.stage([druid, friend]);
  world.patch(druid.id, { currentHp: 30 });
  const out = await world.invoke("apply_damage", { characterId: druid.id, amount: 40, type: "slashing" });
  assert.equal(out.ok, true, out.error);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(world.sheet(druid.id).resources.sub_faithful_summons.used, 1, "the fall spends no use");
  const { summonsOf } = await import("../src/lib/dm/summon-store.ts");
  const pack = summonsOf(world.campaignId, druid.id, "Faithful Summons");
  assert.equal(pack.length, 4, "four beasts come");
  const order = world.encounter().order.map((entry) => entry.characterId);
  assert.ok(pack.every((beast) => order.includes(beast.id)), "they act in the fight");
});
await row("859-faithful-summons-choice", {
  pr: 859,
  limit: "four beasts of the druid's choice. That choice can't be made automatically.",
  rule: text("druid::Faithful Summons"),
}, async () => {
  const { summonsOf } = await import("../src/lib/dm/summon-store.ts");
  const druid = world.sheets().find((sheet) => sheet.subclass === "Circle of the Shepherd");
  const forms = new Set(summonsOf(world.campaignId, druid.id, "Faithful Summons").map((beast) => beast.summon?.form));
  // As ruled: wolves, with no question put to the player.
  assert.deepEqual([...forms], ["Wolf"]);
});

// Searing Vengeance needs its own table: the order is written by hand.
await row("859-searing-vengeance", {
  pr: 859,
  limit: "Searing Vengeance (Celestial 14) replaces a death save at the start of the warlock's turn. Death saves are rolled from the turn pointer, outside any GM turn. It needs its own small design.",
  rule: text("warlock::Searing Vengeance"),
}, async () => {
  const tools = await import("../src/lib/dm/encounter-tools.ts");
  const { registerDmWaker } = await import("../src/lib/dm/wake.ts");
  const { setDmMode } = await import("../src/lib/db/campaigns.ts");
  await import("../src/lib/dm/loop.ts");
  registerDmWaker(() => {});
  const other = await openWorld({ campaign: { maxPlayers: 6 } });
  const otherKit = await combatKit(other);
  const tamsin = other.addHero({ name: "Tamsin", abilities: { dex: 10, con: 10, wis: 10 } });
  const ilsa = other.addHero({ name: "Ilsa", maxHp: 60, abilities: { dex: 10, con: 10, wis: 10, cha: 18 }, class: "warlock", subclass: "The Celestial", level: 14 });
  await otherKit.fight(1);
  setDmMode(other.campaignId, "human", other.owner.id);
  const [goblin] = other.enemies();
  const order = [
    { kind: "pc", characterId: tamsin.id, userId: tamsin.userId, name: "Tamsin", initiative: 20 },
    { kind: "pc", characterId: ilsa.id, userId: ilsa.userId, name: "Ilsa", initiative: 15 },
    { kind: "enemy", enemyId: goblin.id, name: goblin.displayName, initiative: 10 },
  ];
  otherKit.saveEncounter({ ...other.encounter(), order, turnIndex: 0, round: 2, surprisedIds: [], turnBudget: null });
  tools.setInitiativeFloor(other.campaign(), other.encounter());
  other.patch(ilsa.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false }, conditions: ["unconscious", "prone"], conditionMeta: {} });
  otherKit.place(tamsin.id, 0, 0);
  otherKit.place(ilsa.id, 4, 4);
  otherKit.place(goblin.id, 6, 4);
  other.dice(4, 4);
  assert.equal(tools.endOwnTurn(other.campaignId, tamsin.userId), true, "the turn before the warlock's ends");
  other.clearDice();
  const sheet = other.sheet(ilsa.id);
  assert.equal(sheet.currentHp, 30, "the dying warlock does not rise at half their hit points");
  assert.equal(sheet.resources.sub_searing_vengeance.used, 1);
  assert.equal(other.enemies()[0].currentHp, 40 - 12, "2d8 + Charisma radiant to the creature within 30 feet");
});

// ---- #809, #856: Portent ----

const seer = world.addHero({ class: "wizard", subclass: "School of Divination", level: 5, maxHp: 30, abilities: { int: 16 }, proficiencies: { ...TRAINED, saves: [] } });
const arm = (patch = {}) => world.patch(seer.id, { conditions: [], features: [{ name: "Portent", source: "subclass" }], resources: { sub_portent: { max: 2, used: 0 } }, foretold: [17, 3], currentHp: 30, ...patch });
const pending = await import("../src/lib/db/dm-turns.ts");
const rolls = await import("../src/lib/db/rolls.ts");
const routes = {
  portent: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/portent"),
  pending: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]"),
  foresight: await world.route("campaigns/[campaignId]/foresight"),
};
const waiting = () => pending.listOpenPendingRolls(world.campaignId);
const clearRolls = async () => {
  for (const open of waiting()) {
    world.signIn({ id: open.userId });
    await call(routes.pending, "POST", { fallback: "digital" }, { campaignId: world.campaignId, pendingRollId: open.id });
  }
};

const FORCED = {
  "a trap's save (cast_at_player)": () => world.invoke("cast_at_player", { characterId: seer.id, source: "a poison needle", saveAbility: "con", dc: 15, damage: "1d4", damageType: "poison" }),
  "a hazard (apply_hazard)": () => world.invoke("apply_hazard", { type: "trap", characterIds: [seer.id], severity: "setback", saveAbility: "dex", dc: 15 }),
  "a spell's area (aoe_damage)": () => world.invoke("aoe_damage", { damage: "2d6", type: "fire", saveAbility: "dex", dc: 15, characterIds: [seer.id], halfOnSave: true, reason: "a gout of flame from the wall" }),
};
for (const [door, force] of Object.entries(FORCED)) {
  await row(`809-portent-on-a-forced-save:${door}`, {
    pr: 809,
    limit: "Saves the engine forces (forced-save.ts): these don't go through request_roll, so a wizard can't use a number on them yet.",
    rule: `${text("wizard::Portent")}; SRD 5.1 Portent: "You can replace any attack roll, saving throw, or ability check made by you or a creature that you can see with one of these foretelling rolls. You must choose to do so before the roll".`,
  }, async () => {
    await clearRolls();
    // An area needs a fight to land in; the other two are thrown in one too.
    await table.stage([seer, friend]);
    arm();
    world.clearDice();
    world.dice(10, 2, 2, 2);
    const out = await force();
    world.clearDice();
    assert.equal(out.ok, true, out.error);
    const parked = waiting().filter((open) => open.parkedFor === "foretold" || open.parkedFor === "watch");
    assert.equal(parked.length, 1, `the wizard's own save was thrown before they could name a number; nothing waits on Portent (${show(out)})`);
    assert.equal(world.sheet(seer.id).currentHp, 30, "and its damage has landed");
    await clearRolls();
  });
}

await row("809-reliable-talent-under-portent", {
  pr: 809,
  limit: "A number replaces the d20 directly, so a rule that sets a minimum roll, like Reliable Talent, doesn't apply to it. No test covers that.",
  rule: "SRD 5.1 Reliable Talent: \"you can treat a d20 roll of 9 or lower as a 10\"; Portent replaces the roll.",
}, async () => {
  await kit.endFight();
  await clearRolls();
  arm({ features: [{ name: "Portent", source: "subclass" }, { name: "Reliable Talent", source: "class" }], proficiencies: { ...TRAINED, saves: [], skills: ["arcana"] } });
  const out = await world.invoke("request_roll", { characterId: seer.id, kind: "skill_check", skill: "arcana", dc: 30, reason: "the runes" });
  assert.equal(out.ok, true, out.error);
  const [open] = waiting();
  assert.equal(open?.parkedFor, "foretold", "the check waits on Portent");
  world.signIn({ id: open.userId });
  const spent = await call(routes.portent, "POST", { value: 3 }, { campaignId: world.campaignId, pendingRollId: open.id });
  assert.equal(spent.status, 200, JSON.stringify(spent.json));
  const landed = rolls.listRecentRolls(world.campaignId, 20).find((roll) => roll.id === pending.getPendingRoll(open.id).rollId);
  // The foretold 3 is the d20 roll, and Reliable Talent treats a d20 roll of
  // 9 or lower as a 10 (the maintainer's decision R3 of the 2026-11-09 gap
  // sweep overturned #809's ruling that the number stands unlifted).
  assert.equal(landed.breakdown.natural, 3, "the number foretold is the roll's");
  const lead = landed.breakdown.terms[0];
  assert.equal(lead.subtotal, 10, `Reliable Talent lifts the foretold 3 to 10: ${JSON.stringify(landed.breakdown)}`);
  await clearRolls();
});
await row("809-foretold-number-on-the-sheet", { pr: 809, limit: "A foretold number shows on the wizard's sheet like the rest of its resources, so anyone who can open that sheet can see it.", rule: "-" }, async () => {});

await row("856-no-stop-at-a-person-run-table", {
  pr: 856,
  limit: "No stop on spell saves, on saves forced by enemy attacks or spells, at tables a person runs, or on the GM's \"run the monsters\" button.",
  rule: `SRD 5.1 Portent: "You can replace any attack roll, saving throw, or ability check made by you or a creature that you can see with one of these foretelling rolls." ${text("wizard::Portent")}`,
}, async () => {
  const { setDmMode } = await import("../src/lib/db/campaigns.ts");
  const [enemy] = await table.stage([seer, friend]);
  arm();
  kit.place(seer.id, 9, 9);
  kit.place(friend.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  (await import("../src/lib/events.ts")).subscribe(world.campaignId, () => {}, world.sheet(seer.id).userId);
  setDmMode(world.campaignId, "human", world.owner.id);
  try {
    world.signIn({ id: world.sheet(seer.id).userId });
    const watch = await call(routes.foresight, "POST", { on: true, characterId: seer.id }, { campaignId: world.campaignId });
    const before = rolls.listRecentRolls(world.campaignId, 200).filter((roll) => roll.kind === "attack").length;
    kit.freshRound();
    world.dice(10, 4);
    const swing = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: friend.id });
    world.clearDice();
    const thrown = rolls.listRecentRolls(world.campaignId, 200).filter((roll) => roll.kind === "attack").length - before;
    const stopped = waiting().filter((open) => open.parkedFor === "watch").length;
    assert.ok(watch.status === 200 && stopped === 1 && thrown === 0, `at a table a person runs the wizard cannot foretell a creature's attack: the watch answers ${watch.status} (${JSON.stringify(watch.json).slice(0, 160)}), ${stopped} roll(s) stop and ${thrown} were thrown (${swing.ok ? "the attack rolled" : swing.error})`);
  } finally {
    setDmMode(world.campaignId, "ai", world.owner.id);
    await clearRolls();
  }
});
await row("856-lucky-and-bardic-watch", { pr: 856, limit: "Lucky and Bardic Inspiration could use the same watch.", rule: "-" }, async () => {});

await kit.endFight();
world.close();
finish();
