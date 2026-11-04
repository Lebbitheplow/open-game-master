// A counter reads as its name. The party roster printed the id, so a Psi
// Warrior read "Sub Psionic Energy 4/6" and an Echo Knight "Sub Shadow Martyr
// 1/1"; a Hand card paid from a shared pool printed the same id, spent or not.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { TRAINED } from "./lib/enforce-combat.mjs";
register("./lib/register-jsx.mjs", import.meta.url);

const { test, finish } = suite("test-counter-names");
const world = await openWorld({ campaign: { maxPlayers: 400 } });

const { resourceDef, resourceName } = await import("../src/lib/srd/class-resources.ts");
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { heldAuthored, gateHolds } = await import("../src/lib/srd/authored-effects.ts");
const { PartyPanel } = await import("../src/app/campaigns/[campaignId]/PartyPanel.tsx");

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/lib/srd/${name}`, import.meta.url), "utf8"));
const classFeatures = read("class-features.json").classes;
const subclasses = read("subclasses.json").classes;
const abilities = { str: 16, dex: 16, con: 14, int: 16, wis: 16, cha: 16 };

await test("A counter with a row reads as its name, and one without as its id's words.", () => {
  assert.equal(resourceName("sub_shadow_martyr"), "Shadow Martyr");
  assert.equal(resourceName("ki"), resourceDef("ki").displayName);
  assert.equal(resourceName("sub_no_such_counter"), "No such counter");
  assert.equal(resourceName("free_cast_cure_wounds"), "Cure Wounds (free cast)");
});

await test("The party roster's chips print a counter's name and uses, not its id.", () => {
  const hero = world.addHero({ name: "Echo" });
  const sheet = { ...world.sheet(hero.id), resources: { sub_shadow_martyr: { used: 0, max: 1 }, sub_no_such_counter: { used: 1, max: 3 } } };
  const party = renderToStaticMarkup(createElement(PartyPanel, {
    sheets: [sheet], meUserId: hero.userId, campaignId: world.campaignId, activeSheetId: hero.id,
  }));
  assert.ok(party.includes("Shadow Martyr 1/1"), "the named counter");
  assert.ok(party.includes("No such counter 2/3"), "the counter with no row");
  assert.ok(!/sub[ _](shadow|no)/i.test(party), "no prefix on either chip");
  // CSS capitalize would turn "Wrath of the Storm" into "Wrath Of The Storm".
  assert.ok(!/class="[^"]*capitalize[^"]*"[^>]*title="Limited-use/.test(party), "the chip keeps the name's own capitals");
});

// The dialog opens through a portal, which a static render leaves empty.
await test("The sheet names a counter through the same lookup as the roster.", () => {
  const source = fs.readFileSync(new URL("../src/app/campaigns/[campaignId]/CharacterSheetDialog.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("name={resourceName(id)}"));
});

await test("A card paid from a shared pool names the pool, ready or spent.", () => {
  let checked = 0;
  for (const classId of Object.keys(classFeatures)) {
    for (const subclass of [...classFeatures[classId].subclasses, ...(subclasses[classId] ?? [])]) {
      const hero = world.addHero({ user: world.owner, class: classId, subclass: subclass.name, level: 20, abilities, maxHp: 200, proficiencies: TRAINED });
      const sheet = world.sheet(hero.id);
      const spends = heldAuthored(sheet).flatMap((held) =>
        (held.entry.spends ?? []).filter((spend) =>
          spend.fight !== "out" && spend.does.kind !== "choose" && spend.action !== "reaction" && gateHolds(spend.gate, sheet, held)
          && spend.pool && sheet.resources[spend.pool.id] && !spend.pool.perUnit && !spend.pool.optional && (spend.pool.amount ?? 1) > 0
          && resourceDef(spend.pool.id)?.displayName !== spend.name));
      for (const spend of spends) {
        const name = resourceName(spend.pool.id);
        const label = `${classId}/${subclass.name}/${spend.name}`;
        const state = sheet.resources[spend.pool.id];
        const spent = { ...sheet, resources: { ...sheet.resources, [spend.pool.id]: { ...state, used: state.max } } };
        const ready = deriveHand(sheet, FRESH_TURN, {}).filter((card) => card.intent.card === "feature" && card.intent.resourceId === spend.name);
        for (const card of ready) {
          assert.ok(card.resource.startsWith(`${name} `), `${label}: ${card.resource}`);
          checked += 1;
        }
        for (const card of deriveHand(spent, FRESH_TURN, {}).filter((entry) => entry.intent.card === "feature" && entry.intent.resourceId === spend.name)) {
          assert.ok(card.disabled?.includes(name), `${label}: ${card.disabled}`);
          assert.ok(!/\bsub\b/i.test(card.disabled), `${label}: ${card.disabled}`);
        }
      }
    }
  }
  assert.ok(checked >= 5, `only ${checked} cards checked`);
});

// The engine's own words name the pool too: a refusal shown on a card, or to
// the GM, read "psionic energy" for Psionic Energy Dice.
await test("The engine names a pool by its name when it refuses a spend.", async () => {
  const hero = world.addHero({ user: world.owner, class: "fighter", subclass: "Psi Warrior", level: 7, abilities, maxHp: 80, proficiencies: TRAINED });
  const full = await world.invoke("use_resource", { characterId: hero.id, resource: "Psionic Recovery" });
  assert.equal(full.ok, false);
  assert.match(full.error, /Psionic Energy Dice is full/, full.error);
  const rest = { ...world.sheet(hero.id).resources };
  delete rest.sub_psionic_energy;
  world.patch(hero.id, { resources: rest });
  const none = await world.invoke("use_resource", { characterId: hero.id, resource: "Psionic Recovery" });
  assert.equal(none.ok, false);
  assert.match(none.error, /no Psionic Energy Dice to restore/, none.error);
});

world.close();
finish();
