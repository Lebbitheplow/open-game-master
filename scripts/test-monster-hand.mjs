// The DM's hand: a monster's turn as cards (issue #108). What the DM
// projection says an enemy can do (src/lib/dm/enemy-actions-view.ts), the
// cards derived from it (src/lib/battlemap/monster-hand.ts), and the console
// call a played card makes. Every number comes off the same stat block the
// engine rolls from, so a card never promises what enemy_attack refuses.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { enemyActionsView } = await import("../src/lib/dm/enemy-actions-view.ts");
const { deriveMonsterHand, lairTitle, monsterCalls, monsterInvoke, monsterSentence, rollsMonsterAttack, swingsLine, takesManyTargets } = await import(
  "../src/lib/battlemap/monster-hand.ts"
);
const { lairChoices, lairResolution, lairSave } = await import("../src/lib/dm/legendary-logic.ts");
const { previewRows } = await import("../src/lib/battlemap/hand-play.ts");
const { monsterAttackIcon } = await import("../src/lib/battlemap/attack-art.ts");
const { cardArtwork } = await import("../src/lib/battlemap/card-art.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const bite = { name: "Bite", toHit: 5, damage: "1d6+3", type: "piercing", mode: "melee", reach: 5 };
const claw = { name: "Claw", toHit: 5, damage: "1d4+3", type: "slashing", mode: "melee", reach: 5 };
const spit = { name: "Acid Spit", toHit: 4, damage: "2d6", type: "acid", mode: "ranged", range: { normal: 30, long: 90 } };

function enemy(overrides = {}) {
  return {
    id: "e1",
    encounterId: "enc",
    campaignId: "c1",
    slug: "drake",
    displayName: "Drake",
    maxHp: 30,
    currentHp: 30,
    ac: 14,
    initiative: 12,
    status: "alive",
    cr: 2,
    xp: 450,
    conditions: [],
    conditionMeta: {},
    concentration: null,
    stats: {
      type: "dragon",
      speed: "40 ft.",
      dexMod: 1,
      attacks: [bite, claw, spit],
      traits: ["Keen Smell: advantage on Wisdom (Perception) checks that rely on smell."],
      specials: [
        { name: "Fire Breath", recharge: 5, save: "dex", dc: 12, damage: "4d6", damageType: "fire", halfOnSave: true },
        { name: "Frightful Presence", save: "wis", dc: 12, condition: "frightened", rounds: 10, repeatSave: true },
        { name: "Tail Sweep", legendaryCost: 1, save: "str", dc: 12, condition: "prone" },
      ],
      attacksPerTurn: 3,
      routines: [[{ attack: "Bite", count: 1 }, { attack: "Claw", count: 2 }]],
      resist: "",
      immune: "",
      vulnerable: "",
      conditionImmune: "",
      cr: 2,
      xp: 450,
    },
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function encounter(overrides = {}) {
  return {
    orderReady: true,
    order: [
      { kind: "pc", characterId: "s1", userId: "u1", name: "Kael", initiative: 15 },
      { kind: "enemy", enemyId: "e1", name: "Drake", initiative: 12 },
    ],
    turnIndex: 0,
    round: 1,
    surprisedIds: [],
    kind: "fight",
    status: "active",
    legendary: { pools: {}, lair: false, lairUsedRound: 0 },
    ...overrides,
  };
}

test("the projection lists every attack with the swings one call makes, and the save abilities with their numbers", () => {
  const view = enemyActionsView(encounter(), enemy());
  assert.deepEqual(
    view.attacks.map((attack) => [attack.name, attack.range, attack.melee, attack.swings]),
    [
      ["Bite", "5 ft", true, ["Bite", "Claw", "Claw"]],
      ["Claw", "5 ft", true, ["Bite", "Claw", "Claw"]],
      // Not in the routine: one swing of it.
      ["Acid Spit", "30/90 ft", false, ["Acid Spit"]],
    ],
  );
  assert.deepEqual(
    view.abilities.map((ability) => [ability.name, ability.save, ability.dc, ability.resource, ability.refusal]),
    [
      ["Fire Breath", "dex", 12, "Recharge 5-6", null],
      ["Frightful Presence", "wis", 12, "", null],
    ],
  );
  assert.equal(view.refusal, null);
  assert.equal(view.acted, false);
  assert.equal(view.speed, "40 ft.");
});

test("a spent recharge ability says so, and an enemy that has acted is refused by the engine's own sentence", () => {
  const view = enemyActionsView(
    encounter({ legendary: { pools: {}, lair: false, lairUsedRound: 0, abilities: { e1: { spent: ["fire breath"] } }, acted: { round: 1, ids: ["e1"] } } }),
    enemy(),
  );
  assert.match(view.abilities[0].refusal, /has not recharged/);
  assert.equal(view.abilities[1].refusal, null);
  assert.match(view.refusal, /already taken its action this round/);
  assert.equal(view.acted, true);
});

test("a block with no attack lines gets the synthesized ones, as enemy_attack does", () => {
  const view = enemyActionsView(encounter(), enemy({ stats: { ...enemy().stats, attacks: [], routines: undefined, attacksPerTurn: 1, specials: [] } }));
  assert.ok(view.attacks.length >= 1);
  assert.ok(view.attacks[0].toHit > 0);
  assert.deepEqual(view.abilities, []);
});

test("an incapacitated enemy's cards are held with the reason", () => {
  const view = enemyActionsView(encounter(), enemy({ conditions: ["paralyzed"] }));
  assert.match(view.refusal, /paralyzed/);
});

const drake = { id: "e1", name: "Drake", status: "alive", conditions: [], actions: enemyActionsView(encounter(), enemy()) };

test("the hand holds one card per attack, one per ability, and Flee, with the engine's numbers on them", () => {
  const cards = deriveMonsterHand(drake);
  assert.deepEqual(
    cards.map((card) => card.name),
    ["Bite", "Claw", "Acid Spit", "Fire Breath", "Frightful Presence", "Flee"],
  );
  const biteCard = cards[0];
  assert.equal(biteCard.type, "attack");
  assert.equal(biteCard.dice, "1d6+3 piercing");
  assert.equal(biteCard.roll, "+5 to hit");
  assert.equal(biteCard.toHit, 5);
  assert.equal(biteCard.melee, true);
  assert.match(biteCard.rules, /Multiattack: 1 Bite, 2 Claw/);
  assert.equal(biteCard.disabled, null);
  assert.deepEqual(biteCard.intent, { card: "monster", enemyId: "e1", action: "attack", attackName: "Bite" });
  const breath = cards[3];
  assert.equal(breath.type, "spell");
  assert.equal(breath.dice, "4d6 fire");
  assert.equal(breath.roll, "DEX save DC 12");
  assert.deepEqual(breath.save, { ability: "DEX", dc: 12 });
  assert.equal(breath.resource, "Recharge 5-6");
  assert.ok(takesManyTargets(breath));
  const fear = cards[4];
  assert.equal(fear.type, "control");
  assert.equal(fear.dice, "frightened");
  assert.equal(fear.condition, "frightened");
  assert.match(fear.rules, /Lasts 10 rounds/);
  const flee = cards[5];
  assert.equal(flee.type, "basic");
  assert.equal(flee.target, "none");
  assert.equal(flee.cost, "free");
});

test("a card that cannot be played says why: the ability's reason first, then the turn's", () => {
  const spent = enemyActionsView(
    encounter({ legendary: { pools: {}, lair: false, lairUsedRound: 0, abilities: { e1: { spent: ["fire breath"] } }, acted: { round: 1, ids: ["e1"] } } }),
    enemy(),
  );
  const cards = deriveMonsterHand({ ...drake, actions: spent });
  assert.match(cards[0].disabled, /already taken its action/);
  assert.equal(cards[0].spent, true);
  assert.match(cards[3].disabled, /has not recharged/);
  assert.match(cards[4].disabled, /already taken its action/);
  // Breaking off is never an action the round refuses.
  assert.equal(cards[5].disabled, null);
});

test("an enemy the projection carries no actions for has no cards (a player's view)", () => {
  assert.deepEqual(deriveMonsterHand({ id: "e1", name: "Drake", status: "alive", conditions: [] }), []);
});

test("the preview works a bite against the party's real armour class", () => {
  const [biteCard] = deriveMonsterHand(drake);
  const rows = previewRows(biteCard, { id: "s1", name: "Kael", kind: "enemy", ac: 16, conditions: [] }, []);
  const toHit = rows.find((row) => row.key === "To hit");
  assert.match(toHit.value, /\+5 vs AC 16 · 50%/);
});

test("a played attack is the console's enemy_attack, with the advantage asked for", () => {
  const [biteCard] = deriveMonsterHand(drake);
  assert.deepEqual(monsterInvoke(biteCard, ["s1"]), {
    name: "enemy_attack",
    args: { enemyId: "e1", targetCharacterId: "s1", attack: "Bite" },
  });
  assert.deepEqual(monsterInvoke(biteCard, ["s1"], "advantage").args.advantage, "advantage");
  assert.equal(monsterInvoke(biteCard, []), null);
  assert.equal(monsterSentence("Drake", biteCard, ["Kael"]), "Drake attacks Kael with its Bite.");
});

test("an ability on one target is cast_at_player; on several it is one aoe_damage call", () => {
  const cards = deriveMonsterHand(drake);
  const breath = cards[3];
  assert.deepEqual(monsterInvoke(breath, ["s1"]), {
    name: "cast_at_player",
    args: { characterId: "s1", casterEnemyId: "e1", enemyAbility: "Fire Breath", saveAbility: "dex", dc: 12, damage: "4d6", halfOnSave: true, damageType: "fire" },
  });
  assert.deepEqual(monsterInvoke(breath, ["s1", "s2"]), {
    name: "aoe_damage",
    args: { casterEnemyId: "e1", enemyAbility: "Fire Breath", characterIds: ["s1", "s2"], saveAbility: "dex", dc: 12, damage: "4d6", halfOnSave: true, type: "fire" },
  });
  const fear = cards[4];
  assert.deepEqual(monsterInvoke(fear, ["s1"]).args, {
    characterId: "s1", casterEnemyId: "e1", enemyAbility: "Frightful Presence", saveAbility: "wis", dc: 12, condition: "frightened", rounds: 10,
  });
  assert.equal(monsterSentence("Drake", breath, ["Kael", "Lys", "Bran"]), "Drake uses Fire Breath on Kael, Lys and Bran.");
});

test("a creature on the other side (issue 503): its row takes the bite by id, and an area splits sheets from rows", () => {
  const cards = deriveMonsterHand(drake);
  const rows = new Set(["e2"]);
  assert.deepEqual(monsterInvoke(cards[0], ["e2"], "none", rows).args, { enemyId: "e1", targetCharacterId: "e2", attack: "Bite" });
  assert.deepEqual(monsterInvoke(cards[3], ["s1", "e2"], "none", rows).args, {
    casterEnemyId: "e1", enemyAbility: "Fire Breath", characterIds: ["s1"], enemyIds: ["e2"], saveAbility: "dex", dc: 12, damage: "4d6", halfOnSave: true, type: "fire",
  });
});

test("Flee is enemy_flees and needs no target", () => {
  const cards = deriveMonsterHand(drake);
  assert.deepEqual(monsterInvoke(cards[5], []), { name: "enemy_flees", args: { enemyId: "e1", reason: "Breaks off and runs." } });
  assert.equal(monsterSentence("Drake", cards[5], []), "Drake breaks off and flees.");
});

test("the multiattack line counts the swings", () => {
  assert.equal(swingsLine(["Bite"]), "");
  assert.equal(swingsLine(["Claw", "Claw", "Bite"]), "Multiattack: 2 Claw, 1 Bite. One card plays the whole routine.");
});

test("a monster's attack card shows its weapon's or its strike's painting, never a sword for a bite", () => {
  const icons = deriveMonsterHand(drake).filter((card) => card.type === "attack").map((card) => card.icon.key);
  assert.deepEqual(icons, ["natural-attack", "natural-attack", "natural-attack"]);
  const wolf = { ...drake, name: "Wolf", actions: { ...drake.actions, attacks: [{ ...drake.actions.attacks[0], name: "Bite" }] } };
  assert.equal(deriveMonsterHand(wolf)[0].icon.key, "strike-bite-mammal");
  assert.equal(cardArtwork(monsterAttackIcon("Goblin", "Scimitar", false)).key, "weapon-scimitar");
  assert.equal(cardArtwork(monsterAttackIcon("Bandit Captain", "Light Crossbow", false)).key, "weapon-light-crossbow");
  assert.equal(monsterAttackIcon("Giant Eagle", "Talons", false).key, "strike-talons");
  assert.equal(monsterAttackIcon("Lich", "Paralyzing Touch", true).key, "cast");
});

// Issue #621: an enemy's Dash, Disengage and Dodge, from a host that resolves
// them and says how far the creature may still walk.
const moving = { speedFeet: 40, leftFeet: 25, dashes: 1, disengaged: false };

test("the projection carries the movement it is given, and none without it", () => {
  assert.deepEqual(enemyActionsView(encounter(), enemy(), moving).movement, moving);
  assert.equal("movement" in enemyActionsView(encounter(), enemy()), false);
});

test("Dash, Disengage and Dodge cards come only from a host that offers them and counts the movement", () => {
  const withMove = { ...drake, actions: enemyActionsView(encounter(), enemy(), moving) };
  assert.deepEqual(deriveMonsterHand(withMove).map((card) => card.name), deriveMonsterHand(drake).map((card) => card.name), "an older host's hand changed");
  assert.equal(deriveMonsterHand(drake, { enemyActions: true }).some((card) => card.name === "Dash"), false, "a card with no movement to count");
  const cards = deriveMonsterHand(withMove, { enemyActions: true });
  const names = cards.map((card) => card.name);
  assert.deepEqual(names.slice(-4), ["Dash", "Disengage", "Dodge", "Flee"]);
  const dash = cards.find((card) => card.name === "Dash");
  assert.equal(dash.target, "none");
  assert.equal(dash.cost, "action");
  assert.match(dash.rules, /25 ft left now/);
  assert.deepEqual(dash.icon, { kind: "action", key: "dash" });
  assert.deepEqual(monsterInvoke(dash, []), { name: "take_action", args: { enemyId: "e1", action: "dash" } });
  assert.equal(monsterSentence("Drake", dash, []), "Drake takes the Dash action.");
  const disengage = cards.find((card) => card.name === "Disengage");
  assert.deepEqual(monsterInvoke(disengage, []), { name: "take_action", args: { enemyId: "e1", action: "disengage" } });
  assert.deepEqual(monsterInvoke(cards.find((card) => card.name === "Dodge"), []).args, { enemyId: "e1", action: "dodge" });
});

test("a move card says why it cannot be played: the action spent, no speed, a Disengage already taken", () => {
  const spent = enemyActionsView(encounter({ legendary: { pools: {}, lair: false, lairUsedRound: 0, acted: { round: 1, ids: ["e1"] } } }), enemy(), { ...moving, disengaged: true });
  const cards = deriveMonsterHand({ ...drake, actions: spent }, { enemyActions: true });
  assert.match(cards.find((card) => card.name === "Dash").disabled, /already taken its action/);
  assert.match(cards.find((card) => card.name === "Disengage").disabled, /already Disengaged this turn/);
  const held = enemyActionsView(encounter(), enemy(), { ...moving, speedFeet: 0, leftFeet: 0 });
  assert.match(deriveMonsterHand({ ...drake, actions: held }, { enemyActions: true }).find((card) => card.name === "Dash").disabled, /speed is 0/);
  // Nimble Escape may still pay a Disengage with the bonus action: the server says no if not.
  const acted = enemyActionsView(encounter({ legendary: { pools: {}, lair: false, lairUsedRound: 0, acted: { round: 1, ids: ["e1"] } } }), enemy(), moving);
  assert.equal(deriveMonsterHand({ ...drake, actions: acted }, { enemyActions: true }).find((card) => card.name === "Disengage").disabled, null);
});

// Issue 685 audit, 4.G: a legendary creature's legendary actions and the
// lair's were console forms only at a table a person runs. They are cards
// of the monsters' Hand now, offered only while they can be taken (SRD 5.1:
// one at a time, at the end of another creature's turn, from what is left
// this round; the lair on initiative count 20, losing ties, once a round).
const dragonBlock = {
  ...enemy().stats,
  attacks: [{ name: "Tail", toHit: 11, damage: "2d8+6", type: "bludgeoning", mode: "melee", reach: 15 }],
  routines: undefined,
  attacksPerTurn: 1,
  specials: [],
  traits: [
    "Legendary Resistance (3/Day). If the dragon fails a saving throw, it can choose to succeed instead.",
    "The dragon can take 3 legendary actions, choosing from the options below.",
    "Legendary action: Detect. The dragon makes a Wisdom (Perception) check.",
    "Legendary action: Tail Attack. The dragon makes a tail attack.",
    "Legendary action: Wing Attack (Costs 2 Actions). The dragon beats its wings. Each creature within 10 feet of the dragon must succeed on a DC 22 Dexterity saving throw or take 15 (2d6 + 8) bludgeoning damage and be knocked prone.",
    "Lair action: Magma erupts from a point on the ground. Each creature in the geyser's area must make a DC 15 Dexterity saving throw, taking 21 (6d6) fire damage on a failed save, or half as much damage on a successful one.",
    "Lair action: The ground shakes; each creature makes a DC 15 Dex save or falls prone.",
  ],
};
const dragon = (overrides = {}) => enemy({ displayName: "Vermithrax", stats: dragonBlock, ...overrides });
const lairFight = (legendary = {}) => encounter({ round: 2, legendary: { pools: {}, lair: true, lairUsedRound: 0, lairDue: 2, ...legendary } });

test("a legendary creature's options are projected at the end of another creature's turn, with their costs and what each buys", () => {
  const view = enemyActionsView(encounter(), dragon());
  assert.equal(view.legendary.left, 3);
  assert.equal(view.legendary.max, 3);
  const [detect, tail, wing] = view.legendary.options;
  assert.deepEqual([detect.name, detect.cost, detect.routes.length, detect.routes[0].target, detect.routes[0].how], ["Detect", 1, 1, "none", "A Wisdom (perception) check the server rolls"]);
  const [swing] = tail.routes;
  assert.deepEqual([tail.name, tail.cost, swing.attack.name, swing.attack.swings, swing.target, swing.pick], ["Tail Attack", 1, "Tail", ["Tail"], "one", "foes"], "one swing, never the routine");
  const [beat] = wing.routes;
  assert.deepEqual([wing.name, wing.cost, beat.ability.save, beat.ability.dc, beat.ability.damage, beat.ability.condition, beat.target], ["Wing Attack", 2, "dex", 22, "2d6+8", "prone", "many"]);
  assert.ok([detect, tail, wing].every((option) => option.refusal === null));
  // The lair's lines are the lair's, not abilities of the creature's turn.
  assert.deepEqual(view.abilities.map((ability) => ability.name), []);
});

test("no legendary action is offered on the creature's own turn, twice at one turn's end, with none left, or while it cannot act", () => {
  // Its turn handed to the AI, or walked past and held for a person (due).
  assert.equal(enemyActionsView(encounter({ legendary: { pools: {}, lair: false, lairUsedRound: 0, due: ["e1"] } }), dragon()).legendary, undefined);
  assert.equal(enemyActionsView(encounter({ legendary: { pools: {}, lair: false, lairUsedRound: 0, handoff: { turnId: "t", enemyIds: ["e1"] } } }), dragon()).legendary, undefined);
  // Due with its action taken and nobody after it: still its own turn, whose
  // end is no moment for one (SRD 5.1: at the end of another creature's turn).
  assert.equal(enemyActionsView(encounter({ legendary: { pools: {}, lair: false, lairUsedRound: 0, due: ["e1"], acted: { round: 1, ids: ["e1"] } } }), dragon()).legendary, undefined);
  // Another creature held with it has acted since: that turn's end is open.
  assert.ok(enemyActionsView(encounter({ legendary: { pools: {}, lair: false, lairUsedRound: 0, due: ["e1", "e2"], acted: { round: 1, ids: ["e1", "e2"] } } }), dragon()).legendary);
  // Handed on: the turn is over, and the next turn's end is open.
  assert.ok(enemyActionsView(encounter({ legendary: { pools: {}, lair: false, lairUsedRound: 0, acted: { round: 1, ids: ["e1"] } } }), dragon()).legendary);
  // One already taken at the end of this turn.
  assert.equal(enemyActionsView(encounter({ legendary: { pools: {}, lair: false, lairUsedRound: 0, opportunities: { key: "1:s1:0", ids: ["e1"] } } }), dragon()).legendary, undefined);
  // None left this round.
  assert.equal(enemyActionsView(encounter({ legendary: { pools: { e1: { actions: 0, resistances: 3 } }, lair: false, lairUsedRound: 0 } }), dragon()).legendary, undefined);
  assert.equal(enemyActionsView(encounter(), dragon({ conditions: ["stunned"] })).legendary, undefined);
  assert.equal(enemyActionsView(encounter({ orderReady: false }), dragon()).legendary, undefined);
  // A creature with no legendary lines has none.
  assert.equal(enemyActionsView(encounter(), enemy()).legendary, undefined);
});

test("an option costing more than is left is held with legendary_action's own sentence", () => {
  const view = enemyActionsView(encounter({ legendary: { pools: { e1: { actions: 1, resistances: 3 } }, lair: false, lairUsedRound: 0 } }), dragon());
  const wing = view.legendary.options.find((option) => option.name === "Wing Attack");
  assert.equal(wing.refusal, "Wing Attack costs 2; only 1 legendary action left this round. Pick a cheaper one, or wait for the next round.");
  const cards = deriveMonsterHand({ id: "e1", name: "Vermithrax", status: "alive", conditions: [], actions: view }, { legendaryCards: true });
  const card = cards.find((entry) => entry.name === "Wing Attack");
  assert.equal(card.disabled, wing.refusal);
  assert.equal(card.resource, "Costs 2 · 1/3 left");
});

test("the legendary cards come only from a host that offers them, and each plays legendary_action then what it buys", () => {
  const actions = enemyActionsView(encounter(), dragon());
  const held = { id: "e1", name: "Vermithrax", status: "alive", conditions: [], actions };
  assert.equal(deriveMonsterHand(held).some((card) => card.cost === "legendary"), false, "an older host's hand changed");
  const cards = deriveMonsterHand(held, { legendaryCards: true });
  const [detect, tail, wing] = cards.filter((card) => card.cost === "legendary");
  assert.deepEqual([detect.name, tail.name, wing.name], ["Detect", "Tail Attack", "Wing Attack"]);
  assert.equal(cards.at(-1).name, "Flee", "Flee stays last");
  // Detect: the spend alone, no target; the server rolls the check.
  assert.equal(detect.target, "none");
  assert.deepEqual(monsterCalls(detect, []), [{ name: "legendary_action", args: { enemyId: "e1", action: "Detect" } }]);
  // Tail Attack: one call, the spend and its swing together, with the Roll pills.
  assert.equal(rollsMonsterAttack(tail), true);
  assert.equal(tail.roll, "+11 to hit");
  assert.equal(monsterCalls(tail, []), null, "an attack needs its target");
  assert.deepEqual(monsterCalls(tail, ["s1"], "advantage"), [
    { name: "legendary_action", args: { enemyId: "e1", action: "Tail Attack", targetCharacterId: "s1", advantage: "advantage" } },
  ]);
  // Wing Attack: one call, its save on everyone caught.
  assert.equal(takesManyTargets(wing), true);
  assert.equal(wing.roll, "DEX save DC 22");
  assert.deepEqual(monsterCalls(wing, ["s1", "e2"], "none", new Set(["e2"])), [
    { name: "legendary_action", args: { enemyId: "e1", action: "Wing Attack", characterIds: ["s1"], enemyIds: ["e2"] } },
  ]);
  assert.equal(monsterSentence("Vermithrax", tail, ["Kael"]), "Vermithrax spends a legendary action: Tail Attack on Kael.");
});

test("an option with two ways to play is two cards, and a move or a spell asks for its square or its spell", () => {
  const actions = {
    speed: "30 ft.", attacks: [], abilities: [], refusal: null, acted: false, manual: [],
    legendary: {
      left: 3, max: 3,
      options: [
        { name: "Attack", cost: 1, text: "", refusal: null, routes: [
          { use: "Rotting Fist", how: "One Rotting Fist attack", target: "one", rows: true, pick: "foes", attack: { name: "Rotting Fist", toHit: 9, damage: "3d6+4", type: "bludgeoning", range: "5 ft", melee: true, swings: ["Rotting Fist"] } },
          { use: "Dreadful Glare", how: "WIS save DC 16 on one creature", target: "one", most: 1, rows: true, pick: "foes", ability: { name: "Dreadful Glare", save: "wis", dc: 16, condition: "frightened" } },
        ] },
        { name: "Move", cost: 1, text: "", refusal: null, routes: [{ use: "Move", how: "Moves up to 30 ft without opportunity attacks", target: "none", rows: false, pick: "foes", square: { feet: 30, optional: false } }] },
        { name: "Cantrip", cost: 1, text: "", refusal: null, routes: [{ use: "Cantrip", how: "Casts a cantrip from its list", target: "many", rows: true, pick: "foes", spells: ["Ray of Frost"] }] },
        { name: "Shimmering Shield", cost: 2, text: "", refusal: null, routes: [{ use: "Shimmering Shield", how: "+2 AC", target: "one", rows: true, pick: "allies" }] },
        { name: "Hum", cost: 1, text: "The creature hums.", refusal: null, routes: [] },
      ],
    },
  };
  const cards = deriveMonsterHand({ id: "m1", name: "Mummy Lord", status: "alive", conditions: [], actions }, { legendaryCards: true }).filter((card) => card.cost === "legendary");
  assert.deepEqual(cards.map((card) => card.name), ["Attack: Rotting Fist", "Attack: Dreadful Glare", "Move", "Cantrip", "Shimmering Shield", "Hum"]);
  assert.deepEqual(monsterCalls(cards[1], ["s1"]), [{ name: "legendary_action", args: { enemyId: "m1", action: "Attack", use: "Dreadful Glare", targetCharacterId: "s1" } }]);
  assert.deepEqual(cards[2].intent.square, { feet: 30, optional: false });
  assert.deepEqual(monsterCalls(cards[2], [], "none", new Set(), { square: { x: 4, y: 7 } }), [{ name: "legendary_action", args: { enemyId: "m1", action: "Move", x: 4, y: 7 } }]);
  assert.deepEqual(cards[3].intent.spells, ["Ray of Frost"]);
  assert.deepEqual(monsterCalls(cards[3], ["s1"], "none", new Set(), { spell: "Ray of Frost" }), [{ name: "legendary_action", args: { enemyId: "m1", action: "Cantrip", characterIds: ["s1"], spell: "Ray of Frost" } }]);
  assert.equal(cards[4].intent.pick, "allies", "a shield goes on its own side");
  // The line the server cannot read: the spend, and the card says the rest is the GM's.
  assert.equal(cards[5].target, "none");
  assert.match(cards[5].rules, /cannot read this option: playing it spends the action, and you resolve the rest by hand/);
  assert.deepEqual(monsterCalls(cards[5], []), [{ name: "legendary_action", args: { enemyId: "m1", action: "Hum" } }]);
});

test("the lair's options are offered on its initiative count 20 only, on the card of the creature that prints them, numbered as lair_action takes them", () => {
  // The count has not passed: no lair cards.
  assert.equal(lairChoices([dragon()], { lair: true, lairUsedRound: 0 }), null);
  assert.equal(enemyActionsView(encounter(), dragon(), undefined, lairChoices([dragon()], encounter().legendary)).lair, undefined);
  // It passed, and the lair has acted on it: none either.
  assert.equal(lairChoices([dragon()], { lair: true, lairUsedRound: 2, lairDue: 2 }), null);
  const fight = lairFight();
  const choices = lairChoices([enemy({ id: "e0", displayName: "Goblin" }), dragon()], fight.legendary);
  assert.deepEqual(choices.map((choice) => [choice.number, choice.enemyId]), [[1, "e1"], [2, "e1"]]);
  const view = enemyActionsView(fight, dragon(), undefined, choices);
  assert.deepEqual(view.lair.map((option) => option.number), [1, 2]);
  const [magma, shake] = deriveMonsterHand({ id: "e1", name: "Vermithrax", status: "alive", conditions: [], actions: view }, { legendaryCards: true }).filter((card) => card.cost === "lair");
  assert.equal(magma.name, "Lair: Magma erupts from a…");
  assert.equal(shake.name, "Lair: The ground shakes");
  assert.equal(shake.roll, "DEX save DC 15");
  assert.equal(takesManyTargets(shake), true);
  assert.deepEqual(monsterCalls(shake, ["s1"], "none", new Set(["e2"])), [
    { name: "lair_action", args: { action: "2" } },
    { name: "aoe_damage", args: { characterIds: ["s1"], dc: 15, saveAbility: "dex", condition: "prone", reason: "The lair acts" } },
  ]);
  assert.deepEqual(monsterCalls(magma, ["s1", "e2"], "none", new Set(["e2"]))[1].args, {
    characterIds: ["s1"], enemyIds: ["e2"], dc: 15, saveAbility: "dex", damage: "6d6", type: "fire", halfOnSave: true, reason: "The lair acts",
  });
  assert.equal(monsterSentence("Vermithrax", shake, ["Kael"]), "The lair acts on Kael.");
});

test("a lair option the block forbids two rounds running is held with lair_action's own sentence", () => {
  const block = { ...dragonBlock, traits: [...dragonBlock.traits, "The dragon can't use the same effect two rounds in a row."] };
  const shaken = "The ground shakes; each creature makes a DC 15 Dex save or falls prone.";
  const fight = lairFight({ lairUsedRound: 1, lairLast: shaken });
  const choices = lairChoices([dragon({ stats: block })], fight.legendary);
  assert.equal(choices[0].refusal, null);
  assert.match(choices[1].refusal, /^The lair cannot use the same effect two rounds in a row; it used this one last round\. Choose another: Magma erupts/);
});

test("a lair line's save as aoe_damage takes it: no damage on a success unless the line halves it", () => {
  assert.equal(lairSave("Each creature makes a DC 13 Strength saving throw or takes 10 (3d6) bludgeoning damage.").halfOnSave, false);
  assert.match(lairResolution("Each creature makes a DC 13 Strength saving throw or takes 10 (3d6) bludgeoning damage."), /type "bludgeoning", halfOnSave false/);
  assert.equal(lairSave(dragonBlock.traits[5].replace(/^Lair action: /, "")).halfOnSave, true);
  assert.doesNotMatch(lairResolution(dragonBlock.traits[5].replace(/^Lair action: /, "")), /halfOnSave/);
  assert.equal(lairTitle("Magma erupts."), "Magma erupts");
});

console.log(`\n${passed} monster hand checks passed`);
