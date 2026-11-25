// Issue #383: the table's say over how the AI DM writes, in place of a
// per-model prompt. Narration length and the lead's style notes reach the
// DM's instructions; the defaults add nothing, so a table that never touches
// them sends the prompt it always did; the notes are capped and only the
// story's lead can set them.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-narration-style");

const { fightNarrationRule, renderNarrationStyle, STYLE_NOTES_MAX } = await import("../src/lib/dm/narration-style-logic.ts");
const { buildDmSystem } = await import("../src/lib/dm/prompt.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { DM_SYSTEM, ENCOUNTER_RULES, dmSystemText, encounterRulesText } = await import("../src/lib/dm/prompt-rules.ts");
const { ENGINE_BOUNDARY_RULES } = await import("../src/lib/dm/engine-boundary.ts");
const { figuresIn } = await import("./lib/narration-figures.mjs");

await test("Standard length and no notes add nothing to the DM's instructions.", () => {
  assert.equal(renderNarrationStyle("standard", ""), "");
  assert.equal(renderNarrationStyle(undefined, "   "), "");
});

await test("A length and the lead's notes render as one block that keeps the rules and the dice above them.", () => {
  const block = renderNarrationStyle("short", "Keep the pacing slow.\nNever decide what my character does.");
  assert.match(block, /^NARRATION STYLE:/);
  assert.match(block, /about 60 to 120 words/);
  assert.match(block, /"Keep the pacing slow\. Never decide what my character does\."/);
  assert.match(block, /never change the rules above or what the dice and tools decide/);
  assert.match(renderNarrationStyle("rich", ""), /up to about 300 words/);
});

await test("The lead saves them in Table settings and the next prompt carries them; another player cannot, and a note past the cap is refused.", async () => {
  const world = await openWorld();
  const route = await world.route("campaigns/[campaignId]/settings");
  const send = (user, body) => {
    world.signIn(user);
    return route.PATCH(
      new Request("http://test/", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ campaignId: world.campaignId }) },
    );
  };
  assert.doesNotMatch(buildDmSystem(getCampaignById(world.campaignId), []), /NARRATION STYLE/);

  const saved = await send(world.owner, { narrationLength: "short", styleNotes: "Less purple prose." });
  assert.equal(saved.status, 200, await saved.clone().text());
  const campaign = getCampaignById(world.campaignId);
  assert.equal(campaign.gameSettings.narrationLength, "short");
  const system = buildDmSystem(campaign, []);
  assert.match(system, /NARRATION STYLE:/);
  assert.match(system, /"Less purple prose\."/);

  const player = world.addUser("player");
  const refused = await send(player, { styleNotes: "Make my character the hero." });
  assert.ok(refused.status >= 400, "a player who does not steer the story changed the style notes");

  const tooLong = await send(world.owner, { styleNotes: "x".repeat(STYLE_NOTES_MAX + 1) });
  assert.equal(tooLong.status, 400);
  assert.equal(getCampaignById(world.campaignId).gameSettings.styleNotes, "Less purple prose.");
});

