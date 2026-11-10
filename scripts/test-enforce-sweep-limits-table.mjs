// The named leftovers that are not about one feature: supplies (#796), the
// siblings the classification named for thrown gear and conditions that
// outlive a fight (#849, #851, #854), feats the engine runs untagged (#855),
// tools that write before they refuse (#729, #766), items whose tool asks a
// question the Hand cannot answer (#828), and the follow-ups of #837.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { TRAINED } from "./lib/enforce-combat.mjs";
import { limitsSuite } from "./lib/sweep-limits.mjs";
import { limitsTable } from "./lib/sweep-limits-world.mjs";

const KNOWN = {
};
const RULING = {};
const SKIP = {
  "796-console-meal-field": "the console's and the assist rail's forms are screens: \"The assist rail's suggestions and held asks are not told the table's rules, so they still show it\" needs the browser harness.",
  "775-species-choice-phone-flake": "a browser scenario's flake on CI (focus on Add option); nothing a Node suite can run.",
  "863-alchemist-tool-pick": "walked by the builder package: every class and subclass's \"Fill what's left\" against the server's create route, pick by pick.",
};

const { row, finish } = limitsSuite("test-enforce-sweep-limits-table", { KNOWN, RULING, SKIP });
const repo = path.resolve(import.meta.dirname, "..");
const RULES = { flanking: false, criticalFumbles: false, encumbrance: false, lingeringInjuries: false, powerfulCritical: false, criticalDamageMods: false, ammunition: false, restVariant: "standard" };
const show = (out) => (out.ok ? JSON.stringify(out.result).slice(0, 260) : String(out.error));
const qty = (world, id, name) => world.sheet(id).equipment.filter((item) => item.name.toLowerCase() === name.toLowerCase()).reduce((sum, item) => sum + (item.qty ?? 1), 0);

// ---- #796: supplies ----

const { getClock, setClockInstant } = await import("../src/lib/db/clock.ts");
const DAY = 24 * 60;
await row("796-march-crosses-a-dawn-fed-free", {
  pr: 796,
  limit: "Dawns crossed by a single travel stretch of hours or miles, or by the GM's clock control, do not charge a lifestyle today, so a character with one is fed free on those dawns.",
  rule: "SRD 5.1, Food and Water: \"A character needs one pound of food per day\"; Lifestyle Expenses cover food and lodging for the days they are paid.",
}, async () => {
  const fed = await openWorld({ gameSettings: { variantRules: { ...RULES, supplies: true } } });
  setClockInstant(fed.campaignId, 10 * DAY + 20 * 60);
  const townie = fed.addHero({ class: "fighter", level: 3, maxHp: 30, abilities: { con: 30 }, gold: 50, equipment: [{ name: "Rations (1 day)", qty: 3 }, { name: "Waterskin", qty: 1 }] });
  assert.equal((await fed.invoke("set_lifestyle", { characterIds: [townie.id], lifestyle: "modest" })).ok, true);
  const marched = await fed.invoke("travel", { hours: 12 });
  assert.equal(marched.ok, true, marched.error);
  const paid = 50 - fed.sheet(townie.id).gold;
  const eaten = 3 - qty(fed, townie.id, "Rations (1 day)");
  assert.ok(paid > 0 || eaten === 1, `the dawn on the road cost neither the lifestyle nor a ration (paid ${paid} gp, ate ${eaten})`);
});
await row("796-downtime-work-eats-from-the-pack", {
  pr: 796,
  limit: "A character whose only way to afford a lifestyle is downtime work covering it, with an empty purse, eats from the pack during that downtime.",
  rule: "SRD 5.1, Practicing a Profession: \"You can work between adventures, allowing you to maintain a modest lifestyle without having to pay 1 gp per day.\"",
}, async () => {
  const fed = await openWorld({ gameSettings: { variantRules: { ...RULES, supplies: true } } });
  setClockInstant(fed.campaignId, 10 * DAY + 8 * 60);
  const smith = fed.addHero({ class: "fighter", level: 3, maxHp: 30, gold: 0, equipment: [{ name: "Rations (1 day)", qty: 3 }, { name: "Waterskin", qty: 1 }] });
  assert.equal((await fed.invoke("set_lifestyle", { characterIds: [smith.id], lifestyle: "modest" })).ok, true);
  const out = await fed.invoke("downtime", { days: 2, characterId: smith.id, activity: "profession" });
  assert.equal(out.ok, true, out.error);
  assert.equal(qty(fed, smith.id, "Rations (1 day)"), 3, "the work kept them, and they ate from the pack");
  assert.equal(fed.sheet(smith.id).exhaustion ?? 0, 0);
});
await row("796-console-meal-field", { pr: 796, limit: "The console hides the meal field with the variant off in its action list. The assist rail's suggestions and held asks still show it.", rule: "-" }, async () => {});
await row("775-species-choice-phone-flake", { pr: 775, limit: "A third flake, not fixed here: species-choice-phone.", rule: "-" }, async () => {});
await row("863-alchemist-tool-pick", { pr: 863, limit: "Left open in the body: an Alchemist artificer's tool pick filled with a tool the server refuses.", rule: "-" }, async () => {});

