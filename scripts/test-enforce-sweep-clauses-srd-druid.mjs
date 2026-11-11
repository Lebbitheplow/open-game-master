// The clause ledger's probes for the druid (SRD 5.1) and the Circle of the
// Land. The clause text and the verdict live in scripts/clauses/srd-classes.json;
// this file holds how each clause that names it is staged.
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig, slots, TRAINED } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const druid = (t, level, extra = {}) => t.hero({ class: "druid", level, ...extra, abilities: { wis: 16, ...(extra.abilities ?? {}) } });
const P = {};

P["druid.wild-shape.uses"] = async () => {
  const t = await rig.table();
  const who = druid(t, 2);
  const id = Object.keys(t.sheet(who).resources ?? {}).find((key) => /wild.?shape/i.test(key));
  assert.ok(id, `no Wild Shape counter: ${Object.keys(t.sheet(who).resources ?? {}).join(", ")}`);
  assert.equal(t.max(who, id), 2, "twice");
  t.patch(who, { resources: { ...t.sheet(who).resources, [id]: { ...t.sheet(who).resources[id], used: 2 } } });
  const out = await t.rest("short");
  assert.equal(out.ok, true, out.error);
  assert.equal(t.used(who, id), 0, "a short rest gives the uses back");
};

P["druid.natures-ward.poison"] = async () => {
  const t = await rig.table();
  const who = druid(t, 10, { subclass: "Circle of the Land" });
  const before = t.sheet(who).currentHp;
  const hurt = await t.damage(who, 10, "poison");
  assert.equal(hurt.ok, true, hurt.error);
  assert.equal(t.sheet(who).currentHp, before, `poison damage reached a 10th-level Land druid: ${before - t.sheet(who).currentHp}`);
  const poisoned = await t.condition(who, "poisoned");
  assert.ok(!t.has(who, "poisoned"), `the poisoned condition landed: ${poisoned.ok ? "accepted" : poisoned.error}`);
};

P["druid.natures-ward.fey-charm"] = async () => {
  const t = await rig.table();
  const who = druid(t, 10, { subclass: "Circle of the Land" });
  const control = druid(t, 10);
  const [foe] = await t.fight([who, control], { foe: { type: "fey" } });
  await t.condition(control, "charmed", { sourceEnemyId: foe.id });
  assert.ok(t.has(control, "charmed"), "the staging: a druid of no circle is not charmed either");
  const out = await t.condition(who, "charmed", { sourceEnemyId: foe.id });
  assert.ok(!t.has(who, "charmed"), `a fey's charm landed on a 10th-level Land druid: ${out.ok ? "accepted" : out.error}`);
};

// Circle Spells' seven tables: a Land druid who chose the terrain has each
// row's spells at its level and not before (src/lib/srd/features.ts
// subclassSpellsFor, the list the sheet adds always prepared). The rows are
// read from the rulebook's own text, the clauses the ledger holds.
P["druid.circle-spells.tables"] = async () => {
  const { subclassSpellsFor } = await import("../src/lib/srd/features.ts");
  const fs = await import("node:fs");
  const ledger = JSON.parse(fs.readFileSync(new URL("./clauses/srd-classes.json", import.meta.url), "utf8"))["druid::Circle Spells"];
  const wrong = [];
  let terrain = null;
  let rows = 0;
  for (const { c } of ledger.clauses) {
    const title = /^\*\*Table- (\w+) Circle Spells\*\*$/.exec(c);
    if (title) {
      terrain = title[1];
      continue;
    }
    const row = /^\| (\d+)\w\w\s+\| ([^|]+?)\s*\|\|?$/.exec(c);
    if (!row || !terrain) continue;
    rows += 1;
    const level = Number(row[1]);
    const features = [{ name: `Circle Spells (${terrain})` }];
    const at = subclassSpellsFor("druid", "Circle of the Land", level, undefined, features).map((name) => name.toLowerCase());
    const before = subclassSpellsFor("druid", "Circle of the Land", level - 1, undefined, features).map((name) => name.toLowerCase());
    for (const spell of row[2].split(",").map((name) => name.trim().toLowerCase())) {
      if (!at.includes(spell)) wrong.push(`${terrain} ${level}: no ${spell}`);
      if (before.includes(spell)) wrong.push(`${terrain} ${level - 1}: ${spell} early`);
    }
  }
  assert.equal(rows, 28, "the staging: the rulebook's seven tables of four rows");
  assert.deepEqual(wrong, [], "Circle Spells against the rulebook's tables");
};

