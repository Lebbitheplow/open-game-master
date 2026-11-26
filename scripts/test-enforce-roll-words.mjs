// The first family's sites, each through its own door (issue #1064, step 2).
//
// A character's own attacks and their damage write no sentence any more:
// the site says what the roll is in fields, the door stores the English
// sentence built from them, and a card is worded from the fields in the
// reader's language (src/lib/roll-words.ts). Each case runs a real call and
// holds every roll it stored to three things:
//
//   - its stored sentence is the one the site wrote by hand before, which
//     the case writes out as the site built it (roll-labels.ts rollAgainst
//     and the words in brackets);
//   - its parts make its words (`worded`), and name what was used, whom it
//     is against and the engine's note;
//   - a French table's card reads in French.
//
// The sites:
//   - pc_attack on the server's dice: the attack roll, the damage of a hit
//     and the half a spell deals on a miss (src/lib/dm/pc-attack-resolve.ts);
//   - pc_attack on the player's own dice: the two roll cards, what a seat is
//     sent of them, and the rolls they land as
//     (src/lib/dm/pc-attack-parked.ts);
//   - an attack card dealt by a build from before this one, landing now:
//     its roll keeps the sentence the card was dealt with, and the damage
//     it asks for is worded from the attack's record;
//   - a character's opportunity attack and its damage
//     (src/lib/dm/opportunity-strike.ts);
//   - a swing at a creature the GM keeps off the board, as the table is
//     sent it: "vs someone unseen", with neither its name nor its id;
//   - an unarmed strike and a weapon thrown as an improvised one, which
//     are rows the engine names though they have no weapon's profile;
//   - a hidden creature on the paths outside the stream: a reload, GET
//     /rolls, a waiting card;
//   - the door's refusal of a roll, or a card, with no words at all;
//   - the parked paths of pc-attack-parked.ts the others do not reach: the
//     damage card of a spell's half on a miss, and a player who may still
//     choose (a luck point) with the roll thrown and waiting: kept as a
//     miss that still deals half, and turned into a hit;
//   - a weapon swung at an object, named or not
//     (src/lib/dm/object-damage.ts).
//
// With the sites' old code put back (a `detail` written by hand), every case
// fails on the roll's parts.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-roll-words");
const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { dicePolicy: "real_allowed" } });
const kit = await combatKit(world);

const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { listOpenPendingRolls, publicPendingRoll } = await import("../src/lib/db/dm-turns.ts");
const { setTokenHidden } = await import("../src/lib/db/battle-maps.ts");
const { tablePayloadFor } = await import("../src/lib/table-delivery.ts");
const { recordRoll } = await import("../src/lib/dm/roll-record.ts");
const { rollExpression } = await import("../src/lib/dice.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { entryDice } = await import("../src/lib/dice.ts");
const { translate } = await import("../src/lib/i18n/translate.ts");
const { textKey } = await import("../src/lib/language/text-logic.ts");
await import("../src/lib/i18n/fr-catalog.ts");
const { pendingReason, pendingWords, rollAgainst, rollCardLabel } = await import("../src/lib/roll-labels.ts");
const { rollPhysical, rollWeaponRow } = await import("../src/lib/roll-parts.ts");
const { PHYSICAL, rollSentence, WORDS_VERSION } = await import("../src/lib/roll-words.ts");
const afterRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");
const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");

const fr = Object.assign((key, vars) => translate("fr", key, vars), { locale: "fr" });

const CASTING = {
  ability: "int",
  slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } },
  prepared: ["Acid Arrow"],
  known: [],
  cantrips: ["Fire Bolt"],
};
const GEAR = [{ name: "Longsword", qty: 1, equipped: true }, { name: "Component pouch", qty: 1 }];
const hero = world.addHero({ name: "Aria", class: "wizard", level: 5, maxHp: 44, abilities: { str: 16, dex: 14, int: 16 }, proficiencies: TRAINED, equipment: GEAR, spellcasting: CASTING });
const ally = world.addHero({ name: "Borin", class: "fighter", level: 5, maxHp: 44, abilities: { str: 14 }, proficiencies: TRAINED, equipment: GEAR });

const realDice = (on) => setMemberRealDice(world.campaignId, hero.userId, on);
const forget = () => {
  getDatabase().prepare("DELETE FROM pending_rolls WHERE campaign_id = ?").run(world.campaignId);
  getDatabase().prepare("DELETE FROM rolls WHERE campaign_id = ?").run(world.campaignId);
};
const stored = () => listRecentRolls(world.campaignId, 40);

