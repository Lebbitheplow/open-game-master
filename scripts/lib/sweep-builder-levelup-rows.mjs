// The rows of the level-up sweep: every class the builder offers, and every
// subclass of each, grown from level 1 to 20 through the real level-up and
// set beside the same character made at 20
// (scripts/lib/sweep-builder-levelup.mjs says what a row is held to).
import assert from "node:assert/strict";
import { assertClean, assertOffered, twinDifferences } from "./sweep-builder-levelup.mjs";
import { openCreation } from "./enforce-creation.mjs";
import { doors } from "./sweep-builder.mjs";

const src = (file) => import(new URL(`../../src/${file}`, import.meta.url).href);

export async function levelRows(rows, sweep, { prefix = "levelup", part = null, parts = 1 } = {}) {
  // The twin is seated too, at a table that starts at 20: a library
  // character carries no counters, a seated one does.
  const twinTable = doors({ creation: await openCreation({ campaign: { startingLevel: 20 } }) });
  const { subclassLevelFor } = await src("lib/srd/features.ts");
  let index = 0;
  for (const klass of sweep.sb.classes) {
    const subclasses = (await sweep.sb.subclassesOf(klass.id)).map((row) => row.name);
    for (const subclass of subclasses.length ? subclasses : [""]) {
      index += 1;
      if (part !== null && index % parts !== part) continue;
      const name = `${klass.id}${subclass ? `/${subclass}` : ""}`;
      let walked = null;
      await rows.row(`${prefix}:${name}`, async () => {
        // A class that chooses at 1st level (a cleric's domain) is made
        // with it; every other takes it from the level-up's own offer.
        const atFirst = subclass && (subclassLevelFor(klass.id) ?? 3) <= 1;
        const seated = await sweep.seat({ level: 1, classId: klass.id, ...(atFirst ? { subclass } : {}) });
        const walk = await sweep.climb({ subclass: subclass || undefined });
        walked = walk;
        assertClean(walk, "1 to 20");
        // The same character made at 20 by the builder's fill.
        const { fields } = await sweep.sb.fill(
          sweep.sb.fresh({ level: 20, classId: klass.id, subclass, raceId: seated.fields.raceId, backgroundId: seated.fields.backgroundId }),
        );
        const built = sweep.sb.derive(fields);
        assert.equal(built.blocker, null, `twin: the builder refuses the level 20 twin: ${JSON.stringify(built.blocker)}`);
        const made = await twinTable.table(built);
        assert.ok(made.ok, `twin: the table refused the level 20 twin: ${made.error}`);
        const differences = twinDifferences(walk.sheet, made.sheet);
        assert.ok(!differences.length, `twin: grown to 20 and made at 20 differ in what the class gives: ${differences.join(" | ")}`);
      });
      // Only for a walk that reached 20: a class the offer cannot read at
      // all has said so in the row above.
      if (walked) {
        await rows.row(`${prefix}-offer:${name}`, async () => assertOffered(walked, "1 to 20"));
      }
    }
  }
}