// ---- one table for the rest ----

const world = await openWorld({ campaign: { maxPlayers: 30 } });
const table = await limitsTable(world);
const { kit } = table;
const fighter = (extra = {}) => world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 16 }, proficiencies: TRAINED, ...extra });
const friend = fighter();
async function stage(hero, { count = 1, apart = 1 } = {}) {
  const foes = await table.stage([hero, friend], { count, first: hero, hp: 44 });
  kit.place(hero.id, 5, 5);
  kit.place(friend.id, 4, 5);
  foes.forEach((enemy, at) => kit.place(enemy.id, 5 + at * 2, 5 + apart));
  return foes;
}

// ---- #851: what the fight leaves on the sheet ----

await row("851-prone-after-healing-outside-a-fight", {
  pr: 851,
  limit: "Heroes who had dropped to 0 were still prone after a long rest. Left open in the body: healing outside a fight and pass_time.",
  rule: "SRD 5.1, Prone: \"You can stand up\" for half your speed; out of a fight nothing stops a character standing, so one healed and walking on is not prone when the next fight opens.",
}, async () => {
  const who = fighter();
  await kit.endFight();
  world.patch(who.id, { currentHp: 5 });
  const fell = await world.invoke("apply_damage", { characterId: who.id, amount: 10, type: "slashing" });
  assert.equal(fell.ok, true, fell.error);
  assert.ok(world.sheet(who.id).conditions.includes("prone"), "the fall left them prone");
  const healed = await world.invoke("heal", { characterId: who.id, amount: 10 });
  assert.equal(healed.ok, true, healed.error);
  const waited = await world.invoke("pass_time", { amount: 1, unit: "hours" });
  assert.equal(waited.ok, true, waited.error);
  // Read before any new fight is staged: the staging clears conditions.
  assert.ok(!world.sheet(who.id).conditions.includes("prone"), `healed, an hour on, they are still on the ground: ${JSON.stringify(world.sheet(who.id).conditions)}`);
  await world.beginFight([{ monster: "goblin", count: 1 }]);
  assert.ok(!world.sheet(who.id).conditions.includes("prone"), "the next fight opens with them prone");
});