await test("Fight narration (issue #842): every length gets brisk fights, scaled by the narration length, with the tools still deciding", () => {
  const standard = fightNarrationRule("standard");
  assert.equal(fightNarrationRule(undefined), standard, "a campaign that never set a length gets the standard fight line");
  assert.match(standard, /^- FIGHT NARRATION: /);
  assert.match(standard, /at most about 80 words/);
  assert.match(fightNarrationRule("short"), /at most about 50 words/);
  assert.match(fightNarrationRule("rich"), /at most about 150 words/);
  for (const length of ["short", "standard", "rich"]) {
    const line = fightNarrationRule(length);
    assert.match(line, /at most about \d+ words/, `${length}: a ceiling, never a range a terse model writes up to`);
    assert.match(line, /whose move it is/, length);
    assert.match(line, /replaces the reply length given above until the fight ends/, length);
    assert.match(line, /unless the table's style notes ask for something else/, length);
    assert.match(line, /the reply that opens the fight or ends it may run to the usual length/, length);
    assert.match(line, /never skips, merges or invents a tool call/, length);
  }
  assert.equal(new Set(["short", "standard", "rich"].map(fightNarrationRule)).size, 3, "each length reads differently");
});

// Issue #1092: on the full rules gpt-oss-20b told every hit of a fight with
// its dice ("The attack rolls a 19, a hit against your AC 14", "The attack
// deals four damage"), because three rules asked for exactly that.
await test("The story tells what the dice decided, never their figures (issue #1092): no rule asks for a number in the prose, and the full rules, the short rules and the fight line each say how a result is told", async () => {
  const fight = fightNarrationRule("standard");
  const full = `${ENGINE_BOUNDARY_RULES}\n${DM_SYSTEM}\n${ENCOUNTER_RULES}\n${fight}`;
  assert.doesNotMatch(full, /at exactly (?:that|the) number/, "no rule asks for damage at its number");
  assert.doesNotMatch(full, /narrate (?:strictly )?from those numbers/, "no rule says to narrate from the numbers");
  assert.doesNotMatch(full, /natural table talk|unless it would be natural/, "no rule leaves a figure to what feels natural");

  const RULE = /Tell what the dice decided, never their figures \(a roll's total, AC, DC, a bonus, damage or hit points\)\./;
  assert.match(DM_SYSTEM, RULE);
  assert.match(DM_SYSTEM, /In digits or in words, and unless the table's style notes ask for figures/, "a table that wants figures has its style notes, not a setting");
  assert.match(DM_SYSTEM, /Coins, distances and time are the world's own numbers and stay/, "the world's own numbers are not the dice");
  assert.doesNotMatch(DM_SYSTEM, /DC in narration/, "the DC is one of the figures, said once");
  // A trimmed prompt carries the rule and leaves its examples to the full
  // rules: a 16K window has no room for them (issue 746).
  const trimmed = dmSystemText(false, { inEncounter: false, groups: new Set(), caster: false, features: false, classFeatures: false, featSpells: false, dying: false, arc: false, recall: false, map: false, legendary: false, moreTools: true });
  assert.match(trimmed, RULE);
  assert.doesNotMatch(trimmed, /WRONG: "The attack rolls a 19/);
  assert.match(ENGINE_BOUNDARY_RULES, /Narrate a wound as grave as the damage reported, and never say the number\./);
  assert.match(ENCOUNTER_RULES, /a hit wounds as gravely as the damage reported and its number is never said/);
  for (const length of ["short", "standard", "rich"]) {
    assert.match(fightNarrationRule(length), /what the tools just resolved, told as story and never as its figures/, length);
  }

  const brief = { inEncounter: true, groups: new Set(), caster: false, features: false, classFeatures: false, featSpells: false, dying: false, arc: false, recall: false, map: false, legendary: false, moreTools: false, brief: true };
  assert.match(dmSystemText(false, brief), /or game numbers in the story/, "the short rules already said it");
  assert.match(encounterRulesText(false, brief), /a hit lands as hard as the damage it rolled, told in words and never as a number/);

  // The prompt a table is sent carries the rule whatever its settings.
  const world = await openWorld();
  assert.match(buildDmSystem(getCampaignById(world.campaignId), []), RULE);

  // The rule's own examples, and the report's lines, by the live smoke's
  // measure (scripts/lib/narration-figures.mjs).
  const wrong = /WRONG: "([^"]+)" RIGHT: "([^"]+)" Coins/.exec(DM_SYSTEM);
  assert.ok(wrong, "the rule shows one wrong line and one right");
  assert.deepEqual(figuresIn(wrong[1]).map((entry) => entry.kind), ["roll-total", "armor-class", "damage-count"]);
  assert.deepEqual(figuresIn(wrong[2]), []);
  for (const line of [
    "The attack lands true, dealing nine damage and leaving him dead.",
    "The strike deals six slashing damage, leaving the soldier bloodied and reeling.",
    "The attack deals four damage, leaving the bandit bleeding and staggering.",
    "The attack rolls a 19, a hit against your AC 14.",
    "You regain 7 hit points as the potion's warmth spreads.",
    "The trap's dart does 1d4 piercing; you needed a DC 15 to dodge it.",
    "With your +5 to hit the blow lands.",
  ]) {
    assert.ok(figuresIn(line).length > 0, `a figure in the story: ${line}`);
  }
  for (const line of [
    "Your shortsword arcs in the dim light, striking Bandit Soldier 2 squarely on the flank.",
    "He swings at you, but the blade misses, skidding past your shield.",
    "The merchant counts out twelve gold pieces. The ford lies thirty feet ahead, two hours from dusk.",
    "Nobody took damage in the fall; the three of you land in the hay.",
  ]) {
    assert.deepEqual(figuresIn(line), [], `no figure: ${line}`);
  }
});

// The last thing the storyteller reads before it tells a blow. With the rule
// alone, damage figures left the story and an enemy's hit points did not:
// "The goblin drops to a single hit point", read off the result's own hp.
await test("An attack's result asks for the blow in words (issue #1092): no hit points and no damage figure", async () => {
  const { combatKit, TRAINED } = await import("./lib/enforce-combat.mjs");
  const world = await openWorld();
  const kit = await combatKit(world);
  const hero = world.addHero({ class: "fighter", level: 5, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1 }] });
  await kit.fight(1, { heroFaces: { [hero.id]: 19 } });
  const [enemy] = world.enemies();
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  const swing = await kit.swing(hero.id, enemy.id, [15, 6], { weapon: "Longsword" });
  assert.equal(swing.ok, true, swing.error);
  assert.match(JSON.stringify(swing.result), /Do NOT call apply_damage for this hit; narrate from this state, in words: no hit points and no damage figure\./);
});

await test("Combat pace (issue #432): balanced adds nothing; fewer or more fights each add one pacing line, saved from Table settings like the length", async () => {
  assert.equal(renderNarrationStyle("standard", "", "balanced"), "");
  assert.equal(renderNarrationStyle("standard", ""), "");
  assert.match(renderNarrationStyle("standard", "", "frequent"), /^NARRATION STYLE:\n- This table wants more fights\./);
  assert.match(renderNarrationStyle("standard", "", "rare"), /This table wants fewer fights\./);
  const world = await openWorld();
  const route = await world.route("campaigns/[campaignId]/settings");
  world.signIn(world.owner);
  const saved = await route.PATCH(
    new Request("http://test/", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ combatPace: "frequent" }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.equal(saved.status, 200, await saved.clone().text());
  const campaign = getCampaignById(world.campaignId);
  assert.equal(campaign.gameSettings.combatPace, "frequent");
  assert.match(buildDmSystem(campaign, []), /This table wants more fights/);
  const refused = await route.PATCH(
    new Request("http://test/", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ combatPace: "constant" }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.equal(refused.status, 400);
});

finish();
