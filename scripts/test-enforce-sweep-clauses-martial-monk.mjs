// The clause ledger's monk probes: the sentences of the authored monk
// subclass features (src/lib/srd/subclasses.json) that no existing suite ran,
// each run through the engine. scripts/clauses/martial.json names every probe
// here by its id; scripts/lib/sweep-clauses-martial-known-monk.mjs holds the
// ones the engine fails today.
import assert from "node:assert/strict";
import { clauseSuite, openRig, prof, MOD } from "./lib/sweep-clauses-martial.mjs";
import { KNOWN, SKIP } from "./lib/sweep-clauses-martial-known-monk.mjs";
import { afterRollKit } from "./lib/sweep-clauses-mt-mr.mjs";

const { probe, test, finish } = await clauseSuite(import.meta.url, KNOWN, SKIP);
const BARE = { equipment: [] };
const UNARMED = { weapon: "unarmed strike" };
const die = (level) => (level >= 17 ? 10 : level >= 11 ? 8 : level >= 5 ? 6 : 4);
const expr = (hit) => String(hit?.damage?.breakdown?.expression ?? hit?.result?.damage?.expression ?? "");
const { getDatabase } = await import("../src/lib/db/core.ts");
// The light on the fight's board, under a roof: no lamps, no spell areas.
const light = (kit, ambient) => getDatabase().prepare("UPDATE battle_maps SET ambient = ?, outdoors = 0, lights_json = '[]', zones_json = '[]' WHERE id = ?").run(ambient, kit.map().id);

// ---- Way of Shadow ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, sheet, budget, has, show } = r;
  const shadow = hero("monk", "Way of Shadow", 11, BARE);

  await probe("shadow-step-advantage", async () => {
    const [enemy] = await stage(shadow);
    light(kit, "dim");
    const out = await spend(shadow, "Shadow Step");
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true, "the bonus action");
    assert.equal((await swing(shadow, enemy, [15, 15, 3], UNARMED)).toHit.advantage, "advantage", "the next melee attack");
    assert.equal((await swing(shadow, enemy, [15, 15, 3], UNARMED)).toHit.advantage, "none", "only the next one");
  });

  // "Between two patches of dim light or darkness": the square left and the
  // square landed on.
  await probe("shadow-step-shadows", async () => {
    await stage(shadow);
    light(kit, "bright");
    const lit = await spend(shadow, "Shadow Step");
    assert.equal(lit.ok, false, `from a bright square: ${show(lit)}`);
    assert.equal(budget().bonusUsed ?? false, false, "and the refusal spent no bonus action");
    light(kit, "dim");
    assert.equal((await spend(shadow, "Shadow Step")).ok, true, "from a dim square");
    const step = { token: shadow.id, x: 12, y: 8, teleport: true, spell: "Shadow Step", casterCharacterId: shadow.id };
    light(kit, "bright");
    const into = await world.invoke("move_token", step);
    assert.equal(into.ok, false, `landing in bright light: ${show(into)}`);
    light(kit, "dark");
    const landed = await world.invoke("move_token", step);
    assert.equal(landed.ok, true, landed.error);
    assert.deepEqual([kit.token(shadow.id).x, kit.token(shadow.id).y], [12, 8], "35 feet off, in darkness");
    light(kit, "bright");
  });

  // Shadow Arts: the four spells cast by their own tool for 2 ki each, with
  // no slot, no spell list and no component pouch; nothing else, and nobody
  // else.
  const cast = (who, spell, extra = {}) => world.invoke("use_spell_slot", { characterId: who.id, spell, ...extra });
  await probe("shadow-arts-ki-casts", async () => {
    await kit.endFight();
    r.setUsed(shadow, "ki", 0);
    world.patch(shadow.id, { conditions: [], conditionMeta: {}, concentratingOn: null });
    const dark = await cast(shadow, "Darkness");
    assert.equal(dark.ok, true, dark.error);
    assert.equal(r.used(shadow, "ki"), 2, "2 ki for darkness");
    for (const spell of ["Darkvision", "Pass without Trace", "Silence"]) {
      const out = await cast(shadow, spell);
      assert.equal(out.ok, true, `${spell}: ${out.error}`);
    }
    assert.equal(r.used(shadow, "ki"), 8, "2 ki each");
    r.setUsed(shadow, "ki", r.max(shadow, "ki") - 1);
    const dry = await cast(shadow, "Darkness");
    assert.equal(dry.ok, false, `with 1 ki left: ${show(dry)}`);
    assert.equal(r.used(shadow, "ki"), r.max(shadow, "ki") - 1, "and the refusal spent no ki");
    r.setUsed(shadow, "ki", 0);
    assert.equal((await cast(shadow, "Invisibility")).ok, false, "invisibility is none of the four");
    const kensei = hero("monk", "Way of the Kensei", 11, BARE);
    assert.equal((await cast(kensei, "Darkness")).ok, false, "a monk of another way casts no darkness");
  });
  await probe("shadow-arts-minor-illusion", async () => {
    await kit.endFight();
    r.setUsed(shadow, "ki", 0);
    // A known cantrip keeps its components ("a bit of fleece"): a pouch.
    const POUCH = { equipment: [{ name: "Component pouch", qty: 1 }] };
    world.patch(shadow.id, POUCH);
    const out = await cast(shadow, "Minor Illusion");
    world.patch(shadow.id, BARE);
    assert.equal(out.ok, true, out.error);
    assert.equal(r.used(shadow, "ki"), 0, "a cantrip: no ki");
    const kensei = hero("monk", "Way of the Kensei", 11, POUCH);
    assert.equal((await cast(kensei, "Minor Illusion")).ok, false, "a monk of another way does not know it");
  });

  await probe("cloak-of-shadows", async () => {
    const [enemy] = await stage(shadow);
    light(kit, "bright");
    const lit = await spend(shadow, "Cloak of Shadows");
    assert.equal(lit.ok, false, `in bright light: ${show(lit)}`);
    light(kit, "dim");
    const out = await spend(shadow, "Cloak of Shadows");
    assert.ok(out.ok && has(shadow, "invisible"), `Cloak of Shadows: ${show(out)}; the monk carries [${sheet(shadow).conditions.join(", ")}]`);
    assert.equal(budget().actionUsed, true, "the action");
    r.untilTurnOf(shadow);
    assert.ok(has(shadow, "invisible"), "a round on, having done nothing, the monk is still unseen");
    await swing(shadow, enemy, [15, 15, 3], UNARMED);
    assert.ok(!has(shadow, "invisible"), "the monk attacked and is still invisible");
    await stage(shadow);
    light(kit, "dim");
    assert.equal((await spend(shadow, "Cloak of Shadows")).ok, true);
    light(kit, "bright");
    assert.equal(await r.walk(shadow, 3, 5), 200);
    assert.ok(!has(shadow, "invisible"), "the monk stepped into bright light and is still invisible");
  });
}

// The light on the viewer's square is a field newer than some hosts
// (`PlayerMapView.self.bright`): the server says it sends it, and the Hand
// reads it only from a host that does (capabilities.ts handSquareLight).
await test("the Hand reads the light on its square only from a host that offers it", async () => {
  const { SERVER_FEATURES } = await import("../src/lib/capabilities.ts");
  const { hostOffers } = await import("../src/lib/use-capabilities.ts");
  const { boardFactsForHost, mrCardGate } = await import("../src/lib/battlemap/mt-mr-hand.ts");
  assert.equal(SERVER_FEATURES.handSquareLight, true, "this host says it sends the field");
  const older = { story: {}, images: {}, features: { handItemCasts: true } };
  assert.equal(hostOffers(older, "handSquareLight"), false, "a host from before the field was read as offering it");
  assert.equal(hostOffers({ ...older, features: { handSquareLight: true } }, "handSquareLight"), true);
  const facts = { bright: true, hide: "no cover here" };
  assert.deepEqual(boardFactsForHost(facts, true), facts, "a host that offers it");
  assert.deepEqual(boardFactsForHost(facts, false), { hide: "no cover here" }, "a host that does not: the field is left unread, the rest kept");
  const cloak = { name: "Cloak of Shadows", needs: "shadows", does: { kind: "mr", id: "cloak_of_shadows" } };
  const monk = { name: "Ash", conditions: [] };
  const turn = { myTurn: true, marks: [] };
  assert.ok(mrCardGate(monk, turn, cloak, boardFactsForHost(facts, true)), "in bright light the card is shut on a host that sends the light");
  assert.equal(mrCardGate(monk, turn, cloak, boardFactsForHost(facts, false)), null, "and dealt as before on a host that does not");
});

