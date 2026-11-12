// Lifecycle sweep, parts 1 and 2: what a spell lays, for how long, and what
// ending its concentration takes.
//
// The table walked is every bundled spell whose mechanics row lays a
// condition, a buff or a pool of hit points (scripts/lib/sweep-lifecycle-
// spells.mjs spellRows: the SRD rows and the authored ones). Each is cast
// from its real source, a wizard on her turn in a fight, at a dummy or on
// the fighter beside her, and then:
//
//   duration   the rounds the engine wrote on what it laid are the Duration
//              its text prints (SRD 5.1 page, or the authored row);
//   flag       it holds the caster's concentration exactly when the text says
//              "Concentration";
//   caught     (a spell that lays an area) a round on, the fighter beside the
//              foe has begun a turn in it; then the swap below: what the area
//              laid on the fighter goes with the rest;
//   own area   (the same spells) the caster stands in her own area until its
//              damage breaks her concentration: nothing of the spell is left
//              on her either;
//   swap       another concentration spell cast: everything the first laid is
//              gone, and nothing else is (a mark the test put on the fighter
//              stays). For a spell WITHOUT concentration the same swap takes
//              nothing of it;
//   drop       the caster falls to 0 hit points: the same;
//   stun       the caster is stunned (incapacitated): the same.
//
// SRD 5.1, Spellcasting, Concentration: "If you lose concentration, such a
// spell ends." "You lose concentration on a spell if you cast another spell
// that requires concentration." "You lose concentration on a spell if you are
// incapacitated or if you die."
import assert from "node:assert/strict";
import fs from "node:fs";
import { hasPack } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { castRow, dropCaster, left, metaOf, mustGo, spellRows, strays, stunCaster, swapConcentration, walkRounds } from "./lib/sweep-lifecycle-spells.mjs";

const { test, gap, finish } = suite("test-enforce-sweep-lifecycle-conc");
const REPORT = process.env.SWEEP_REPORT ?? null;
const report = [];

const CONCENTRATION = "SRD 5.1, Concentration: \"If you lose concentration, such a spell ends.\"";
const RULES = {
  duration: (row) => `${row.text?.source}: "Duration: ${row.printed?.text}"`,
  flag: (row) => `${row.text?.source}: "Duration: ${row.printed?.text}"`,
  caught: () => `${CONCENTRATION} (what the spell's area laid on a creature that began its turn there ends with the spell)`,
  "own area": () => `${CONCENTRATION} (the caster caught in her own area, her concentration broken by its damage)`,
  swap: () => `${CONCENTRATION} "You lose concentration on a spell if you cast another spell that requires concentration. You can't concentrate on two spells at once."`,
  keeps: (row) => `${row.text?.source}: "Duration: ${row.printed?.text}" (no concentration: another spell's concentration is nothing to it)`,
  drop: () => `${CONCENTRATION} "You lose concentration on a spell if you are incapacitated or if you die."`,
  stun: () => `${CONCENTRATION} "You lose concentration on a spell if you are incapacitated or if you die."`,
};

// A row not walked, and why.
const SKIP = {
  "Feather Fall": "cast as a reaction to a fall, which needs a creature falling: no door of this sweep stages one",
  Geas: "a casting of a minute at a foe: held across turns by long-casting.ts, walked by its own suites",
  Imprisonment: "a casting of a minute at a foe (as Geas)",
  Foresight: "a casting of a minute: refused in a fight, walked at rest by test-enforce-sweep-lifecycle-time",
  "Gift of Alacrity": "a casting of a minute (as Foresight)",
  "Heroes' Feast": "a casting of ten minutes (as Foresight)",
  "Wind Walk": "a casting of a minute (as Foresight)",
};

// The caster herself becomes a beast: she can cast nothing to swap to, and a
// blow takes the form's hit points, not hers. Its ending is the polymorph
// suites' (test-enforce-polymorph-*).
const CASTER_TRANSFORMED = { Shapechange: true };