// ---- Wild Shape ----

const shape = async (t, who, form = "Wolf") => {
  const out = await t.use(who, "wild shape", { form });
  assert.equal(out.ok, true, out.error);
  assert.equal(t.sheet(who).wildShape?.form, form, "the staging: the druid wears the form");
  return out;
};

P["druid.wild-shape.pick"] = async () => {
  const t = await rig.table();
  const who = druid(t, 4);
  await t.fight([who]);
  const bare = await t.use(who, "wild shape");
  assert.equal(bare.ok, false, "a Wild Shape that names no beast was taken");
  assert.match(String(bare.error), /Wolf/, "the refusal names the beasts the druid can take");
  assert.equal(t.used(who, "wild_shape"), 0, "the refused change spent a use");
  await shape(t, who);
  assert.equal(t.budget().actionUsed, true, "the action");
  assert.equal(t.used(who, "wild_shape"), 1);
};

P["druid.wild-shape.hours"] = async () => {
  const t = await rig.table();
  const who = druid(t, 4);
  await shape(t, who);
  // Half the druid level, rounded down: two hours at 4th.
  assert.equal((await t.invoke("pass_time", { amount: 119, unit: "minutes" })).ok, true);
  assert.ok(t.sheet(who).wildShape, "the shape ended before its two hours");
  assert.equal((await t.invoke("pass_time", { amount: 2, unit: "minutes" })).ok, true);
  assert.equal(t.sheet(who).wildShape ?? null, null, "the shape outlasted its two hours");
  // "unless you expend another use of this feature".
  await shape(t, who);
  assert.equal(t.used(who, "wild_shape"), 2, "the second shape spent the second use");
};

P["druid.wild-shape.revert-bonus"] = async () => {
  const t = await rig.table();
  const who = druid(t, 4);
  await t.fight([who]);
  await shape(t, who);
  t.freshTurn();
  const back = await t.use(who, "wild shape");
  assert.equal(back.ok, true, back.error);
  assert.equal(t.sheet(who).wildShape ?? null, null, "the druid is still in the shape");
  assert.equal(t.budget()?.bonusUsed ?? false, true, "reverting took no bonus action");
  assert.equal(t.budget()?.actionUsed ?? false, false, "reverting took the action");
  assert.equal(t.used(who, "wild_shape"), 1, "reverting spent a use");
};

P["druid.wild-shape.revert-unconscious"] = async () => {
  // Knocked out with hit points left: a Sleep spell, a drow's poison.
  const t = await rig.table();
  const who = druid(t, 4);
  await t.fight([who]);
  await shape(t, who);
  const out = await t.condition(who, "unconscious", { rounds: 10 });
  assert.equal(out.ok, true, out.error);
  assert.equal(t.sheet(who).wildShape ?? null, null, "the druid is unconscious and still a wolf");
  // Dropped to 0 hit points in the form.
  const t2 = await rig.table();
  const second = druid(t2, 4);
  await t2.fight([second]);
  await shape(t2, second);
  await t2.damage(second, 11, "slashing");
  assert.equal(t2.sheet(second).wildShape ?? null, null, "the wolf's 11 hit points are gone and the druid is still a wolf");
};

