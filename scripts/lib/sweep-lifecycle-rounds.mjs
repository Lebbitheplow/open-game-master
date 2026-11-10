// The body of the two rounds suites (scripts/test-enforce-sweep-lifecycle-
// rounds.mjs for spells laid on a hero, -rounds-foes.mjs for spells cast at
// a foe): split in two so each stays under the suites' time.
//
// Import scripts/lib/enforce-world.mjs before this file.
import assert from "node:assert/strict";
import fs from "node:fs";
import { suite } from "./enforce-harness.mjs";
import { carriedState, left, mustCast, mustGo, runner, spellRows, strays, walkRounds } from "./sweep-lifecycle-spells.mjs";

const DURATION = (row) => `${row.text?.source}: "Duration: ${row.printed?.text}"`;
const RULES = { lasts: DURATION, ends: DURATION, "fight end": DURATION };

export async function runRounds({ name, part, SKIP, SUBSKIP, KNOWN }) {
  const harness = suite(`test-enforce-${name}`);
  const REPORT = process.env.SWEEP_REPORT ?? null;
  const report = [];
  const check = runner({ name, harness, known: KNOWN, rules: RULES, report: REPORT ? report : null });
  const rows = spellRows().filter(
    (row) => (part === "buffs") === (row.kind === "buff") && !SKIP[row.name] && (row.printed?.rounds === 1 || row.printed?.rounds === 10),
  );
  const conditions = (carried) => mustGo(carried).filter((entry) => / has /.test(entry));

  for (const row of rows) {
    const minute = row.printed.rounds === 10;
    const each = async (checkName, fn) => {
      if (!SUBSKIP[`${row.name}/${checkName}`]) {
        await check(row, checkName, fn);
      }
    };

    if (minute) {
      await each("lasts", async () => {
        const made = await mustCast(row);
        const laid = conditions(made.carried).filter((entry) => {
          // Only what the engine itself gave the full minute: a condition tied
          // to a turn or ended by damage has its own, shorter life in the text.
          const condition = entry.split(" has ")[1];
          const holder = [...made.ctx.world.sheets(), ...made.ctx.world.enemies()].find((one) => (one.conditionMeta ?? {})[condition]);
          const meta = holder?.conditionMeta?.[condition] ?? {};
          return !meta.untilTurnOf && !meta.untilTurnEndOf && !meta.endsOnDamage;
        });
        walkRounds(made, 8);
        assert.equal(made.ctx.world.encounter().round, 9, "setup: the ninth round");
        assert.deepEqual(left(made, laid), laid, `in its ninth round ${row.name} has already lost some of what it laid`);
      });
    }

    await each("ends", async () => {
      const made = await mustCast(row);
      walkRounds(made, row.printed.rounds + 1);
      assert.deepEqual(
        [...left(made), ...strays(made, row)],
        [],
        `${row.printed.rounds + 1} rounds after a spell of ${row.printed.text}, this of ${row.name} is still on the table (round ${made.ctx.world.encounter().round})`,
      );
    });

    const onHero = (made) => mustGo(made.carried).filter((entry) => /^(Kara|Mira) /.test(entry));
    await each("fight end", async () => {
      const made = await mustCast(row);
      // A round, so an area has caught the fighter beside the foe.
      walkRounds(made, 1);
      const ended = await made.ctx.world.invoke("end_encounter", { outcome: "victory" });
      assert.equal(ended.ok, true, ended.error);
      const waited = await made.ctx.world.invoke("pass_time", { amount: 5, unit: "minutes" });
      assert.equal(waited.ok, true, waited.error);
      const now = carriedState(made.ctx);
      assert.deepEqual(
        [...onHero(made).filter((entry) => now.has(entry)), ...strays(made, row)],
        [],
        `the fight ended and five minutes passed, and this of ${row.name} (${row.printed.text}) is still on a hero`,
      );
    });
  }

  if (REPORT) {
    fs.writeFileSync(REPORT, report.map((line) => JSON.stringify(line)).join("\n"));
  }
  console.log(`${name}: ${rows.length} spells of a round or a minute walked, ${Object.keys(SKIP).length} skipped with a reason, ${Object.keys(SUBSKIP).length} single checks skipped with a reason`);
  harness.finish();
}
