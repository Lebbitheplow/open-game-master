// A companion whose own mind chooses its fight turns (ticket 08,
// docs/tickets/ogm-npc-isolation-design/08-turno-di-combattimento.md) is not
// played by the backstop's basic turn when a DM turn closes without asking
// it: the narrator is woken once for that very turn, so the mind chooses and
// the narrator carries it out (src/lib/dm/encounter-tools.ts
// advanceAfterNarration). Past that one wake the basic turn stands in, so a
// fight can never wedge on a companion nobody at the table plays.
//   - The first close that left the turn unplayed wakes the narrator and
//     plays nothing for the companion.
//   - A second close on the same turn plays the basic turn, as before.
//   - At a table without minds the basic turn plays at once, as before.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-npc-mind-fight-wake");

// The spend table first: entered from genre-gh-wards instead, upstream's import cycle
// (wards -> spend effects -> horror plays -> wards) reads GH_WARD_PLAYS before it is set.
await import("../src/lib/dm/authored-spend-effects.ts");
const tools = await import("../src/lib/dm/encounter-tools.ts");
const { allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage, listAllMessages } = await import("../src/lib/db/messages.ts");
const { createCompanionUser } = await import("../src/lib/db/users.ts");
const { createSheet, markSheetAsCompanion, setCompanionCommander, getSheetById } = await import("../src/lib/db/sheets.ts");
const { companionNpcFor } = await import("../src/lib/db/companion-npcs.ts");
const { createDmTurn, getDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { registerDmWaker } = await import("../src/lib/dm/wake.ts");

// Counted here rather than run: the loop registers its own waker as it
// loads with the world, so this one is set again once the table is up.
let wakes = 0;
const countWakes = () =>
  registerDmWaker(() => {
    wakes += 1;
  });

const current = (world) => {
  const encounter = world.encounter();
  return encounter?.orderReady ? encounter.order[encounter.turnIndex] : null;
};

// A one-player table the AI runs: Kara, then Brann, an uncommanded party
// companion, then a goblin. The turn is Brann's.
async function table({ npcMinds }) {
  const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { ttsEnabled: false, npcMinds } });
  const kit = await combatKit(world);
  const kara = world.addHero({ name: "Kara", abilities: { str: 14, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });
  const bot = createCompanionUser("Brann");
  const made = createSheet(world.campaignId, bot.id, 1, {
    ...world.sheet(kara.id),
    name: "Brann",
    proficiencies: TRAINED,
    equipment: [{ name: "Battleaxe", qty: 1, equipped: true }],
  });
  markSheetAsCompanion(made.id, "party", "Gruff and loyal.");
  setCompanionCommander(made.id, null);
  companionNpcFor(getSheetById(made.id));
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [made.id]: 15 }, enemyFace: 1 });
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { maxHp: 400, currentHp: 300 });
  kit.place(made.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  kit.place(kara.id, 4, 6);
  assert.equal(kit.endTurn(world.owner.id), true, "Kara's turn ends");
  assert.equal(current(world)?.characterId, made.id, "the turn is Brann's");
  return { world, brann: made };
}

// A DM turn that narrated something else and closed, as finalize() does.
function dmTurnCloses(world) {
  const turn = createDmTurn(world.campaignId, [], "human_dm");
  insertCampaignMessage({ campaignId: world.campaignId, seq: allocateSeq(world.campaignId), authorType: "dm", content: "The goblin snarls." });
  tools.advanceAfterTurn(world.campaign(), getDmTurn(turn.id));
}

const basicTurns = (world) => listAllMessages(world.campaignId).filter((message) => /Brann's turn resolves automatically/.test(message.content)).length;

await test("a close that never asked the companion's mind wakes the narrator once for it, then the basic turn stands in", async () => {
  const { world, brann } = await table({ npcMinds: true });
  countWakes();
  wakes = 0;
  dmTurnCloses(world);
  assert.equal(basicTurns(world), 0, "no basic turn played over the mind");
  assert.equal(current(world)?.characterId, brann.id, "the turn is still Brann's");
  assert.equal(world.encounter().legendary.mindWake?.characterId, brann.id);
  assert.ok(wakes >= 1, "the narrator was woken for Brann's own turn");
  dmTurnCloses(world);
  assert.equal(basicTurns(world), 1, "past the one wake, the basic turn keeps the fight moving");
  world.close();
});

await test("at a table without minds the basic turn plays at once, as before", async () => {
  const { world } = await table({ npcMinds: false });
  countWakes();
  dmTurnCloses(world);
  assert.equal(basicTurns(world), 1);
  world.close();
});

finish();
