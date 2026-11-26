// The rules that read a stored roll back, each run at its own site: they go
// by the roll's fields, and by its words only for a row that has no fields
// (src/lib/roll-parts.ts, issue #1064).
//
// A roll's `detail` is a sentence written for the table ("Longsword vs
// Goblin", "CON save to keep concentration (Bless)"). Rules found their fact
// in it: the weapon last swung, the ability of a failed save, whether a save
// was the one that keeps a spell. Rewording a card could break a rule without
// a test noticing. A roll now stores those facts as fields beside the
// sentence (rolls.parts_json), and a roll that has fields is read by them
// alone. Only a row stored before the column, which has none, is still read
// by its words.
//
// This suite is not about the readers in that module. It holds the sites that
// call them, so a site that goes back to matching words, or that skips the
// reader for an old row, fails here. Each site is run through its own door on
// a roll put on record three ways:
//   - words that say one thing and fields that say another: the rule follows
//     the fields;
//   - a row from before the column (parts_json NULL) whose words name the
//     fact: the rule follows the words, as it always did;
//   - parts that name nothing ('{}') beside words that name the fact: the
//     rule finds nothing, as it must for every roll stored from now on.
//
// The sites:
//   - the weapon a fight's start puts in the hand of a character who never
//     said what they hold: the one their last attack roll used
//     (src/lib/db/sheets.ts settleHeldGear);
//   - the save a swing's damage asked of a concentrating character, kept on
//     the hit's record (src/lib/dm/last-hit.ts openLastHit);
//   - Arcane Deflection's +4 on a failed save: which ability it was, and the
//     refusal of the save that keeps concentration
//     (src/lib/dm/ar-ws-deflection.ts);
//   - an AI GM lifting a trap's hold after the check the trap's escape takes
//     (src/lib/dm/ai-gate.ts escapeRolled);
//   - the rerolls of a failed save: Fanatical Focus
//     (src/lib/dm/authored-spend-more.ts rerollLastSave), Indomitable and the
//     ally Bulwark brings along (src/lib/dm/feature-spends.ts), Peer Review
//     and The Final Chapter (src/lib/dm/genre-gh-horror-plays.ts). Each
//     rerolls the save's ability, against what the save resisted;
//   - the rerolls of a check: The Final Chapter (a skill check with its
//     skill, a bare one with its ability), Grease the Wheels
//     (src/lib/dm/genre-a-cyberpunk-spends.ts grease) and the reroll Silver
//     Tongue makes (src/lib/dm/genre-cc-a-checks.ts rerollFailedCheck).
//
// And one site that writes: a storm's save to keep concentration
// (src/lib/dm/spell-riders.ts concentrationShaken) words it "to keep
// concentrating", which no rule that read words ever found. It says what
// it is in a field now, like the other sites that roll that save.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-roll-parts-sites");
const world = await openWorld({ campaign: { maxPlayers: 8 } });
const kit = await combatKit(world);

