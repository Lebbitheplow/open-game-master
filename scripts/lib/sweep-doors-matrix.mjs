// The blocking matrix's runner: every row (a way to act) in every state that
// bars it, through every door, on one staged table put back between cells.
//
// A cell holds when the door REFUSES and the database is as it was. It is a
// finding when the door answers ok, or refuses after writing something. The
// refusal's family (src/lib/dm/tool-errors.ts: retry for a mistake in the
// call, refused "rules" for the game saying no) is a second, smaller check
// under the same cell id with ":family" after it.
//
// Before any state is laid, each row is run as it stands (the control): a
// row that cannot be played on a clear table proves nothing by being refused
// in a barred one, so it must answer ok there or carry a written reason in
// SKIP, and a SKIP whose row has started to work fails the suite.
import assert from "node:assert/strict";
import fs from "node:fs";
import { answer } from "./sweep-doors.mjs";

// ALLOWED: cells a written ruling lets through (the console's free hand on a
// mount, the GM settling a fallen friend's trades). Each must still go
// through, so a change that starts refusing one is noticed, and each names
// the ruling it rests on (`ruling`) and may check what it wrote (`check`).
export async function runMatrix({ api, db, rows, states, doors, stageFor, actorOf, KNOWN, SKIP, ALLOWED = {}, label }) {
  const { test, gap } = api;
  const cells = [];
  const counts = { rows: 0, cells: 0, skipped: 0, notApplicable: 0 };
  const used = new Set();
  const usedSkips = new Set();

  async function arrange(stage, row, state, door) {
    db.restore(stage.base);
    await row.prelude?.(stage.t);
    const actorId = actorOf(row, stage.t);
    await state?.apply(stage.t, actorId, row);
    await row.trigger?.(stage.t);
    return door.prepare ? door.prepare(stage.t, actorId) : null;
  }

  for (const row of rows) {
    counts.rows += 1;
    if (!row.args) {
      usedSkips.add(row.id);
      await test(`${label} ${row.id}: an option with no builder has a written reason`, () => {
        assert.ok(SKIP[row.id], `${row.id} is an option the catalog offers and the matrix has no arguments for: give it a builder in scripts/lib/sweep-doors-rows.mjs or a reason in SKIP`);
      });
      counts.skipped += 1;
      continue;
    }
    // The control.
    const main = await stageFor("main", row);
    const playable = new Set();
    for (const door of doors) {
      await arrange(main, row, null, door);
      const out = await door.call(main.t, row.tool, row.args(main.t));
      cells.push(`${row.id} | control | ${door.id} | ${answer(out)}`);
      const skipId = SKIP[`${row.id}|${door.id}`] ? `${row.id}|${door.id}` : row.id;
      if (SKIP[skipId]) {
        usedSkips.add(skipId);
        await test(`${label} ${row.id} (${door.id}): still cannot be played on a clear table, as SKIP says`, () => {
          assert.equal(out.ok, false, `${row.id} now plays through the ${door.id} door: take it out of SKIP so its states are checked`);
        });
        counts.skipped += 1;
      } else {
        await test(`${label} ${row.id} (${door.id}): plays on a clear table`, () => {
          assert.equal(out.ok, true, `the control was refused, so no state can be judged: ${answer(out)}`);
        });
        if (out.ok) {
          playable.add(door.id);
        }
      }
    }
    for (const state of states) {
      const why = state.bars(row);
      if (!why) {
        counts.notApplicable += 1;
        continue;
      }
      const stage = await stageFor(state.stage ?? "main", row);
      for (const door of doors.filter((candidate) => playable.has(candidate.id))) {
        const id = `${row.id}|${state.id}|${door.id}`;
        counts.cells += 1;
        let out = null;
        let wrote = [];
        const run = async () => {
          await arrange(stage, row, state, door);
          const before = db.snapshot();
          stage.t.world.diceLog();
          out = await door.call(stage.t, row.tool, row.args(stage.t));
          const d20s = stage.t.world.diceLog().filter((die) => die.sides === 20).length;
          wrote = db.changed(before);
          cells.push(`${id} | ${answer(out)}${wrote.length ? ` | WROTE ${wrote.join("; ")}` : ""}`);
          // A tool that takes a list of characters may answer for the barred
          // one instead of refusing the whole call: it rolled nothing for
          // them and counted them out (row.countsOut).
          if (out.ok && row.countsOut?.(out.result, stage.t, d20s)) {
            return;
          }
          assert.equal(out.ok, false, `${row.tool} went through for an actor who is ${state.words}: ${answer(out)}`);
          assert.deepEqual(wrote, [], `${row.tool} was refused (${answer(out)}) and still wrote`);
        };
        const allowed = ALLOWED[id];
        if (allowed) {
          used.add(id);
          await test(`${label} ${id}: goes through, as ${allowed.ruling} rules`, async () => {
            await arrange(stage, row, state, door);
            const before = db.snapshot();
            out = await door.call(stage.t, row.tool, row.args(stage.t));
            wrote = db.changed(before);
            cells.push(`${id} | ${answer(out)} | ALLOWED`);
            assert.equal(out.ok, true, `${row.tool} was refused for an actor who is ${state.words}, though ${allowed.ruling} lets it through: ${answer(out)}`);
            allowed.check?.(wrote, out);
          });
          continue;
        }
        const known = KNOWN[id];
        if (known) {
          used.add(id);
          await gap(id, { rule: state.rule, where: known.where, severity: known.severity, note: known.note }, run);
        } else {
          await test(`${label} ${id}`, run);
        }
        // The family, where the door did refuse.
        if (out && !out.ok && state.family) {
          const familyId = `${id}:family`;
          const got = out.retry ? "retry" : out.refused ? `refused:${out.refused}` : "none";
          const family = row.kind === "pass" && state.passFamily ? state.passFamily : state.family;
          const check = () => assert.ok(family.includes(got), `${row.tool} refused an actor who is ${state.words} as ${got}, not ${family.join(" or ")}: ${answer(out)}`);
          if (KNOWN[familyId]) {
            used.add(familyId);
            await gap(familyId, { rule: FAMILY_RULE, where: KNOWN[familyId].where, severity: KNOWN[familyId].severity, note: KNOWN[familyId].note }, check);
          } else {
            await test(`${label} ${familyId}`, check);
          }
        }
      }
    }
  }
  await test(`${label}: every KNOWN and SKIP entry names a cell or a row the matrix has`, () => {
    assert.deepEqual(Object.keys(ALLOWED).filter((id) => !ALLOWED[id].ruling), [], "ALLOWED entries name the ruling they rest on");
    assert.deepEqual(Object.keys(ALLOWED).filter((id) => KNOWN[id]), [], "a cell is ALLOWED or KNOWN, not both");
    const stale = [...Object.keys(KNOWN), ...Object.keys(ALLOWED)].filter((id) => !used.has(id));
    assert.deepEqual(stale, [], "KNOWN or ALLOWED entries no cell matched");
    const staleSkips = Object.keys(SKIP).filter((id) => !usedSkips.has(id));
    assert.deepEqual(staleSkips, [], "SKIP entries no row matched");
  });
  if (process.env.ODM_SWEEP_CELLS) {
    fs.appendFileSync(process.env.ODM_SWEEP_CELLS, `${cells.join("\n")}\n`);
  }
  console.log(`${label}: ${counts.rows} rows, ${counts.cells} cells run, ${counts.skipped} rows or row-doors skipped with a reason, ${counts.notApplicable} row-state pairs the state does not bar`);
  return counts;
}

export const FAMILY_RULE =
  "A rules refusal is the game saying no (not their turn, the character's state): refused \"rules\"; a retry is a mistake in the call (src/lib/dm/tool-errors.ts).";

// KNOWN entries for a list of cell ids that share one cause.
export function known(ids, meta) {
  return Object.fromEntries(ids.map((id) => [id, meta]));
}
