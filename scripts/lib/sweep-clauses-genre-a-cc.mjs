// The probes of the cyberpunk and dark fantasy clause ledgers the 2026-11-13
// creator audit's second genre pass adds (scripts/clauses/genre-cyberpunk.json,
// genre-dark-fantasy.json): one per mechanism it wired, same contract as the
// probes of sweep-clauses-genre-a-probes.mjs (an assertion is the rule not
// held, any other throw is the probe's setup breaking). Kinds are prefixed
// cc_ so they never shadow a probe of the older files.
import assert from "node:assert/strict";
import { must, eq } from "./sweep-clauses-genre-a.mjs";
import { CYBER } from "./sweep-clauses-genre-a-cyberpunk.mjs";
import { TRAINED } from "./enforce-combat.mjs";

const SRC = new URL("../../src/", import.meta.url);
const load = (file) => import(new URL(file, SRC).href);
const key = (name) => name.toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").trim();
const stripFeature = (t, id, name) => t.world.patch(id, { features: t.world.sheet(id).features.filter((entry) => key(entry.name) !== key(name)) });
const conditionsOf = (t, id) => t.world.sheet(id).conditions.map((entry) => entry.toLowerCase());
const foeConditions = (t, id) => t.kit.enemy(id).conditions.map((entry) => entry.toLowerCase());

export const CC = {
  // "opportunity attacks against you have disadvantage": the holder walks
  // out of the near foe's reach; the foe's opportunity attack is rolled at
  // disadvantage, and at none once the feature is gone.
  async cc_oa(t, run, feature) {
    const { resolveOpportunityAttacks } = await load("lib/dm/opportunity.ts");
    const { listRecentRolls } = await load("lib/db/rolls.ts");
    const scene = await t.stage(feature);
    const leave = () => {
      const encounter = t.world.encounter();
      t.encounters.saveEncounter({ ...encounter, reactionsUsed: [] });
      t.kit.place(scene.holder.id, 5, 5);
      t.world.clearDice();
      t.world.dice(18, 3, 18, 3, 6);
      resolveOpportunityAttacks(t.world.campaign(), scene.holder.id, { x: 5, y: 5 }, { x: 5, y: 3 }, false, [{ x: 5, y: 4 }, { x: 5, y: 3 }]);
      t.world.clearDice();
      const roll = listRecentRolls(t.world.campaignId, 6).filter((entry) => entry.kind === "attack").at(-1);
      if (!roll || roll.kind !== "attack") throw new Error(`no opportunity attack was rolled: ${JSON.stringify(roll).slice(0, 200)}`);
      return roll.advantage ?? "normal";
    };
    eq(leave(), "disadvantage", "the opportunity attack against the holder");
    stripFeature(t, scene.holder.id, feature.name);
    assert.notEqual(leave(), "disadvantage", "the opportunity attack against a holder without the feature was at disadvantage");
  },

  // A caster's own focus: "kit" (the plague doctor's kit and mask) is refused
  // with a holy symbol alone and cast with a herbalism kit; the other wants
  // are the cyberpunk probe's.
  async cc_focus(t, run, feature) {
    if (run.want === "none") {
      // Cast with nothing carried, and refused once the feature is gone.
      t.fresh();
      const casting = { ability: run.ability ?? "int", slots: { 1: { max: 4, used: 0 } }, known: ["Mage Armor"], prepared: ["Mage Armor"], cantrips: [] };
      const hero = t.hero(feature.classId, feature.level, { equipment: [], spellcasting: casting });
      // Nothing carried: the class's starting kit (a dirgesinger's lute) taken off.
      t.world.patch(hero.id, { equipment: [] });
      const cast = async () => t.world.invoke("cast_buff", { characterId: hero.id, spell: "Mage Armor" });
      const first = await cast();
      eq(first.ok, true, `Mage Armor cast with no pouch and no focus (${first.error ?? "cast"})`);
      t.world.patch(hero.id, { spellcasting: casting, concentratingOn: null });
      stripFeature(t, hero.id, feature.name);
      const second = await cast();
      eq(/focus|pouch/i.test(String(second.error ?? "")), true, `Mage Armor without the feature and with nothing carried (${second.error ?? "cast"})`);
      return;
    }
    if (run.want !== "kit") return CYBER.focus(t, run, feature);
    t.fresh();
    const casting = { ability: run.ability ?? "int", slots: { 1: { max: 4, used: 0 } }, known: ["Mage Armor"], prepared: ["Mage Armor"], cantrips: [] };
    const hero = t.hero(feature.classId, feature.level, { equipment: [], spellcasting: casting });
    const carry = (...names) => t.world.patch(hero.id, { equipment: names.map((name) => ({ name, qty: 1, equipped: false })) });
    const cast = async () => (await t.world.invoke("cast_buff", { characterId: hero.id, spell: "Mage Armor" })).ok;
    carry("Amulet");
    eq(await cast(), false, "Mage Armor cast with a holy symbol and no kit");
    carry("Herbalism Kit");
    eq(await cast(), true, "Mage Armor cast with the herbalism kit carried");
  },

  cc_check_about: (t, run, feature) => CYBER.check_about(t, run, feature),

  // "Allies within 20 ft deal +1d4 radiant with weapon attacks against your
  // branded quarry": the hunter brands the near foe; the ally beside them
  // swings at it and deals radiant beside its own damage, and none once the
  // hunter stands 70 feet off.
  async cc_silver_tide(t, run, feature) {
    const scene = await t.stage(feature);
    must(await t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "Hunter's Brand", targetEnemyId: scene.near.id }), "Hunter's Brand");
    const d4s = async () => {
      t.kit.freshTurn();
      t.kit.giveTurn(scene.ally.id);
      t.kit.place(scene.ally.id, 4, 6);
      t.world.clearDice();
      t.world.diceLog();
      const out = await t.kit.swing(scene.ally.id, scene.near.id, [15, 3, 3, 3, 3, 3, 3]);
      t.world.clearDice();
      must(out, "the ally's swing");
      if (out.result.hit === false) throw new Error("the ally's swing missed");
      return (out.result.damageByType ?? []).filter((part) => /radiant/.test(part)).length;
    };
    eq(await d4s(), 1, "radiant parts of the ally's hit on the branded foe, the hunter beside them");
    t.kit.place(scene.holder.id, 18, 18);
    eq(await d4s(), 0, "radiant parts of the ally's hit on the branded foe, the hunter 70 feet off");
  },

  // "critical hits also frighten (WIS save negates)": a critical hit on the
  // near foe, its save a 1, leaves it frightened of the knight; a plain hit
  // does not.
  async cc_crit_fright(t, run, feature) {
    const scene = await t.stage(feature);
    const swing = async (face) => {
      t.kit.freshTurn();
      t.kit.giveTurn(scene.holder.id);
      const out = must(await t.kit.swing(scene.holder.id, scene.near.id, [face, 3, 3, 3, 3, 3, 3, 3, 3, 1, 1]), "the swing");
      return out;
    };
    await swing(15);
    eq(foeConditions(t, scene.near.id).includes("frightened"), false, "frightened after a plain hit");
    await swing(20);
    eq(foeConditions(t, scene.near.id).includes("frightened"), true, "frightened after a critical hit and a failed WIS save");
  },

  // "Your critical hits against branded creatures prevent regeneration and
  // revival for 24 hours": a critical hit on the branded near foe stops its
  // Regeneration for a day; one on the unbranded far foe does not.
  async cc_sanctioned(t, run, feature) {
    const scene = await t.stage(feature);
    must(await t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "Hunter's Brand", targetEnemyId: scene.near.id }), "Hunter's Brand");
    const crit = async (foe) => {
      t.kit.freshTurn();
      t.kit.giveTurn(scene.holder.id);
      t.kit.place(foe.id, 5, 6);
      must(await t.kit.swing(scene.holder.id, foe.id, [20, 3, 3, 3, 3, 3, 3, 3, 3]), "the critical hit");
      const enemy = t.kit.enemy(foe.id);
      const meta = enemy.conditionMeta?.["regeneration stopped"] ?? null;
      return { stopped: enemy.conditions.includes("regeneration stopped"), day: (meta?.rounds ?? 0) >= 14400, marked: foeConditions(t, foe.id).includes("sanctioned execution") };
    };
    const branded = await crit(scene.near);
    eq(`${branded.stopped}/${branded.day}/${branded.marked}`, "true/true/true", "Regeneration stopped / for a day / the mark, after a critical hit on the branded foe");
    t.kit.place(scene.near.id, 9, 9);
    const plain = await crit(scene.far);
    eq(`${plain.stopped}/${plain.marked}`, "false/false", "Regeneration stopped / the mark, after a critical hit on an unbranded foe");
  },
};