const { CUSTOM_CLASS_FEATURES } = await import("../src/lib/classes/index.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { settleHeldGear } = await import("../src/lib/db/sheets.ts");
const { rollExpression } = await import("../src/lib/dice.ts");
const { rerollFailedCheck } = await import("../src/lib/dm/genre-cc-a-checks.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { openLastHit, readLastHit } = await import("../src/lib/dm/last-hit.ts");
const { recordRoll } = await import("../src/lib/dm/roll-record.ts");
const { attackParts, checkParts, rollKeepsConcentration, saveParts } = await import("../src/lib/roll-parts.ts");
const { concentrationShaken } = await import("../src/lib/dm/spell-riders.ts");

// Scores far enough apart that a roll's modifier says which ability it used.
const SCORES = { str: 10, dex: 8, con: 12, int: 10, wis: 18, cha: 16 };
const d20 = (face) => rollExpression("1d20", () => face);

// A roll on record as a site hands it to the door: a 2 against DC 15 unless
// the case says otherwise, so a save or a check is a failed one.
const onRecord = (hero, kind, detail, parts, more = {}) =>
  recordRoll({ campaignId: world.campaignId, characterId: hero.id, requestedBy: "dm", kind, detail, parts, dc: 15, result: d20(2), ...more });

// The same roll as a row from before the column: its sentence and no parts.
function beforeParts(hero, kind, detail, more) {
  const roll = onRecord(hero, kind, detail, undefined, more);
  getDatabase().prepare("UPDATE rolls SET parts_json = NULL WHERE id = ?").run(roll.id);
  return roll;
}

// Every site looks through the table's recent rolls for the one it answers,
// so each case starts from an empty record: its roll is the only one to find.
const forget = () => getDatabase().prepare("DELETE FROM rolls WHERE campaign_id = ?").run(world.campaignId);

// ---- the weapon in hand as a fight begins ----

// A dwarf, for the rerolls further down: a dwarf saves against poison with
// advantage, so what a reroll was told the save resists shows in its dice.
// The pack marks nothing, so a fight's start guesses the hand: the first
// weapon that fits, the longsword, unless the last attack roll names another.
const borin = world.addHero({
  name: "Borin", race: "dwarf", class: "fighter", level: 5, abilities: SCORES, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }, { name: "Mace", qty: 1 }],
});

function inHandAfter(lay) {
  forget();
  lay();
  settleHeldGear(world.campaignId);
  return world.sheet(borin.id).equipment.filter((item) => item.equipped).map((item) => item.name);
}
const swing = { attacker: { kind: "sheet", id: borin.id, name: "Borin" }, dc: null, result: d20(12) };
// The weapon as an attack roll's fields say it, beside words of the case's
// own. The builder's whole parts make the roll's words too (issue #1064,
// step 2), and the door then stores a sentence that cannot disagree with
// them: these cases are about a roll whose words say something else.
const madeWith = (name) => ({ used: attackParts({ name, base: name }, { kind: "enemy", id: "a-goblin", name: "Goblin" }).used });

await test("the weapon taken in hand as a fight begins is the one the last attack roll's fields name, the mace, though its words say the longsword", () => {
  assert.deepEqual(inHandAfter(() => onRecord(borin, "attack", "Longsword vs Goblin", madeWith("Mace"), swing)), ["Mace"]);
});

await test("an attack roll stored before rolls kept their parts puts the weapon its words name in hand, the mace", () => {
  assert.deepEqual(inHandAfter(() => beforeParts(borin, "attack", "Mace vs Goblin", swing)), ["Mace"]);
});

await test("a creature's attack on the character, and their pet's, rolled since, do not take the weapon they last swung out of hand: the last attack roll is the one they made", () => {
  // Both are filed under the character: the target of the one, the owner of the other.
  const goblin = { attacker: { kind: "enemy", id: "a-goblin", name: "Goblin" }, dc: null, result: d20(9) };
  const hound = { attacker: { kind: "pet", id: borin.id, name: "Hound" }, dc: null, result: d20(11) };
  const held = inHandAfter(() => {
    onRecord(borin, "attack", "Mace vs Goblin", madeWith("Mace"), swing);
    onRecord(borin, "attack", "Scimitar vs Borin", {}, goblin);
    onRecord(borin, "attack", "Bite vs Goblin", {}, hound);
  });
  assert.deepEqual(held, ["Mace"]);
});

await test("an attack roll whose parts name no weapon puts none in hand by its words: the guess stays the first weapon that fits, the longsword", () => {
  assert.deepEqual(inHandAfter(() => onRecord(borin, "attack", "Mace vs Goblin", {}, swing)), ["Longsword"]);
});

// ---- the save a hit asked of a concentrating caster ----

const wim = world.addHero({
  name: "Wim", class: "wizard", subclass: "War Magic", level: 6, maxHp: 30, abilities: SCORES, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Bless"], known: [], cantrips: [] },
});

