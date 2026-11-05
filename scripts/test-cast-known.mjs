// Who of the cast each seat is sent (issue 650). A person the table has met
// or heard named is known, and every seat is sent them; anyone else (a
// module's prepared cast, a name the AI registered without saying it) goes
// only to the seats that read the whole cast in the GM's people panel. The
// cast used to reach every player's device whole, and the composer's @ menu
// reads it, so a stranger there would be a spoiler on screen.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";

const { upsertNpc, markNpcMet, mergeNpcs, getNpcById, getNpcByName, renameNpc, setNpcArchived, patchNpcAgency, setNpcPortrait } = await import("../src/lib/db/npcs.ts");
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

// The casts a seat is sent while `body` runs and once the work in hand is
// done: a write to a person sends the cast on the next turn of the loop.
async function castsSent(world, user, body) {
  const heard = [];
  const stop = subscribe(world.campaignId, (chunk) => heard.push(chunk), user.id);
  try {
    await body();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    stop();
  }
  return heard
    .filter((chunk) => /^event: cast_updated$/m.test(chunk))
    .map((chunk) => JSON.parse(/data: (.*)\n/.exec(chunk)[1]).cast.map((member) => member.name).sort());
}

// A tick for writes made outside castsSent, so their cast is already sent.
const settled = () => new Promise((resolve) => setImmediate(resolve));

await test("a person met through a rule reaches every open seat at once, and only once (issue 733)", async () => {
  const { world, kara, npc } = await table();
  const stranger = npc("Toblen Stonehill");
  await settled();
  const sent = await castsSent(world, kara, () => {
    markNpcMet(stranger.id);
    markNpcMet(stranger.id);
  });
  assert.deepEqual(sent, [["Toblen Stonehill"]], "one cast, with him in it");
  assert.deepEqual(await castsSent(world, kara, () => markNpcMet(stranger.id)), [], "meeting him again sends nothing");
});

await test("a reaction roll and a relationship beat each tell the open seats who the party met (issue 733)", async () => {
  const { world, kara, karaHero, npc } = await table();
  npc("Iarno Albrek");
  npc("Daran Edermath");
  await settled();
  const rolled = await castsSent(world, kara, async () => {
    const out = await world.invoke("npc_reaction", { name: "Iarno Albrek", gender: "Male" });
    assert.ok(out.ok, out.error);
  });
  assert.deepEqual(rolled.at(-1), ["Iarno Albrek"]);
  const helped = await castsSent(world, kara, async () => {
    const out = await world.invoke("relationship_beat", { characterId: karaHero.id, subject: "Daran Edermath", beat: "helped" });
    assert.ok(out.ok, out.error);
  });
  assert.deepEqual(helped.at(-1), ["Daran Edermath", "Iarno Albrek"]);
});

await test("people met together in one call are sent in one cast", async () => {
  const { world, kara, npc } = await table();
  const a = npc("Linene Graywind");
  const b = npc("Halia Thornton");
  await settled();
  assert.deepEqual(await castsSent(world, kara, () => {
    markNpcMet(a.id);
    markNpcMet(b.id);
  }), [["Halia Thornton", "Linene Graywind"]]);
});

await test("a rename, a merge and an archive reach the open seats; a change no seat sees sends nothing (issue 733)", async () => {
  const { world, kara, npc } = await table();
  const marla = npc("Marla");
  const twin = npc("Marla Venn");
  const old = npc("Old Petch");
  for (const person of [marla, twin, old]) {
    markNpcMet(person.id);
  }
  await settled();
  assert.deepEqual(await castsSent(world, kara, () => renameNpc(marla.id, "Marla Brook", ["Marla"])), [["Marla Brook", "Marla Venn", "Old Petch"]]);
  assert.deepEqual(await castsSent(world, kara, () => mergeNpcs(world.campaignId, marla.id, twin.id, ["Marla", "Marla Venn"])), [["Marla Brook", "Old Petch"]]);
  assert.deepEqual(await castsSent(world, kara, () => setNpcArchived(old.id, true)), [["Marla Brook"]]);
  assert.deepEqual(await castsSent(world, kara, () => patchNpcAgency(marla.id, { goals: { scene: "find her brother" } })), [], "what they want is no seat's to see");
});

await test("a face painted for someone not yet introduced reaches no player's seat; a known person's reaches every seat (issue 733)", async () => {
  const { world, kara, npc } = await table();
  const stranger = npc("Iarno Albrek");
  const known = npc("Sildar Hallwinter");
  markNpcMet(known.id);
  await settled();
  const heard = [];
  const stop = subscribe(world.campaignId, (chunk) => heard.push(chunk), kara.id);
  try {
    setNpcPortrait(stranger.id, "/uploads/iarno.webp");
    setNpcPortrait(known.id, "/uploads/sildar.webp");
    await settled();
  } finally {
    stop();
  }
  const sent = heard.join("");
  assert.ok(!sent.includes("iarno.webp") && !sent.includes("Iarno"), "the stranger's face is not sent to a player");
  assert.ok(sent.includes("sildar.webp"), "the known person's new face is");
  const { readFileSync } = await import("node:fs");
  assert.ok(!readFileSync(new URL("../src/lib/portrait.ts", import.meta.url), "utf8").includes('"npc_updated"'), "a painted face is not sent to every seat");
});