// ---- the dark fantasy areas and swarms ----

const zonesOn = async (t) => {
  const { getBattleMapForEncounter } = await load("lib/db/battle-maps.ts");
  const map = getBattleMapForEncounter(t.world.encounter().id);
  return { map, zones: map?.spellZones ?? [] };
};
const zoneNamed = async (t, name) => {
  const { map, zones } = await zonesOn(t);
  const zone = zones.find((entry) => entry.spell.toLowerCase() === name.toLowerCase());
  if (!zone) throw new Error(`no ${name} on the board: ${zones.map((entry) => entry.spell).join(", ") || "none"}`);
  return { map, zone, zones };
};
const spend = async (t, scene, resource, args = {}, faces = []) => {
  t.world.clearDice();
  t.world.dice(...faces);
  const out = await t.world.invoke("use_resource", { characterId: scene.holder.id, resource, ...args });
  t.world.clearDice();
  return must(out, resource);
};
const startTurn = async (t, id, faces = []) => {
  const { startTurnConditions } = await load("lib/dm/condition-tick.ts");
  t.world.clearDice();
  t.world.dice(...faces);
  startTurnConditions(t.world.campaign(), t.world.encounter(), [id]);
  t.world.clearDice();
};
const cellAt = (map, x, y) => y * map.width + x;

