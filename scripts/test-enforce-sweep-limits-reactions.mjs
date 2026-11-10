// The named leftovers of the week's reaction and feature-card pull requests
// (#765 to #800), one row each: /tmp/odm-gapstudy/limits.md is the list, and
// each row quotes the limit as the pull request's body worded it. A row is run,
// through more than the one door its own fix was tested at where a door is
// cheap to add. The reach, own-turn, trigger and stunned limits are walked for
// the whole authored table in test-enforce-sweep-limits-reach.mjs.
import assert from "node:assert/strict";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { limitsSuite } from "./lib/sweep-limits.mjs";
import { authoredText, everySubclass, limitsTable } from "./lib/sweep-limits-world.mjs";

const KNOWN = {
  "787-thirty-feet-to-the-drake": {
    where: "src/lib/dm/pet-tools.ts summon_pet (a pet is a row on the owner's sheet, with no token) and src/lib/dm/authored-reactions.ts resist_instance rangeFt",
    severity: "low",
    note: "\"while you are within 30 feet of each other\" cannot be asked: the drake stands nowhere.",
  },
};
const RULING = {
  "774-spell-damage": "the feature's own words (src/lib/srd/subclasses.json: \"an attacker who wounded someone near you\") and the published feature (\"deals damage with an attack\") both answer an attack; pull request #774 listed it as a limit, and it is the rule",
};
const SKIP = {
  "791-unpicked-card-sends-first": "the first option is chosen by the Hand's picker in the browser (the card's intent carries no variant until a chip is pressed, and the engine asks for one: \"Tides of Chaos needs a variant\"); only the browser harness can press a card without picking.",
  "787-typed-reaction": "needs a live model: the limit is how often a real GM model calls use_reaction for typed words (30 of 30 in the body's own run); no suite can hold that.",
};

const { row, finish } = limitsSuite("test-enforce-sweep-limits-reactions", { KNOWN, RULING, SKIP });
const world = await openWorld({ campaign: { maxPlayers: 400 } });
const table = await limitsTable(world);
const { kit } = table;
const TEXT = authoredText();
const text = (key) => `"${TEXT.get(key)?.text ?? "?"}" (src/lib/srd/subclasses.json, ${key})`;

