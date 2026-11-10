// Dread Lord (SRD 5.1 Oathbreaker): "an aura of gloom that lasts for 1
// minute. The aura reduces any bright light in a 30-foot radius around you to
// dim light", and "a melee spell attack against a creature in the aura".
// The gloom is a feature area that follows the paladin's token and only dims
// (bright to dim, never dark to dim, never lifting magical darkness), and the
// shadows' strike reaches 30 feet, on the engine's profile and on the Hand
// card alike. Each case failed before the fix. Pure: no database.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { ambientAt, magicalDarknessAt } = await import("../src/lib/battlemap/scene.ts");
const { layZone, withAnchors, zoneLights } = await import("../src/lib/battlemap/zones.ts");
const { zoneRowFor } = await import("../src/lib/battlemap/zones-spells.ts");
const { grantedAttackCards } = await import("../src/lib/battlemap/hand-granted.ts");
const { grantedAttackFor } = await import("../src/lib/srd/granted-attacks.ts");
const { FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
  passed += 1;
}

const W = 30;
const H = 30;
const MAP = { terrain: ".".repeat(W * H), width: W, height: H };

function gloomAt(at) {
  const row = zoneRowFor("Dread Lord");
  const zone = {
    id: "g1", spell: "Dread Lord", casterId: "pal", casterKind: "pc", casterName: "Paladin",
    origin: at, cells: layZone(row, { origin: at, slotLevel: null }, MAP).cells,
    concentration: false, castRound: 1, untilRound: 10, slotLevel: null, dc: null,
  };
  return zone;
}

test("the row is an aura of 30 feet that dims and ends with the condition", () => {
  const row = zoneRowFor("Dread Lord");
  assert.ok(row, "no area row for Dread Lord");
  assert.equal(row.shape, "aura");
  assert.equal(row.feet, 30);
  assert.equal(row.dims, true);
  assert.equal(row.whileCondition, "dread lord");
});

test("bright light 30 feet from the paladin is dim, 35 feet off it stays bright", () => {
  const patches = zoneLights([gloomAt({ x: 10, y: 10 })], W);
  assert.equal(ambientAt(patches, 10, 16, "bright"), "dim");
  assert.equal(ambientAt(patches, 10, 17, "bright"), "bright");
  assert.equal(ambientAt(patches, 16, 10, "bright"), "dim");
});

test("the gloom never lights the dark, and lifts no magical darkness", () => {
  const patches = zoneLights([gloomAt({ x: 10, y: 10 })], W);
  assert.equal(ambientAt(patches, 10, 12, "dark"), "dark");
  assert.equal(ambientAt(patches, 10, 12, "dim"), "dim");
  const darkness = { x0: 8, y0: 8, x1: 12, y1: 12, ambient: "dark", kind: "magical_darkness" };
  assert.equal(magicalDarknessAt([darkness, ...patches], 10, 10), true);
  assert.equal(ambientAt([darkness, ...patches], 10, 10, "bright"), "dark");
});

test("a round aura dims its own squares, not its bounding square's corners", () => {
  const zone = gloomAt({ x: 10, y: 10 });
  const patches = zoneLights([zone], W);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const inside = zone.cells.includes(y * W + x);
      assert.equal(ambientAt(patches, x, y, "bright"), inside ? "dim" : "bright", `(${x},${y})`);
    }
  }
});

test("the gloom follows the paladin's token", () => {
  const [moved] = withAnchors([gloomAt({ x: 10, y: 10 })], [{ refId: "pal", x: 20, y: 10 }], MAP);
  const patches = zoneLights([moved], W);
  assert.equal(ambientAt(patches, 10, 16, "bright"), "bright", "the old place stays dim");
  assert.equal(ambientAt(patches, 20, 16, "bright"), "dim", "the new place is not dim");
});

function paladin() {
  return {
    id: "pal", campaignId: "c1", userId: "u1", libraryCharacterId: null,
    name: "Mordrin", race: "human", class: "paladin", subclass: "Oathbreaker", background: "", alignment: "", gender: "",
    level: 20, xp: 0,
    abilities: { str: 18, dex: 10, con: 14, int: 10, wis: 12, cha: 20 },
    maxHp: 180, currentHp: 180, tempHp: 0, ac: 18, acOverride: false, speed: 30,
    hitDice: { die: "d10", total: 20, spent: 0 }, classes: [], hitDicePools: null,
    proficiencies: { saves: ["wis", "cha"], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: ["simple", "martial"] },
    equipment: [], gold: 0, copper: 0, feats: [], features: [], spellcasting: { ability: "cha", slots: {}, known: [], prepared: [] },
    conditions: ["dread lord"], conditionMeta: { "dread lord": { rounds: 10 } }, resources: {}, wildShape: null, pets: [], exhaustion: 0,
    deathSaves: null, concentratingOn: null, portrait: null, notes: "", backstory: "",
    isCompanion: false, companionKind: null, personality: "", createdAt: "", updatedAt: "",
  };
}

test("the shadows reach a creature anywhere in the aura, and the card says so", () => {
  const granted = grantedAttackFor(["dread lord"], "Dread Lord's Shadows", "");
  assert.equal(granted?.attack.reachFeet, 30);
  const card = grantedAttackCards(paladin(), FRESH_TURN).find((entry) => entry.name === "Dread Lord's Shadows");
  assert.ok(card, "no card for the shadows");
  assert.equal(card.range, "30 ft");
});

console.log(`test-dread-lord-gloom: ${passed} passed`);
