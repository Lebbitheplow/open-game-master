// What a seat is sent of the DM's secrets and a player's private sheet
// fields, through every channel that carried them in the table function
// audit of 2026-10-26 (findings T01-T04): live events,
// replay after a reconnect, the snapshot, the transcript, roll breakdowns and
// route responses. Each check reads what a real recipient was handed, not
// only what a visibility helper answers.
//
//   T01  a custom attribute is the DM's bookkeeping: no player seat is sent it.
//   T02  an effect the party cannot tell is there reaches no player: not in
//        the effects list, not in a line saying it was set, lifted or wore
//        off, not by name in a roll it changes, and not on an enemy.
//   T03  a correction of a character's notes or opt-ins is listed for the
//        table without their values; the owner and the DM read it whole.
//   T04  undoing a correction answers the lead with the sheet as the lead
//        may read it.
//
// And a creature the GM keeps off the board: the stream calls it "someone
// unseen" (src/lib/table-delivery.ts), and what a seat reads outside the
// stream must say the same, or a reload names it: a page's first load (its
// messages, rolls, waiting roll cards, sheet changes and fight), GET /rolls,
// GET /messages, GET /encounter, a waiting roll card as it is dealt, and the
// board's hint on the viewer's own square.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const campaigns = await import("../src/lib/db/campaigns.ts");
const events = await import("../src/lib/events.ts");
const { listRecentAudit } = await import("../src/lib/db/sheet-audit.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { startTurnConditions } = await import("../src/lib/dm/condition-tick.ts");
const { listEffects } = await import("../src/lib/db/active-effects.ts");
const { setTokenHidden, getBattleMapForEncounter, getTokenByRef } = await import("../src/lib/db/battle-maps.ts");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

const { test, finish } = suite("test-table-privacy");

async function call(world, user, suffix, method = "GET", body, extra = {}) {
  world.signIn(user);
  const handler = await world.route(`campaigns/[campaignId]${suffix}`);
  const response = await handler[method](
    new Request(`http://test/api/campaigns/${world.campaignId}${suffix}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    }),
    { params: Promise.resolve({ campaignId: world.campaignId, ...extra }) },
  );
  return { status: response.status, body: await response.json() };
}

// Everything one seat's open stream is handed while `run` runs.
async function heard(world, users, run) {
  const out = new Map(users.map((user) => [user.id, []]));
  const stops = users.map((user) =>
    events.subscribe(world.campaignId, (chunk) => {
      const type = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (type && data) {
        out.get(user.id).push({ type, payload: JSON.parse(data) });
      }
    }, user.id),
  );
  try {
    await run();
  } finally {
    stops.forEach((stop) => stop());
  }
  return out;
}

// The whole log replayed for one seat, as a reconnecting tab gets it.
function replayed(world, user) {
  const out = [];
  events.forEachEventSince(world.campaignId, 0, (event) => out.push(event), 500, user.id);
  return out;
}

const has = (value, marker) => JSON.stringify(value).includes(marker);
const transcript = (world) => listRecentMessages(world.campaignId, 200).map((message) => message.content).join("\n");

// ---- a human DM's table: the DM, a player, a separate party lead ----

const human = await openWorld({ gameSettings: { dmMode: "human" } });
const dm = human.owner;
const player = human.addUser("player");
const hero = human.addHero({ user: player, name: "Ilse Marr" });
const lead = human.addUser("lead");
human.addHero({ user: lead, name: "Audit Lead" });
campaigns.setPartyLead(human.campaignId, lead.id);

await test("T01: a hidden attribute, set, adjusted and removed, reaches the DM and no player, live or on replay", async () => {
  const secret = "HIDDEN-RITUAL-9817";
  const shown = "SHOWN-STANDING-4410";
  const live = await heard(human, [dm, player, lead], async () => {
    const target = { target: "campaign", targetId: human.campaignId };
    assert.equal((await call(human, dm, "/dm/attributes", "POST", { do: "set", ...target, label: "Ritual", type: "text", value: secret, visible: false })).status, 200);
    assert.equal((await call(human, dm, "/dm/attributes", "POST", { do: "set", ...target, label: "Standing", type: "text", value: shown, visible: true })).status, 200);
    assert.equal((await call(human, dm, "/dm/attributes", "POST", { do: "set", ...target, label: "Doom", type: "number", value: 3, max: 10, visible: false })).status, 200);
    assert.equal((await call(human, dm, "/dm/attributes", "POST", { do: "adjust", ...target, key: "doom", delta: 2 })).status, 200);
    assert.equal((await call(human, dm, "/dm/attributes", "POST", { do: "remove", ...target, key: "standing" })).status, 200);
  });
  for (const seat of [player, lead]) {
    assert.equal(live.get(seat.id).some((event) => event.type === "attributes_updated"), false, "live: no attribute event to a player");
    assert.equal(has(replayed(human, seat), secret), false, "replay: no hidden value to a player");
    assert.equal(replayed(human, seat).some((event) => event.type === "attributes_updated"), false);
  }
  assert.equal(live.get(dm.id).filter((event) => event.type === "attributes_updated").length, 5, "the DM hears every change");
  assert.equal(has(live.get(dm.id), secret), true);
  assert.equal(has(replayed(human, dm), secret), true, "the DM's replay keeps them");
  assert.equal((await call(human, player, "/dm/attributes")).status, 403, "the read route was already closed");
});

await test("T02: a hidden effect is in no player's list, live or on replay, and the DM's list keeps it", async () => {
  const secret = "HIDDEN-CURSE-2143";
  const live = await heard(human, [dm, player], async () => {
    const set = await call(human, dm, "/dm/invoke", "POST", { name: "set_effect", args: { characterId: hero.id, name: secret, modifiers: [{ field: "ac", mode: "add", value: -2 }], visible: false } });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    const shown = await call(human, dm, "/dm/invoke", "POST", { name: "set_effect", args: { characterId: hero.id, name: "Shrine Blessing", modifiers: [{ field: "ac", mode: "add", value: 1 }], visible: true } });
    assert.equal(shown.status, 200, JSON.stringify(shown.body));
  });
  const playerLists = live.get(player.id).filter((event) => event.type === "effects_updated");
  assert.ok(playerLists.length >= 2, "the player is still told the list changed");
  assert.equal(has(live.get(player.id), secret), false, "live: not to the player");
  assert.equal(has(playerLists.at(-1), "Shrine Blessing"), true, "the effect the party can tell is there still arrives");
  assert.equal(has(replayed(human, player), secret), false, "replay: not to the player");
  assert.equal(has(live.get(dm.id).filter((event) => event.type === "effects_updated"), secret), true, "live: the DM's list has it");
  assert.equal(has((await call(human, player, "/dm/effects")).body, secret), false);
  assert.equal(has((await call(human, dm, "/dm/effects")).body, secret), true);
  assert.equal(transcript(human).includes(secret), false, "no line announced it");
});

await test("T02: a roll a hidden effect changes moves by it but does not name it", async () => {
  const secret = "HIDDEN-HEX-6602";
  human.dice(12);
  const plain = await human.invoke("request_roll", { characterId: hero.id, kind: "ability_check", ability: "str", reason: "a light door" });
  human.clearDice();
  assert.equal(plain.ok, true, plain.error);
  const set = await human.invoke("set_effect", { characterId: hero.id, name: secret, modifiers: [{ field: "check", mode: "add", value: -3 }], visible: false });
  assert.equal(set.ok, true, set.error);
  human.dice(12);
  const rolled = await human.invoke("request_roll", { characterId: hero.id, kind: "ability_check", ability: "str", reason: "a heavy door" });
  human.clearDice();
  assert.equal(rolled.ok, true, rolled.error);
  assert.equal(has(rolled.result, secret), false, "the breakdown does not name it");
  assert.equal(rolled.result.total, plain.result.total - 3, "the number still honors it");
  assert.equal(has(replayed(human, player), secret), false, "nor does the roll's event");
  assert.equal((await human.invoke("clear_effect", { characterId: hero.id, name: secret })).ok, true);
});

await test("T02: lifting a hidden effect says nothing; lifting a visible one is still announced", async () => {
  const secret = "HIDDEN-CURSE-2143";
  const lifted = await call(human, dm, "/dm/invoke", "POST", { name: "clear_effect", args: { characterId: hero.id, name: secret } });
  assert.equal(lifted.status, 200, JSON.stringify(lifted.body));
  assert.equal(transcript(human).includes(secret), false, "no 'lifts from' line");
  const shown = await call(human, dm, "/dm/invoke", "POST", { name: "clear_effect", args: { characterId: hero.id, name: "Shrine Blessing" } });
  assert.equal(shown.status, 200, JSON.stringify(shown.body));
  assert.match(transcript(human), /Shrine Blessing lifts from Ilse Marr\./);
});

await test("T02: a hidden effect on an enemy gives away neither its name nor which enemy, and wears off quietly", async () => {
  const secret = "HIDDEN-MARK-3318";
  const fight = await openWorld({ gameSettings: { dmMode: "human" } });
  const fightPlayer = fight.addUser("player");
  fight.addHero({ user: fightPlayer, name: "Watcher" });
  const encounter = await fight.beginFight([{ monster: "goblin", count: 1 }], { enemyFace: 1 });
  const goblin = fight.enemies()[0];
  const live = await heard(fight, [fightPlayer], async () => {
    const set = await fight.invoke("set_effect", { enemyId: goblin.id, name: secret, modifiers: [{ field: "attack", mode: "add", value: 2 }], duration: "rounds", remaining: 1, visible: false });
    assert.equal(set.ok, true, set.error);
  });
  for (const view of [live.get(fightPlayer.id), replayed(fight, fightPlayer)]) {
    const lists = view.filter((event) => event.type === "effects_updated");
    assert.equal(has(lists, secret), false);
    assert.equal(has(lists, goblin.id), false, "the target id is not sent either");
  }
  // Its round is counted as the turn it was set on comes again.
  const setOn = fight.encounter().order[fight.encounter().turnIndex];
  startTurnConditions(fight.campaign(), fight.encounter(), [setOn.kind === "pc" ? setOn.characterId : setOn.enemyId]);
  assert.equal(listEffects(fight.campaignId, { kind: "enemy", id: goblin.id }).length, 0, "it did wear off");
  assert.equal(transcript(fight).includes(secret), false, "no 'wears off' line for it");
});

await test("T03: a DM's correction of a player's notes is listed for the table without them", async () => {
  const secret = "PRIVATE-NOTE-7531";
  const live = await heard(human, [dm, player, lead], async () => {
    const saved = await call(human, dm, "/sheets/[sheetId]", "PATCH", { notes: secret, openToPacts: true, currentHp: 20, reason: "Audit correction" }, { sheetId: hero.id });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
  });
  const audits = (userId) => live.get(userId).filter((event) => event.type === "sheet_audit");
  const leadEntry = audits(lead.id).at(-1)?.payload.entry;
  assert.ok(leadEntry, "the lead still hears a correction was made");
  assert.equal(has(leadEntry, secret), false, "live: not to the lead");
  assert.deepEqual(Object.keys(leadEntry.delta).sort(), ["currentHp", "notes"], "which fields changed is still said");
  assert.equal(leadEntry.delta.notes, "");
  assert.equal(leadEntry.delta.currentHp, 20, "the numbers are the table's");
  // The opt-ins are the player's own word (their own routes); a correction
  // cannot set one, so none can be listed.
  assert.equal(human.sheet(hero.id).openToPacts ?? false, false, "a correction does not open a character to pacts");
  assert.equal(has(audits(player.id), secret), true, "live: the owner reads it whole");
  assert.equal(has(audits(dm.id), secret), true, "live: the DM reads it whole");

  const leadSnapshot = (await call(human, lead, "")).body;
  assert.equal(leadSnapshot.sheets.find((sheet) => sheet.id === hero.id).notes, "");
  assert.equal(has(leadSnapshot.auditLog, secret), false, "snapshot: not to the lead");
  assert.equal(has((await call(human, player, "")).body.auditLog, secret), true, "snapshot: the owner's has it");
  assert.equal(has((await call(human, dm, "")).body.auditLog, secret), true, "snapshot: the DM's has it");
  assert.equal(has(replayed(human, lead).filter((event) => event.type === "sheet_audit"), secret), false, "replay: not to the lead");
  assert.equal(has(replayed(human, player).filter((event) => event.type === "sheet_audit"), secret), true, "replay: the owner's is whole");
  assert.equal(has(replayed(human, dm).filter((event) => event.type === "sheet_audit"), secret), true, "replay: the DM's is whole");
  // The undo data is untouched.
  assert.equal(has(listRecentAudit(human.campaignId, 5), secret), true, "the database keeps the whole row");
});

await test("T03: undoing a notes correction restores them without listing them for the table", async () => {
  const original = "OWNER-WROTE-1199";
  human.patch(hero.id, { notes: original });
  const saved = await call(human, dm, "/sheets/[sheetId]", "PATCH", { notes: "overwritten", reason: "wrong sheet" }, { sheetId: hero.id });
  assert.equal(saved.status, 200);
  const entry = listRecentAudit(human.campaignId, 5).filter((row) => row.characterId === hero.id && row.kind === "lead_edit").at(-1);
  const live = await heard(human, [player, lead], async () => {
    const undone = await call(human, dm, "/audit/[entryId]/undo", "POST", { confirm: true }, { entryId: entry.id });
    assert.equal(undone.status, 200, JSON.stringify(undone.body));
    assert.equal(undone.body.sheet.notes, original, "the DM reads the restored notes");
  });
  assert.equal(human.sheet(hero.id).notes, original, "the undo restored them");
  assert.equal(has(live.get(lead.id), original), false, "live: not to the lead");
  assert.equal(has((await call(human, lead, "")).body, original), false, "snapshot: not to the lead, anywhere");
  assert.equal(has(live.get(player.id).filter((event) => event.type === "sheet_audit"), original), true, "the owner reads their own");
});

await test("T02: a hidden effect's aura is drawn on no player's board; a visible one's is", async () => {
  const fight = await openWorld({ gameSettings: { dmMode: "human" } });
  const fightPlayer = fight.addUser("player");
  const watcher = fight.addHero({ user: fightPlayer, name: "Watcher" });
  await fight.beginFight([{ monster: "goblin", count: 1 }], { enemyFace: 1 });
  // On the player's own hero, whom their board always shows.
  const ring = (name, visible) => fight.invoke("set_effect", { characterId: watcher.id, name, modifiers: [{ field: "ac", mode: "add", value: 1 }], auraFeet: 10, auraTone: "harm", visible });
  assert.equal((await ring("HIDDEN-CHILL-5511", false)).ok, true);
  const board = getBattleMapForEncounter(fight.encounter().id);
  const tokenId = getTokenByRef(board.id, watcher.id).id;
  const seen = (userId, fullVision) => buildPlayerMapView(fight.campaignId, userId, { fullVision })?.tokenAuras?.[tokenId] ?? [];
  assert.equal(seen(fightPlayer.id, false).length, 0, "the player's board draws the hidden ring");
  assert.equal(seen(fight.owner.id, true).length, 1, "the DM's board draws it");
  assert.equal((await ring("Warding Glow", true)).ok, true);
  assert.equal(seen(fightPlayer.id, false).length, 1, "a ring the party can tell is there is drawn for them");
});

await test("T02: a visible effect on an enemy the DM keeps off the board names it to nobody and is in no player's list", async () => {
  const fight = await openWorld({ gameSettings: { dmMode: "human" } });
  const fightPlayer = fight.addUser("player");
  fight.addHero({ user: fightPlayer, name: "Watcher" });
  await fight.beginFight([{ monster: "goblin", count: 1 }], { enemyFace: 1 });
  const goblin = fight.enemies()[0];
  const board = getBattleMapForEncounter(fight.encounter().id);
  setTokenHidden(getTokenByRef(board.id, goblin.id).id, true);
  const live = await heard(fight, [fightPlayer], async () => {
    assert.equal((await fight.invoke("set_effect", { enemyId: goblin.id, name: "Hexed", modifiers: [{ field: "check", mode: "disadvantage" }], visible: true })).ok, true);
    assert.equal((await fight.invoke("clear_effect", { enemyId: goblin.id, name: "Hexed" })).ok, true);
  });
  // The fight's own events from before the token was hidden named it, as
  // the board did; what the effect sent after must not.
  const ofEffect = (view) => view.filter((event) => event.type === "effects_updated" || event.type === "message_added");
  for (const view of [live.get(fightPlayer.id), replayed(fight, fightPlayer)]) {
    assert.equal(has(ofEffect(view), goblin.id), false, "the hidden goblin's id");
    assert.equal(has(ofEffect(view).filter((event) => /Hexed/.test(JSON.stringify(event.payload))), goblin.displayName), false, "the hidden goblin's name");
  }
  assert.match(transcript(fight), /someone unseen: Hexed/);
  assert.match(transcript(fight), /Hexed lifts from someone unseen\./);
  assert.equal((await fight.invoke("set_effect", { enemyId: goblin.id, name: "Hexed", modifiers: [{ field: "check", mode: "disadvantage" }], visible: true })).ok, true);
  assert.equal(has((await call(fight, fightPlayer, "/dm/effects")).body, goblin.id), false, "the read route leaves it out");
  assert.equal(has((await call(fight, fight.owner, "/dm/effects")).body, goblin.id), true, "the DM's list keeps it");
});

// ---- a creature the GM keeps off the board, read outside the stream ----

await test("a reload names no creature the GM keeps off the board: the first load, the routes that read its lists one by one, a waiting roll card and the board's own hint read 'someone unseen', as the stream said", async () => {
  const fight = await openWorld({ gameSettings: { dmMode: "human", dicePolicy: "real_allowed" } });
  const fightPlayer = fight.addUser("player");
  const watcher = fight.addHero({ user: fightPlayer, name: "Watcher", class: "fighter", level: 5, maxHp: 60, equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
  // The GM's own character, so the GM's board has a square of its own to
  // read a hint for.
  const warden = fight.addHero({ user: fight.owner, name: "Warden", maxHp: 60 });
  // A line of the story from before the fight, which says "bandit" of no
  // creature in it: an hour old, so it is plainly the older row.
  const older = fight.say("dm", "The bandit camp lies a day to the north.");
  getDatabase().prepare("UPDATE campaign_messages SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 3_600_000).toISOString(), older.id);
  await fight.beginFight([{ monster: "bandit", count: 1 }], { enemyFace: 1, heroFaces: { [watcher.id]: 20, [warden.id]: 10 } });
  const bandit = fight.enemies()[0];
  // Side by side on open ground, so each can reach the other.
  const kit = await combatKit(fight);
  kit.openField();
  kit.place(watcher.id, 2, 2);
  kit.place(bandit.id, 3, 2);
  kit.place(warden.id, 4, 2);
  const board = getBattleMapForEncounter(fight.encounter().id);
  setTokenHidden(getTokenByRef(board.id, bandit.id).id, true);
  const names = (value) => new RegExp(`\\b${bandit.displayName}\\b`, "i").test(JSON.stringify(value));
  const unseen = (value) => /someone unseen/i.test(JSON.stringify(value));

  // A blow that lands naming it (a roll, a table note, a sheet change and
  // the fight's record of the hit), then a card that waits on the player's
  // own dice for a swing at it.
  const live = await heard(fight, [fightPlayer, fight.owner], async () => {
    // A 15 on each d20 it throws hits; the damage die takes its highest face.
    fight.dice(15, 15, 15);
    const struck = await fight.invoke("enemy_attack", { enemyId: bandit.id, targetCharacterId: watcher.id });
    fight.clearDice();
    assert.equal(struck.ok, true, `the hidden creature's attack was refused: ${struck.error}`);
    campaigns.setMemberRealDice(fight.campaignId, fightPlayer.id, true);
    const swing = await fight.invoke("pc_attack", { characterId: watcher.id, attacks: [{ targetEnemyId: bandit.id }] });
    assert.equal(swing.ok, true, `the swing was refused: ${swing.error}`);
  });
  const of = (view, type) => view.filter((event) => event.type === type);

  // What the stream sent, which the rest must match.
  assert.ok(of(live.get(fightPlayer.id), "roll_result").length, "the player heard the roll land");
  assert.equal(names(of(live.get(fightPlayer.id), "roll_result")), false, "live: the landed roll names it to the player");
  assert.equal(names(of(live.get(fight.owner.id), "roll_result")), true, "live: the GM, who sees the whole map, reads its name");

  // The card as it is dealt, live and on a reconnect.
  assert.ok(of(live.get(fightPlayer.id), "roll_pending").length, "the player was dealt a card to roll");
  assert.equal(names(of(live.get(fightPlayer.id), "roll_pending")), false, "live: the waiting card names it to the player");
  assert.equal(unseen(of(live.get(fightPlayer.id), "roll_pending")), true, "live: the waiting card says someone unseen");
  assert.equal(names(of(live.get(fight.owner.id), "roll_pending")), true, "live: the GM's card keeps its name");
  assert.equal(names(of(replayed(fight, fightPlayer), "roll_pending")), false, "replay: the waiting card names it to the player");

  // A page's first load.
  const loaded = (await call(fight, fightPlayer, "")).body;
  assert.ok(loaded.rolls.length && loaded.pendingRolls.length, "the first load carries the roll and the card");
  assert.equal(names(loaded.rolls), false, "first load: a roll names it to the player");
  assert.equal(unseen(loaded.rolls), true, "first load: the roll says someone unseen");
  assert.equal(names(loaded.pendingRolls), false, "first load: the waiting card names it to the player");
  assert.equal(unseen(loaded.pendingRolls), true, "first load: the waiting card says someone unseen");
  const gmLoaded = (await call(fight, fight.owner, "")).body;
  assert.equal(names(gmLoaded.rolls), true, "first load: the GM's rolls keep its name");
  assert.equal(names(gmLoaded.pendingRolls), true, "first load: the GM's waiting card keeps its name");
  // The same blow in the first load's other lists: the table note of it,
  // the sheet change it made and the fight's record of the last hit.
  for (const [list, what] of [["messages", "the message list"], ["auditLog", "the sheet-change list"], ["encounter", "the fight"]]) {
    assert.equal(names(gmLoaded[list]), true, `first load: ${what} holds the blow, by name for the GM`);
    assert.equal(names(list === "messages" ? loaded.messages.filter((message) => message.id !== older.id) : loaded[list]), false, `first load: ${what} names it to the player`);
    assert.equal(unseen(loaded[list]), true, `first load: ${what} says someone unseen`);
  }
  assert.equal(loaded.encounter.lastHits.at(-1)?.attacker, "Someone unseen", "first load: the last hit's attacker");
  // What was written before the fight began is left as the table read it.
  assert.equal(loaded.messages.find((message) => message.id === older.id)?.content, "The bandit camp lies a day to the north.", "first load: a line from before the fight is rewritten");
  // The seats' own things are no part of it: nothing here is a creature's name.
  assert.deepEqual(loaded.sheets.map((sheet) => sheet.name).sort(), ["Warden", "Watcher"], "first load: the party's sheets are as they were");

  // The rolls read on their own.
  const listed = (await call(fight, fightPlayer, "/rolls")).body;
  assert.ok(listed.rolls.length, "GET /rolls lists the roll");
  assert.equal(names(listed.rolls), false, "GET /rolls: a roll names it to the player");
  assert.equal(unseen(listed.rolls), true, "GET /rolls: the roll says someone unseen");
  assert.equal(names((await call(fight, fight.owner, "/rolls")).body.rolls), true, "GET /rolls: the GM's rolls keep its name");

  // The transcript a page at a time, and the fight read on its own.
  const page = (await call(fight, fightPlayer, "/messages")).body;
  assert.equal(page.messages.find((message) => message.id === older.id)?.content, "The bandit camp lies a day to the north.", "GET /messages: a line from before the fight is rewritten");
  assert.equal(names(page.messages.filter((message) => message.id !== older.id)), false, "GET /messages: a table note names it to the player");
  assert.equal(unseen(page.messages), true, "GET /messages: the note says someone unseen");
  assert.equal(page.names[watcher.id], "Watcher", "GET /messages: who each line is from is as it was");
  assert.equal(names((await call(fight, fight.owner, "/messages")).body.messages), true, "GET /messages: the GM's page keeps its name");
  const fightRead = (await call(fight, fightPlayer, "/encounter")).body;
  assert.equal(names(fightRead), false, "GET /encounter: the last hit names it to the player");
  assert.equal(fightRead.encounter.lastHits.at(-1)?.attacker, "Someone unseen", "GET /encounter: the last hit's attacker");
  assert.equal(names((await call(fight, fight.owner, "/encounter")).body), true, "GET /encounter: the GM's fight keeps its name");

  // The board's hint on the viewer's own square: who sees them too clearly
  // to hide from.
  const boardHint = async (user) => (await call(fight, user, "/battle-map")).body.view?.self?.hide ?? "";
  assert.match(await boardHint(fight.owner), /cannot hide/, "the GM's board says its character cannot hide");
  assert.equal(names(await boardHint(fight.owner)), true, "GET /battle-map: the GM's hint keeps its name");
  assert.match(await boardHint(fightPlayer), /cannot hide/, "the player's board says their character cannot hide");
  assert.equal(names(await boardHint(fightPlayer)), false, "GET /battle-map: the hint names it to the player");
  assert.equal(unseen(await boardHint(fightPlayer)), true, "GET /battle-map: the hint says someone unseen");

  // Shown on the board, it is named again everywhere.
  setTokenHidden(getTokenByRef(board.id, bandit.id).id, false);
  assert.equal(names((await call(fight, fightPlayer, "")).body.rolls), true, "its token shown, the first load names it");
  assert.equal(names((await call(fight, fightPlayer, "/rolls")).body.rolls), true, "its token shown, GET /rolls names it");
  assert.equal(names((await call(fight, fightPlayer, "/messages")).body.messages), true, "its token shown, GET /messages names it");
  assert.equal(names(await boardHint(fightPlayer)), true, "its token shown, the board's hint names it");
});