const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { directCardCall, directCardCalls } = await import("../src/lib/dm/intent-logic.ts");
const { resourceDef } = await import("../src/lib/srd/class-resources.ts");
const { groupHand } = await import("../src/lib/battlemap/hand-groups.ts");
const { splitHand } = await import("../src/lib/battlemap/hand-layout.ts");
const { handTargets } = await import("../src/app/campaigns/[campaignId]/handTargets.ts");
const { previewRows } = await import("../src/lib/battlemap/hand-play.ts");
const { featureAdvantage } = await import("../src/lib/battlemap/hand-edge.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { recordFall, snapshotVitals } = await import("../src/lib/dm/last-hit.ts");
const { authoredRows } = await import("../src/lib/srd/authored-effects.ts");

const friend = table.hero({ class: "fighter", subclass: "Champion" });
const show = (out) => (out.ok ? JSON.stringify(out.result).slice(0, 240) : String(out.error));
const react = async (who, args, faces = [10, 10, 10, 10, 10, 10]) => {
  world.clearDice();
  world.dice(...faces);
  const out = await world.invoke("use_reaction", { characterId: who.id, ...args });
  world.clearDice();
  return out;
};
const modelReacts = (who, feature, args = {}) =>
  invokeEngine(world.campaign(), { kind: "ai", turnId: createDmTurn(world.campaignId, [], "ai").id }, { name: "use_reaction", args: { characterId: who.id, feature, ...args } });
const beside = (who, enemy) => {
  kit.place(who.id, 5, 2);
  kit.place(friend.id, 4, 2);
  kit.place(enemy.id, 5, 3);
};

// ---- #765 ----

await row("765-arcane-jolt-card", {
  pr: 765,
  limit: "Arcane Jolt still can't be played from its card: it needs a heal-or-burn pick and a target to match, which the card can't post yet.",
  rule: text("artificer::Arcane Jolt"),
}, async () => {
  const smith = table.hero({ class: "artificer", subclass: "Battle Smith", equipment: [{ name: "Longsword +1", qty: 1, equipped: true }] });
  for (const variant of ["burn", "heal"]) {
    const [enemy] = await table.stage([smith, friend], { first: smith });
    beside(smith, enemy);
    world.patch(friend.id, { currentHp: 20 });
    world.dice(18, 4);
    const struck = await world.invoke("pc_attack", { characterId: smith.id, targetEnemyId: enemy.id, weapon: "Longsword +1" });
    world.clearDice();
    assert.equal(struck.ok, true, struck.error);
    const card = deriveHand(world.sheet(smith.id), { ...FRESH_TURN, actionUsed: true, marks: [`weapon-hit:${enemy.id}`] }, {})
      .find((entry) => entry.intent.card === "feature" && entry.intent.resourceId === "Arcane Jolt" && entry.intent.variant === variant);
    assert.ok(card && !card.disabled, `${variant}: ${card ? card.disabled : "no card"}`);
    const call = directCardCall({ ...card.intent, targetId: variant === "burn" ? enemy.id : friend.id, targetKind: variant === "burn" ? "enemy" : "ally" }, smith.id, { inFight: true });
    world.dice(4, 4, 4, 4);
    const out = await world.invoke(call.name, call.args);
    world.clearDice();
    assert.equal(out.ok, true, `${variant}: ${out.error}`);
    if (variant === "burn") assert.ok(kit.enemy(enemy.id).currentHp < 300 - 8, "the creature takes the jolt on top of the sword");
    else assert.ok(world.sheet(friend.id).currentHp > 20, "the ally heals");
  }
});

// Every subclass at level 20, for the rows that hold a property of the sheet.
// They sit at a table of their own: 118 more tokens on this one's board would
// stand beside everybody (a shot at disadvantage, a reach never empty).
const shelf = await openWorld({ campaign: { maxPlayers: 400 } });
const shelfTable = await limitsTable(shelf);
const builds = everySubclass().map((entry) => ({ ...entry, sheet: shelf.sheet(shelfTable.hero({ user: shelf.owner, class: entry.classId, subclass: entry.subclass }).id) }));

await row("765-two-counters-one-name", {
  pr: 765,
  limit: "Eldritch Cannon has two counters of the same name (sub_eldritch_cannon and art_eldritch_cannon). The card and the spend use the first, so the second can no longer be spent by id.",
  rule: "One feature, one counter: use_resource answers a counter by its display name (src/lib/srd/class-resources.ts resourceDef).",
}, () => {
  const doubled = [];
  for (const build of builds) {
    const names = new Map();
    for (const id of Object.keys(build.sheet.resources ?? {})) {
      const name = resourceDef(id)?.displayName ?? id;
      names.set(name, [...(names.get(name) ?? []), id]);
    }
    for (const [name, ids] of names) {
      if (ids.length > 1) doubled.push(`${build.classId}/${build.subclass}: ${name} = ${ids.join(" + ")}`);
    }
  }
  assert.equal(builds.length >= 100, true, `${builds.length} subclasses built`);
  assert.deepEqual(doubled, []);
});

await row("765-capstone-behind-more", {
  pr: 765,
  limit: "Card order: these cards are now dealt later, so on a default layout a level 20 paladin's capstone sits behind More until the player seats it.",
  rule: "A level 20 capstone is the feature a level 20 character plays: the default fan of six holds it (src/lib/battlemap/hand-layout.ts splitHand).",
}, () => {
  let checked = 0;
  for (const build of builds.filter((entry) => entry.classId === "paladin")) {
    const capstone = [...TEXT.entries()].find(([, value]) => value.subclass === build.subclass && value.level === 20);
    if (!capstone) continue;
    const name = capstone[0].split("::")[1];
    const hand = deriveHand(build.sheet, FRESH_TURN, {});
    if (!hand.some((card) => card.name === name)) continue;
    const { fan } = splitHand(groupHand(hand, build.sheet).units, 6);
    assert.ok(fan.some((unit) => unit.name === name), `${build.subclass}: ${name} is behind More in ${JSON.stringify(fan.map((unit) => unit.name))}`);
    checked += 1;
  }
  assert.ok(checked >= 5, `only ${checked} paladin capstones are cards`);
});

// ---- #771 ----

const HOLDS = [
  { name: "Undying Sentinel", build: { class: "paladin", subclass: "Oath of the Ancients" }, faces: [1], flag: "undyingSentinel" },
  { name: "Relentless Endurance", build: { class: "fighter", subclass: "Champion", race: "half-orc" }, faces: [1], flag: "relentlessEndurance", resources: { relentless_endurance: { max: 1, used: 0 } } },
  { name: "Death Ward", build: { class: "fighter", subclass: "Champion" }, faces: [1], flag: "deathWard", conditions: ["death ward"] },
  { name: "Relentless Rage", build: { class: "barbarian", subclass: "Path of the Berserker" }, faces: [20, 1], flag: "relentlessRage", conditions: ["raging"] },
  { name: "Blazing Revival", build: { class: "druid", subclass: "Circle of Wildfire" }, faces: [1], flag: "blazingRevival", conditions: ["wildfire spirit"] },
  { name: "Strength of the Grave", build: { class: "sorcerer", subclass: "Shadow Magic" }, faces: [20, 1], flag: "strengthOfTheGrave" },
];
for (const hold of HOLDS) {
  const who = table.hero(hold.build);
  for (const door of ["apply_damage", "enemy_attack"]) {
    await row(`771-held-at-1-concentration:${hold.name}:${door}`, {
      pr: 771,
      limit: "A hero held at 1 hit point skips the concentration save, because the hold returns before it. Relentless Endurance and Death Ward take the same early exit.",
      rule: "SRD 5.1, Concentration: \"Whenever you take damage while you are concentrating on a spell, you must make a Constitution saving throw to maintain your concentration.\"",
    }, async () => {
      const [enemy] = await table.stage([who, friend]);
      beside(who, enemy);
      const sheet = world.sheet(who.id);
      // Raging halves the club; 1 hit point falls to any blow.
      world.patch(who.id, {
        currentHp: door === "apply_damage" ? 5 : 1, concentratingOn: "Bless",
        conditions: hold.conditions ?? [], conditionMeta: Object.fromEntries((hold.conditions ?? []).map((name) => [name, { rounds: 100 }])),
        resources: { ...sheet.resources, ...(hold.resources ?? {}) },
      });
      world.clearDice();
      let out;
      if (door === "apply_damage") {
        world.dice(...hold.faces);
        // Strength of the Grave saves against 5 + the damage: a blow it can meet.
        out = await world.invoke("apply_damage", { characterId: who.id, amount: hold.flag === "strengthOfTheGrave" ? 6 : 30, type: "slashing" });
      } else {
        kit.freshRound();
        world.dice(16, 4, ...hold.faces);
        out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: who.id });
      }
      world.clearDice();
      assert.equal(out.ok, true, out.error);
      const now = world.sheet(who.id);
      assert.ok(now.currentHp >= 1, `${hold.name} did not hold: ${show(out)}`);
      assert.equal(now.concentratingOn, null, `held up by ${hold.name}, the spell stands with no save lost: ${show(out)}`);
    });
  }
}