// ---- Way of the Four Elements ----
{
  const options = await import("../src/lib/srd/options.ts");
  await probe("elemental-disciplines-known", () => {
    const known = [3, 6, 11, 17].map((level) => options.optionSlotsFor("monk", "Way of the Four Elements", level, "discipline") ?? options.optionSlotsFor("monk", "Way of the Four Elements", level, "elemental discipline"));
    assert.deepEqual(known, [2, 3, 4, 5], `disciplines known at 3, 6, 11, 17: ${JSON.stringify(known)}`);
  });
}

// ---- Way of the Four Elements: the disciplines that cast ----
{
  const r = await openRig();
  const { world, kit, hero, stage, foe, show } = r;
  const fs = await import("node:fs");
  const options = await import("../src/lib/srd/options.ts");
  const casts = await import("../src/lib/srd/mt-mr-casts.ts");
  const listed = JSON.parse(fs.readFileSync(new URL("../src/lib/srd/options.json", import.meta.url), "utf8")).options.filter((option) => option.k === "discipline");
  const discipline = (name) => ({ name: `Discipline: ${name}`, description: "" });
  const adept = hero("monk", "Way of the Four Elements", 6, { ...BARE, abilities: { wis: 18 } });
  world.patch(adept.id, { features: [...world.sheet(adept.id).features, discipline("Clench of the North Wind"), discipline("Fist of Four Thunders")] });
  const hold = (enemy) => r.forced(2, () => world.invoke("cast_at_enemy", { characterId: adept.id, targetEnemyId: enemy.id, spell: "Hold Person", saveAbility: "wis", level: 2 }));

  // "Spell save DC and attacks use your ki save DC": hold person, cast with
  // 3 ki and no slot, asks its save against 8 + proficiency + Wisdom.
  await probe("discipline-ki-save-dc", async () => {
    const [enemy] = await stage(adept);
    const out = await hold(enemy);
    assert.equal(out.ok, true, out.error);
    assert.equal(r.used(adept, "ki"), 3, "Clench of the North Wind: 3 ki");
    assert.equal(foe(enemy).conditionMeta.paralyzed?.saveEnds?.dc, 8 + prof(6) + 4, `the ki save DC (Wisdom 18): ${show(out)}`);
    // The table of casts is the options' own text.
    for (const option of listed) {
      const told = /^Spend (\d+) ki to cast (.+?)( on yourself)?\.$/.exec(option.d);
      const row = casts.DISCIPLINE_CASTS[option.n];
      if (!told) {
        assert.equal(row, undefined, `${option.n} casts no spell by its text, and has a row`);
        continue;
      }
      assert.ok(row, `${option.n} ("${option.d}") has no row`);
      assert.deepEqual([row.cost, row.spell.toLowerCase(), Boolean(row.selfOnly)], [Number(told[1]), told[2], Boolean(told[3])], option.n);
    }
  });

  // "Of a level your ki can pay for": a discipline's ki is its price, and its
  // level opens it; "up to the most powerful ones" at 17th.
  await probe("discipline-ki-and-level", async () => {
    const [enemy] = await stage(adept);
    r.setUsed(adept, "ki", r.max(adept, "ki") - 2);
    const dry = await hold(enemy);
    assert.equal(dry.ok, false, `with 2 ki left a 3-ki discipline: ${show(dry)}`);
    assert.equal(r.used(adept, "ki"), r.max(adept, "ki") - 2, "and the refusal spent no ki");
    const at = (level) => ({ classLevel: () => level, features: [], cantrips: [] });
    const gate = (name, level) => options.optionReqProblem(listed.find((option) => option.n === name), at(level));
    assert.ok(gate("Clench of the North Wind", 5), "a 3-ki discipline was open at 5th level");
    assert.equal(gate("Clench of the North Wind", 6), null);
    assert.ok(gate("Flames of the Phoenix", 10), "a 4-ki discipline was open at 10th level");
    assert.equal(gate("Flames of the Phoenix", 11), null);
    for (const name of ["Breath of Winter", "Eternal Mountain Defense", "River of Hungry Flame", "Wave of Rolling Earth"]) {
      assert.ok(gate(name, 16), `${name} was open at 16th level`);
      assert.equal(gate(name, 17), null, `${name} at 17th level`);
    }
  });
}

// ---- Way of the Drunken Master ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, sheet, used, give, moveTiles, show } = r;
  const drunk = hero("monk", "Way of the Drunken Master", 17, BARE);

  // 55 feet of walking at 17th level: a square 65 feet off is beyond it
  // until Flurry of Blows adds its 10 feet.
  await probe("drunken-technique-movement", async () => {
    const [control] = await stage(drunk);
    kit.place(control.id, 4, 4);
    assert.equal(await r.walk(drunk, 16, 5), 200, "the staging is wrong: the monk cannot walk the 55 feet of their speed");
    const [enemy] = await stage(drunk);
    kit.place(enemy.id, 4, 4);
    assert.notEqual(await r.walk(drunk, 18, 5), 200, "the staging is wrong: the monk walked 65 feet with no Flurry of Blows");
    await swing(drunk, enemy, [15, 3], UNARMED);
    const out = await swing(drunk, enemy, [15, 3], { ...UNARMED, feature: "flurry of blows" });
    assert.equal(out.ok, true, out.error);
    assert.equal(await r.walk(drunk, 18, 5), 200, "after Flurry of Blows the monk still cannot walk 65 feet: no 10 feet of extra movement");
  });
  await probe("drunken-technique-disengage", async () => {
    const [enemy] = await stage(drunk);
    await swing(drunk, enemy, [15, 3], UNARMED);
    const out = await swing(drunk, enemy, [15, 3], { ...UNARMED, feature: "flurry of blows" });
    assert.equal(out.ok, true, out.error);
    world.diceLog();
    assert.equal(await r.walk(drunk, 2, 5), 200);
    assert.equal(world.diceLog().filter((d) => d.sides === 20).length, 0, "leaving the creature after Flurry of Blows drew an opportunity attack: no Disengage");
  });

  await probe("drunkards-luck", async () => {
    const [enemy] = await stage(drunk);
    give(drunk, "poisoned");
    const out = await spend(drunk, "Drunkard's Luck", { variant: "attack" });
    assert.equal(out.ok, true, out.error);
    assert.equal(used(drunk, "ki"), 2, "2 ki");
    const swung = await swing(drunk, enemy, [15, 2, 3], UNARMED);
    assert.equal(swung.toHit.advantage, "none", `the poisoned monk's attack after Drunkard's Luck is rolled with ${swung.toHit.advantage}`);
  });

  // Five strikes, the three extra each at a creature the flurry has not
  // struck at, and no sixth.
  await probe("intoxicated-frenzy-strikes", async () => {
    const foes = await stage(drunk, { enemies: 5 });
    [[6, 5], [4, 5], [5, 4], [5, 6], [6, 6]].forEach(([x, y], at) => kit.place(foes[at].id, x, y));
    await swing(drunk, foes[0], [15, 3], UNARMED);
    await swing(drunk, foes[0], [15, 3], UNARMED);
    const strikes = [];
    for (const foe of [...foes, foes[1]]) strikes.push((await swing(drunk, foe, [15, 3], { ...UNARMED, feature: "flurry of blows" })).ok);
    assert.deepEqual(strikes, [true, true, true, true, true, false], "five strikes at five creatures, and no sixth");
  });

  await probe("intoxicated-frenzy-different-creatures", async () => {
    const [enemy] = await stage(drunk);
    await swing(drunk, enemy, [15, 3], UNARMED);
    await swing(drunk, enemy, [15, 3], UNARMED);
    const strikes = [];
    for (let count = 0; count < 5; count += 1) strikes.push((await swing(drunk, enemy, [15, 3], { ...UNARMED, feature: "flurry of blows" })).ok);
    assert.ok(strikes.filter(Boolean).length <= 2, `Flurry of Blows struck one creature ${strikes.filter(Boolean).length} times: the extra attacks went to the same target`);
  });
}

