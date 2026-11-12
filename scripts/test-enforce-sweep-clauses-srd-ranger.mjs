// The clause ledger's probes for the ranger (SRD 5.1) and the Hunter. The
// clause text and the verdict live in scripts/clauses/srd-classes.json; this
// file holds how each clause that names it is staged.
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const KIT = [
  { name: "Longbow", qty: 1, equipped: true },
  { name: "Longsword", qty: 1 },
  { name: "Shortsword", qty: 2 },
  { name: "Arrows", qty: 20 },
];
const BLADE = [{ name: "Shortsword", qty: 1, equipped: true }];
const pick = (name) => ({ name, source: "choice" });
function ranger(t, level, picks = [], extra = {}) {
  const who = t.hero({ class: "ranger", ...(level >= 3 ? { subclass: "Hunter" } : {}), level, equipment: KIT, ...extra, abilities: { dex: 16, wis: 14, ...(extra.abilities ?? {}) } });
  if (picks.length) t.patch(who, { features: [...t.sheet(who).features, ...picks.map(pick)] });
  return who;
}
const modifier = (roll) => (roll?.breakdown?.terms ?? []).filter((term) => term.kind === "modifier").reduce((sum, term) => sum + term.sign * term.value, 0);
const diceOf = (roll, sides) => (roll?.breakdown?.terms ?? []).filter((term) => term.kind === "dice" && term.sides === sides).reduce((sum, term) => sum + term.count, 0);
const P = {};

// ---- Fighting Style ----

P["ranger.fighting-style.archery"] = async () => {
  const t = await rig.table();
  const bonus = {};
  for (const style of [[], ["Fighting Style: Archery"]]) {
    for (const [weapon, x] of [["Longbow", 12], ["Longsword", 6]]) {
      const who = ranger(t, 2, style, { equipment: [{ name: weapon, qty: 1, equipped: true }, { name: "Arrows", qty: 20 }] });
      const [foe] = await t.fight([who]);
      t.kit.place(foe.id, x, 5);
      const out = await t.swing(who, foe, [15, 4], { weapon });
      assert.equal(out.ok, true, out.error);
      bonus[`${style.length ? "archer" : "plain"} ${weapon}`] = modifier(out.toHit);
    }
  }
  assert.equal(bonus["archer Longbow"], bonus["plain Longbow"] + 2, "Archery: +2 to attack rolls with ranged weapons");
  assert.equal(bonus["archer Longsword"], bonus["plain Longsword"], "Archery added to a melee weapon's attack roll");
};

P["ranger.fighting-style.defense"] = async () => {
  const t = await rig.table();
  const leather = [{ name: "Leather Armor", qty: 1, equipped: true }];
  const plain = ranger(t, 2, [], { equipment: leather });
  const guarded = ranger(t, 2, ["Fighting Style: Defense"], { equipment: leather });
  const bare = ranger(t, 2, ["Fighting Style: Defense"], { equipment: [] });
  assert.equal(t.ac(plain), 11 + 3, "the staging: leather armor and Dexterity 16");
  assert.equal(t.ac(guarded), t.ac(plain) + 1, "Defense: +1 to AC while wearing armor");
  assert.equal(t.ac(bare), 10 + 3, "Defense added to the AC of a ranger wearing no armor");
};

P["ranger.fighting-style.two-weapon"] = async () => {
  const t = await rig.table();
  const blades = [{ name: "Shortsword", qty: 2, equipped: true }];
  const plain = ranger(t, 2, [], { equipment: blades });
  const paired = ranger(t, 2, ["Fighting Style: Two-Weapon Fighting"], { equipment: blades });
  const added = {};
  for (const [label, who] of [["plain", plain], ["paired", paired]]) {
    const [foe] = await t.fight([who]);
    const main = await t.swing(who, foe, [15, 4], { weapon: "Shortsword" });
    assert.equal(main.ok, true, main.error);
    const off = await t.swing(who, foe, [15, 4], { weapon: "Shortsword", offHand: true });
    assert.equal(off.ok, true, off.error);
    assert.ok(off.damage, "the off-hand attack hit and rolled no damage");
    added[label] = modifier(off.damage);
  }
  assert.equal(added.plain, 0, "the off-hand attack adds no ability modifier without the style");
  assert.equal(added.paired, 3, "Two-Weapon Fighting: the ability modifier on the second attack's damage");
};

// ---- Hunter's Prey ----

