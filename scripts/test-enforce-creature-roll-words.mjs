// The second family's sites, each through its own door (issue #1064, step 2).
//
// A creature's own attack and its damage write no sentence any more: the
// site says what the roll is in fields (src/lib/roll-parts.ts actionParts),
// the door stores the English sentence built from them, and a card is worded
// from the fields in the reader's language (src/lib/roll-words.ts). A stat
// block's attack is stored by the name the block gives it, with no key, and
// its words look that name up in the creature attack names, then the weapons
// and the spells; a name in none of them reads as written. Each case runs a
// real call and holds every roll it stored to:
//
//   - its stored sentence is the one the site wrote by hand before, which
//     the case writes out as the site built it (roll-labels.ts rollAgainst
//     and the words in brackets);
//   - its parts make its words (`worded`), and name the action, whom it is
//     against and the engine's notes;
//   - its roller is who it was before;
//   - a French table's card reads in French.
//
// One sentence reads another way than before, and is pinned as such: the
// damage of a creature's critical hit on a pet said "Bite vs Rex (CRIT)" and
// says "Bite (CRIT) vs Rex", the note in front of "vs" where every other
// note stands.
//
// The sites:
//   - enemy_attack at a character, and what its hit goes on to deal
//     (src/lib/dm/enemy-attack.ts, enemy-hit.ts);
//   - a creature's attack on another creature of the fight, and what its
//     hit goes on to deal (enemy-strike.ts, enemy-hit-rows.ts);
//   - a creature's opportunity attack at a character, at another creature
//     and at a pet walking off with its owner (opportunity.ts,
//     opportunity-sides.ts, opportunity-pets.ts);
//   - a creature's attack on a pet: the hit, a critical hit and what the hit
//     goes on to deal (pet-strike.ts);
//   - a creature's attack on a mount, and what its hit goes on to deal
//     (mount-combat.ts, mount-blow.ts);
//   - a hit the Cloud Rune turns onto another creature, or onto a character
//     (cloud-rune.ts);
//   - a pet's attack on a creature: the hit, a critical hit and what the hit
//     goes on to deal (pet-tools.ts, natural-onhit.ts);
//   - a beast form's natural attack through pc_attack, what its hit goes on
//     to deal, and the form's opportunity attack (natural-attack.ts,
//     natural-onhit.ts, opportunity-strike.ts);
//   - a creature's attack on one the GM keeps off the board, as the table is
//     sent it, on a reload and by GET /rolls: "vs someone unseen", with
//     neither its name nor its id in its words, while a creature the table
//     sees whose name holds the hidden one's keeps its own.
//
// Every stat block here is written out and set by hand, so the suite reads
// the same with and without a content pack.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, DUMMY, TRAINED } from "./lib/enforce-combat.mjs";
import { settleQueue } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-enforce-creature-roll-words");
const world = await openWorld({ campaign: { maxPlayers: 8 } });
const kit = await combatKit(world);

const { getDatabase } = await import("../src/lib/db/core.ts");
const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { setTokenHidden } = await import("../src/lib/db/battle-maps.ts");
const { patchEnemyConditions } = await import("../src/lib/db/encounters.ts");
const { getMounts, setMount } = await import("../src/lib/db/mounts.ts");
const { listRecentRolls, listRollsVisibleTo } = await import("../src/lib/db/rolls.ts");
const { resolveOpportunityAttacks } = await import("../src/lib/dm/opportunity.ts");
const { enemiesStrikeWalker } = await import("../src/lib/dm/opportunity-sides.ts");
const { strikePetsOnWalk } = await import("../src/lib/dm/opportunity-pets.ts");
const { subscribe } = await import("../src/lib/events.ts");
const { translate } = await import("../src/lib/i18n/translate.ts");
await import("../src/lib/i18n/fr-catalog.ts");
const { rollAgainst, rollCardLabel } = await import("../src/lib/roll-labels.ts");
const { ACTION_WORDS_VERSION, rollSentence, WORDS_VERSION } = await import("../src/lib/roll-words.ts");
const { optionFeatureName } = await import("../src/lib/srd/options.ts");
const { hiddenFromSeat, tablePayloadFor } = await import("../src/lib/table-delivery.ts");
const watchRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/watch");
const rollsRoute = await world.route("campaigns/[campaignId]/rolls");

const fr = Object.assign((key, vars) => translate("fr", key, vars), { locale: "fr" });
const en = Object.assign((key) => key, { locale: "en" });

const GEAR = [{ name: "Longsword", qty: 1, equipped: true }];
const hero = world.addHero({ name: "Aria", class: "fighter", level: 5, maxHp: 300, abilities: { str: 16 }, proficiencies: TRAINED, equipment: GEAR });
const ally = world.addHero({ name: "Borin", class: "fighter", level: 5, maxHp: 300, abilities: { str: 14 }, proficiencies: TRAINED, equipment: GEAR });
const druid = world.addHero({ name: "Wren", class: "druid", level: 5, maxHp: 300, abilities: { wis: 16 }, proficiencies: TRAINED });

