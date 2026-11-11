// Named leftovers of the week's reaction pull requests, checked for the whole
// table instead of the one feature each body named.
//
//   #773 "An ally beyond 10 feet still gets the card, and the engine refuses it."
//   #780 "Warding Flare's card for an ally comes up at any range, and the engine
//        refuses one beyond 30 feet."
//   #773 "The other attack reactions (Soul of Vengeance, Opportunist, Hold the
//        Line and so on) still borrow the readied condition, so on the holder's
//        own turn they spend the Action, and they can take a readied action the
//        holder already holds."
//   #777 "A holder stunned before the hit can get an enabled at-zero card that
//        the engine refuses, spending nothing."
//
// Each was fixed for the feature it named. The generator below walks every
// reaction row of the authored table (authoredRows(), src/lib/srd/
// authored-effects.ts) and holds the same property for each:
//
//   REACH   a reaction that covers an ally within N feet: beyond N the Hand
//           deals no card and the engine refuses with nothing spent; within N
//           the engine takes it (so the refusal is the reach and not the rig).
//   STRIKE  a reaction with a reach to the attacker: the same two ways.
//   OWN     a reaction that is one weapon attack: on the holder's own turn it
//           is refused or costs no Action, and off it a readied action stays.
//   SHUT    a holder stunned before the hit: the card is shut exactly when the
//           engine refuses, and a refusal spends nothing.
import assert from "node:assert/strict";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { limitsSuite } from "./lib/sweep-limits.mjs";
import { authoredText, limitsTable } from "./lib/sweep-limits-world.mjs";

// Hold the Line's row is gone with its reaction: the engine strikes when the
// creature moves (src/lib/dm/opportunity.ts), and the fighter clause suite's
// hold-the-line-moves-within-reach holds it.
const KNOWN = {};
// rowId -> why the generator cannot stage this row.
const SKIP = {
  "reach:fighter/Echo Knight/Shadow Martyr[echo manifested]": "the reach is to the fighter's echo, and the feature's text states no distance between the echo and the creature attacked: the row names no reach to measure. The echo stands on the board since src/lib/dm/mt-fb-echo.ts (finding L787-echo).",
};

const { row, finish } = limitsSuite("test-enforce-sweep-limits-reach", { KNOWN, SKIP });
const world = await openWorld({ campaign: { maxPlayers: 400 } });
const table = await limitsTable(world);
const { kit } = table;
const { authoredRows } = await import("../src/lib/srd/authored-effects.ts");
const { placeSpellZone } = await import("../src/lib/dm/zone-cast.ts");
const TEXT = authoredText();

const reachOf = (does, level = 20) => {
  // Measured from the holder, or from the holder's own area on the board
  // (nearZone: Guardian Coil reaches a creature within 10 feet of the tentacle).
  const range = does.rangeFt ?? does.nearZone?.feet;
  if (Array.isArray(range)) {
    return range.filter(([from]) => from <= level).at(-1)?.[1] ?? null;
  }
  return typeof range === "number" ? range : null;
};
const ALLY_KINDS = new Set(["reduce", "ac_vs_hit", "disadv_vs_hit", "reroll_hit", "resist_instance", "take_for_ally", "uncrit", "echo_takes_hit"]);
const coversAlly = (does) =>
  ALLY_KINDS.has(does.kind) && does.who !== "self" && !does.bond && (does.kind !== "disadv_vs_hit" || Boolean(does.allyWith)) && (does.kind !== "ac_vs_hit" || does.rangeFt !== undefined);

// What a gate asks of the holder, laid on the sheet as the feature that
// grants it would lay it.
function openGate(who, gate = {}) {
  const sheet = world.sheet(who.id);
  const conditions = [...sheet.conditions];
  if (gate.raging) conditions.push("raging");
  if (gate.condition) conditions.push(gate.condition);
  // An Abjurer's ward is up, as after their first abjuration of the day.
  const raised = sheet.resources?.sub_arcane_ward_raised;
  world.patch(who.id, { conditions, ...(raised ? { resources: { ...sheet.resources, sub_arcane_ward_raised: { max: raised.max, used: 1 } } } : {}) });
}

