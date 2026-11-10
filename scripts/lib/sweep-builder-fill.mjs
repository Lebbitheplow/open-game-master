// "Fill what's left" over every row the builder offers, saved through both
// doors (the builder sweep, package brief part 1).
//
// For a row (a class at a level, a subclass, a species, a background) the
// fill runs as the wizard runs it over the options the server offers this
// builder, and then:
//
//   gate      the builder's own save check passes (submit.ts validateBuilder)
//   library   POST /api/characters stores it
//   table     POST /api/campaigns/[id]/sheet stores it, at a table whose
//             starting level is the character's
//   repeats   the stored sheet holds no skill, tool or language twice
//   owed      the stored sheet owes no pick (src/lib/srd/owed-choices.ts): a
//             fill that leaves one unmade hands the player a character with
//             something still to choose after saying it filled what was left
//   again     a second fill finds nothing more to fill
//
// Import scripts/lib/enforce-world.mjs first (and set CONTENT_DB_PATH before
// that to run without the content pack).
import assert from "node:assert/strict";
import { openCreation } from "./enforce-creation.mjs";
import { doors, openSweepBuilder, repeats } from "./sweep-builder.mjs";

const src = (file) => import(new URL(`../../src/${file}`, import.meta.url).href);

export async function openFillSweep() {
  const { owedChoices } = await src("lib/srd/owed-choices.ts");
  const { subclassLevelFor } = await src("lib/srd/features.ts");

  // A lobby for each starting level asked, made when first needed.
  const tables = new Map();
  async function tableAt(level) {
    if (!tables.has(level)) {
      const creation = await openCreation({ campaign: { startingLevel: level } });
      const sb = await openSweepBuilder({ world: creation.world, user: creation.player, campaignId: creation.campaignId });
      tables.set(level, { creation, sb, door: doors({ creation }) });
    }
    return tables.get(level);
  }

  const libraryCreation = await openCreation();
  const library = await openSweepBuilder({ world: libraryCreation.world, user: libraryCreation.player });
  const libraryDoor = doors({ creation: libraryCreation });

  function checkStored(sheet, label) {
    const prof = sheet.proficiencies ?? {};
    for (const kind of ["skills", "tools", "languages", "expertise"]) {
      assert.deepEqual(repeats(prof[kind]), [], `${label}: the stored sheet holds ${kind} twice: ${JSON.stringify(prof[kind])}`);
    }
    const owed = owedChoices(sheet, { campaignId: sheet.campaignId ?? null });
    assert.deepEqual(owed, [], `${label}: the fill left picks owed: ${owed.join("; ")}`);
  }

  // One row: the start fields (level, classId and whatever the row is
  // about), filled and saved through both doors.
  async function fillAndSave(start, { table = true } = {}) {
    const { fields } = await library.fill(library.fresh(start));
    const built = library.derive(fields);
    assert.equal(built.blocker, null, `gate: after the fill the builder still refuses the save: ${JSON.stringify(built.blocker)}`);
    const again = await library.fill(fields);
    assert.deepEqual(again.filled, [], `again: a second fill found more to fill: ${JSON.stringify(again.filled)}`);
    const stored = await libraryDoor.library(built);
    assert.ok(stored.ok, `library: the server refused it (${stored.status}): ${stored.error}`);
    checkStored(stored.sheet, "library");
    if (table) {
      const at = await tableAt(fields.level);
      // The table's own builder: its options are the ones this table admits.
      const offered = ["raceId", "classId", "backgroundId"].every((slot) => {
        const list = slot === "raceId" ? at.sb.races : slot === "classId" ? at.sb.classes : at.sb.backgrounds;
        return list.some((entry) => entry.id === fields[slot]);
      });
      if (offered) {
        const seated = await at.door.table(built);
        assert.ok(seated.ok, `table: the server refused it (${seated.status}): ${seated.error}`);
        checkStored(seated.sheet, "table");
      }
    }
    return { fields, built, stored };
  }

  return { library, libraryCreation, fillAndSave, subclassLevelFor, close: () => libraryCreation.world.close() };
}
