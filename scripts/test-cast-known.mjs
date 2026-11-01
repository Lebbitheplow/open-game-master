// Who of the cast each seat is sent (issue 650). A person the table has met
// or heard named is known, and every seat is sent them; anyone else (a
// module's prepared cast, a name the AI registered without saying it) goes
// only to the seats that read the whole cast in the GM's people panel. The
// cast used to reach every player's device whole, and the composer's @ menu
// reads it, so a stranger there would be a spoiler on screen.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";

const { upsertNpc, markNpcMet, mergeNpcs, getNpcById } = await import("../src/lib/db/npcs.ts");
const { castForSeat, wholeCast, publishCast } = await import("../src/lib/dm/cast.ts");
const { insertCampaignMessage, updateMessageContent } = await import("../src/lib/db/messages.ts");
const { allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { subscribe } = await import("../src/lib/events.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { backfillNpcHeard } = await import("../src/lib/db/npc-heard-backfill.ts");
const { COPY_OVERRIDES } = await import("../src/lib/db/content-copy.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// A table a person runs: the owner holds the GM seat, two players a hero each.
async function table(gameSettings = { dmMode: "human" }) {
  const world = await openWorld({ gameSettings });
  const kara = world.addUser("kara");
  const brom = world.addUser("brom");
  const karaHero = world.addHero({ name: "Kara", user: kara });
  world.addHero({ name: "Brom", user: brom });
  const npc = (name, aliases = []) => upsertNpc({ campaignId: world.campaignId, name, aliases });
  const gm = (content, speech = []) =>
    insertCampaignMessage({ campaignId: world.campaignId, seq: allocateSeq(world.campaignId), authorType: "dm", content, speech });
  const names = (cast) => cast.map((member) => member.name).sort();
  return { world, kara, brom, karaHero, npc, gm, names };
}

async function snapshotCast(world, user) {
  world.signIn(user);
  const route = await world.route("campaigns/[campaignId]");
  const response = await route.GET(new Request("http://test/api"), { params: Promise.resolve({ campaignId: world.campaignId }) });
  assert.equal(response.status, 200);
  return (await response.json()).cast;
}

await test("a name never said reaches the GM seat marked, and no player's snapshot", async () => {
  const { world, kara, npc, gm, names } = await table();
  npc("Sildar Hallwinter");
  npc("Iarno Albrek");
  gm("Sildar Hallwinter waves you over.");
  const player = await snapshotCast(world, kara);
  assert.deepEqual(names(player), ["Sildar Hallwinter"]);
  assert.ok(player.every((member) => member.known === true));
  const keeper = await snapshotCast(world, world.owner);
  assert.deepEqual(
    keeper.map(({ name, known }) => ({ name, known })).sort((a, b) => a.name.localeCompare(b.name)),
    [{ name: "Iarno Albrek", known: false }, { name: "Sildar Hallwinter", known: true }],
  );
});

await test("at an AI table the lead who steers it holds the whole cast; another player does not", async () => {
  const { world, kara, npc, names } = await table({});
  npc("Glasstaff");
  assert.deepEqual(names(await snapshotCast(world, world.owner)), ["Glasstaff"]);
  assert.deepEqual(await snapshotCast(world, kara), []);
});

await test("the GM saying a name makes it known, and every seat is sent it before the message lands", async () => {
  const { world, kara, npc, gm } = await table();
  npc("Iarno Albrek");
  const heard = [];
  world.signIn(kara);
  const stop = subscribe(world.campaignId, (chunk) => heard.push(chunk), kara.id);
  try {
    publishCast(world.campaignId);
    assert.ok(!heard.join("").includes("Iarno"), "a stranger's name is not sent to a player");
    heard.length = 0;
    gm("A man in a fine cloak steps out: Iarno Albrek, he says.");
  } finally {
    stop();
  }
  const cast = heard.filter((chunk) => /^event: cast_updated$/m.test(chunk));
  assert.equal(cast.length, 1, "one cast sent");
  assert.ok(cast[0].includes("Iarno Albrek"));
  assert.equal(castForSeat(world.campaignId, false)[0]?.name, "Iarno Albrek");
  assert.ok(getNpcById(wholeCast(world.campaignId)[0].id).heardAt, "the hearing is kept");
});

await test("the GM seat is sent the whole cast live, each marked", async () => {
  const { world, npc } = await table();
  npc("Iarno Albrek");
  const heard = [];
  const stop = subscribe(world.campaignId, (chunk) => heard.push(chunk), world.owner.id);
  try {
    publishCast(world.campaignId);
  } finally {
    stop();
  }
  const sent = JSON.parse(/data: (.*)\n/.exec(heard.find((chunk) => /^event: cast_updated$/m.test(chunk)))[1]);
  assert.deepEqual(sent.cast.map(({ name, known }) => ({ name, known })), [{ name: "Iarno Albrek", known: false }]);
});

await test("a quoted line's speaker is heard even when the prose never says the name", async () => {
  const { world, npc, gm } = await table();
  const iarno = npc("Iarno Albrek");
  gm('The robed figure turns. "You should not have come."', [{ line: "You should not have come.", speaker: { kind: "npc", id: iarno.id, name: iarno.name } }]);
  assert.deepEqual(castForSeat(world.campaignId, false).map((member) => member.name), ["Iarno Albrek"]);
});

await test("a player's guess, an alias, or a name inside another word is not the story naming them", async () => {
  const { world, karaHero, npc, gm } = await table();
  npc("Nezznar", ["the Black Spider"]);
  npc("Al");
  world.say("player", "Is the wizard Nezznar?", karaHero);
  gm("Rumour speaks of the Black Spider. It has always been so.");
  assert.deepEqual(castForSeat(world.campaignId, false), []);
});

await test("a system line names them too, as does an accepted rewrite of a passage", async () => {
  const { world, npc, gm } = await table();
  npc("Sildar Hallwinter");
  npc("Daran Edermath");
  insertCampaignMessage({ campaignId: world.campaignId, seq: allocateSeq(world.campaignId), authorType: "system", glyph: "cue-bell", content: "Sildar Hallwinter joins the conversation." });
  const passage = gm("An old elf tends the orchard.");
  updateMessageContent(passage.id, "Daran Edermath tends the orchard.", []);
  assert.deepEqual(castForSeat(world.campaignId, false).map((member) => member.name).sort(), ["Daran Edermath", "Sildar Hallwinter"]);
});

await test("someone the party met through a rule is known without being named", async () => {
  const { world, npc } = await table();
  const stranger = npc("Toblen Stonehill");
  markNpcMet(stranger.id);
  assert.deepEqual(castForSeat(world.campaignId, false).map((member) => member.name), ["Toblen Stonehill"]);
});

await test("two rows merged into one keep the earlier hearing", async () => {
  const { world, npc, gm } = await table();
  const keep = npc("Marla Venn");
  const other = npc("Marla");
  gm("Marla waves.");
  mergeNpcs(world.campaignId, keep.id, other.id, ["Marla"]);
  assert.ok(getNpcById(keep.id).heardAt, "the absorbed row's hearing carries over");
});

await test("an upgraded table hears every name its transcript already said, as of when it was said", async () => {
  const { world, karaHero, npc, gm } = await table();
  const sildar = npc("Sildar Hallwinter");
  const iarno = npc("Iarno Albrek");
  const nezznar = npc("Nezznar");
  const first = gm("Sildar Hallwinter waves you over.");
  gm('"Leave."', [{ line: "Leave.", speaker: { kind: "npc", id: iarno.id, name: iarno.name } }]);
  world.say("player", "Nezznar, is it you?", karaHero);
  getDatabase().prepare(`UPDATE npcs SET heard_at = '' WHERE campaign_id = ?`).run(world.campaignId);
  backfillNpcHeard(getDatabase());
  assert.equal(getNpcById(sildar.id).heardAt, first.createdAt);
  assert.ok(getNpcById(iarno.id).heardAt);
  assert.equal(getNpcById(nezznar.id).heardAt, "", "a player's words do not count");
});

await test("a rewind to a snapshot taken before heard_at existed keeps the names its transcript said", async () => {
  const { world, npc, gm } = await table();
  const sildar = npc("Sildar Hallwinter");
  gm("Sildar Hallwinter waves you over.");
  const { restoreSnapshot } = await import("../src/lib/db/snapshots.ts");
  const rows = getDatabase().prepare(`SELECT * FROM npcs WHERE campaign_id = ?`).all(world.campaignId).map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => column !== "heard_at")));
  assert.ok(rows.length && !("heard_at" in rows[0]), "the old snapshot's rows carry no heard_at");
  getDatabase().transaction(() => restoreSnapshot(world.campaignId, { tables: { npcs: rows } }))();
  assert.ok(getNpcById(sildar.id).heardAt, "heard again from the transcript");
});

await test("a copy to another table hears nobody yet", () => {
  assert.ok(COPY_OVERRIDES.npcs.includes("heard_at"));
});

console.log(`${passed} cast known tests passed`);