// One swing that hits a caster holding Bless, the way the code that rolls an
// attack logs it, with the save put on record between the blow and its log:
// what the hit's record says of that swing's concentration.
function concentrationLogged(lay) {
  forget();
  world.patch(wim.id, { concentratingOn: "Bless" });
  const log = openLastHit(world.campaignId, wim.id);
  lay();
  log.swing(d20(17), 12, { hit: true, crit: false, raw: 5, advantage: "none" });
  log.close({ attacker: { kind: "enemy", id: null, name: "Goblin" }, attack: "Club", type: "bludgeoning", ranged: false });
  world.patch(wim.id, { concentratingOn: null });
  return readLastHit(world.campaignId, wim.id)?.swings.at(-1)?.concentration;
}
const KEEPS = "CON save to keep concentration (Bless)";

await test("a hit's record keeps the save whose fields say it was rolled to keep concentration, though its words say a Wisdom save against fear", () => {
  assert.deepEqual(concentrationLogged(() => onRecord(wim, "saving_throw", "WIS save vs. fear", saveParts("con", "concentration"))), { save: 2, broke: false });
});

await test("a hit's record keeps a concentration save stored before rolls kept their parts, found by its words", () => {
  assert.deepEqual(concentrationLogged(() => beforeParts(wim, "saving_throw", KEEPS)), { save: 2, broke: false });
});

await test("a hit's record keeps no save whose parts name no purpose, though its words say it was rolled to keep concentration", () => {
  assert.deepEqual(concentrationLogged(() => onRecord(wim, "saving_throw", KEEPS, {})), { save: null, broke: false });
});

// ---- an AI GM lifting a trap's hold ----

// A falling net over the dwarf, then one call of an AI GM's turn to lift it
// by hand, with a check put on that turn first, as one that GM asked for
// with request_roll (the gate reads no other, issue #1073): the escape
// takes Strength or Athletics against DC 10, and the check came to 15.
async function netLifted(kind, detail, parts) {
  forget();
  world.patch(borin.id, { conditions: [], conditionMeta: {} });
  const net = await world.invoke("apply_hazard", { type: "trap", trap: "Falling Net", characterIds: [borin.id], reason: "the crypt stair" });
  assert.equal(net.ok, true, net.error);
  const turn = createDmTurn(world.campaignId, [], "ai");
  const check = { turnId: turn.id, asked: true, dc: 10, result: d20(15) };
  if (parts === null) {
    beforeParts(borin, kind, detail, check);
  } else {
    onRecord(borin, kind, detail, parts, check);
  }
  const out = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "clear_condition", args: { characterId: borin.id, condition: "restrained", reason: "the net comes off" } });
  const held = world.sheet(borin.id).conditions.includes("restrained");
  assert.equal(out.ok, !held, `the call's answer and the sheet disagree: ${out.error}`);
  return !held;
}

await test("an AI GM lifts a net after a check whose fields say Athletics or Strength, whatever its words say, and not after one whose fields say Perception", async () => {
  assert.equal(await netLifted("skill_check", "Perception to find the net's edge", checkParts({ skill: "athletics" })), true, "Athletics by its fields");
  assert.equal(await netLifted("ability_check", "Dexterity check to wriggle free", checkParts({ ability: "str" })), true, "Strength by its fields");
  assert.equal(await netLifted("skill_check", "Athletics to heave the net off", checkParts({ skill: "perception" })), false, "Perception by its fields");
});

await test("an AI GM lifts a net after a check stored before rolls kept their parts whose words say Athletics or Strength", async () => {
  assert.equal(await netLifted("skill_check", "Athletics to heave the net off", null), true, "Athletics by its words");
  assert.equal(await netLifted("ability_check", "Strength check to heave the net off", null), true, "Strength by its words");
});

await test("an AI GM does not lift a net after a check whose parts name nothing, though its words say Athletics", async () => {
  assert.equal(await netLifted("skill_check", "Athletics to heave the net off", {}), false);
});

// ---- Arcane Deflection's +4 on a failed save ----