// A fight with the hero beside one creature. `first`: whose turn it is.
async function stage(first = hero) {
  realDice(false);
  await kit.endFight();
  for (const sheet of [hero, ally]) {
    world.patch(sheet.id, { currentHp: 44, conditions: [], conditionMeta: {}, concentration: null });
  }
  world.patch(hero.id, { spellcasting: CASTING, equipment: GEAR });
  const second = first === hero ? ally : hero;
  await kit.fight(1, { heroFaces: { [first.id]: 19, [second.id]: 5 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400, ac: 12 });
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.place(ally.id, 9, 9);
  forget();
  return kit.enemy(enemy.id);
}

// One roll held to the three things: the old sentence, its parts, its card.
function holds(roll, { before, used, target, note, french, physical = false }) {
  const what = `${roll.kind} "${roll.detail}"`;
  assert.equal(roll.detail, physical ? `${before} ${PHYSICAL}` : before, `${what}: the stored sentence is not the one the site wrote before`);
  assert.equal(roll.parts?.worded, WORDS_VERSION, `${what}: its parts do not make its words, so its site wrote the sentence`);
  assert.equal(roll.detail, rollSentence(roll), `${what}: the stored sentence is not the one its parts make`);
  assert.deepEqual(roll.parts.used, used, `${what}: what was used`);
  assert.deepEqual(roll.parts.targets, [target], `${what}: whom it is against`);
  assert.deepEqual(roll.parts.notes, note ? [{ engine: note }] : undefined, `${what}: its notes`);
  assert.equal(rollPhysical(roll), physical, `${what}: whose dice`);
  const kind = translate("fr", roll.kind === "attack" ? "Attack roll" : "Damage");
  assert.equal(rollCardLabel(fr, roll, hero.name), `${hero.name} · ${kind} (${french}${physical ? " (dés physiques)" : ""})`, `${what}: a French table's card`);
}

const LONGSWORD = { kind: "weapon", key: "longsword", name: "Longsword" };
const FIRE_BOLT = { kind: "spell", key: "fire bolt", name: "Fire Bolt" };
const ACID_ARROW = { kind: "spell", key: "acid arrow", name: "Acid Arrow" };

await test("pc_attack on the server's dice: the attack roll and the damage of a hit say the weapon and the creature in fields, store the sentence the site wrote before, and read in French", async () => {
  const enemy = await stage();
  const target = { kind: "enemy", id: enemy.id, name: enemy.displayName };
  // The d20 (a hit on AC 12), then the sword's d8.
  const swing = await kit.swing(hero.id, enemy.id, [15, 4], { weapon: "Longsword" });
  assert.equal(swing.ok, true, `refused: ${swing.error}`);
  assert.ok(swing.toHit && swing.damage, "the swing stored no attack roll and damage");
  const said = { before: rollAgainst("Longsword", enemy.displayName), used: LONGSWORD, target, french: `Épée longue c/ ${enemy.displayName}` };
  holds(swing.toHit, said);
  holds(swing.damage, said);
  // What step 1 reads back still stands: the weapon of the last attack roll.
  assert.equal(rollWeaponRow(swing.toHit, world.sheet(hero.id).equipment)?.name, "Longsword");
});

await test("pc_attack with a spell attack: the roll says the spell, and the half an Acid Arrow deals on a miss carries the engine's own note", async () => {
  const enemy = await stage();
  const target = { kind: "enemy", id: enemy.id, name: enemy.displayName };
  // A ranged attack beside a foe is at disadvantage: two d20s, then the dice.
  const bolt = await kit.swing(hero.id, enemy.id, [15, 15, 4, 4], { spell: "Fire Bolt" });
  assert.equal(bolt.ok, true, `refused: ${bolt.error}`);
  // The content knows the spell, so its roll names the row.
  holds(bolt.toHit, { before: rollAgainst("Fire Bolt", enemy.displayName), used: FIRE_BOLT, target, french: `Trait de feu c/ ${enemy.displayName}` });
  holds(bolt.damage, { before: rollAgainst("Fire Bolt", enemy.displayName), used: FIRE_BOLT, target, french: `Trait de feu c/ ${enemy.displayName}` });
  // A new turn for the arrow: a 2 misses AC 12, and the spell still deals half.
  await stage();
  const [again] = world.enemies();
  const onAgain = { kind: "enemy", id: again.id, name: again.displayName };
  const arrow = await kit.swing(hero.id, again.id, [2, 2, 3, 3, 3, 3], { spell: "Acid Arrow" });
  assert.equal(arrow.ok, true, `refused: ${arrow.error}`);
  assert.equal(arrow.result.hit, false, "the arrow was meant to miss");
  holds(arrow.toHit, { before: rollAgainst("Acid Arrow", again.displayName), used: ACID_ARROW, target: onAgain, french: `Flèche acide c/ ${again.displayName}` });
  assert.ok(arrow.damage, "the miss rolled no half damage");
  holds(arrow.damage, {
    before: rollAgainst(`${"Acid Arrow"} (half on a miss)`, again.displayName),
    used: ACID_ARROW,
    target: onAgain,
    note: "half_on_miss",
    french: `Flèche acide (moitié sur un raté) c/ ${again.displayName}`,
  });
  // The spell answers to two names, and which one its content row keeps
  // depends on the content: the bundled data's, or a content pack's. Cast
  // under either, the roll's key is the name it was cast under, so the key
  // and the name never disagree and the card reads as the reader this
  // replaces read it. Keyed by the row's own name, the one that is the alias
  // here lost its French: "Acid Arrow" on a server with no pack.
  for (const cast of ["Acid Arrow", "Melf's Acid Arrow"]) {
    await stage();
    const [foe] = world.enemies();
    const out = await kit.swing(hero.id, foe.id, [2, 2, 3, 3, 3, 3], { spell: cast });
    assert.equal(out.ok, true, `${cast} refused: ${out.error}`);
    const french = translate("fr", "Attack roll");
    assert.equal(out.toHit.detail, rollAgainst(cast, foe.displayName));
    // The same roll with no parts is read by its sentence, as before.
    const old = rollCardLabel(fr, { ...out.toHit, parts: null }, hero.name);
    assert.deepEqual(out.toHit.parts.used, { kind: "spell", key: textKey(cast), name: cast }, `cast as "${cast}": what was used`);
    assert.equal(rollCardLabel(fr, out.toHit, hero.name), old, `cast as "${cast}": a French table's card is not what the old reader made of the same words`);
    assert.ok(old.startsWith(`${hero.name} · ${french} (`), old);
  }
});

// The seat enters its own dice for every card parked, until none waits.
async function enterParked(faceFor) {
  const cards = [];
  for (let round = 0; round < 6; round += 1) {
    const open = listOpenPendingRolls(world.campaignId).filter((pending) => pending.userId === hero.userId && pending.parkedFor === "real_dice");
    if (!open.length) {
      break;
    }
    for (const pending of open) {
      cards.push(pending);
      world.signIn({ id: hero.userId });
      const landed = await call(submitRoute, "POST", { dice: entryDice(pending.expression).map(faceFor) }, { campaignId: world.campaignId, pendingRollId: pending.id });
      assert.equal(landed.status, 200, `the seat's ${pending.kind} was not taken: ${JSON.stringify(landed.json).slice(0, 200)}`);
    }
  }
  return cards;
}

await test("pc_attack on the player's own dice: both roll cards are worded from their fields, a seat is sent the fields that make the words and no more, and the rolls land as the player's own", async () => {
  const enemy = await stage();
  const target = { kind: "enemy", id: enemy.id, name: enemy.displayName };
  realDice(true);
  const out = await kit.attack(hero.id, enemy.id, { weapon: "Longsword" });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  const cards = await enterParked((sides) => (sides === 20 ? 15 : 4));
  realDice(false);
  assert.deepEqual(cards.map((card) => card.kind), ["attack", "damage"], "the seat was dealt an attack card and, on the hit, a damage card");
  const before = rollAgainst("Longsword", enemy.displayName);
  for (const card of cards) {
    assert.equal(card.detail, before, `the ${card.kind} card keeps the sentence the site wrote before`);
    assert.equal(card.parts?.worded, WORDS_VERSION, `the ${card.kind} card's site wrote its sentence`);
    // What every seat is sent of the card: the fields that make its words,
    // and the creature by its name alone.
    const sent = publicPendingRoll(card);
    assert.deepEqual(sent.parts, { used: LONGSWORD, targets: [{ kind: "enemy", name: enemy.displayName }], aim: "vs", worded: WORDS_VERSION });
    assert.equal(pendingWords(fr, sent), `Épée longue c/ ${enemy.displayName}`, `the ${card.kind} card in French`);
    // The line under its title: kept in the English its site wrote by hand
    // before, said in fields, and read in the player's language.
    assert.equal(card.reason, `Longsword ${card.kind} against ${enemy.displayName}`, `the ${card.kind} card's reason is not the line the site wrote before`);
    assert.deepEqual(sent.carry?.line, { steps: [] }, `the ${card.kind} card's line is not said in fields`);
    assert.equal(pendingReason(fr, sent, true), `Épée longue : ${card.kind === "attack" ? "attaque" : "dégâts"} contre ${enemy.displayName}`, `the ${card.kind} card's line in French`);
  }
  const [toHit, damage] = ["attack", "damage"].map((kind) => stored().find((roll) => roll.kind === kind));
  assert.ok(toHit && damage, "the cards landed no attack roll and damage");
  const said = { before, used: LONGSWORD, target, french: `Épée longue c/ ${enemy.displayName}`, physical: true };
  holds(toHit, said);
  holds(damage, said);
});

await test("an attack card dealt before the sites said their words in fields lands by the sentence it was dealt with, and the damage it asks for says its words in fields", async () => {
  const enemy = await stage();
  realDice(true);
  const out = await kit.attack(hero.id, enemy.id, { weapon: "Longsword" });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  // As the build before dealt it: the weapon as a field, the words by hand.
  const [dealt] = listOpenPendingRolls(world.campaignId);
  getDatabase().prepare("UPDATE pending_rolls SET detail = ?, parts_json = ? WHERE id = ?").run("Longsword vs the Goblin of old", JSON.stringify({ used: LONGSWORD }), dealt.id);
  const cards = await enterParked((sides) => (sides === 20 ? 15 : 4));
  realDice(false);
  assert.deepEqual(cards.map((card) => card.kind), ["attack", "damage"]);
  const [toHit, damage] = ["attack", "damage"].map((kind) => stored().find((roll) => roll.kind === kind));
  assert.equal(toHit.detail, `Longsword vs the Goblin of old ${PHYSICAL}`, "the old card's roll did not keep its sentence");
  assert.deepEqual(toHit.parts, { used: LONGSWORD, physical: true });
  assert.equal(rollWeaponRow(toHit, world.sheet(hero.id).equipment)?.name, "Longsword");
  assert.equal(rollCardLabel(fr, toHit, hero.name), `${hero.name} · Jet d’attaque (Épée longue c/ the Goblin of old (physical))`, "a roll with its site's sentence is shown by it, with what the old reader could put into French");
  holds(damage, { before: rollAgainst("Longsword", enemy.displayName), used: LONGSWORD, target: { kind: "enemy", id: enemy.id, name: enemy.displayName }, french: `Épée longue c/ ${enemy.displayName}`, physical: true });
});

await test("a character's opportunity attack and its damage carry the engine's note for it, in the words the site wrote before", async () => {
  const enemy = await stage(ally);
  const target = { kind: "enemy", id: enemy.id, name: enemy.displayName };
  // On a map the server rolls the reaction itself as the creature leaves
  // the character's reach, on the creature's own turn.
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => entry.kind === "enemy"), turnBudget: null });
  world.clearDice();
  world.dice(15, 4);
  const out = await world.invoke("move_token", { token: enemy.id, x: 5, y: 12, reason: "it runs" });
  world.clearDice();
  assert.equal(out.ok, true, `refused: ${out.error}`);
  const [toHit, damage] = ["attack", "damage"].map((kind) => stored().find((roll) => roll.kind === kind));
  assert.ok(toHit && damage, "the reaction stored no attack roll and damage");
  const said = {
    before: rollAgainst(`${"Longsword"} (opportunity attack)`, enemy.displayName),
    used: LONGSWORD,
    target,
    note: "opportunity",
    french: `Épée longue (attaque d’opportunité) c/ ${enemy.displayName}`,
  };
  holds(toHit, said);
  holds(damage, said);
});