// What a hit goes on to deal with no save asked, so the dice a case names
// are the attack's d20, its damage and the rider's, in that order.
const also = (damageType) => ({ damage: "1d4", ...(damageType ? { damageType } : {}) });
const strike = (name, onHit) => ({ name, toHit: 4, damage: "1d6+2", type: "piercing", mode: "melee", ...(onHit ? { onHit } : {}) });

// The rolls a call stored: its attack rolls and damage, oldest first.
const stored = (table = world) => listRecentRolls(table.campaignId, 60).filter((roll) => roll.kind === "attack" || roll.kind === "damage");
const forget = (table = world) => {
  getDatabase().prepare("DELETE FROM pending_rolls WHERE campaign_id = ?").run(table.campaignId);
  getDatabase().prepare("DELETE FROM rolls WHERE campaign_id = ?").run(table.campaignId);
};

// A call with its dice named, and the rolls it stored. Every face named is
// one the call rolled: a die left over means the case misread the site.
async function rolled(faces, run, table = world) {
  forget(table);
  table.clearDice();
  table.dice(...faces);
  const out = await run();
  const unused = table.clearDice();
  if (out && typeof out === "object" && "ok" in out) {
    assert.equal(out.ok, true, `refused: ${out.error}`);
  }
  assert.equal(unused, 0, `${unused} of the dice named were not rolled`);
  return { out, made: stored(table) };
}

// A fight of creatures by name, each with the dummy's numbers and the
// attacks the case gives it, on an open floor with nobody beside anybody.
// `first` holds the floor. The creatures come back by their names.
async function stage(creatures, first = hero, table = world, tableKit = kit) {
  await tableKit.endFight();
  for (const sheet of table.sheets()) {
    table.patch(sheet.id, { currentHp: sheet.maxHp, conditions: [], conditionMeta: {}, wildShape: null, pets: [] });
    setMount(table.campaignId, sheet.id, null);
  }
  const heroFaces = Object.fromEntries(table.sheets().map((sheet) => [sheet.id, sheet.id === first.id ? 19 : 5]));
  await table.beginFight(creatures.map(({ name }) => ({ monster: "goblin", name })), { heroFaces });
  const foes = {};
  for (const enemy of table.enemies()) {
    const wanted = creatures.find((creature) => creature.name === enemy.displayName);
    assert.ok(wanted, `the fight opened with a creature named "${enemy.displayName}", which the case did not name`);
    foes[wanted.name] = tableKit.setEnemy(enemy.id, { ac: 12, maxHp: 400, currentHp: 400, stats: { ...DUMMY, ...(wanted.attacks ? { attacks: wanted.attacks } : {}) } });
  }
  tableKit.openField();
  tableKit.scatter();
  tableKit.giveTurn(first.id);
  tableKit.freshRound();
  forget(table);
  table.clearDice();
  return foes;
}

const asEnemy = (enemy) => ({ kind: "enemy", id: enemy.id, name: enemy.displayName });
const asSheet = (sheet) => ({ kind: "sheet", id: sheet.id, name: sheet.name });
const dominate = (enemy) => patchEnemyConditions(enemy.id, ["charmed"], { charmed: { spell: "Dominate Person", source: hero.id } });

// One roll held to its sentence, its parts, its roller and its card.
// `before`: the sentence the site wrote by hand. `moved`: the sentence it
// stores now, where that is another one (the one pinned change).
function holds(roll, kind, { before, moved, used, target, notes, attacker, characterId, french }) {
  assert.ok(roll, `no ${kind} roll "${moved ?? before}" was stored`);
  const what = `${roll.kind} "${roll.detail}"`;
  assert.equal(roll.kind, kind, `${what}: its kind`);
  assert.equal(roll.detail, moved ?? before, `${what}: the stored sentence is not ${moved ? `the one pinned for it in place of "${before}"` : "the one the site wrote before"}`);
  // A creature's action under its stat block's name makes the second
  // version of the words, which an app built before it shows by the stored
  // sentence; one carried under more than its own name (it has a key) stays
  // in the first.
  assert.equal(roll.parts?.worded, used.key ? WORDS_VERSION : ACTION_WORDS_VERSION, `${what}: its parts do not make its words, so its site wrote the sentence`);
  assert.equal(roll.detail, rollSentence(roll), `${what}: the stored sentence is not the one its parts make`);
  assert.deepEqual(roll.parts.used, used, `${what}: what was used`);
  assert.deepEqual(roll.parts.targets, [target], `${what}: whom it is against`);
  assert.deepEqual(roll.parts.notes, notes, `${what}: its notes`);
  assert.deepEqual(roll.attacker, attacker, `${what}: who made it`);
  assert.equal(roll.characterId, characterId, `${what}: the character it concerns`);
  const word = translate("fr", roll.kind === "attack" ? "Attack roll" : "Damage");
  assert.equal(rollCardLabel(fr, roll, undefined), `${attacker.name} · ${word} (${french})`, `${what}: a French table's card`);
}