// ---- #772 ----

const avenger = table.hero({ class: "paladin", subclass: "Oath of Vengeance" });
const vow = (enemy) => world.invoke("use_resource", { characterId: avenger.id, resource: "channel_divinity", variant: "vow of enmity", targetEnemyId: enemy.id });
const vowed = () => world.sheet(avenger.id).conditions.includes("vow of enmity");

await row("772-preview-advantage", {
  pr: 772,
  limit: "The Hand's hit-odds preview doesn't show the advantage, though the roll has it. The preview misses other subclass advantage sources in the same way (Assassinate, say).",
  rule: text("paladin::Channel Divinity: Vow of Enmity"),
}, async () => {
  const [near, other] = await table.stage([avenger, friend], { count: 2, first: avenger });
  beside(avenger, near);
  kit.place(other.id, 6, 3);
  assert.equal((await vow(near)).ok, true);
  const view = activePublicEncounter(world.campaignId, { enemyNumbers: false });
  const chips = handTargets(view.enemies, world.sheets(), avenger.id, undefined, view.sides, view);
  const card = deriveHand(world.sheet(avenger.id), FRESH_TURN, {}).find((entry) => entry.intent.card === "attack");
  const toHit = (id) => previewRows(card, chips.find((entry) => entry.id === id)).find((entry) => entry.key === "To hit").value;
  assert.match(toHit(near.id), /advantage/);
  assert.doesNotMatch(toHit(other.id), /advantage/);
  const assassin = table.hero({ class: "rogue", subclass: "Assassin" });
  assert.deepEqual(featureAdvantage(world.sheet(assassin.id), { id: "e1" }, { round: 1, orderReady: true, order: [{ kind: "pc", id: assassin.id }, { kind: "enemy", id: "e1" }] }), ["Assassinate"]);
});

// The vow "ends early when its creature falls": every way a creature leaves.
const FALLS = {
  "the paladin's own kill": async (enemy) => {
    kit.setEnemy(enemy.id, { currentHp: 1 });
    kit.freshTurn();
    await kit.swing(avenger.id, enemy.id, [2, 15, 4, 4, 4, 4, 4]);
  },
  "an ally's kill": async (enemy) => {
    kit.setEnemy(enemy.id, { currentHp: 1 });
    kit.giveTurn(friend.id);
    const out = await kit.swing(friend.id, enemy.id, [15, 4, 4, 4, 4]);
    assert.equal(out.ok, true, out.error);
  },
  "a spell's area": async (enemy) => {
    kit.setEnemy(enemy.id, { currentHp: 1 });
    world.dice(1, 6, 6, 6, 6);
    const out = await world.invoke("aoe_damage", { damage: "4d6", type: "fire", saveAbility: "dex", dc: 15, enemyIds: [enemy.id], halfOnSave: true, reason: "a burst of flame from a trap" });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
  },
  "the GM's own damage": async (enemy) => {
    kit.setEnemy(enemy.id, { currentHp: 1 });
    const out = await world.invoke("apply_damage", { enemyId: enemy.id, amount: 50, type: "bludgeoning", reason: "the ceiling comes down" });
    assert.equal(out.ok, true, out.error);
  },
  "knocked unconscious": async (enemy) => {
    const out = await world.invoke("set_enemy_condition", { enemyId: enemy.id, condition: "unconscious" });
    assert.equal(out.ok, true, out.error);
  },
};
for (const [door, fall] of Object.entries(FALLS)) {
  await row(`772-vow-outlives-its-creature:${door}`, {
    pr: 772,
    limit: "The vow doesn't end early when its creature falls. The condition can stay on the sheet until its rounds run out, and a creature healed within the minute still gives advantage.",
    rule: text("paladin::Channel Divinity: Vow of Enmity"),
  }, async () => {
    const [near, other] = await table.stage([avenger, friend], { count: 2, first: avenger });
    beside(avenger, near);
    kit.place(other.id, 6, 3);
    assert.equal((await vow(near)).ok, true, "the vow");
    await fall(near);
    const now = kit.enemy(near.id);
    assert.ok(now.status !== "alive" || now.currentHp === 0 || now.conditions.includes("unconscious"), `the creature did not fall: ${now.status} ${now.currentHp}`);
    assert.equal(vowed(), false, `the vow is still on the paladin after its creature fell (${now.status}, ${now.currentHp} hit points)`);
  });
}

// ---- #773, #774 ----

