// A sorcerer origin's own spell replaced at a level-up is offered in the
// level-up dialog (src/app/campaigns/[campaignId]/LevelUpDialog.tsx, through
// LevelUpChangePick), not only taken at the route. The offer and the route
// read one rule (src/lib/dm/ar-ws-origin-swap.ts): every pick the dialog
// offers is a request the route's spells step (src/lib/srd/level-up-spells.ts
// levelUpSpells) takes, recording that very swap, and every spell the
// bundled checklist knows that the route would take is offered. The library's
// level-up sheet saves a whole sheet, which cannot carry a swap record in
// (src/lib/srd/legality/features.ts), so the swap is the dialog's alone.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { originSwapOffer, originSwapRequest, bundledSwapSpells, swappableSpells } = await import("../src/lib/dm/ar-ws-origin-swap.ts");
const { swapsOf } = await import("../src/lib/dm/ar-ws-spell-swap-record.ts");
const { levelUpSpells } = await import("../src/lib/srd/level-up-spells.ts");
const { maxSpellLevelOf } = await import("../src/lib/srd/spell-prep.ts");
const { textKey } = await import("../src/lib/language/text-logic.ts");
const { levelUpChangeOffers } = await import("../src/lib/srd/level-up-changes.ts");

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const spells = bundledSwapSpells();
const byName = new Map(spells.map((spell) => [textKey(spell.name), spell]));
const spellOf = (name) => byName.get(textKey(name)) ?? null;
const abilities = { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 18 };

// A sorcerer of the origin at `level`, about to take the next.
function sorcerer(subclass, level, features = []) {
  return {
    classId: "sorcerer",
    ability: "cha",
    level,
    subclass,
    style: "known",
    known: ["Magic Missile", "Shield", "Chromatic Orb", "Misty Step", "Scorching Ray", "Fireball"].slice(0, level + 1),
    prepared: [],
    cantrips: ["Fire Bolt", "Light", "Prestidigitation", "Mage Hand", "Ray of Frost"],
    pending: [],
    spellbook: [],
    features,
  };
}

// The route's spells step for the next level, with the request the dialog sends.
function door(before, body) {
  return levelUpSpells({
    before,
    level: before.level + 1,
    subclass: before.subclass,
    list: "sorcerer",
    firstLevel: false,
    abilities,
    freeCantrips: 0,
    features: before.features,
    spellOf,
    picks: { kind: "picks", spells: body.levelUpSpells ?? [], forget: body.levelUpForget },
  });
}

// The dialog's offer, read as the dialog reads it.
function offerFor(before) {
  const after = { ...before, level: before.level + 1 };
  const held = [...before.known, ...before.cantrips];
  return originSwapOffer(after, { top: maxSpellLevelOf(after), held, candidates: spells, spellOf });
}

function recorded(result) {
  assert.ok(!("error" in result), `refused: ${result.error}`);
  return swapsOf(result.view.features ?? []);
}

const ORIGINS = [
  ["Divine Soul", 5, [{ name: "Divine Magic (Good)" }]],
  ["Aberrant Mind", 5, []],
  ["Clockwork Soul", 5, []],
];

for (const [origin, level, features] of ORIGINS) {
  test(`${origin}: every pick the dialog offers is a swap the route takes and records`, () => {
    const before = sorcerer(origin, level, features);
    const offer = offerFor(before);
    assert.ok(offer, `${origin} offers no swap`);
    assert.equal(offer.kind, "replace");
    const slots = swappableSpells({ ...before, level: level + 1 });
    assert.deepEqual(offer.froms, slots.map((slot) => slot.current).filter((name) => offer.optionsFor[name].length));
    assert.ok(offer.froms.length > 0);
    for (const from of offer.froms) {
      const original = slots.find((slot) => slot.current === from).original;
      assert.ok(offer.optionsFor[from].length > 0, `${from} has no replacement offered`);
      for (const to of offer.optionsFor[from]) {
        const swaps = recorded(door(before, originSwapRequest({ from, to }, [])));
        assert.deepEqual(swaps, [{ from: original, to }], `${from} > ${to}`);
      }
    }
  });

  test(`${origin}: every spell the route would take in the first spell's place is offered`, () => {
    const before = sorcerer(origin, level, features);
    const offer = offerFor(before);
    const from = offer.froms[0];
    const offered = new Set(offer.optionsFor[from].map(textKey));
    const held = new Set([...before.known, ...before.cantrips, ...offer.froms].map(textKey));
    for (const spell of spells) {
      if (held.has(textKey(spell.name)) || offered.has(textKey(spell.name))) {
        continue;
      }
      const result = door(before, originSwapRequest({ from, to: spell.name }, []));
      assert.ok("error" in result, `${spell.name} is taken in place of ${from} but not offered`);
    }
  });
}