P["ranger.hunters-prey.colossus-slayer"] = async () => {
  const t = await rig.table();
  const who = ranger(t, 5, ["Hunter's Prey: Colossus Slayer"], { equipment: BLADE });
  const [foe] = await t.fight([who]);
  const whole = await t.swing(who, foe, [15, 4, 4], { weapon: "Shortsword" });
  assert.equal(whole.ok, true, whole.error);
  assert.equal(diceOf(whole.damage, 8), 0, "a creature at its hit point maximum took the extra 1d8");
  t.freshTurn();
  const hurt = await t.swing(who, foe, [15, 4, 4], { weapon: "Shortsword" });
  assert.equal(hurt.ok, true, hurt.error);
  assert.equal(diceOf(hurt.damage, 8), 1, "a creature below its hit point maximum takes an extra 1d8");
};

P["ranger.hunters-prey.colossus-slayer-once"] = async () => {
  const t = await rig.table();
  const who = ranger(t, 5, ["Hunter's Prey: Colossus Slayer"], { equipment: BLADE });
  const [foe] = await t.fight([who]);
  t.kit.setEnemy(foe.id, { currentHp: 250 });
  const first = await t.swing(who, foe, [15, 4, 4], { weapon: "Shortsword" });
  assert.equal(diceOf(first.damage, 8), 1, first.error ?? "the first hit of the turn");
  const second = await t.swing(who, foe, [15, 4, 4], { weapon: "Shortsword" });
  assert.equal(second.ok, true, second.error);
  assert.equal(diceOf(second.damage, 8), 0, "the extra damage came twice in one turn");
  t.freshTurn();
  const next = await t.swing(who, foe, [15, 4, 4], { weapon: "Shortsword" });
  assert.equal(diceOf(next.damage, 8), 1, "the next turn's first hit");
};