await test("a weapon swung at an object names the object as it was typed, and one nobody named reads \"an object\" in the reader's language", async () => {
  realDice(false);
  await kit.endFight();
  forget();
  const door = { material: "wood", size: "medium", characterId: hero.id, weapon: "Longsword", reason: "breaking in" };
  for (const [name, target, french] of [["a door", { kind: "object", name: "a door" }, "Épée longue c/ a door"], [undefined, { kind: "object" }, "Épée longue c/ un objet"]]) {
    forget();
    world.clearDice();
    world.dice(19, 4);
    const out = await world.invoke("damage_object", { ...door, ...(name ? { name } : {}) });
    world.clearDice();
    assert.equal(out.ok, true, `refused: ${out.error}`);
    const [toHit, damage] = ["attack", "damage"].map((kind) => stored().find((roll) => roll.kind === kind));
    assert.ok(toHit && damage, "the swing stored no attack roll and damage");
    const said = { before: rollAgainst("Longsword", name ?? "an object"), used: LONGSWORD, target, french };
    holds(toHit, said);
    holds(damage, said);
  }
});

await test("the damage card of a spell's half on a miss, dealt to a player on their own dice, carries the engine's note and lands as theirs", async () => {
  const enemy = await stage();
  const target = { kind: "enemy", id: enemy.id, name: enemy.displayName };
  realDice(true);
  const out = await kit.attack(hero.id, enemy.id, { spell: "Acid Arrow" });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  // A 2 on each d20 misses AC 12; the spell still asks for its dice.
  const cards = await enterParked((sides) => (sides === 20 ? 2 : 3));
  realDice(false);
  assert.deepEqual(cards.map((card) => card.kind), ["attack", "damage"], "the miss dealt no card for the half it still deals");
  const half = rollAgainst(`${"Acid Arrow"} (half on a miss)`, enemy.displayName);
  assert.equal(cards[1].detail, half);
  assert.deepEqual(publicPendingRoll(cards[1]).parts, { used: ACID_ARROW, targets: [{ kind: "enemy", name: enemy.displayName }], aim: "vs", notes: [{ engine: "half_on_miss" }], worded: WORDS_VERSION });
  holds(stored().find((roll) => roll.kind === "damage"), { before: half, used: ACID_ARROW, target, note: "half_on_miss", french: `Flèche acide (moitié sur un raté) c/ ${enemy.displayName}`, physical: true });
});