// ---- Way of the Kensei ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, sheet, used, budget, show } = r;
  // The kensei weapons chosen: a longsword and a longbow, a monk's training
  // beside them (simple weapons and shortswords), no armor.
  const PICKS = { "Path of the Kensei": { weapons: ["Longsword", "Longbow"] } };
  const KENSEI = { simple: ["simple", "shortsword", "Longsword", "Longbow"] };
  const SWORD = {
    equipment: [{ name: "Longsword", qty: 1, equipped: true }],
    featChoices: PICKS,
    proficiencies: { saves: [], skills: [], expertise: [], languages: ["Common"], tools: [], armor: [], weapons: KENSEI.simple },
    abilities: { str: 10, dex: 16 },
  };
  const NONMAGICAL = "bludgeoning, piercing, and slashing from nonmagical attacks";
  const training = await import("../src/lib/srd/subclass-training.ts");
  const featGrants = await import("../src/lib/srd/feat-grants.ts");
  const { keyedFeatChoices } = await import("../src/lib/schemas/sheet.ts");
  const { deriveAc } = await import("../src/lib/srd/index.ts");

  // The grant's own picks: two at 3rd level, one more with the feature of
  // 6th, 11th and 17th; no heavy or special weapon among them, the longbow in.
  await probe("kensei-weapon-picks", () => {
    const grants = training.subclassGrants([{ id: "monk", level: 17, subclass: "Way of the Kensei" }]);
    const picks = Object.fromEntries(grants.filter((grant) => grant.spec.weapons > 0).map((grant) => [grant.name, grant.spec.weapons]));
    assert.deepEqual(picks, { "Path of the Kensei": 2, "One with the Blade": 1, "Sharpen the Blade": 1, "Unerring Accuracy": 1 }, JSON.stringify(picks));
    const offered = grants.find((grant) => grant.name === "Path of the Kensei").spec.weaponsFrom;
    for (const name of ["Longsword", "Shortbow", "Longbow"]) assert.ok(offered.includes(name), `${name} is offered`);
    for (const name of ["Greatsword", "Heavy Crossbow", "Net", "Lance"]) assert.ok(!offered.includes(name), `${name} (heavy or special) is offered`);
    assert.equal(training.subclassGrants([{ id: "monk", level: 5, subclass: "Way of the Kensei" }]).filter((grant) => grant.spec.weapons > 0).length, 1, "at 5th level only the first two");
    // "One melee and one ranged", and "you are proficient with them": the
    // picks through the door a sheet's training goes through.
    const path = grants.find((grant) => grant.name === "Path of the Kensei");
    const through = (weapons) =>
      featGrants.applyFeatGrants({
        proficiencies: { saves: [], skills: [], expertise: [], languages: ["Common"], tools: [], armor: [], weapons: ["simple", "shortsword"] },
        feats: [{ name: path.name, desc: "", spec: path.spec }],
        choices: keyedFeatChoices({ [path.name]: { weapons, tools: ["painter's supplies"] } }),
        strict: true,
      });
    assert.match(through(["Longsword", "Scimitar"]).problems.join(" "), /ranged/, "two melee weapons were taken as the two kensei weapons");
    const made = through(["Longsword", "Longbow"]);
    assert.deepEqual(made.problems, [], made.problems.join(" "));
    for (const name of ["Longsword", "Longbow"]) assert.ok(made.proficiencies.weapons.includes(name), `proficient with the ${name}: ${made.proficiencies.weapons.join(", ")}`);
  });

  // A longsword is no monk weapon (martial); chosen as a kensei weapon it
  // swings with Dexterity and the martial arts die, proficient.
  await probe("kensei-weapons-are-monk-weapons", async () => {
    const kensei = hero("monk", "Way of the Kensei", 17, SWORD);
    const [enemy] = await stage(kensei);
    const hit = await swing(kensei, enemy, [10, 4]);
    assert.equal(hit.ok, true, hit.error);
    assert.match(String(hit.toHit.expression), new RegExp(`\\+${MOD + prof(17)}$`), `Dexterity and proficiency to hit: ${hit.toHit.expression}`);
    assert.match(expr(hit), /^1d10/, `the martial arts die of 17th level for the longsword's d8: ${expr(hit)}`);
    const plain = hero("monk", "Way of the Kensei", 17, { ...SWORD, featChoices: {} });
    const [other] = await stage(plain);
    const swung = await swing(plain, other, [10, 4]);
    assert.match(expr(swung), /^1d8/, `the staging: a longsword not chosen keeps its own die (${expr(swung)})`);
  });

  await probe("agile-parry-needs-an-unarmed-strike", async () => {
    const kensei = hero("monk", "Way of the Kensei", 3, SWORD);
    const [enemy] = await stage(kensei);
    const out = await spend(kensei, "Agile Parry");
    assert.equal(out.ok, false, `Agile Parry with no unarmed strike made this turn: ${show(out)}`);
    await swing(kensei, enemy, [15, 3], UNARMED);
    assert.equal((await spend(kensei, "Agile Parry")).ok, true, "after an unarmed strike of the Attack action, the longsword in hand");
    const unarmedOnly = hero("monk", "Way of the Kensei", 3, { ...SWORD, equipment: [] });
    const [other] = await stage(unarmedOnly);
    await swing(unarmedOnly, other, [15, 3], UNARMED);
    assert.equal((await spend(unarmedOnly, "Agile Parry")).ok, false, "with no kensei melee weapon held");
  });
  // +2 AC until the start of the monk's next turn.
  await probe("agile-parry-ac", async () => {
    const kensei = hero("monk", "Way of the Kensei", 3, SWORD);
    const [enemy] = await stage(kensei);
    const ac = () => deriveAc({ ...sheet(kensei), acOverride: false });
    const bare = ac();
    await swing(kensei, enemy, [15, 3], UNARMED);
    const out = await spend(kensei, "Agile Parry");
    assert.equal(out.ok, true, out.error);
    assert.equal(ac() - bare, 2, "+2 AC");
    r.endTurn();
    assert.equal(ac() - bare, 2, "still +2 on the next creature's turn");
    r.untilTurnOf(kensei);
    assert.equal(ac() - bare, 0, "gone as the monk's next turn starts");
  });

  // A hit with a kensei weapon passes resistance to nonmagical attacks from
  // 6th level.
  await probe("kensei-weapons-magical", async () => {
    const kensei = hero("monk", "Way of the Kensei", 6, SWORD);
    const [enemy] = await stage(kensei);
    kit.setEnemy(enemy.id, { stats: { resist: NONMAGICAL } });
    await swing(kensei, enemy, [15, 4]);
    assert.equal(300 - r.foe(enemy).currentHp, 4 + MOD, "the longsword's 1d8 (a 4) + Dexterity, unhalved");
    const young = hero("monk", "Way of the Kensei", 5, SWORD);
    const [other] = await stage(young);
    kit.setEnemy(other.id, { stats: { resist: NONMAGICAL } });
    await swing(young, other, [15, 4]);
    assert.equal(300 - r.foe(other).currentHp, Math.floor((4 + MOD) / 2), "the staging: at 5th level the same blow is halved");
  });

  const blade = hero("monk", "Way of the Kensei", 11, SWORD);
  await probe("one-with-the-blade-deft-strike", async () => {
    const [enemy] = await stage(blade);
    const hit = await swing(blade, enemy, [15, 4]);
    assert.equal(hit.result.hit, true, hit.error);
    const before = r.foe(enemy).currentHp;
    const out = await spend(blade, "One with the Blade", { targetEnemyId: enemy.id }, 4);
    assert.ok(out.ok && before - r.foe(enemy).currentHp === 4, `1 ki for the martial arts die on the hit: ${show(out)}`);
    assert.equal(used(blade, "ki"), 1, "1 ki");
    await swing(blade, enemy, [15, 4]);
    assert.equal((await spend(blade, "One with the Blade", { targetEnemyId: enemy.id }, 4)).ok, false, "once per turn");
    const [fresh] = await stage(blade);
    assert.equal((await spend(blade, "One with the Blade", { targetEnemyId: fresh.id }, 4)).ok, false, "with no hit landed this turn");
    assert.equal(used(blade, "ki"), 0, "and the refusal spent no ki");
  });

  // Unerring Accuracy (17th level): a missed attack with a monk weapon waits
  // on the monk, is rolled again once, and the turn's next miss is not.
  await probe("unerring-accuracy", async () => {
    const card = await afterRollKit(world);
    const master = hero("monk", "Way of the Kensei", 17, SWORD);
    const [enemy] = await stage(master);
    await swing(master, enemy, [2]);
    assert.deepEqual(card.offered(), ["unerring_accuracy"], "a missed longsword (a kensei weapon) on the monk's own turn");
    const again = await card.choose(master, "unerring_accuracy", 15, 4);
    assert.match(again.note, /HIT/, `the reroll (a 15) stands: ${again.note}`);
    assert.equal(again.roll.total, 15 + MOD + prof(17));
    await swing(master, enemy, [2]);
    assert.deepEqual(card.offered(), [], "once on each turn: the second miss is not offered it");
    await card.keepAll(master);
    const [other] = await stage(master);
    await swing(master, other, [2], UNARMED);
    assert.deepEqual(card.offered(), [], "an unarmed strike is no monk weapon");
    await card.keepAll(master);
    const novice = hero("monk", "Way of the Kensei", 11, SWORD);
    const [third] = await stage(novice);
    await swing(novice, third, [2]);
    assert.deepEqual(card.offered(), [], "the staging: at 11th level a miss is a miss");
    await card.keepAll(novice);
  });

  await probe("sharpen-the-blade", async () => {
    const [enemy] = await stage(blade);
    const out = await spend(blade, "Sharpen the Blade", { amount: 2 });
    assert.equal(out.ok, true, out.error);
    assert.equal(used(blade, "ki"), 2, "2 ki for +2");
    assert.equal(budget().bonusUsed, true, "the bonus action");
    const hit = await swing(blade, enemy, [10, 4]);
    assert.match(String(hit.toHit.expression), /\+2\b/, `the attack: ${hit.toHit.expression}`);
    assert.match(expr(hit), /\+2\b/, `the damage: ${expr(hit)}`);
  });
  // "For a minute": ten rounds, counted at the monk's own turns.
  await probe("sharpen-the-blade-minute", async () => {
    await stage(blade);
    assert.equal((await spend(blade, "Sharpen the Blade", { amount: 1 })).ok, true);
    const carried = () => sheet(blade).conditions.some((entry) => /^sharpen the blade/i.test(entry));
    for (let round = 0; round < 9; round += 1) r.untilTurnOf(blade);
    assert.ok(carried(), "nine rounds on the blade is still sharpened");
    r.untilTurnOf(blade);
    r.untilTurnOf(blade);
    assert.ok(!carried(), "eleven rounds on it still is");
  });
}