// "Any condition whose only exit is an in-fight action or a turn tick": each
// laid by its own door in a fight, then the fight ends and ten minutes pass.
const LINGERERS = {
  dodging: (who) => world.invoke("take_action", { characterId: who.id, action: "dodge" }),
  readied: (who, enemy) => world.invoke("take_action", { characterId: who.id, action: "ready", readied: "attack", targetEnemyId: enemy.id, trigger: "when the goblin moves" }),
  disengaged: (who) => world.invoke("take_action", { characterId: who.id, action: "disengage" }),
  grappled: (who, enemy) => world.invoke("set_condition", { characterId: who.id, condition: "grappled", sourceEnemyId: enemy.id }),
  restrained: (who, enemy) => world.invoke("set_condition", { characterId: who.id, condition: "restrained", sourceEnemyId: enemy.id, rounds: 10 }),
  frightened: (who, enemy) => world.invoke("set_condition", { characterId: who.id, condition: "frightened", sourceEnemyId: enemy.id, rounds: 10 }),
};
for (const [name, lay] of Object.entries(LINGERERS)) {
  await row(`851-outlives-the-fight:${name}`, {
    pr: 851,
    limit: "Same shape: any condition whose only exit is an in-fight action or a turn tick (grappled by a dead or absent grappler, readied actions, dodging, held concentration marks, hidden).",
    rule: "SRD 5.1: Dodge and Ready last \"until the start of your next turn\"; Grappled \"ends if the grappler is incapacitated\" or gone; a condition counted in rounds ends when a minute has passed.",
  }, async () => {
    const who = fighter();
    const [enemy] = await stage(who);
    const laid = await lay(who, enemy);
    assert.equal(laid.ok, true, `the rig: ${laid.error}`);
    const carried = () => world.sheet(who.id).conditions.filter((entry) => entry.toLowerCase().startsWith(name === "disengaged" ? "disengag" : name));
    if (!carried().length && name !== "disengaged") throw new Error(`the rig: ${name} was not laid: ${JSON.stringify(world.sheet(who.id).conditions)}`);
    const ended = await world.invoke("end_encounter", { outcome: "victory" });
    assert.equal(ended.ok, true, ended.error);
    const waited = await world.invoke("pass_time", { amount: 10, unit: "minutes" });
    assert.equal(waited.ok, true, waited.error);
    assert.deepEqual(carried(), [], `the fight is over, its creature gone, ten minutes on, and the hero is still ${name}: ${JSON.stringify(world.sheet(who.id).conditionMeta?.[name] ?? null)}`);
  });
}

// ---- #849, #854: thrown gear ----

const THROWN = ["Oil (flask)", "Alchemist's Fire (flask)", "Acid (vial)", "Holy Water (flask)", "Net", "Caltrops (bag of 20)", "Ball Bearings (bag of 1,000)"];
for (const item of THROWN) {
  await row(`849-use_item-spends-and-does-nothing:${item}`, {
    pr: 849,
    limit: "The GM threw alchemist's fire with use_item: the flask and the action were spent and no attack was rolled. Left open in the body: oil thrown through use_item, a flask thrown at an object. Likely the same shape: nets, holy water sprinkled, caltrops and ball bearings.",
    rule: "A thing used through one tool does what it does through the other, or is refused with the tool to use: never spent for nothing (pull request #849).",
  }, async () => {
    const who = fighter({ equipment: [{ name: item, qty: 2 }] });
    const [enemy] = await stage(who);
    const board = () => {
      const { tokens, ...rest } = kit.map();
      return JSON.stringify(rest);
    };
    const before = { foe: JSON.stringify([kit.enemy(enemy.id).currentHp, kit.enemy(enemy.id).conditions]), board: board(), had: qty(world, who.id, item), conditions: JSON.stringify(world.sheet(who.id).conditions) };
    world.dice(15, 3, 3, 3);
    const out = await world.invoke("use_item", { characterId: who.id, item, reason: `throws the ${item} at the goblin` });
    world.clearDice();
    const spent = before.had - qty(world, who.id, item);
    const changed = JSON.stringify([kit.enemy(enemy.id).currentHp, kit.enemy(enemy.id).conditions]) !== before.foe || board() !== before.board || JSON.stringify(world.sheet(who.id).conditions) !== before.conditions;
    if (process.env.SWEEP_LIMITS_DEBUG) console.log(`use_item ${item}: ${show(out)} | spent ${spent} | changed ${changed}`);
    if (!out.ok) {
      assert.equal(spent, 0, `refused, and one is gone from the pack: ${out.error}`);
      return;
    }
    assert.ok(spent === 0 || changed, `use_item answered ok, took one ${item} from the pack, and nothing on the table changed: ${show(out)}`);
  });
}