// A held Bardic Inspiration die: a miss it could turn waits on its player,
// thrown, before anything is recorded (pc-attack-parked.ts throwForChoice).
const BARDIC = { conditions: ["bardic inspiration (d8)"] };
const choose = (pending, body) => {
  world.signIn({ id: hero.userId });
  return call(afterRoute, "POST", body, { campaignId: world.campaignId, pendingRollId: pending.id });
};

await test("an attack thrown and waiting on its player's choice is a card worded from its fields, and the hit they turn it into rolls its damage on the server's dice, both in the words the site wrote before", async () => {
  const enemy = await stage();
  const target = { kind: "enemy", id: enemy.id, name: enemy.displayName };
  world.patch(hero.id, BARDIC);
  forget();
  // A 3 comes to 9 against AC 12: the die could still turn it.
  const swing = await kit.swing(hero.id, enemy.id, [3], { weapon: "Longsword" });
  assert.equal(swing.ok, true, `refused: ${swing.error}`);
  const [waiting] = listOpenPendingRolls(world.campaignId);
  assert.equal(waiting?.parkedFor, "after_roll", "the miss did not wait on the held die");
  const before = rollAgainst("Longsword", enemy.displayName);
  assert.equal(waiting.detail, before);
  assert.equal(waiting.parts?.worded, WORDS_VERSION, "the waiting card's site wrote its sentence");
  assert.equal(pendingWords(fr, publicPendingRoll(waiting)), `Épée longue c/ ${enemy.displayName}`);
  // The die's 8, then the sword's d8.
  world.dice(8, 4);
  const used = await choose(waiting, { use: "bardic" });
  world.clearDice();
  assert.equal(used.status, 200, JSON.stringify(used.json).slice(0, 200));
  const [toHit, damage] = ["attack", "damage"].map((kind) => stored().find((roll) => roll.kind === kind));
  assert.ok(toHit && damage, "the turned hit stored no attack roll and damage");
  holds(toHit, { before, used: LONGSWORD, target, french: `Épée longue c/ ${enemy.displayName}` });
  holds(damage, { before, used: LONGSWORD, target, french: `Épée longue c/ ${enemy.displayName}` });
});