Object.assign(CC, {
  // An area a spend lays: on the board for `rounds`, reaching `edgeFt` from
  // its centre and no farther (a sphere), or `cells` squares (a cube).
  async cc_zone(t, run, feature) {
    const scene = await t.stage(feature, { level: run.level });
    if (run.place) t.kit.place(scene.far.id, ...run.place);
    await spend(t, scene, run.res, run.at ? { targetEnemyId: scene.far.id } : {}, run.faces ?? [20, 20, 20]);
    const { map, zone } = await zoneNamed(t, run.spell);
    // The round it is laid in is the first of them.
    eq(zone.untilRound - zone.castRound + 1, run.rounds, `rounds ${run.spell} lasts`);
    if (run.cells) {
      eq(zone.cells.length, run.cells, `squares of ${run.spell}`);
      return;
    }
    const { x, y } = zone.origin;
    const squares = run.edgeFt / 5;
    eq(`${zone.cells.includes(cellAt(map, x + squares, y))}/${zone.cells.includes(cellAt(map, x + squares + 1, y))}`, "true/false", `${run.spell} reaches ${run.edgeFt} feet from its centre / and 5 more`);
  },

  // "enemies treat it as difficult terrain" / "enemies are slowed": a step
  // onto its squares costs an enemy double and an ally nothing more.
  async cc_zone_slow(t, run, feature) {
    const { zoneStepCost } = await load("lib/battlemap/zones.ts");
    const scene = await t.stage(feature);
    await spend(t, scene, run.res);
    const { map, zone, zones } = await zoneNamed(t, run.spell);
    const inside = cellAt(map, zone.origin.x + 2, zone.origin.y);
    const cost = (kind) => zoneStepCost(zones, map.width, kind)?.(-1, inside, 1) ?? 1;
    eq(`${cost("enemy")}/${cost("pc")}`, "2/1", `feet a foot inside ${run.spell} for an enemy / for an ally`);
  },

  // "take 2d6 poison entering (CON save halves)": an enemy walking in takes
  // the 2d6 (two 3s) on a failed CON save, and half on a made one.
  async cc_zone_enter(t, run, feature) {
    const scene = await t.stage(feature);
    await spend(t, scene, run.res);
    const walkIn = async (face) => {
      // A new round: the ring strikes a creature once a turn.
      const encounter = t.world.encounter();
      t.encounters.saveEncounter({ ...encounter, round: encounter.round + 1 });
      t.kit.setEnemy(scene.near.id, { currentHp: 300 });
      t.kit.place(scene.near.id, 5, 11);
      t.foesTurn(scene);
      t.kit.freshRound();
      t.world.clearDice();
      t.world.dice(face, 3, 3, 3, 3);
      must(await t.world.invoke("move_token", { token: scene.near.id, x: 5, y: 9 }), "the foe's walk into the ring");
      t.world.clearDice();
      return 300 - t.foeHp(scene.near.id);
    };
    eq(`${await walkIn(1)}/${await walkIn(20)}`, "6/3", "poison an enemy took walking in, failing then making its CON save");
  },

  // "allies in it regain 1d6 HP per turn": the hurt ally beside the knight
  // regains the d6 (a 4) as their turn starts; the knight does not.
  async cc_garden_heal(t, run, feature) {
    const scene = await t.stage(feature, { hp: 50 });
    await spend(t, scene, "Garden of Grief");
    await startTurn(t, scene.ally.id, [4]);
    await startTurn(t, scene.holder.id, [4]);
    eq(`${t.hp(scene.ally.id)}/${t.hp(scene.holder.id)}`, "24/50", "the ally's hit points (20, and a 4) / the knight's own (50)");
  },

  // Rat Tide thrown on the foe 30 feet off: a failed DEX save (a 1) takes
  // 2d6 piercing (two 3s) and leaves it distracted by the rats, its next
  // attack at disadvantage.
  async cc_rat_tide(t, run, feature) {
    const scene = await t.stage(feature);
    t.kit.place(scene.far.id, 11, 5);
    await spend(t, scene, "Rat Tide", { targetEnemyId: scene.far.id }, [1, 3, 3]);
    const { conditionEffectsFor } = await load("lib/srd/condition-effects.ts");
    const held = foeConditions(t, scene.far.id).find((entry) => entry.startsWith("distracted"));
    eq(`${300 - t.foeHp(scene.far.id)}/${Boolean(held)}`, "6/true", "piercing taken on a failed DEX save / distracted");
    const row = conditionEffectsFor(held);
    eq(`${row?.attackDisadvantage}/${row?.consumedBy}`, "true/attack", "the distraction's disadvantage, spent by its next attack");
  },

  // The Crown Descends: the foe within 30 feet is swarmed (half speed, no
  // reactions) and bitten for 1d6 piercing (a 4) as its turn starts; the foe
  // 70 feet off is not.
  async cc_crown(t, run, feature) {
    const { conditionBlocksReactions, conditionEffectsFor } = await load("lib/srd/condition-effects.ts");
    const scene = await t.stage(feature);
    await spend(t, scene, "The Crown Descends");
    const near = foeConditions(t, scene.near.id).find((entry) => entry === "swarmed");
    eq(`${Boolean(near)}/${foeConditions(t, scene.far.id).includes("swarmed")}`, "true/false", "swarmed: the foe within 30 feet / the foe 70 feet off");
    eq(`${conditionEffectsFor(near)?.speedMultiplier}/${conditionBlocksReactions(t.kit.enemy(scene.near.id).conditions)}`, "0.5/swarmed", "the swarmed foe's speed / what takes its reactions");
    await startTurn(t, scene.near.id, [4]);
    eq(300 - t.foeHp(scene.near.id), 4, "piercing the swarm deals as the foe's turn starts");
  },

  // The Walls Have Teeth: the foe in the swarm cannot react; the one 10 feet
  // from it, once a turn starts, cannot either; one 25 feet off can.
  async cc_teeth(t, run, feature) {
    const scene = await t.stage(feature);
    t.kit.place(scene.far.id, 11, 5);
    await spend(t, scene, "Rat Tide", { targetEnemyId: scene.far.id }, [20, 20, 20]);
    const { zone, map } = await zoneNamed(t, "Rat Tide");
    const xs = zone.cells.map((cell) => cell % map.width);
    const holds = (id) => foeConditions(t, id).includes("the walls have teeth");
    eq(`${holds(scene.far.id)}/${holds(scene.near.id)}`, "true/false", "no reactions: the foe in the swarm / the foe 25 feet off");
    t.kit.place(scene.near.id, Math.min(...xs) - 2, zone.origin.y);
    await startTurn(t, scene.holder.id);
    eq(holds(scene.near.id), true, "no reactions for the foe 10 feet from the swarm");
  },

  // Greater Gutter Fighting: in round 2, a hit on the foe in the swarm
  // carries Gutter Fighting's 2d6 (two 3s); a hit on a foe away from it none.
  async cc_gutter_swarm(t, run, feature) {
    const scene = await t.stage(feature);
    t.kit.place(scene.far.id, 11, 5);
    await spend(t, scene, "Rat Tide", { targetEnemyId: scene.far.id }, [20, 20, 20]);
    const hit = async (foe, x, y) => {
      const encounter = t.world.encounter();
      t.encounters.saveEncounter({ ...encounter, round: 2 });
      t.kit.freshTurn();
      t.kit.giveTurn(scene.holder.id);
      t.kit.place(scene.holder.id, x, y);
      const before = t.foeHp(foe.id);
      must(await t.kit.swing(scene.holder.id, foe.id, [15, 3, 3, 3, 3, 3]), "the swing");
      return before - t.foeHp(foe.id);
    };
    const swarmed = await hit(scene.far, 10, 6);
    t.kit.place(scene.near.id, 2, 12);
    const plain = await hit(scene.near, 2, 11);
    eq(swarmed - plain, 6, `damage Gutter Fighting added beside the swarm (${swarmed} there, ${plain} away from it)`);
  },
});