P["druid.wild-shape.proficiencies"] = async () => {
  const t = await rig.table();
  // No skill of their own: what the wolf brings is its Perception and Stealth.
  const who = druid(t, 4, { proficiencies: { ...TRAINED, saves: ["int", "wis"], skills: ["nature"] } });
  const before = t.derived(who);
  await shape(t, who);
  const after = t.derived(who);
  assert.equal(after.skills.nature, before.skills.nature, "the druid's own skill proficiency is kept");
  assert.equal(after.saves.wis, before.saves.wis, "the druid's own save proficiency is kept");
  // Dexterity 15 as a wolf, and the wolf's Stealth: +2 and the proficiency bonus.
  assert.equal(after.skills.stealth, 2 + 2, "the creature's Stealth proficiency is gained");
  assert.equal(after.skills.perception, 3 + 2, "the creature's Perception proficiency is gained, on the druid's Wisdom");
  assert.equal(after.skills.acrobatics, 2, "a skill neither has is untrained");
  // A giant crocodile's Stealth is +5 on Dexterity 9: the block's bonus is
  // higher than a 4th-level druid's own (-1 and +2), so the block's is used.
  const { wildShapeRecord, findShapeForm } = await import("../src/lib/srd/beast-forms.ts");
  const croc = findShapeForm("Giant Crocodile");
  assert.ok(croc, "the staging: the SRD giant crocodile");
  t.patch(who, { wildShape: wildShapeRecord(croc, { kind: "wildshape", abilities: { str: croc.abilities.str, dex: croc.abilities.dex, con: croc.abilities.con } }) });
  assert.equal(t.derived(who).skills.stealth, 5, "the creature's higher bonus is used instead of the druid's");
};

P["druid.wild-shape.no-legendary"] = async () => {
  const t = await rig.table();
  const who = druid(t, 4);
  await shape(t, who);
  const record = t.sheet(who).wildShape;
  assert.deepEqual(Object.keys(record).filter((key) => /legend|lair/i.test(key)), [], "the form carries legendary or lair actions");
  assert.deepEqual(record.attacks.map((attack) => attack.name), ["Bite"], "the form's actions are its block's attacks");
};

P["druid.wild-shape.hit-points"] = async () => {
  const t = await rig.table();
  const who = druid(t, 4);
  await t.fight([who]);
  t.patch(who, { currentHp: 30 });
  await shape(t, who);
  assert.equal(t.sheet(who).wildShape.beastHp, 11, "the wolf's hit points");
  assert.equal(t.sheet(who).wildShape.beastMaxHp, 11);
  await t.damage(who, 5, "slashing");
  assert.equal(t.sheet(who).wildShape.beastHp, 6, "damage comes off the form");
  assert.equal(t.sheet(who).currentHp, 30, "damage in the form reached the druid's own hit points");
  t.freshTurn();
  assert.equal((await t.use(who, "wild shape")).ok, true);
  assert.equal(t.sheet(who).currentHp, 30, "the druid returns to the hit points they had before the change");
};

P["druid.wild-shape.excess-damage"] = async () => {
  const t = await rig.table();
  const who = druid(t, 4);
  await t.fight([who]);
  t.patch(who, { currentHp: 30 });
  await shape(t, who);
  await t.damage(who, 10, "slashing");
  assert.equal(t.sheet(who).wildShape.beastHp, 1, "the staging: 1 hit point left in the form");
  // The rulebook's own example: 10 damage with 1 hit point left is 9 carried.
  await t.damage(who, 10, "slashing");
  assert.equal(t.sheet(who).wildShape ?? null, null, "the form held past 0");
  assert.equal(t.sheet(who).currentHp, 30 - 9, "the excess carries over to the normal form");
  assert.equal(t.has(who, "unconscious"), false, "the excess left hit points and the druid is unconscious");
};

P["druid.wild-shape.concentration"] = async () => {
  const t = await rig.table();
  const who = druid(t, 4, { spells: ["Barkskin"] });
  await t.fight([who]);
  const cast = await t.invoke("cast_buff", { characterId: who.id, spell: "Barkskin", targetCharacterIds: [who.id] });
  assert.equal(cast.ok, true, cast.error);
  assert.equal(t.sheet(who).concentratingOn, "Barkskin");
  t.freshTurn();
  await shape(t, who);
  assert.equal(t.sheet(who).concentratingOn, "Barkskin", "transforming broke the druid's concentration");
  assert.ok(t.sheet(who).conditions.some((entry) => /barkskin/i.test(entry)), "the spell's effect left with the change");
};