const reactions = [];
for (const entry of authoredRows()) {
  for (const reaction of entry.entry.reactions ?? []) {
    reactions.push({ entry, reaction, id: `${entry.classId}/${entry.entry.subclass ?? "-"}/${reaction.name}${reaction.gate?.condition ? `[${reaction.gate.condition}]` : ""}` });
  }
}
const ruleOf = (item) => {
  const text = TEXT.get(item.entry.key);
  return text ? `${item.entry.feature} (${text.subclass} ${text.level}): "${text.text}" (src/lib/srd/subclasses.json)` : `${item.entry.feature}: no authored text`;
};
const friend = table.hero({ class: "fighter", subclass: "Champion" });
const holders = new Map();
const holderOf = (item) => {
  const key = `${item.entry.classId}/${item.entry.entry.subclass}`;
  if (!holders.has(key)) {
    holders.set(key, table.hero({ class: item.entry.classId, subclass: item.entry.entry.subclass }));
  }
  return holders.get(key);
};
const FACES = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
const show = (out) => (out.ok ? JSON.stringify(out.result).slice(0, 200) : String(out.error));
// The dummy's club deals the damage type the reaction answers, when it names some.
const armFor = (enemy, does) => {
  if (does.types?.length) {
    kit.setEnemy(enemy.id, { stats: { attacks: [{ name: "Club", toHit: 4, damage: "1d6+2", type: does.types[0] }] } });
  }
};
const react = async (who, args) => {
  world.clearDice();
  world.dice(...FACES);
  const out = await world.invoke("use_reaction", { characterId: who.id, ...args });
  world.clearDice();
  return out;
};

// ---- REACH: an ally in the reach, and one beyond it ----

for (const item of reactions.filter((entry) => coversAlly(entry.reaction.does) && entry.reaction.usedBy !== "party" && entry.reaction.usedBy !== "inspired")) {
  const feet = reachOf(item.reaction.does);
  const id = `reach:${item.id}`;
  await row(id, {
    pr: "773/780",
    limit: `a card for an ally beyond its ${feet ?? "?"} feet is dealt and the engine refuses it`,
    rule: ruleOf(item),
  }, async () => {
    assert.ok(feet, `${item.id} covers an ally and names no reach`);
    const who = holderOf(item);
    const tiles = feet / 5;
    const setUp = async (apart, faces) => {
      const [enemy] = await table.stage([who, friend]);
      openGate(who, item.reaction.gate);
      // Along the board's long side: it is 20 tiles by 15, and 70 feet fits.
      kit.place(who.id, 1, 2);
      kit.place(friend.id, 1 + apart, 2);
      kit.place(enemy.id, 2 + apart, 2);
      armFor(enemy, item.reaction.does);
      // The holder's area stands where they do, so its reach is the row's.
      if (item.reaction.does.nearZone) {
        placeSpellZone(world.campaign(), { spell: item.reaction.does.nearZone.spell, caster: { kind: "pc", id: who.id, name: world.sheet(who.id).name }, at: { x: 1, y: 2 } });
      }
      await table.strike(enemy, friend, faces);
      return enemy;
    };
    // A critical for the reaction that answers one.
    const faces = item.reaction.does.kind === "uncrit" ? [20, 4, 4] : [16, 4];
    await setUp(Math.max(1, tiles - 1), faces);
    // The rig's own check: inside the reach the Hand deals the card, so "no
    // card" beyond it is the reach speaking and not a Hand that deals none.
    assert.ok(table.offered(who, item.reaction.name).some((card) => card.answers?.characterId === friend.id && !card.disabled), "inside its reach the Hand deals no open card for the ally's hit");
    const near = await react(who, { feature: item.reaction.name, targetCharacterId: friend.id });
    assert.equal(near.ok, true, `inside its reach the engine refused it, so this row proves nothing: ${near.error}`);
    await setUp(tiles + 2, faces);
    const before = table.ledger(who);
    const cards = table.offered(who, item.reaction.name).filter((card) => card.answers?.characterId === friend.id && !card.disabled);
    const far = await react(who, { feature: item.reaction.name, targetCharacterId: friend.id });
    assert.equal(far.ok, false, `${feet + 10} feet from the ally, the engine took it: ${show(far)}`);
    assert.match(far.error, /feet|reach|range|far/i, "the refusal is not about the distance, so this row proves nothing");
    assert.equal(table.ledger(who), before, `the refusal spent something: ${far.error}`);
    assert.equal(cards.length, 0, `an open card is dealt for an ally ${feet + 10} feet away, which the engine refuses ("${far.error}")`);
  });
}