Object.assign(CC, {
  // Vanish Below: after a club hits the vermin lord, the reaction turns it to
  // a miss (the hit points back) and moves them 15 feet to the square named.
  async cc_vanish(t, run, feature) {
    const scene = await t.stage(feature);
    await t.clubs(scene, scene.holder, 16, 4);
    if (t.hp(scene.holder.id) >= 100) throw new Error("the staged club did not hit");
    must(await t.world.invoke("use_reaction", { characterId: scene.holder.id, feature: "Vanish Below", x: 5, y: 2 }), "Vanish Below");
    const token = t.kit.token(scene.holder.id);
    eq(`${t.hp(scene.holder.id)}/${token.x},${token.y}`, "100/5,2", "the vermin lord's hit points / square after Vanish Below");
  },

  // Candle in the Dark: the light (20 feet, ten minutes of rounds) and the
  // ward: an undead's club at the ally beside the hunter is rolled at
  // disadvantage, a goblin's is not.
  async cc_candle(t, run, feature) {
    const { listRecentRolls } = await load("lib/db/rolls.ts");
    const scene = await t.stage(feature);
    await spend(t, scene, "Candle in the Dark");
    if (run.part === "light") {
      const meta = t.world.sheet(scene.holder.id).conditionMeta?.["candle in the dark"];
      eq(`${conditionsOf(t, scene.holder.id).includes("candle in the dark")}/${meta?.rounds}/${t.kit.token(scene.holder.id).lightRadius}`, "true/100/4", "the candle / its rounds / the token's bright light in squares");
      return;
    }
    const swing = async (type) => {
      t.kit.setEnemy(scene.near.id, { stats: { ...t.kit.enemy(scene.near.id).stats, type } });
      await t.clubs(scene, scene.ally, 16, 4);
      return listRecentRolls(t.world.campaignId, 6).filter((entry) => entry.kind === "attack").at(-1)?.advantage ?? "none";
    };
    eq(`${await swing("undead")}/${await swing("humanoid")}`, "disadvantage/none", "a club at the ally by an undead / by a goblin, in the candle's light");
  },

  // No Rest for the Wicked: refused while the branded foe lives; once it is
  // killed, the turn comes back whole.
  async cc_no_rest(t, run, feature) {
    const scene = await t.stage(feature);
    must(await t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "Hunter's Brand", targetEnemyId: scene.near.id }), "Hunter's Brand");
    const again = () => t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "No Rest for the Wicked" });
    eq((await again()).ok, false, "No Rest for the Wicked with the branded foe alive");
    t.kit.setEnemy(scene.near.id, { currentHp: 1 });
    must(await t.kit.swing(scene.holder.id, scene.near.id, [15, 4, 4, 4, 4]), "the killing blow");
    eq(t.kit.enemy(scene.near.id).status !== "alive", true, "the branded foe is dead");
    must(await again(), "No Rest for the Wicked after the kill");
    eq(`${Boolean(t.budget().actionUsed)}/${Boolean(t.budget().bonusUsed)}`, "false/false", "the action / bonus action after the extra turn begins");
  },

  // The Rite Completed: refused for a living ally; the dead one is sung back at 1.
  async cc_rite(t, run, feature) {
    const scene = await t.stage(feature);
    const sing = (id) => t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "The Rite Completed", targetCharacterId: id });
    eq((await sing(scene.ally.id)).ok, false, "The Rite Completed on a living ally");
    t.world.patch(scene.fallen.id, { deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
    must(await sing(scene.fallen.id), "The Rite Completed on the dead ally");
    const fallen = t.world.sheet(scene.fallen.id);
    eq(`${fallen.currentHp}/${fallen.deathSaves.dead}`, "1/false", "the ally's hit points / dead, after the rite");
  },

  // Elegy of Echoes: refused before any dirge this turn; after one, the next
  // cast of 3rd level or lower this turn is slotless.
  async cc_elegy(t, run, feature) {
    const scene = await t.stage(feature, { extra: { spellcasting: { ability: "cha", slots: { 1: { max: 4, used: 0 } }, known: ["Healing Word"], prepared: ["Healing Word"], cantrips: ["Vicious Mockery"] } } });
    const echo = () => t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "Elegy of Echoes" });
    eq((await echo()).ok, false, "Elegy of Echoes with no dirge cast this turn");
    t.world.clearDice();
    t.world.dice(1, 3, 3);
    must(await t.world.invoke("cast_at_enemy", { characterId: scene.holder.id, targetEnemyId: scene.near.id, spell: "Vicious Mockery" }), "Vicious Mockery");
    t.world.clearDice();
    must(await echo(), "Elegy of Echoes after a dirge");
    const meta = t.world.sheet(scene.holder.id).conditionMeta?.["slotless cast (3rd)"];
    eq(`${conditionsOf(t, scene.holder.id).includes("slotless cast (3rd)")}/${meta?.untilTurnEndOf === scene.holder.id}`, "true/true", "the slotless cast / until the turn ends");
  },

  // Grief Made Strength: the ally beside the dirgesinger drops to 0, and the
  // next dirge of 2nd level or lower this minute is slotless.
  async cc_grief(t, run, feature) {
    const scene = await t.stage(feature);
    must(await t.world.invoke("apply_damage", { characterId: scene.ally.id, amount: 40, type: "slashing" }), "the ally's fall");
    const meta = t.world.sheet(scene.holder.id).conditionMeta?.["slotless cast (2nd)"];
    eq(`${conditionsOf(t, scene.holder.id).includes("slotless cast (2nd)")}/${meta?.rounds}`, "true/10", "the slotless cast (2nd) / its rounds");
  },

  // Controlled Dosage: the plague doctor's Healing Word on a poisoned ally
  // ends the poison.
  async cc_dosage(t, run, feature) {
    const scene = await t.stage(feature, { extra: { spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, known: ["Healing Word"], prepared: ["Healing Word"], cantrips: [] } } });
    t.world.patch(scene.ally.id, { conditions: ["poisoned"] });
    t.world.clearDice();
    t.world.dice(3, 3);
    must(await t.world.invoke("heal", { characterId: scene.ally.id, casterId: scene.holder.id, spell: "Healing Word" }), "Healing Word");
    t.world.clearDice();
    eq(conditionsOf(t, scene.ally.id).includes("poisoned"), false, "poisoned after the doctor's Healing Word");
  },

  // Daemon Cache: the spend marks one slotless cast, 3rd level or lower; with
  // two programs, 5th, and two of them a long rest.
  async cc_daemon(t, run, feature) {
    const scene = await t.stage(feature, { level: run.level });
    await spend(t, scene, "Daemon Cache");
    const mark = run.level >= 11 ? "slotless cast (5th)" : "slotless cast (3rd)";
    eq(`${conditionsOf(t, scene.holder.id).includes(mark)}/${t.world.sheet(scene.holder.id).resources.cyberpunk_daemon_cache.max}`, `true/${run.level >= 11 ? 2 : 1}`, `${mark} / Daemon Cache uses`);
  },
});

