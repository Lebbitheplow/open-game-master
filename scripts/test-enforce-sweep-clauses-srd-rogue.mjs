// The clause ledger's probes for the rogue (SRD 5.1) and the Thief. The
// clause text and the verdict live in scripts/clauses/srd-classes.json; this
// file holds how each clause that names it is staged.
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig, TRAINED } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const RAPIER = [{ name: "Rapier", qty: 1, equipped: true }];
const SKILLED = { ...TRAINED, skills: ["stealth", "sleight_of_hand", "acrobatics"], tools: ["thieves' tools"] };
const rogue = (t, level, extra = {}) => t.hero({ class: "rogue", level, equipment: RAPIER, proficiencies: SKILLED, ...extra, abilities: { dex: 16, ...(extra.abilities ?? {}) } });
const thief = (t, level, extra = {}) => rogue(t, level, { subclass: "Thief", ...extra });

const P = {};

P["rogue.cunning-action.only-three"] = async () => {
  const t = await rig.table();
  const who = rogue(t, 2);
  await t.fight([who]);
  for (const action of ["dodge", "help", "search"]) {
    const out = await t.act(who, action, { bonus: true });
    assert.equal(out.ok, false, `Cunning Action took ${action} as a bonus action`);
    assert.equal(t.budget()?.bonusUsed ?? false, false, `the refused ${action} spent the bonus action`);
  }
  const dash = await t.act(who, "dash", { bonus: true });
  assert.equal(dash.ok, true, dash.error);
  assert.equal(t.budget().bonusUsed, true);
  assert.equal(t.budget().actionUsed, false);
};

P["rogue.roguish-archetype.archetypes"] = async () => {
  const names = (await import("../src/lib/srd/features.ts")).subclassNamesFor("rogue");
  for (const name of ["Thief", "Assassin", "Arcane Trickster"]) {
    assert.ok(names.includes(name), `no ${name}`);
  }
};

P["rogue.uncanny-dodge.sight"] = async () => {
  const t = await rig.table();
  const who = rogue(t, 5);
  const [foe] = await t.fight([who]);
  t.foesTurn(foe);
  t.patch(who, { conditions: ["blinded"], conditionMeta: {} });
  const hit = await t.strike(foe, who, [16, 4]);
  assert.equal(hit.ok, true, hit.error);
  const hp = t.sheet(who).currentHp;
  const out = await t.invoke("use_reaction", { characterId: who.id, feature: "Uncanny Dodge" });
  assert.equal(out.ok, false, "a blinded rogue halved the hit of an attacker they cannot see");
  assert.equal(t.sheet(who).currentHp, hp);
};

P["rogue.fast-hands.sleight"] = async () => {
  const t = await rig.table();
  const who = thief(t, 3);
  await t.fight([who]);
  const out = await t.act(who, "improvise", { bonus: true, skill: "sleight_of_hand", difficulty: "moderate", reason: "palming the key" }, [15]);
  assert.equal(out.ok, true, `a Thief's Sleight of Hand check as the bonus action was refused: ${out.error}`);
  assert.equal(t.budget()?.bonusUsed ?? false, true, "the check took no bonus action");
  assert.equal(t.budget()?.actionUsed ?? false, false, "the check took the action");
};

P["rogue.fast-hands.tools"] = async () => {
  const t = await rig.table();
  const who = thief(t, 3, { equipment: [...RAPIER, { name: "Thieves' Tools", qty: 1 }] });
  await t.fight([who]);
  const out = await t.act(who, "use_object", { bonus: true, item: "thieves' tools on the chest's lock" }, [15]);
  assert.equal(out.ok, true, `thieves' tools as the bonus action were refused: ${out.error}`);
  assert.equal(t.budget()?.bonusUsed ?? false, true);
  assert.equal(t.budget()?.actionUsed ?? false, false);
};

P["rogue.thiefs-reflexes.surprised"] = async () => {
  const t = await rig.table();
  const who = thief(t, 17);
  // The whole party is surprised: the enemies take round 1 and the thief's
  // second turn of that round is lost with the first.
  await t.kit.fight(1, { surprised: "party", enemyFace: 5, heroFaces: { [who.id]: 20 } });
  const encounter = t.world.encounter();
  assert.equal(encounter.round, 2, `a surprised thief was given a turn in round ${encounter.round}`);
  assert.equal(t.kit.current()?.characterId, who.id);
};

P["rogue.stroke-of-luck.check"] = async () => {
  const t = await rig.table();
  const who = rogue(t, 20);
  // A 2 on the die: 5 against DC 20 with +3 to Athletics.
  const failed = await t.roll(who, { kind: "skill_check", skill: "athletics", dc: 20 }, [2]);
  assert.equal(failed.stored?.total, 5, "the staging: the check fails on a 2");
  const luck = await t.use(who, "Stroke of Luck");
  assert.equal(luck.ok, true, luck.error);
  assert.equal(luck.result.check.total, 23, "the d20 read as a 20");
  assert.equal(luck.result.check.success, true);
  assert.equal(t.used(who, "stroke_of_luck"), 1, "the use");
  const again = await t.roll(who, { kind: "skill_check", skill: "athletics", dc: 20 }, [2]);
  assert.equal(again.stored?.total, 5);
  const spent = await t.use(who, "Stroke of Luck");
  assert.equal(spent.ok, false, "a second failed check was turned before a rest");
  // A check that was made has nothing to turn.
  const t2 = await rig.table();
  const lucky = rogue(t2, 20);
  const made = await t2.roll(lucky, { kind: "skill_check", skill: "athletics", dc: 10 }, [15]);
  assert.equal(made.stored?.success, true, "the staging: the check is made");
  const none = await t2.use(lucky, "Stroke of Luck");
  assert.equal(none.ok, false, "Stroke of Luck was spent on a check that succeeded");
  assert.equal(t2.used(lucky, "stroke_of_luck"), 0);
};

await runOrSurvey("scripts/test-enforce-sweep-clauses-srd-rogue.mjs", P);
