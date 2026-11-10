// The clause ledger's probes for the cleric (SRD 5.1) and the Life Domain.
// The clause text and the verdict live in scripts/clauses/srd-classes.json;
// this file holds how each clause that names it is staged.
import "./lib/enforce-world.mjs";
import { runProbesKnown } from "./lib/sweep-clauses-srd-known.mjs";
import { assert, clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const MACE = [{ name: "Mace", qty: 1, equipped: true }];
const cleric = (t, level, extra = {}) => t.hero({ class: "cleric", subclass: "Life Domain", level, equipment: MACE, spells: ["Bless", "Cure Wounds"], ...extra, abilities: { wis: 16, ...(extra.abilities ?? {}) } });
const diceIn = (roll) => roll.breakdown.terms.filter((term) => term.kind === "dice").reduce((sum, term) => sum + term.count, 0);
const undead = (t, foe, cr, extra = {}) => t.kit.setEnemy(foe.id, { stats: { type: "undead", cr }, ...extra });
const turn = (t, who, faces = [1]) => t.use(who, "channel divinity", { variant: "turn undead" }, faces);

const P = {};

P["cleric.divine-domain.domains"] = async () => {
  const names = (await import("../src/lib/srd/features.ts")).subclassNamesFor("cleric");
  for (const name of ["Knowledge", "Life", "Light", "Nature", "Tempest", "Trickery", "War"]) {
    assert.ok(names.includes(`${name} Domain`), `no ${name} Domain`);
  }
};

P["cleric.channel-divinity-turn-undead.sees-or-hears"] = async () => {
  const t = await rig.table();
  const who = cleric(t, 2);
  const [foe] = await t.fight([who]);
  undead(t, foe, 1, { conditions: ["blinded", "deafened"] });
  const out = await turn(t, who);
  assert.equal(t.foeHas(foe, "turned"), false, `an undead that can neither see nor hear the cleric was turned (${out.ok ? "accepted" : out.error})`);
};

P["cleric.channel-divinity-turn-undead.range"] = async () => {
  const t = await rig.table();
  const who = cleric(t, 2);
  const [near, far] = await t.fight([who], { foes: 2 });
  undead(t, near, 1);
  undead(t, far, 1);
  const out = await turn(t, who, [1, 1]);
  assert.equal(out.ok, true, out.error);
  assert.equal(t.foeHas(near, "turned"), true, "the undead 5 feet away failed its save and is not turned");
  assert.equal(t.foeHas(far, "turned"), false, "an undead 60 feet away was turned");
};

P["cleric.destroy-undead-cr-1-2.thresholds"] = async () => {
  // level, a CR it destroys, the next CR up, which it only turns.
  for (const [level, destroyed, spared] of [[4, null, 0.25], [5, 0.5, 1], [8, 1, 2], [11, 2, 3], [14, 3, 4], [17, 4, 5]]) {
    const t = await rig.table();
    const who = cleric(t, level);
    const [low, high] = await t.fight([who], { foes: 2 });
    t.kit.place(high.id, 5, 6);
    if (destroyed !== null) undead(t, low, destroyed);
    else t.kit.setEnemy(low.id, { stats: { type: "humanoid" } });
    undead(t, high, spared);
    const out = await turn(t, who, [1, 1]);
    assert.equal(out.ok, true, out.error);
    if (destroyed !== null) assert.notEqual(t.enemy(low).status, "alive", `a level ${level} cleric did not destroy a CR ${destroyed} undead that failed its save`);
    assert.equal(t.enemy(high).status, "alive", `a level ${level} cleric destroyed a CR ${spared} undead`);
    assert.equal(t.foeHas(high, "turned"), true, `the CR ${spared} undead was not turned`);
  }
};

P["cleric.divine-intervention.action"] = async () => {
  const t = await rig.table();
  const who = cleric(t, 10);
  await t.fight([who]);
  const out = await t.use(who, "divine intervention", {}, [10, 10]);
  assert.equal(out.ok, true, out.error);
  assert.equal(t.budget()?.actionUsed, true, "Divine Intervention took no action");
};

P["cleric.divine-intervention.long-rest"] = async () => {
  const t = await rig.table();
  const who = cleric(t, 10);
  // The percentile roll is one d100 (combat-features.ts divineIntervention
  // rolls "1d100"): 99, over the cleric's level. No answer. (A face of 10
  // here would be an answer at 10th level, and the 7-day wait is then right.)
  const first = await t.use(who, "divine intervention", {}, [99]);
  assert.equal(first.ok, true, first.error);
  assert.match(JSON.stringify(first.result), /99/, `the call did not read the 99: ${JSON.stringify(first.result).slice(0, 200)}`);
  const again = await t.use(who, "divine intervention", {}, [99]);
  assert.equal(again.ok, false, "a second call before a long rest");
  await t.rest("long");
  const next = await t.use(who, "divine intervention", {}, [99]);
  assert.equal(next.ok, true, `after a long rest the call was refused: ${next.error}`);
};

P["cleric.divine-intervention.auto"] = async () => {
  const t = await rig.table();
  const who = cleric(t, 20);
  const out = await t.use(who, "divine intervention", {}, [10, 9]);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.unused, 2, "a 20th level cleric's call rolled dice");
  const text = JSON.stringify(out.result).toLowerCase();
  assert.ok(/interven|answers|succeed/.test(text) && !/no answer|does not|silence/.test(text), `the call did not succeed: ${text.slice(0, 200)}`);
};