// The rigger's drones, built before the fight.
async function rigged(t, feature, level) {
  t.fresh();
  const hero = t.hero(feature.classId, level ?? feature.level);
  const made = must(await t.world.invoke("use_resource", { characterId: hero.id, resource: "Drone Companion" }), "Drone Companion").result;
  const drones = (made?.result?.summoned ?? made?.summoned ?? []).map((entry) => entry.characterId);
  if (!drones.length) throw new Error("the staged rigger has no drone");
  await t.kit.fight(2, { heroFaces: { [hero.id]: 19, ...Object.fromEntries(drones.map((id) => [id, 15])) } });
  const [near, far] = t.world.enemies();
  for (const enemy of [near, far]) t.kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  t.kit.place(hero.id, 5, 5);
  t.kit.place(near.id, 5, 6);
  t.kit.place(far.id, 15, 15);
  drones.forEach((id, index) => t.kit.place(id, 4 + index, 4));
  return { hero, drones, near, far };
}

Object.assign(CC, {
  // Drone Swarm and Signal Boost: each drone has a turn of its own in the
  // order, so no command spends the rigger's action, and a drone 70 feet
  // off moves on its turn as one beside them does.
  async cc_drone_command(t, run, feature) {
    const { hero, drones } = await rigged(t, feature);
    eq(drones.length >= 2, true, "the rigger has two drones");
    const order = t.world.encounter().order.map((entry) => entry.characterId).filter(Boolean);
    eq(drones.every((id) => order.includes(id)), true, "every drone has its own turn in the order");
    t.kit.place(drones[1], 19, 14);
    t.kit.freshTurn();
    t.kit.giveTurn(drones[1]);
    must(await t.world.invoke("move_token", { token: drones[1], x: 18, y: 13 }), "the far drone's move");
    eq(Boolean(t.world.encounter().turnBudget?.actionUsed && t.world.encounter().turnBudget?.characterId === hero.id), false, "the rigger's action spent on a command");
  },

  // Evasive Subroutines: the drone makes its DEX save against a Burning Hands
  // and takes nothing; failing it, half.
  async cc_drone_evasion(t, run, feature) {
    const { drones, near } = await rigged(t, feature);
    const drone = drones[0];
    t.kit.setEnemy(near.id, { stats: { ...t.kit.enemy(near.id).stats, spellcasting: { dc: 14, attack: 6, ability: "int", slots: { 1: 4 }, spells: [{ name: "Burning Hands", level: 1 }] } } });
    const burn = async (face) => {
      t.world.patch(drone, { currentHp: 50, maxHp: 50 });
      const encounter = t.world.encounter();
      const place = encounter.order.findIndex((entry) => entry.enemyId === near.id);
      t.encounters.saveEncounter({ ...encounter, turnIndex: place, turnBudget: null, reactionsUsed: [] });
      t.kit.freshRound();
      t.world.clearDice();
      t.world.dice(4, 4, 4, face);
      must(await t.world.invoke("aoe_damage", { casterEnemyId: near.id, spell: "Burning Hands", characterIds: [drone] }), "the foe's Burning Hands");
      t.world.clearDice();
      return 50 - t.hp(drone);
    };
    eq(`${await burn(20)}/${await burn(1)}`, "0/6", "fire the drone took making / failing its DEX save (3d6 on 4s)");
  },

  // Backup Frame: a destroyed drone is built again after a long rest, with
  // nothing spent.
  async cc_backup_frame(t, run, feature) {
    t.fresh();
    const hero = t.hero(feature.classId, feature.level);
    const build = () => t.world.invoke("use_resource", { characterId: hero.id, resource: "Drone Companion" });
    const made = must(await build(), "Drone Companion").result;
    const drone = (made?.result?.summoned ?? made?.summoned ?? [])[0]?.characterId;
    t.world.patch(drone, { currentHp: 0 });
    must(await t.world.invoke("take_rest", { kind: "long", characterIds: [hero.id] }), "the long rest");
    const before = JSON.stringify(t.world.sheet(hero.id).resources);
    const again = must(await build(), "Drone Companion after the rest").result;
    eq(`${(again?.result?.summoned ?? again?.summoned ?? []).length > 0}/${JSON.stringify(t.world.sheet(hero.id).resources) === before}`, "true/true", "a drone built again / nothing spent");
  },
});

