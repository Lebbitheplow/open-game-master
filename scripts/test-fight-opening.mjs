// A prepared fight's opening options (src/lib/dm/fight-opening.ts): what
// run_prepared_encounter and the GM's Deploy hand start_encounter. WAVE1
// ruling R9: "run_prepared_encounter takes scene, lair and from when the
// template has none of its own". Before, the ground, lair and edge asked were
// dropped, and the Deploy route read no body at all.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-fight-opening");

const templates = await import("../src/lib/db/encounter-templates.ts");
const { preparedOpening, openingOptionsSchema, openingOptionsFrom } = await import("../src/lib/dm/fight-opening.ts");

const world = await openWorld({ campaign: { maxPlayers: 4, startingLevel: 3 }, gameSettings: { ttsEnabled: false } });
const ROSTER = [{ monster: "goblin", count: 2 }];
const make = (scene) => templates.insertEncounterTemplate({
  campaignId: world.campaignId, name: `Gate ${scene ?? "bare"}`, enemies: ROSTER, battlefield: "", notes: "Two goblins hold the gate.",
  map: { mapId: null, seed: null, theme: null, ambient: null, width: null, height: null, scene }, createdByUserId: world.owner.id,
});

await test("a fight with no ground of its own takes the ground, lair and edge asked", () => {
  const { args } = preparedOpening(make(null), ROSTER, openingOptionsFrom({ scene: "cave", lair: true, from: "behind", surprised: "enemies" }));
  assert.equal(args.scene, "cave");
  assert.equal(args.lair, true);
  assert.equal(args.from, "behind");
  assert.equal(args.surprised, "enemies");
});

await test("a fight's own ground is its word", () => {
  const { args } = preparedOpening(make("forest"), ROSTER, { scene: "cave" });
  assert.equal(args.scene, "forest");
});

await test("the Deploy body is read with the same shapes, and a bad one is refused", () => {
  assert.equal(openingOptionsSchema.safeParse({ absent: ["kara"], surprised: "party", distanceFeet: 30, cue: false }).success, true);
  assert.equal(openingOptionsSchema.safeParse({ surprised: "everyone" }).success, false);
  assert.equal(openingOptionsSchema.safeParse({ building: { enemySide: "up" } }).success, false);
});

world.close();
finish();
