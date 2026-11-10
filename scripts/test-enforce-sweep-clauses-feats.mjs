// The clause ledger's probes for the feats of src/lib/srd/authored-feats.json.
// The clause text and the verdict live in scripts/clauses/feats.json; this
// file holds how each clause that names it is staged.
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const worn = (...names) => names.map((name) => ({ name, qty: 1, equipped: true }));
const P = {};

P["feat.medium-armor-master.ac"] = async () => {
  const t = await rig.table();
  const base = { class: "fighter", level: 4, equipment: worn("Breastplate"), abilities: { dex: 16 } };
  const plain = t.hero(base);
  const master = t.hero({ ...base, feats: ["Medium Armor Master"] });
  assert.equal(t.ac(master) - t.ac(plain), 1, `breastplate with Dexterity 16: ${t.ac(plain)} without the feat, ${t.ac(master)} with it`);
};

P["feat.medium-armor-master.stealth"] = async () => {
  const t = await rig.table();
  const master = t.hero({ class: "fighter", level: 4, equipment: worn("Half Plate"), abilities: { dex: 16 }, feats: ["Medium Armor Master"] });
  const roll = await t.roll(master, { kind: "skill_check", skill: "stealth", dc: 10 }, [15, 3]);
  assert.equal(roll.ok, true, roll.error);
  assert.equal(roll.faces.length, 1, `half plate's Stealth disadvantage stayed on a Medium Armor Master: ${roll.faces.length} d20s`);
};

P["feat.heavy-armor-master.reduce"] = async () => {
  const t = await rig.table();
  const who = t.hero({ class: "fighter", level: 4, equipment: worn("Plate"), feats: ["Heavy Armor Master"] });
  assert.equal(t.ac(who), 18, "the staging: plate is worn heavy armor (AC 18)");
  const [foe] = await t.fight([who]);
  t.foesTurn(foe);
  const before = t.sheet(who).currentHp;
  // The dummy's club: 16 + 4 hits AC 18, a 4 on the d6 + 2 is 6 bludgeoning.
  const out = await t.strike(foe, who, [16, 4]);
  assert.equal(out.ok, true, out.error);
  assert.equal(before - t.sheet(who).currentHp, 3, `a nonmagical club hit of 6 took ${before - t.sheet(who).currentHp} off a Heavy Armor Master in plate`);
};

P["feat.dual-wielder.ac"] = async () => {
  const t = await rig.table();
  const base = { class: "fighter", level: 4, equipment: worn("Shortsword", "Shortsword") };
  const plain = t.hero(base);
  const dual = t.hero({ ...base, feats: ["Dual Wielder"] });
  assert.equal(t.ac(dual) - t.ac(plain), 1, `a weapon in each hand: ${t.ac(plain)} without the feat, ${t.ac(dual)} with it`);
};

P["feat.mobile.no-opportunity-attack"] = async () => {
  const t = await rig.table();
  const who = t.hero({ class: "fighter", level: 4, equipment: worn("Longsword"), feats: ["Mobile"] });
  const [foe] = await t.fight([who]);
  const hit = await t.swing(who, foe, [15, 4]);
  assert.equal(hit.ok, true, hit.error);
  t.world.signIn({ id: t.sheet(who).userId });
  const route = await t.world.route("campaigns/[campaignId]/battle-map/move");
  t.world.clearDice();
  t.world.diceLog();
  t.world.dice(15, 4, 15, 4);
  const moved = await route.POST(new Request(`http://odm.test/api/campaigns/${t.world.campaignId}/battle-map/move`, { method: "POST", body: JSON.stringify({ x: 2, y: 5 }) }), { params: Promise.resolve({ campaignId: t.world.campaignId }) });
  t.world.clearDice();
  assert.equal(moved.status, 200, `the move was refused: ${moved.status}`);
  assert.equal(t.world.diceLog().filter((die) => die.sides === 20).length, 0, "the creature the Mobile fighter attacked made an opportunity attack as they left");
};

