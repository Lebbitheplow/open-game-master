// The sheet's paperdoll (src/components/sheet/paperdoll-logic.ts): every
// carried row lands in the place the engines already give it, a place says
// what is worn there and what waits in the pack, a wand, staff or rod is in
// hand beside the weapons, and a row with no place on the body shares the
// one tile called Other. Pure, and reads only the bundled tables.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { DOLL_PLACE, DOLL_PLACES, dollPlaceOf, dollTileLabel, dollTileLine, dollTileNames, dollView } = await import("../src/components/sheet/paperdoll-logic.ts");
const { WEAR_SLOT_LIMITS } = await import("../src/lib/srd/wear-slots.ts");
const { WORN_PLACES } = await import("../src/lib/srd/worn-places.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}

const item = (name, more = {}) => ({ name, qty: 1, ...more });
const none = { armorName: null, shieldName: null };

test("every place a workshop author can pick, and every place with a limit, has a tile", () => {
  for (const place of WORN_PLACES) {
    assert.ok(dollPlaceOf(item("Thing", { gear: { wornOn: place } })), `${place} has a tile`);
  }
  const shown = new Set([...WORN_PLACES.map((place) => place), "armor", "shield"]);
  for (const slot of Object.keys(WEAR_SLOT_LIMITS)) {
    assert.ok(shown.has(slot), `${slot} is shown`);
  }
  assert.equal(new Set(DOLL_PLACES).size, DOLL_PLACES.length);
  for (const id of DOLL_PLACES) {
    assert.equal(DOLL_PLACE[id].id, id);
  }
});

test("each side of the figure reads from the head down", () => {
  for (const side of ["left", "right"]) {
    const heights = DOLL_PLACES.map((id) => DOLL_PLACE[id]).filter((place) => place.side === side).map((place) => place.at.y);
    assert.deepEqual(heights, [...heights].sort((a, b) => a - b), `${side}: ${heights.join(", ")}`);
    assert.equal(heights.length, 5, `${side} holds five places`);
  }
  assert.deepEqual(DOLL_PLACES.filter((id) => DOLL_PLACE[id].side === "below"), ["held", "shield", "other", "mount"]);
});

test("a row goes where the engines put it", () => {
  assert.equal(dollPlaceOf(item("Chain Mail")), "body");
  assert.equal(dollPlaceOf(item("Shield")), "shield");
  assert.equal(dollPlaceOf(item("Longsword")), "held");
  assert.equal(dollPlaceOf(item("Longbow")), "held");
  assert.equal(dollPlaceOf(item("Cloak of Protection")), "cloak");
  assert.equal(dollPlaceOf(item("Boots of Speed")), "feet");
  assert.equal(dollPlaceOf(item("Ring of Protection")), "ring");
  assert.equal(dollPlaceOf(item("Amulet of Health")), "neck");
  // A robe shares the body with a suit.
  assert.equal(dollPlaceOf(item("Robe of Eyes")), "body");
  // A magic suit is its suit, a named row in another language its srdName.
  assert.equal(dollPlaceOf(item("Cota de malha", { srdName: "Chain Mail" })), "body");
  // A rope has nowhere to be worn and nothing to press: no tile.
  assert.equal(dollPlaceOf(item("Rope")), null);
});

test("a wand, staff or rod is in hand beside the weapons, by its row's tags", () => {
  for (const name of ["Wand of Magic Missiles", "Staff of Healing", "Rod of Rulership"]) {
    assert.equal(dollPlaceOf(item(name)), "held", name);
  }
  // In another language, by the row its srdName names.
  assert.equal(dollPlaceOf(item("Varinha de mísseis mágicos", { srdName: "Wand of Magic Missiles" })), "held");
  // Unidentified, its name is the party's description: nothing shows through.
  assert.notEqual(dollPlaceOf(item("A carved stick", { srdName: "Wand of Magic Missiles", identified: false })), "held");
  // The place says the two-hands rule leaves a focus out.
  assert.match(DOLL_PLACE.held.rule, /does not stop a weapon being drawn/);
});

test("a saddle has its own place, on the mount: there unless it was packed", () => {
  for (const name of ["Saddle, Riding", "Saddle, Military", "Saddle, Exotic", "Saddle, Pack", "Saddlebags", "Bit and Bridle"]) {
    assert.equal(dollPlaceOf(item(name)), "mount", name);
  }
  assert.equal(dollPlaceOf(item("Feed (per day)")), null);
  // On a sheet that says what it wears, an unmarked saddle is still on the mount.
  const pack = [item("Chain Mail", { equipped: true }), item("Saddle, Riding"), item("Saddlebags", { equipped: false })];
  const tile = dollView(pack, { armorName: "Chain Mail", shieldName: null }).tiles.mount;
  assert.deepEqual(tile.fits.map((row) => row.name), ["Saddle, Riding", "Saddlebags"]);
  assert.deepEqual(tile.worn.map((row) => row.name), ["Saddle, Riding"]);
  assert.equal(dollTileLabel(tile), "On your mount: Saddle, Riding.");
  // No tack carried: nothing fits, and the tile is not drawn.
  assert.equal(dollView([item("Chain Mail")], none).tiles.mount.fits.length, 0);
});

test("what has a button and no place on the body shares the Other tile; what has neither has no tile", () => {
  for (const name of ["Crystal Ball", "Ioun Stone", "Pearl of Power"]) {
    assert.equal(dollPlaceOf(item(name)), "other", name);
  }
  for (const name of ["Figurine of Wondrous Power", "Arrow +1", "Bag of Holding"]) {
    assert.equal(dollPlaceOf(item(name)), null, name);
  }
  const pack = [item("Crystal Ball", { equipped: false }), item("Pearl of Power", { equipped: false, attuned: true }), item("Ioun Stone", { equipped: true }), item("Chain Mail", { equipped: true })];
  const tile = dollView(pack, { armorName: "Chain Mail", shieldName: null }).tiles.other;
  assert.deepEqual(tile.fits.map((row) => row.name), ["Crystal Ball", "Pearl of Power", "Ioun Stone"]);
  // In use: worn where it is worn, attuned where it is only attuned to.
  assert.deepEqual(tile.worn.map((row) => row.name), ["Pearl of Power", "Ioun Stone"]);
  assert.equal(dollTileLabel(tile), "Other items: Pearl of Power, attuned; Ioun Stone.");
  const idle = dollView([item("Crystal Ball", { equipped: false }), item("Chain Mail", { equipped: true })], none).tiles.other;
  assert.equal(dollTileLine(idle), "1 in the pack");
  // Nothing of the kind carried: the tile has nothing in it, and is not drawn.
  assert.equal(dollView([item("Chain Mail")], none).tiles.other.fits.length, 0);
});

test("a tile says what is worn there, what waits in the pack, or what goes there", () => {
  const pack = [
    item("Chain Mail", { equipped: true }),
    item("Cloak of Protection", { equipped: true, attuned: true }),
    item("Cloak of Elvenkind", { equipped: false }),
    item("Boots of Speed", { equipped: false }),
    item("Longsword", { equipped: true }),
    item("Longbow", { equipped: false }),
    item("Crystal Ball"),
    item("Rope"),
  ];
  const view = dollView(pack, { armorName: "Chain Mail", shieldName: null });
  assert.equal(view.unsaid, false);
  assert.deepEqual(view.tiles.cloak.fits.map((row) => row.name), ["Cloak of Protection", "Cloak of Elvenkind"]);
  assert.equal(dollTileLine(view.tiles.cloak), "Cloak of Protection");
  assert.equal(dollTileLabel(view.tiles.cloak), "Shoulders: Cloak of Protection, attuned.");
  assert.equal(dollTileLine(view.tiles.feet), "1 in the pack");
  assert.equal(dollTileLabel(view.tiles.feet), "Feet: empty. Boots or slippers. 1 in the pack.");
  assert.equal(dollTileLine(view.tiles.head), "A hat, helm or circlet");
  assert.equal(dollTileLabel(view.tiles.head), "Head: empty. A hat, helm or circlet.");
  assert.equal(dollTileLine(view.tiles.held), "Longsword");
  assert.deepEqual(view.tiles.held.fits.map((row) => row.name), ["Longsword", "Longbow"]);
  assert.equal(dollTileLine(view.tiles.body), "Chain Mail");
  // The orb keeps its attune toggle under Other; the rope has none anywhere.
  assert.deepEqual(view.tiles.other.fits.map((row) => row.name), ["Crystal Ball"]);
});

test("a second cloak worn is in its place, marked not in effect", () => {
  const pack = [item("Cloak of Protection", { equipped: true, attuned: true }), item("Cloak of Elvenkind", { equipped: true })];
  const tile = dollView(pack, none).tiles.cloak;
  assert.deepEqual(tile.worn.map((row) => row.name), ["Cloak of Protection", "Cloak of Elvenkind"]);
  assert.deepEqual(tile.idle.map((row) => row.name), ["Cloak of Elvenkind"]);
  assert.equal(dollTileLabel(tile), "Shoulders: Cloak of Protection, attuned; Cloak of Elvenkind, not in effect.");
  // The DM's exception stands beside the first and counts.
  const both = [pack[0], { ...pack[1], layered: true }];
  assert.deepEqual(dollView(both, none).tiles.cloak.idle, []);
});

test("of two suits worn, the one the armor class did not count is idle", () => {
  const pack = [item("Leather", { equipped: true }), item("Chain Mail", { equipped: true })];
  const tile = dollView(pack, { armorName: "Chain Mail", shieldName: null }).tiles.body;
  assert.deepEqual(tile.idle.map((row) => row.name), ["Leather"]);
});

test("a sheet that never said what it wears shows everything worn, and says so", () => {
  const pack = [item("Chain Mail"), item("Longsword"), item("Longbow"), item("Rope")];
  const view = dollView(pack, { armorName: "Chain Mail", shieldName: null });
  assert.equal(view.unsaid, true);
  assert.equal(dollTileLine(view.tiles.held), "Longsword, Longbow");
  // Nothing to wear, nothing to say.
  assert.equal(dollView([item("Rope")], none).unsaid, false);
});

test("ten rings worn take one tile: the first by name and a count, all ten in the open place", () => {
  const rings = Array.from({ length: 10 }, (_, index) => item(`Ring of Swimming (${index + 1})`, { equipped: true }));
  const tile = dollView([...rings, item("Ring of Protection", { equipped: false })], none).tiles.ring;
  assert.equal(tile.worn.length, 10);
  assert.equal(tile.idle.length, 0, "fingers have no limit beyond attunement");
  assert.equal(dollTileLine(tile), "Ring of Swimming (1) and 9 more");
  assert.equal(dollTileNames(tile).split(", ").length, 10);
  assert.equal(tile.fits.length, 11);
  // Two are still named whole.
  const two = dollView(rings.slice(0, 2), none).tiles.ring;
  assert.equal(dollTileLine(two), "Ring of Swimming (1), Ring of Swimming (2)");
});

console.log(`test-paperdoll-logic: ${passed} passed`);
