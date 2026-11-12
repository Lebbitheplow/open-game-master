// Lifecycle sweep, part 2: damage and concentration, at every door damage
// comes through and in every state that changes what the damage does.
//
// SRD 5.1, Concentration: "Taking damage. Whenever you take damage while you
// are concentrating on a spell, you must make a Constitution saving throw to
// maintain your concentration. The DC equals 10 or half the damage you take,
// whichever number is higher." "Being incapacitated or killed. You lose
// concentration on a spell if you are incapacitated or if you die."
//
// The matrix is DOORS x STATES x {every die low, every die high}. A wizard
// (or, for Undying Sentinel, an Ancients paladin) concentrates on Bless, laid
// on herself and the fighter. One blow comes through the door:
//
//   low dice   the save fails: the concentration is gone and so is the
//              fighter's Bless, in every state, at every door;
//   high dice  the save holds (DC 10): both are kept, unless the state is the
//              one where she drops to 0, which ends it whatever the dice.
//
// The states are the returns ahead of the tail of applyPcDamage that pull
// request #784 found skipping the save (Death Ward, Relentless Endurance,
// Undying Sentinel holding at 1 hit point), temporary hit points taking the
// whole blow, and the plain cases. A door added to DOORS is checked in every
// state the day it lands.
import assert from "node:assert/strict";
import fs from "node:fs";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster } from "./lib/enforce-spell-kit.mjs";
import { TRAINED } from "./lib/enforce-combat.mjs";
import { stage } from "./lib/sweep-lifecycle-stage.mjs";

const { test, gap, finish } = suite("test-enforce-sweep-lifecycle-damage");
const REPORT = process.env.SWEEP_REPORT ?? null;
const report = [];

const RULE =
  "SRD 5.1, Concentration: \"Whenever you take damage while you are concentrating on a spell, you must make a Constitution saving throw to maintain your concentration.\" \"You lose concentration on a spell if you are incapacitated or if you die.\" \"If you lose concentration, such a spell ends.\"";

// ---- the doors: one blow on the concentrating hero ----
// `lead`: dice thrown before the damage and the save that must not be 1s (an
// attack roll that has to hit).
const DOORS = {
  apply_damage: { args: (c) => ({ characterId: c.caster.id, amount: 9, type: "fire" }) },
  "apply_damage (shares)": { name: "apply_damage", args: (c) => ({ targets: [{ characterId: c.caster.id, share: "full" }], amount: 9, type: "fire" }) },
  enemy_attack: { args: (c) => ({ enemyId: c.e1.id, targetCharacterId: c.caster.id }), lead: [19] },
  cast_at_player: { args: (c) => ({ characterId: c.caster.id, saveAbility: "dex", dc: 15, damage: "2d6+6", damageType: "fire", halfOnSave: true, casterEnemyId: c.e1.id }) },
  "aoe_damage (a foe's)": { name: "aoe_damage", args: (c) => ({ casterEnemyId: c.e1.id, enemyAbility: "Fire Breath", damage: "2d6+6", saveAbility: "dex", dc: 15, type: "fire", halfOnSave: true, characterIds: [c.caster.id] }) },
  "apply_hazard (a fall)": { name: "apply_hazard", calm: false, args: (c) => ({ type: "falling", characterIds: [c.caster.id], feet: 30 }) },
};

// ---- the states ----
// build: overrides for the caster's sheet. set(c): staging after the Bless.
// ends: true when the blow ends the concentration whatever the dice.
const STATES = {
  plain: {},
  "temporary hit points take the blow": { set: (c) => c.world.patch(c.caster.id, { tempHp: 40 }) },
  "Death Ward holds at 1": { set: (c) => c.world.patch(c.caster.id, { currentHp: 2, conditions: [...c.world.sheet(c.caster.id).conditions, "death ward"] }) },
  "Relentless Endurance holds at 1": { build: { race: "half-orc" }, set: (c) => c.world.patch(c.caster.id, { currentHp: 2 }) },
  "Undying Sentinel holds at 1": { paladin: true, set: (c) => c.world.patch(c.caster.id, { currentHp: 2 }) },
  "drops to 0": { set: (c) => c.world.patch(c.caster.id, { currentHp: 2 }), ends: true },
};

// A check not made, and why.
const SKIP = {};

// Known today, by "door / state / dice".
const KNOWN = {};

const FIGHTER = {
  name: "Kara",
  class: "fighter",
  level: 5,
  maxHp: 44,
  abilities: { str: 16, dex: 14, con: 14 },
  proficiencies: { ...TRAINED, saves: ["str", "con"] },
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
};