for (const [weapon, feet] of [["Dagger", 20], ["Javelin", 30], ["Handaxe", 20], ["Dart", 20]]) {
  await row(`854-thrown-weapon-stays-in-hand:${weapon}`, {
    pr: 854,
    limit: "A net thrown from the hand stayed on the sheet, equipped. Left open in the body: daggers, javelins and other thrown weapons stay on the sheet. Also ammunition, darts, thrown improvised objects.",
    rule: "SRD 5.1, Thrown: \"If a weapon has the thrown property, you can throw the weapon to make a ranged attack.\" A weapon thrown is no longer in the hand that threw it.",
  }, async () => {
    const who = fighter({ equipment: [{ name: weapon, qty: 1, equipped: true }] });
    const [enemy] = await stage(who, { apart: feet / 5 });
    const inHand = () => world.sheet(who.id).equipment.filter((entry) => entry.name === weapon && entry.equipped && (entry.qty ?? 1) > 0);
    if (inHand().length !== 1) throw new Error(`the rig: the ${weapon} is not in hand before the throw: ${JSON.stringify(world.sheet(who.id).equipment)}`);
    const swing = await kit.swing(who.id, enemy.id, [15, 3], { weapon });
    assert.equal(swing.ok, true, swing.error);
    if (!/thrown|throw/i.test(JSON.stringify(swing.result)) && process.env.SWEEP_LIMITS_DEBUG) console.log(`throw ${weapon}: ${JSON.stringify(swing.result).slice(0, 300)}`);
    const held = inHand();
    assert.equal(held.length, 0, `thrown ${feet} feet, the one ${weapon} is still equipped on the sheet: a second throw is refused? ${(await kit.swing(who.id, enemy.id, [15, 3], { weapon })).ok ? "no, it is thrown again" : "yes"}`);
  });
}

// ---- #855: a feat the engine runs says so ----

await row("855-feat-run-without-a-tag", {
  pr: 855,
  limit: "The builder said nothing of Savage Attacker is applied by the table, though the engine rerolls its damage. Left open in the body: pack feats the engine runs without a tag (Stalwart, Tactical Support, the check riders).",
  rule: "A feat the engine reads by name is one the builder and the GM's prompt mark as applied by the table (src/lib/srd/feat-effects.ts engineFeatNames).",
}, async () => {
  const { engineFeatNamed } = await import("../src/lib/srd/feat-effects.ts");
  const { featEngineTag } = await import("../src/lib/srd/feat-combat.ts");
  // What the builder's reading asks (src/lib/content/feat-reading-logic.ts readFeat).
  const tagged = (name) => Boolean(engineFeatNamed(name) || featEngineTag(name));
  // Every feat name the engine asks a sheet for, read off the source.
  const asked = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.ts$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
        const source = fs.readFileSync(full, "utf8");
        for (const match of source.matchAll(/\b(?:holdsFeat|hasFeat)\(\s*[^,()]+,\s*"([^"]+)"/g)) {
          asked.set(match[1], path.relative(repo, full));
        }
      }
    }
  };
  walk(path.join(repo, "src/lib/dm"));
  walk(path.join(repo, "src/lib/srd"));
  assert.ok(asked.size >= 10, `only ${asked.size} feat names were found in the source, so this row proves nothing`);
  // Not feats: a warlock invocation read through the same helper, and the helper's own parameter.
  const NOT_FEATS = new Set(["book of ancient secrets", "feats"]);
  const untagged = [...asked].filter(([name]) => !NOT_FEATS.has(name) && !tagged(name)).map(([name, file]) => `${name} (${file})`);
  assert.equal(untagged.length, 0, `the engine reads ${untagged.length} feat(s) by name that engineFeatNames() does not list: ${untagged.join("; ")}`);
});

// ---- #729, #766: refused before anything is written ----

await row("729-march-naming-nobody", {
  pr: 729,
  limit: "A march naming nobody at the table was refused only after the clock, world, sky, water and pace had moved, and the retry walked them again.",
  rule: "A refused call leaves the table as it was (src/lib/dm/tool-errors.ts).",
}, async () => {
  await kit.endFight();
  const before = JSON.stringify(getClock(world.campaignId));
  const out = await world.invoke("travel", { hours: 6, characterIds: ["nobody-at-this-table"] });
  assert.equal(out.ok, false, show(out));
  assert.equal(JSON.stringify(getClock(world.campaignId)), before, "the refusal moved the clock");
});

