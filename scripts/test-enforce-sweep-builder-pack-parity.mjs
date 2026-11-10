// Builder sweep, part 1: what the builder offers without the content pack it
// still offers with it.
//
// Without the pack the builder lists the bundled classes, species and
// backgrounds (useBuilderOptions.ts). With it the lists are rebuilt from the
// pack's rows, and anything bundled that the pack has no row for has to be
// added back: packClassOptions adds the settings' own classes, the archetype
// picker adds the bundled subclasses. A row is one bundled option, and the
// question is whether a player on a server with the pack can still pick it.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { hasPack } from "./lib/enforce-world.mjs";
import { openCreation } from "./lib/enforce-creation.mjs";
import { expand, sweepRows } from "./lib/sweep-builder-rows.mjs";
import { key, openSweepBuilder } from "./lib/sweep-builder.mjs";
import * as known from "./lib/sweep-builder-known.mjs";

const rows = sweepRows("test-enforce-sweep-builder-pack-parity", { KNOWN: hasPack ? expand(known.KNOWN_PACK_PARITY ?? []) : {}, SKIP: {} });
const creation = await openCreation();
const sb = await openSweepBuilder({ world: creation.world, user: creation.player });
const options = await import("../src/lib/characters/options.ts");
const { srdRaceFor } = await import("../src/lib/content/race-options.ts");
const { subclassNamesFor } = await import("../src/lib/srd/features.ts");

if (!hasPack) {
  console.log("test-enforce-sweep-builder-pack-parity: no content pack on this machine; the bundled lists are the builder's lists");
} else {
  const classIds = new Set(sb.classes.map((entry) => entry.id));
  for (const klass of options.srdClassOptions()) {
    await rows.row(`pack-parity:class:${klass.id}`, async () => {
      assert.ok(classIds.has(klass.id), `with the pack the builder's classes leave out the bundled ${klass.name}: ${[...classIds].slice(0, 14).join(", ")}...`);
    });
    // Its subclasses, where the class itself is still listed.
    if (classIds.has(klass.id)) {
      const listed = new Set((await sb.subclassesOf(klass.id)).map((entry) => key(entry.name)));
      for (const subclass of subclassNamesFor(klass.id)) {
        await rows.row(`pack-parity:subclass:${klass.id}/${subclass}`, async () => {
          assert.ok(listed.has(key(subclass)), `with the pack the ${klass.name}'s subclasses leave out ${subclass}`);
        });
      }
    }
  }
  // A pack species answers for the bundled one it is the same race as.
  const covered = new Set(sb.races.flatMap((entry) => [entry.id, srdRaceFor(entry.id)?.id]).filter(Boolean));
  for (const race of options.srdRaceOptions()) {
    await rows.row(`pack-parity:species:${race.id}`, async () => {
      assert.ok(covered.has(race.id), `with the pack the builder's species leave out the bundled ${race.name}`);
    });
  }
  const backgroundIds = new Set(sb.backgrounds.map((entry) => entry.id));
  for (const background of options.srdBackgroundOptions()) {
    await rows.row(`pack-parity:background:${background.id}`, async () => {
      assert.ok(backgroundIds.has(background.id), `with the pack the builder's backgrounds leave out the bundled ${background.name}`);
    });
  }
}

creation.world.close();
rows.finish();