// ---- Way of the Sun Soul ----
{
  const r = await openRig();
  const { world, kit, hero, stage, enemyHits, sheet, foe } = r;
  await probe("sun-shield-retaliate", async () => {
    const sun = hero("monk", "Way of the Sun Soul", 17, { ...BARE, ac: 5 });
    const [enemy] = await stage(sun);
    const before = foe(enemy).currentHp;
    await enemyHits(enemy, sun, [16, 4]);
    assert.equal(before - foe(enemy).currentHp, 5 + MOD, "5 + Wisdom radiant to the creature that hit in melee");
  });
}

// ---- Way of the Sun Soul: the two fires ----
{
  const r = await openRig();
  const { kit, hero, stage, spend, swing, foe, used, budget, show } = r;
  const sun = hero("monk", "Way of the Sun Soul", 11, BARE);
  // "Extendable with ki as a bonus action": after the Attack action, 1 ki
  // and the bonus action buy two more bolts, thrown at range like the first.
  await probe("radiant-sun-bolt-ki-bolts", async () => {
    const BOLT = { weapon: "Radiant Sun Bolt" };
    const [enemy] = await stage(sun);
    kit.place(enemy.id, 10, 5);
    const early = await swing(sun, enemy, [15, 3], { ...BOLT, feature: "flurry of blows" });
    assert.equal(early.ok, false, `before the Attack action: ${String(early.error).slice(0, 120)}`);
    assert.equal(used(sun, "ki"), 0, "and the refusal spent no ki");
    for (let count = 0; count < 2; count += 1) assert.equal((await swing(sun, enemy, [15, 3], BOLT)).ok, true, "the Attack action's bolts");
    const made = [];
    const said = [];
    for (let count = 0; count < 3; count += 1) {
      const bolt = await swing(sun, enemy, [15, 3], { ...BOLT, feature: "flurry of blows" });
      made.push(bolt.ok);
      said.push(String(bolt.error ?? "ok").slice(0, 160));
    }
    assert.deepEqual(made, [true, true, false], `two more bolts, 25 feet off, and no third: ${said.join(" | ")}`);
    assert.equal(used(sun, "ki"), 1, "1 ki");
    assert.equal(budget().bonusUsed, true, "the bonus action");
    assert.equal(300 - foe(enemy).currentHp, 4 * (3 + MOD), "four bolts of 1d8 (3s) + Dexterity, radiant");
  });

  await probe("searing-arc-strike", async () => {
    const [enemy] = await stage(sun);
    const early = await spend(sun, "Searing Arc Strike", { amount: 2, targetEnemyIds: [enemy.id] }, 2);
    assert.equal(early.ok, false, `before the Attack action: ${show(early)}`);
    await swing(sun, enemy, [2], UNARMED);
    const one = await spend(sun, "Searing Arc Strike", { amount: 1, targetEnemyIds: [enemy.id] }, 2);
    assert.equal(one.ok, false, `for 1 ki: ${show(one)}`);
    assert.equal(used(sun, "ki"), 0, "and the refusals spent no ki");
    const before = foe(enemy).currentHp;
    const out = await spend(sun, "Searing Arc Strike", { amount: 3, targetEnemyIds: [enemy.id] }, 2);
    assert.equal(out.ok, true, out.error);
    assert.equal(before - foe(enemy).currentHp, 8, `burning hands at 2nd level for 3 ki, 4d6 of 2s on a failed save: ${show(out)}`);
    assert.equal(used(sun, "ki"), 3);
    assert.equal(budget().bonusUsed, true, "the bonus action");
  });
  await probe("searing-sunburst", async () => {
    const [enemy] = await stage(sun);
    kit.place(enemy.id, 15, 5);
    const before = foe(enemy).currentHp;
    const out = await spend(sun, "Searing Sunburst", { amount: 1, targetEnemyIds: [enemy.id] }, 2);
    assert.equal(out.ok, true, out.error);
    assert.equal(before - foe(enemy).currentHp, 8, `2d6 and 2d6 more for 1 ki, of 2s, on a failed save: ${show(out)}`);
    assert.equal(budget().actionUsed, true, "the action");
    const [sturdy] = await stage(sun);
    const made = await spend(sun, "Searing Sunburst", { targetEnemyIds: [sturdy.id] }, 20);
    assert.equal(made.ok, true, made.error);
    assert.equal(foe(sturdy).currentHp, 300, `a creature that made its save takes nothing: ${show(made)}`);
    const [far] = await stage(sun);
    kit.place(far.id, 5 + 31, 5);
    assert.equal((await spend(sun, "Searing Sunburst", { targetEnemyIds: [far.id] }, 2)).ok, false, "a creature 155 feet off");
  });
}