await test("a seat that loads the table after a rewind hears the next change, even one back to the cast sent before it (issue 733)", async () => {
  const { world, kara, npc } = await table();
  const { captureBoundarySnapshot, getBoundarySnapshot, restoreSnapshot } = await import("../src/lib/db/snapshots.ts");
  const marla = npc("Marla Venn");
  captureBoundarySnapshot(world.campaignId, 1, 0);
  markNpcMet(marla.id);
  await settled();
  // The story rewinds to before they met, and every seat loads the table again.
  getDatabase().transaction(() => restoreSnapshot(world.campaignId, getBoundarySnapshot(world.campaignId, 1).payload))();
  assert.deepEqual(await snapshotCast(world, kara), [], "the rewound table has not met her");
  await settled();
  assert.deepEqual(await castsSent(world, kara, () => markNpcMet(marla.id)), [["Marla Venn"]], "meeting her again reaches the seat");
});

await test("a change only the story's seats can see is sent to them alone (issue 733)", async () => {
  const { world, kara, npc } = await table();
  markNpcMet(npc("Sildar Hallwinter").id);
  await settled();
  assert.deepEqual(await castsSent(world, kara, () => npc("Glasstaff")), [], "a player's seat is sent nothing when someone not yet introduced is registered");
  assert.deepEqual(await castsSent(world, kara, () => {
    npc("Halia Thornton");
    publishCast(world.campaignId);
  }), [], "nor when the GM's people panel writes one and sends the cast itself");
  assert.deepEqual(await castsSent(world, world.owner, () => npc("Nezznar")), [["Glasstaff", "Halia Thornton", "Nezznar", "Sildar Hallwinter"]], "the GM seat is sent the whole cast");
  assert.deepEqual(await castsSent(world, kara, () => markNpcMet(getNpcByName(world.campaignId, "Glasstaff").id)), [["Glasstaff", "Sildar Hallwinter"]], "and a player's seat the next change it can see");
});

await test("what each table was last sent is kept as a short digest, however large its cast", async () => {
  const { world, npc } = await table();
  for (const name of ["Ander Holt", "Bryn Marsh", "Cael Dusk", "Dara Vane", "Esk Thornton", "Fen Alderleaf", "Gwyn Stonehill", "Hale Graywind"]) {
    markNpcMet(npc(name).id);
  }
  await settled();
  const kept = JSON.stringify(globalThis.__odmCastSent?.get(world.campaignId) ?? null);
  assert.ok(kept !== "null" && kept.length <= 128, `kept ${kept.length} characters for one table`);
});

await test("a face painted for the workshop's cast tells the workshop's tools to read the cast again (issue 733)", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-cast-paint-"));
  const scriptFile = path.join(scriptDir, "fake-script.json");
  fs.writeFileSync(scriptFile, JSON.stringify([[{ paint: [48, 48] }, { text: "done" }]]));
  process.env.HARNESS_FAKE = "1";
  process.env.HARNESS_FAKE_SCRIPT = scriptFile;
  try {
    const world = await openWorld();
    const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
    const { createWorkshop } = await import("../src/lib/db/workshops.ts");
    saveGlobalConfig({ harness: { id: "codex", images: "native", imagesVerifiedAt: new Date().toISOString() }, images: { defaultBackend: "harness" } });
    const workshopId = createWorkshop(world.owner.id, { title: "Saltmarch" }).id;
    world.signIn(world.owner);
    const route = await world.route("campaigns/[campaignId]/dm/npcs");
    const response = await route.POST(
      new Request("http://test/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft: { name: "Mira Fenn", gender: "Female" }, portrait: true }) }),
      { params: Promise.resolve({ campaignId: workshopId }) },
    );
    assert.equal(response.status, 201);
    const { npc } = await response.json();
    // Heard from here: only what the painting job sends once the face lands.
    const heard = [];
    const stop = subscribe(workshopId, (chunk) => heard.push(chunk), world.owner.id);
    try {
      const until = Date.now() + 20_000;
      while (!getNpcById(npc.id).portraitUrl && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(getNpcById(npc.id).portraitUrl, "the face was painted");
      await settled();
    } finally {
      stop();
    }
    const pinged = heard
      .filter((chunk) => /^event: records_changed$/m.test(chunk))
      .some((chunk) => JSON.parse(/data: (.*)\n/.exec(chunk)[1]).kinds.includes("npc"));
    assert.ok(pinged, "the workshop's Cast tool hears that a person changed");
  } finally {
    delete process.env.HARNESS_FAKE;
    delete process.env.HARNESS_FAKE_SCRIPT;
    fs.rmSync(scriptDir, { recursive: true, force: true });
  }
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