// The wizard's reaction to a save just failed: a 12 against DC 15, which the
// +4 turns. The fight is the dwarf's turn, so the wizard's reaction is open.
await kit.fight(1, { heroFaces: { [borin.id]: 19, [wim.id]: 5 } });

async function deflected(lay, held = false) {
  forget();
  kit.saveEncounter({ ...world.encounter(), reactionsUsed: [] });
  // Paralyzed by the save in question, where the case says so: the reaction
  // is theirs only if that save is the one the call answers, and turning it
  // frees them. Both go by the failed save's ability.
  world.patch(wim.id, held ? { conditions: ["paralyzed"], conditionMeta: { paralyzed: { saveEnds: { ability: "wis", dc: 15 } } } } : { conditions: [], conditionMeta: {} });
  lay({ result: d20(12) });
  const out = await world.invoke("use_reaction", { characterId: wim.id, feature: "Arcane Deflection", variant: "save" });
  return { ...out, held: world.sheet(wim.id).conditions.includes("paralyzed") };
}
const NOT_THAT_SAVE = /cannot turn the save to keep concentration/;

await test("Arcane Deflection turns a failed save whose fields say Wisdom, and frees the wizard that save paralyzed, though its words say the Constitution save that keeps concentration", async () => {
  const out = await deflected((roll) => onRecord(wim, "saving_throw", KEEPS, saveParts("wis"), roll), true);
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.applied, /\+4 on the WIS save: 12 becomes 16 against DC 15/);
  assert.equal(out.held, false, "the paralysis a Wisdom save ends still holds");
});

await test("Arcane Deflection refuses a failed save whose fields say it was rolled to keep concentration, though its words say a Wisdom save against fear", async () => {
  const out = await deflected((roll) => onRecord(wim, "saving_throw", "WIS save vs. fear", saveParts("con", "concentration"), roll));
  assert.match(out.error ?? "", NOT_THAT_SAVE);
});

await test("Arcane Deflection reads a failed save stored before rolls kept their parts by its words: a Wisdom save is turned and its paralysis ends, and the save that keeps concentration is refused", async () => {
  const turned = await deflected((roll) => beforeParts(wim, "saving_throw", "Wim: WIS save, a binding gaze", roll), true);
  assert.equal(turned.ok, true, turned.error);
  assert.match(turned.result.applied, /\+4 on the WIS save/);
  assert.equal(turned.held, false, "the paralysis a Wisdom save ends still holds");
  const refused = await deflected((roll) => beforeParts(wim, "saving_throw", KEEPS, roll));
  assert.match(refused.error ?? "", NOT_THAT_SAVE);
});

await test("Arcane Deflection takes neither an ability nor a purpose from the words of a failed save whose parts name nothing", async () => {
  const out = await deflected((roll) => onRecord(wim, "saving_throw", KEEPS, {}, roll));
  assert.equal(out.ok, true, `refused by the save's words: ${out.error}`);
  assert.match(out.result.applied, /\+4 on the save: 12 becomes 16/);
  // The wizard a Wisdom save paralyzed is not judged as they stood before a
  // save that only says "WIS" in its words: paralyzed, they have no reaction.
  const held = await deflected((roll) => onRecord(wim, "saving_throw", "Wim: WIS save, a binding gaze", {}, roll), true);
  assert.equal(held.ok, false, "the paralysis was set aside by the save's words");
  assert.equal(held.held, true);
});

await kit.endFight();

// ---- the rerolls of a failed save or check ----