// Known today, by "Spell/check". Each is in /tmp/odm-gapstudy/findings/lifecycle.jsonl.
// With the content pack every row the sweep walks is enforced. Without it,
// Ravenous Void (an authored spell, src/lib/srd/authored-spells.json) lays its
// restraint with no rounds: the duration is read from the pack's record of
// the spell, which a server with no pack does not have.
const KNOWN = hasPack
  ? {}
  : {
      "Ravenous Void/duration": {
        where: "the area spell's laid condition takes its rounds from the pack's spell record, not the authored spell's own duration",
        severity: "low",
        note: "Only a server with no content pack: the apps and Docker image carry it.",
      },
    };

// One check of one row not made, and why.
const SUBSKIP = {
  "Earthquake/flag": "the caster stands in her own 100-foot quake, and with every save forced to 1 the spell's own text costs her the concentration (\"a concentrating one makes a CON save or loses it\"); src/lib/dm/zone-quake.ts and test-enforce-zones hold it",
};

const rows = spellRows();
let walked = 0;

async function check(row, name, fn) {
  const id = `${row.name}/${name}`;
  if (SUBSKIP[id]) {
    return;
  }
  const known = KNOWN[id];
  const run = async () => {
    try {
      await fn();
    } catch (error) {
      if (REPORT) {
        report.push({ id, error: String(error?.message ?? error).split("\n")[0].slice(0, 500), assertion: error?.code === "ERR_ASSERTION" });
      }
      // A staging check that fails is the suite breaking, never a known gap.
      if (/^setup:/.test(String(error?.message ?? ""))) {
        throw new Error(error.message);
      }
      throw error;
    }
  };
  if (known) {
    await gap(`sweep-lifecycle-conc:${id}`, { rule: RULES[name](row), where: known.where, severity: known.severity, note: known.note }, run);
  } else {
    await test(`${id}`, run);
  }
}

// A casting that must go through: a refusal is the row not walked.
async function cast(row) {
  const made = await castRow(row, "fight");
  if (!made.out.ok) {
    throw new Error(`${row.name} was refused, so the row was not walked: ${made.out.error}`);
  }
  return made;
}

