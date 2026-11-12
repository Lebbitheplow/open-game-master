// What the species trait probe suites share
// (scripts/test-enforce-sweep-clauses-species-traits*.mjs): a plain human to
// stand beside a lineage, a walk through the move route a player's own drag
// uses, and the run of a lineage's spells cast by nature.
import assert from "node:assert/strict";

// deepEqual whose failure says what was found, so a broken clause reads in
// one line of a run.
export function same(actual, expected, message) {
  assert.deepEqual(actual, expected, `${message}: found ${JSON.stringify(actual)}`);
}

export const plain = (build = {}) => ({ class: "fighter", level: 5, race: "human", equipment: [], ...build });

let moveRoute = null;
// The player's own move on the board, as the app sends it.
export async function walkTo(t, who, x, y) {
  moveRoute ??= await t.world.route("campaigns/[campaignId]/battle-map/move");
  t.world.signIn({ id: t.sheet(who).userId });
  const response = await moveRoute.POST(
    new Request(`http://odm.test/api/campaigns/${t.world.campaignId}/battle-map/move`, { method: "POST", body: JSON.stringify({ x, y }) }),
    { params: Promise.resolve({ campaignId: t.world.campaignId }) },
  );
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

// Spells answered as a reaction to a trigger, which a bare cast cannot stage:
// their counter is read, their cast is another suite's
// (scripts/test-enforce-species-spell-uses.mjs).
const REACTIONS = new Set(["Hellish Rebuke"]);

// A lineage's innateSpells row, through a fighter with no spell slots: at 1st
// level the cantrip is cast at will and no levelled spell is held; at the
// level each levelled spell arrives its counter stands at one use, the cast
// spends it at the level the row names, and a second cast is refused until
// the rest the row names.
export async function castsByNature(rig, row, { rest = "long" } = {}) {
  const t = await rig.table();
  const kit = [{ name: "Component pouch", qty: 1 }];
  const cast = (who, spell) => t.invoke("use_spell_slot", { characterId: who.id, spell });
  const young = t.hero({ class: "fighter", level: 1, race: row.id, equipment: kit });
  const seen = {};
  const want = {};
  for (const spell of row.innateSpells.spells) {
    const levelled = Boolean(spell.per ?? spell.rest ?? spell.uses);
    const counter = `racial_${rest === "short" ? "short_" : ""}${spell.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    if (!levelled) {
      const first = await cast(young, spell.name);
      const second = await cast(young, spell.name);
      seen[spell.name] = [first.ok, second.ok];
      want[spell.name] = [true, true];
      assert.equal(first.ok, true, `${row.name}: ${spell.name} at will: ${first.error}`);
      continue;
    }
    const early = spell.level > 1 ? await cast(young, spell.name) : { ok: false };
    const who = t.hero({ class: "fighter", level: spell.level, race: row.id, equipment: kit });
    const held = t.sheet(who).resources?.[counter] ?? null;
    if (REACTIONS.has(spell.name)) {
      seen[spell.name] = [early.ok, held];
      want[spell.name] = [false, { max: 1, used: 0 }];
      continue;
    }
    const first = await cast(who, spell.name);
    const second = await cast(who, spell.name);
    const back = (await t.rest(rest)).ok ? t.used(who, counter) : "no rest";
    seen[spell.name] = [early.ok, held, first.ok ? first.result?.slotLevel ?? "cast" : first.error, t.sheet(who).resources?.[counter]?.max, second.ok, back];
    want[spell.name] = [false, { max: 1, used: 0 }, spell.castAt ?? seen[spell.name][2], 1, false, 0];
    assert.equal(first.ok, true, `${row.name}: ${spell.name} by nature: ${first.error}`);
  }
  assert.deepEqual(seen, want, `${row.name}: the spells of ${row.innateSpells.trait} cast with no slot`);
}