// One failed roll told three ways: `other` are words that say something else,
// beside `fields`; `words` name the fact, in a row from before the column and
// beside parts that name nothing. `again` matches the reroll when the rule
// read the roll as `is`: what the reroll's own fields say it was made with,
// then its dice ("wis 2d20kh1+4", a dwarf's two d20s against poison).
const SAVE = {
  kind: "saving_throw", what: "a failed save", is: "a Wisdom save against poison",
  other: "DEX save vs. fear", fields: { ...saveParts("wis"), resists: "poison" }, words: "WIS save vs. poison",
  again: /^wis 2d20kh1/,
};
const skillCheck = (skill, name) => ({
  kind: "skill_check", what: "a failed check", is: `a ${name} check`,
  other: "Athletics to climb the wall", fields: checkParts({ skill }), words: `${name} to talk the guard round`,
  again: new RegExp(`^${skill} `),
});
const abilityCheck = (ability, name) => ({
  kind: "ability_check", what: "a failed check", is: `a ${name} check`,
  other: "Strength check to lift the gate", fields: checkParts({ ability }), words: `${name} check to hold the room`,
  again: new RegExp(`^${ability} `),
});

// A hero of one of the genres' classes, at the level its feature arrives.
function genreHero(classId, level, more = {}) {
  const table = CUSTOM_CLASS_FEATURES[classId];
  return world.addHero({ user: world.addUser(), name: classId, class: classId, subclass: level >= table.subclassLevel ? table.subclasses[0].name : "", level, abilities: SCORES, proficiencies: TRAINED, ...more });
}
const zealot = world.addHero({ user: world.addUser(), name: "Zeal", race: "dwarf", class: "barbarian", subclass: "Path of the Zealot", level: 6, abilities: SCORES, proficiencies: TRAINED });
const marshal = world.addHero({ user: world.addUser(), name: "Marsh", race: "dwarf", class: "fighter", subclass: "Banneret", level: 18, abilities: SCORES, proficiencies: TRAINED });
const fixer = genreHero("fixer", 1);
const reader = genreHero("parapsychologist", 6);
const occultist = genreHero("occultist", 18, { race: "dwarf" });
// Fanatical Focus is once a rage.
assert.equal((await world.invoke("use_resource", { characterId: zealot.id, resource: "Rage" })).ok, true, "the zealot does not rage");

const spend = (hero, resource, args = {}) => () => world.invoke("use_resource", { characterId: hero.id, resource, ...args });
const NO_SAVE = /no failed saving throw to reroll/;
const NO_CHA_CHECK = /no Charisma-based check/;

// `of` is the character whose failed roll is read and rolled again, `by` the
// one who spends. `refusal` is what the spend answers when it finds no roll
// to read; with none, the spend goes ahead and only that reroll is not made.
const SITES = [
  { name: "Fanatical Focus", roll: SAVE, of: zealot, by: zealot, spend: spend(zealot, "Fanatical Focus"), refusal: NO_SAVE },
  { name: "Indomitable", roll: SAVE, of: marshal, by: marshal, spend: spend(marshal, "Indomitable"), refusal: NO_SAVE },
  {
    // The marshal's own failed save first, which Indomitable rerolls: Bulwark
    // then looks for an ally who failed a save of the same ability and DC.
    name: "Bulwark", roll: SAVE, of: borin, by: marshal, spend: spend(marshal, "Indomitable"),
    first: () => onRecord(marshal, SAVE.kind, "Marsh: the marshal's own save", SAVE.fields),
  },
  { name: "Peer Review", roll: SAVE, of: borin, by: reader, spend: spend(reader, "Peer Review", { targetCharacterId: borin.id }), refusal: /no failed Intelligence, Wisdom or Charisma save/ },
  { name: "The Final Chapter", roll: SAVE, of: occultist, by: occultist, spend: spend(occultist, "The Final Chapter"), refusal: /no save or check this turn/ },
  // With no ability or skill read, The Final Chapter still rolls a check
  // again, as a bare one: what it must not do is take either from the words.
  { name: "The Final Chapter", roll: abilityCheck("wis", "Wisdom"), of: occultist, by: occultist, spend: spend(occultist, "The Final Chapter") },
  { name: "The Final Chapter", roll: skillCheck("persuasion", "Persuasion"), of: occultist, by: occultist, spend: spend(occultist, "The Final Chapter") },
  { name: "Grease the Wheels", roll: skillCheck("persuasion", "Persuasion"), of: fixer, by: fixer, spend: spend(fixer, "Grease the Wheels"), refusal: NO_CHA_CHECK },
  { name: "Grease the Wheels", roll: abilityCheck("cha", "Charisma"), of: fixer, by: fixer, spend: spend(fixer, "Grease the Wheels"), refusal: NO_CHA_CHECK },
  {
    name: "Silver Tongue's reroll", roll: skillCheck("deception", "Deception"), of: borin, by: borin,
    spend: () => {
      const out = rerollFailedCheck(world.campaign(), world.sheet(borin.id), "Silver Tongue", ["deception", "persuasion"]);
      return "error" in out ? { ok: false, error: out.error } : { ok: true, result: out.result };
    },
    refusal: /no Deception or Persuasion check/,
  },
];