// ---- the second wave: prerequisites, ranged rules, proficiencies, pools ----
const { authoredFeatPrerequisite } = await import("../src/lib/srd/feat-effects.ts");
const { unmetPrerequisite } = await import("../src/lib/srd/legality/features.ts");
const plainScores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
const who = (over = {}) => ({ abilities: plainScores, armor: [], casts: false, raceId: "human", raceName: "Human", ...over });

// Each feat's prerequisite refuses the character without it and takes the
// one with it (src/lib/srd/legality/features.ts, read by the builder and the
// server's feat check alike).
P["feat.prerequisites"] = async () => {
  const cases = {
    "Defensive Duelist": [who(), who({ abilities: { ...plainScores, dex: 13 } })],
    Skulker: [who(), who({ abilities: { ...plainScores, dex: 13 } })],
    "Inspiring Leader": [who(), who({ abilities: { ...plainScores, cha: 13 } })],
    "Ritual Caster": [who(), who({ abilities: { ...plainScores, wis: 13 } })],
    "Elven Accuracy": [who(), who({ raceId: "elf", raceName: "Elf" })],
    "Elemental Adept": [who(), who({ casts: true })],
    "Spell Sniper": [who(), who({ casts: true })],
    "War Caster": [who(), who({ casts: true })],
    "Eldritch Adept": [who(), who({ casts: true })],
    "Metamagic Adept": [who(), who({ casts: true })],
    "Heavily Armored": [who({ armor: ["light"] }), who({ armor: ["light", "medium"] })],
    "Heavy Armor Master": [who({ armor: ["light", "medium"] }), who({ armor: ["light", "medium", "heavy"] })],
    "Medium Armor Master": [who({ armor: ["light"] }), who({ armor: ["light", "medium"] })],
    "Moderately Armored": [who(), who({ armor: ["light"] })],
  };
  const wrong = [];
  for (const [feat, [without, holder]] of Object.entries(cases)) {
    const text = authoredFeatPrerequisite(feat);
    if (!text) wrong.push(`${feat}: no prerequisite on the row`);
    else if (!unmetPrerequisite(text, without)) wrong.push(`${feat}: "${text}" taken without it`);
    else if (unmetPrerequisite(text, holder)) wrong.push(`${feat}: "${text}" refused with it`);
  }
  assert.deepEqual(wrong, []);
};

const d20s = (swing) => swing.toHit?.breakdown?.terms?.[0]?.dice?.length ?? 0;

P["feat.crossbow-expert.adjacent"] = async () => {
  const t = await rig.table();
  const gear = worn("Light Crossbow", "Crossbow Bolts");
  const plain = t.hero({ class: "fighter", level: 4, equipment: gear });
  const expert = t.hero({ class: "fighter", level: 4, equipment: gear, feats: ["Crossbow Expert"] });
  const thrown = {};
  for (const [label, hero] of [["plain", plain], ["expert", expert]]) {
    const [foe] = await t.fight([hero]);
    thrown[label] = d20s(await t.swing(hero, foe, [15, 15, 4], { weapon: "Light Crossbow" }));
  }
  assert.deepEqual(thrown, { plain: 2, expert: 1 }, "d20s for a crossbow shot with a foe beside the shooter");
};

P["feat.sharpshooter.long-range"] = async () => {
  const t = await rig.table();
  const gear = worn("Hand Crossbow", "Crossbow Bolts");
  const thrown = {};
  for (const [label, feats] of [["plain", []], ["sharpshooter", ["Sharpshooter"]]]) {
    const hero = t.hero({ class: "fighter", level: 4, equipment: gear, feats });
    const [near, far] = await t.fight([hero], { foes: 2 });
    // The other foe off the shooter's elbow, so only the range weighs.
    t.kit.place(near.id, 17, 12);
    thrown[label] = d20s(await t.swing(hero, far, [15, 15, 4], { weapon: "Hand Crossbow" }));
  }
  assert.deepEqual(thrown, { plain: 2, sharpshooter: 1 }, `d20s for a hand crossbow shot at 60 feet (its long range): ${JSON.stringify(thrown)}`);
};