// The sentences the sites wrote by hand before, as each built them: what a
// hit goes on to deal said its damage type, or "rider" where it has none,
// and an opportunity attack said so, both in brackets after the attack.
const riderWas = (attack, damageType, target) => rollAgainst(`${attack} (${damageType ?? "rider"})`, target);
const opportunityWas = (attack, target) => rollAgainst(`${attack} (opportunity attack)`, target);

// The kinds of the rolls a call stored, in the order it made them.
const kinds = (made) => made.map((roll) => roll.kind);

await test("enemy_attack at a character: the attack roll, its damage and what the hit goes on to deal say the stat block's action and the character in fields, store the sentences the site wrote before, and read in French by the creature attack names", async () => {
  const { Wolf: wolf } = await stage([{ name: "Wolf", attacks: [strike("Bite", also("poison"))] }]);
  kit.place(hero.id, 5, 5);
  kit.place(wolf.id, 5, 6);
  // The d20 (19 against AC 12), the bite's d6, the poison's d4.
  const { made } = await rolled([15, 3, 2], () => world.invoke("enemy_attack", { enemyId: wolf.id, targetCharacterId: hero.id }));
  assert.deepEqual(kinds(made), ["attack", "damage", "damage"]);
  const said = { before: rollAgainst("Bite", hero.name), used: { kind: "action", name: "Bite" }, target: asSheet(hero), notes: undefined, attacker: asEnemy(wolf), characterId: hero.id, french: `Morsure c/ ${hero.name}` };
  holds(made[0], "attack", said);
  holds(made[1], "damage", said);
  // The rider's damage type is one of the engine's own: a note by its id.
  holds(made[2], "damage", { ...said, before: riderWas("Bite", "poison", hero.name), notes: [{ engine: "poison" }], french: `Morsure (poison) c/ ${hero.name}` });
});

await test("a creature's weapon reads through the weapons' names, a rider with no damage type is the engine's \"rider\", and a homebrew attack named like a word of the interface stays as its stat block wrote it, with its rider's own word", async () => {
  // The harness's dummy swings a Club: a weapon's name, on a stat block.
  const { Thug: thug } = await stage([{ name: "Thug", attacks: [{ ...DUMMY.attacks[0], onHit: also() }] }]);
  kit.place(hero.id, 5, 5);
  kit.place(thug.id, 5, 6);
  const club = await rolled([15, 3, 2], () => world.invoke("enemy_attack", { enemyId: thug.id, targetCharacterId: hero.id }));
  assert.deepEqual(kinds(club.made), ["attack", "damage", "damage"]);
  const swung = { before: rollAgainst("Club", hero.name), used: { kind: "action", name: "Club" }, target: asSheet(hero), notes: undefined, attacker: asEnemy(thug), characterId: hero.id, french: `Gourdin c/ ${hero.name}` };
  holds(club.made[0], "attack", swung);
  holds(club.made[1], "damage", swung);
  holds(club.made[2], "damage", { ...swung, before: riderWas("Club", undefined, hero.name), notes: [{ engine: "rider" }], french: `Gourdin (effet additionnel) c/ ${hero.name}` });

  // "Turn" is a word of the interface ("Trahison" in French): a stat
  // block's attack of that name is no such word. Its rider deals a damage
  // type of the block's own making, shown as written.
  const { Mimic: mimic } = await stage([{ name: "Mimic", attacks: [strike("Turn", also("void"))] }]);
  kit.place(hero.id, 5, 5);
  kit.place(mimic.id, 5, 6);
  const turn = await rolled([15, 3, 2], () => world.invoke("enemy_attack", { enemyId: mimic.id, targetCharacterId: hero.id }));
  assert.deepEqual(kinds(turn.made), ["attack", "damage", "damage"]);
  const turned = { before: rollAgainst("Turn", hero.name), used: { kind: "action", name: "Turn" }, target: asSheet(hero), notes: undefined, attacker: asEnemy(mimic), characterId: hero.id, french: `Turn c/ ${hero.name}` };
  holds(turn.made[0], "attack", turned);
  holds(turn.made[1], "damage", turned);
  holds(turn.made[2], "damage", { ...turned, before: riderWas("Turn", "void", hero.name), notes: [{ typed: "void" }], french: `Turn (void) c/ ${hero.name}` });
  assert.equal(translate("fr", "Turn"), "Trahison", "the interface's word this case is about is no longer in the dictionary");
});