// Giant Killer: the foe's own turn, its club at the ranger, then the answer.
async function giantKiller(t, { size = "Large", blind = false, faces = [16, 4], at = null } = {}) {
  const who = ranger(t, 5, ["Hunter's Prey: Giant Killer"], { equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
  const [foe] = await t.fight([who]);
  t.kit.setEnemy(foe.id, { stats: { ...t.enemy(foe).stats, size } });
  if (at) t.kit.place(foe.id, at[0], at[1]);
  t.foesTurn(foe);
  const hit = await t.strike(foe, who, faces);
  if (blind) t.patch(who, { conditions: ["blinded"], conditionMeta: {} });
  t.foesTurn(foe);
  const back = await t.swing(who, foe, [15, 4]);
  return { who, foe, hit, back };
}

P["ranger.hunters-prey.giant-killer"] = async () => {
  for (const faces of [[16, 4], [2]]) {
    const t = await rig.table();
    const { who, hit, back } = await giantKiller(t, { faces });
    assert.equal(hit.ok, true, hit.error);
    assert.equal(back.ok, true, `a Large creature within 5 feet ${faces.length > 1 ? "hit" : "missed"} the ranger and the reaction attack was refused: ${back.error}`);
    assert.ok(t.world.encounter().reactionsUsed.includes(who.id), "the attack took no reaction");
  }
  const medium = await rig.table();
  const small = await giantKiller(medium, { size: "Medium" });
  assert.equal(small.back.ok, false, "a Medium creature's attack was answered with Giant Killer");
  const dark = await rig.table();
  const unseen = await giantKiller(dark, { blind: true });
  assert.equal(unseen.back.ok, false, "a blinded ranger answered a creature they cannot see");
};

P["ranger.hunters-prey.horde-breaker"] = async () => {
  const t = await rig.table();
  const who = ranger(t, 3, ["Hunter's Prey: Horde Breaker"], { equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Shortsword", qty: 1 }] });
  const [a, b, far] = await t.fight([who], { foes: 3 });
  t.kit.place(b.id, 6, 6);
  t.kit.place(far.id, 5, 7);
  const early = await t.swing(who, b, [15, 4], { weapon: "Longsword", hordeBreaker: true });
  assert.equal(early.ok, false, "Horde Breaker's attack came before any weapon attack");
  assert.equal((await t.swing(who, a, [15, 4], { weapon: "Longsword" })).ok, true);
  const same = await t.swing(who, a, [15, 4], { weapon: "Longsword", hordeBreaker: true });
  assert.equal(same.ok, false, "the extra attack struck the same creature");
  t.kit.place(far.id, 4, 5);
  const away = await t.swing(who, far, [15, 4], { weapon: "Longsword", hordeBreaker: true });
  assert.equal(away.ok, false, "the extra attack struck a creature 10 feet from the original target");
  const other = await t.swing(who, b, [15, 4], { weapon: "Shortsword", hordeBreaker: true });
  assert.equal(other.ok, false, "the extra attack was made with a different weapon");
  const extra = await t.swing(who, b, [15, 4], { weapon: "Longsword", hordeBreaker: true });
  assert.equal(extra.ok, true, extra.error);
  assert.equal(t.budget().actionUsed, true, "the staging: a 3rd-level ranger's one attack is spent");
  const twice = await t.swing(who, b, [15, 4], { weapon: "Longsword", hordeBreaker: true });
  assert.equal(twice.ok, false, "Horde Breaker's attack came twice in a turn");
};

// ---- Defensive Tactics ----

P["ranger.defensive-tactics.multiattack-defense"] = async () => {
  // The dummy swings its club twice (+4): 16 on the die hits, then 12 on the
  // die is a 16, which hits AC 16 and misses AC 20.
  const swings = {};
  for (const picks of [[], ["Defensive Tactics: Multiattack Defense"]]) {
    const t = await rig.table();
    const who = ranger(t, 7, picks, { equipment: [] });
    t.patch(who, { ac: 16, acOverride: true });
    const [foe] = await t.fight([who], { foe: { attacksPerTurn: 2 } });
    t.foesTurn(foe);
    const out = await t.invoke("enemy_attack", { enemyId: foe.id, targetCharacterId: who.id }, [16, 4, 12, 4]);
    assert.equal(out.ok, true, out.error);
    assert.equal(out.result.swings.length, 2, JSON.stringify(out.result).slice(0, 300));
    swings[picks.length ? "defended" : "plain"] = out.result.swings.map((swing) => swing.hit);
    if (picks.length) {
      // The next turn's first attack meets the plain AC again.
      t.foesTurn(foe);
      t.kit.freshRound();
      const next = await t.invoke("enemy_attack", { enemyId: foe.id, targetCharacterId: who.id }, [12, 4, 2]);
      assert.equal(next.ok, true, next.error);
      assert.equal(next.result.swings[0].hit, true, "the +4 outlived the turn");
    }
  }
  assert.deepEqual(swings.plain, [true, true], "the staging: both swings hit AC 16");
  assert.deepEqual(swings.defended, [true, false], "+4 AC against that creature's later attacks this turn");
};

// ---- Multiattack ----

P["ranger.multiattack.volley"] = async () => {
  const t = await rig.table();
  const who = ranger(t, 11, ["Multiattack: Volley"]);
  const list = await t.fight([who], { foes: 4 });
  t.kit.place(list[0].id, 5, 10);
  t.kit.place(list[1].id, 6, 11);
  t.kit.place(list[2].id, 4, 12);
  t.kit.place(list[3].id, 12, 12);
  const rolls = new Set();
  for (const enemy of list.slice(0, 3)) {
    const out = await t.swing(who, enemy, [15, 4], { weapon: "Longbow", volley: true });
    assert.equal(out.ok, true, `${enemy.displayName}: ${out.error}`);
    rolls.add(out.toHit.id);
  }
  assert.equal(rolls.size, 3, "a separate attack roll for each target");
  assert.equal(t.budget().actionUsed, true, "the action");
  const far = await t.swing(who, list[3], [15, 4], { weapon: "Longbow", volley: true });
  assert.equal(far.ok, false, "a creature more than 10 feet from the point was in the volley");
  const sword = await rig.table();
  const melee = ranger(sword, 11, ["Multiattack: Volley"]);
  const [foe] = await sword.fight([melee]);
  const out = await sword.swing(melee, foe, [15, 4], { weapon: "Longsword", volley: true });
  assert.equal(out.ok, false, "Volley was made with a melee weapon");
};

P["ranger.multiattack.volley-ammunition"] = async () => {
  // Ammunition is counted where the table asked for it (the variant rule).
  const t = await rig.table({ gameSettings: { variantRules: { ammunition: true } } });
  const who = ranger(t, 11, ["Multiattack: Volley"], { equipment: [{ name: "Longbow", qty: 1, equipped: true }, { name: "Arrows", qty: 2 }] });
  const list = await t.fight([who], { foes: 3 });
  t.kit.place(list[0].id, 5, 10);
  t.kit.place(list[1].id, 6, 11);
  t.kit.place(list[2].id, 4, 12);
  for (const enemy of list.slice(0, 2)) {
    const out = await t.swing(who, enemy, [15, 4], { weapon: "Longbow", volley: true });
    assert.equal(out.ok, true, `${enemy.displayName}: ${out.error}`);
  }
  const arrows = t.sheet(who).equipment.find((item) => /arrow/i.test(item.name));
  assert.equal(arrows?.qty ?? 0, 0, "each target's attack spends an arrow");
  const dry = await t.swing(who, list[2], [15, 4], { weapon: "Longbow", volley: true });
  assert.equal(dry.ok, false, "a third target was shot at with no ammunition left");
};

P["ranger.multiattack.whirlwind"] = async () => {
  const t = await rig.table();
  const who = ranger(t, 11, ["Multiattack: Whirlwind Attack"], { equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
  const list = await t.fight([who], { foes: 4 });
  t.kit.place(list[1].id, 4, 6);
  t.kit.place(list[2].id, 6, 6);
  t.kit.place(list[3].id, 8, 5);
  const rolls = new Set();
  for (const enemy of list.slice(0, 3)) {
    const out = await t.swing(who, enemy, [15, 4], { weapon: "Longsword", whirlwind: true });
    assert.equal(out.ok, true, `${enemy.displayName}: ${out.error}`);
    rolls.add(out.toHit.id);
  }
  assert.equal(rolls.size, 3, "a separate attack roll for each target");
  assert.equal(t.budget().actionUsed, true, "the action");
  const again = await t.swing(who, list[0], [15, 4], { weapon: "Longsword", whirlwind: true });
  assert.equal(again.ok, false, "one creature was attacked twice");
  const far = await t.swing(who, list[3], [15, 4], { weapon: "Longsword", whirlwind: true });
  assert.equal(far.ok, false, "a creature 15 feet away was in the whirlwind");
};

// ---- Superior Hunter's Defense ----

P["ranger.superior-hunters-defense.stand-against-the-tide"] = async () => {
  const stage = async () => {
    const t = await rig.table();
    const who = ranger(t, 15, ["Superior Hunter's Defense: Stand Against the Tide"]);
    const [attacker, other] = await t.fight([who], { foes: 2 });
    t.kit.place(other.id, 4, 5);
    t.kit.setEnemy(other.id, { ac: 5 });
    t.patch(who, { ac: 30, acOverride: true });
    return { t, who, attacker, other };
  };
  const react = (t, who, target) => t.invoke("use_reaction", { characterId: who.id, feature: "Stand Against the Tide", targetEnemyId: target.id }, [18, 5]);
  {
    const { t, who, attacker, other } = await stage();
    t.foesTurn(attacker);
    const miss = await t.strike(attacker, who, [2]);
    assert.equal(miss.ok, true, miss.error);
    t.foesTurn(attacker);
    const self = await react(t, who, attacker);
    assert.equal(self.ok, false, "the attack was repeated against the creature that made it");
    const hp = t.enemy(other).currentHp;
    const out = await react(t, who, other);
    assert.equal(out.ok, true, out.error);
    assert.ok(t.enemy(other).currentHp < hp, "the repeated attack did not land on the other creature");
    assert.ok(t.world.encounter().reactionsUsed.includes(who.id), "the reaction");
  }
  {
    const { t, who, attacker, other } = await stage();
    t.patch(who, { ac: 5, acOverride: true });
    t.foesTurn(attacker);
    const hit = await t.strike(attacker, who, [16, 4]);
    assert.equal(hit.ok, true, hit.error);
    t.foesTurn(attacker);
    const out = await react(t, who, other);
    assert.equal(out.ok, false, "an attack that hit was turned on another creature");
  }
};

// ---- Hide in Plain Sight ----

P["ranger.hide-in-plain-sight.lost"] = async () => {
  const camouflage = async (t, who) => {
    const out = await t.use(who, "Hide in Plain Sight");
    assert.equal(out.ok, true, out.error);
    assert.ok(t.has(who, "camouflaged"), "the staging: the ranger is camouflaged");
  };
  // An action.
  const t = await rig.table();
  const who = ranger(t, 10);
  await camouflage(t, who);
  const searched = await t.act(who, "search", {}, [10]);
  assert.equal(searched.ok, true, searched.error);
  assert.equal(t.has(who, "camouflaged"), false, "the ranger took an action and is still camouflaged");
  // An attack, when the fight finds them: the camouflage was set before it.
  const t2 = await rig.table();
  const archer = ranger(t2, 10);
  await camouflage(t2, archer);
  const [foe] = await t2.fight([archer]);
  t2.kit.place(foe.id, 12, 5);
  const shot = await t2.swing(archer, foe, [15, 4], { weapon: "Longbow" });
  assert.equal(shot.ok, true, shot.error);
  assert.equal(t2.has(archer, "camouflaged"), false, "the ranger attacked and is still camouflaged");
  // A move.
  const t3 = await rig.table();
  const walker = ranger(t3, 10);
  await camouflage(t3, walker);
  await t3.fight([walker]);
  // The player's own walk: the board's move route.
  const route = await t3.world.route("campaigns/[campaignId]/battle-map/move");
  t3.world.signIn(t3.world.owner);
  const moved = await route.POST(
    new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x: 4, y: 5 }) }),
    { params: Promise.resolve({ campaignId: t3.world.campaignId }) },
  );
  assert.equal(moved.status, 200, "the staging: the ranger walks a square");
  assert.equal(t3.has(walker, "camouflaged"), false, "the ranger moved and is still camouflaged");
};

// ---- Natural Explorer on the road, Primeval Awareness, Land's Stride ----

const explorer = (t, level, land = "forest") => {
  const who = t.hero({ class: "ranger", level, abilities: { dex: 16, wis: 14 }, spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, prepared: [], known: [], cantrips: [] } });
  t.patch(who, { features: [...t.sheet(who).features, { name: `Natural Explorer: ${land}`, source: "choice" }] });
  return who;
};

P["ranger.natural-explorer.travel"] = async () => {
  const t = await rig.table();
  const who = explorer(t, 1);
  const friend = t.hero({ class: "fighter", level: 1 });
  const all = [who.id, friend.id];
  const swamp = await t.invoke("travel", { hours: 4, terrain: "difficult", land: "swamp", characterIds: all });
  assert.equal(swamp.ok, true, swamp.error);
  const forest = await t.invoke("travel", { hours: 4, terrain: "difficult", land: "forest", characterIds: all });
  assert.equal(forest.ok, true, forest.error);
  assert.equal(forest.result.miles, swamp.result.miles * 2, `difficult ground in the favored terrain: ${forest.result.miles} miles against ${swamp.result.miles} outside it`);
  // The group is not alone: a normal pace leaves no room for stealth.
  const group = await t.invoke("request_roll", { characterId: who.id, kind: "skill_check", skill: "stealth", dc: 10, terrain: "forest" }, [12]);
  assert.match(String(group.error), /pace/, "a ranger in a group moved stealthily at a normal pace");
  // Alone, in the favored terrain, they do; out of it they do not.
  const alone = await t.invoke("travel", { hours: 1, land: "forest", characterIds: [who.id] });
  assert.equal(alone.ok, true, alone.error);
  const other = await t.invoke("request_roll", { characterId: who.id, kind: "skill_check", skill: "stealth", dc: 10, terrain: "swamp" }, [12]);
  assert.match(String(other.error), /pace/, "stealth at a normal pace outside the favored terrain");
  const quiet = await t.invoke("request_roll", { characterId: who.id, kind: "skill_check", skill: "stealth", dc: 10, terrain: "forest" }, [12]);
  assert.ok(!quiet.error, `a ranger alone in the forest moves stealthily at a normal pace: ${quiet.error}`);
};

P["ranger.primeval-awareness.minutes"] = async () => {
  const t = await rig.table();
  const who = explorer(t, 5);
  const out = await t.use(who, "primeval awareness", { amount: 2 });
  assert.equal(out.ok, true, out.error);
  const sheet = t.sheet(who);
  assert.equal(sheet.spellcasting.slots["2"].used, 1, "the slot named was spent");
  // A minute a level of the slot, on the clock.
  assert.equal(sheet.conditionMeta["primeval awareness"]?.rounds, 20, "two minutes for a 2nd-level slot");
  for (const kind of ["aberrations", "celestials", "dragons", "elementals", "fey", "fiends", "undead"]) {
    assert.ok(out.result.applied.includes(kind), `the answer leaves out ${kind}`);
  }
  assert.match(out.result.applied, /For 2 minutes/);
  assert.match(out.result.applied, /within 1 mile \(6 in their favored terrain\)/);
  assert.match(out.result.applied, /not their number or place/);
};

P["ranger.lands-stride.entangle"] = async () => {
  const d20s = async (classId, source) => {
    const t = await rig.table();
    const who = t.hero({ class: classId, level: 8, abilities: { str: 10 } });
    const out = await t.invoke("cast_at_player", { characterId: who.id, saveAbility: "str", dc: 15, condition: "restrained", source }, [4, 5]);
    assert.ok(!out.error, out.error);
    return out.rolled.filter((die) => die.sides === 20).length;
  };
  assert.equal(await d20s("ranger", "Entangle"), 2, "a ranger's save against Entangle");
  assert.equal(await d20s("ranger", "Web"), 1, "Web is no plant");
  assert.equal(await d20s("fighter", "Entangle"), 1, "the staging: a fighter's save against Entangle");
};

await runOrSurvey("scripts/test-enforce-sweep-clauses-srd-ranger.mjs", P);