Object.assign(CC, {
  // Silver Ledger: a dagger (2 gp) sells for 200 copper, and for 100 once the
  // feature is gone.
  async cc_full_value(t, run, feature) {
    const shops = await load("lib/db/shops.ts");
    t.fresh();
    const hero = t.hero(feature.classId, feature.level, { equipment: [{ name: "Dagger", qty: 2 }] });
    const shop = shops.insertShop(t.world.campaignId, { name: "Fence", kind: "general", size: "town", markup: 1, stock: [{ itemName: "Rope", qty: 1, priceCp: 100, note: "" }] });
    const copper = () => { const sheet = t.world.sheet(hero.id); return (sheet.gold ?? 0) * 100 + (sheet.silver ?? 0) * 10 + (sheet.copper ?? 0); };
    const sell = async () => {
      const before = copper();
      must(await t.world.invoke("sell_item", { characterId: hero.id, shop: shop.id, item: "Dagger" }), "the sale");
      return copper() - before;
    };
    const full = await sell();
    stripFeature(t, hero.id, feature.name);
    eq(`${full}/${await sell()}`, "200/100", "copper for a dagger with Silver Ledger / without it");
  },

  // Neutral Ground: the foe that accepted the parley cannot club the fixer.
  async cc_parley(t, run, feature) {
    const scene = await t.stage(feature);
    await spend(t, scene, "Neutral Ground", { targetEnemyId: scene.near.id });
    t.foesTurn(scene);
    t.kit.freshRound();
    const out = await t.world.invoke("enemy_attack", { enemyId: scene.near.id, targetCharacterId: scene.holder.id });
    eq(`${out.ok}/${t.hp(scene.holder.id)}`, "false/100", "the parleying foe's attack on the fixer / the fixer's hit points");
  },

  // Exit Strategy: initiative leaves the fixer the move; they walk 20 feet
  // away from the foe beside them and draw no opportunity attack.
  async cc_exit(t, run, feature) {
    const scene = await t.stage(feature);
    t.world.patch(scene.holder.id, { conditions: ["exit strategy"], conditionMeta: { "exit strategy": { untilTurnOf: scene.holder.id } } });
    const { exitAtInitiative } = await load("lib/dm/genre-cc-a-fixer.ts");
    const lines = exitAtInitiative(t.world.campaign(), scene.holder.id);
    eq(lines.length, 1, "the line initiative gives the fixer");
    t.world.clearDice();
    t.world.dice(19, 19, 6, 6);
    must(await t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "Exit Strategy", x: 5, y: 1 }), "Exit Strategy");
    t.world.clearDice();
    const token = t.kit.token(scene.holder.id);
    eq(`${token.x},${token.y}/${t.hp(scene.holder.id)}/${conditionsOf(t, scene.holder.id).includes("exit strategy")}`, "5,1/100/false", "the fixer's square / hit points (no opportunity attack) / the move still held");
  },
});

Object.assign(CC, {
  // Ashen Hymn: with the chant up, the foe beside the penitent rolls its first
  // save against fear this turn at disadvantage (a 20 and a 1: it fails), its
  // second as it falls (a 20: it holds); the foe 70 feet off rolls its first
  // as it falls.
  async cc_hymn(t, run, feature) {
    const { rollEnemySave } = await load("lib/dm/forced-save.ts");
    const scene = await t.stage(feature);
    await spend(t, scene, "Ashen Hymn");
    const save = (foe) => {
      t.world.clearDice();
      t.world.dice(20, 1);
      const out = rollEnemySave(t.world.campaignId, t.kit.enemy(foe.id), "wis", 15, { against: "frightened" });
      t.world.clearDice();
      return out.success;
    };
    eq(`${save(scene.near)}/${save(scene.near)}/${save(scene.far)}`, "false/true/true", "the near foe's first and second fear saves this turn / the far foe's first");
  },
});

Object.assign(CC, {
  // Hot-Sim Focus: a known ritual program (Detect Magic) cast as a ritual,
  // out of a fight, spends no slot; without the feature it is refused.
  async cc_ritual(t, run, feature) {
    t.fresh();
    const casting = { ability: "int", slots: { 1: { max: 2, used: 0 } }, known: ["Detect Magic"], prepared: ["Detect Magic"], cantrips: [] };
    const hero = t.hero(feature.classId, feature.level, { spellcasting: casting });
    const ritual = () => t.world.invoke("use_spell_slot", { characterId: hero.id, spell: "Detect Magic", ritual: true });
    const out = await ritual();
    eq(`${out.ok}/${t.world.sheet(hero.id).spellcasting.slots[1].used}`, "true/0", `the ritual (${out.error ?? "cast"}) / slots spent`);
    stripFeature(t, hero.id, feature.name);
    eq((await ritual()).ok, false, "the ritual without Hot-Sim Focus");
  },

  // Miasma Mantle: the ward's poison resistance reaches an ally 15 feet off.
  async cc_mantle(t, run, feature) {
    const scene = await t.stage(feature);
    t.kit.place(scene.ally.id, 5, 2);
    must(await t.world.invoke("apply_damage", { characterId: scene.ally.id, amount: 10, type: "poison" }), "the poison");
    eq(20 - t.hp(scene.ally.id), 5, "hit points an ally 15 feet away lost to 10 poison");
  },

  // Jury-Rig: the ally's check with thieves' tools adds 1d4; one with no tool does not.
  async cc_jury(t, run, feature) {
    const { listRecentRolls } = await load("lib/db/rolls.ts");
    const scene = await t.stage(feature);
    await spend(t, scene, "Jury-Rig", { targetCharacterId: scene.ally.id });
    const roll = async (tool) => {
      must(await t.world.invoke("request_roll", { characterId: scene.ally.id, kind: "ability_check", ability: "dex", dc: 10, reason: "a probe", ...(tool ? { tool } : {}) }), "the check");
      return /1d4/.test(listRecentRolls(t.world.campaignId, 3).at(-1)?.expression ?? "");
    };
    eq(`${await roll("Thieves' Tools")}/${await roll(null)}`, "true/false", "a d4 on the check with a tool / with none");
  },
});

Object.assign(CC, {
  // Sepulchral Dominion: a regenerating foe beside the knight regains half
  // (5 of 10) as its turn starts; one 70 feet off regains all of it.
  async cc_dominion(t, run, feature) {
    const { refillLegendaryForTurn } = await load("lib/dm/legendary-tools.ts");
    const scene = await t.stage(feature);
    const regain = (foe) => {
      t.kit.setEnemy(foe.id, { currentHp: 100, stats: { ...t.kit.enemy(foe.id).stats, regeneration: { amount: 10, stoppedBy: [] } } });
      refillLegendaryForTurn(t.world.encounter(), t.kit.enemy(foe.id));
      return t.foeHp(foe.id) - 100;
    };
    eq(`${regain(scene.near)}/${regain(scene.far)}`, "5/10", "hit points regenerated by the foe beside the knight / 70 feet off");
  },
});

