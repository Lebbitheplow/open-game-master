// A player's character dominated by the other side (issue 503, Phase 6): an
// enemy's Dominate Person takes it, and until the charm ends the DM plays it
// (src/lib/dm/companion-command.ts dominatedByFoe).
//
//   - the table is told, the floor on its turn is nobody's at the table, the
//     DM is woken to play it and the AI's turn may spend it unasked;
//   - its player's moves and End Turn are refused with the reason;
//   - the charm's end gives it back: its player holds its turn again, and
//     every client is sent the sides without it (src/lib/db/side-watch.ts),
//     whichever route ended the charm;
//   - the other way round, a creature the party dominates is an ally its
//     casters may buff: Bless lands on its row with the spell's meta, the
//     caster's lost concentration takes it off, a buff that works through a
//     character's sheet (Aid) is refused for it, and a hostile one is still
//     refused;
//   - at a table a person runs, the GM plays the dominated hero's turn card
//     by card from the GM seat with the hero's own Hand, aimed at the party,
//     and ends it with End turn; the hero's player is still refused (issue
//     685 audit, 4.G: only "Play their turn for me" played it before).
import assert from "node:assert/strict";
import fs from "node:fs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, enemyOf, field, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";
import { layMap } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-combat-sides-dominate");
const { sideOf } = await import("../src/lib/dm/combatant.ts");
const command = await import("../src/lib/dm/companion-command.ts");
const { endTurnRefusal, initiativeFloorFor } = await import("../src/lib/dm/encounter-tools.ts");
const { characterAwaitingPlayer } = await import("../src/lib/dm/player-word.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const encounters = await import("../src/lib/db/encounters.ts");
const { latestEventOfType } = await import("../src/lib/events.ts");
const { joinByInviteCode, setCampaignStatus, setDmMode } = await import("../src/lib/db/campaigns.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { gmTurnCompanion, gmTurnDominated } = await import("../src/lib/player-characters.ts");
const { handTargets } = await import("../src/app/campaigns/[campaignId]/handTargets.ts");

const DOMINATOR = {
  spells: ["Dominate Person"],
  spellcasting: { dc: 20, ability: "int", casterLevel: 9, spells: [{ name: "Dominate Person", level: 5 }], slots: { 5: 2 } },
};

await test("An enemy's Dominate Person on a player's character: the table is told, the DM plays it, its player is refused with the reason, and the charm's end gives it back", async () => {
  const { world, sheets: [, victim], enemies: [foe] } = await table([FIGHTER, { ...FIGHTER, name: "Brin" }], 1, DOMINATOR);
  // Its WIS save: a 1 against DC 20.
  world.dice(1);
  const cast = await world.invoke("cast_at_player", { characterId: victim.id, casterEnemyId: foe.id, spell: "Dominate Person", saveAbility: "wis", dc: 20 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.equal(sideOf(world.encounter(), "sheet", victim.id), "foe", "it fights for its dominator");
  const told = listRecentMessages(world.campaignId, 10).some((message) => /Brin is dominated: the GM plays Brin until the charm ends/.test(message.content));
  assert.ok(told, "the table, its player among them, is told");

  // Its turn: the floor is nobody's at the table, and the DM plays it.
  const encounter = world.encounter();
  const place = encounter.order.findIndex((entry) => entry.kind === "pc" && entry.characterId === victim.id);
  encounters.saveEncounter({ ...encounter, turnIndex: place, turnBudget: null });
  const entry = world.encounter().order[place];
  assert.equal(command.turnUserId(world.campaign(), entry), command.DOMINATED_TURN);
  assert.equal(command.dmPlaysTurn(world.campaign(), entry), true);
  assert.deepEqual(initiativeFloorFor(world.campaignId).userIds, [command.DOMINATED_TURN]);
  assert.equal(characterAwaitingPlayer(world.campaignId), null, "the AI may play it without its player's word");
  assert.match(endTurnRefusal(world.campaignId, victim.userId), /Brin is dominated/);

  // Its player's move is refused with the reason.
  const route = await world.route("campaigns/[campaignId]/actions");
  world.signIn({ id: victim.userId });
  const refused = await route.POST(
    new Request("http://odm.test/actions", { method: "POST", body: JSON.stringify({ content: "I attack the enchanter.", kind: "do" }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.equal(refused.status, 409);
  const body = await refused.json();
  assert.match(body.error, /Brin is dominated: the GM plays Brin until the charm ends/);
  assert.equal(body.dominated, true);

  // The charm ends: Brin is the player's again, on every client too.
  const before = latestEventOfType(world.campaignId, ["encounter_updated"])?.seq ?? 0;
  const freed = await world.invoke("clear_condition", { characterId: victim.id, condition: "charmed" });
  assert.equal(freed.ok, true, freed.error);
  await new Promise((resolve) => setImmediate(resolve));
  const sent = latestEventOfType(world.campaignId, ["encounter_updated"]);
  assert.ok(sent && sent.seq > before, "the charm's end is sent to every client");
  assert.equal(sent.payload.encounter.sides?.[victim.id], undefined, "the sides it sends leave Brin with the party");
  assert.equal(sideOf(world.encounter(), "sheet", victim.id), "party");
  assert.equal(command.turnUserId(world.campaign(), entry), victim.userId);
  assert.equal(command.dmPlaysTurn(world.campaign(), entry), false);
  assert.equal(command.dominatedRefusal(world.campaignId, world.sheet(victim.id)), null);
});

// At a table a person runs, the tracker offers "Play their turn for me" for a
// dominated hero (DmInitiativePanel's foe row, from companionTurn), and the
// route answered "It is not a companion's turn": the button did nothing
// (issue 685 audit). It plays the hero's basic turn against the party, as
// the AI's backstop does, and hands the turn on.
await test("At a person's table the GM's Play their turn for me plays a dominated hero's turn and hands it on", async () => {
  const { world, sheets: [, victim], enemies: [foe] } = await table([FIGHTER, { ...FIGHTER, name: "Brin" }], 1, DOMINATOR);
  world.dice(1);
  const cast = await world.invoke("cast_at_player", { characterId: victim.id, casterEnemyId: foe.id, spell: "Dominate Person", saveAbility: "wis", dc: 20 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(setDmMode(world.campaignId, "human", world.owner.id)?.dmUserId, "a person takes the GM's seat");
  const encounter = world.encounter();
  const place = encounter.order.findIndex((entry) => entry.kind === "pc" && entry.characterId === victim.id);
  encounters.saveEncounter({ ...encounter, turnIndex: place, turnBudget: null, legendary: { ...encounter.legendary, due: [], handoff: false } });
  assert.deepEqual(activePublicEncounter(world.campaignId, { enemyNumbers: true }).companionTurn?.id, victim.id, "the tracker offers the GM Brin's turn");
  const route = await world.route("campaigns/[campaignId]/dm/initiative");
  world.signIn({ id: world.owner.id });
  const played = await route.POST(
    new Request("http://odm.test/dm/initiative", { method: "POST", body: JSON.stringify({ op: "companion" }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  const body = await played.json();
  assert.equal(played.status, 200, body.error);
  const now = world.encounter();
  assert.notEqual(now.order[now.turnIndex]?.characterId, victim.id, "Brin's turn was played and handed on");
});

await test("A companion or a character charmed by something other than a Dominate spell is not taken from its player", async () => {
  const { world, sheets: [, victim], enemies: [foe] } = await table([FIGHTER, { ...FIGHTER, name: "Brin" }], 1);
  world.patch(victim.id, { conditions: ["charmed"], conditionMeta: { charmed: { source: foe.id, spell: "Charm Person" } } });
  assert.equal(command.dominatedByFoe(world.campaignId, world.sheet(victim.id)), false);
  const entry = world.encounter().order.find((item) => item.kind === "pc" && item.characterId === victim.id);
  assert.equal(command.turnUserId(world.campaign(), entry), victim.userId);
});

await test("A creature the party dominates takes the party's buffs as an ally: Bless lands on its row and ends with the caster's concentration; Aid is refused for it; a hostile creature is refused", async () => {
  const priest = { ...caster("cleric", "wis", ["Bless", "Aid"], [], 5), equipment: [{ name: "Component pouch", qty: 1 }] };
  const { world, sheets: [cleric], enemies: [ogre, goblin] } = await table([priest], 2);
  encounters.patchEnemyConditions(ogre.id, ["charmed"], { charmed: { spell: "Dominate Person", source: cleric.id } });
  assert.equal(sideOf(world.encounter(), "enemy", ogre.id), "party");
  const blessed = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Bless", targetCharacterIds: [ogre.id] });
  assert.equal(blessed.ok, true, blessed.error);
  assert.deepEqual(blessed.result.targets, [ogre.displayName]);
  const row = enemyOf(world, ogre.id);
  const held = row.conditions.find((entry) => /bless/i.test(entry));
  assert.ok(held, row.conditions.join(", "));
  assert.equal(row.conditionMeta[held].spell, "Bless");
  assert.equal(row.conditionMeta[held].source, cleric.id);
  assert.equal(world.sheet(cleric.id).concentratingOn, "Bless");
  // The blessing rides the ogre's attack on its old ally: a d4 on the roll.
  world.diceLog();
  const swing = await world.invoke("enemy_attack", { enemyId: ogre.id, targetCharacterId: goblin.id });
  assert.equal(swing.ok, true, swing.error);
  assert.ok(world.diceLog().some((die) => die.sides === 4), "Bless's d4 on the attack roll");
  // The cleric drops concentration: the blessing leaves the ogre.
  const dropped = await world.invoke("clear_condition", { characterId: cleric.id, condition: "concentration" });
  assert.equal(dropped.ok, true, dropped.error);
  assert.equal(enemyOf(world, ogre.id).conditions.some((entry) => /bless/i.test(entry)), false);
  // Aid works through a sheet's hit points: refused for the ogre, unspent.
  const slots = JSON.stringify(world.sheet(cleric.id).spellcasting.slots);
  const aid = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Aid", targetCharacterIds: [ogre.id] });
  assert.equal(aid.ok, false);
  assert.match(aid.error, /through a character's sheet/);
  assert.equal(JSON.stringify(world.sheet(cleric.id).spellcasting.slots), slots, "nothing was spent");
  // The goblin is still a foe: no buff for it.
  const refused = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Bless", targetEnemyId: goblin.id });
  assert.equal(refused.ok, false);
  assert.equal(enemyOf(world, goblin.id).conditions.some((entry) => /bless/i.test(entry)), false);
});

// A person in the GM seat holding no character, at the table `world` runs.
function seatGm(world) {
  const gm = world.addUser("gm");
  const status = world.campaign().status;
  setCampaignStatus(world.campaignId, "lobby");
  assert.ok(joinByInviteCode(gm.id, world.campaign().inviteCode).campaign, "the GM joins");
  setCampaignStatus(world.campaignId, status);
  assert.equal(setDmMode(world.campaignId, "human", gm.id)?.dmUserId, gm.id, "the GM takes the seat");
  return gm;
}

async function post(world, name, body, user) {
  const handler = await world.route(`campaigns/[campaignId]/${name}`);
  world.signIn({ id: user.id });
  const response = await handler.POST(
    new Request(`http://odm.test/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

await test("At a person's table the GM plays a dominated hero's turn card by card: its cards aim at the party and resolve, its player is refused, and the GM's End turn ends it", async () => {
  const { world, sheets: [kara, victim], enemies: [foe] } = await table([FIGHTER, { ...FIGHTER, name: "Brin" }], 1, DOMINATOR);
  world.dice(1);
  const cast = await world.invoke("cast_at_player", { characterId: victim.id, casterEnemyId: foe.id, spell: "Dominate Person", saveAbility: "wis", dc: 20 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  const gm = seatGm(world);
  const encounter = world.encounter();
  const place = encounter.order.findIndex((entry) => entry.kind === "pc" && entry.characterId === victim.id);
  encounters.saveEncounter({ ...encounter, turnIndex: place, turnBudget: null, legendary: { ...encounter.legendary, due: [] } });

  // The server and the GM's screen agree whose turn the seat plays.
  assert.equal(command.gmCompanionTurn(world.campaign(), gm.id)?.id, victim.id, "the dominated hero's turn is the GM's to play");
  assert.equal(command.gmCompanionTurn(world.campaign(), victim.userId), null, "not its player's");
  const view = activePublicEncounter(world.campaignId, { enemyNumbers: true });
  assert.equal(gmTurnDominated(world.sheets(), victim.id, view.sides)?.id, victim.id);
  assert.equal(gmTurnDominated(world.sheets(), kara.id, view.sides), null, "a hero the charm does not hold");
  assert.equal(gmTurnCompanion(world.sheets(), victim.id), null, "no companion");
  // Its Hand aims at the party it now fights, not at its dominator.
  const chips = handTargets(view.enemies, world.sheets(), victim.id, undefined, view.sides);
  assert.deepEqual(chips.filter((chip) => chip.kind === "enemy").map((chip) => chip.id), [kara.id]);
  assert.ok(chips.some((chip) => chip.id === victim.id && chip.kind === "self"));
  // And Kara's Hand, on her turn, may aim at Brin.
  assert.ok(handTargets(view.enemies, world.sheets(), kara.id, undefined, view.sides).some((chip) => chip.id === victim.id && chip.kind === "enemy"));

  // The attack card from the GM seat: rolled and landed on Kara at once.
  const before = world.sheet(kara.id).currentHp;
  world.dice(19, 6);
  const swung = await post(world, "actions", {
    kind: "do",
    content: "Brin turns his blade on Kara.",
    characterId: victim.id,
    intent: { card: "attack", weapon: "Longsword", targetKind: "enemy", targetId: kara.id, targetName: kara.name },
  }, gm);
  world.clearDice();
  assert.equal(swung.status, 200, JSON.stringify(swung.body));
  assert.equal(swung.body.resolved, true);
  assert.ok(world.sheet(kara.id).currentHp < before, "the swing landed on Kara");

  // Its player is still refused, card or End turn.
  const theirs = await post(world, "actions", { kind: "do", content: "Brin drops his sword.", characterId: victim.id, intent: { card: "basic", action: "dodge" } }, { id: victim.userId });
  assert.equal(theirs.status, 409);
  assert.equal(theirs.body.dominated, true);
  assert.equal((await post(world, "encounter/end-turn", {}, { id: victim.userId })).status, 409);

  // The GM's End turn ends it.
  const ended = await post(world, "encounter/end-turn", {}, gm);
  assert.equal(ended.status, 200, JSON.stringify(ended.body));
  const now = world.encounter();
  assert.notEqual(now.order[now.turnIndex]?.characterId, victim.id, "Brin's turn was handed on");
});

// The actions route refused a dominated hero's player, and the board's own
// routes did not: on its turn the player still walked its token, took the
// walk back and drew its weapon (issue 685 review).
await test("A dominated hero's player cannot walk its token, take a walk back or draw its gear on its turn", async () => {
  const { world, sheets: [, victim], enemies: [foe] } = await table([FIGHTER, { ...FIGHTER, name: "Brin" }], 1, DOMINATOR);
  world.dice(1);
  const cast = await world.invoke("cast_at_player", { characterId: victim.id, casterEnemyId: foe.id, spell: "Dominate Person", saveAbility: "wis", dc: 20 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  const kit = await combatKit(world);
  await layMap(world, field(16), { [victim.id]: { x: 2, y: 2 }, [foe.id]: { x: 12, y: 2 } });
  const encounter = world.encounter();
  const place = encounter.order.findIndex((entry) => entry.kind === "pc" && entry.characterId === victim.id);
  encounters.saveEncounter({ ...encounter, turnIndex: place, turnBudget: null, legendary: { ...encounter.legendary, due: [] } });
  const player = { id: victim.userId };

  const walked = await post(world, "battle-map/move", { x: 4, y: 2 }, player);
  assert.equal(walked.status, 409, JSON.stringify(walked.body));
  assert.equal(walked.body.dominated, true);
  assert.match(walked.body.error, /Brin is dominated: the GM plays Brin until the charm ends/);
  assert.deepEqual([kit.token(victim.id).x, kit.token(victim.id).y], [2, 2], "the token stays where it stood");
  const undone = await post(world, "battle-map/undo", {}, player);
  assert.equal(undone.status, 409, JSON.stringify(undone.body));
  assert.equal(undone.body.dominated, true);
  const stowed = await post(world, "sheet/usage", { characterId: victim.id, gear: { Longsword: { equipped: false } } }, player);
  assert.equal(stowed.status, 409, JSON.stringify(stowed.body));
  assert.equal(stowed.body.dominated, true);
  assert.equal(world.sheet(victim.id).equipment.find((item) => item.name === "Longsword")?.equipped, true, "the sword stays drawn");

  // The charm ends: the walk is the player's again.
  assert.equal((await world.invoke("clear_condition", { characterId: victim.id, condition: "charmed" })).ok, true);
  const freed = await post(world, "battle-map/move", { x: 4, y: 2 }, player);
  assert.equal(freed.status, 200, JSON.stringify(freed.body));
});

await test("The screens hand the GM seat a dominated hero's Hand, its Do and its End turn on a host that offers it", () => {
  const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const composer = read("app/campaigns/[campaignId]/Composer.tsx");
  assert.match(composer, /const gmDominated = gmCompanions && hostOffers\(capabilities, "gmDominatedTurns"\)/);
  assert.match(composer, /gmDominated && Boolean\(gmTurnDominated\(sheets, current\.id, hand\.encounter\?\.sides\)\)/);
  assert.match(composer, /runsDominated=\{gmDominated\}/);
  const hand = read("app/campaigns/[campaignId]/Hand.tsx");
  assert.match(hand, /runsDominated && !reactionsOnly \? gmTurnDominated\(sheets, turnId, encounter\.sides\)/);
  assert.match(hand, /handTargets\(encounter\.enemies, sheets, sheet\?\.id, edges, encounter\.sides[,)]/);
  const view = read("app/campaigns/[campaignId]/SessionView.tsx");
  assert.match(view, /const gmDominated = gmCompanions && hostOffers\(capabilities, "gmDominatedTurns"\)/);
  assert.match(view, /heldHero && turnSheet\?\.id === heldHero\.id/, "the box opens on the dominated hero's turn");
});

closeTables();
finish();