const glory = table.hero({ class: "paladin", subclass: "Oath of Glory" });
// Maintainer ruling R6 (/tmp/odm-gapstudy/WAVE1.md): "Glorious Defense's attack
// is the paladin's choice ('lets you'): the card offers the attack by default
// and a 'no attack' choice."
await row("773-attack-not-optional", {
  pr: 773,
  limit: "The attack isn't optional, though the rules say \"lets you\".",
  rule: text("paladin::Glorious Defense"),
}, async () => {
  const [enemy] = await table.stage([glory, friend]);
  beside(glory, enemy);
  await table.strike(enemy, glory, [10, 4]);
  const [card] = table.offered(glory, "Glorious Defense");
  assert.ok(card, "the hit deals Glorious Defense's card");
  assert.deepEqual(card.choice?.options.map((option) => option.value), ["attack", "no attack"], "the card asks whether the miss is followed by an attack, the attack first");
  const out = await react(glory, { feature: "Glorious Defense" }, [15, 4, 4, 4]);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(glory.id).currentHp, 50, "the hit became a miss");
  assert.ok(out.result.attack?.hit !== undefined || out.result.attack?.ok, `with nothing said the miss is answered by the attack: ${show(out)}`);
  // Declined: the miss stands and no attack is rolled.
  const [again] = await table.stage([glory, friend]);
  beside(glory, again);
  await table.strike(again, glory, [10, 4]);
  const before = kit.enemy(again.id).currentHp;
  const declined = await react(glory, { feature: "Glorious Defense", variant: "no attack" }, [15, 4, 4, 4]);
  assert.equal(declined.ok, true, declined.error);
  assert.equal(world.sheet(glory.id).currentHp, 50, "the hit became a miss");
  assert.equal(kit.enemy(again.id).currentHp, before, "no attack was made");
  assert.match(String(declined.result.attack), /lets the attack pass/);
});

const redeemer = table.hero({ class: "paladin", subclass: "Oath of Redemption" });
await row("774-damage-before-resistance", {
  pr: 774,
  limit: "The damage sent back is what the hit rolled, before the ally's resistance or temporary hit points.",
  rule: text("paladin::Channel Divinity: Rebuke the Violent"),
}, async () => {
  const brute = table.hero({ class: "barbarian", subclass: "Path of the Berserker" });
  const [enemy] = await table.stage([redeemer, brute]);
  kit.place(redeemer.id, 5, 2);
  kit.place(brute.id, 7, 2);
  kit.place(enemy.id, 8, 2);
  world.patch(brute.id, { conditions: ["raging"], conditionMeta: { raging: { rounds: 10 } } });
  await table.strike(enemy, brute, [18, 4]);
  assert.equal(world.sheet(brute.id).currentHp, 47, "the rage halves the club's 6");
  const out = await react(redeemer, { feature: "Rebuke the Violent", targetCharacterId: brute.id }, [2]);
  assert.equal(out.ok, true, out.error);
  assert.equal(300 - kit.enemy(enemy.id).currentHp, 3, "what the ally took goes back, not what the dice showed");
});

await row("774-spell-damage", {
  pr: 774,
  limit: "It covers attack hits only, not spell or other damage to the ally.",
  rule: text("paladin::Channel Divinity: Rebuke the Violent"),
}, async () => {
  const [enemy] = await table.stage([redeemer, friend]);
  kit.place(redeemer.id, 5, 2);
  kit.place(friend.id, 7, 2);
  kit.place(enemy.id, 8, 2);
  // The creature's spell: a save for half, no attack roll.
  kit.freshRound();
  world.dice(2, 4, 4);
  const cast = await world.invoke("cast_at_player", { characterId: friend.id, casterEnemyId: enemy.id, saveAbility: "dex", dc: 15, damage: "2d4", damageType: "fire" });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(world.sheet(friend.id).currentHp < 50, "the spell hurt the ally");
  const before = table.ledger(redeemer);
  const out = await react(redeemer, { feature: "Rebuke the Violent", targetCharacterId: friend.id, targetEnemyId: enemy.id }, [2]);
  assert.equal(out.ok, false, "a spell's damage was answered as an attack's");
  assert.equal(table.ledger(redeemer), before, "the refusal spent something");
});

await row("774-text-says-near", {
  pr: 774,
  limit: "The 30 feet comes from the published feature; the rules line in subclasses.json says \"near you\".",
  rule: text("paladin::Channel Divinity: Rebuke the Violent"),
}, () => {
  const row = authoredRows().find((entry) => entry.key === "paladin::Channel Divinity: Rebuke the Violent");
  const reach = row.entry.reactions[0].does.rangeFt;
  assert.match(TEXT.get(row.key).text, new RegExp(`${reach} feet`), `the engine keeps ${reach} feet and the feature's words do not say so`);
});

// ---- #776 ----