Object.assign(CC, {
  // ICE Pick's save half: a foe's Burning Hands (DC 14) that the netrunner
  // fails on a 12 (+2 DEX) is turned to a success by the +2.
  async cc_ice_save(t, run, feature) {
    const scene = await t.stage(feature);
    t.kit.setEnemy(scene.near.id, { stats: { ...t.kit.enemy(scene.near.id).stats, spellcasting: { dc: 14, attack: 6, ability: "int", slots: { 1: 4 }, spells: [{ name: "Burning Hands", level: 1 }] } } });
    t.foesTurn(scene);
    t.kit.freshRound();
    t.world.clearDice();
    t.world.dice(4, 4, 4, 10);
    must(await t.world.invoke("aoe_damage", { casterEnemyId: scene.near.id, spell: "Burning Hands", characterIds: [scene.holder.id] }), "the foe's Burning Hands");
    t.world.clearDice();
    const out = await t.world.invoke("use_reaction", { characterId: scene.holder.id, feature: "ICE Pick", variant: "save" });
    eq(`${out.ok}/${out.result?.save}`, "true/success", `ICE Pick on the save failed by 2 (${out.error ?? "turned"}) / the save after the +2`);
  },
});

Object.assign(CC, {
  // Relentless Pursuit: the branded foe hides; the hunter's swing at it is
  // not made unseen, and is once the feature is gone.
  async cc_pursuit(t, run, feature) {
    const { listRecentRolls } = await load("lib/db/rolls.ts");
    const scene = await t.stage(feature);
    must(await t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "Hunter's Brand", targetEnemyId: scene.near.id }), "Hunter's Brand");
    const swing = async () => {
      t.kit.setEnemy(scene.near.id, { conditions: [...t.kit.enemy(scene.near.id).conditions.filter((entry) => entry !== "hidden"), "hidden"] });
      t.kit.freshTurn();
      t.kit.giveTurn(scene.holder.id);
      must(await t.kit.swing(scene.holder.id, scene.near.id, [15, 15, 3, 3, 3]), "the swing");
      return listRecentRolls(t.world.campaignId, 6).filter((entry) => entry.kind === "attack").at(-1)?.advantage ?? "none";
    };
    const pursued = await swing();
    stripFeature(t, scene.holder.id, feature.name);
    eq(`${pursued}/${await swing()}`, "none/disadvantage", "the swing at the hidden branded foe with Relentless Pursuit / without it");
  },
});

Object.assign(CC, {
  // The Final Movement: the ally spends the dirgesinger's d12 on a check; it
  // rolls 12, 12 and 5, and the check carries the 29.
  async cc_explode(t, run, feature) {
    const { listRecentRolls } = await load("lib/db/rolls.ts");
    const scene = await t.stage(feature);
    must(await t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "Requiem Inspiration", targetCharacterId: scene.ally.id }), "Requiem Inspiration");
    t.world.clearDice();
    t.world.dice(12, 12, 5, 10, 10);
    must(await t.world.invoke("request_roll", { characterId: scene.ally.id, kind: "ability_check", ability: "str", dc: 10, reason: "a probe", visibility: "dm" }), "the check");
    t.world.clearDice();
    const expression = listRecentRolls(t.world.campaignId, 3).at(-1)?.expression ?? "";
    eq(/\+29\b/.test(expression), true, `the exploded die in the check (${expression})`);
  },
});

Object.assign(CC, {
  // Beaked Mask: a foe's Cloudkill (a poison gas) catches the doctor and the
  // ally beside them; the ally takes the poison, the masked doctor nothing.
  async cc_mask(t, run, feature) {
    const scene = await t.stage(feature);
    t.kit.setEnemy(scene.near.id, { stats: { ...t.kit.enemy(scene.near.id).stats, spellcasting: { dc: 14, attack: 6, ability: "int", slots: { 5: 2 }, spells: [{ name: "Cloudkill", level: 5 }] } } });
    t.foesTurn(scene);
    t.kit.freshRound();
    t.world.clearDice();
    t.world.dice(4, 4, 4, 4, 4, 1, 1, 1, 1);
    must(await t.world.invoke("aoe_damage", { casterEnemyId: scene.near.id, spell: "Cloudkill", characterIds: [scene.holder.id, scene.ally.id] }), "the foe's Cloudkill");
    t.world.clearDice();
    eq(`${100 - t.hp(scene.holder.id)}/${20 - t.hp(scene.ally.id) > 0}`, "0/true", "poison the masked doctor took / the ally took some");
  },
});

Object.assign(CC, {
  // Funeral March: with the dirgesinger singing (a dirge held), the ally
  // beside them walks three squares north across two rows of rough ground for three
  // squares, and their speed slowed is 30 still; with the song stopped, five
  // squares and 15.
  async cc_march(t, run, feature) {
    const { pcMoveBudget } = await load("lib/battlemap/view.ts");
    const scene = await t.stage(feature);
    const walk = async () => {
      // Two whole rows of rough ground, so no path goes round them.
      const width = t.kit.map().width;
      t.kit.openField([3, 4].flatMap((y) => Array.from({ length: width }, (_, x) => [x, y, ","])));
      t.kit.freshTurn();
      t.kit.giveTurn(scene.ally.id);
      t.kit.place(scene.ally.id, 4, 5);
      // The player's own move, as the app sends it (the move route).
      const route = await t.world.route("campaigns/[campaignId]/battle-map/move");
      t.world.signIn({ id: t.world.sheet(scene.ally.id).userId });
      const response = await route.POST(new Request(`http://odm.test/api/campaigns/${t.world.campaignId}/battle-map/move`, { method: "POST", body: JSON.stringify({ x: 4, y: 2 }) }), { params: Promise.resolve({ campaignId: t.world.campaignId }) });
      t.world.signIn(t.world.owner);
      if (response.status !== 200) throw new Error(`the ally's walk was refused: ${JSON.stringify(await response.json().catch(() => ({})))}`);
      return t.kit.token(scene.ally.id).movedThisRound;
    };
    const slowed = () => {
      t.world.patch(scene.ally.id, { conditions: ["slowed"] });
      const speed = pcMoveBudget(t.world.campaignId, t.world.encounter(), t.kit.map(), t.world.sheet(scene.ally.id), t.kit.token(scene.ally.id)).speed;
      t.world.patch(scene.ally.id, { conditions: [] });
      return speed;
    };
    t.world.patch(scene.holder.id, { concentratingOn: "Bane" });
    const singing = `${await walk()}/${slowed()}`;
    t.world.patch(scene.holder.id, { concentratingOn: null });
    const silent = `${await walk()}/${slowed()}`;
    eq(`${singing} | ${silent}`, "3/30 | 5/15", "squares the ally's walk cost / their speed slowed, the dirgesinger singing | not singing");
  },
});