await test("a hero who answers to a hidden creature's name keeps it on a reload, as on the stream", async () => {
  const fight = await openWorld({ gameSettings: { dmMode: "human" } });
  const fightPlayer = fight.addUser("player");
  const namesake = fight.addHero({ user: fightPlayer, name: "Bandit", maxHp: 60 });
  await fight.beginFight([{ monster: "bandit", count: 1 }], { enemyFace: 1 });
  const bandit = fight.enemies()[0];
  assert.equal(bandit.displayName, namesake.name, "the two answer to one name");
  const kit = await combatKit(fight);
  kit.openField();
  kit.place(namesake.id, 2, 2);
  kit.place(bandit.id, 3, 2);
  setTokenHidden(kit.token(bandit.id).id, true);
  fight.dice(15, 15, 15);
  const struck = await fight.invoke("enemy_attack", { enemyId: bandit.id, targetCharacterId: namesake.id });
  fight.clearDice();
  assert.equal(struck.ok, true, `the hidden creature's attack was refused: ${struck.error}`);
  const loaded = (await call(fight, fightPlayer, "")).body;
  assert.ok(loaded.messages.some((message) => /Bandit/.test(message.content)), "the table note of the blow is in the first load");
  for (const list of ["messages", "rolls", "auditLog", "encounter"]) {
    assert.equal(/someone unseen/i.test(JSON.stringify(loaded[list])), false, `first load: ${list} takes the hero's name away`);
  }
  assert.equal(/someone unseen/i.test(JSON.stringify((await call(fight, fightPlayer, "/messages")).body.messages)), false, "GET /messages takes the hero's name away");
});