test("the swap sent wins over another new spell that fits the same rule", () => {
  // Hold Person and Suggestion are both level 2 enchantments on the sorcerer
  // list: the route takes the first that fits, so the dialog sends the swap's first.
  const before = sorcerer("Aberrant Mind", 5);
  const offer = offerFor(before);
  assert.ok(offer.optionsFor["Calm Emotions"].includes("Suggestion"));
  assert.ok(offer.optionsFor["Calm Emotions"].includes("Hold Person"));
  const body = originSwapRequest({ from: "Calm Emotions", to: "Suggestion" }, ["Hold Person"]);
  assert.deepEqual(body, { levelUpForget: "Calm Emotions", levelUpSpells: ["Suggestion", "Hold Person"] });
  assert.deepEqual(recorded(door(before, body)), [{ from: "Calm Emotions", to: "Suggestion" }]);
});

test("a spell already held or already granted is never offered, and an origin without the rule offers nothing", () => {
  const before = sorcerer("Aberrant Mind", 5);
  const offer = offerFor(before);
  for (const from of offer.froms) {
    for (const name of [...before.known, ...before.cantrips, ...offer.froms]) {
      assert.ok(!offer.optionsFor[from].includes(name), `${name} offered for ${from}`);
    }
  }
  assert.equal(offerFor(sorcerer("Draconic Bloodline", 5)), null);
  assert.equal(offerFor(sorcerer("Wild Magic", 5)), null);
});

test("the dialog shows the pick only where the host takes it, and sends the swap in place of the spell known given up", () => {
  const dialog = read("src/app/campaigns/[campaignId]/LevelUpDialog.tsx");
  assert.match(dialog, /hostOffers\(capabilities, "originSpellSwap"\)/);
  assert.match(dialog, /originSwapOffer\(/);
  assert.match(dialog, /<LevelUpChangePick offer=\{originOffer\}/);
  assert.match(dialog, /originSent\s*\? originSwapRequest\(originSent, \[\.\.\.spellPicks, \.\.\.cantripPicks, \.\.\.anyChosen\]\)/);
  assert.match(read("src/lib/capabilities.ts"), /^\s*originSpellSwap: true,$/m);
  const pick = read("src/app/campaigns/[campaignId]/LevelUpChangePick.tsx");
  assert.match(pick, /optionsFor\?\.\[change\.from\]/);
  assert.match(pick, /min-h-10/);
});

// The level-up dialog's other change pick, Storm Aura's environment: the
// held one was shown as its key ("Keep desert") beside "Sea" and "Tundra".
test("a held choice the level may change is shown as its option is written", () => {
  const herald = { class: "barbarian", subclass: "Path of the Storm Herald", level: 4, classes: [], feats: [], conditions: [], features: [{ name: "Storm Aura (Desert)", source: "choice" }] };
  const [offer] = levelUpChangeOffers(herald, "barbarian", { classLevel: () => 5, cantrips: [] });
  assert.equal(offer?.kind, "choice", JSON.stringify(offer));
  assert.equal(offer.shown[offer.from], "Desert");
  assert.deepEqual(offer.options.map((name) => offer.shown[name]), ["Sea", "Tundra"]);
});

console.log(`${passed} origin swap offer checks passed.`);
