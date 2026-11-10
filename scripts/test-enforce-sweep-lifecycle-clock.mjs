// Lifecycle sweep, part 1 (endings outside a fight): a buff cast at rest
// lasts as long as its text says by every way time passes, and no longer.
//
// The table is the buff rows of scripts/lib/sweep-lifecycle-spells.mjs (a
// spell laid on the caster or an ally) whose text prints a Duration in
// rounds, minutes or hours. Each is cast by the wizard outside a fight, and:
//
//   clock      pass_time of its duration and a minute more: all of it gone,
//              the concentration with it;
//   early      (ten minutes or longer) pass_time of half its duration: all of
//              it still there;
//   short rest an hour's rest ends a spell of an hour or less, and leaves one
//              of eight hours or more;
//   long rest  eight hours' rest ends a spell of under eight hours, and
//              leaves one of a day.
//
// A spell with no fixed time (Instantaneous, Until dispelled) is not walked
// here; the suite prints how many.
import assert from "node:assert/strict";
import fs from "node:fs";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { left, mustCast, mustGo, runner, spellRows } from "./lib/sweep-lifecycle-spells.mjs";

const harness = suite("test-enforce-sweep-lifecycle-clock");
const REPORT = process.env.SWEEP_REPORT ?? null;
const report = [];

const DURATION = (row) => `${row.text?.source}: "Duration: ${row.printed?.text}"`;
const RULES = { clock: DURATION, early: DURATION, "short rest": DURATION, "long rest": DURATION };

const SKIP = {
  "Absorb Elements": "a reaction to a hit: cast in a fight only (test-enforce-sweep-lifecycle-rounds walks it)",
  "Feather Fall": "a reaction to a fall: no door of this sweep stages one",
  Hex: "marks a foe: cast in a fight only (the rounds and concentration suites walk it)",
  "Hunter's Mark": "marks a foe (as Hex)",
  Shapechange: "the caster herself becomes a beast; the polymorph suites hold its ending",
};

// Known today, by "Spell/check".
// None today: every row the sweep walks is enforced.
const KNOWN = {};

const check = runner({ name: "sweep-lifecycle-clock", harness, known: KNOWN, rules: RULES, report: REPORT ? report : null });
const all = spellRows().filter((row) => row.kind === "buff");
const rows = all.filter((row) => !SKIP[row.name] && Number.isFinite(row.printed?.rounds));
const HOUR = 600;

for (const row of rows) {
  const rounds = row.printed.rounds;
  const minutes = Math.max(1, Math.ceil(rounds / 10));

  await check(row, "clock", async () => {
    const made = await mustCast(row, "calm");
    assert.ok(mustGo(made.carried).length, `${row.name} was cast at rest and laid nothing`);
    const out = await made.ctx.world.invoke("pass_time", { amount: minutes + 1, unit: "minutes" });
    assert.equal(out.ok, true, out.error);
    assert.deepEqual(left(made), [], `${minutes + 1} minutes after ${row.name} (${row.printed.text}) this is still on the table`);
  });

  if (rounds >= 100) {
    await check(row, "early", async () => {
      const made = await mustCast(row, "calm");
      const out = await made.ctx.world.invoke("pass_time", { amount: Math.floor(minutes / 2), unit: "minutes" });
      assert.equal(out.ok, true, out.error);
      const laid = mustGo(made.carried);
      assert.deepEqual(left(made, laid), laid, `${Math.floor(minutes / 2)} minutes into ${row.name} (${row.printed.text}) some of it is already gone`);
    });
  }

  if (rounds <= HOUR || rounds >= 8 * HOUR) {
    await check(row, "short rest", async () => {
      const made = await mustCast(row, "calm");
      const out = await made.ctx.world.invoke("take_rest", { kind: "short" });
      assert.equal(out.ok, true, out.error);
      const laid = mustGo(made.carried);
      if (rounds <= HOUR) {
        assert.deepEqual(left(made), [], `an hour's rest after ${row.name} (${row.printed.text}) and this is still on the table`);
      } else {
        assert.deepEqual(left(made, laid), laid, `an hour's rest took some of ${row.name} (${row.printed.text})`);
      }
    });
  }

  if (rounds < 8 * HOUR || rounds > 8 * HOUR) {
    await check(row, "long rest", async () => {
      const made = await mustCast(row, "calm");
      const out = await made.ctx.world.invoke("take_rest", { kind: "long" });
      assert.equal(out.ok, true, out.error);
      const laid = mustGo(made.carried);
      // Asleep, nobody concentrates: a night's rest ends a concentration
      // spell of any length.
      if (rounds < 8 * HOUR || row.printed.concentration) {
        assert.deepEqual(left(made), [], `a night's rest after ${row.name} (${row.printed.text}) and this is still on the table`);
      } else {
        assert.deepEqual(left(made, laid), laid, `eight hours' rest took some of ${row.name} (${row.printed.text})`);
      }
    });
  }
}

if (REPORT) {
  fs.writeFileSync(REPORT, report.map((line) => JSON.stringify(line)).join("\n"));
}
console.log(`sweep-lifecycle-clock: ${rows.length} of ${all.length} buff spells walked, ${Object.keys(SKIP).length} skipped with a reason, ${all.length - rows.length - Object.keys(SKIP).filter((name) => all.some((row) => row.name === name)).length} have no fixed time`);
harness.finish();