await test("a creature's attack on another creature of the fight: the attack roll, its damage and what the hit goes on to deal name the creature struck by its id, and a homebrew \"Log\" is no \"Journal\"", async () => {
  const { Raider: raider, Goblin: goblin } = await stage([{ name: "Raider", attacks: [strike("Scimitar", also("fire"))] }, { name: "Goblin" }]);
  // The raider fights for the party (Dominate Person) and strikes the goblin.
  dominate(raider);
  kit.place(raider.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  const { made } = await rolled([15, 3, 2], () => world.invoke("enemy_attack", { enemyId: raider.id, targetCharacterId: goblin.id }));
  assert.deepEqual(kinds(made), ["attack", "damage", "damage"]);
  const said = { before: rollAgainst("Scimitar", goblin.displayName), used: { kind: "action", name: "Scimitar" }, target: asEnemy(goblin), notes: undefined, attacker: asEnemy(raider), characterId: null, french: `Cimeterre c/ ${goblin.displayName}` };
  holds(made[0], "attack", said);
  holds(made[1], "damage", said);
  holds(made[2], "damage", { ...said, before: riderWas("Scimitar", "fire", goblin.displayName), notes: [{ engine: "fire" }], french: `Cimeterre (feu) c/ ${goblin.displayName}` });

  // "Log" is a word of the interface ("Journal"): a treant's own is not.
  const { Treant: treant, Goblin: other } = await stage([{ name: "Treant", attacks: [strike("Log")] }, { name: "Goblin" }]);
  dominate(treant);
  kit.place(treant.id, 5, 5);
  kit.place(other.id, 5, 6);
  const log = await rolled([15, 3], () => world.invoke("enemy_attack", { enemyId: treant.id, targetCharacterId: other.id }));
  assert.deepEqual(kinds(log.made), ["attack", "damage"]);
  const logged = { before: rollAgainst("Log", other.displayName), used: { kind: "action", name: "Log" }, target: asEnemy(other), notes: undefined, attacker: asEnemy(treant), characterId: null, french: `Log c/ ${other.displayName}` };
  holds(log.made[0], "attack", logged);
  holds(log.made[1], "damage", logged);
  assert.equal(translate("fr", "Log"), "Journal", "the interface's word this case is about is no longer in the dictionary");
});

await test("a creature's opportunity attack at a character who walks out of its reach carries the engine's note for it, on the attack roll and on its damage", async () => {
  const { Ghoul: ghoul } = await stage([{ name: "Ghoul", attacks: [strike("Claw")] }]);
  kit.place(hero.id, 5, 5);
  kit.place(ghoul.id, 5, 6);
  const { made } = await rolled([15, 3], () => resolveOpportunityAttacks(world.campaign(), hero.id, { x: 5, y: 5 }, { x: 5, y: 3 }, false, [{ x: 5, y: 4 }, { x: 5, y: 3 }]));
  assert.deepEqual(kinds(made), ["attack", "damage"]);
  const said = {
    before: opportunityWas("Claw", hero.name),
    used: { kind: "action", name: "Claw" },
    target: asSheet(hero),
    notes: [{ engine: "opportunity" }],
    attacker: asEnemy(ghoul),
    characterId: null,
    french: `Griffe (attaque d’opportunité) c/ ${hero.name}`,
  };
  holds(made[0], "attack", said);
  holds(made[1], "damage", said);
});

await test("a creature's opportunity attack at another creature that walks off carries the same note and names the walker by its id", async () => {
  const { Drake: drake, Goblin: walker } = await stage([{ name: "Drake", attacks: [strike("Tail")] }, { name: "Goblin" }]);
  dominate(drake);
  kit.place(drake.id, 5, 5);
  kit.place(walker.id, 6, 5);
  const { made } = await rolled([15, 3], () => enemiesStrikeWalker(world.campaignId, walker.id, [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }], 1));
  assert.deepEqual(kinds(made), ["attack", "damage"]);
  const said = {
    before: opportunityWas("Tail", walker.displayName),
    used: { kind: "action", name: "Tail" },
    target: asEnemy(walker),
    notes: [{ engine: "opportunity" }],
    attacker: asEnemy(drake),
    characterId: null,
    french: `Queue (attaque d’opportunité) c/ ${walker.displayName}`,
  };
  holds(made[0], "attack", said);
  holds(made[1], "damage", said);
});

// A character's own creature, kept on their sheet.
const pet = (name, attacks = []) => ({ name, kind: "other", form: "mastiff", hp: 300, maxHp: 300, ac: 10, speed: 40, attacks, notes: "" });

await test("a creature's opportunity attack at a pet that pulls away with its owner carries the same note and names the pet, which has a name and no id", async () => {
  const { Ogre: ogre } = await stage([{ name: "Ogre", attacks: [strike("Slam")] }]);
  world.patch(hero.id, { pets: [pet("Ember")] });
  kit.place(ogre.id, 5, 5);
  kit.place(hero.id, 6, 5);
  const { made } = await rolled([15, 3], () => strikePetsOnWalk(world.campaign(), hero.id, [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }]));
  assert.deepEqual(kinds(made), ["attack", "damage"]);
  const said = {
    before: opportunityWas("Slam", "Ember"),
    used: { kind: "action", name: "Slam" },
    target: { kind: "pet", name: "Ember" },
    notes: [{ engine: "opportunity" }],
    attacker: asEnemy(ogre),
    characterId: hero.id,
    french: "Coup (attaque d’opportunité) c/ Ember",
  };
  holds(made[0], "attack", said);
  holds(made[1], "damage", said);
});