// ---- STRIKE: the attacker in the reach, and beyond it ----

const strikesBack = (does) => ["strike_back", "echo_hit", "attack"].includes(does.kind) && typeof does.rangeFt === "number" && !does.afterSave;
// The thing a reaction held to its trigger's record answers (src/lib/srd/
// trigger-table.ts), staged in place of the creature's hit on the holder:
// Opportunist answers another creature's hit on the foe, Halo of Spores the
// foe starting its turn near. Either way the foe is the creature reached.
const { triggerSpecFor } = await import("../src/lib/srd/trigger-table.ts");
const { closeHitsAtTurnEnd } = await import("../src/lib/dm/last-hit.ts");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");
const triggerOf = (item) => (triggerSpecFor(item.reaction.name, { gateCondition: item.reaction.gate?.condition })?.on ?? []).map((on) => on.kind);
async function stageTrigger(item, enemy, struck, who) {
  const kinds = triggerOf(item);
  if (kinds.includes("struck_by_other")) {
    kit.giveTurn(friend.id);
    world.dice(18, 5);
    const hit = await world.invoke("pc_attack", { characterId: friend.id, targetEnemyId: enemy.id });
    world.clearDice();
    assert.equal(hit.ok, true, hit.error);
    return;
  }
  if (kinds.includes("save_on_self")) {
    // The holder's Slayer's Prey on the foe, then a save it forces on them.
    kit.giveTurn(who.id);
    const prey = await world.invoke("use_resource", { characterId: who.id, resource: "Slayer's Prey", targetEnemyId: enemy.id });
    assert.equal(prey.ok, true, prey.error);
    kit.giveTurn(friend.id);
    world.dice(1);
    const save = await world.invoke("cast_at_player", { characterId: who.id, casterEnemyId: enemy.id, saveAbility: "wis", dc: 25, condition: "frightened" });
    world.clearDice();
    assert.equal(save.ok, true, save.error);
    return;
  }
  if (kinds.includes("turn_start")) {
    kit.giveTurn(friend.id);
    const encounter = world.encounter();
    closeHitsAtTurnEnd(world.campaignId, encounter, encounter.order.find((entry) => entry.characterId === friend.id));
    const place = world.encounter().order.findIndex((entry) => entry.enemyId === enemy.id);
    saveEncounter({ ...world.encounter(), turnIndex: place, turnBudget: null });
    return;
  }
  await table.strike(enemy, struck);
}
for (const item of reactions.filter((entry) => strikesBack(entry.reaction.does) && entry.reaction.usedBy !== "party")) {
  const feet = item.reaction.does.rangeFt;
  const onAlly = item.reaction.does.kind === "echo_hit";
  await row(`strike:${item.id}`, {
    pr: "773/780",
    limit: `a reaction that reaches its attacker within ${feet} feet is refused beyond it, with nothing spent, and deals no card`,
    rule: ruleOf(item),
  }, async () => {
    const who = holderOf(item);
    const struck = onAlly ? friend : who;
    // `away`: squares beyond the holder's side the foe stands once the trigger
    // has happened beside them (a hit is made in reach, then it steps off).
    const setUp = async (away = 0) => {
      const [enemy] = await table.stage([who, friend]);
      openGate(who, item.reaction.gate);
      kit.place(who.id, 5, 2);
      kit.place(friend.id, 4, 2);
      kit.place(enemy.id, 5, 3);
      if (item.reaction.does.vowed) {
        kit.giveTurn(who.id);
        const vow = await world.invoke("use_resource", { characterId: who.id, resource: "channel_divinity", variant: "vow of enmity", targetEnemyId: enemy.id });
        assert.equal(vow.ok, true, vow.error);
        kit.giveTurn(friend.id);
      }
      await stageTrigger(item, enemy, struck, who);
      if (away) kit.place(enemy.id, 5, 3 + away);
      return enemy;
    };
    const args = (enemy) => ({ feature: item.reaction.name, targetEnemyId: enemy.id, ...(onAlly ? { targetCharacterId: friend.id } : {}) });
    const close = await setUp();
    if (item.reaction.does.kind !== "attack" || item.reaction.does.vowed) {
      assert.ok(table.offered(who, item.reaction.name).some((card) => !card.disabled), "beside the attacker the Hand deals no open card");
    }
    const near = await react(who, args(close));
    assert.equal(near.ok, true, `beside the attacker the engine refused it, so this row proves nothing: ${near.error}`);
    const enemy = await setUp(feet / 5 + 2);
    const before = table.ledger(who);
    const cards = table.offered(who, item.reaction.name).filter((card) => !card.disabled);
    const far = await react(who, args(enemy));
    assert.equal(far.ok, false, `the attacker ${feet + 15} feet away, the engine took it: ${show(far)}`);
    assert.match(far.error, /feet|reach|range|far/i, "the refusal is not about the distance, so this row proves nothing");
    assert.equal(table.ledger(who), before, `the refusal spent something: ${far.error}`);
    assert.equal(cards.length, 0, `an open card is dealt against an attacker ${feet + 15} feet away, which the engine refuses ("${far.error}")`);
  });
}

