// The clause ledger's probes for the bard (SRD 5.1) and the College of Lore.
// The clause text and the verdict live in scripts/clauses/srd-classes.json;
// this file holds how each clause that names it is staged.
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const bard = (t, level, extra = {}) => t.hero({ class: "bard", level, ...extra, abilities: { cha: 16, ...(extra.abilities ?? {}) } });
const ally = (t) => t.hero({ class: "fighter", level: 5 });
const P = {};

// The fight: the bard has the floor at (5,5), the ally beside at (4,5).
async function inspire(t, who, target, args = {}) {
  return t.use(who, "Bardic Inspiration", { targetCharacterId: target.id, ...args });
}

P["bard.bardic-inspiration.bonus-action"] = async () => {
  const t = await rig.table();
  const who = bard(t, 1);
  const friend = ally(t);
  await t.fight([who, friend]);
  const out = await inspire(t, who, friend);
  assert.equal(out.ok, true, out.error);
  assert.equal(t.budget().bonusUsed, true, "the bonus action");
  assert.equal(t.budget().actionUsed ?? false, false);
};

P["bard.bardic-inspiration.other-than-you"] = async () => {
  const t = await rig.table();
  const who = bard(t, 1);
  await t.fight([who]);
  const out = await inspire(t, who, who);
  assert.equal(out.ok, false, "the bard gave the die to themselves");
  assert.equal(t.used(who, "bardic_inspiration"), 0, "the refused self-inspiration spent a use");
};

P["bard.bardic-inspiration.within-60-feet"] = async () => {
  const t = await rig.table();
  const who = bard(t, 1);
  const friend = ally(t);
  await t.fight([who, friend]);
  t.kit.place(friend.id, 19, 14);
  const out = await inspire(t, who, friend);
  assert.equal(out.ok, false, "an ally 70 feet away was inspired");
};

P["bard.bardic-inspiration.hears"] = async () => {
  const t = await rig.table();
  const who = bard(t, 1);
  const friend = ally(t);
  await t.fight([who, friend]);
  t.patch(friend, { conditions: ["deafened"], conditionMeta: {} });
  const deaf = await inspire(t, who, friend);
  assert.equal(deaf.ok, false, "an ally who cannot hear the bard was inspired");
  assert.equal(t.used(who, "bardic_inspiration"), 0, "the refused inspiration spent a use");
  t.patch(friend, { conditions: [], conditionMeta: {} });
  const heard = await inspire(t, who, friend);
  assert.equal(heard.ok, true, heard.error);
};

P["bard.bardic-inspiration.uses"] = async () => {
  const t = await rig.table();
  const ids = (who) => Object.keys(t.sheet(who).resources ?? {}).find((id) => /inspiration/i.test(id));
  for (const [cha, uses] of [[16, 3], [8, 1], [20, 5]]) {
    const who = bard(t, 1, { abilities: { cha } });
    const id = ids(who);
    assert.ok(id, `no Bardic Inspiration counter: ${Object.keys(t.sheet(who).resources ?? {}).join(", ")}`);
    assert.equal(t.max(who, id), uses, `Charisma ${cha}`);
  }
};

P["bard.bardic-inspiration.one-die"] = async () => {
  const t = await rig.table();
  const who = bard(t, 1);
  const friend = ally(t);
  await t.fight([who, friend]);
  assert.equal((await inspire(t, who, friend)).ok, true);
  t.freshTurn();
  const second = await inspire(t, who, friend);
  assert.equal(second.ok, false, "a creature that holds a Bardic Inspiration die was given a second");
};

P["bard.bonus-proficiencies-lore.three-skills"] = async () => {
  const training = await import("../src/lib/srd/subclass-training.ts");
  const grants = training.subclassGrants([{ id: "bard", level: 3, subclass: "College of Lore" }]);
  const grant = grants.find((entry) => /bonus proficiencies/i.test(entry.name));
  assert.ok(grant, `no training grant for Bonus Proficiencies: [${grants.map((entry) => entry.name).join(", ")}]`);
  assert.equal(grant.spec.skills, 3, JSON.stringify(grant.spec).slice(0, 200));
};

// ---- Countercharm ----

// A save against being frightened, and how many d20 it was rolled with.
async function fearSave(t, who) {
  const save = await t.roll(who, { kind: "saving_throw", ability: "wis", dc: 12, against: "frightened" }, [9, 14]);
  assert.equal(save.ok, true, save.error);
  return save.faces.length;
}
const perform = (t, who, args = {}) => t.use(who, "Countercharm", args);