for (const distanceFeet of [30, 120, 600, 5000]) {
  await row(`766-opening-distance:${distanceFeet}`, {
    pr: 766,
    limit: "start_encounter with a long distanceFeet threw after the encounter and its map were written, so the table played on a black board with no tokens. Other generator inputs that can yield an empty candidate list (many enemies on a small board, large creatures, walls).",
    rule: "A fight either opens with everybody on the board or does not open.",
  }, async () => {
    await kit.endFight();
    world.clearDice();
    let out;
    try {
      out = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 8 }], distanceFeet });
    } catch (error) {
      out = { ok: false, error: `threw: ${error.message}` };
    }
    const encounter = world.encounter();
    if (!out.ok) {
      assert.equal(encounter, null, `refused (${out.error}), and a fight stands`);
      return;
    }
    const board = kit.map();
    assert.ok(board, "the fight has no board");
    const missing = world.enemies().filter((enemy) => !kit.token(enemy.id)).length + world.sheets().filter((sheet) => !kit.token(sheet.id)).length;
    assert.equal(missing, 0, `${missing} of the fight's creatures have no token`);
    await kit.endFight();
  });
}

// ---- #828: a staff with several spells ----

await row("828-item-asks-which-spell", {
  pr: 828,
  limit: "A ring holding several spells answered use_item with 'which one?'. Other items or features whose tool asks a follow-up question the Hand cannot answer (charged staffs with several spells).",
  rule: "Each thing a player can do from an item is a card that plays without a question (pull request #828).",
}, async () => {
  const { directCardCall, directCardCalls } = await import("../src/lib/dm/intent-logic.ts");
  const mage = world.addHero({ class: "wizard", level: 9, maxHp: 44, abilities: { int: 16 }, proficiencies: TRAINED, spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: [], cantrips: ["Fire Bolt"] } });
  await kit.endFight();
  const given = await world.invoke("grant_item", { characterId: mage.id, item: "Staff of Fire" });
  assert.equal(given.ok, true, given.error);
  const sheet = world.sheet(mage.id);
  world.patch(mage.id, { equipment: sheet.equipment.map((entry) => (/staff of fire/i.test(entry.name) ? { ...entry, equipped: true, attuned: true } : entry)) });
  const [enemy] = await stage(mage, { apart: 3 });
  const cards = table.deriveHand(world.sheet(mage.id), table.FRESH_TURN, {}).filter((card) => /staff of fire/i.test(`${card.id} ${card.name} ${JSON.stringify(card.intent)}`));
  assert.ok(cards.length >= 3, `the staff's three spells are ${cards.length} card(s): ${cards.map((card) => card.name).join(", ")}`);
  for (const card of cards) {
    assert.ok(card.intent.item && card.intent.spell, `${card.name}: the card does not name its staff and its spell: ${JSON.stringify(card.intent)}`);
    // The draw from the staff, as the Hand sends it before the spell is aimed.
    const calls = directCardCalls({ ...card.intent, targetId: enemy.id, targetKind: "enemy" }, mage.id, { inFight: true, ringBegins: true });
    assert.equal(calls?.[0]?.name, "use_item", `${card.name}: ${JSON.stringify(calls)}`);
    assert.equal(calls[0].args.spell, card.intent.spell);
  }
  const fire = cards.find((card) => /burning hands/i.test(card.intent.spell));
  const [draw] = directCardCalls({ ...fire.intent }, mage.id, { inFight: true, ringBegins: true });
  const out = await world.invoke(draw.name, draw.args);
  assert.equal(out.ok, true, `the staff asks a question the card cannot answer: ${out.error}`);
});

// ---- #837 ----

await row("837-a-colour-is-not-a-feature", {
  pr: 837,
  limit: "The ten colours were read as feature names on their own, so a workshop species choice labelled \"Gold\" was refused and use_reaction \"Red\" was told the rules knew it.",
  rule: "A reaction named for nothing the character holds is sent back as a slip, not refused as a rule (src/lib/dm/tool-errors.ts).",
}, async () => {
  const who = fighter();
  const [enemy] = await stage(who);
  await table.strike(enemy, who);
  const out = await world.invoke("use_reaction", { characterId: who.id, feature: "Red" });
  assert.equal(out.ok, false);
  assert.doesNotMatch(out.error, /dragon|ancestor|is not a reaction the rules/i, out.error);
});

await kit.endFight();
world.close();
finish();