await test("a spell attack kept as the miss it was thrown still deals its half on the server's dice, with the engine's note", async () => {
  const enemy = await stage();
  const target = { kind: "enemy", id: enemy.id, name: enemy.displayName };
  world.patch(hero.id, BARDIC);
  forget();
  // Beside a foe the arrow is at disadvantage: two 5s come to 11 against AC 12.
  const swing = await kit.swing(hero.id, enemy.id, [5, 5], { spell: "Acid Arrow" });
  assert.equal(swing.ok, true, `refused: ${swing.error}`);
  const [waiting] = listOpenPendingRolls(world.campaignId);
  assert.equal(waiting?.parkedFor, "after_roll", "the miss did not wait on the held die");
  assert.equal(waiting.detail, rollAgainst("Acid Arrow", enemy.displayName));
  world.dice(3, 3, 3, 3);
  const kept = await choose(waiting, { keep: true });
  world.clearDice();
  assert.equal(kept.status, 200, JSON.stringify(kept.json).slice(0, 200));
  const damage = stored().find((roll) => roll.kind === "damage");
  assert.ok(damage, "the kept miss rolled no half damage");
  holds(damage, { before: rollAgainst(`${"Acid Arrow"} (half on a miss)`, enemy.displayName), used: ACID_ARROW, target, note: "half_on_miss", french: `Flèche acide (moitié sur un raté) c/ ${enemy.displayName}` });
  world.patch(hero.id, { conditions: [] });
});