// The training is written where a sheet is made legal (sheet-legality.ts
// subclassGrants, issue 251), not by the test door addHero: a cleric posted
// with the class's own training only goes through legalizeSheet, as the
// create and level-up routes send it, and comes out trained in heavy armor.
P["cleric.bonus-proficiency-heavy-armor.heavy"] = async () => {
  const { legalizeSheet } = await import("../src/lib/srd/sheet-legality.ts");
  const options = await import("../src/lib/characters/options.ts");
  const { bundledPrices } = await import("../src/lib/srd/starting-wealth.ts");
  const { checklistSpell } = await import("../src/lib/srd/spell-lists.ts");
  const { bundledSubclassName } = await import("../src/lib/srd/features.ts");
  const { wearsUntrainedArmor } = await import("../src/lib/srd/armor.ts");
  const { heroInput } = await import("./lib/enforce-world.mjs");
  const classes = options.srdClassOptions();
  const races = options.srdRaceOptions();
  const base = { saves: ["wis", "cha"], skills: [], expertise: [], languages: ["Common"], tools: [], armor: ["light", "medium", "shields"], weapons: ["simple"] };
  const legal = (subclass) => legalizeSheet(heroInput({ class: "cleric", subclass, level: 1, race: "human", abilities: { str: 14, dex: 10, con: 14, int: 10, wis: 16, cha: 12 }, proficiencies: base, equipment: [...MACE, { name: "Chain Mail", qty: 1, equipped: true }] }), {
    door: "table", level: 1, hpMethod: "average", startingWealth: "equipment",
    classOf: (id) => classes.find((entry) => entry.id === id) ?? null,
    race: { ...races.find((entry) => entry.id === "human"), feats: 0 },
    background: null, baseline: null, abilityPool: null, wealthRoll: null,
    priceOf: bundledPrices, spellOf: checklistSpell, featOf: () => null,
    subclassOffered: (classId, name) => Boolean(bundledSubclassName(classId, name)), rollDie: () => 3,
  }).sheet;
  const life = legal("Life Domain");
  assert.equal(wearsUntrainedArmor(life), false, `a Life cleric in chain mail is untrained: armor training ${(life.proficiencies?.armor ?? []).join(", ")}`);
  // The control: without the domain the same cleric is untrained in it, so
  // the training above is the domain's.
  const plain = legal("");
  assert.equal(wearsUntrainedArmor(plain), true, `a cleric with no domain is trained in chain mail: ${(plain.proficiencies?.armor ?? []).join(", ")}`);
};

P["cleric.channel-divinity-preserve-life.range"] = async () => {
  const t = await rig.table();
  const who = cleric(t, 2);
  const ally = t.hero({ class: "fighter", level: 5 });
  await t.fight([who, ally]);
  t.patch(ally, { currentHp: 5 });
  t.kit.place(ally.id, 12, 5);
  const far = await t.use(who, "channel divinity", { variant: "preserve life", targetCharacterId: ally.id });
  assert.equal(t.sheet(ally).currentHp, 5, `an ally 35 feet away was healed (${far.ok ? "accepted" : far.error})`);
  t.kit.place(ally.id, 10, 5);
  t.patch(who, { resources: { ...t.sheet(who).resources, channel_divinity: { max: 1, used: 0 } } });
  t.freshTurn();
  const near = await t.use(who, "channel divinity", { variant: "preserve life", targetCharacterId: ally.id });
  assert.equal(near.ok, true, near.error);
  assert.equal(t.sheet(ally).currentHp, 15, "25 feet away: 5 x cleric level 2");
};

P["cleric.divine-strike.once-per-turn"] = async () => {
  for (const [level, dice] of [[8, 1], [14, 2]]) {
    const t = await rig.table();
    const who = cleric(t, level, { class: "cleric", features: [{ name: "Extra Attack", source: "story" }] });
    const [foe] = await t.fight([who]);
    const first = await t.swing(who, foe, [15, 3, 4, 4]);
    assert.equal(first.ok, true, first.error);
    assert.equal(diceIn(first.damage), 1 + dice, `level ${level}: the mace's die and ${dice}d8 radiant`);
    const second = await t.swing(who, foe, [15, 3, 4, 4]);
    if (second.ok) assert.equal(diceIn(second.damage), 1, "Divine Strike rode a second hit in one turn");
  }
};

// The ledger (scripts/clauses/srd-classes.json) holds every clause's
// verdict; a KNOWN entry is only for a clause it has wrong, and none is now.
const KNOWN = {};

await runProbesKnown("scripts/test-enforce-sweep-clauses-srd-cleric.mjs", P, KNOWN);