const watcher = table.hero({ class: "paladin", subclass: "Oath of the Watchers" });
const forceSave = async (enemy, target, ability, face) => {
  kit.freshRound();
  world.clearDice();
  world.dice(face, 1);
  const out = await world.invoke("cast_at_player", { characterId: target.id, casterEnemyId: enemy.id, saveAbility: ability, dc: 12, damage: "1d4" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
};
await row("776-no-card", {
  pr: 776,
  limit: "Players have no card for now. At a person-run table the player has to ask the GM.",
  rule: text("paladin::Vigilant Rebuke"),
}, async () => {
  const [enemy] = await table.stage([watcher, friend]);
  beside(watcher, enemy);
  await forceSave(enemy, friend, "wis", 19);
  const [card] = table.offered(watcher, "Vigilant Rebuke");
  assert.ok(card && !card.disabled, "a made Wisdom save against a creature offers no card");
  assert.equal(card.answers.attackerId, enemy.id);
});
await row("776-save-on-trust", {
  pr: 776,
  limit: "The engine doesn't check that a save happened. A named creature is taken on trust.",
  rule: text("paladin::Vigilant Rebuke"),
}, async () => {
  const [enemy, bystander] = await table.stage([watcher, friend], { count: 2 });
  beside(watcher, enemy);
  kit.place(bystander.id, 6, 3);
  // A failed save, and a made Dexterity save: neither is the trigger.
  await forceSave(enemy, friend, "wis", 2);
  await forceSave(enemy, friend, "dex", 19);
  await forceSave(enemy, friend, "wis", 19);
  const before = table.ledger(watcher);
  const wrong = await react(watcher, { feature: "Vigilant Rebuke", targetEnemyId: bystander.id }, [4, 4]);
  assert.equal(wrong.ok, false, `a creature that forced no save is burned: ${show(wrong)}`);
  assert.equal(table.ledger(watcher), before);
  const right = await react(watcher, { feature: "Vigilant Rebuke" }, [4, 4]);
  assert.equal(right.ok, true, right.error);
  assert.ok(kit.enemy(enemy.id).currentHp < 300, "the creature that forced the save takes the force");
});

// ---- #777 ----

await row("777-extra-turn-doubles-cards", {
  pr: 777,
  limit: "An extra turn from Strength before Death doubles every open hit's cards, because lastHits is built per order entry and that hero is in the order twice.",
  rule: "One hit, one reaction to it (SRD 5.1, Reactions).",
}, async () => {
  const swarm = table.hero({ class: "ranger", subclass: "Swarmkeeper" });
  const [enemy] = await table.stage([swarm, friend]);
  beside(swarm, enemy);
  await table.strike(enemy, swarm);
  const encounter = world.encounter();
  const own = encounter.order.find((entry) => entry.characterId === swarm.id);
  kit.saveEncounter({ ...encounter, order: [...encounter.order, { ...own, reflex: true, extra: "Strength before Death" }] });
  assert.equal(table.hits().filter((hit) => hit.characterId === swarm.id).length, 1);
  assert.equal(table.offered(swarm, "Swarming Dispersal").length, 1);
});

for (const [name, build, counter] of [["Necrotic Husk", { class: "warlock", subclass: "The Undead" }, "sub_necrotic_husk"], ["Strength before Death", { class: "fighter", subclass: "Samurai" }, "sub_strength_before_death"]]) {
  const who = table.hero(build);
  await row(`777-stunned-at-zero-card:${name}`, {
    pr: 777,
    limit: "A holder stunned before the hit can get an enabled at-zero card that the engine refuses, spending nothing.",
    rule: "SRD 5.1, Incapacitated: \"An incapacitated creature can't take actions or reactions.\"",
  }, async () => {
    const [enemy] = await table.stage([who, friend], { hp: 1 });
    beside(who, enemy);
    world.patch(who.id, { conditions: ["stunned"], conditionMeta: { stunned: { rounds: 10 } } });
    await table.strike(enemy, who, [16, 16, 4]);
    assert.equal(world.sheet(who.id).currentHp, 0);
    const cards = table.offered(who, name);
    const out = await react(who, { feature: name, ...(cards[0]?.intent?.hit ? { hit: cards[0].intent.hit } : {}) });
    assert.equal(out.ok, false, `stunned and down, the engine took ${name}`);
    assert.equal(table.used(who, counter), 0);
    assert.equal(cards.filter((card) => !card.disabled).length, 0, "an open card is dealt that the engine refuses");
  });
}

// ---- #780 ----

for (const [name, build] of [["Warding Flare", { class: "cleric", subclass: "Light Domain" }], ["Shadowy Dodge", { class: "ranger", subclass: "Gloom Stalker" }], ["Entropic Ward", { class: "warlock", subclass: "The Great Old One" }]]) {
  const who = table.hero(build);
  await row(`780-reroll-keeps-critical:${name}`, {
    pr: 780,
    limit: "Critical hits: a critical the reroll turns into a lower roll that still hits keeps its critical damage. The reroll only re-judges hit or miss, for Shadowy Dodge too.",
    rule: "SRD 5.1, Critical Hits: the extra dice belong to a roll of 20 on the d20; a rerolled attack that comes up 15 is no critical.",
  }, async () => {
    const [enemy] = await table.stage([who, friend]);
    beside(who, enemy);
    // 1d6+2 with the dice doubled: 4 + 5 + 2 = 11; the plain blow, 4 + 2 = 6.
    await table.strike(enemy, who, [20, 4, 5]);
    assert.equal(world.sheet(who.id).currentHp, 39);
    const out = await react(who, { feature: name }, [15]);
    assert.equal(out.ok, true, out.error);
    assert.equal(world.sheet(who.id).currentHp, 44, `the reroll of 15 still hits AC 12 and should land the plain 6: ${show(out)}`);
  });
}

await row("780-entropic-ward-advantage", {
  pr: 780,
  limit: "Entropic Ward's advantage isn't applied: the result tells the GM, who applies it.",
  rule: text("warlock::Entropic Ward"),
}, async () => {
  const who = table.hero({ class: "warlock", subclass: "The Great Old One" });
  const [enemy] = await table.stage([who, friend]);
  beside(who, enemy);
  await table.strike(enemy, who);
  const out = await react(who, { feature: "Entropic Ward" }, [2]);
  assert.equal(out.ok, true, out.error);
  kit.giveTurn(who.id);
  const swing = await kit.swing(who.id, enemy.id, [3, 17, 5], { weapon: "Longsword" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.toHit?.breakdown?.terms?.find((term) => term.sides === 20)?.dice?.length, 2, "the warlock's next attack on that creature rolls one d20");
});

const tempest = table.hero({ class: "cleric", subclass: "Tempest Domain" });
await row("780-wrath-lightning-only", {
  pr: 780,
  limit: "Wrath of the Storm is lightning only. The rule offers lightning or thunder, so a creature immune to lightning takes nothing where thunder would have hurt it.",
  rule: text("cleric::Wrath of the Storm"),
}, async () => {
  const [enemy] = await table.stage([tempest, friend]);
  beside(tempest, enemy);
  kit.setEnemy(enemy.id, { stats: { immune: "lightning" } });
  await table.strike(enemy, tempest);
  const out = await react(tempest, { feature: "Wrath of the Storm" }, [4, 4, 2]);
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.enemy(enemy.id).currentHp, 292, `a creature immune to lightning should take the 8 as thunder: ${show(out)}`);
});

// ---- #787 ----

const knight = table.hero({ class: "fighter", subclass: "Echo Knight" });
await row("787-echo-not-modelled", {
  pr: 787,
  limit: "The echo isn't modelled. It doesn't check that an echo is out, how far anything is from it, or whether it is destroyed.",
  rule: `${text("fighter::Shadow Martyr")}; ${text("fighter::Manifest Echo")}`,
}, async () => {
  const [enemy] = await table.stage([knight, friend]);
  kit.place(knight.id, 1, 2);
  // The ally and its attacker 85 feet from the knight, who has summoned no echo.
  kit.place(friend.id, 18, 2);
  kit.place(enemy.id, 18, 3);
  await table.strike(enemy, friend);
  assert.ok(!world.sheet(knight.id).conditions.some((name) => /echo/i.test(name)), "no echo is out");
  const before = table.ledger(knight);
  const out = await react(knight, { feature: "Shadow Martyr", targetCharacterId: friend.id });
  assert.equal(out.ok, false, `with no echo summoned, and the ally 85 feet off, the echo took the hit: ${show(out)}`);
  assert.equal(table.ledger(knight), before);
});

await row("787-martyr-not-rolled-against-the-echo", {
  pr: 787,
  limit: "Shadow Martyr answers after the hit lands. The attack isn't rolled again against the echo's AC.",
  rule: `${text("fighter::Manifest Echo")}`,
}, async () => {
  // A 20th-level knight's echo: AC 14 + 6. A 16 that hit the ally's AC 12 misses it.
  const [enemy] = await table.stage([knight, friend]);
  beside(knight, enemy);
  // The echo is out (Manifest Echo's mark): Shadow Martyr needs it.
  world.patch(knight.id, { conditions: [...world.sheet(knight.id).conditions, "echo manifested"] });
  await table.strike(enemy, friend, [12, 4]);
  const out = await react(knight, { feature: "Shadow Martyr", targetCharacterId: friend.id });
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.applied, /16 misses the echo \(AC 20\)/, out.result.applied);
});

await row("787-fallen-knight-wording", {
  pr: 787,
  limit: "Refusal wording for a downed fighter. Shadow Martyr from a fighter at 0 hit points is refused correctly, but the message says it \"follows the damage\".",
  rule: "A refusal says the bar that held (src/lib/dm/tool-errors.ts).",
}, async () => {
  const [enemy] = await table.stage([knight, friend]);
  beside(knight, enemy);
  world.patch(knight.id, { currentHp: 0, conditions: ["unconscious"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  await table.strike(enemy, friend);
  const out = await react(knight, { feature: "Shadow Martyr", targetCharacterId: friend.id });
  assert.equal(out.ok, false);
  assert.doesNotMatch(out.error, /follows the damage/);
  assert.match(out.error, /0 HP|0 hit points|unconscious|down|dying/i);
});

const ranger = table.hero({ class: "ranger", subclass: "Drakewarden" });
const summoned = await world.invoke("summon_pet", { characterId: ranger.id, kind: "drake", form: "drake", essence: "fire" });
const drake = () => world.sheet(ranger.id).pets.find((pet) => pet.kind === "drake");

await row("787-pet-hit-keeps-no-record", {
  pr: 787,
  limit: "Party members only. A hit on a pet or NPC keeps no hit record, so it offers no card. Damage to the drake isn't handled by the engine: the drake's half of Reflexive Resistance has no card and no refund.",
  rule: text("ranger::Perfected Bond"),
}, async () => {
  assert.equal(summoned.ok, true, summoned.error);
  const [enemy] = await table.stage([ranger, friend]);
  beside(ranger, enemy);
  const pet = drake();
  const full = pet.hp;
  // The drake takes 10 fire: with the ranger within 30 feet, the reaction halves it.
  const hurt = await world.invoke("apply_damage", { characterId: ranger.id, petName: pet.name, amount: 10, type: "slashing" });
  assert.equal(hurt.ok, true, hurt.error);
  if (drake().hp !== full - 10) throw new Error(`the rig: 10 slashing left the drake at ${drake().hp} of ${full}: ${show(hurt)}`);
  const cards = table.offered(ranger, "Reflexive Resistance");
  const before = table.used(ranger, "sub_reflexive_resistance");
  const out = await react(ranger, { feature: "Reflexive Resistance", petName: pet.name });
  assert.ok(cards.length === 1 && out.ok === true, `the drake's damage offers ${cards.length} card(s) and the reaction says: ${show(out)}`);
  assert.equal(drake().hp, full - 5, "half the drake's damage comes back");
  assert.equal(table.used(ranger, "sub_reflexive_resistance"), before + 1);
});

await row("787-reflexive-card-on-own-turn", {
  pr: 787,
  limit: "Reflexive Resistance's card stays in the Hand on the ranger's turn. A player can still spend a use from that card for nothing.",
  rule: text("ranger::Perfected Bond"),
}, async () => {
  const [enemy] = await table.stage([ranger, friend], { first: ranger });
  beside(ranger, enemy);
  const cards = deriveHand(world.sheet(ranger.id), FRESH_TURN, {}).filter((card) => /Reflexive Resistance/.test(card.name) && !card.disabled);
  const before = table.ledger(ranger);
  const spend = await world.invoke("use_resource", { characterId: ranger.id, resource: "Reflexive Resistance" });
  assert.ok(spend.ok === false && table.ledger(ranger) === before, `with nobody hurt, use_resource spent a use for nothing (${cards.length} open card(s) on the ranger's own turn): ${show(spend)}`);
  assert.equal(cards.length, 0, "an open card on the ranger's own turn, with no damage to answer");
});

await row("787-thirty-feet-to-the-drake", {
  pr: 787,
  limit: "The 30 feet between ranger and drake isn't checked. Pets have no position here.",
  rule: text("ranger::Perfected Bond"),
}, async () => {
  const [enemy] = await table.stage([ranger, friend]);
  beside(ranger, enemy);
  const board = kit.map();
  const { listTokens } = await import("../src/lib/db/battle-maps.ts");
  const petToken = listTokens(board.id).find((token) => token.refId !== ranger.id && /drake/i.test(`${token.label ?? ""} ${token.name ?? ""} ${token.kind ?? ""}`));
  assert.ok(petToken, `the drake has no token on the board, so nothing can measure its 30 feet (tokens: ${listTokens(board.id).map((token) => token.kind ?? token.refKind ?? "?").join(",")})`);
});

await row("787-reaction-card-says-self", {
  pr: 787,
  limit: "The card's range label reads \"Self\". Every reaction card has this, including those aimed at an ally.",
  rule: "A card's corner names the reach its feature has (src/lib/battlemap/hand-react.ts).",
}, async () => {
  const [enemy] = await table.stage([knight, glory, redeemer, friend]);
  kit.place(friend.id, 6, 2);
  kit.place(enemy.id, 6, 3);
  await table.strike(enemy, friend);
  const labels = [];
  for (const who of [knight, glory, redeemer]) {
    for (const card of table.offered(who).filter((entry) => entry.answers?.characterId === friend.id)) {
      labels.push(`${card.name}: ${card.range}`);
    }
  }
  assert.ok(labels.length >= 3, `only ${labels.length} ally cards came up: ${labels.join("; ")}`);
  assert.deepEqual(labels.filter((label) => /: Self$/.test(label)), []);
});

await row("787-typed-reaction", { pr: 787, limit: "A typed reaction relies on the GM calling the tool.", rule: "-" }, async () => {});

// ---- #791 ----

await row("791-blessing-on-the-cleric", {
  pr: 791,
  limit: "Blessing of the Trickster can now land on the cleric. The feature says \"a willing creature other than you\", but the Hand offers the \"(you)\" chip on every ally card.",
  rule: `${text("cleric::Blessing of the Trickster")}; the published feature: "a willing creature other than yourself"`,
}, async () => {
  const trickster = table.hero({ class: "cleric", subclass: "Trickery Domain" });
  await kit.endFight();
  for (const args of [{ targetCharacterId: trickster.id }, {}]) {
    const out = await world.invoke("use_resource", { characterId: trickster.id, resource: "Blessing of the Trickster", ...args });
    assert.equal(out.ok, false, `the cleric blessed themself (${JSON.stringify(args)})`);
    assert.ok(!world.sheet(trickster.id).conditions.includes("blessing of the trickster"));
  }
  const card = deriveHand(world.sheet(trickster.id), FRESH_TURN, {}).find((entry) => entry.name === "Blessing of the Trickster");
  assert.equal(card?.othersOnly, true, "the card does not tell the aim bar to leave the cleric's own chip out");
  const given = await world.invoke("use_resource", { characterId: trickster.id, resource: "Blessing of the Trickster", targetCharacterId: friend.id });
  assert.equal(given.ok, true, given.error);
  assert.ok(world.sheet(friend.id).conditions.includes("blessing of the trickster"));
});

await row("791-unpicked-card-sends-first", {
  pr: 791,
  limit: "A card nobody picks on sends its first option, and the sentence shows which, as every other choice card does.",
  rule: "A played card names what it does (src/lib/dm/intent-logic.ts directCardCall).",
}, async () => {
  const sorcerer = table.hero({ class: "sorcerer", subclass: "Wild Magic" });
  const card = deriveHand(world.sheet(sorcerer.id), FRESH_TURN, {}).find((entry) => entry.name === "Tides of Chaos" || entry.intent?.resourceId === "Tides of Chaos");
  assert.ok(card, "Tides of Chaos is a card");
  const call = directCardCall(card.intent, sorcerer.id, { inFight: false });
  const out = await world.invoke(call.name, call.args);
  assert.equal(out.ok, true, out.error);
  // The first option of the three: the next attack.
  assert.ok(world.sheet(sorcerer.id).conditions.includes("tides of chaos (attack)"), JSON.stringify(world.sheet(sorcerer.id).conditions));
});

// ---- #797 ----

const mage = table.hero({ class: "wizard", subclass: "School of Evocation", spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Shield"], known: [], cantrips: [] } });
await row("797-other-bars-come-second", {
  pr: 797,
  limit: "Other bars still come second. A wrong id from a character with no slot left, or without the feature, gets the list first and the real refusal on the resend, which costs one extra model call.",
  rule: "src/lib/dm/tool-errors.ts: a call the game refuses is refused before it is sent back for a slip in its arguments.",
}, async () => {
  const [enemy] = await table.stage([mage, friend]);
  beside(mage, enemy);
  await table.strike(enemy, mage, [10, 4]);
  const [open] = table.hits().filter((hit) => hit.characterId === mage.id);
  assert.ok(open, "an open hit");
  // No slot left, and a hit id with its last character dropped.
  world.patch(mage.id, { spellcasting: { ...world.sheet(mage.id).spellcasting, slots: { 1: { max: 4, used: 4 } } } });
  const noSlot = await modelReacts(mage, "Shield", { hit: open.id.slice(0, -1) });
  assert.equal(noSlot.ok, false);
  assert.ok(noSlot.refused && !noSlot.retry, `with no slot left the model is handed the list of open hits to try again: ${noSlot.error}`);
  // A character without the feature.
  const noFeature = await modelReacts(friend, "Shield", { hit: open.id.slice(0, -1) });
  assert.equal(noFeature.ok, false);
  assert.ok(!/Open hits|hit "/.test(noFeature.error) || noFeature.refused, `a character who cannot cast Shield is handed the list of open hits: ${noFeature.error}`);
});

await row("797-fall-in-the-list", {
  pr: 797,
  limit: "A fall reads \"a fall\" in the list. The wording matches GAME STATE, but no test covers it.",
  rule: "The list of open hits names each as GAME STATE does.",
}, async () => {
  const monk = table.hero({ class: "monk", subclass: "Way of the Open Hand" });
  await table.stage([monk, friend]);
  recordFall(world.campaignId, monk.id, snapshotVitals(world.campaignId, world.sheet(monk.id)), 7, new Date().toISOString());
  const [fall] = table.hits().filter((hit) => hit.characterId === monk.id);
  assert.ok(fall, "the fall is an open hit");
  const out = await modelReacts(monk, "Slow Fall", { hit: fall.id.slice(1) });
  assert.equal(out.retry, true, JSON.stringify(out));
  assert.ok(out.error.includes(`hit "${fall.id}" on ${world.sheet(monk.id).name} (a fall)`), out.error);
});

await row("797-card-after-fifty-messages", {
  pr: 797,
  limit: "A card is recognised by the last 50 messages. If 50 messages follow a card and the model then sends that card's closed hit, it gets the list instead of the refusal.",
  rule: "A played card whose hit has closed stays a refusal (pull request #797).",
}, async () => {
  const messages = await import("../src/lib/db/messages.ts");
  const campaigns = await import("../src/lib/db/campaigns.ts");
  const [enemy] = await table.stage([mage, friend]);
  beside(mage, enemy);
  await table.strike(enemy, mage, [10, 4]);
  const say = (content, extra = {}) => messages.insertCampaignMessage({ campaignId: world.campaignId, seq: campaigns.allocateSeq(world.campaignId), authorType: "player", userId: world.sheet(mage.id).userId, characterId: mage.id, content, ...extra });
  say("Casts Shield.", { intent: { card: "reaction", feature: "Shield", spell: "Shield", hit: "hgone000" } });
  for (let at = 0; at < 60; at += 1) say(`Table talk ${at}.`);
  const out = await modelReacts(mage, "Shield", { hit: "hgone000" });
  assert.equal(out.ok, false);
  assert.ok(out.refused === "rules" && !/Open hits/.test(out.error), `sixty messages after the card, its closed hit is answered with the list of open hits: ${out.error}`);
});

// ---- #800 ----

await row("800-misdirection-card-sends-no-target", {
  pr: 800,
  limit: "Misdirection's card sends no target though use_reaction asks for targetEnemyId (found, not fixed).",
  rule: text("rogue::Misdirection"),
}, async () => {
  const rogue = table.hero({ class: "rogue", subclass: "Mastermind" });
  const [enemy, cover] = await table.stage([rogue, friend], { count: 2 });
  kit.place(rogue.id, 5, 2);
  kit.place(friend.id, 9, 9);
  // An archer 15 feet off with a goblin in the line: half cover, so 14 to hit.
  kit.place(cover.id, 5, 3);
  kit.place(enemy.id, 5, 5);
  kit.setEnemy(enemy.id, { stats: { attacks: [{ name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing" }] } });
  const shot = await table.strike(enemy, rogue, [16, 4]);
  const [card] = table.offered(rogue, "Misdirection");
  if (!card) throw new Error(`the rig: no Misdirection card for ${JSON.stringify(table.hits().map((hit) => [hit.characterId === rogue.id, hit.hit]))}: ${JSON.stringify(shot.result).slice(0, 500)}`);
  assert.equal(card.target, "enemy", "the card asks for no creature");
  const [call] = directCardCalls({ ...card.intent, targetId: cover.id, targetKind: "enemy" }, rogue.id);
  assert.equal(call.name, "use_reaction");
  assert.equal(call.args.targetEnemyId, cover.id, `the pick does not reach the engine: ${JSON.stringify(call.args)}`);
});

await kit.endFight();
world.close();
finish();