await test("a swing at a creature the GM keeps off the board reads \"vs someone unseen\" to the table, as it did, and the table is sent neither the creature's name nor its id", async () => {
  const enemy = await stage();
  setTokenHidden(kit.token(enemy.id).id, true);
  forget();
  // The GM has the character swing where the creature stands.
  const swing = await kit.swing(hero.id, enemy.id, [15, 15, 4], { weapon: "Longsword" });
  assert.equal(swing.ok, true, `refused: ${swing.error}`);
  const toHit = swing.toHit;
  assert.ok(toHit, "the swing at the hidden creature stored no attack roll");
  // On record the roll names the creature, for the seats owed it.
  assert.deepEqual(toHit.parts.targets, [{ kind: "enemy", id: enemy.id, name: enemy.displayName }]);
  // What the table is sent and the log keeps (src/lib/table-delivery.ts).
  const sent = tablePayloadFor(world.campaignId, "roll_result", { roll: toHit, source: "digital" }).roll;
  assert.deepEqual(sent.parts.targets, [{ kind: "unseen" }]);
  assert.equal(JSON.stringify(sent).includes(enemy.id), false, "the hidden creature's id rode the attack roll");
  assert.equal(JSON.stringify(sent).includes(enemy.displayName), false, "the hidden creature's name rode the attack roll");
  assert.equal(rollCardLabel(Object.assign((key) => key, { locale: "en" }), sent, hero.name), `${hero.name} · Attack roll (Longsword vs someone unseen)`);
  assert.equal(rollCardLabel(fr, sent, hero.name), `${hero.name} · Jet d’attaque (Épée longue c/ quelqu’un hors de vue)`);
});

await test("a waiting card of this family that was given no reason of its own does not say its words twice: an object's card shows them once, in the reader's language", async () => {
  realDice(false);
  await kit.endFight();
  forget();
  realDice(true);
  const out = await world.invoke("damage_object", { material: "wood", size: "medium", characterId: hero.id, weapon: "Longsword", reason: "breaking in" });
  const [card] = listOpenPendingRolls(world.campaignId).filter((pending) => pending.userId === hero.userId);
  assert.ok(card, `the swing dealt the seat no card: ${JSON.stringify(out).slice(0, 200)}`);
  const sent = publicPendingRoll(card);
  assert.equal(sent.reason, sent.detail, "the card was given a reason of its own");
  assert.equal(pendingWords(fr, sent), "Épée longue c/ un objet");
  assert.equal(pendingReason(fr, sent, true), "", "the card's English sentence is shown under its French title");
  assert.equal(pendingReason(fr, sent, false), "Épée longue c/ un objet");
  await enterParked((sides) => (sides === 20 ? 19 : 4));
  realDice(false);
});