// ---- Way of the Long Death ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, sheet, foeHas, budget, enemyHits, show } = r;
  const death = hero("monk", "Way of the Long Death", 11, { ...BARE, ac: 5 });

  await probe("hour-of-reaping", async () => {
    const [near, far] = await stage(death, { enemies: 2 });
    kit.place(far.id, 13, 5);
    const out = await spend(death, "Hour of Reaping", {}, 2);
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().actionUsed, true, "the action");
    assert.deepEqual([foeHas(near, "frightened"), foeHas(far, "frightened")], [true, false], `a creature 5 feet off and one 40 feet off, both failing: ${show(out)}`);
  });

  // "Until the end of your next turn."
  await probe("hour-of-reaping-until-next-turn-ends", async () => {
    const [near] = await stage(death);
    assert.equal((await spend(death, "Hour of Reaping", {}, 2)).ok, true);
    assert.ok(foeHas(near, "frightened"), "the staging: frightened");
    r.untilTurnOf(death);
    assert.ok(foeHas(near, "frightened"), "no longer frightened as the monk's next turn starts");
    r.endTurn();
    assert.ok(!foeHas(near, "frightened"), "still frightened once that turn has ended");
  });

  // "instead of dropping to 0": the hold answers the blow itself, as
  // Relentless Endurance does, so the probe reads the hit, not a later call.
  await probe("mastery-of-death", async () => {
    const [enemy] = await stage(death);
    world.patch(death.id, { currentHp: 3 });
    const kiBefore = r.used(death, "ki");
    await enemyHits(enemy, death, [16, 4]);
    assert.ok(sheet(death).currentHp === 1 && !r.has(death, "unconscious"), `dropped to 0 with ki left: at ${sheet(death).currentHp} hit points, [${sheet(death).conditions.join(", ")}]`);
    assert.equal(r.used(death, "ki"), kiBefore + 1, "the hold costs 1 ki");
    const [again] = await stage(death);
    const ki = sheet(death).resources.ki;
    world.patch(death.id, { currentHp: 3, resources: { ...sheet(death).resources, ki: { max: ki.max, used: ki.max } } });
    await enemyHits(again, death, [16, 4]);
    assert.equal(sheet(death).currentHp, 0, "with no ki left the monk drops");
  });
}

// ---- Way of Mercy ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, sheet, foe, used, budget, show } = r;
  const mercy = hero("monk", "Way of Mercy", 6, BARE);
  const ally = hero("fighter", "Champion", 5);
  const far = hero("fighter", "Champion", 5);

  await probe("hand-of-healing", async () => {
    await stage(mercy, { cast: [[ally, 5, 6], [far, 5, 9]] });
    world.patch(ally.id, { currentHp: 40 });
    const out = await spend(mercy, "Hand of Healing", { targetCharacterId: ally.id }, 4);
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(ally).currentHp, 40 + 4 + MOD, "the martial arts die (a 4) + Wisdom");
    assert.equal(used(mercy, "ki"), 1, "1 ki");
    assert.equal(budget().actionUsed, true, "the action");
  });
  await probe("hand-of-healing-5-feet", async () => {
    await stage(mercy, { cast: [[far, 5, 9]] });
    world.patch(far.id, { currentHp: 40 });
    const out = await spend(mercy, "Hand of Healing", { targetCharacterId: far.id }, 4);
    assert.equal(out.ok, false, `an ally 20 feet away was healed for ${sheet(far).currentHp - 40}`);
  });

  // "Or replace one Flurry of Blows attack with it": a strike given up, no
  // action and no ki, once a flurry before Flurry of Healing and Harm.
  await probe("hand-of-healing-flurry", async () => {
    const [enemy] = await stage(mercy, { cast: [[ally, 5, 6]] });
    world.patch(ally.id, { currentHp: 40 });
    assert.equal((await spend(mercy, "Flurry of Healing", { targetCharacterId: ally.id }, 4)).ok, false, "with no Flurry of Blows bought");
    await swing(mercy, enemy, [15, 3], UNARMED);
    await swing(mercy, enemy, [15, 3], UNARMED);
    const bought = await world.invoke("use_resource", { characterId: mercy.id, resource: "Ki", variant: "flurry of blows" });
    assert.equal(bought.ok, true, bought.error);
    const out = await spend(mercy, "Flurry of Healing", { targetCharacterId: ally.id }, 4);
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(ally).currentHp, 40 + 4 + MOD, "the martial arts die (a 4) + Wisdom");
    assert.equal(used(mercy, "ki"), 1, "the flurry's 1 ki and none for the healing");
    assert.equal(budget().flurryStrikes, 1, "one strike of the two given up");
    assert.equal((await spend(mercy, "Flurry of Healing", { targetCharacterId: ally.id }, 4)).ok, false, "one strike of a flurry, at 6th level");
    assert.equal((await swing(mercy, enemy, [15, 3], { ...UNARMED, feature: "flurry of blows" })).ok, true, "the other strike is still there to make");
  });

  // Physician's Touch (6th level): the healing ends one condition, and Hand
  // of Harm poisons until the end of the monk's next turn.
  await probe("physicians-touch", async () => {
    const [enemy] = await stage(mercy, { cast: [[ally, 5, 6]] });
    r.give(ally, "poisoned");
    r.give(ally, "blinded");
    world.patch(ally.id, { currentHp: 40 });
    const out = await spend(mercy, "Hand of Healing", { targetCharacterId: ally.id, variant: "poisoned" }, 4);
    assert.equal(out.ok, true, out.error);
    assert.deepEqual([r.has(ally, "poisoned"), r.has(ally, "blinded")], [false, true], `one condition ended, the one named: ${show(out)}`);
    kit.freshTurn();
    await swing(mercy, enemy, [15, 3], UNARMED);
    const harm = await spend(mercy, "Hand of Harm", { targetEnemyId: enemy.id }, 4);
    assert.equal(harm.ok, true, harm.error);
    assert.ok(r.foeHas(enemy, "poisoned"), `the creature is poisoned: ${show(harm)}`);
    r.untilTurnOf(mercy);
    assert.ok(r.foeHas(enemy, "poisoned"), "still poisoned as the monk's next turn starts");
    r.endTurn();
    assert.ok(!r.foeHas(enemy, "poisoned"), "and no longer once that turn has ended");
    const novice = hero("monk", "Way of Mercy", 3, BARE);
    const [other] = await stage(novice);
    await swing(novice, other, [15, 3], UNARMED);
    await spend(novice, "Hand of Harm", { targetEnemyId: other.id }, 4);
    assert.ok(!r.foeHas(other, "poisoned"), "the staging: at 3rd level Hand of Harm poisons nobody");
  });

  // Flurry of Healing and Harm (11th level): every strike of the flurry may
  // heal, and Hand of Harm on a flurry strike takes no ki.
  await probe("flurry-of-healing-and-harm", async () => {
    const adept = hero("monk", "Way of Mercy", 11, BARE);
    const [enemy] = await stage(adept, { cast: [[ally, 5, 6]] });
    world.patch(ally.id, { currentHp: 20 });
    await swing(adept, enemy, [15, 3], UNARMED);
    await swing(adept, enemy, [15, 3], UNARMED);
    assert.equal((await world.invoke("use_resource", { characterId: adept.id, resource: "Ki", variant: "flurry of blows" })).ok, true);
    assert.equal((await spend(adept, "Flurry of Healing", { targetCharacterId: ally.id }, 4)).ok, true, "the first strike heals");
    assert.equal((await spend(adept, "Flurry of Healing", { targetCharacterId: ally.id }, 4)).ok, true, "and the second");
    assert.equal(sheet(ally).currentHp, 20 + 2 * (4 + MOD));
    assert.equal(used(adept, "ki"), 1, "the flurry's 1 ki only");
    const [again] = await stage(adept);
    await swing(adept, again, [15, 3], UNARMED);
    await swing(adept, again, [15, 3], UNARMED);
    const strike = await swing(adept, again, [15, 3], { ...UNARMED, feature: "flurry of blows" });
    assert.equal(strike.result.hit, true, strike.error);
    const harm = await spend(adept, "Hand of Harm", { targetEnemyId: again.id }, 4);
    assert.equal(harm.ok, true, harm.error);
    assert.equal(used(adept, "ki"), 1, `Hand of Harm on a flurry strike took ki: ${show(harm)}`);
    const [third] = await stage(adept);
    await swing(adept, third, [15, 3], UNARMED);
    await spend(adept, "Hand of Harm", { targetEnemyId: third.id }, 4);
    assert.equal(used(adept, "ki"), 1, "the staging: on a strike of the Attack action it costs its 1 ki");
  });

  await probe("hand-of-harm", async () => {
    const [enemy] = await stage(mercy);
    const hit = await swing(mercy, enemy, [15, 3], UNARMED);
    assert.equal(hit.result.hit, true, hit.error);
    const before = foe(enemy).currentHp;
    const out = await spend(mercy, "Hand of Harm", { targetEnemyId: enemy.id }, 4);
    assert.equal(out.ok, true, out.error);
    assert.equal(before - foe(enemy).currentHp, 4 + MOD, "the die (a 4) + Wisdom");
    assert.match(JSON.stringify(out.result), /necrotic/i);
    assert.equal(used(mercy, "ki"), 1);
    await swing(mercy, enemy, [15, 3], UNARMED);
    assert.equal((await spend(mercy, "Hand of Harm", { targetEnemyId: enemy.id }, 4)).ok, false, "once per turn");
  });

  await probe("hand-of-ultimate-mercy-revives", async () => {
    const master = hero("monk", "Way of Mercy", 17, BARE);
    const fallen = hero("fighter", "Champion", 5);
    await kit.endFight();
    world.patch(fallen.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
    const out = await spend(master, "Hand of Ultimate Mercy", { targetCharacterId: fallen.id }, 5);
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(fallen).currentHp, 4 * 5 + MOD, "4d10 (four 5s) + Wisdom");
    assert.equal(sheet(fallen).deathSaves?.dead ?? false, false, "back to life");
    assert.equal(used(master, "ki"), 5, "5 ki");
  });
}