await test("a creature's attack on a pet: the attack roll and its damage name the pet, the hit's rider carries the engine's \"rider\", and a critical hit's damage says so in front of \"vs\", where it stood behind the pet's name before", async () => {
  const { Wolf: wolf } = await stage([{ name: "Wolf", attacks: [strike("Bite", also("poison"))] }]);
  world.patch(hero.id, { pets: [pet("Rex")] });
  kit.place(hero.id, 5, 5);
  kit.place(wolf.id, 5, 6);
  const plain = await rolled([15, 3, 2], () => world.invoke("enemy_attack", { enemyId: wolf.id, targetCharacterId: hero.id, targetPet: "Rex" }));
  assert.deepEqual(kinds(plain.made), ["attack", "damage", "damage"]);
  const said = { before: rollAgainst("Bite", "Rex"), used: { kind: "action", name: "Bite" }, target: { kind: "pet", name: "Rex" }, notes: undefined, attacker: asEnemy(wolf), characterId: hero.id, french: "Morsure c/ Rex" };
  holds(plain.made[0], "attack", said);
  holds(plain.made[1], "damage", said);
  // This site says "rider" whatever the rider's damage type is, as before.
  const rider = { ...said, before: rollAgainst("Bite (rider)", "Rex"), notes: [{ engine: "rider" }], french: "Morsure (effet additionnel) c/ Rex" };
  holds(plain.made[2], "damage", rider);

  // A natural 20: the bite's die twice, then the rider's.
  kit.freshRound();
  const crit = await rolled([20, 3, 3, 2], () => world.invoke("enemy_attack", { enemyId: wolf.id, targetCharacterId: hero.id, targetPet: "Rex" }));
  assert.deepEqual(kinds(crit.made), ["attack", "damage", "damage"]);
  holds(crit.made[0], "attack", said);
  // The one sentence of this family that changed: the site wrote the note
  // after the pet's name, and the parts say it with the action.
  const old = `${rollAgainst("Bite", "Rex")} (CRIT)`;
  assert.equal(old, "Bite vs Rex (CRIT)");
  holds(crit.made[1], "damage", { ...said, before: old, moved: "Bite (CRIT) vs Rex", notes: [{ engine: "crit" }], french: "Morsure (CRITIQUE) c/ Rex" });
  holds(crit.made[2], "damage", rider);
});

await test("a creature's attack on a mount: the attack roll and its damage name the mount, which has a name and no id, and the hit's rider carries the engine's \"rider\"", async () => {
  const { Boar: boar } = await stage([{ name: "Boar", attacks: [strike("Gore", also("poison"))] }]);
  kit.place(hero.id, 5, 5);
  kit.place(boar.id, 5, 6);
  const up = await world.invoke("mount_up", { characterId: hero.id, mount: "Warhorse" });
  assert.equal(up.ok, true, `refused: ${up.error}`);
  const mount = getMounts(world.campaignId)[hero.id];
  assert.ok(mount?.name, "the character rides nothing");
  kit.freshRound();
  const { made } = await rolled([15, 3, 2], () => world.invoke("enemy_attack", { enemyId: boar.id, targetCharacterId: hero.id, targetMount: true }));
  setMount(world.campaignId, hero.id, null);
  assert.deepEqual(kinds(made), ["attack", "damage", "damage"]);
  const said = { before: rollAgainst("Gore", mount.name), used: { kind: "action", name: "Gore" }, target: { kind: "mount", name: mount.name }, notes: undefined, attacker: asEnemy(boar), characterId: hero.id, french: `Coup de corne c/ ${mount.name}` };
  holds(made[0], "attack", said);
  holds(made[1], "damage", said);
  holds(made[2], "damage", { ...said, before: rollAgainst("Gore (rider)", mount.name), notes: [{ engine: "rider" }], french: `Coup de corne (effet additionnel) c/ ${mount.name}` });
});