// ---- OWN: an attack made with the reaction is not the turn's Action ----

for (const item of reactions.filter((entry) => (entry.reaction.does.kind === "attack" || entry.reaction.does.strikeOnMiss) && entry.reaction.usedBy !== "party")) {
  await row(`own-turn:${item.id}`, {
    pr: "773",
    limit: "an attack reaction borrows the readied condition: on the holder's own turn it spends the Action, and it takes a readied action already held",
    rule: `${ruleOf(item)}; SRD 5.1, Reactions: "A reaction is an instant response to a trigger of some kind, which can occur on your turn or on someone else's."`,
  }, async () => {
    const who = holderOf(item);
    const setUp = async (turnOf) => {
      const [enemy] = await table.stage([who, friend]);
      openGate(who, item.reaction.gate);
      kit.place(who.id, 5, 2);
      kit.place(friend.id, 4, 2);
      kit.place(enemy.id, 5, 3);
      if (item.reaction.does.vowed) {
        kit.giveTurn(who.id);
        const vow = await world.invoke("use_resource", { characterId: who.id, resource: "channel_divinity", variant: "vow of enmity", targetEnemyId: enemy.id });
        assert.equal(vow.ok, true, vow.error);
      }
      kit.giveTurn(turnOf.id);
      return enemy;
    };
    // On the holder's own turn, a hit on them open.
    let enemy = await setUp(who);
    // A 10 on the die is a 14: through AC 12, not through a raised one.
    await table.strike(enemy, who, [10, 4]);
    const own = await react(who, { feature: item.reaction.name, targetEnemyId: enemy.id });
    const budget = world.encounter().turnBudget;
    assert.ok(!budget || (budget.actionUsed !== true && !(budget.attacksMade > 0)), `on the holder's own turn it spent the turn's Action: ${JSON.stringify(budget)} (${own.ok ? "taken" : own.error})`);
    // Off their turn, holding a readied move.
    enemy = await setUp(friend);
    const sheet = world.sheet(who.id);
    world.patch(who.id, {
      conditions: [...sheet.conditions, "readied"],
      conditionMeta: { ...sheet.conditionMeta, readied: { untilTurnOf: who.id, holds: "move", trigger: "when the goblin moves" } },
    });
    await table.strike(enemy, who, [10, 4]);
    await react(who, { feature: item.reaction.name, targetEnemyId: enemy.id });
    assert.equal(world.sheet(who.id).conditionMeta?.readied?.holds, "move", "the readied move the holder held is gone");
  });
}