P["bard.countercharm.performance"] = async () => {
  const t = await rig.table();
  const who = bard(t, 6);
  const friend = ally(t);
  const far = ally(t);
  await t.fight([who, friend, far]);
  t.kit.place(far.id, 15, 5);
  assert.equal(await fearSave(t, friend), 1, "the staging: no advantage before the performance");
  const out = await perform(t, who);
  assert.equal(out.ok, true, out.error);
  assert.equal(t.budget().actionUsed, true, "the action");
  assert.equal(await fearSave(t, who), 2, "the bard has no advantage against fear while performing");
  assert.equal(await fearSave(t, friend), 2, "a friend within 30 feet has no advantage");
  assert.equal(await fearSave(t, far), 1, "a friend 50 feet away has the advantage");
  // "until the end of your next turn": the round goes by, the bard's next
  // turn comes and ends.
  const round = () => {
    for (let passed = 0; passed < 4; passed += 1) {
      const now = t.kit.current()?.characterId;
      assert.ok(now, "the staging: a hero holds the floor");
      assert.ok(t.endTurn({ id: now }), "the staging: the turn ends");
      if (t.kit.current()?.characterId === who.id) return;
    }
    assert.fail("the staging: the floor never came back to the bard");
  };
  round();
  assert.equal(await fearSave(t, friend), 2, "the performance ended before the bard's next turn was over");
  round();
  assert.equal(await fearSave(t, friend), 1, "the performance outlasted the bard's next turn");
};

P["bard.countercharm.hears"] = async () => {
  const t = await rig.table();
  const who = bard(t, 6);
  const friend = ally(t);
  const deaf = ally(t);
  await t.fight([who, friend, deaf]);
  t.patch(deaf, { conditions: ["deafened"], conditionMeta: {} });
  assert.equal((await perform(t, who)).ok, true);
  assert.equal(await fearSave(t, friend), 2, "the staging: a friend who hears has the advantage");
  assert.equal(await fearSave(t, deaf), 1, "a friend who cannot hear the bard has the advantage");
};

P["bard.countercharm.ends-early"] = async () => {
  // Incapacitated.
  const t = await rig.table();
  const who = bard(t, 6);
  const friend = ally(t);
  await t.fight([who, friend]);
  assert.equal((await perform(t, who)).ok, true);
  assert.equal(await fearSave(t, friend), 2, "the staging: the performance is on");
  const stunned = await t.condition(who, "stunned", { rounds: 5 });
  assert.equal(stunned.ok, true, stunned.error);
  assert.equal(await fearSave(t, friend), 1, "the bard is incapacitated and the performance goes on");
  // The bard's own word, for no action.
  const t2 = await rig.table();
  const second = bard(t2, 6);
  const other = ally(t2);
  await t2.fight([second, other]);
  assert.equal((await perform(t2, second)).ok, true);
  t2.freshTurn();
  const ended = await perform(t2, second, { variant: "end" });
  assert.equal(ended.ok, true, ended.error);
  assert.equal(t2.budget()?.actionUsed ?? false, false, "ending the performance took the action");
  assert.equal(await fearSave(t2, other), 1, "the performance the bard ended goes on");
};

// ---- Song of Rest ----

P["bard.song-of-rest.hears"] = async () => {
  const t = await rig.table();
  bard(t, 2);
  const friend = ally(t);
  const deaf = ally(t);
  t.patch(friend, { currentHp: 20 });
  t.patch(deaf, { currentHp: 20, conditions: ["deafened"], conditionMeta: {} });
  const gained = (who) => t.sheet(who).currentHp - 20;
  // A d10 hit die (4) and, for who hears the song, its d6 (3).
  const out = await t.invoke("take_rest", { kind: "short", spend: [{ characterId: friend.id, dice: 1 }, { characterId: deaf.id, dice: 1 }] }, [4, 3, 4, 3]);
  assert.equal(out.ok, true, out.error);
  assert.ok(gained(friend) > 0 && gained(deaf) > 0, `the staging: both spent a hit die: ${JSON.stringify(out.result).slice(0, 300)}`);
  assert.equal(gained(friend) - gained(deaf), 3, `the song's die: ${gained(friend)} regained by the one who hears, ${gained(deaf)} by the one who cannot`);
};

// ---- Cutting Words ----

P["bard.cutting-words.immune"] = async () => {
  const stage = async (foePatch) => {
    const t = await rig.table();
    const who = bard(t, 3, { subclass: "College of Lore" });
    const [foe] = await t.fight([who]);
    t.kit.setEnemy(foe.id, foePatch);
    t.foesTurn(foe);
    const hit = await t.strike(foe, who, [16, 4]);
    assert.equal(hit.ok, true, hit.error);
    const out = await t.invoke("use_reaction", { characterId: who.id, feature: "Cutting Words" }, [4]);
    return { t, who, out };
  };
  const plain = await stage({});
  assert.equal(plain.out.ok, true, `the staging: Cutting Words answers the hit: ${plain.out.error}`);
  const deaf = await stage({ conditions: ["deafened"] });
  assert.equal(deaf.out.ok, false, "a creature that cannot hear the bard was cut by their words");
  assert.equal(deaf.t.used(deaf.who, "bardic_inspiration"), 0, "the refused words spent a die");
  const cold = await stage({ stats: { conditionImmune: "charmed, frightened" } });
  assert.equal(cold.out.ok, false, "a creature immune to being charmed was cut by the bard's words");
};

await runOrSurvey("scripts/test-enforce-sweep-clauses-srd-bard.mjs", P);