// The proficiencies a feat grants are read from its text into the grants
// the builder, the level-up and the sheet check apply (feat-grant-text.ts
// featGrantSpec, applied by feat-grants.ts applyFeatGrants).
const { featGrantSpec } = await import("../src/lib/srd/feat-grant-text.ts");
const { authoredFeatDesc } = await import("../src/lib/srd/feat-effects.ts");
P["feat.heavily-armored.proficiency"] = async () => {
  const spec = featGrantSpec(authoredFeatDesc("Heavily Armored"));
  assert.ok(spec.armor.some((entry) => /heavy/i.test(entry)), `armor granted: ${JSON.stringify(spec.armor)}`);
};

P["feat.moderately-armored.proficiency"] = async () => {
  const spec = featGrantSpec(authoredFeatDesc("Moderately Armored"));
  const armor = spec.armor.join(", ");
  assert.ok(/medium/i.test(armor) && /shield/i.test(armor), `armor granted: ${armor}`);
};

P["feat.metamagic-adept.points"] = async () => {
  const t = await rig.table();
  const hero = t.hero({ class: "wizard", level: 4, feats: ["Metamagic Adept"], spells: ["Magic Missile"] });
  assert.equal(t.max(hero, "sorcery_points"), 2, `a wizard's sorcery points: ${JSON.stringify(t.sheet(hero).resources)}`);
  t.patch(hero, { resources: { ...t.sheet(hero).resources, sorcery_points: { max: 2, used: 2 } } });
  await t.rest("short");
  assert.equal(t.used(hero, "sorcery_points"), 2, "a short rest gives the points back");
  await t.rest("long");
  assert.equal(t.used(hero, "sorcery_points"), 0, "the long rest gives the points back");
};

P["feat.martial-adept.die"] = async () => {
  const t = await rig.table();
  const hero = t.hero({ class: "wizard", level: 4, feats: ["Martial Adept"], spells: ["Magic Missile"] });
  const pools = Object.entries(t.sheet(hero).resources ?? {}).filter(([id]) => /superiority/.test(id));
  assert.deepEqual(pools.map(([, state]) => state.max), [1], `superiority pools: ${JSON.stringify(pools)}`);
  const [id] = pools[0];
  const { maneuverDieFor } = await import("../src/lib/dm/maneuver-rules.ts");
  assert.equal(maneuverDieFor(t.sheet(hero)), "d6", "the Martial Adept's die");
  t.patch(hero, { resources: { ...t.sheet(hero).resources, [id]: { max: 1, used: 1 } } });
  await t.rest("short");
  assert.equal(t.used(hero, id), 0, "a short rest gives the die back");
};