P["druid.wild-shape.features-kept"] = async () => {
  const t = await rig.table();
  const who = druid(t, 10, { subclass: "Circle of the Land" });
  await shape(t, who);
  // Nature's Ward, a class feature, in the wolf's body.
  await t.damage(who, 6, "poison");
  assert.equal(t.sheet(who).wildShape.beastHp, 11, "Nature's Ward's immunity to poison was lost in the form");
  await t.damage(who, 6, "slashing");
  assert.equal(t.sheet(who).wildShape.beastHp, 5, "the staging: other damage lands");
};

P["druid.wild-shape.senses"] = async () => {
  const light = await import("../src/lib/dm/attack-light.ts");
  const view = await import("../src/lib/battlemap/view.ts");
  const t = await rig.table();
  const who = druid(t, 8);
  t.patch(who, { features: [...t.sheet(who).features, { name: "Darkvision 60 ft.", source: "race" }] });
  assert.equal(light.characterSenses(t.sheet(who)).darkvision, 12, "the staging: darkvision out to 60 feet");
  await shape(t, who);
  assert.equal(light.characterSenses(t.sheet(who)).darkvision, 0, "a wolf has no darkvision, and the druid kept theirs");
  assert.equal(view.sheetSenses(t.sheet(who)).darkvision, 0, "the board's sight kept the druid's darkvision");
  assert.equal((await t.use(who, "wild shape")).ok, true);
  await shape(t, who, "Giant Bat");
  const bat = light.characterSenses(t.sheet(who));
  assert.equal(bat.blindsight, 12, "the giant bat's blindsight is the form's to use");
  assert.equal(bat.darkvision, 0);
};

P["druid.wild-shape.equipment-merged"] = async () => {
  const t = await rig.table();
  const who = druid(t, 4, { equipment: [{ name: "Quarterstaff", qty: 1, equipped: true }, { name: "Leather Armor", qty: 1, equipped: true }, { name: "Shield", qty: 1, equipped: true }] });
  const [foe] = await t.fight([who]);
  const worn = t.ac(who);
  await shape(t, who);
  assert.notEqual(worn, 13, "the staging: the druid's own AC is not the wolf's");
  assert.equal(t.derived(who).ac ?? t.sheet(who).wildShape.beastAc, 13, "the form's AC stands: the armor and shield are merged into it");
  t.freshTurn();
  const staff = await t.swing(who, foe, [15, 4], { weapon: "Quarterstaff" });
  assert.equal(staff.ok, false, "the merged quarterstaff was swung in the wolf's form");
  assert.ok(t.sheet(who).equipment.some((item) => item.name === "Quarterstaff"), "the equipment is gone from the sheet");
  assert.equal((await t.use(who, "wild shape")).ok, true);
  assert.equal(t.ac(who), worn, "the equipment is back as it was with the druid's own shape");
};

// ---- Circle of the Land ----

P["druid.natural-recovery.once"] = async () => {
  const t = await rig.table();
  const spent = { 1: { max: 4, used: 4 }, 2: { max: 3, used: 3 } };
  const who = druid(t, 4, { subclass: "Circle of the Land", spellcasting: { ability: "wis", slots: spent, prepared: ["Cure Wounds"], known: [], cantrips: [] } });
  const free = () => Object.values(t.sheet(who).spellcasting.slots).reduce((sum, slot) => sum + (slot.max - slot.used), 0);
  assert.equal((await t.rest("short")).ok, true);
  assert.ok(free() > 0, "the staging: a short rest recovers slots");
  assert.equal(t.used(who, "natural_recovery"), 1);
  t.patch(who, { spellcasting: { ...t.sheet(who).spellcasting, slots: spent } });
  assert.equal((await t.rest("short")).ok, true);
  assert.equal(free(), 0, "Natural Recovery came twice before a long rest");
  assert.equal((await t.rest("long")).ok, true);
  assert.equal(t.used(who, "natural_recovery"), 0, "a long rest gives it back");
};