// ---- TRIGGER: an attack reaction answers something that happened ----
//
// #773: "I left them because the engine doesn't check most of their triggers,
// so moving them to reactionAttack would open a free attack on the holder's
// own turn." #776: "The engine doesn't check that a save happened." The own
// turn is now refused; this asks the same of every other turn: with nothing
// on record that the text names (no hit, no save, no move), the attack is
// refused, and with no card for it the player has no way to play it.
for (const item of reactions.filter((entry) => entry.reaction.does.kind === "attack")) {
  await row(`trigger:${item.id}`, {
    pr: "773/776",
    limit: "the engine doesn't check the trigger of an attack reaction: named off the holder's turn, it attacks",
    rule: ruleOf(item),
  }, async () => {
    const who = holderOf(item);
    const [enemy] = await table.stage([who, friend], { first: friend });
    openGate(who, item.reaction.gate);
    kit.place(who.id, 5, 2);
    kit.place(friend.id, 4, 2);
    kit.place(enemy.id, 5, 3);
    // Nobody has moved, struck, been struck or saved since the fight opened.
    assert.equal(table.hits().length, 0);
    const before = table.ledger(who);
    const out = await react(who, { feature: item.reaction.name, targetEnemyId: enemy.id });
    assert.equal(out.ok, false, `with no trigger on record the engine made the attack: ${show(out)}`);
    assert.equal(table.ledger(who), before, "the refusal spent something");
  });
}

// ---- SHUT: stunned before the hit ----

for (const item of reactions.filter((entry) => entry.reaction.usedBy !== "party" && entry.reaction.usedBy !== "inspired")) {
  await row(`stunned:${item.id}`, {
    pr: "777",
    limit: "a holder stunned before the hit gets an enabled card that the engine refuses",
    rule: `SRD 5.1, Stunned: "A stunned creature is incapacitated"; Incapacitated: "An incapacitated creature can't take actions or reactions." ${ruleOf(item)}`,
  }, async () => {
    const who = holderOf(item);
    const [enemy] = await table.stage([who, friend]);
    openGate(who, item.reaction.gate);
    kit.place(who.id, 5, 2);
    kit.place(friend.id, 4, 2);
    kit.place(enemy.id, 5, 3);
    const sheet = world.sheet(who.id);
    world.patch(who.id, { conditions: [...sheet.conditions, "stunned"], conditionMeta: { ...sheet.conditionMeta, stunned: { rounds: 10 } } });
    // One hit on the holder (advantage on the stunned: two d20s) and one on the ally.
    await table.strike(enemy, who, [16, 16, 4]);
    await table.strike(enemy, friend, [16, 4]);
    const before = table.ledger(who);
    const open = table.offered(who, item.reaction.name).filter((card) => !card.disabled);
    for (const args of [{}, { targetCharacterId: friend.id }, { targetEnemyId: enemy.id }]) {
      const out = await react(who, { feature: item.reaction.name, ...args });
      assert.equal(out.ok, false, `stunned, the engine took the reaction (${JSON.stringify(args)}): ${show(out)}`);
    }
    assert.equal(table.ledger(who), before, "a refused reaction spent something");
    assert.equal(open.length, 0, `stunned, ${open.length} open card(s) are dealt: ${open.map((card) => card.name).join(", ")}`);
  });
}

await kit.endFight();
world.close();
finish();