await test("an unarmed strike, and a carried weapon thrown as an improvised one, are rows the engine names: their rolls carry the key and read in French", async () => {
  const enemy = await stage();
  const target = { kind: "enemy", id: enemy.id, name: enemy.displayName };
  const punch = await kit.swing(hero.id, enemy.id, [15, 1], { weapon: "unarmed strike" });
  assert.equal(punch.ok, true, `refused: ${punch.error}`);
  // The engine's own name for it, whatever case the call wrote.
  holds(punch.toHit, { before: rollAgainst("Unarmed strike", enemy.displayName), used: { kind: "weapon", key: "unarmed strike", name: "Unarmed strike" }, target, french: `Attaque à mains nues c/ ${enemy.displayName}` });
  // A longsword has no thrown property: thrown at a creature out of reach
  // it is an improvised weapon, with no profile of its own, and still the
  // longsword its name says (attack-logic.ts improvisedUse).
  const { buildAttackProfile } = await import("../src/lib/dm/pc-attack-profile.ts");
  const { swingParts } = await import("../src/lib/roll-parts.ts");
  const thrown = buildAttackProfile(world.campaignId, world.sheet(hero.id), { weapon: "Longsword", improvised: true }, { apart: 4 });
  assert.equal("error" in thrown, false, `refused: ${thrown.error}`);
  assert.equal(thrown.profile.improvised, true, "the throw was not ruled an improvised one");
  assert.equal(thrown.profile.base, undefined);
  assert.deepEqual(swingParts(thrown.profile, target).used, LONGSWORD);
  // An object picked up by a name of the model's is no row.
  const log = buildAttackProfile(world.campaignId, world.sheet(hero.id), { weapon: "Log", improvised: true }, { apart: 1 });
  assert.equal("error" in log, false, `refused: ${log.error}`);
  assert.deepEqual(swingParts(log.profile, target).used, { kind: "weapon", name: "Log" });
});