await test("rows logged before the table's copy was blanked replay blanked to the seats not owed them", async () => {
  const secret = "LEGACY-NOTE-4471";
  const curse = "LEGACY-CURSE-4472";
  // As the log held them before this change: the whole row, every effect.
  const seq = () => campaigns.allocateSeq(human.campaignId);
  const insert = getDatabase().prepare(`INSERT INTO campaign_events (campaign_id, seq, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`);
  insert.run(human.campaignId, seq(), "sheet_audit", JSON.stringify({ entry: { id: "legacy-row", characterId: hero.id, kind: "lead_edit", delta: { notes: secret } }, characterName: "Ilse Marr" }), new Date().toISOString());
  insert.run(human.campaignId, seq(), "effects_updated", JSON.stringify({ effects: [{ id: "legacy-effect", name: curse, targetKind: "character", targetId: hero.id, visible: false }] }), new Date().toISOString());
  insert.run(human.campaignId, seq(), "attributes_updated", JSON.stringify({ target: "campaign", targetId: human.campaignId, attributes: [{ key: "x", value: curse, visible: false }] }), new Date().toISOString());
  assert.equal(has(replayed(human, lead), secret), false, "the lead's replay holds the old row's notes");
  assert.equal(has(replayed(human, lead), curse), false, "the lead's replay holds the old hidden effect or attribute");
  assert.equal(has(replayed(human, player), secret), true, "the owner's replay keeps them");
  assert.equal(has(replayed(human, dm), curse), true, "the DM's replay keeps the attribute");
});