P["druid.natures-sanctuary.day"] = async () => {
  const t = await rig.table();
  const who = druid(t, 14, { subclass: "Circle of the Land" });
  const [foe] = await t.fight([who], { foe: { type: "beast", saveMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } } });
  t.foesTurn(foe);
  // A 20 on the Wisdom save: the beast attacks, and is immune for the day.
  const first = await t.invoke("enemy_attack", { enemyId: foe.id, targetCharacterId: who.id }, [20, 16, 4]);
  assert.equal(first.ok, true, first.error);
  t.foesTurn(foe);
  t.kit.freshRound();
  // No save this time: a 1 would turn it away, and the die is the attack's.
  const second = await t.invoke("enemy_attack", { enemyId: foe.id, targetCharacterId: who.id }, [1, 4]);
  assert.equal(second.ok, true, `a beast that saved within the day was turned away: ${second.error}`);
  assert.equal(second.rolled.filter((die) => die.sides === 20).length, 1, "a second save was rolled within the 24 hours");
};

// ---- Beast Spells, Archdruid ----

const READY = (prepared) => ({ ability: "wis", slots: slots(4, 3, 3, 3, 3, 2, 2, 1, 1), prepared, known: [], cantrips: [] });
const buff = (t, who, spell) => t.invoke("cast_buff", { characterId: who.id, spell, targetCharacterIds: [who.id] });

P["druid.beast-spells.material"] = async () => {
  const t = await rig.table();
  const who = druid(t, 18, { spellcasting: READY(["Barkskin", "Detect Magic"]), equipment: [{ name: "Component pouch", qty: 1 }] });
  const own = await buff(t, who, "Barkskin");
  assert.equal(own.ok, true, `the staging: Barkskin in the druid's own shape: ${own.error}`);
  await shape(t, who);
  const bark = await buff(t, who, "Barkskin");
  assert.match(String(bark.error), /material component/, "Barkskin (a handful of oak bark) was cast in a beast shape");
  const used = t.sheet(who).spellcasting.slots["2"].used;
  // The words and the gestures a beast shape can make.
  assert.equal(t.sheet(who).spellcasting.slots["2"].used, used, "the refused cast spent a slot");
  const plain = await t.invoke("use_spell_slot", { characterId: who.id, level: 1, spell: "Detect Magic" });
  assert.equal(plain.ok, true, `a spell of words and gestures in a beast shape: ${plain.error}`);
  const slotted = await t.invoke("use_spell_slot", { characterId: who.id, level: 2, spell: "Barkskin" });
  assert.match(String(slotted.error), /material component/, "the slot's own door let the material through");
};

P["druid.archdruid.components"] = async () => {
  const t = await rig.table();
  // No pouch, no focus, and no voice.
  const who = druid(t, 20, { spellcasting: READY(["Barkskin", "Longstrider", "Stoneskin"]), equipment: [] });
  t.patch(who, { conditions: ["silenced"] });
  const bark = await buff(t, who, "Barkskin");
  assert.equal(bark.ok, true, `a silenced Archdruid with no pouch casts Barkskin: ${bark.error}`);
  // A material with a price is still asked for (100 gp of diamond dust).
  const stone = await buff(t, who, "Stoneskin");
  assert.match(String(stone.error), /diamond|material/i, "Stoneskin was cast with no diamond dust");
  // "In both your normal shape and your beast shape."
  t.patch(who, { conditions: [] });
  await shape(t, who);
  t.patch(who, { conditions: [...t.sheet(who).conditions, "silenced"] });
  const stride = await buff(t, who, "Longstrider");
  assert.equal(stride.ok, true, `the same in a beast shape: ${stride.error}`);
  const priced = await buff(t, who, "Stoneskin");
  assert.match(String(priced.error), /material/i, "a priced material was provided in a beast shape");
};

await runOrSurvey("scripts/test-enforce-sweep-clauses-srd-druid.mjs", P);
