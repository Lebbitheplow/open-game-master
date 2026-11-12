// Lifecycle sweep, part 5: two holders of one thing.
//
// SRD 5.1, Combining Magical Effects: "The effects of the same spell cast
// multiple times don't combine ... Instead, the most potent effect ... from
// those castings applies while their durations overlap." Each casting keeps
// its own caster and its own life: ending one leaves the other.
//
// The table is every spell cast at a foe that holds concentration
// (scripts/lib/sweep-lifecycle-spells.mjs). Two wizards cast it on the same
// foe, each on her own turn, and then:
//
//   both      each concentrates on her own casting, and the foe has what the
//             spell lays;
//   first     the first caster is stunned: her concentration ends, the
//             second's does not, and the foe still has all of it;
//   second    the second is stunned too: nothing of the spell is left.
//
// A mark kept once per creature or per spell name, instead of per caster,
// fails "first" (the Hold Person of #docs/dnd-rules-audit R2, Instinctive
// Charm's bar in #803, Draconic Presence in #837 were this shape).
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster } from "./lib/enforce-spell-kit.mjs";
import { stage } from "./lib/sweep-lifecycle-stage.mjs";
import { castAtFoe, spellRows, strays } from "./lib/sweep-lifecycle-spells.mjs";

const { test, gap, finish } = suite("test-enforce-sweep-lifecycle-multi");

const RULE =
  "SRD 5.1, Combining Magical Effects: \"The effects of the same spell cast multiple times don't combine\"; Concentration: \"If you lose concentration, such a spell ends\" (that caster's casting, and no other's)";

// A row not walked, and why.
const SKIP = {
  Earthquake: "both casters stand in the quake and every save is a 1: each loses her own concentration by the spell's text",
  "Storm of Vengeance": "a 360-foot storm over both casters (as Earthquake)",
  Banishment: "the first casting takes the foe off the board: the second has nothing to target",
  Maze: "as Banishment",
  "Otiluke's Resilient Sphere": "the first casting encloses the foe: nothing reaches it for the second",
  "Sleet Storm": "lays only prone, which no spell's ending takes back (a creature knocked down stands up itself)",
};

// Known today, by spell.
const KNOWN = {};

const TYPE = { "Dominate Beast": "beast" };
const rows = spellRows().filter((row) => row.kind === "condition" && row.printed?.concentration && row.mech.resolution !== "attack");
let walked = 0;

for (const row of rows) {
  if (SKIP[row.name]) {
    continue;
  }
  walked += 1;
  const run = async () => {
    const wizard = (name) => ({ name, maxHp: 80, ...caster("wizard", "int", [row.name], [], 17) });
    const ctx = await stage("fight", { heroes: [wizard("Ansa"), wizard("Mira")] });
    const { world, kit, hero: first, mage: second, e1 } = ctx;
    kit.setEnemy(e1.id, { maxHp: 900, currentHp: 900, stats: { type: TYPE[row.name] ?? "humanoid" } });
    kit.place(e1.id, 12, 5);
    kit.place(ctx.e2.id, 12, 12);
    // A touch spell is cast from beside the foe; the rest from 25 feet.
    const touch = row.range?.kind === "touch";
    kit.place(first.id, touch ? 11 : 7, 5);
    kit.place(second.id, touch ? 13 : 7, touch ? 5 : 6);
    for (const sheet of [first, second]) {
      const out = await castAtFoe(ctx, sheet, row);
      if (!out.ok) {
        throw new Error(`${sheet.name}'s ${row.name} was refused, so the row was not walked: ${out.error}`);
      }
    }
    const spell = world.sheet(first.id).concentratingOn;
    assert.ok(spell, `after casting, ${first.name} does not concentrate`);
    assert.equal(world.sheet(second.id).concentratingOn, spell, `after her own casting ${second.name} does not concentrate`);
    const made = { ctx };
    const laid = strays(made, row).filter((entry) => entry.startsWith(e1.displayName));
    assert.ok(laid.length, `two castings of ${row.name} laid nothing on the foe`);
    const names = new Set(laid.map((entry) => entry.split(" (laid by")[0]));

    const stunned = await world.invoke("set_condition", { characterId: first.id, condition: "stunned", rounds: 2 });
    assert.equal(stunned.ok, true, stunned.error);
    assert.equal(world.sheet(first.id).concentratingOn, null, "setup: the first caster's concentration ended");
    assert.equal(world.sheet(second.id).concentratingOn, spell, `the first caster's concentration ended and took the second's ${row.name} with it`);
    const still = new Set(strays(made, row).filter((entry) => entry.startsWith(e1.displayName)).map((entry) => entry.split(" (laid by")[0]));
    assert.deepEqual([...still].sort(), [...names].sort(), `the first caster's ${row.name} ended; the second still concentrates, and the foe has lost some of it`);

    const again = await world.invoke("set_condition", { characterId: second.id, condition: "stunned", rounds: 2 });
    assert.equal(again.ok, true, again.error);
    assert.deepEqual(strays(made, row), [], `both castings of ${row.name} have ended, and this is left`);
  };
  const known = KNOWN[row.name];
  if (known) {
    await gap(`sweep-lifecycle-multi:${row.name}`, { rule: RULE, where: known.where, severity: known.severity, note: known.note }, run);
  } else {
    await test(row.name, run);
  }
}

console.log(`sweep-lifecycle-multi: ${walked} of ${rows.length} concentration spells cast at a foe walked with two casters, ${Object.keys(SKIP).length} skipped with a reason`);
finish();