P["feat.healer.stabilize"] = async () => {
  const t = await rig.table();
  const healer = t.hero({ class: "fighter", level: 4, feats: ["Healer"], equipment: [{ name: "Healer's Kit", qty: 1 }] });
  const fallen = t.hero({ class: "fighter", level: 4 });
  t.patch(fallen, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  const out = await t.invoke("stabilize", { characterId: fallen.id, healerId: healer.id, method: "kit" });
  assert.equal(out.ok, true, out.error);
  assert.equal(t.sheet(fallen).currentHp, 1, "a creature stabilized with a Healer's kit regains 1 hit point");
};

P["feat.alert.unseen"] = async () => {
  const t = await rig.table();
  const alert = t.hero({ class: "fighter", level: 4, equipment: worn("Plate"), feats: ["Alert"] });
  const [foe] = await t.fight([alert]);
  t.kit.setEnemy(foe.id, { conditions: ["invisible"] });
  t.foesTurn(foe);
  const out = await t.strike(foe, alert, [16, 2, 4]);
  assert.equal(out.ok, true, out.error);
  const faces = (t.lastRolls(4).find((roll) => roll.kind === "attack")?.breakdown?.terms?.[0]?.dice ?? []).length;
  assert.equal(faces, 1, `an invisible attacker rolls with advantage against an Alert holder: ${faces} d20s, ${JSON.stringify(out.result).slice(0, 200)}`);
};

// ---- wave 2: the read_only clauses no probe had staged ----
const grants = (feat) => featGrantSpec(authoredFeatDesc(feat));
const { featAbilityIncrease } = await import("../src/lib/srd/feat-effects.ts");

P["feat.weapon-master.picks"] = async () => {
  const spec = grants("Weapon Master");
  assert.equal(spec.weapons, 4, `weapons picked: ${spec.weapons}`);
  const raise = JSON.stringify(featAbilityIncrease("Weapon Master"));
  assert.ok(/str/i.test(raise) && /dex/i.test(raise), `the score it raises: ${raise}`);
};

P["feat.poisoner.kit"] = async () => {
  assert.deepEqual(grants("Poisoner").fixedTools, ["poisoner's kit"]);
};

P["feat.gunner.proficiency"] = async () => {
  assert.deepEqual(grants("Gunner").fixedWeapons, ["firearms"]);
  // The loading property is ignored where every shot reads it (feat-combat.ts).
  const { shootsFreelyInMelee } = await import("../src/lib/srd/feat-combat.ts");
  assert.equal(shootsFreelyInMelee({ feats: ["Gunner"], features: [] }), true);
  assert.equal(shootsFreelyInMelee({ feats: [], features: [] }), false);
};

P["feat.skilled.no-score"] = async () => {
  assert.equal(featAbilityIncrease("Skilled"), null, "Skilled raises a score");
};

P["feat.shadow-touched.picks"] = async () => {
  const taught = grants("Shadow Touched").taught;
  assert.equal(taught.spells, 1, "one 1st-level spell picked");
  assert.deepEqual([...taught.schools].sort(), ["illusion", "necromancy"]);
  assert.ok(JSON.stringify(taught.fixedSpells ?? []).toLowerCase().includes("invisibility"), `fixed: ${JSON.stringify(taught.fixedSpells)}`);
};

P["feat.spell-sniper.range"] = async () => {
  const t = await rig.table();
  const reached = {};
  for (const [label, feats] of [["plain", []], ["sniper", ["Spell Sniper"]]]) {
    const hero = t.hero({ class: "wizard", level: 4, feats, spells: ["Ray of Frost"], cantrips: ["Ray of Frost"] });
    const [foe] = await t.fight([hero]);
    const at = t.kit.token(hero.id);
    // 90 feet off: past Ray of Frost's 60, inside twice it.
    t.kit.place(foe.id, at.x + 18 < t.kit.map().width ? at.x + 18 : at.x - 18, at.y);
    const out = await t.invoke("pc_attack", { characterId: hero.id, targetEnemyId: foe.id, spell: "Ray of Frost" }, [15, 4]);
    reached[label] = out.ok;
  }
  assert.deepEqual(reached, { plain: false, sniper: true }, "Ray of Frost at 90 feet");
};

// ---- wave 2, round 4: feat clauses read where the engine reads them ----
// Each probe reads the helper at the one door its engine site calls (named in
// the ledger's "by"), with the feat and without it, so a helper that answers
// yes for anyone fails too.
const combat = await import("../src/lib/srd/feat-combat.ts");
const { standUpTiles } = await import("../src/lib/srd/authored-effects-more.ts");
const holder = (feat) => ({ feats: [feat], features: [] });
const nobody = { feats: [], features: [] };

P["feat.athlete.stand"] = async () => {
  // Thirty feet of speed is 6 squares: standing costs half (3), an Athlete 1.
  assert.deepEqual([standUpTiles(nobody, 6), standUpTiles(holder("Athlete"), 6)], [3, 1]);
};

P["feat.poisoner.resistance"] = async () => {
  assert.deepEqual(
    [combat.poisonerIgnoresResistance(holder("Poisoner"), "poison"), combat.poisonerIgnoresResistance(holder("Poisoner"), "fire"), combat.poisonerIgnoresResistance(nobody, "poison")],
    [true, false, false],
  );
};

P["feat.sharpshooter.cover"] = async () => {
  assert.deepEqual([combat.shotIgnoresCover(holder("Sharpshooter")), combat.shotIgnoresCover(nobody)], [true, false]);
};

P["feat.mage-slayer.save"] = async () => {
  assert.deepEqual(combat.spellSaveAdvantageReach(holder("Mage Slayer")), { feat: "Mage Slayer", tiles: 1 });
  assert.equal(combat.spellSaveAdvantageReach(nobody), null);
};

P["feat.polearm-master.enter"] = async () => {
  assert.deepEqual(
    [combat.polearmReachOpportunity(holder("Polearm Master"), "Glaive"), combat.polearmReachOpportunity(holder("Polearm Master"), "Longsword"), combat.polearmReachOpportunity(nobody, "Glaive")],
    [true, false, false],
  );
};

P["feat.shield-master.shove"] = async () => {
  const attacked = { oncePerTurn: [], attacksMade: 1, dashed: false };
  assert.deepEqual(combat.featBonusRoute(holder("Shield Master"), "shove", attacked, true), { feature: "Shield Master", ki: 0 });
  assert.equal(combat.featBonusRoute(holder("Shield Master"), "shove", { ...attacked, attacksMade: 0 }, true), null, "before the Attack action");
  assert.equal(combat.featBonusRoute(holder("Shield Master"), "shove", attacked, false), null, "with no shield");
};

P["feat.charger.shove"] = async () => {
  const dashed = { oncePerTurn: [], attacksMade: 0, dashed: true };
  assert.deepEqual(combat.featBonusRoute(holder("Charger"), "shove", dashed, false), { feature: "Charger", ki: 0 });
  assert.equal(combat.featBonusRoute(holder("Charger"), "shove", { ...dashed, dashed: false }, false), null, "with no Dash");
  // The other choice: one melee attack (pc-attack-options.ts featBonusAttack).
  const swing = { weaponAttack: true, melee: true, weapon: "Longsword" };
  assert.equal(combat.featBonusAttack(holder("Charger"), { oncePerTurn: [], dashed: true }, swing), "Charger");
  assert.equal(combat.featBonusAttack(holder("Charger"), { oncePerTurn: [], dashed: false }, swing), null, "with no Dash");
};

P["feat.crossbow-expert.bonus"] = async () => {
  const shot = { weaponAttack: true, melee: false, weapon: "Hand Crossbow" };
  assert.equal(combat.featBonusAttack(holder("Crossbow Expert"), { oncePerTurn: [combat.ONE_HANDED_ATTACKED], dashed: false }, shot), "Crossbow Expert");
  assert.equal(combat.featBonusAttack(holder("Crossbow Expert"), { oncePerTurn: [], dashed: false }, shot), null, "before an Attack action with a one-handed weapon");
  assert.equal(combat.featBonusAttack(holder("Crossbow Expert"), { oncePerTurn: [combat.ONE_HANDED_ATTACKED], dashed: false }, { ...shot, weapon: "Light Crossbow" }), null, "only the hand crossbow");
};

P["feat.durable.floor"] = async () => {
  assert.deepEqual(combat.hitDieHealingFloor(holder("Durable"), 3), { feat: "Durable", floor: 6, extra: 0 });
  assert.equal(combat.hitDieHealingFloor(holder("Durable"), 0).floor, 2, "at least 2");
  assert.equal(combat.hitDieHealingFloor(nobody, 3), null);
};

P["feat.skulker.hide"] = async () => {
  assert.deepEqual([combat.hasSkulker(holder("Skulker")), combat.hasSkulker(nobody)], [true, false]);
};

await runOrSurvey("scripts/test-enforce-sweep-clauses-feats.mjs", P);