await test("a seat not owed a hidden creature is sent neither its name nor its id on a reload, by GET /rolls or on a waiting card, and the seat that sees the whole map is sent both", async () => {
  const enemy = await stage();
  setTokenHidden(kit.token(enemy.id).id, true);
  forget();
  const swing = await kit.swing(hero.id, enemy.id, [15, 15, 4], { weapon: "Longsword" });
  assert.equal(swing.ok, true, `refused: ${swing.error}`);
  const { hiddenFromSeat } = await import("../src/lib/table-delivery.ts");
  const { listRollsVisibleTo } = await import("../src/lib/db/rolls.ts");
  const leaks = (value) => JSON.stringify(value).includes(enemy.id) || JSON.stringify(value).includes(enemy.displayName);
  // What a page's first load and GET /rolls hand a player.
  const visible = listRollsVisibleTo(world.campaignId, { adjudicates: false, steersStory: false }, [ally.id], 20);
  assert.equal(leaks(visible.map((roll) => roll.parts)), true, "the roll on record does not name the creature");
  const forPlayer = hiddenFromSeat(world.campaignId, false, visible);
  const attack = forPlayer.find((roll) => roll.kind === "attack");
  assert.deepEqual(attack.parts.targets, [{ kind: "unseen" }]);
  assert.equal(attack.detail, "Longsword vs someone unseen");
  assert.equal(leaks(forPlayer.map((roll) => [roll.parts, roll.detail])), false, "a reload hands a player the hidden creature");
  assert.equal(hiddenFromSeat(world.campaignId, true, visible), visible, "the seat that sees the whole map was kept from it");
  // A roll a seat is not owed (a blind one, src/lib/dm/viewer.ts redactRoll)
  // is sent without its fields: it reads by the sentence it was stored
  // with, as a row of a family that has not moved does, and that sentence
  // still keeps the creature from the seat.
  const { redactRoll } = await import("../src/lib/dm/viewer.ts");
  const kept = redactRoll(visible.find((roll) => roll.kind === "attack"));
  assert.equal(kept.parts, null, "a roll kept from a seat is sent its fields");
  assert.equal(rollCardLabel(fr, kept, hero.name), `${hero.name} · ${translate("fr", "Attack roll")} (Épée longue c/ ${enemy.displayName})`, "a roll sent without its fields does not read by its sentence");
  const keptUnseen = hiddenFromSeat(world.campaignId, false, [kept])[0];
  assert.equal(keptUnseen.detail, "Longsword vs someone unseen");
  assert.equal(leaks(keptUnseen), false, "a roll sent without its fields names the hidden creature");
  // The route itself, as a player who is not the GM.
  const rollsRoute = await world.route("campaigns/[campaignId]/rolls");
  world.signIn({ id: ally.userId });
  const got = await call(rollsRoute, "GET", undefined, { campaignId: world.campaignId });
  assert.equal(got.status, 200, JSON.stringify(got.json).slice(0, 200));
  const sent = got.json.rolls.find((roll) => roll.kind === "attack");
  assert.deepEqual(sent.parts.targets, [{ kind: "unseen" }]);
  assert.equal(leaks(got.json.rolls.map((roll) => [roll.parts, roll.detail])), false, "GET /rolls hands a player the hidden creature");
  // A card waiting on the seat's own dice, on a reload and on the stream.
  forget();
  kit.freshTurn();
  realDice(true);
  const parked = await kit.attack(hero.id, enemy.id, { weapon: "Longsword" });
  assert.equal(parked.ok, true, `refused: ${parked.error}`);
  const [card] = listOpenPendingRolls(world.campaignId);
  assert.ok(card, "the swing dealt no card");
  const onLoad = hiddenFromSeat(world.campaignId, false, [publicPendingRoll(card)])[0];
  assert.deepEqual(onLoad.parts.targets, [{ kind: "unseen" }]);
  assert.equal(leaks([onLoad.parts, onLoad.detail, onLoad.reason]), false, "a reload hands a player the hidden creature on a waiting card");
  const onStream = tablePayloadFor(world.campaignId, "roll_pending", { pendingRoll: publicPendingRoll(card) }).pendingRoll;
  assert.deepEqual(onStream.parts.targets, [{ kind: "unseen" }]);
  assert.equal(leaks([onStream.parts, onStream.detail, onStream.reason]), false, "the stream hands the table the hidden creature on a waiting card");
  assert.equal(pendingWords(fr, onStream), "Épée longue c/ quelqu’un hors de vue");
  // The card's own line is made again from its parts, not patched as text.
  assert.equal(onStream.reason, "Longsword attack against someone unseen");
  assert.equal(pendingReason(fr, onStream, true), "Épée longue : attaque contre quelqu’un hors de vue");
  // The answer to the roller's own dice: the card that follows a hit, and
  // the roll that lands, as their seat is sent the table.
  world.signIn({ id: hero.userId });
  const hit = await call(submitRoute, "POST", { dice: [15] }, { campaignId: world.campaignId, pendingRollId: card.id });
  assert.equal(hit.status, 200, JSON.stringify(hit.json).slice(0, 200));
  assert.equal(leaks(hit.json), false, `the answer to the roller's own attack dice names the hidden creature: ${JSON.stringify(hit.json).slice(0, 300)}`);
  const [damageCard] = listOpenPendingRolls(world.campaignId);
  assert.equal(damageCard?.kind, "damage", "the hit dealt no damage card");
  assert.equal(leaks([damageCard.detail, damageCard.reason]), true, "the damage card on record does not name the creature");
  const dealt = await call(submitRoute, "POST", { dice: entryDice(damageCard.expression).map(() => 3) }, { campaignId: world.campaignId, pendingRollId: damageCard.id });
  assert.equal(dealt.status, 200, JSON.stringify(dealt.json).slice(0, 200));
  assert.equal(dealt.json.roll?.kind, "damage", `the damage dice landed no roll: ${JSON.stringify(dealt.json).slice(0, 200)}`);
  assert.deepEqual(dealt.json.roll.parts.targets, [{ kind: "unseen" }]);
  assert.equal(leaks(dealt.json), false, "the answer to the roller's own damage dice names the hidden creature");
  realDice(false);
});

await test("the door refuses a roll, and a roll card, handed neither a sentence nor parts that make its words", async () => {
  const bare = { campaignId: world.campaignId, characterId: hero.id, requestedBy: "dm", kind: "custom", result: rollExpression("1d6") };
  const before = stored().length;
  assert.throws(() => recordRoll(bare), /neither/);
  assert.throws(() => recordRoll({ ...bare, parts: { used: LONGSWORD } }), /neither/);
  assert.equal(stored().length, before, "a refused roll was stored");
  const { createDmTurn, createPendingRoll } = await import("../src/lib/db/dm-turns.ts");
  const turn = createDmTurn(world.campaignId, [], "ai");
  const card = { campaignId: world.campaignId, turnId: turn.id, toolCallId: null, userId: hero.userId, characterId: hero.id, kind: "custom", expression: "1d6", advantage: "none", dc: null, reason: "" };
  assert.throws(() => createPendingRoll(card), /neither/);
  assert.equal(listOpenPendingRolls(world.campaignId).filter((pending) => pending.turnId === turn.id).length, 0, "a refused card was dealt");
});

await finish();
