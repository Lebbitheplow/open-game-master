// Builder sweep, part 2: the spells the spell step offers a class are the
// spells the server takes for it, spell by spell.
//
// The step's list is /api/content/spells?class=<list> (src/components/sheet/
// useSpellPool.ts); the server judges a spell by name through spellFactsFor
// (src/lib/characters/catalog.ts) and spellOnListKey (src/lib/classes/
// class-spell-list.ts), at creation, at a level-up, at learn_spell and at the
// sheet's prepare. For every list a class casts from, both ways:
//
//   offered => taken   every spell the search lists for the class resolves, by
//                      its name, to a spell on that class's list at the level
//                      the search showed
//   taken => offered   every spell the server holds on the list (among all the
//                      spells any list was offered) is in the class's search
//
// One row a list, with the pack; test-enforce-sweep-builder-spell-offer-nopack
// runs the bundled checklist.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { openCreation } from "./lib/enforce-creation.mjs";
import { expand, sweepRows } from "./lib/sweep-builder-rows.mjs";
import { key, openSweepBuilder } from "./lib/sweep-builder.mjs";
import * as known from "./lib/sweep-builder-known-levelup.mjs";

const prefix = process.env.CONTENT_DB_PATH === "/nonexistent" ? "nopack-spell-offer" : "spell-offer";
const rows = sweepRows(`test-enforce-sweep-builder-${prefix}`, {
  KNOWN: expand((prefix === "spell-offer" ? known.KNOWN_SPELL_OFFER : known.KNOWN_SPELL_OFFER_NOPACK) ?? []),
  SKIP: {},
});
const creation = await openCreation();
const sb = await openSweepBuilder({ world: creation.world, user: creation.player });
const { spellFactsFor } = await import("../src/lib/characters/catalog.ts");
const { spellOnListKey } = await import("../src/lib/classes/class-spell-list.ts");

// The list each class the builder offers searches by, as the builder derives
// it (useBuilderDerived spellSearchClass) for a level 20 character.
const lists = new Set();
for (const klass of sb.classes) {
  const { derived } = sb.derive(sb.fresh({ level: 20, classId: klass.id, raceId: sb.races[0].id, backgroundId: sb.backgrounds[0].id }));
  if (derived.casts && derived.spellSearchClass) lists.add(derived.spellSearchClass);
}

const pools = new Map();
for (const list of lists) pools.set(list, await sb.spellPool(list, 9));
const universe = new Map();
for (const pool of pools.values()) for (const spell of pool) universe.set(key(spell.name), spell);

for (const list of [...lists].sort()) {
  const pool = pools.get(list);
  await rows.row(`${prefix}:${list}:offered-is-taken`, async () => {
    assert.ok(pool.length > 0, `the search offers the ${list} no spells at all`);
    const strays = [];
    for (const spell of pool) {
      const facts = spellFactsFor(spell.name, []);
      if (!facts) strays.push(`${spell.name} (no such spell to the server)`);
      else if (!spellOnListKey(list, facts)) strays.push(`${spell.name} (the server's lists: ${facts.classes.join(", ") || "none"})`);
      else if (facts.level !== spell.level) strays.push(`${spell.name} (offered at level ${spell.level}, judged at ${facts.level})`);
    }
    assert.ok(!strays.length, `${strays.length} of ${pool.length} spells the search offers a ${list} are refused by the server: ${strays.slice(0, 12).join("; ")}`);
  });
  await rows.row(`${prefix}:${list}:taken-is-offered`, async () => {
    const offered = new Set(pool.map((spell) => key(spell.name)));
    const missing = [];
    for (const spell of universe.values()) {
      const facts = spellFactsFor(spell.name, []);
      if (facts && spellOnListKey(list, facts) && !offered.has(key(spell.name))) missing.push(spell.name);
    }
    assert.ok(!missing.length, `${missing.length} spells the server takes for a ${list} are missing from its search: ${missing.slice(0, 12).join("; ")}`);
  });
}

creation.world.close();
rows.finish();