// Each spender as they stand before any case, put back before each one: a
// use spent on one case, or the mark of a rage's one use, must not refuse
// the next.
const rested = new Map(
  SITES.map(({ by }) => {
    const { resources, conditions, conditionMeta } = world.sheet(by.id);
    return [by.id, { resources, conditions, conditionMeta }];
  }),
);

for (const site of SITES) {
  const { roll, of } = site;
  // The spend's answer, and every roll it made for the character: the reroll.
  async function spentOn(lay) {
    forget();
    world.patch(site.by.id, rested.get(site.by.id));
    site.first?.();
    const failed = lay();
    const out = await site.spend();
    const made = listRecentRolls(world.campaignId, 20).filter((entry) => entry.characterId === of.id && entry.id !== failed.id);
    return { out, made: made.map((entry) => `${entry.parts?.used?.key} ${entry.expression}`) };
  }
  const rerolledAsSaid = ({ out, made }) => {
    assert.equal(out.ok, true, out.error);
    assert.equal(made.length, 1, `${made.length} rolls made: ${made.join("; ")}`);
    assert.match(made[0], roll.again);
  };

  await test(`${site.name}: ${roll.what} whose words say "${roll.other}" and whose fields say ${roll.is} is rolled again as ${roll.is}`, async () => {
    rerolledAsSaid(await spentOn(() => onRecord(of, roll.kind, roll.other, roll.fields)));
  });

  await test(`${site.name}: ${roll.what} stored before rolls kept their parts is rolled again as its words say, ${roll.is}`, async () => {
    rerolledAsSaid(await spentOn(() => beforeParts(of, roll.kind, roll.words)));
  });

  await test(`${site.name}: ${roll.what} whose parts name nothing is not rolled again as ${roll.is}, though its words say "${roll.words}"`, async () => {
    const { out, made } = await spentOn(() => onRecord(of, roll.kind, roll.words, {}));
    assert.deepEqual(made.filter((entry) => roll.again.test(entry)), [], "the roll was read by its words");
    if (site.refusal) {
      assert.equal(out.ok, false, `rolled again: ${made.join("; ")}`);
      assert.match(out.error, site.refusal);
    } else {
      assert.equal(out.ok, true, out.error);
    }
  });
}

// ---- a site that rolls the save to keep concentration ----

await test("the save a storm asks of a concentrating caster says in a field that it keeps concentration, whatever words the storm gives it", () => {
  forget();
  world.patch(wim.id, { concentratingOn: "Bless" });
  concentrationShaken(world.campaign(), createDmTurn(world.campaignId, [], "ai"), { riders: { concentrationSave: "con" } }, 13, { enemies: [], characters: [world.sheet(wim.id)] });
  world.patch(wim.id, { concentratingOn: null });
  const [save] = listRecentRolls(world.campaignId, 20).filter((roll) => roll.characterId === wim.id && roll.kind === "saving_throw");
  assert.ok(save, "the storm asked no save of the caster");
  assert.doesNotMatch(save.detail, /to keep concentration\b/, "the storm's words changed: this case no longer shows a field deciding");
  assert.equal(rollKeepsConcentration(save), true);
});

world.close();
finish();