for (const row of rows) {
  if (SKIP[row.name]) {
    continue;
  }
  walked += 1;
  const concentrates = (made) => made.carried.some((entry) => /concentrates on/.test(entry));

  await check(row, "duration", async () => {
    const made = await cast(row);
    assert.ok(row.printed, `${row.name} has no text this sweep can read a Duration from`);
    const laid = made.carried.filter((entry) => / has /.test(entry));
    assert.ok(laid.length, `${row.name} was cast and laid nothing: ${JSON.stringify(made.out.result).slice(0, 200)}`);
    // A creature knocked prone stays down until it stands: no count.
    for (const entry of laid.filter((each) => !/ has prone$/.test(each))) {
      const condition = entry.split(" has ")[1];
      const meta = metaOf(made.ctx, condition) ?? {};
      // Tied to a turn, or held by saves alone: no count to compare.
      if (meta.untilTurnOf || meta.untilTurnEndOf) {
        continue;
      }
      const printed = row.printed.rounds;
      // What the text gives the condition itself ("blinded for 1 minute"),
      // where it is not the spell's own duration.
      const own = [...(row.text?.md ?? "").matchAll(/for (\d+|one|a) (round|minute|hour|day)s?/gi)].map((match) => {
        const count = /^\d+$/.test(match[1]) ? Number(match[1]) : 1;
        return count * { round: 1, minute: 10, hour: 600, day: 14400 }[match[2].toLowerCase()];
      });
      if (printed === null || printed === Infinity) {
        if (meta.rounds !== undefined) {
          assert.ok(own.includes(meta.rounds), `${entry}: the engine counts ${meta.rounds} rounds and the text ("${row.printed.text}") gives no such time`);
        }
        continue;
      }
      assert.ok(
        meta.rounds === printed || (row.kind !== "buff" && own.includes(meta.rounds)),
        `${entry}: the engine wrote ${meta.rounds} rounds, the text says "${row.printed.text}" (${printed} rounds)`,
      );
    }
  });

  await check(row, "flag", async () => {
    const made = await cast(row);
    assert.equal(concentrates(made), Boolean(row.printed?.concentration), `${row.name}: the text says "${row.printed?.text}", and after the cast the caster ${concentrates(made) ? "concentrates" : "does not concentrate"} (${made.carried.join("; ")})`);
  });

  if (CASTER_TRANSFORMED[row.name]) {
    continue;
  }
  if (row.printed?.concentration) {
    // A spell that lays an area catches whoever begins a turn in it: the
    // fighter beside the foe, a round later. What it laid on them goes with
    // the spell too.
    await check(row, "caught", async () => {
      const made = await cast(row);
      if (!made.carried.some((entry) => /an area of/.test(entry))) {
        return;
      }
      walkRounds(made, 1);
      assert.ok(made.carried.some((entry) => /concentrates on/.test(entry)) && left(made).some((entry) => /concentrates on/.test(entry)), `setup: a round on, the caster no longer holds ${row.name}`);
      const { out, other } = await swapConcentration(made, row);
      assert.equal(out.ok, true, `the second spell (${other}) was refused: ${out.error}`);
      assert.deepEqual([...left(made), ...strays(made, row)], [], `${other} was cast a round into ${row.name}, and this is left of it`);
    });
    // The caster stands in her own area and the spell's own damage breaks
    // her concentration (every save a 1): what the area laid on HER in that
    // same moment must not outlive the spell.
    await check(row, "own area", async () => {
      const made = await castRow(row, "fight", { inside: true });
      if (!made.out.ok || !made.carried.some((entry) => /an area of/.test(entry))) {
        return;
      }
      for (let round = 0; round < 3 && made.ctx.world.sheet(made.ctx.mage.id).concentratingOn; round += 1) {
        walkRounds(made, 1);
      }
      if (made.ctx.world.sheet(made.ctx.mage.id).concentratingOn) {
        return;
      }
      // One more round: whatever was written as the spell broke has had its turn.
      walkRounds(made, 1);
      assert.deepEqual([...left(made), ...strays(made, row)], [], `${row.name} ended when its own area broke the caster's concentration, and this is left of it`);
    });
    await check(row, "swap", async () => {
      const made = await cast(row);
      const { out, other } = await swapConcentration(made, row);
      assert.equal(out.ok, true, `the second spell (${other}) was refused: ${out.error}`);
      assert.deepEqual([...left(made), ...strays(made, row)], [], `${other} was cast, and ${row.name} left this behind`);
      assert.ok(made.ctx.world.sheet(made.ctx.hero.id).conditions.includes("marked by the test"), "the swap took a condition no spell laid");
    });
    await check(row, "drop", async () => {
      const made = await cast(row);
      const out = await dropCaster(made);
      made.ctx.world.clearDice();
      assert.equal(out.ok, true, out.error);
      assert.equal(made.ctx.world.sheet(made.ctx.mage.id).currentHp, 0, "setup: the caster is at 0");
      assert.deepEqual([...left(made), ...strays(made, row)], [], `the caster fell to 0 hit points, and ${row.name} left this behind`);
      assert.ok(made.ctx.world.sheet(made.ctx.hero.id).conditions.includes("marked by the test"), "the fall took a condition no spell laid");
    });
    await check(row, "stun", async () => {
      const made = await cast(row);
      const out = await stunCaster(made);
      assert.equal(out.ok, true, out.error);
      assert.deepEqual([...left(made), ...strays(made, row)], [], `the caster was stunned, and ${row.name} left this behind`);
    });
  } else {
    await check(row, "keeps", async () => {
      const made = await cast(row);
      const first = await swapConcentration(made, row);
      assert.equal(first.out.ok, true, `${first.other} was refused: ${first.out.error}`);
      const second = await swapConcentration(made, { name: first.other });
      assert.equal(second.out.ok, true, `${second.other} was refused: ${second.out.error}`);
      const kept = mustGo(made.carried).filter((entry) => / has /.test(entry));
      assert.deepEqual(left(made, kept), kept, `${row.name} holds no concentration, and a change of concentration took some of it`);
    });
  }
}

if (REPORT) {
  fs.writeFileSync(REPORT, report.map((line) => JSON.stringify(line)).join("\n"));
}
console.log(`sweep-lifecycle-conc: ${walked} of ${rows.length} spells walked, ${Object.keys(SKIP).length} skipped with a reason, ${Object.keys(SUBSKIP).length} single checks skipped with a reason`);
finish();