await test("a pet's attack on a creature: the attack roll and its damage are the pet's and say its stat block's action, a critical hit's damage says so, and what its hit goes on to deal is carried under the pet's name with the attack as its key", async () => {
  const { Goblin: goblin } = await stage([{ name: "Goblin" }]);
  world.patch(hero.id, { pets: [pet("Rex", [{ name: "Bite", toHit: 5, damage: "1d6+2", type: "piercing", onHit: also("poison") }])] });
  kit.place(hero.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  const rex = { kind: "pet", id: hero.id, name: "Rex" };
  const plain = await rolled([15, 3, 2], () => world.invoke("pet_attack", { characterId: hero.id, petName: "Rex", targetEnemyId: goblin.id }));
  assert.deepEqual(kinds(plain.made), ["attack", "damage", "damage"]);
  const said = { before: rollAgainst("Bite", goblin.displayName), used: { kind: "action", name: "Bite" }, target: asEnemy(goblin), notes: undefined, attacker: rex, characterId: hero.id, french: `Morsure c/ ${goblin.displayName}` };
  holds(plain.made[0], "attack", said);
  holds(plain.made[1], "damage", said);
  // The rider's roll says whose bite it is: the attack's name alone is put
  // into French, where it stands, and the pet's stays as it was written.
  const rider = {
    ...said,
    before: riderWas("Rex's Bite", "poison", goblin.displayName),
    used: { kind: "action", key: "bite", name: "Rex's Bite" },
    notes: [{ engine: "poison" }],
    french: `Rex's Morsure (poison) c/ ${goblin.displayName}`,
  };
  holds(plain.made[2], "damage", rider);

  // A natural 20: the bite's die twice, then the rider's.
  kit.giveTurn(hero.id);
  const crit = await rolled([20, 3, 3, 2], () => world.invoke("pet_attack", { characterId: hero.id, petName: "Rex", targetEnemyId: goblin.id }));
  assert.deepEqual(kinds(crit.made), ["attack", "damage", "damage"]);
  holds(crit.made[0], "attack", said);
  holds(crit.made[1], "damage", { ...said, before: rollAgainst("Bite (CRIT)", goblin.displayName), notes: [{ engine: "crit" }], french: `Morsure (CRITIQUE) c/ ${goblin.displayName}` });
  holds(crit.made[2], "damage", rider);
});

// A druid in a wolf's shape, with the form's attack written out.
const WOLF_FORM = { form: "Wolf", beastHp: 40, beastMaxHp: 40, beastAc: 13, attacks: [{ name: "Bite", toHit: 4, damage: "2d4+2", type: "piercing", onHit: also("poison") }] };
const WOLF_BITE = { kind: "action", key: "bite", name: "Wolf Bite" };

await test("a beast form's natural attack through pc_attack is the form's action, carried under the form's name with the attack as its key: its attack roll, its damage and what its hit goes on to deal", async () => {
  const { Goblin: goblin } = await stage([{ name: "Goblin" }], druid);
  world.patch(druid.id, { wildShape: WOLF_FORM });
  kit.place(druid.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  // The d20, the bite's two d4s, the poison's d4.
  const { made } = await rolled([15, 2, 2, 2], () => kit.attack(druid.id, goblin.id, { weapon: "Bite" }));
  assert.deepEqual(kinds(made), ["attack", "damage", "damage"]);
  const said = { before: rollAgainst("Wolf Bite", goblin.displayName), used: WOLF_BITE, target: asEnemy(goblin), notes: undefined, attacker: asSheet(druid), characterId: druid.id, french: `Wolf Morsure c/ ${goblin.displayName}` };
  holds(made[0], "attack", said);
  holds(made[1], "damage", said);
  holds(made[2], "damage", { ...said, before: riderWas("Wolf Bite", "poison", goblin.displayName), notes: [{ engine: "poison" }], french: `Wolf Morsure (poison) c/ ${goblin.displayName}` });
});

await test("a beast form's opportunity attack is the form's action too, with the engine's note for it, and what its hit goes on to deal says the same action", async () => {
  const { Goblin: goblin } = await stage([{ name: "Goblin" }], ally);
  world.patch(druid.id, { wildShape: WOLF_FORM });
  kit.place(druid.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  // The server rolls the reaction as the creature leaves the wolf's reach,
  // on the creature's own turn.
  kit.enemyTurn(goblin.id);
  const { made } = await rolled([15, 2, 2, 2], () => world.invoke("move_token", { token: goblin.id, x: 5, y: 12, reason: "it runs" }));
  assert.deepEqual(kinds(made), ["attack", "damage", "damage"]);
  const said = {
    before: opportunityWas("Wolf Bite", goblin.displayName),
    used: WOLF_BITE,
    target: asEnemy(goblin),
    notes: [{ engine: "opportunity" }],
    attacker: asSheet(druid),
    characterId: druid.id,
    french: `Wolf Morsure (attaque d’opportunité) c/ ${goblin.displayName}`,
  };
  holds(made[0], "attack", said);
  holds(made[1], "damage", said);
  holds(made[2], "damage", { ...said, before: riderWas("Wolf Bite", "poison", goblin.displayName), notes: [{ engine: "poison" }], french: `Wolf Morsure (poison) c/ ${goblin.displayName}` });
});

await test("a creature's attack on one the GM keeps off the board reads \"vs someone unseen\" as the table is sent it, on a reload and by GET /rolls, with neither its name nor its id in its words, and a creature the table sees whose name holds the hidden one's keeps its own", async () => {
  const { Hound: hound, Bandit: bandit, "Bandit Captain": captain } = await stage([{ name: "Hound", attacks: [strike("Bite")] }, { name: "Bandit" }, { name: "Bandit Captain" }]);
  dominate(hound);
  kit.place(hound.id, 5, 5);
  kit.place(bandit.id, 5, 6);
  kit.place(captain.id, 6, 5);
  setTokenHidden(kit.token(bandit.id).id, true);
  const leaks = (value) => JSON.stringify(value).includes(bandit.id) || /Bandit(?! Captain)/.test(JSON.stringify(value));
  // What a roll says: its words, the fields that make them and its roller.
  // This suite holds those. A damage roll's row also keeps which creature
  // the server landed its total on (src/lib/db/rolls.ts targetEnemyId),
  // which is no part of its words.
  const words = (roll) => [roll.detail, roll.parts, roll.attacker];
  const unseen = (roll, where) => {
    const word = roll.kind === "attack" ? "Attack roll" : "Damage";
    assert.deepEqual(roll.parts.targets, [{ kind: "unseen" }], `${where}: whom the ${roll.kind} roll is against`);
    assert.equal(roll.detail, "Bite vs someone unseen", `${where}: the ${roll.kind} roll's sentence`);
    assert.equal(leaks(words(roll)), false, `${where}: the ${roll.kind} roll's words name the hidden creature`);
    assert.equal(rollCardLabel(en, roll, undefined), `${hound.displayName} · ${word} (Bite vs someone unseen)`);
    assert.equal(rollCardLabel(fr, roll, undefined), `${hound.displayName} · ${translate("fr", word)} (Morsure c/ quelqu’un hors de vue)`);
  };

  // The hound bites where the hidden bandit stands.
  const atHidden = await rolled([15, 3], () => world.invoke("enemy_attack", { enemyId: hound.id, targetCharacterId: bandit.id }));
  assert.deepEqual(kinds(atHidden.made), ["attack", "damage"]);
  for (const roll of atHidden.made) {
    // On record the roll names the creature, for the seats owed it.
    holds(roll, roll.kind, { before: rollAgainst("Bite", bandit.displayName), used: { kind: "action", name: "Bite" }, target: asEnemy(bandit), notes: undefined, attacker: asEnemy(hound), characterId: null, french: `Morsure c/ ${bandit.displayName}` });
    // What the table is sent and the log keeps (src/lib/table-delivery.ts).
    unseen(tablePayloadFor(world.campaignId, "roll_result", { roll, source: "digital" }).roll, "the table");
  }
  // The attack roll carries the creature nowhere else either.
  assert.equal(leaks(tablePayloadFor(world.campaignId, "roll_result", { roll: atHidden.made[0], source: "digital" }).roll), false, "the hidden creature rode the attack roll to the table");

  // What a page's first load and GET /rolls hand a player.
  const visible = listRollsVisibleTo(world.campaignId, { adjudicates: false, steersStory: false }, [ally.id], 20);
  assert.equal(leaks(visible.map(words)), true, "the rolls on record do not name the creature");
  const forPlayer = hiddenFromSeat(world.campaignId, false, visible);
  assert.deepEqual(kinds(forPlayer), ["attack", "damage"]);
  forPlayer.forEach((roll) => unseen(roll, "a reload"));
  assert.equal(hiddenFromSeat(world.campaignId, true, visible), visible, "the seat that sees the whole map was kept from it");
  world.signIn({ id: ally.userId });
  const got = await call(rollsRoute, "GET", undefined, { campaignId: world.campaignId });
  assert.equal(got.status, 200, JSON.stringify(got.json).slice(0, 200));
  assert.deepEqual(kinds(got.json.rolls), ["attack", "damage"]);
  got.json.rolls.forEach((roll) => unseen(roll, "GET /rolls"));

  // The captain, whom the table sees, is still the captain: the bandit's
  // name inside its own is not what is hidden.
  kit.freshRound();
  const atSeen = await rolled([15, 3], () => world.invoke("enemy_attack", { enemyId: hound.id, targetCharacterId: captain.id }));
  assert.deepEqual(kinds(atSeen.made), ["attack", "damage"]);
  const said = { before: rollAgainst("Bite", "Bandit Captain"), used: { kind: "action", name: "Bite" }, target: asEnemy(captain), notes: undefined, attacker: asEnemy(hound), characterId: null, french: "Morsure c/ Bandit Captain" };
  for (const roll of atSeen.made) {
    holds(roll, roll.kind, said);
    const shown = tablePayloadFor(world.campaignId, "roll_result", { roll, source: "digital" }).roll;
    assert.deepEqual(shown.parts.targets, [asEnemy(captain)], "the creature the table sees was taken for the hidden one");
    assert.equal(shown.detail, "Bite vs Bandit Captain");
    assert.equal(rollCardLabel(fr, shown, undefined), `${hound.displayName} · ${translate("fr", roll.kind === "attack" ? "Attack roll" : "Damage")} (Morsure c/ Bandit Captain)`);
  }
  const again = hiddenFromSeat(world.campaignId, false, listRollsVisibleTo(world.campaignId, { adjudicates: false, steersStory: false }, [ally.id], 20));
  assert.deepEqual(again.map((roll) => roll.detail), ["Bite vs Bandit Captain", "Bite vs Bandit Captain"], "a reload renamed the creature the table sees");
});

// ---- the Cloud Rune, at a table of its own: the knight's player is asked
// before the damage of every hit near them, which the cases above are not
// about.
const runes = await openWorld({ campaign: { maxPlayers: 8 } });
const runeKit = await combatKit(runes);
const knight = runes.addHero({ name: "Kael", class: "fighter", subclass: "Rune Knight", level: 7, maxHp: 300, abilities: { str: 16, con: 16 }, proficiencies: TRAINED, equipment: GEAR });
const friend = runes.addHero({ name: "Sera", class: "fighter", level: 7, maxHp: 300, abilities: { str: 16 }, proficiencies: TRAINED, equipment: GEAR });
runes.patch(knight.id, { features: [...runes.sheet(knight.id).features, { name: optionFeatureName("rune", "Cloud Rune"), source: "class" }] });

// A creature's hit on the knight's friend, stopped for the knight's player
// and turned onto `onto`: the rolls the call stored once it ran on.
async function turnedOnto(foe, ontoId) {
  const who = runes.sheet(knight.id);
  runes.patch(knight.id, { resources: Object.fromEntries(Object.entries(who.resources ?? {}).map(([key, state]) => [key, { ...state, used: 0 }])) });
  assert.ok(runes.sheet(knight.id).resources?.sub_cloud_rune, "the knight holds no Cloud Rune");
  // The knight's player is at the table: a stop reaches them.
  const off = subscribe(runes.campaignId, () => {}, who.userId);
  try {
    forget(runes);
    runes.clearDice();
    // The d20 (20 against AC 12); the hit stops before its damage.
    runes.dice(16);
    const out = await runes.invoke("enemy_attack", { enemyId: foe.id, targetCharacterId: friend.id });
    assert.equal(out.ok, true, `refused: ${out.error}`);
    const [stop] = listOpenPendingRolls(runes.campaignId).filter((pending) => pending.parkedFor === "watch");
    assert.equal(stop?.watch?.power, "cloud_rune", `the hit did not stop for the knight: ${JSON.stringify(out).slice(0, 300)}`);
    const choice = stop.watch.choices.findIndex((entry) => entry.ref === ontoId);
    assert.ok(choice >= 0, `the rune offers no such creature: ${stop.watch.choices.map((entry) => entry.name).join(", ")}`);
    // The same roll comes again off the stop's record; then the club's d6.
    runes.signIn({ id: who.userId });
    runes.clearDice();
    runes.dice(3);
    const answered = await call(watchRoute, "POST", { shift: true, choice }, { campaignId: runes.campaignId, pendingRollId: stop.id });
    assert.equal(answered.status, 200, JSON.stringify(answered.json).slice(0, 200));
    await settleQueue(runes.campaignId);
    assert.equal(runes.clearDice(), 0, "the turned blow's damage die was not rolled");
  } finally {
    off();
  }
  return stored(runes);
}

await test("a hit the Cloud Rune turns onto another creature rolls its damage against that creature, by its id, in the words the site wrote before; turned onto a character, against the character", async () => {
  const lay = async () => {
    const foes = await stage([{ name: "Brute" }, { name: "Goblin" }], knight, runes, runeKit);
    runeKit.place(knight.id, 5, 5);
    runeKit.place(friend.id, 5, 6);
    runeKit.place(foes.Brute.id, 6, 6);
    runeKit.place(foes.Goblin.id, 8, 5);
    return foes;
  };
  const { Brute: brute, Goblin: goblin } = await lay();
  const onFoe = await turnedOnto(brute, goblin.id);
  assert.deepEqual(kinds(onFoe), ["attack", "damage"]);
  // The attack roll was at the friend, and stays so.
  const swung = { before: rollAgainst("Club", friend.name), used: { kind: "action", name: "Club" }, target: asSheet(friend), notes: undefined, attacker: asEnemy(brute), characterId: friend.id, french: `Gourdin c/ ${friend.name}` };
  holds(onFoe[0], "attack", swung);
  holds(onFoe[1], "damage", { ...swung, before: rollAgainst("Club", goblin.displayName), target: asEnemy(goblin), characterId: null, french: `Gourdin c/ ${goblin.displayName}` });

  // Onto the knight themself: a character takes it.
  const { Brute: second } = await lay();
  const onKnight = await turnedOnto(second, knight.id);
  assert.deepEqual(kinds(onKnight), ["attack", "damage"]);
  holds(onKnight[0], "attack", { ...swung, attacker: asEnemy(second) });
  holds(onKnight[1], "damage", { ...swung, before: rollAgainst("Club", knight.name), target: asSheet(knight), attacker: asEnemy(second), characterId: knight.id, french: `Gourdin c/ ${knight.name}` });
});

await finish();