await test("T01: at an AI table the lead, who steers the story, is still sent no attribute (only DM seats read /dm/attributes)", async () => {
  const ai = await openWorld();
  ai.addHero({ name: "AI lead" });
  events.publishPersisted(ai.campaignId, "attributes_updated", { target: "campaign", targetId: ai.campaignId, attributes: [{ key: "x", value: "AI-SECRET-9001", visible: false }] });
  assert.equal(has(replayed(ai, ai.owner), "AI-SECRET-9001"), false);
});

// ---- an AI-narrated table: the lead steers, and holds no DM seat ----

await test("T04: the lead undoing an HP correction is not handed the player's notes", async () => {
  const ai = await openWorld();
  ai.addHero({ name: "AI lead" });
  const owner = ai.addUser("note-owner");
  const secret = "UNDO-NOTES-8235";
  const other = ai.addHero({ user: owner, notes: secret });
  const corrected = await call(ai, ai.owner, "/sheets/[sheetId]", "PATCH", { currentHp: 12 }, { sheetId: other.id });
  assert.equal(corrected.status, 200);
  assert.equal(corrected.body.sheet.notes, "");
  const entry = listRecentAudit(ai.campaignId, 10).find((row) => row.characterId === other.id && row.kind === "lead_edit");
  const undone = await call(ai, ai.owner, "/audit/[entryId]/undo", "POST", {}, { entryId: entry.id });
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  assert.equal(undone.body.sheet.notes, "", "the answer is the lead's view");
  assert.equal(undone.body.sheet.currentHp, other.currentHp, "and the HP came back");
  assert.equal(ai.sheet(other.id).notes, secret, "the notes themselves are untouched");
});

await finish();