// ---- Way of the Astral Self ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, react, swing, roll, sheet, foe, used, budget, d20s, has, show } = r;
  const astral = hero("monk", "Way of the Astral Self", 17, { ...BARE, abilities: { str: 8, wis: 18 } });

  await probe("arms-of-the-astral-self-burst", async () => {
    const [near, far] = await stage(astral, { enemies: 2 });
    kit.place(near.id, 7, 5);
    kit.place(far.id, 8, 5);
    const out = await spend(astral, "Arms of the Astral Self", {}, 2);
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true);
    assert.equal(used(astral, "ki"), 1);
    assert.deepEqual([300 - foe(near).currentHp, 300 - foe(far).currentHp], [4, 0], `two rolls of the d10 (two 2s) to the creature 10 feet off, nothing 15 feet off: ${show(out)}`);
  });
  await probe("arms-of-the-astral-self-reach", async () => {
    const [enemy] = await stage(astral);
    await spend(astral, "Arms of the Astral Self", {}, 2);
    kit.place(enemy.id, 7, 5);
    const strike = await swing(astral, enemy, [15, 3], UNARMED);
    assert.equal(strike.ok, true, `with the arms out a creature 10 feet off is beyond the unarmed strike: ${String(strike.error).slice(0, 90)}`);
  });
  await probe("arms-of-the-astral-self-wisdom", async () => {
    const [enemy] = await stage(astral);
    await spend(astral, "Arms of the Astral Self", {}, 2);
    const strike = await swing(astral, enemy, [15, 3], UNARMED);
    assert.equal(strike.ok, true, strike.error);
    assert.match(String(strike.toHit.expression), new RegExp(`\\+${4 + prof(17)}$`), `Wisdom for the attack: ${strike.toHit.expression}`);
    assert.match(JSON.stringify(strike.result), /force/i, "force damage");
  });
  await probe("arms-of-the-astral-self-strength-checks", async () => {
    await stage(astral);
    await spend(astral, "Arms of the Astral Self", {}, 2);
    const check = await roll(astral, { kind: "ability_check", ability: "str", dc: 10 }, [10]);
    const save = await roll(astral, { kind: "saving_throw", ability: "str", dc: 10 }, [10]);
    // A monk is proficient in Strength saves (SRD 5.1, Monk: "Saving Throws:
    // Strength, Dexterity"), so the save adds the proficiency bonus to the
    // Wisdom it borrows; the bare check adds Wisdom alone.
    assert.deepEqual([check.total, save.total], [10 + 4, 10 + 4 + prof(17)], "a Strength check and save with Wisdom 18 under the arms (Strength 8)");
    const athletics = await roll(astral, { kind: "skill_check", skill: "athletics", dc: 10 }, [10]);
    const untrained = !sheet(astral).proficiencies.skills.includes("athletics");
    assert.equal(athletics.total, 10 + 4 + (untrained ? 0 : prof(17)), "Strength (Athletics) borrows Wisdom too");
    kit.freshTurn();
    const bare = hero("monk", "Way of the Astral Self", 17, { ...BARE, abilities: { str: 8, wis: 18 } });
    await stage(bare);
    assert.equal((await roll(bare, { kind: "ability_check", ability: "str", dc: 10 }, [10])).total, 10 - 1, "the staging: with no arms summoned the check reads Strength");
  });

  await probe("deflect-energy", async () => {
    await stage(astral);
    await spend(astral, "Arms of the Astral Self", {}, 2);
    kit.freshTurn();
    await spend(astral, "Visage of the Astral Self");
    world.patch(astral.id, { currentHp: 60 });
    await world.invoke("apply_damage", { characterId: astral.id, amount: 20, type: "fire" });
    const out = await react(astral, "Deflect Energy", {}, 5);
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(astral).currentHp, 40 + 5 + 4, "1d10 (a 5) + Wisdom back");
  });

  // Empowered Arms: one roll of the martial arts die on one hit a turn, with
  // the arms and the visage both summoned.
  await probe("empowered-arms", async () => {
    const [enemy] = await stage(astral);
    await spend(astral, "Arms of the Astral Self", {}, 2);
    kit.freshTurn();
    const armsOnly = await swing(astral, enemy, [15, 3, 3], UNARMED);
    assert.doesNotMatch(expr(armsOnly), /\+1d10/, `with the arms and no visage: ${expr(armsOnly)}`);
    kit.freshTurn();
    assert.equal((await spend(astral, "Visage of the Astral Self")).ok, true);
    kit.freshTurn();
    const first = await swing(astral, enemy, [15, 3, 3], UNARMED);
    assert.match(expr(first), /\+1d10/, `the first hit of the turn: ${expr(first)}`);
    const second = await swing(astral, enemy, [15, 3, 3], UNARMED);
    assert.doesNotMatch(expr(second), /\+1d10/, `the second: ${expr(second)}`);
  });
  // "While both your arms and visage are summoned": a fire hit, deflected
  // only with both.
  await probe("deflect-energy-needs-both", async () => {
    const burned = async (visage) => {
      const [enemy] = await stage(astral);
      await spend(astral, "Arms of the Astral Self", {}, 2);
      kit.freshTurn();
      if (visage) assert.equal((await spend(astral, "Visage of the Astral Self")).ok, true);
      kit.setEnemy(enemy.id, { stats: { attacks: [{ name: "Flame", toHit: 14, damage: "1d6+2", type: "fire" }] } });
      world.patch(astral.id, { currentHp: 60 });
      await r.enemyHits(enemy, astral, [16, 4]);
      return react(astral, "Deflect Energy", {}, 5);
    };
    const armsOnly = await burned(false);
    assert.equal(armsOnly.ok, false, `with the arms and no visage: ${show(armsOnly)}`);
    const both = await burned(true);
    assert.equal(both.ok, true, both.error);
    assert.equal(sheet(astral).currentHp, 60, "a 6 of fire, all of it deflected (1d10 + Wisdom)");
  });
  await probe("awakened-astral-self-attack", async () => {
    await stage(astral);
    await spend(astral, "Arms of the Astral Self", {}, 2);
    kit.freshTurn();
    await spend(astral, "Visage of the Astral Self");
    kit.freshTurn();
    assert.equal((await spend(astral, "Awakened Astral Self")).ok, true);
    kit.freshTurn();
    const [enemy] = world.enemies();
    const made = [];
    for (let count = 0; count < 4; count += 1) made.push((await swing(astral, enemy, [15, 3, 3], UNARMED)).ok);
    assert.deepEqual(made, [true, true, true, false], "three attacks in the Attack action (Extra Attack and the arms' one)");
  });

  // Astral Sight: under the visage the monk sees through magical darkness
  // (to 120 feet); the creature in it does not see the monk.
  await probe("astral-sight", async () => {
    const darkness = (kit) => getDatabase().prepare("UPDATE battle_maps SET zones_json = ? WHERE id = ?").run(JSON.stringify([{ x0: 0, y0: 0, x1: 40, y1: 40, kind: "magical_darkness", ambient: "dark" }]), kit.map().id);
    const [enemy] = await stage(astral);
    darkness(kit);
    const blind = await swing(astral, enemy, [15, 15, 3], UNARMED);
    assert.equal(blind.toHit.advantage, "none", "the staging: in magical darkness neither sees the other, and the two cancel");
    const [other] = await stage(astral);
    assert.equal((await spend(astral, "Visage of the Astral Self")).ok, true);
    kit.freshTurn();
    darkness(kit);
    const seen = await swing(astral, other, [15, 15, 3], UNARMED);
    assert.equal(seen.toHit.advantage, "advantage", `with the visage the monk sees a creature that cannot see them: ${JSON.stringify(seen.toHit).slice(0, 200)}`);
    light(kit, "bright");
  });

  await probe("awakened-astral-self-ac", async () => {
    await stage(astral);
    const ac = sheet(astral).ac;
    const out = await spend(astral, "Awakened Astral Self");
    assert.equal(out.ok, true, out.error);
    assert.equal(used(astral, "ki"), 5, "5 ki");
    const { deriveAc } = await import("../src/lib/srd/index.ts");
    assert.equal(deriveAc({ ...sheet(astral), acOverride: false }) - deriveAc({ ...sheet(astral), acOverride: false, conditions: [] }), 2, `+2 AC: ${show(out)}`);
    void ac;
  });
}