Object.assign(CC, {
  // Squire of Bones: refused on the living foe; once the knight kills it,
  // its bones rise. "raise": an undead squire of the knight's for 4800
  // rounds, acting right after them. "stats": its hit points, armor class
  // and attacks are the foe's.
  async cc_squire(t, run, feature) {
    const scene = await t.stage(feature);
    const raise = () => t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "Squire of Bones", targetEnemyId: scene.near.id });
    eq((await raise()).ok, false, "Squire of Bones on a living foe");
    t.kit.setEnemy(scene.near.id, { currentHp: 1 });
    must(await t.kit.swing(scene.holder.id, scene.near.id, [15, 4, 4, 4, 4]), "the killing blow");
    if (t.kit.enemy(scene.near.id).status !== "dead") throw new Error("the near foe did not die");
    // The knight's next turn: the kill spent this one's action.
    t.kit.freshTurn();
    t.kit.giveTurn(scene.holder.id);
    const made = must(await raise(), "Squire of Bones on the slain foe").result;
    const id = (made?.result?.summoned ?? made?.summoned ?? [])[0]?.characterId;
    eq(Boolean(id), true, "a squire raised from the slain foe");
    const squire = t.world.sheet(id);
    if (run.part === "raise") {
      const order = t.world.encounter().order.map((entry) => entry.characterId ?? entry.enemyId);
      eq(
        `${squire.summon?.creatureType}/${squire.summon?.casterId === scene.holder.id}/${squire.conditionMeta?.summoned?.rounds}/${order.indexOf(id) - order.indexOf(scene.holder.id)}`,
        "undead/true/4800/1",
        "the squire's type / the knight's to command / its rounds / its place after the knight",
      );
      return;
    }
    const foe = t.kit.enemy(scene.near.id);
    const swings = (attacks) => JSON.stringify(attacks.filter((attack) => !attack.bonusAction).map((attack) => [attack.name, attack.toHit, attack.damage]));
    eq(`${squire.maxHp}/${squire.ac}/${swings(squire.summon?.attacks ?? [])}`, `${foe.maxHp}/${foe.ac}/${swings(foe.stats.attacks)}`, "the squire's hit points / armor class / attacks, against the foe's");
  },
});

// The vermin lord's dire rat, built before the fight (Favored of the Swarm).
async function ratPack(t, feature) {
  t.fresh();
  const hero = t.hero(feature.classId, feature.level);
  const made = must(await t.world.invoke("use_resource", { characterId: hero.id, resource: "Favored of the Swarm" }), "Favored of the Swarm").result;
  const rat = (made?.result?.summoned ?? made?.summoned ?? [])[0]?.characterId;
  if (!rat) throw new Error("the staged vermin lord has no dire rat");
  await t.kit.fight(2, { heroFaces: { [hero.id]: 19, [rat]: 18 } });
  const [near, far] = t.world.enemies();
  for (const enemy of [near, far]) t.kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  t.kit.place(hero.id, 5, 5);
  t.kit.place(near.id, 5, 6);
  t.kit.place(far.id, 15, 15);
  return { hero, rat, near, far };
}

Object.assign(CC, {
  // Pack Hunting: the lord's attack on the foe the rat is beside throws two
  // d20s, and one once the rat stands away; the rat's own has the same.
  async cc_pack_hunting(t, run, feature) {
    const { hero, rat, near } = await ratPack(t, feature);
    const { listRecentRolls } = await load("lib/db/rolls.ts");
    const d20s = async (who) => {
      t.kit.freshTurn();
      t.kit.giveTurn(who);
      must(await t.kit.swing(who, near.id, [15, 15, 3, 3, 3]), "the swing");
      const roll = listRecentRolls(t.world.campaignId, 6).filter((entry) => entry.kind === "attack").at(-1);
      return roll?.advantage === "advantage" ? 2 : 1;
    };
    t.kit.place(rat, 6, 6);
    const lordWith = await d20s(hero.id);
    const ratWith = await d20s(rat);
    t.kit.place(rat, 12, 12);
    const lordWithout = await d20s(hero.id);
    eq(`${lordWith}/${ratWith}/${lordWithout}`, "2/2/1", "d20s: the lord with the rat beside the foe / the rat with the lord beside it / the lord alone");
  },

  // Grey Tide Rising: the grown rat's bite makes the foe save on CON (a 1)
  // or have disadvantage on STR checks for a minute.
  async cc_grey_tide(t, run, feature) {
    const { conditionEffectsFor } = await load("lib/srd/condition-effects.ts");
    const { rat, near } = await ratPack(t, feature);
    t.kit.place(rat, 6, 6);
    t.kit.freshTurn();
    t.kit.giveTurn(rat);
    must(await t.kit.swing(rat, near.id, [15, 3, 3, 3, 1, 1]), "the rat's bite");
    const held = foeConditions(t, near.id).find((entry) => entry.startsWith("weakening"));
    eq(Boolean(held), true, "a weakening bite on the foe after a failed CON save");
    const row = conditionEffectsFor(held);
    eq(JSON.stringify(row?.disadvantageOn ?? []), JSON.stringify([{ kind: "check", ability: "str" }]), "what the weakening bite gives disadvantage on");
    eq(t.kit.enemy(near.id).conditionMeta?.[held]?.rounds, 10, "rounds (a minute) the weakening bite lasts");
  },
});

export { conditionsOf, foeConditions, stripFeature, TRAINED };