async function table(state) {
  const base = state.paladin
    ? { ...caster("paladin", "cha", ["Bless", "Shield of Faith"], [], 17), subclass: "Oath of the Ancients", abilities: { cha: 18, con: 10, dex: 10, str: 14 } }
    : { ...caster("wizard", "int", ["Bless", "Blur"], [], 9), abilities: { int: 18, con: 10, dex: 10 } };
  const ctx = await stage("fight", { heroes: [FIGHTER, { name: "Mira", maxHp: 60, proficiencies: { ...TRAINED, saves: [] }, ...base, ...(state.build ?? {}) }] });
  ctx.caster = ctx.mage;
  ctx.kit.place(ctx.caster.id, 6, 6);
  ctx.kit.giveTurn(ctx.caster.id);
  const blessed = await ctx.world.invoke("cast_buff", { characterId: ctx.caster.id, spell: "Bless", level: 1, targetCharacterIds: [ctx.hero.id, ctx.caster.id] });
  if (!blessed.ok) {
    throw new Error(`setup: Bless was refused: ${blessed.error}`);
  }
  await state.set?.(ctx);
  // The foes' turn, so a foe's blow is in turn.
  ctx.kit.giveTurn(ctx.hero.id);
  ctx.kit.freshRound();
  return ctx;
}

let walked = 0;
for (const [doorName, door] of Object.entries(DOORS)) {
  for (const [stateName, state] of Object.entries(STATES)) {
    for (const dice of ["low", "high"]) {
      const id = `${doorName} / ${stateName} / ${dice} dice`;
      if (SKIP[id] || SKIP[`${doorName} / ${stateName}`]) {
        continue;
      }
      walked += 1;
      const run = async () => {
        const ctx = await table(state);
        const { world } = ctx;
        const before = world.sheet(ctx.caster.id);
        assert.equal(before.concentratingOn, "Bless", "setup: concentrating on Bless");
        world.clearDice();
        world.diceLog();
        // Low: an attack still has to land (its lead die), then every die a 1.
        // High: every d20 a 20; damage dice a 1, so the DC stays 10.
        if (dice === "low") {
          world.dice(...(door.lead ?? []), ...new Array(30).fill(1));
        }
        let out;
        if (dice === "high") {
          // Every die the queue does not name: d20s high, the rest low.
          out = await withHighD20s(world, () => world.invoke(door.name ?? doorName, door.args(ctx)));
        } else {
          out = await world.invoke(door.name ?? doorName, door.args(ctx));
        }
        const rolled = world.diceLog().map((die) => `d${die.sides}:${die.face}`);
        world.clearDice();
        const after = world.sheet(ctx.caster.id);
        const fighter = world.sheet(ctx.hero.id);
        const line = { id, ok: out.ok, error: out.error, hp: `${before.currentHp}+${before.tempHp ?? 0} -> ${after.currentHp}+${after.tempHp ?? 0}`, conc: after.concentratingOn, fighterBlessed: fighter.conditions.includes("blessed"), rolled: rolled.join(" ") };
        report.push(line);
        if (!out.ok) {
          throw new Error(`the door refused the blow, so the row was not walked: ${out.error}`);
        }
        const hurt = after.currentHp < before.currentHp || (after.tempHp ?? 0) < (before.tempHp ?? 0);
        assert.ok(hurt, `setup: the blow did no damage (${line.hp}; dice ${line.rolled})`);
        if (stateName.includes("holds at 1")) {
          assert.equal(after.currentHp, 1, `setup: the hold did not keep the caster at 1 hit point (${line.hp})`);
        }
        if (dice === "low" || state.ends) {
          assert.equal(after.concentratingOn, null, `the caster took damage (${line.hp}; dice ${line.rolled}) and still concentrates on ${after.concentratingOn}`);
          assert.equal(fighter.conditions.includes("blessed"), false, "the concentration ended and the fighter is still blessed");
        } else {
          assert.equal(after.concentratingOn, "Bless", `every d20 a 20 and the concentration was lost (${line.hp}; dice ${line.rolled})`);
          assert.equal(fighter.conditions.includes("blessed"), true, "the concentration held and the fighter lost the Bless");
        }
      };
      const known = KNOWN[id];
      if (known) {
        // A staging check that fails is the suite breaking, never a known gap.
        const guarded = () =>
          run().catch((error) => {
            throw /^setup:/.test(String(error?.message ?? "")) ? new Error(error.message) : error;
          });
        await gap(`sweep-lifecycle-damage:${id}`, { rule: RULE, where: known.where, severity: known.severity, note: known.note }, guarded);
      } else {
        await test(id, run);
      }
    }
  }
}

// Runs `fn` with every unqueued d20 a 20 and every other unqueued die a 1.
async function withHighD20s(world, fn) {
  const crypto = await import("node:crypto");
  const { syncBuiltinESMExports } = await import("node:module");
  const forced = crypto.default.randomInt;
  crypto.default.randomInt = function highD20(min, max, callback) {
    if (min === 1 && typeof max === "number" && typeof callback !== "function") {
      // Through the world's own queue, so the die is logged as any other.
      world.dice(max - 1 === 20 ? 20 : 1);
    }
    return forced(min, max, callback);
  };
  syncBuiltinESMExports();
  try {
    return await fn();
  } finally {
    crypto.default.randomInt = forced;
    syncBuiltinESMExports();
  }
}

if (REPORT) {
  fs.writeFileSync(REPORT, report.map((line) => JSON.stringify(line)).join("\n"));
}
console.log(`sweep-lifecycle-damage: ${walked} cells walked (${Object.keys(DOORS).length} doors x ${Object.keys(STATES).length} states x 2), ${Object.keys(SKIP).length} skipped with a reason`);
finish();