// ---- Way of the Ascendant Dragon ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, sheet, foeHas, has, show } = r;
  const dragon = hero("monk", "Way of the Ascendant Dragon", 11, BARE);

  await probe("wings-unfurled-needs-step-of-the-wind", async () => {
    await stage(dragon);
    const out = await spend(dragon, "Wings Unfurled");
    assert.equal(out.ok, false, `wings with no Step of the Wind used: ${show(out)}`);
  });

  await probe("aspect-of-the-wyrm-frighten", async () => {
    const [enemy] = await stage(dragon);
    const out = await spend(dragon, "Aspect of the Wyrm", { variant: "frighten" }, 2);
    assert.equal(out.ok, true, out.error);
    // On to the creature's own turn, its dice all 1s: any save it makes fails.
    r.endTurn();
    assert.ok(foeHas(enemy, "frightened"), `a creature 5 feet off, its turn begun in the aura, is not frightened: ${show(out)}`);
    // Beyond the 10 feet nothing is asked.
    const [far] = await stage(dragon);
    kit.place(far.id, 9, 5);
    assert.equal((await spend(dragon, "Aspect of the Wyrm", { variant: "frighten" }, 2)).ok, true);
    r.endTurn();
    assert.ok(!foeHas(far, "frightened"), "a creature 20 feet off was frightened by a 10-foot aura");
  });

  // The wings: a flying speed equal to the walking speed, to the turn's end.
  await probe("wings-unfurled-fly", async () => {
    await stage(dragon);
    assert.equal((await r.act(dragon, "dash", { bonus: true })).ok, true, "the staging: Step of the Wind");
    const out = await spend(dragon, "Wings Unfurled");
    assert.equal(out.ok, true, out.error);
    const { flyingSpeedOf } = await import("../src/lib/battlemap/types.ts");
    const fly = () => flyingSpeedOf({ conditions: sheet(dragon).conditions, features: sheet(dragon).features, walkingFeet: sheet(dragon).speed });
    assert.equal(fly(), sheet(dragon).speed, `a flying speed equal to the walking speed (${sheet(dragon).speed}): ${show(out)}`);
    r.endTurn();
    assert.equal(fly(), null, "still flying once the turn has ended");
  });
  await probe("aspect-of-the-wyrm-ward", async () => {
    const friend = hero("fighter", "Champion", 5);
    await stage(dragon, { cast: [[friend, 5, 6]] });
    // "Resistance to your damage type": the ward names the type it wards
    // against, one of Draconic Strike's five.
    const out = await spend(dragon, "Aspect of the Wyrm", { variant: "ward fire" }, 2);
    assert.equal(out.ok, true, out.error);
    world.patch(friend.id, { currentHp: 60 });
    await world.invoke("apply_damage", { characterId: friend.id, amount: 20, type: "fire" });
    assert.equal(sheet(friend).currentHp, 50, `an ally 5 feet off takes half of 20 fire: ${show(out)}`);
    await world.invoke("apply_damage", { characterId: friend.id, amount: 20, type: "cold" });
    assert.equal(sheet(friend).currentHp, 30, "and all of 20 cold: the ward is against fire");
    kit.place(friend.id, 5, 9);
    await world.invoke("apply_damage", { characterId: friend.id, amount: 10, type: "fire" });
    assert.equal(sheet(friend).currentHp, 20, "20 feet off the ally is outside the ward");
  });

  // ---- Ascendant Aspect (17th level) ----
  const wyrm = hero("monk", "Way of the Ascendant Dragon", 17, BARE);

  // Explosive Fury rides the activation: 3d10 of the Draconic Strike type to
  // each creature in the aura that fails a Dexterity save, nothing on a
  // success, nothing beyond 10 feet.
  await probe("explosive-fury", async () => {
    await r.choose(wyrm, "Draconic Strike", "fire");
    const [near, far] = await stage(wyrm, { enemies: 2 });
    kit.place(far.id, 13, 5);
    const out = await spend(wyrm, "Aspect of the Wyrm", { variant: "frighten" }, 2);
    assert.equal(out.ok, true, out.error);
    assert.deepEqual([300 - r.foe(near).currentHp, 300 - r.foe(far).currentHp], [6, 0], `3d10 of 2s to the creature 5 feet off, nothing 40 feet off: ${show(out)}`);
    assert.match(JSON.stringify(out.result), /fire/i, "of the Draconic Strike type");
    const [sturdy] = await stage(wyrm);
    const made = await spend(wyrm, "Aspect of the Wyrm", { variant: "frighten" }, 20);
    assert.equal(made.ok, true, made.error);
    assert.equal(r.foe(sturdy).currentHp, 300, `a creature that made its Dexterity save takes nothing: ${show(made)}`);
    const young = await stage(dragon);
    await spend(dragon, "Aspect of the Wyrm", { variant: "frighten" }, 2);
    assert.equal(r.foe(young[0]).currentHp, 300, "the staging: at 11th level the activation explodes on nobody");
  });

  // Augment Breath: 1 ki in the breath's own call ("augmented fire"), and it
  // reaches 90 feet for four rolls of the martial arts die; a breath that
  // does not ask for it is the plain one.
  await probe("augment-breath", async () => {
    const [near, far] = await stage(wyrm, { enemies: 2 });
    kit.place(far.id, 5 + 13, 5);
    const short = await spend(wyrm, "Breath of the Dragon", { variant: "fire", targetEnemyIds: [far.id] }, 2);
    assert.equal(short.ok, false, `the staging: a creature 65 feet off is beyond the plain breath: ${show(short)}`);
    assert.equal(r.used(wyrm, "ki"), 0, "and the refusal spent no ki");
    const out = await spend(wyrm, "Breath of the Dragon", { variant: "augmented fire", targetEnemyIds: [far.id] }, 2);
    assert.equal(out.ok, true, out.error);
    assert.equal(300 - r.foe(far).currentHp, 8, `four rolls of the d10 (2s) on a failed save, 65 feet off: ${show(out)}`);
    assert.equal(r.used(wyrm, "ki"), 1, "1 ki");
    const plain = await spend(wyrm, "Breath of the Dragon", { variant: "fire", targetEnemyIds: [near.id] }, 2);
    assert.equal(plain.ok, true, plain.error);
    assert.equal(300 - r.foe(near).currentHp, 6, "the next breath of the turn is the plain three rolls");
    assert.equal(r.used(wyrm, "ki"), 1, "and took no more ki");
    const [other] = await stage(dragon);
    const young = await spend(dragon, "Breath of the Dragon", { variant: "augmented fire", targetEnemyIds: [other.id] }, 2);
    assert.equal(young.ok, false, `at 11th level there is no Augment Breath to ask for: ${show(young)}`);
  });

  // Blindsight to 10 feet: an invisible creature beside the monk is attacked
  // with no disadvantage, and one 15 feet off is still unseen.
  await probe("ascendant-aspect-blindsight", async () => {
    const hidden = async (who, at) => {
      const [enemy] = await stage(who);
      kit.place(enemy.id, at, 5);
      kit.setEnemy(enemy.id, { conditions: ["invisible"] });
      return (await r.swing(who, enemy, [15, 15, 3], at > 6 ? { weapon: "dart" } : UNARMED)).toHit?.advantage;
    };
    assert.equal(await hidden(dragon, 6), "disadvantage", "the staging: at 11th level an invisible creature 5 feet off is attacked at disadvantage");
    assert.equal(await hidden(wyrm, 6), "none", "at 17th level the monk perceives it within 10 feet");
  });

  // Draconic Strike: the chosen type against a creature that resists it, and
  // bludgeoning again once the monk goes back to it.
  await probe("draconic-strike-type", async () => {
    const struck = async (type) => {
      await r.choose(dragon, "Draconic Strike", type);
      const [enemy] = await stage(dragon);
      kit.setEnemy(enemy.id, { stats: { resist: "fire" } });
      const hit = await r.swing(dragon, enemy, [15, 4], UNARMED);
      assert.equal(hit.result.hit, true, hit.error);
      return { lost: 300 - r.foe(enemy).currentHp, hit };
    };
    const fire = await struck("fire");
    assert.equal(fire.lost, Math.floor((4 + MOD) / 2), `a fire strike (a 4 + Dexterity) on a creature that resists fire: ${JSON.stringify(fire.hit.result).slice(0, 200)}`);
    assert.match(JSON.stringify(fire.hit.result), /fire/i, "the strike's damage is fire");
    const plain = await struck("bludgeoning");
    assert.equal(plain.lost, 4 + MOD, "back to bludgeoning, the same blow lands whole");
  });

  // Draconic Presence: a failed Intimidation or Persuasion check is rolled
  // again as a reaction; the use goes only when the reroll succeeds.
  await probe("draconic-presence", async () => {
    const card = await afterRollKit(world);
    const ask = async (skill, face) => {
      world.clearDice();
      world.dice(face);
      const out = await world.invoke("request_roll", { characterId: dragon.id, kind: "skill_check", skill, dc: 15, reason: "a clause probe" });
      world.clearDice();
      assert.equal(out.ok, true, out.error);
      return out;
    };
    await stage(dragon);
    await ask("intimidation", 2);
    assert.deepEqual(card.offered(), ["draconic_presence"], "a failed Intimidation check waits on the monk");
    const still = await card.choose(dragon, "draconic_presence", 3);
    assert.equal(still.roll.total, 3 + MOD, "the reroll (a 3) stands, and fails");
    assert.equal(r.used(dragon, "sub_draconic_presence"), 0, "a reroll that still fails keeps the use");
    assert.ok(world.encounter().reactionsUsed.includes(dragon.id), "the reaction");
    await card.keepAll(dragon);
    await stage(dragon);
    await ask("persuasion", 2);
    const turned = await card.choose(dragon, "draconic_presence", 18);
    assert.equal(turned.roll.total, 18 + MOD, "the reroll (an 18) stands");
    assert.equal(r.used(dragon, "sub_draconic_presence"), 1, "it turned the failure, and waits for a long rest");
    await stage(dragon);
    r.setUsed(dragon, "sub_draconic_presence", 1);
    await ask("intimidation", 2);
    assert.deepEqual(card.offered(), [], "with the use spent nothing is offered");
    await card.keepAll(dragon);
    await stage(dragon);
    await ask("athletics", 2);
    assert.deepEqual(card.offered(), [], "an Athletics check is none of its two");
    await card.keepAll(dragon);
  });

  // "Once per long rest or for 3 ki."
  await probe("aspect-of-the-wyrm-ki", async () => {
    await stage(dragon);
    r.setUsed(dragon, "sub_aspect_of_the_wyrm", 1);
    const out = await spend(dragon, "Aspect of the Wyrm", { variant: "frighten" }, 2);
    assert.equal(out.ok, true, out.error);
    assert.deepEqual([r.used(dragon, "sub_aspect_of_the_wyrm"), r.used(dragon, "ki")], [1, 3], "3 ki in the use's place");
    await stage(dragon);
    r.setUsed(dragon, "sub_aspect_of_the_wyrm", 1);
    r.setUsed(dragon, "ki", r.max(dragon, "ki") - 2);
    assert.equal((await spend(dragon, "Aspect of the Wyrm", { variant: "frighten" }, 2)).ok, false, "with 2 ki left");
  });

  // "When you take the Attack action you can replace one attack": the breath
  // spends one swing of the Attack action (resource-turn.ts replacesAttack),
  // so a monk with Extra Attack still has the other, and none is left after.
  await probe("breath-of-the-dragon-replaces-an-attack", async () => {
    const [enemy] = await stage(dragon);
    const out = await spend(dragon, "Breath of the Dragon", { variant: "fire", targetEnemyIds: [enemy.id] }, 2);
    assert.equal(out.ok, true, out.error);
    const turn = world.encounter().turnBudget;
    assert.equal(turn.attacksMade, 1, `the breath took ${turn.attacksMade} of the Attack action's ${turn.attacksAllowed} attacks`);
    assert.equal(turn.attacksAllowed, 2, "Extra Attack at 11th level");
    const swing = await kit.swing(dragon.id, enemy.id, [15, 4, 4, 4], UNARMED);
    assert.ok(swing && !swing.error, `the other attack: ${swing?.error}`);
    const again = await spend(dragon, "Breath of the Dragon", { variant: "fire", targetEnemyIds: [enemy.id] }, 2);
    assert.equal(again.ok, false, `a breath with both attacks spent: ${show(again)}`);
  });
}

finish();
