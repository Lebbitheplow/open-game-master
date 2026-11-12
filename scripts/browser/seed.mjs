// The world the browser scenarios open: one table in a fight on a painted
// board with a full chronicle, a quiet table out of combat, two campaigns
// still in their lobbies (one with an imported story arc), library
// characters, and a lead with a password. Writes the database, its key and the ids the scenarios
// need into the folder given, then exits (enforce-world cleans its own
// scratch folder on the way out).
//
//   node scripts/browser/seed.mjs <out-dir>
import fs from "node:fs";
import path from "node:path";
import { openWorld } from "../lib/enforce-world.mjs";
import { combatKit } from "../lib/enforce-combat.mjs";

const out = process.argv[2];
if (!out) {
  throw new Error("seed.mjs needs the folder to write into");
}
fs.mkdirSync(out, { recursive: true });

const PASSWORD = "Browser-2026-pass";
const TITLE = "Regression Table";
const LOBBY_TITLE = "Regression Lobby";

const world = await openWorld({ campaign: { title: TITLE }, gameSettings: { ttsEnabled: true } });
const kit = await combatKit(world);
const { getDatabase } = await import("../../src/lib/db/core.ts");
const campaigns = await import("../../src/lib/db/campaigns.ts");
const messages = await import("../../src/lib/db/messages.ts");
const { setUserAdmin, setUserPassword } = await import("../../src/lib/db/users.ts");
const { hashPassword } = await import("../../src/lib/auth.ts");
const { LEAD_NOTE_PREFIX } = await import("../../src/lib/campaign-types.ts");

const tavi = world.addHero({
  user: world.owner,
  name: "Tavi Lockwhisper",
  class: "rogue",
  level: 3,
  abilities: { str: 10, dex: 16 },
  proficiencies: { saves: ["dex", "int"], skills: ["stealth"], expertise: [], languages: ["Common"], tools: [], armor: ["light"], weapons: ["simple", "martial"] },
  equipment: [
    { name: "Rapier", qty: 1, equipped: true },
    { name: "Dagger", qty: 2, equipped: true },
    { name: "Leather", qty: 1, equipped: true },
  ],
});

// The story so far, enough to fill the chronicle's window, ending on the
// two entries the chronicle scenario reads whole: a long system line (a
// lead's direction, the prefix the transcript draws as a card) and a
// three-paragraph passage with emphasis and a question at its end.
const say = (content, extra = {}) => {
  const seq = campaigns.allocateSeq(world.campaignId);
  return messages.insertCampaignMessage({ campaignId: world.campaignId, seq, ...extra, content });
};
for (let index = 1; index <= 44; index += 1) {
  if (index % 3 === 0) {
    say(`Line ${index}: Tavi keeps low and watches the door.`, { authorType: "player", userId: world.owner.id, characterId: tavi.id });
  } else {
    say(`Passage ${index}. The rain drums on the slate roof of the old mill while the goblins argue in the yard below. Lantern light spills across the wet stones, and somewhere a chain rattles against a post as the wind turns.`, { authorType: "dm", speech: [] });
  }
}
// Table talk put to the DM and its out-of-character answer (PR 314): the
// chronicle reads the answer as a line, never as a passage.
const oocQuestion = "@GM can Tavi see the dog from the east wall?";
const oocAnswer = "Not from there: the dog sleeps under the cart, out of sight until you round the corner.";
say(`(ooc) ${oocQuestion}`, { authorType: "player", userId: world.owner.id, characterId: tavi.id });
say(`(ooc) ${oocAnswer}`, { authorType: "dm", speech: [] });
const systemLine =
  "Keep to the shadows along the east wall, wait for the second goblin to turn his back, and only then go for the lantern. If the dog wakes, we scatter and meet at the ford before dawn.";
say(`${LEAD_NOTE_PREFIX}${systemLine}`, { authorType: "system" });
const paragraphs = [
  "The *bolt* dies against wet salt and the yard goes quiet, the kind of quiet that has teeth in it.",
  "The nearer goblin lowers his torch. His eyes find the shadow you are standing in and stay there a moment too long.",
  "_What_ do you do?",
];
say(paragraphs.join("\n\n"), { authorType: "dm", speech: [] });

// A second hero at the table, the player's, so the travel formation has an
// order to arrange (issue 230).
const player = world.addUser("player");
const bree = world.addHero({
  user: player,
  name: "Bree Underbough",
  class: "fighter",
  level: 3,
  abilities: { str: 16, con: 14 },
  proficiencies: { saves: ["str", "con"], skills: ["athletics"], expertise: [], languages: ["Common"], tools: [], armor: ["light", "medium", "heavy", "shields"], weapons: ["simple", "martial"] },
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});
// A character in the lead's library, for the build editor (issue 229).
const { createCharacter } = await import("../../src/lib/db/characters.ts");
const LIBRARY_NAME = "Brann Stoutheart";
const brann = createCharacter(world.owner.id, 3, {
  name: LIBRARY_NAME,
  race: "human",
  class: "fighter",
  subclass: "Champion",
  background: "soldier",
  alignment: "LN",
  abilities: { str: 16, dex: 12, con: 15, int: 10, wis: 12, cha: 9 },
  maxHp: 28,
  ac: 16,
  acOverride: false,
  speed: 30,
  hitDice: { die: "d10", total: 3, spent: 0 },
  proficiencies: {
    saves: ["str", "con"],
    skills: ["athletics", "intimidation", "perception", "survival"],
    expertise: [],
    languages: ["Common", "Dwarvish"],
    tools: ["dice set", "vehicles (land)"],
    armor: ["light", "medium", "heavy", "shields"],
    weapons: ["simple", "martial"],
  },
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
  gold: 10,
  copper: 0,
  feats: [],
  // The fighting style rides as a "choice" feature, as the builder saves it.
  features: [{ name: "Fighting Style: Defense", source: "choice" }],
  asiChoices: [],
  spellcasting: null,
  notes: "",
});
// A Life Domain cleric in the library, for the builder's subclass training
// (issue 251): the domain's heavy armor is said on the calling step and kept.
const LIFE_NAME = "Wren Ashdown";
const wren = createCharacter(world.owner.id, 1, {
  name: LIFE_NAME,
  race: "human",
  class: "cleric",
  subclass: "Life Domain",
  background: "acolyte",
  alignment: "NG",
  abilities: { str: 15, dex: 11, con: 14, int: 9, wis: 16, cha: 13 },
  maxHp: 10,
  ac: 16,
  acOverride: false,
  speed: 30,
  hitDice: { die: "d8", total: 1, spent: 0 },
  proficiencies: {
    saves: ["wis", "cha"],
    skills: ["insight", "religion", "medicine", "persuasion"],
    expertise: [],
    languages: ["Common", "Dwarvish", "Elvish", "Giant"],
    tools: [],
    armor: ["light", "medium", "shields", "heavy"],
    weapons: ["simple"],
  },
  equipment: [
    { name: "Mace", qty: 1, equipped: true },
    { name: "Chain mail", qty: 1, equipped: true },
  ],
  gold: 15,
  copper: 0,
  feats: [],
  features: [],
  asiChoices: [],
  spellcasting: {
    ability: "wis",
    slots: { 1: { max: 2, used: 0 } },
    cantrips: ["Guidance", "Sacred Flame", "Spare the Dying"],
    prepared: ["Command", "Healing Word", "Sanctuary", "Shield of Faith"],
    known: [],
  },
  notes: "",
});
await kit.fight(1, { heroFaces: { [tavi.id]: 19 } });
const [goblin] = world.enemies();
kit.place(tavi.id, 2, 2);
kit.place(goblin.id, 3, 2);
kit.giveTurn(tavi.id);
// A handaxe knocked loose lies beside Tavi (issue #424): the board draws it
// within reach, and the Hand offers to pick it up.
const { insertDroppedItem } = await import("../../src/lib/db/dropped-items.ts");
insertDroppedItem({
  campaignId: world.campaignId,
  mapId: kit.map().id,
  x: 2,
  y: 3,
  place: "",
  item: { name: "Handaxe", qty: 1 },
  droppedBy: "Goblin 1",
});

// A campaign still in its lobby, for the lobby pages and the cover dialog.
const lobby = campaigns.createCampaign(world.owner.id, {
  title: LOBBY_TITLE,
  description: "A table that has not started.",
  theme: "high-fantasy",
  maxPlayers: 6,
  startingLevel: 1,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false },
});

// A DM offer waiting on the lead's own character, so the offer bar has
// something to settle (issue 239). Bree is the second Party card to arrange
// (issue 240).
const itemProposals = await import("../../src/lib/db/item-proposals.ts");
const offer = itemProposals.insertItemProposal({
  campaignId: world.campaignId,
  turnId: null,
  characterId: tavi.id,
  userId: world.owner.id,
  toolName: "grant_item",
  argsJson: JSON.stringify({ characterId: tavi.id, item: "Healing potion", qty: 1, reason: "found in the mill" }),
  summary: "Give Healing potion to Tavi Lockwhisper",
  reason: "found in the mill",
  seq: campaigns.allocateSeq(world.campaignId),
});
// A quiet table the AI narrates, with no fight: the lead's cleric holds
// Spirit Guardians (issue 252) and the player's Bree is seated beside her,
// so the party has a plan to coordinate (issue 254).
const QUIET_TITLE = "Quiet Crossing";
const { heroInput } = await import("../lib/enforce-world.mjs");
const sheets = await import("../../src/lib/db/sheets.ts");
const quiet = campaigns.createCampaign(world.owner.id, {
  title: QUIET_TITLE,
  description: "A ford at dusk, nothing hunting the party yet.",
  theme: "high-fantasy",
  maxPlayers: 6,
  startingLevel: 5,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false },
});
const joinedQuiet = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(quiet.id).inviteCode);
if ("error" in joinedQuiet) {
  throw new Error(`could not seat the player at ${QUIET_TITLE}: ${joinedQuiet.error}`);
}
campaigns.setCampaignStatus(quiet.id, "active");
const ama = sheets.createSheet(
  quiet.id,
  world.owner.id,
  5,
  heroInput({
    name: "Sister Ama",
    class: "cleric",
    level: 5,
    abilities: { wis: 16 },
    spellcasting: {
      ability: "wis",
      slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } },
      prepared: ["Bless", "Spirit Guardians", "Hold Person", "Cure Wounds"],
      known: [],
      cantrips: ["Sacred Flame"],
    },
    equipment: [{ name: "Mace", qty: 1, equipped: true }, { name: "Component pouch", qty: 1 }],
  }),
);
sheets.patchSheet(ama.id, { concentratingOn: "Spirit Guardians" });
const corin = sheets.createSheet(quiet.id, player.id, 5, heroInput({ name: "Corin Vale", class: "fighter", level: 5 }));
messages.insertCampaignMessage({
  campaignId: quiet.id,
  seq: campaigns.allocateSeq(quiet.id),
  authorType: "dm",
  speech: [],
  content: "The ford is quiet. Across the water a lantern swings on the ferryman's hut, and the rope bridge creaks in the wind.",
});

// A table one person plays with an AI storyteller and a party companion who
// takes their orders in fights (src/lib/dm/companion-command.ts): the "In
// fights" picker on the companion's Party card.
const COMMAND_TITLE = "Command Table";
const commandTable = campaigns.createCampaign(world.owner.id, {
  title: COMMAND_TITLE,
  description: "A long road, one traveller and a friend who came along.",
  theme: "high-fantasy",
  maxPlayers: 6,
  startingLevel: 3,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false },
});
campaigns.setCampaignStatus(commandTable.id, "active");
sheets.createSheet(commandTable.id, world.owner.id, 3, heroInput({ name: "Kell Brand", class: "fighter", level: 3 }));
const { createCompanionUser } = await import("../../src/lib/db/users.ts");
const pipBot = createCompanionUser("Pip Thistle");
const pip = sheets.createSheet(commandTable.id, pipBot.id, 3, heroInput({ name: "Pip Thistle", class: "rogue", level: 3 }));
sheets.markSheetAsCompanion(pip.id, "party", "Quick, cheerful, and never far from a joke.");
sheets.setCompanionCommander(pip.id, world.owner.id);

// The seeded turn below, so lore-trace can tell its trace from one a later
// scenario's turn on the quiet table left.
let quietLoreTurnId = "";
// The quiet table's world lore and the record a turn left of it (issue
// 305): four crossings the lead tagged as a set, one of them secret, a
// pinned entry, and lore about other things. The trace is the one turn
// retrieval builds for a player asking for every crossing, kept on a
// finished DM turn so the lead's Context panel has something to show.
{
  const { insertLoreEntry, embedPendingLore } = await import("../../src/lib/db/lore.ts");
  const { buildTurnRetrieval } = await import("../../src/lib/dm/context-retrieval.ts");
  const { createDmTurn, saveDmTurn } = await import("../../src/lib/db/dm-turns.ts");
  const fordLore = (title, body, extra = {}) =>
    insertLoreEntry({ campaignId: quiet.id, category: "geography", title, body, tags: [], ...extra });
  const guild = fordLore("The Ferry Guild", "The guild licenses every boat on the river and fines anyone who rows without a token.", { category: "factions" });
  getDatabase().prepare(`UPDATE lore_entries SET pinned = 1 WHERE id = ?`).run(guild.id);
  fordLore("The Ferry", "The ferryman takes a silver piece a head and more after dark.", { tags: ["crossing"] });
  fordLore("The Rope Bridge", "Forty planks over the gorge, three of them rotten. It holds two at a time.", { tags: ["crossing"] });
  fordLore("The Drowned Ford", "A sunken causeway a hand under the water at low tide; the smugglers mark it with reeds.", { tags: ["crossing"], visibility: "dm" });
  fordLore("The Shallows", "Waist-deep in late summer, chest-deep after rain, and the current pulls downstream.", { tags: ["crossing"] });
  fordLore("Harvest Festival", "At the end of summer the farmers burn a straw giant and dance until morning.");
  fordLore("The Lich of the Fens", "A lich sleeps beneath the fens and dreams of the kingdom it lost.");
  await embedPendingLore(quiet.id);
  const retrieval = await buildTurnRetrieval(campaigns.getCampaignById(quiet.id), [
    { authorType: "player", content: "How do we get over the river? Tell me every crossing." },
  ]);
  if (!retrieval.loreTrace) {
    throw new Error("the quiet table's lore left no trace");
  }
  const turn = createDmTurn(quiet.id, []);
  quietLoreTurnId = turn.id;
  saveDmTurn({
    ...turn,
    status: "done",
    contextTrace: {
      limitTokens: 40_000,
      promptTokens: 9_000,
      blocks: [{ id: "game-state", kind: "state", tokens: 3_000, included: true, reason: "always included", position: 1 }],
      lore: retrieval.loreTrace,
    },
  });
}

// A table of three accounts that have never met a tour, for the tours'
// account record (issue 306): one finishes the table's tour in one browser
// and must not meet it in another, one shares that browser, and one signs in
// where an old per-browser flag is waiting. Its own table, so the other
// scenarios' parties are unchanged.
const TOUR_TITLE = "First Visit";
const tourTable = campaigns.createCampaign(world.owner.id, {
  title: TOUR_TITLE,
  description: "A road inn, for meeting the table's tour.",
  theme: "high-fantasy",
  maxPlayers: 6,
  startingLevel: 3,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false },
});
const tourAccounts = ["walker", "sharer", "heir"].map((label, index) => {
  const user = world.addUser(label);
  const joined = campaigns.joinByInviteCode(user.id, campaigns.getCampaignById(tourTable.id).inviteCode);
  if ("error" in joined) {
    throw new Error(`could not seat ${label} at ${TOUR_TITLE}: ${joined.error}`);
  }
  sheets.createSheet(tourTable.id, user.id, 3, heroInput({ name: ["Wren Walker", "Sela Sharer", "Hob Heir"][index], class: "fighter", level: 3 }));
  return user;
});
campaigns.setCampaignStatus(tourTable.id, "active");
messages.insertCampaignMessage({
  campaignId: tourTable.id,
  seq: campaigns.allocateSeq(tourTable.id),
  authorType: "dm",
  speech: [],
  content: "The inn's fire is low and the road outside is empty. Someone has left a map pinned to the door.",
});

// A lobby whose imported prep already wrote a story arc, so the lead is
// told before AI Story Setup runs over it (issue 249).
const PREP_TITLE = "Prepared Lobby";
const { normalizeStoryArc } = await import("../../src/lib/dm/arc-logic.ts");
const prepared = campaigns.createCampaign(world.owner.id, {
  title: PREP_TITLE,
  description: "A lobby with a storyboard already in.",
  theme: "high-fantasy",
  maxPlayers: 6,
  startingLevel: 1,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false },
});
campaigns.setStoryArc(
  prepared.id,
  normalizeStoryArc({
    premise: "The mill wheel has stopped and the miller's girl is gone.",
    beats: ["The wheel stops at dusk.", "Marla confesses what she saw.", "The wheelhouse opens."],
  }),
);

// Tables in play the Setup tab ends, one per viewport so the second run
// does not open a table the first already closed, and an earlier, finished
// campaign with prep to bring into them mid-campaign. A campaign rather than
// a workshop because the lead's workshop shelf stays empty for
// empty-states; both are the same copy (src/lib/db/import-sources.ts).
const { insertRollTable } = await import("../../src/lib/db/roll-tables.ts");
const PREP_SOURCE_TITLE = "Old Harbour";
const prepSource = campaigns.createCampaign(world.owner.id, {
  title: PREP_SOURCE_TITLE,
  description: "A finished campaign with prep worth reusing.",
  theme: "high-fantasy",
  maxPlayers: 6,
  startingLevel: 1,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false },
});
campaigns.setCampaignStatus(prepSource.id, "ended");
insertRollTable({
  campaignId: prepSource.id,
  name: "Ferry Rumours",
  entries: [
    { min: 1, max: 1, text: "The ferryman owes the river hag a debt." },
    { min: 2, max: 2, text: "A lantern on the far bank never goes out." },
  ],
  createdByUserId: world.owner.id,
});
const closing = {};
for (const viewport of ["desktop", "laptop", "phone"]) {
  const table = campaigns.createCampaign(world.owner.id, {
    title: `Closing Table (${viewport})`,
    description: "A table near the end of its story.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 3,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false },
  });
  campaigns.setCampaignStatus(table.id, "active");
  sheets.createSheet(table.id, world.owner.id, 3, heroInput({ name: "Wynn Ashdown", class: "fighter", level: 3 }));
  messages.insertCampaignMessage({
    campaignId: table.id,
    seq: campaigns.allocateSeq(table.id),
    authorType: "dm",
    speech: [],
    content: "The last bell rings over the harbour. The road home is open.",
  });
  closing[viewport] = table.id;
}

// A table per viewport for the Bonds a party has with whoever travels with
// it (issue 580): the lead runs it as its GM, two players' characters sit
// at it, and a patron prepared as friendly has not been met yet.
const bondTables = {};
{
  const npcs = await import("../../src/lib/db/npcs.ts");
  const bonds = await import("../../src/lib/db/relationships.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `Bonds Table (${viewport})`,
      description: "A road with company on it.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human", companions: "full" },
    });
    // Seated before the table starts: a started table refuses a code
    // (src/lib/db/campaigns.ts admitsByRow), and the player never sat here.
    const seated = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
    if (seated.error) {
      throw new Error(`the player could not join ${table.title}: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const kael = sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Kael Ashvale", class: "rogue", level: 3 }));
    const other = world.addUser("bonds");
    campaigns.joinByInviteCode(other.id, campaigns.getCampaignById(table.id).inviteCode);
    const lyra = sheets.createSheet(table.id, other.id, 3, heroInput({ name: "Lyra Venn", class: "wizard", level: 3 }));
    npcs.upsertNpc({ campaignId: table.id, name: "Mira Vell", attitude: "friendly", gender: "Female" });
    // A companion Kael married, with a long two-word name (issue 644): at
    // phone width its "companion" label ran under the standing chip.
    const hollisBot = createCompanionUser("Sir Hollis Stonebridge");
    const hollis = sheets.createSheet(table.id, hollisBot.id, 3, heroInput({ name: "Sir Hollis Stonebridge", class: "paladin", level: 3 }));
    sheets.markSheetAsCompanion(hollis.id, "party", "Keeps his word.");
    const vows = bonds.ensureRelationship({ campaignId: table.id, characterId: kael.id, characterName: kael.name, subjectKind: "companion", subjectName: hollis.name });
    bonds.patchRelationship(vows.id, { approval: 100, romance: "married" });
    bondTables[viewport] = { id: table.id, kael: kael.id, lyra: lyra.id };
  }
}

// A table per viewport that began with someone the party already knew
// (issue 731): its patron was marked "Friends" with how they know her, so
// both heroes' bonds with her opened at Cordial as the table began, her line
// their first memory.
const knownTables = {};
{
  const npcs = await import("../../src/lib/db/npcs.ts");
  const { blankDraft } = await import("../../src/lib/npcs/forge.ts");
  const { openPreStoryTies } = await import("../../src/lib/dm/known-before.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `Known Table (${viewport})`,
      description: "A caravan road, and an old employer.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    const seated = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
    if (seated.error) {
      throw new Error(`the player could not join ${table.title}: ${seated.error}`);
    }
    sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Kael Ashvale", class: "rogue", level: 3 }));
    const other = world.addUser("known");
    campaigns.joinByInviteCode(other.id, campaigns.getCampaignById(table.id).inviteCode);
    sheets.createSheet(table.id, other.id, 3, heroInput({ name: "Lyra Venn", class: "wizard", level: 3 }));
    npcs.createNpcFromDraft(table.id, {
      ...blankDraft(),
      name: "Maren Dusk",
      attitude: "friendly",
      gender: "Female",
      knownBefore: { grade: "friend", how: "She hired you twice to guard her caravans." },
    });
    openPreStoryTies(campaigns.getCampaignById(table.id));
    campaigns.setCampaignStatus(table.id, "active");
    knownTables[viewport] = table.id;
  }
}

// A table per viewport for the composer's @ menu (issue 650): a person runs
// it as its GM and the lead plays at it, so the lead's seat holds only the
// people the story has named. Sildar was named in the GM's narration; Iarno
// is prepared and never named, and no player's menu or device may hold him.
// Two places are on the map, one of them with an accent and an apostrophe.
const nameTables = {};
{
  const npcs = await import("../../src/lib/db/npcs.ts");
  const { upsertCurrentLocation, insertKnownLocation } = await import("../../src/lib/db/locations.ts");
  for (const viewport of ["desktop", "phone"]) {
    const gm = world.addUser("names-gm");
    const table = campaigns.createCampaign(gm.id, {
      title: `Names Table (${viewport})`,
      description: "A town with too many names to spell.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    for (const user of [world.owner, player]) {
      const seated = campaigns.joinByInviteCode(user.id, campaigns.getCampaignById(table.id).inviteCode);
      if (seated.error) {
        throw new Error(`a player could not join ${table.title}: ${seated.error}`);
      }
    }
    campaigns.setCampaignStatus(table.id, "active");
    sheets.createSheet(table.id, world.owner.id, 3, heroInput({ name: "Rowan Ashby", class: "fighter", level: 3 }));
    sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Bree Underhill", class: "rogue", level: 3 }));
    npcs.upsertNpc({ campaignId: table.id, name: "Sildar Hallwinter", aliases: ["Sildar"] });
    npcs.upsertNpc({ campaignId: table.id, name: "Iarno Albrek" });
    upsertCurrentLocation({ campaignId: table.id, name: "Phandalin" });
    insertKnownLocation({ campaignId: table.id, name: "Thundertree's Côte" });
    messages.insertCampaignMessage({
      campaignId: table.id,
      seq: campaigns.allocateSeq(table.id),
      authorType: "dm",
      userId: gm.id,
      content: "Sildar Hallwinter waves you over to the fire.",
      speech: [],
    });
    nameTables[viewport] = table.id;
    // And one the lead runs as its GM, holding the whole cast: Narrate
    // offers Iarno too, marked as not introduced yet.
    const run = campaigns.createCampaign(world.owner.id, {
      title: `Names GM Table (${viewport})`,
      description: "The same town, from behind the screen.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    const seated = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(run.id).inviteCode);
    if (seated.error) {
      throw new Error(`the player could not join ${run.title}: ${seated.error}`);
    }
    campaigns.setCampaignStatus(run.id, "active");
    sheets.createSheet(run.id, player.id, 3, heroInput({ name: "Bree Underhill", class: "rogue", level: 3 }));
    npcs.upsertNpc({ campaignId: run.id, name: "Sildar Hallwinter" });
    npcs.markNpcMet(npcs.getNpcByName(run.id, "Sildar Hallwinter").id);
    npcs.upsertNpc({ campaignId: run.id, name: "Iarno Albrek" });
    nameTables[`${viewport}Gm`] = run.id;
  }
}

// A table per viewport for a romance the table hears of (issue 640): the
// lead runs it as its GM, the player's Kael is courting the companion Sir
// Hollis, who adores him, so every step asked of him is a certain yes.
const romanceTables = {};
{
  const bonds = await import("../../src/lib/db/relationships.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `Romance Table (${viewport})`,
      description: "A road with someone dear on it.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human", companions: "full" },
    });
    const seated = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
    if (seated.error) {
      throw new Error(`the player could not join ${table.title}: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const kael = sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Kael Ashvale", class: "rogue", level: 3 }));
    const hollisBot = createCompanionUser("Sir Hollis Stonebridge");
    const hollis = sheets.createSheet(table.id, hollisBot.id, 3, heroInput({ name: "Sir Hollis Stonebridge", class: "paladin", level: 3 }));
    sheets.markSheetAsCompanion(hollis.id, "party", "Keeps his word.");
    const courtship = bonds.ensureRelationship({ campaignId: table.id, characterId: kael.id, characterName: kael.name, subjectKind: "companion", subjectName: hollis.name });
    bonds.patchRelationship(courtship.id, { approval: 100, romance: "courting" });
    romanceTables[viewport] = { id: table.id, kael: kael.id };
  }
}

// A table per viewport for the DM's Stop (issue 383): its turn runs against
// a model the scenario starts and never lets answer.
const stopTables = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(world.owner.id, {
    title: `Stop Table (${viewport})`,
    description: "A table whose storyteller never answers.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 3,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false },
  });
  campaigns.setCampaignStatus(table.id, "active");
  sheets.createSheet(table.id, world.owner.id, 3, heroInput({ name: "Ilse Marr", class: "fighter", level: 3 }));
  messages.insertCampaignMessage({
    campaignId: table.id,
    seq: campaigns.allocateSeq(table.id),
    authorType: "dm",
    speech: [],
    content: "The ferry waits at the pier, its lantern hissing in the fog.",
  });
  stopTables[viewport] = table.id;
}

// A table per viewport for the quest card (issue 581): two open quests on
// the log, the oldest with a step ticked, so the card shows its next step;
// the scenario finishes them one by one.
const questTables = {};
{
  const { insertQuest } = await import("../../src/lib/db/quests.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `Quest Table (${viewport})`,
      description: "A waystone that is going out.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false },
    });
    campaigns.setCampaignStatus(table.id, "active");
    sheets.createSheet(table.id, world.owner.id, 3, heroInput({ name: "Ilse Marr", class: "fighter", level: 3 }));
    const light = insertQuest({
      campaignId: table.id,
      title: "Light for Brackenford",
      objectives: [
        { id: "o1", text: "Find the shard", done: true },
        { id: "o2", text: "Restore the Crimson Waystone's protection", done: false },
      ],
    });
    const ferry = insertQuest({ campaignId: table.id, title: "The Ferryman's Toll", objectives: [{ id: "o1", text: "Pay or outwit the ferryman", done: false }] });
    insertQuest({ campaignId: table.id, title: "The Abbot's Secret", visibility: "dm" });
    questTables[viewport] = { id: table.id, light: light.id, ferry: ferry.id };
  }
}

// A table per viewport for the wardrobe (issues 411 and 412): the lead's
// netrunner, a genre class whose features explain themselves only once the
// cyberpunk catalog has been fetched, wears one magic cloak and carries a
// second.
const wardrobe = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(world.owner.id, {
    title: `Wardrobe (${viewport})`,
    description: "A safehouse with a rack of coats by the door.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 3,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false },
  });
  campaigns.setCampaignStatus(table.id, "active");
  sheets.createSheet(
    table.id,
    world.owner.id,
    3,
    heroInput({
      name: "Vex Halloran",
      class: "netrunner",
      level: 3,
      equipment: [
        { name: "Leather", qty: 1, equipped: true },
        { name: "Cloak of Protection", qty: 1, equipped: true, attuned: true },
        { name: "Cloak of Elvenkind", qty: 1, equipped: false, attuned: true },
        { name: "Ring of Spell Storing", qty: 1, equipped: true, storedSpells: [{ spell: "Fireball", level: 3, saveDc: 15, attackBonus: 7 }] },
      ],
    }),
  );
  messages.insertCampaignMessage({
    campaignId: table.id,
    seq: campaigns.allocateSeq(table.id),
    authorType: "dm",
    speech: [],
    content: "Rain ticks on the safehouse window. Two cloaks hang by the door.",
  });
  wardrobe[viewport] = table.id;
}

// A table per viewport whose GM has put the lead's character in the
// spotlight after a short rest, so the lead can answer it with a direction.
// Its own table, since that direction wakes the GM.
const SPOTLIGHT_TITLE = "Spotlight Table";
const spotlightTables = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(world.owner.id, {
    title: `${SPOTLIGHT_TITLE} (${viewport})`,
    description: "A roadside camp after a short rest.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 5,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false },
  });
  campaigns.setCampaignStatus(table.id, "active");
  sheets.createSheet(table.id, world.owner.id, 5, heroInput({ name: "Krag Ironhorn", class: "fighter", level: 5 }));
  messages.insertCampaignMessage({
    campaignId: table.id,
    seq: campaigns.allocateSeq(table.id),
    authorType: "dm",
    speech: [],
    content: "The hour's rest is over. Krag, spend your remaining Hit Dice on your sheet if you need them.",
  });
  campaigns.setFloor(table.id, {
    mode: "spotlight",
    userIds: [world.owner.id],
    prompt: "Spend your remaining Hit Dice on your sheet.",
    respondedUserIds: [],
  });
  spotlightTables[viewport] = table.id;
}

// A table at a village whose smithy the DM just opened (shops in play):
// the "is open" line that opening wrote, whose Browse wares opens the
// Market on the shop. Its own table, so no other scenario's chat or atlas
// gains a line or a place.
const MARKET_TITLE = "Market Table";
const MARKET_SHOP = "Brann's Forge";
const marketTable = campaigns.createCampaign(world.owner.id, {
  title: MARKET_TITLE,
  description: "A village forge with its doors open.",
  theme: "high-fantasy",
  maxPlayers: 4,
  startingLevel: 3,
  difficulty: "normal",
  // Two characters of the lead's own, so a Play as switch shows the Market
  // reading the new one's prices (shop-browse).
  gameSettings: { ttsEnabled: false, multiCharacter: "one_active" },
});
campaigns.setCampaignStatus(marketTable.id, "active");
const marketHero = sheets.createSheet(marketTable.id, world.owner.id, 3, heroInput({ name: "Wren Ashby", class: "fighter", level: 3 }));
const marketSecond = sheets.createSheet(marketTable.id, world.owner.id, 3, heroInput({ name: "Tamsin Ashby", class: "rogue", level: 3 }));
{
  const { upsertCurrentLocation } = await import("../../src/lib/db/locations.ts");
  const { handleOpenShop } = await import("../../src/lib/dm/shop-tools.ts");
  const { listShops, updateShop } = await import("../../src/lib/db/shops.ts");
  upsertCurrentLocation({ campaignId: marketTable.id, name: "Oakhollow" });
  messages.insertCampaignMessage({
    campaignId: marketTable.id,
    seq: campaigns.allocateSeq(marketTable.id),
    authorType: "dm",
    speech: [],
    content: "Heat rolls out of the forge. Brann looks up from a half-finished axe head and nods at the racks along the wall.",
  });
  const opened = handleOpenShop(campaigns.getCampaignById(marketTable.id), JSON.stringify({ name: MARKET_SHOP, kind: "smith", size: "village" }));
  if (!opened.ok) {
    throw new Error(`could not open ${MARKET_SHOP}: ${JSON.stringify(opened)}`);
  }
  // Tamsin already leaned on Brann and pushed too hard: an Intimidation
  // that failed badly, two steps up for her alone, a price Wren's one
  // Persuasion try can never land on.
  const forge = listShops(marketTable.id).find((entry) => entry.name === MARKET_SHOP);
  updateShop(forge.id, { haggles: [{ ids: [marketSecond.id], steps: 2, skill: "intimidation" }] });
}

// Issue 548: a made-up world seventeen places in, the way an AI DM left it
// before a place could be part of another (the names are the issue's own):
// every approach and room its own place, each anchored the way the old
// placement put it (reproduced below, 4 to 7 tiles from the first of its
// routes already drawn, then the first free tile in ring order), and the
// routes a web between them, then upgraded the way an old database is (its
// places filed once by name). One table per viewport: the region-map
// scenario files places on it.
const REGION_TITLE = "Region Table";
const REGION_PLACES = [
  ["Thornhollow Village Hall", ["Thornhollow Fair"]],
  ["Thornhollow Fair", ["Thornhollow Village Hall", "Thornhollow Village Hall Approach", "Thornhollow Smithy", "Thornhollow Road"]],
  ["Thornhollow Village Hall Approach", ["Thornhollow Village Hall", "Thornhollow Fair"]],
  ["Thornhollow Smithy", ["Thornhollow Fair", "Thornhollow Road"]],
  ["Thornhollow Road", ["Thornhollow Fair", "Thornhollow Smithy", "Duskleaf Road", "Duskleaf Shrine"]],
  ["Duskleaf Road", ["Thornhollow Road", "Duskleaf Shrine"]],
  ["Duskleaf Shrine", ["Duskleaf Road", "Duskleaf Shrine Root Cellar", "Briarwatch Provisioning Road", "Thornhollow Road"]],
  ["Duskleaf Shrine Root Cellar", ["Duskleaf Shrine"]],
  ["Briarwatch Provisioning Road", ["Duskleaf Shrine", "Briarwatch Tower", "Hollowroot Survey Trail"]],
  ["Briarwatch Tower", ["Briarwatch Provisioning Road", "Hollowroot Vault Woodland Approach"]],
  ["Hollowroot Survey Trail", ["Briarwatch Provisioning Road", "Second Hollowroot Waystone Woodland Flank", "Hollowroot Vault Woodland Approach"]],
  ["Second Hollowroot Waystone Woodland Flank", ["Hollowroot Survey Trail", "Second Hollowroot Waystone Bend"]],
  ["Second Hollowroot Waystone Bend", ["Second Hollowroot Waystone Woodland Flank", "Third Hollowroot Waystone Approach", "First Hollowroot Waystone Approach"]],
  ["Third Hollowroot Waystone Approach", ["Second Hollowroot Waystone Bend"]],
  ["First Hollowroot Waystone Approach", ["Second Hollowroot Waystone Bend", "Hollowroot Vault Woodland Approach"]],
  ["Hollowroot Vault Woodland Approach", ["First Hollowroot Waystone Approach", "Hollowroot Vault Entrance Passage", "Briarwatch Tower", "Hollowroot Survey Trail"]],
  ["Hollowroot Vault Entrance Passage", ["Hollowroot Vault Woodland Approach"]],
];
const regionTables = {};
{
  const { upsertCurrentLocation, listLocations } = await import("../../src/lib/db/locations.ts");
  const { regenerateOverworld } = await import("../../src/lib/db/overworld.ts");
  const { fnv1a, mulberry32, tileAt } = await import("../../src/lib/overworld/logic.ts");
  const { textKey } = await import("../../src/lib/language/text-logic.ts");
  const { fileSubAreasByName } = await import("../../src/lib/db/place-parents-backfill.ts");
  const oldPlacement = (terrain, width, height, existing, connected, name) => {
    const rng = mulberry32(fnv1a(textKey(name)));
    let start;
    if (connected) {
      const angle = rng() * Math.PI * 2;
      const distance = 4 + rng() * 3;
      start = { x: Math.round(connected.x + Math.cos(angle) * distance), y: Math.round(connected.y + Math.sin(angle) * distance) };
    } else if (existing.length) {
      const anchor = existing[existing.length - 1];
      const angle = rng() * Math.PI * 2;
      start = { x: Math.round(anchor.x + Math.cos(angle) * 6), y: Math.round(anchor.y + Math.sin(angle) * 6) };
    } else {
      start = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
    }
    const clamp = (point) => ({ x: Math.min(width - 3, Math.max(2, point.x)), y: Math.min(height - 3, Math.max(2, point.y)) });
    const usable = (point) =>
      !["w", "m"].includes(tileAt(terrain, width, point.x, point.y)) &&
      !existing.some((anchor) => Math.abs(anchor.x - point.x) <= 1 && Math.abs(anchor.y - point.y) <= 1);
    if (usable(clamp(start))) return clamp(start);
    for (let radius = 1; radius < Math.max(width, height); radius += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) === radius && usable(clamp({ x: start.x + dx, y: start.y + dy }))) {
            return clamp({ x: start.x + dx, y: start.y + dy });
          }
        }
      }
    }
    return clamp(start);
  };
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `${REGION_TITLE} (${viewport})`,
      description: "Seventeen places of a made-up world.",
      theme: "high-fantasy",
      maxPlayers: 4,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false },
    });
    campaigns.setCampaignStatus(table.id, "active");
    sheets.createSheet(table.id, world.owner.id, 3, heroInput({ name: "Rook Vale", class: "ranger", level: 3 }));
    for (const [name, connections] of REGION_PLACES) {
      upsertCurrentLocation({ campaignId: table.id, name, layoutDescription: `${name}, as the party found it.`, connections });
    }
    const map = regenerateOverworld(table.id, { seed: 548 });
    const byName = new Map(listLocations(table.id).map((place) => [textKey(place.name), place]));
    const anchors = {};
    for (const [name, connections] of REGION_PLACES) {
      const connected = connections.map((other) => anchors[byName.get(textKey(other))?.id]).find(Boolean) ?? null;
      anchors[byName.get(textKey(name)).id] = oldPlacement(map.terrain, map.width, map.height, Object.values(anchors), connected, name);
    }
    getDatabase().prepare(`UPDATE overworld_maps SET anchors_json = ? WHERE campaign_id = ?`).run(JSON.stringify(anchors), table.id);
    // The table as an old database brings it: nothing filed, then the
    // upgrade's one pass by name.
    getDatabase().prepare(`UPDATE locations SET parent_name = NULL WHERE campaign_id = ?`).run(table.id);
    fileSubAreasByName(getDatabase(), table.id);
    regionTables[viewport] = table.id;
  }
}

for (const user of [world.owner, player, ...tourAccounts]) {
  setUserPassword(user.id, await hashPassword(PASSWORD), false);
}
// A variant human fighter whose stored Dexterity, 8, no longer meets the
// two feats it holds (Skulker on the race, Defensive Duelist on its 4th
// level improvement, both Dexterity 13): an edit keeps a feat the stored
// character held, so one taken off can be put back (PR 381 follow-up).
const HELD_FEATS_NAME = "Sable Quickstep";
const sable = createCharacter(world.owner.id, 4, {
  name: HELD_FEATS_NAME,
  race: "variant_human",
  class: "fighter",
  subclass: "Champion",
  background: "soldier",
  alignment: "N",
  // The standard array, Dexterity 8, and the race's +1 to Strength and Constitution.
  abilities: { str: 16, dex: 8, con: 14, int: 12, wis: 14, cha: 10 },
  maxHp: 36,
  ac: 19,
  acOverride: false,
  speed: 30,
  hitDice: { die: "d10", total: 4, spent: 0 },
  proficiencies: {
    saves: ["str", "con"],
    skills: ["athletics", "intimidation", "perception", "survival", "stealth"],
    expertise: [],
    languages: ["Common", "Dwarvish"],
    tools: ["dice set", "vehicles (land)"],
    armor: ["light", "medium", "heavy", "shields"],
    weapons: ["simple", "martial"],
  },
  equipment: [
    { name: "Longsword", qty: 1, equipped: true },
    { name: "Chain mail", qty: 1, equipped: true },
    { name: "Shield", qty: 1, equipped: true },
  ],
  gold: 10,
  copper: 0,
  feats: ["Skulker", "Defensive Duelist"],
  features: [{ name: "Fighting Style: Defense", source: "choice" }],
  asiChoices: [{ mode: "feat", feat: "Defensive Duelist" }],
  racialChoices: { asi: ["str", "con"], skills: ["stealth"] },
  spellcasting: null,
  notes: "",
});

// A high fantasy table whose fighter has earned level 4 (issues 433, 434):
// the level-up dialog's multiclass list leads with the setting's own
// classes, folds the rest under Other settings, and can be searched.
const levelTable = campaigns.createCampaign(world.owner.id, {
  title: "Level Table",
  description: "A quiet road after a hard fight.",
  theme: "high-fantasy",
  maxPlayers: 6,
  startingLevel: 3,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false, genre: "high_fantasy" },
});
campaigns.setCampaignStatus(levelTable.id, "active");
const leveller = sheets.createSheet(
  levelTable.id,
  world.owner.id,
  3,
  heroInput({ name: "Rook Ashvale", class: "fighter", level: 3, abilities: { str: 15, dex: 13, con: 14, int: 13, wis: 13, cha: 13 } }),
);
getDatabase().prepare(`UPDATE character_sheets SET xp = ? WHERE id = ?`).run(2700, leveller.id);
messages.insertCampaignMessage({
  campaignId: levelTable.id,
  seq: campaigns.allocateSeq(levelTable.id),
  authorType: "dm",
  speech: [],
  content: "The road is quiet now. Rook wipes the blade clean and feels steadier for it.",
});

// Issue #833: a Draconic Bloodline sorcerer saved before Dragon Ancestor was
// a pick, at 6th level with 7th earned. The sheet lists the dragon as owed
// and takes it there; the level-up's pick step offers it too. One table per
// viewport, since the pick is made.
const dragonTables = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(world.owner.id, {
    title: `Dragon Table (${viewport})`,
    description: "Scales under the skin, and no dragon named yet.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 6,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false, genre: "high_fantasy" },
  });
  campaigns.setCampaignStatus(table.id, "active");
  const hero = sheets.createSheet(
    table.id,
    world.owner.id,
    6,
    heroInput({ name: "Ysolde Ember", class: "sorcerer", subclass: "Draconic Bloodline", level: 6, abilities: { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 17 } }),
  );
  getDatabase().prepare(`UPDATE character_sheets SET xp = ? WHERE id = ?`).run(23000, hero.id);
  dragonTables[viewport] = { id: table.id, hero: hero.id };
}

// A College of Lore bard who has earned 10th level (issue #570, CLS-21): the
// level-up dialog's spell step offers Magical Secrets' two spells from any
// class as their own group. The two Additional Magical Secrets took at 6th
// (haste, counterspell) are already held, so the group is Magical Secrets'.
const { withAsiLedger } = await import("../../src/lib/srd/asi-ledger.ts");
const secretsTable = campaigns.createCampaign(world.owner.id, {
  title: "Secrets Table",
  description: "A library of borrowed songs.",
  theme: "high-fantasy",
  maxPlayers: 6,
  startingLevel: 9,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false, genre: "high_fantasy" },
});
campaigns.setCampaignStatus(secretsTable.id, "active");
sheets.createSheet(
  secretsTable.id,
  world.owner.id,
  9,
  heroInput({
    name: "Wren Lark",
    class: "bard",
    subclass: "College of Lore",
    level: 9,
    abilities: { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 16 },
    // Both improvements bard 4th and 8th give, taken.
    features: withAsiLedger([], 2),
    spellcasting: {
      ability: "cha",
      slots: {},
      known: [
        "Charm Person", "Cure Wounds", "Healing Word", "Faerie Fire", "Heroism", "Thunderwave", "Sleep",
        "Hold Person", "Invisibility", "Shatter", "Hypnotic Pattern", "Dispel Magic", "Haste", "Counterspell",
      ],
      prepared: [],
      cantrips: ["Vicious Mockery", "Minor Illusion", "Mage Hand"],
    },
  }),
  null,
  { xp: 64000 },
);
messages.insertCampaignMessage({
  campaignId: secretsTable.id,
  seq: campaigns.allocateSeq(secretsTable.id),
  authorType: "dm",
  speech: [],
  content: "The archive's last door opens. Wren reads a verse no bard was ever taught.",
});

// The lead runs the server too, for the admin settings (issue 255).
setUserAdmin(world.owner.id, true);

// A table a person runs, with a goblin on its board, per viewport (issue
// #471): the DM's token menu sets a condition, deals damage and teleports
// through the one tool each of those intents has.
const directed = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const maps = await import("../../src/lib/db/battle-maps.ts");
  const encounterRows = await import("../../src/lib/db/encounters.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `Directed Table (${viewport})`,
      description: "A table whose storyteller is a person at the table.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    // Seated in the lobby: a table in play turns a newcomer away, and the
    // join used to fail here unseen, leaving Ilse's player outside the table.
    const seated = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
    if ("error" in seated) {
      throw new Error(`could not seat the player at the directed table: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Ilse Marr", class: "fighter", level: 3 }));
    const started = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: world.owner.id }, {
      name: "start_encounter",
      args: { enemies: [{ monster: "goblin", count: 1 }] },
    });
    if (!started.ok) {
      throw new Error(`the directed table's fight did not start: ${started.error}`);
    }
    // An open field, the goblin and the hero apart from each other.
    const encounter = encounterRows.getActiveEncounter(table.id);
    const board = maps.getBattleMapForEncounter(encounter.id);
    maps.setBattleMapTerrain(board.id, ".".repeat(board.width * board.height));
    getDatabase().prepare("UPDATE battle_maps SET doors_json = '{}' WHERE id = ?").run(board.id);
    const [goblin] = encounterRows.listEnemies(encounter.id);
    // Clear of the initiative strip along the board's top edge.
    for (const [token, x] of maps.listTokens(board.id).map((entry) => [entry, entry.refId === goblin.id ? 6 : 2])) {
      maps.moveToken(token.id, x, 6, 0);
    }
    directed[viewport] = { id: table.id, goblin: goblin.id };
  }
}

// A fight opened from farther off than any board holds, per viewport (issue
// 741): it threw after the map was written and left a black board.
const longOpening = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `Long Opening (${viewport})`,
      description: "A table whose fight opened two hundred feet off.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    const seated = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
    if ("error" in seated) {
      throw new Error(`could not seat the player at the long opening table: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Ilse Marr", class: "fighter", level: 3 }));
    const started = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: world.owner.id }, {
      name: "start_encounter",
      args: { enemies: [{ monster: "goblin", count: 2 }], distanceFeet: 200 },
    });
    if (!started.ok) {
      throw new Error(`the long opening table's fight did not start: ${started.error}`);
    }
    longOpening[viewport] = table.id;
  }
}

// A fight opened inside a building, per viewport (issue 743): the table's own
// ground is a field, the hero stands in a house with a door and two windows,
// and the goblins are in the yard to the east.
const fightInBuilding = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `Fight In A Building (${viewport})`,
      description: "A table whose fight opened with the party behind walls.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    const seated = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
    if ("error" in seated) {
      throw new Error(`could not seat the player at the building table: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Ilse Marr", class: "fighter", level: 3 }));
    const started = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: world.owner.id }, {
      name: "start_encounter",
      args: { enemies: [{ monster: "goblin", count: 2 }], building: { enemySide: "east", openings: 3 } },
    });
    if (!started.ok) {
      throw new Error(`the building table's fight did not start: ${started.error}`);
    }
    fightInBuilding[viewport] = table.id;
  }
}

// A person's table where two goblins act before the hero, per viewport
// (table function audit 2026-10-26, T11 and T09): the goblins win
// initiative, so the fight opens held for their turns, and the second is
// kept off the board. The DM hands the turn on from the Enemy turns banner,
// and corrects the hero's sheet from the console.
const enemyTurns = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const { dice, clearDice } = await import("../lib/enforce-world.mjs");
  const maps = await import("../../src/lib/db/battle-maps.ts");
  const encounterRows = await import("../../src/lib/db/encounters.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `Enemy Turn Table (${viewport})`,
      description: "A table whose goblins act first.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    // Seated in the lobby: a table in play turns a newcomer away.
    const seated = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
    if ("error" in seated) {
      throw new Error(`could not seat the player at the enemy turn table: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const hero = sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Wren Hale", class: "fighter", level: 3 }));
    // The goblins' dice, then the hero's.
    clearDice();
    dice(20, 20, 1);
    const started = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: world.owner.id }, {
      name: "start_encounter",
      args: { enemies: [{ monster: "goblin", count: 2 }] },
    });
    clearDice();
    if (!started.ok) {
      throw new Error(`the enemy turn table's fight did not start: ${started.error}`);
    }
    const encounter = encounterRows.getActiveEncounter(table.id);
    if (!encounter.legendary.due?.length) {
      throw new Error("the enemy turn table's goblins are not due first");
    }
    const board = maps.getBattleMapForEncounter(encounter.id);
    maps.setBattleMapTerrain(board.id, ".".repeat(board.width * board.height));
    getDatabase().prepare("UPDATE battle_maps SET doors_json = '{}' WHERE id = ?").run(board.id);
    const [seen, unseen] = encounterRows.listEnemies(encounter.id);
    for (const [token, x] of maps.listTokens(board.id).map((entry) => [entry, entry.refId === hero.id ? 2 : entry.refId === seen.id ? 6 : 8])) {
      maps.moveToken(token.id, x, 6, 0);
    }
    maps.setTokenHidden(maps.getTokenByRef(board.id, unseen.id).id, true);
    enemyTurns[viewport] = { id: table.id, hero: hero.id, heroName: hero.name, seen: seen.displayName, unseen: unseen.displayName };
  }
}

// A person's table in a fight, per viewport (issue #621): one goblin on an
// open board, its action unspent, for the Monster Hand's Dash, Disengage
// and Dodge cards and the roster's "N ft left · Dashed".
const enemyMoves = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const { dice, clearDice } = await import("../lib/enforce-world.mjs");
  const maps = await import("../../src/lib/db/battle-maps.ts");
  const encounterRows = await import("../../src/lib/db/encounters.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `Enemy Moves Table (${viewport})`,
      description: "A table whose goblin can run.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    const seated = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
    if ("error" in seated) {
      throw new Error(`could not seat the player at the enemy moves table: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const hero = sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Ash Merrow", class: "fighter", level: 3 }));
    // The goblin's die, then the hero's: the hero acts first, and the
    // goblin's turn is still to come with its action unspent.
    clearDice();
    dice(1, 20);
    const started = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: world.owner.id }, {
      name: "start_encounter",
      args: { enemies: [{ monster: "goblin", count: 1 }] },
    });
    clearDice();
    if (!started.ok) {
      throw new Error(`the enemy moves table's fight did not start: ${started.error}`);
    }
    const encounter = encounterRows.getActiveEncounter(table.id);
    const board = maps.getBattleMapForEncounter(encounter.id);
    maps.setBattleMapTerrain(board.id, ".".repeat(board.width * board.height));
    getDatabase().prepare("UPDATE battle_maps SET doors_json = '{}' WHERE id = ?").run(board.id);
    const [goblin] = encounterRows.listEnemies(encounter.id);
    for (const [token, x] of maps.listTokens(board.id).map((entry) => [entry, entry.refId === hero.id ? 2 : 9])) {
      maps.moveToken(token.id, x, 6, 0);
    }
    enemyMoves[viewport] = { id: table.id, goblin: goblin.id, goblinName: goblin.displayName };
  }
}

// Issue #502, one ruleset: a wizard saved as the 2024 Goliath with the
// 2024-only Elementalism among her cantrips (her sheet says it is not cast
// here; her builder says she now has the 2014 Goliath's traits), an Orc
// whose Primal Intuition picks from its seven skills, and an apothecary,
// whose shelf names how magic is priced.
const REVISED_NAME = "Ysolde Marrow";
const ysolde = createCharacter(world.owner.id, 3, {
  name: REVISED_NAME,
  race: "srd-2024-goliath",
  class: "wizard",
  subclass: "",
  background: "sage",
  alignment: "N",
  abilities: { str: 14, dex: 12, con: 14, int: 15, wis: 10, cha: 8 },
  maxHp: 20,
  ac: 11,
  acOverride: false,
  speed: 30,
  hitDice: { die: "d6", total: 3, spent: 0 },
  proficiencies: {
    saves: ["int", "wis"],
    skills: ["arcana", "history", "athletics", "investigation"],
    expertise: [],
    languages: ["Common", "Giant", "Draconic", "Elvish"],
    tools: [],
    armor: [],
    weapons: ["daggers", "darts", "slings", "quarterstaffs", "light crossbows"],
  },
  equipment: [{ name: "Quarterstaff", qty: 1, equipped: true }],
  gold: 10,
  copper: 0,
  feats: [],
  features: [],
  asiChoices: [],
  spellcasting: {
    ability: "int",
    slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } },
    prepared: ["Shield", "Magic Missile", "Mage Armor", "Misty Step"],
    known: [],
    cantrips: ["Elementalism", "Fire Bolt", "Light"],
    spellbook: ["Shield", "Magic Missile", "Mage Armor", "Sleep", "Misty Step", "Detect Magic", "Find Familiar", "Hold Person"],
  },
  portrait: null,
  notes: "",
  backstory: "",
});
const ORC_NAME = "Grask Ironjaw";
const grask = createCharacter(world.owner.id, 1, {
  name: ORC_NAME,
  race: "orc",
  class: "fighter",
  subclass: "",
  background: "soldier",
  alignment: "CN",
  abilities: { str: 17, dex: 12, con: 15, int: 8, wis: 13, cha: 10 },
  maxHp: 12,
  ac: 16,
  acOverride: false,
  speed: 30,
  hitDice: { die: "d10", total: 1, spent: 0 },
  proficiencies: {
    saves: ["str", "con"],
    skills: ["athletics", "intimidation", "acrobatics", "perception", "survival", "medicine"],
    expertise: [],
    languages: ["Common", "Orc"],
    tools: ["dice set", "vehicles (land)"],
    armor: ["light", "medium", "heavy", "shields"],
    weapons: ["simple", "martial"],
  },
  equipment: [{ name: "Chain mail", qty: 1, equipped: true }],
  gold: 10,
  copper: 0,
  feats: [],
  features: [],
  asiChoices: [],
  spellcasting: null,
  // Primal Intuition's two, as the builder stores them.
  racialChoices: { skills: ["survival", "medicine"] },
  portrait: null,
  notes: "",
  backstory: "",
});
const CURIO_SHOP = "Mother Ilse's Remedies";
const curioTable = campaigns.createCampaign(world.owner.id, {
  title: "Curio Table",
  description: "An apothecary's shop on a wet street.",
  theme: "high-fantasy",
  maxPlayers: 4,
  startingLevel: 3,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false },
});
campaigns.setCampaignStatus(curioTable.id, "active");
sheets.createSheet(curioTable.id, world.owner.id, 3, heroInput({ name: "Hale Brisk", class: "fighter", level: 3 }));
{
  const { upsertCurrentLocation } = await import("../../src/lib/db/locations.ts");
  const { handleOpenShop } = await import("../../src/lib/dm/shop-tools.ts");
  upsertCurrentLocation({ campaignId: curioTable.id, name: "Wetmarket" });
  const opened = handleOpenShop(campaigns.getCampaignById(curioTable.id), JSON.stringify({ name: CURIO_SHOP, kind: "apothecary", size: "town" }));
  if (!opened.ok) {
    throw new Error(`could not open ${CURIO_SHOP}: ${JSON.stringify(opened)}`);
  }
}

// NPC advances (issue 501): one table per viewport (the scenario answers
// the advance) where the lead's Kael is open to advances from NPCs and
// Mira's advance waits on his answer, for the offer card, the Bonds switch
// and the romance rung.
const COURTING_TITLE = "Courting Table";
const ADVANCE_LINE = "Walk with me along the river tonight?";
const courtingSheets = await import("../../src/lib/db/sheets.ts");
const courtingNpcs = await import("../../src/lib/db/npcs.ts");
const courtingBonds = await import("../../src/lib/db/relationships.ts");
const courting = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(world.owner.id, {
    title: `${COURTING_TITLE} (${viewport})`,
    description: "A ferry crossing at dusk, and someone who has been waiting to say something.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 3,
    difficulty: "normal",
    gameSettings: {},
  });
  campaigns.setCampaignStatus(table.id, "active");
  const kael = courtingSheets.createSheet(
    table.id,
    world.owner.id,
    3,
    heroInput({ name: "Kael Ashvale", class: "bard", level: 3, gender: "Male", attraction: { genders: ["Female"], note: "" }, abilities: { cha: 16 } }),
  );
  courtingSheets.setOpenToAdvances(kael.id, true);
  const mira = courtingNpcs.upsertNpc({
    campaignId: table.id,
    name: "Mira Vell",
    attitude: "friendly",
    trait: "A ferrywoman with a quick laugh",
    location: "the ford",
    gender: "Female",
    attraction: { genders: ["Male"], note: "" },
  });
  const bond = courtingBonds.ensureRelationship({
    campaignId: table.id,
    characterId: kael.id,
    characterName: kael.name,
    subjectKind: "npc",
    subjectName: mira.name,
    subjectId: mira.id,
  });
  courtingBonds.patchRelationship(bond.id, {
    approval: 62,
    memories: [{ kind: "helped", text: "Kael mended her ferry rope in the rain", at: new Date().toISOString() }],
  });
  const advance = itemProposals.insertItemProposal({
    campaignId: table.id,
    turnId: null,
    characterId: kael.id,
    userId: world.owner.id,
    toolName: "romance_advance",
    argsJson: JSON.stringify({
      relationshipId: bond.id,
      subject: mira.name,
      subjectKind: "npc",
      subjectId: mira.id,
      to: "courting",
      note: ADVANCE_LINE,
      madeAtTurn: 0,
      portraitUrl: "",
      look: { gender: "Female", role: "" },
    }),
    summary: `${mira.name} asks to court ${kael.name}`,
    reason: ADVANCE_LINE,
    seq: campaigns.allocateSeq(table.id),
  });
  courting[viewport] = { id: table.id, kael: kael.id, advanceSummary: advance.summary, advanceLine: ADVANCE_LINE };
}

// Companion conscience (issue 503): one table per viewport (the scenario
// moves the ladder), run by the lead as its DM so the scenario records deeds
// through the console the way a DM does. The player's Kael travels with
// Seren Vale, a lawful good paladin of even temper, already uneasy after a
// cruelty she saw.
const CONSCIENCE_TITLE = "Conscience Table";
const conscience = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const { companionNpcFor } = await import("../../src/lib/db/companion-npcs.ts");
  const { patchNpcAgency } = await import("../../src/lib/db/npcs.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `${CONSCIENCE_TITLE} (${viewport})`,
      description: "A paladin who walks with the party, for now.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    // Seated before the table starts: a started table refuses a code
    // (src/lib/db/campaigns.ts admitsByRow), and the player never sat here.
    const seated = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
    if (seated.error) {
      throw new Error(`the player could not join ${table.title}: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const kael = sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Kael Ashvale", class: "rogue", level: 3 }));
    const bot = createCompanionUser("Seren Vale");
    const seren = sheets.createSheet(table.id, bot.id, 3, heroInput({ name: "Seren Vale", class: "paladin", alignment: "LG", level: 3 }));
    sheets.markSheetAsCompanion(seren.id, "party", "Stern, devout, slow to anger and slower to forgive.");
    const row = companionNpcFor(sheets.getSheetById(seren.id));
    patchNpcAgency(row.id, { personality: { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0 } });
    const cruelty = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: world.owner.id }, {
      name: "relationship_beat",
      args: { characterId: kael.id, subject: seren.name, beat: "cruelty", note: "Kael kicked a beggar out of the road." },
    });
    if (!cruelty.ok) {
      throw new Error(`the conscience table's first deed was refused: ${cruelty.error}`);
    }
    conscience[viewport] = { id: table.id, kael: kael.id, seren: seren.name };
  }
}

// A romance's own scene (issue 643): one table per viewport, run by the lead
// as its GM, where the player's Kael is courting Lyra Wren, a party
// companion, and the engine has made her ask him for help with something of
// her own. The scenario reads the line on her Bonds row and plays it.
const ROMANCE_PACE_TITLE = "Romance Pace Table";
const romancePace = {};
{
  const { companionNpcFor } = await import("../../src/lib/db/companion-npcs.ts");
  const { patchNpcAgency } = await import("../../src/lib/db/npcs.ts");
  const { ensureRelationship, patchRelationship } = await import("../../src/lib/db/relationships.ts");
  const { writePacing } = await import("../../src/lib/db/romance-pacing.ts");
  const { NO_PACING } = await import("../../src/lib/dm/romance-scene-logic.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `${ROMANCE_PACE_TITLE} (${viewport})`,
      description: "A bard who has her own troubles.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    const seated = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
    if (seated.error) {
      throw new Error(`the player could not join ${table.title}: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const kael = sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Kael Ashvale", class: "rogue", level: 3 }));
    const bot = createCompanionUser("Lyra Wren");
    const lyra = sheets.createSheet(table.id, bot.id, 3, heroInput({ name: "Lyra Wren", class: "bard", level: 3 }));
    sheets.markSheetAsCompanion(lyra.id, "party", "Bright, restless, quick to laugh.");
    patchNpcAgency(companionNpcFor(sheets.getSheetById(lyra.id)).id, { personality: { drive: 0, diligence: 0, boldness: 0, warmth: 1, empathy: 0, composure: 0 } });
    const bond = ensureRelationship({ campaignId: table.id, characterId: kael.id, characterName: kael.name, subjectKind: "companion", subjectName: lyra.name, subjectId: lyra.id });
    patchRelationship(bond.id, { approval: 80, romance: "courting" });
    writePacing(bond.id, { ...NO_PACING, due: { kind: "asks_help", stage: "courting", rival: "", handed: 0 } });
    romancePace[viewport] = { id: table.id, kael: kael.name, lyra: lyra.name };
  }
}

// Scheming NPCs (issue 501): one table per viewport that the seed's player
// runs as its storyteller, where the lead plays Kael, open to advances, and
// Senna keeps up an act toward him (the ferry ledger), already played up to
// a warmth she does not feel. The scenario reads
// the act on Kael's Bonds row, sees it turn to the truth when an Insight
// from the storyteller's console beats Senna's Deception, reads the act on
// the storyteller's own Bonds tab, and sees a betrayal unmask her. Senna is
// a poor liar by nature, so an Insight beats her soon.
const MASKED_TITLE = "Masked Table";
const maskedNpcs = await import("../../src/lib/db/npcs.ts");
const maskedBonds = await import("../../src/lib/db/relationships.ts");
const { invokeEngine: maskedInvoke } = await import("../../src/lib/dm/invoke.ts");
const masked = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(player.id, {
    title: `${MASKED_TITLE} (${viewport})`,
    description: "A river crossing, a friendly ferrywoman, and a ledger someone wants.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 3,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false, dmMode: "human" },
  });
  campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(table.id).inviteCode);
  campaigns.setCampaignStatus(table.id, "active");
  const kael = sheets.createSheet(
    table.id,
    world.owner.id,
    3,
    heroInput({ name: "Kael Ashvale", class: "bard", level: 3, gender: "Male", abilities: { wis: 18 } }),
  );
  sheets.setOpenToAdvances(kael.id, true);
  const senna = maskedNpcs.upsertNpc({
    campaignId: table.id,
    name: "Senna Vale",
    attitude: "friendly",
    trait: "A ferrywoman who laughs a little too easily",
    location: "the ford",
    gender: "Female",
    attraction: { genders: ["Male"], note: "" },
  });
  maskedNpcs.patchNpcAgency(senna.id, { personality: { drive: -3, diligence: 0, boldness: 0, warmth: 2, empathy: 3, composure: -3 } });
  const bond = maskedBonds.ensureRelationship({
    campaignId: table.id,
    characterId: kael.id,
    characterName: kael.name,
    subjectKind: "npc",
    subjectName: senna.name,
    subjectId: senna.id,
  });
  maskedBonds.patchRelationship(bond.id, {
    approval: -30,
    memories: [{ kind: "helped", text: "Kael carried her nets up from the water", at: new Date().toISOString() }],
  });
  const started = await maskedInvoke(campaigns.getCampaignById(table.id), { kind: "human", userId: player.id }, {
    name: "relationship_scheme",
    args: { action: "start", characterId: kael.id, subject: senna.name, motive: "the ferry ledger" },
  });
  if (!started.ok) {
    throw new Error(`the masked table's act did not start: ${started.error}`);
  }
  // An act starts where she truly stands; this one has been played up over
  // earlier scenes to a warmth she does not feel.
  const acting = maskedBonds.getRelationshipById(bond.id);
  maskedBonds.patchRelationship(bond.id, { pretense: { ...acting.pretense, shown: 40 } });
  masked[viewport] = { id: table.id, kael: kael.id };
}

// Companions leaving (issue 503 Phases 2 and 3): one table per viewport (the
// scenario walks a companion out), run by the lead as its DM. The player's
// Kael travels with Seren Vale, a timid paladin who walks out at a red-line
// atrocity; Tam Hollis, a timid fighter, already walked out earlier, so the
// Gone list stands before the scenario moves anyone. Ilse Marrow, another
// player's character, was close to Tam, and the Gone list says he still
// cares for her (issue 563).
const GONE_TITLE = "Gone Table";
const gone = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const { companionNpcFor } = await import("../../src/lib/db/companion-npcs.ts");
  const { patchNpcAgency } = await import("../../src/lib/db/npcs.ts");
  const goneBonds = await import("../../src/lib/db/relationships.ts");
  const friend = world.addUser("friend");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `${GONE_TITLE} (${viewport})`,
      description: "A party that has lost one companion and is about to lose another.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human", companions: "full" },
    });
    // Seated before the table starts: a started table refuses a code
    // (src/lib/db/campaigns.ts admitsByRow), and the player never sat here.
    const seated = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
    if (seated.error) {
      throw new Error(`the player could not join ${table.title}: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const kael = sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Kael Ashvale", class: "rogue", level: 3 }));
    const companion = (name, klass, alignment) => {
      const bot = createCompanionUser(name);
      const sheet = sheets.createSheet(table.id, bot.id, 3, heroInput({ name, class: klass, alignment, level: 3 }));
      sheets.markSheetAsCompanion(sheet.id, "party", "Quiet, and quick to take fright.");
      const row = companionNpcFor(sheets.getSheetById(sheet.id));
      patchNpcAgency(row.id, { personality: { drive: 0, diligence: 0, boldness: -2, warmth: 0, empathy: 0, composure: 0 } });
      return sheet;
    };
    const tam = companion("Tam Hollis", "fighter", "LG");
    const seren = companion("Seren Vale", "paladin", "LG");
    campaigns.joinByInviteCode(friend.id, campaigns.getCampaignById(table.id).inviteCode);
    const ilse = sheets.createSheet(table.id, friend.id, 3, heroInput({ name: "Ilse Marrow", class: "cleric", level: 3 }));
    const close = goneBonds.ensureRelationship({ campaignId: table.id, characterId: ilse.id, characterName: ilse.name, subjectKind: "companion", subjectName: tam.name });
    goneBonds.patchRelationship(close.id, { approval: 70 });
    const left = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: world.owner.id }, {
      name: "relationship_beat",
      args: { characterId: kael.id, subject: tam.name, beat: "slaving", severity: "atrocity", note: "Kael sold the captives to the slaver's barge." },
    });
    if (!left.ok || left.result.departed !== "Walked out on the party") {
      throw new Error(`the gone table's first departure did not happen: ${left.error ?? JSON.stringify(left.result)}`);
    }
    gone[viewport] = { id: table.id, kael: kael.id, seren: seren.id, serenName: seren.name };
  }
}

// Issue 740: per viewport, a table a person runs with three characters and no
// fight yet, so the console's Start a fight can leave one out.
const FAR_SCOUT_TITLE = "Far Scout Table";
const farScout = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(world.owner.id, {
    title: `${FAR_SCOUT_TITLE} (${viewport})`,
    description: "One of the party has gone far ahead along the road.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 3,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false, dmMode: "human" },
  });
  const seat = (user, name, klass) => {
    campaigns.joinByInviteCode(user.id, campaigns.getCampaignById(table.id).inviteCode);
    return sheets.createSheet(table.id, user.id, 3, heroInput({ name, class: klass, level: 3 }));
  };
  const kael = seat(player, "Kael Ashvale", "rogue");
  const ilse = seat(world.addUser("friend"), "Ilse Marrow", "cleric");
  const cora = seat(world.addUser("friend"), "Cora Vale", "ranger");
  campaigns.setCampaignStatus(table.id, "active");
  farScout[viewport] = { id: table.id, kael: kael.id, ilse: ilse.id, cora: cora.id };
}

// Combat sides (issue 503): per viewport, a table a person runs where two of
// the player's casters each hold an elemental by Conjure Elemental, in a
// fight with a goblin. The scenario ends one concentration and then the
// other (the second under reduced motion), and each elemental's token
// re-rims from the party's colour to the foes'.
const TURNCOAT_TITLE = "Turncoat Table";
const turncoat = {};
const dominate = {};
const pileup = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const maps = await import("../../src/lib/db/battle-maps.ts");
  const encounterRows = await import("../../src/lib/db/encounters.ts");
  // SRD 5.1 slots of a 9th level full caster: 4, 3, 3, 3 and one 5th.
  const slots = Object.fromEntries([4, 3, 3, 3, 1].map((max, index) => [String(index + 1), { max, used: 0 }]));
  const conjurer = (name, cls, ability) =>
    heroInput({
      name,
      class: cls,
      level: 9,
      maxHp: 60,
      abilities: { [ability]: 18, con: 14, dex: 12 },
      equipment: [{ name: "Component pouch", qty: 1 }],
      spellcasting: { ability, slots, known: [], prepared: ["Conjure Elemental"], cantrips: [] },
    });
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `${TURNCOAT_TITLE} (${viewport})`,
      description: "Two conjurers, two bound elementals, and a binding that will not hold.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 9,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    // Seated before the table starts: a started table refuses a code
    // (src/lib/db/campaigns.ts admitsByRow), and the player never sat here.
    const seated = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
    if (seated.error) {
      throw new Error(`the player could not join ${table.title}: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const dm = { kind: "human", userId: world.owner.id };
    const casters = [
      [sheets.createSheet(table.id, player.id, 9, conjurer("Ione Vass", "wizard", "int")), "fire elemental"],
      [sheets.createSheet(table.id, player.id, 9, conjurer("Oswin Reed", "druid", "wis")), "earth elemental"],
    ];
    // Conjure Elemental takes a minute to cast, so out of the fight.
    for (const [caster, variant] of casters) {
      const cast = await invokeEngine(campaigns.getCampaignById(table.id), dm, {
        name: "cast_buff",
        args: { characterId: caster.id, spell: "Conjure Elemental", level: 5, variant },
      });
      if (!cast.ok) {
        throw new Error(`the turncoat table's ${variant} was not conjured: ${cast.error}`);
      }
    }
    const started = await invokeEngine(campaigns.getCampaignById(table.id), dm, {
      name: "start_encounter",
      args: { enemies: [{ monster: "goblin", count: 1 }] },
    });
    if (!started.ok) {
      throw new Error(`the turncoat table's fight did not start: ${started.error}`);
    }
    const encounter = encounterRows.getActiveEncounter(table.id);
    const board = maps.getBattleMapForEncounter(encounter.id);
    maps.setBattleMapTerrain(board.id, ".".repeat(board.width * board.height));
    getDatabase().prepare("UPDATE battle_maps SET doors_json = '{}' WHERE id = ?").run(board.id);
    const elementals = casters.map(([caster, variant]) => {
      const summoned = sheets.listSheets(table.id).find((sheet) => sheet.summon?.casterId === caster.id);
      if (!summoned) {
        throw new Error(`the turncoat table's ${variant} has no sheet`);
      }
      return summoned;
    });
    // The two elementals side by side in the board's middle, each caster
    // beside theirs and the goblin below, where a zoomed-in camera still
    // sees them.
    const cx = Math.floor(board.width / 2);
    const cy = Math.floor(board.height / 2);
    const spots = new Map([
      [casters[0][0].id, [cx - 3, cy]],
      [elementals[0].id, [cx - 1, cy]],
      [elementals[1].id, [cx + 1, cy]],
      [casters[1][0].id, [cx + 3, cy]],
    ]);
    for (const token of maps.listTokens(board.id)) {
      const [x, y] = spots.get(token.refId) ?? [cx, cy + 3];
      maps.moveToken(token.id, x, y, 0);
    }
    for (const elemental of elementals) {
      if (!maps.getTokenByRef(board.id, elemental.id)) {
        throw new Error(`the turncoat table's ${elemental.name} is not on the board`);
      }
    }
    turncoat[viewport] = {
      id: table.id,
      casters: casters.map(([caster]) => caster.id),
      elementals: elementals.map((elemental) => ({ id: elemental.id, name: elemental.name })),
    };
  }

  // Dominate, seeded straight onto the rows (no save dice). At the Dominate
  // Table, which the lead runs, the player's Sela holds an ogre by Dominate
  // Monster (it fights for the party) and an enemy mage holds the player's
  // Bran by Dominate Person (he fights against it). At the Held Table, which
  // the player runs, a mage holds the lead's own Tamsin.
  const fightOn = async (table, dmUserId, enemies) => {
    const started = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: dmUserId }, { name: "start_encounter", args: { enemies } });
    if (!started.ok) {
      throw new Error(`the ${table.title}'s fight did not start: ${started.error}`);
    }
    const encounter = encounterRows.getActiveEncounter(table.id);
    const board = maps.getBattleMapForEncounter(encounter.id);
    maps.setBattleMapTerrain(board.id, ".".repeat(board.width * board.height));
    getDatabase().prepare("UPDATE battle_maps SET doors_json = '{}' WHERE id = ?").run(board.id);
    // One row across the board's middle, two squares apart.
    const tokens = maps.listTokens(board.id);
    const [cx, cy] = [Math.floor(board.width / 2), Math.floor(board.height / 2)];
    tokens.forEach((token, index) => maps.moveToken(token.id, cx - (tokens.length - 1) + index * 2, cy, 0));
    const place = (refId, dx) => maps.moveToken(maps.getTokenByRef(board.id, refId).id, cx + dx, cy, 0);
    return { rows: encounterRows.listEnemies(encounter.id), place };
  };
  const enemyNamed = (rows, slug) => rows.find((enemy) => enemy.slug === slug) ?? (() => { throw new Error(`no ${slug} in the fight`); })();
  const charmBy = (spell, source) => ({ conditions: ["charmed"], conditionMeta: { charmed: { spell, source } } });
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `Dominate Table (${viewport})`,
      description: "An ogre that answers to the wrong voice, and a friend who no longer answers to his own.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 9,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
    campaigns.setCampaignStatus(table.id, "active");
    const sela = sheets.createSheet(table.id, player.id, 9, heroInput({ name: "Sela Morrow", class: "wizard", level: 9, maxHp: 50 }));
    const bran = sheets.createSheet(table.id, player.id, 9, heroInput({ name: "Bran Holt", class: "fighter", level: 9, maxHp: 80 }));
    const { rows, place } = await fightOn(table, world.owner.id, [{ monster: "ogre", count: 1 }, { monster: "mage", count: 1 }]);
    const [ogre, mage] = [enemyNamed(rows, "ogre"), enemyNamed(rows, "mage")];
    // The ogre in the board's middle, where a phone's camera sees it.
    [[sela.id, -4], [ogre.id, -1], [bran.id, 2], [mage.id, 4]].forEach(([refId, dx]) => place(refId, dx));
    const ogreCharm = charmBy("Dominate Monster", sela.id);
    encounterRows.patchEnemyConditions(ogre.id, ogreCharm.conditions, ogreCharm.conditionMeta);
    sheets.patchSheet(bran.id, charmBy("Dominate Person", mage.id));
    // Sela opens the fight, whatever the dice said. The order is rolled, and
    // with Bran ahead of both enemies it is his turn, which the GM plays from
    // the party's Hand (gmTurnDominated), so the monsters' hand this table
    // shows was not there on about one seed in four.
    const opening = encounterRows.getActiveEncounter(table.id);
    const fixedOrder = [sela.id, bran.id, ogre.id, mage.id].map((id, index) => ({
      ...opening.order.find((entry) => (entry.characterId ?? entry.enemyId) === id),
      initiative: 20 - index * 5,
    }));
    encounterRows.saveEncounter({ ...opening, order: fixedOrder, turnIndex: 0, turnBudget: null });
    const held = campaigns.createCampaign(player.id, {
      title: `Held Table (${viewport})`,
      description: "A mage's voice in Tamsin's head.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 9,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(held.id).inviteCode);
    campaigns.setCampaignStatus(held.id, "active");
    const tamsin = sheets.createSheet(held.id, world.owner.id, 9, heroInput({ name: "Tamsin Vale", class: "fighter", level: 9, maxHp: 80 }));
    sheets.createSheet(held.id, world.owner.id, 9, heroInput({ name: "Corra Wynd", class: "cleric", level: 9, maxHp: 60 }));
    const { rows: heldRows } = await fightOn(held, player.id, [{ monster: "mage", count: 1 }]);
    sheets.patchSheet(tamsin.id, charmBy("Dominate Person", enemyNamed(heldRows, "mage").id));
    dominate[viewport] = {
      id: table.id,
      ogre: { id: ogre.id, name: ogre.displayName },
      mage: { id: mage.id, name: mage.displayName },
      sela: { id: sela.id, name: sela.name },
      bran: { id: bran.id, name: bran.name },
      heldId: held.id,
      tamsin: { id: tamsin.id, name: tamsin.name },
    };
  }

  // The hover plate under a high-level pile, debuffs and buffs: an ogre
  // prone, restrained, poisoned, frightened by the player's Wren, Hasted,
  // Blessed, invisible and Shielded. Eight rows, more than a page on a phone
  // (four) or a desktop (six): SRD meanings, registry summaries, rounds, a
  // save and a source. The lead runs the table.
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `Pileup Table (${viewport})`,
      description: "An ogre that has had a very bad round.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 5,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
    campaigns.setCampaignStatus(table.id, "active");
    const wren = sheets.createSheet(table.id, player.id, 5, heroInput({ name: "Wren Ashby", class: "wizard", level: 5, maxHp: 30 }));
    const { rows, place } = await fightOn(table, world.owner.id, [{ monster: "ogre", count: 1 }]);
    const ogre = enemyNamed(rows, "ogre");
    [[wren.id, -2], [ogre.id, 1]].forEach(([refId, dx]) => place(refId, dx));
    encounterRows.patchEnemyConditions(ogre.id, ["prone", "restrained", "poisoned", "frightened", "hasted", "blessed", "invisible", "shielded"], {
      restrained: { rounds: 2, spell: "Web" },
      frightened: { source: wren.id, spell: "Cause Fear", saveEnds: { ability: "wis", dc: 13 } },
      hasted: { rounds: 10, spell: "Haste" },
      blessed: { rounds: 10, spell: "Bless" },
    });
    pileup[viewport] = { id: table.id, ogre: { id: ogre.id, name: ogre.displayName }, wren: { id: wren.id, name: wren.name } };
  }
}

// A companion inside the party (issue 503 Phases 4 and 6): per viewport, a
// table the lead runs at Turn, where the player's Kael travels with Varn
// Hale, a mercenary cleric who holds the innocent as a red line and is wary
// of Kael. The scenario has Varn refuse Kael a spell, ask his share as a
// fight starts, and then turn on the party where he stands.
const CONDUCT_TITLE = "Conduct Table";
const conduct = {};
{
  const { companionNpcFor } = await import("../../src/lib/db/companion-npcs.ts");
  const { patchNpcAgency } = await import("../../src/lib/db/npcs.ts");
  const { setCompanionValues } = await import("../../src/lib/db/companion-conscience.ts");
  const bonds = await import("../../src/lib/db/relationships.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `${CONDUCT_TITLE} (${viewport})`,
      description: "A sellsword priest who does nothing for free.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human", companions: "full", companionConscience: "turn" },
    });
    // Seated before the table starts: a started table refuses a code
    // (src/lib/db/campaigns.ts admitsByRow), and the player never sat here.
    const seated = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
    if (seated.error) {
      throw new Error(`the player could not join ${table.title}: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const kael = sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Kael Ashvale", class: "rogue", level: 3 }));
    const bot = createCompanionUser("Varn Hale");
    const varn = sheets.createSheet(
      table.id,
      bot.id,
      3,
      heroInput({
        name: "Varn Hale",
        class: "cleric",
        level: 3,
        abilities: { wis: 16, con: 14 },
        spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, known: [], prepared: ["Cure Wounds"], cantrips: [] },
      }),
    );
    sheets.markSheetAsCompanion(varn.id, "party", "Counts every coin, and every slight.");
    const row = companionNpcFor(sheets.getSheetById(varn.id));
    patchNpcAgency(row.id, { personality: { drive: 0, diligence: 0, boldness: 3, warmth: 0, empathy: 0, composure: -1 } });
    setCompanionValues(row.id, [
      { value: "mercenary", strength: "cares", faction: "" },
      { value: "protects_innocent", strength: "red_line", faction: "" },
    ]);
    const bond = bonds.ensureRelationship({ campaignId: table.id, characterId: kael.id, characterName: kael.name, subjectKind: "companion", subjectName: varn.name });
    bonds.patchRelationship(bond.id, { approval: -20 });
    const fighterBot = createCompanionUser("Brannoc Rusk");
    const brannoc = sheets.createSheet(table.id, fighterBot.id, 3, heroInput({ name: "Brannoc Rusk", class: "fighter", level: 3 }));
    sheets.markSheetAsCompanion(brannoc.id, "party", "Quick to anger, slow to think.");
    const rash = companionNpcFor(sheets.getSheetById(brannoc.id));
    patchNpcAgency(rash.id, { personality: { drive: 0, diligence: 0, boldness: 3, warmth: 0, empathy: 0, composure: -1 } });
    setCompanionValues(rash.id, [{ value: "protects_innocent", strength: "red_line", faction: "" }]);
    conduct[viewport] = { id: table.id, kael: kael.id, kaelName: kael.name, varn: varn.id, varnName: varn.name, brannoc: brannoc.id, brannocName: brannoc.name };
  }
}

// Pacts (issue 503 Phases 5 and 7): per viewport, four tables where the
// lead and the seed's player each play a character beside Seren Vale, a
// lasting companion. "Consent": nobody has said yes to pacts yet, for the
// Bonds switch. "Offer": the lead's Kael said yes and Seren's approach waits
// on his answer alone, for the owner-only card. "Secret": Kael already
// joined Seren's pact, and the player's Brin has eyes too dull to catch a
// quiet scheme, for a secret action and its confirmation. "Reveal": a table
// the lead runs as its DM, where the player's Brin joined Seren's pact and
// holds a secret, and Seren is at her breaking point, so the next long rest
// sets the pact off and the transcript draws the reveal.
const pactTables = { consent: {}, offer: {}, secret: {}, reveal: {} };
{
  const { companionNpcFor } = await import("../../src/lib/db/companion-npcs.ts");
  const { patchNpcAgency } = await import("../../src/lib/db/npcs.ts");
  const { saveConscience } = await import("../../src/lib/db/companion-conscience.ts");
  const { CONTENT } = await import("../../src/lib/dm/conscience-logic.ts");
  const pactsDb = await import("../../src/lib/db/pacts.ts");
  const { replan } = await import("../../src/lib/dm/pacts.ts");
  const { approachSummary, approachWords } = await import("../../src/lib/dm/pact-logic.ts");
  const { declareSecretAction } = await import("../../src/lib/dm/pact-players.ts");
  const pactTable = (kind, viewport, humanDm) => {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `Pact ${kind} (${viewport})`,
      description: "A paladin who has seen too much, and a party that may not survive her doubts.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, companions: "full", ...(humanDm ? { dmMode: "human" } : {}) },
    });
    // Seated before the table starts: a started table refuses a code
    // (src/lib/db/campaigns.ts admitsByRow), and the player never sat here.
    const seated = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
    if (seated.error) {
      throw new Error(`the player could not join ${table.title}: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const bot = createCompanionUser("Seren Vale");
    const seren = sheets.createSheet(table.id, bot.id, 3, heroInput({ name: "Seren Vale", class: "paladin", alignment: "LG", gender: "Female", level: 3 }));
    sheets.markSheetAsCompanion(seren.id, "party", "Stern, devout, and losing faith in the people she walks with.");
    const row = companionNpcFor(sheets.getSheetById(seren.id));
    patchNpcAgency(row.id, { personality: { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0 } });
    saveConscience(row.id, { ...CONTENT, held: 1, shown: 1 });
    return { table, seren, row };
  };
  const formed = (table, seren, row, members) => {
    const pact = pactsDb.insertPact({ campaignId: table.id, leaderNpcId: row.id, members: [{ kind: "companion", npcId: row.id, name: seren.name, sheetId: seren.id }, ...members], plan: "leave", tactic: null, trigger: "night_watch", createdAt: 0 });
    return pactsDb.savePact(replan(campaigns.getCampaignById(table.id), pact));
  };
  for (const viewport of ["desktop", "phone"]) {
    {
      const { table } = pactTable("Consent", viewport, false);
      const kael = sheets.createSheet(table.id, world.owner.id, 3, heroInput({ name: "Kael Ashvale", class: "rogue", level: 3, gender: "Male" }));
      sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Brin Hale", class: "fighter", level: 3, gender: "Female" }));
      pactTables.consent[viewport] = { id: table.id, kael: kael.id };
    }
    {
      const { table, seren, row } = pactTable("Offer", viewport, false);
      const kael = sheets.createSheet(table.id, world.owner.id, 3, heroInput({ name: "Kael Ashvale", class: "rogue", level: 3, gender: "Male" }));
      sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Brin Hale", class: "fighter", level: 3, gender: "Female" }));
      sheets.setOpenToPacts(kael.id, true);
      const pact = pactsDb.savePact({ ...formed(table, seren, row, []), approached: [kael.id] });
      const offer = itemProposals.insertItemProposal({
        campaignId: table.id,
        turnId: null,
        characterId: kael.id,
        userId: world.owner.id,
        toolName: "pact_approach",
        argsJson: JSON.stringify({ pactId: pact.id, recruiter: seren.name, portraitUrl: "", look: { gender: "Female", race: "human", class: "paladin" } }),
        summary: approachSummary(kael.name),
        reason: approachWords(seren.name, pact),
        seq: campaigns.allocateSeq(table.id),
        ownerOnly: true,
      });
      pactTables.offer[viewport] = { id: table.id, kael: kael.id, offerId: offer.id, summary: offer.summary };
    }
    {
      const { table, seren, row } = pactTable("Secret", viewport, false);
      const kael = sheets.createSheet(table.id, world.owner.id, 3, heroInput({ name: "Kael Ashvale", class: "rogue", level: 3, gender: "Male", abilities: { dex: 20 } }));
      sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Brin Hale", class: "fighter", level: 3, gender: "Female", abilities: { wis: 1 } }));
      formed(table, seren, row, [{ kind: "player", characterId: kael.id, name: kael.name, userId: world.owner.id, stance: "joined" }]);
      pactTables.secret[viewport] = { id: table.id, kael: kael.id };
    }
    {
      const { table, seren, row } = pactTable("Reveal", viewport, true);
      const brin = sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Brin Hale", class: "rogue", level: 3, gender: "Female", abilities: { dex: 20 } }));
      formed(table, seren, row, [{ kind: "player", characterId: brin.id, name: brin.name, userId: player.id, stance: "joined" }]);
      const secret = declareSecretAction(campaigns.getCampaignById(table.id), sheets.getSheetById(brin.id), { kind: "scheme", text: "cut the horses loose before dawn", skill: "stealth" });
      if ("error" in secret || secret.caught) {
        throw new Error(`the reveal table's secret action did not hold: ${JSON.stringify(secret)}`);
      }
      saveConscience(row.id, { ...CONTENT, held: 4, shown: 4 });
      pactTables.reveal[viewport] = { id: table.id, brin: brin.id, secret: "cut the horses loose before dawn" };
    }
  }
}

// A table the player runs, made from their workshop, where the lead joins
// as a player: the workshop's pregens, one ticked "Offer to players" and one
// not (src/lib/db/pregen-offers.ts), for the hero chooser's offered section
// and the confirm sheet's owed picks. Level 4, so a level 1 fighter owes its
// subclass and an improvement there.
const { createWorkshop } = await import("../../src/lib/db/workshops.ts");
const { linkWorkshop } = await import("../../src/lib/db/campaign-workshops.ts");
const { setPregenOffered } = await import("../../src/lib/db/characters.ts");
const OFFER_TITLE = "Offer Table";
const offerTable = campaigns.createCampaign(player.id, {
  title: OFFER_TITLE,
  description: "A table its GM made from a workshop with pregens.",
  theme: "high-fantasy",
  maxPlayers: 6,
  startingLevel: 4,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false },
});
campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(offerTable.id).inviteCode);
const offerWorkshop = createWorkshop(player.id, { title: "The Sunken Keep" });
linkWorkshop(offerTable.id, offerWorkshop.id);
const pregenSheet = (name) => ({
  name,
  race: "human",
  class: "fighter",
  subclass: "",
  background: "soldier",
  alignment: "N",
  abilities: { str: 16, dex: 15, con: 14, int: 13, wis: 11, cha: 9 },
  maxHp: 12,
  ac: 18,
  acOverride: false,
  speed: 30,
  hitDice: { die: "d10", total: 1, spent: 0 },
  classes: [],
  hitDicePools: null,
  proficiencies: {
    saves: ["str", "con"],
    skills: ["perception", "survival", "athletics", "intimidation"],
    expertise: [],
    languages: ["Common", "Dwarvish"],
    tools: ["dice set", "vehicles (land)"],
    armor: ["light", "medium", "heavy", "shields"],
    weapons: ["simple", "martial"],
  },
  equipment: [{ name: "Longsword", qty: 1 }, { name: "Chain Mail", qty: 1 }, { name: "Shield", qty: 1 }],
  gold: 10,
  copper: 0,
  feats: [],
  features: [{ name: "Fighting Style: Defense", source: "choice" }],
  asiChoices: [],
  spellcasting: null,
  portrait: { url: "/uploads/seeded-pregen.png" },
  notes: "",
  backstory: "",
});
const offeredPregen = createCharacter(player.id, 1, pregenSheet("Thessaly Brightmoor"), "pc", offerWorkshop.id);
setPregenOffered(player.id, offeredPregen.id, true);
const hiddenPregen = createCharacter(player.id, 1, pregenSheet("Unoffered Orrin"), "pc", offerWorkshop.id);

// Narrator quality (issue #460): an ended table with three AI turns that
// finished, one the guard had to rewrite and one the lead undid a change of,
// for Admin > Usage > Narrator quality and its export. Ended, so no list of
// tables in play or in their lobbies counts it.
const qualityTurnIds = [];
{
  const { createDmTurn, saveDmTurn } = await import("../../src/lib/db/dm-turns.ts");
  const { recordTurnCorrection } = await import("../../src/lib/db/turn-ledger.ts");
  const qualityTable = campaigns.createCampaign(world.owner.id, {
    title: "Quality Table",
    description: "Three turns the narrator ran, for the narrator quality card.",
    theme: "high-fantasy",
    maxPlayers: 4,
    startingLevel: 1,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false },
  });
  campaigns.setCampaignStatus(qualityTable.id, "active");
  for (let index = 0; index < 3; index += 1) {
    const turn = createDmTurn(qualityTable.id, [], "ai");
    turn.status = "done";
    turn.callIndex = 2;
    turn.guard = index === 2 ? { outcome: "rewritten", kinds: ["hit"] } : { outcome: "quiet", kinds: [] };
    saveDmTurn(turn);
    if (index === 1) {
      recordTurnCorrection({ campaignId: qualityTable.id, turnId: turn.id, attribution: "direct", kind: "sheet_undo", tool: "apply_damage", userId: world.owner.id });
    }
    qualityTurnIds.push(turn.id);
  }
  campaigns.setCampaignStatus(qualityTable.id, "ended");
}

// The reason chips (issue #460): a table per viewport whose two passages came
// from finished AI turns, so editing either is a fix the ledger records and
// the strip offers a reason for.
const chipTables = {};
{
  const { createDmTurn, saveDmTurn } = await import("../../src/lib/db/dm-turns.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `Chip Table (${viewport})`,
      description: "Two passages the narrator wrote, for the reason chips.",
      theme: "high-fantasy",
      maxPlayers: 4,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false },
    });
    campaigns.setCampaignStatus(table.id, "active");
    sheets.createSheet(table.id, world.owner.id, 3, heroInput({ name: "Odile Marsh", class: "fighter", level: 3 }));
    const turnIds = [];
    const messageIds = [];
    for (const content of [
      "The toll keeper squints at the cart and names a price twice what the sign says.",
      "Behind him the gate creaks open a hand's width, and a dog noses through the gap.",
    ]) {
      const turn = createDmTurn(table.id, [], "ai");
      saveDmTurn({ ...turn, status: "done", callIndex: 1 });
      const message = messages.insertCampaignMessage({
        campaignId: table.id,
        seq: campaigns.allocateSeq(table.id),
        authorType: "dm",
        speech: [],
        content,
        dmTurnId: turn.id,
      });
      turnIds.push(turn.id);
      messageIds.push(message.id);
    }
    chipTables[viewport] = { id: table.id, turnIds, messageIds };
  }
}

// Issue 528: a level 9 wizard in a fight, so a hand of thirty-odd cards:
// her spells fold under one Spells card by level (a third-level slot
// already spent), the basic actions under Actions, her gear under Items.
// The table is a person's to run (the player's seat), so the lead plays
// here and steers nothing: it offers no campaign prep (issue 530). One per
// viewport.
const SPELLBOOK_TITLE = "Spellbook Table";
const spellbook = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const maps = await import("../../src/lib/db/battle-maps.ts");
  const encounterRows = await import("../../src/lib/db/encounters.ts");
  const slots = Object.fromEntries([4, 3, 3, 3, 1].map((max, index) => [String(index + 1), { max, used: index === 2 ? 1 : 0 }]));
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(player.id, {
      title: `${SPELLBOOK_TITLE} (${viewport})`,
      description: "A wizard's whole spellbook in one fight.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 9,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    // Seated before the campaign starts: a running one admits no one unless
    // it holds the door open mid-game.
    const seated = campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(table.id).inviteCode);
    if ("error" in seated) {
      throw new Error(`could not seat the lead at the spellbook table: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const wizard = sheets.createSheet(
      table.id,
      world.owner.id,
      9,
      heroInput({
        name: "Maren Quill",
        class: "wizard",
        level: 9,
        maxHp: 52,
        abilities: { int: 18, con: 14, dex: 14 },
        equipment: [
          { name: "Component pouch", qty: 1 },
          { name: "Quarterstaff", qty: 1, equipped: true },
          { name: "Dagger", qty: 2 },
          { name: "Potion of healing", qty: 2 },
        ],
        spellcasting: {
          ability: "int",
          slots,
          known: [],
          cantrips: ["Fire Bolt", "Ray of Frost", "Mage Hand", "Light", "Minor Illusion"],
          prepared: [
            "Magic Missile", "Shield", "Sleep", "Detect Magic", "Misty Step", "Hold Person", "Scorching Ray", "Fireball",
            "Counterspell", "Lightning Bolt", "Fly", "Greater Invisibility", "Dimension Door", "Ice Storm", "Cone of Cold", "Wall of Force",
          ],
        },
      }),
    );
    const started = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: player.id }, {
      name: "start_encounter",
      args: { enemies: [{ monster: "goblin", count: 1 }] },
    });
    if (!started.ok) {
      throw new Error(`the spellbook table's fight did not start: ${started.error}`);
    }
    const encounter = encounterRows.getActiveEncounter(table.id);
    const board = maps.getBattleMapForEncounter(encounter.id);
    maps.setBattleMapTerrain(board.id, ".".repeat(board.width * board.height));
    getDatabase().prepare("UPDATE battle_maps SET doors_json = '{}' WHERE id = ?").run(board.id);
    // Her turn, the order rolled, so a card can be raised (as the combat
    // kit's giveTurn does for the main table).
    const place = encounter.order.findIndex((entry) => entry.characterId === wizard.id);
    if (place < 0) {
      throw new Error("the spellbook table's wizard has no place in the order");
    }
    // No enemy due before her, and the floor hers, as the DM's "Hand on the
    // turn" leaves it.
    encounterRows.saveEncounter({
      ...encounter,
      orderReady: true,
      round: Math.max(1, encounter.round),
      turnIndex: place,
      turnBudget: null,
      legendary: { ...encounter.legendary, due: [] },
    });
    const { initiativeFloorFor } = await import("../../src/lib/dm/encounter-tools.ts");
    campaigns.setFloor(table.id, initiativeFloorFor(table.id) ?? { mode: "open" });
    spellbook[viewport] = { id: table.id, wizard: wizard.id };
  }
}
// Witch Bolt's beam (scenario witch-bolt-hand): per viewport, a
// wizard's turn with the beam already connected to a goblin.
const witchBolt = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const encounterRows = await import("../../src/lib/db/encounters.ts");
  const { initiativeFloorFor } = await import("../../src/lib/dm/encounter-tools.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(player.id, {
      title: `Beam Table (${viewport})`,
      description: "A wizard, a goblin and a beam between them.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 5,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    const seated = campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(table.id).inviteCode);
    if ("error" in seated) {
      throw new Error(`could not seat the lead at the beam table: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const wizard = sheets.createSheet(
      table.id,
      world.owner.id,
      5,
      heroInput({
        name: "Sera Vane",
        class: "wizard",
        level: 5,
        maxHp: 32,
        abilities: { int: 18, con: 14, dex: 14 },
        equipment: [{ name: "Component pouch", qty: 1 }],
        spellcasting: {
          ability: "int",
          slots: { 1: { max: 4, used: 1 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } },
          known: [],
          cantrips: ["Fire Bolt"],
          prepared: ["Witch Bolt", "Magic Missile"],
        },
      }),
    );
    const started = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: player.id }, {
      name: "start_encounter",
      args: { enemies: [{ monster: "goblin", count: 1 }] },
    });
    if (!started.ok) {
      throw new Error(`the beam table's fight did not start: ${started.error}`);
    }
    const encounter = encounterRows.getActiveEncounter(table.id);
    const place = encounter.order.findIndex((entry) => entry.characterId === wizard.id);
    if (place < 0) {
      throw new Error("the beam table's wizard has no place in the order");
    }
    encounterRows.saveEncounter({
      ...encounter,
      orderReady: true,
      round: Math.max(2, encounter.round),
      turnIndex: place,
      turnBudget: null,
      legendary: { ...encounter.legendary, due: [] },
    });
    campaigns.setFloor(table.id, initiativeFloorFor(table.id) ?? { mode: "open" });
    // Last turn's hit, as connectBeam leaves it.
    sheets.patchSheet(wizard.id, { concentratingOn: "Witch Bolt" });
    const [goblin] = encounterRows.listEnemies(encounter.id);
    encounterRows.patchEnemyConditions(goblin.id, ["witch bolt"], { "witch bolt": { spell: "Witch Bolt", source: wizard.id } });
    witchBolt[viewport] = { id: table.id, wizard: wizard.id, goblin: goblin.id };
  }
}
// Tides of Chaos (scenario tides-of-chaos-card): per viewport, a Wild Magic
// sorcerer's turn in a fight with the feature's one use still there.
const tidesOfChaos = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const encounterRows = await import("../../src/lib/db/encounters.ts");
  const { initiativeFloorFor } = await import("../../src/lib/dm/encounter-tools.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(player.id, {
      title: `Chaos Table (${viewport})`,
      description: "A wild sorcerer and a goblin.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    const seated = campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(table.id).inviteCode);
    if ("error" in seated) {
      throw new Error(`could not seat the lead at the chaos table: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const sorcerer = sheets.createSheet(
      table.id,
      world.owner.id,
      3,
      heroInput({ name: "Ivo Quill", class: "sorcerer", subclass: "Wild Magic", level: 3, maxHp: 20, abilities: { dex: 14, con: 14, cha: 17 } }),
    );
    const started = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: player.id }, {
      name: "start_encounter",
      args: { enemies: [{ monster: "goblin", count: 1 }] },
    });
    if (!started.ok) {
      throw new Error(`the chaos table's fight did not start: ${started.error}`);
    }
    const encounter = encounterRows.getActiveEncounter(table.id);
    const place = encounter.order.findIndex((entry) => entry.characterId === sorcerer.id);
    if (place < 0) {
      throw new Error("the chaos table's sorcerer has no place in the order");
    }
    encounterRows.saveEncounter({ ...encounter, orderReady: true, turnIndex: place, turnBudget: null, legendary: { ...encounter.legendary, due: [] } });
    campaigns.setFloor(table.id, initiativeFloorFor(table.id) ?? { mode: "open" });
    tidesOfChaos[viewport] = { id: table.id, sorcerer: sorcerer.id };
  }
}

// A tiefling fighter's Infernal Legacy (scenario species-spells, issue
// #833): per viewport, on her turn in a fight, a 5th-level fighter whose race casts
// thaumaturgy, hellish rebuke and darkness with no Spellcasting of its own.
const speciesSpells = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(player.id, {
    title: `Infernal Table (${viewport})`,
    description: "A tiefling fighter and the spells of her blood.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 5,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false, dmMode: "human" },
  });
  const seated = campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(table.id).inviteCode);
  if ("error" in seated) {
    throw new Error(`could not seat the lead at the infernal table: ${seated.error}`);
  }
  campaigns.setCampaignStatus(table.id, "active");
  const fighter = sheets.createSheet(
    table.id,
    world.owner.id,
    5,
    heroInput({
      name: "Ash Marrow",
      race: "tiefling",
      class: "fighter",
      level: 5,
      maxHp: 44,
      abilities: { str: 16, con: 14, cha: 14 },
      equipment: [{ name: "Component pouch", qty: 1 }],
    }),
  );
  // In a fight on her turn, where the Hand deals her cards.
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const encounterRows = await import("../../src/lib/db/encounters.ts");
  const { initiativeFloorFor } = await import("../../src/lib/dm/encounter-tools.ts");
  const started = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: player.id }, {
    name: "start_encounter",
    args: { enemies: [{ monster: "goblin", count: 1 }] },
  });
  if (!started.ok) {
    throw new Error(`the infernal table's fight did not start: ${started.error}`);
  }
  const encounter = encounterRows.getActiveEncounter(table.id);
  const place = encounter.order.findIndex((entry) => entry.characterId === fighter.id);
  if (place < 0) {
    throw new Error("the infernal table's fighter has no place in the order");
  }
  encounterRows.saveEncounter({ ...encounter, orderReady: true, turnIndex: place, turnBudget: null, legendary: { ...encounter.legendary, due: [] } });
  campaigns.setFloor(table.id, initiativeFloorFor(table.id) ?? { mode: "open" });
  speciesSpells[viewport] = { id: table.id, fighter: fighter.id };
}

// Issue 668: a Hand notice ("already used their bonus action this turn")
// stayed into the next round while the chip was lit again. A fight a
// person runs (the player's seat), with the lead's fighter up, one per
// viewport, so the scenario can raise a notice and move the turn on.
const NOTICE_TITLE = "Notice Table";
const noticeTables = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const maps = await import("../../src/lib/db/battle-maps.ts");
  const encounterRows = await import("../../src/lib/db/encounters.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(player.id, {
      title: `${NOTICE_TITLE} (${viewport})`,
      description: "One goblin in a lane.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    const seated = campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(table.id).inviteCode);
    if ("error" in seated) {
      throw new Error(`could not seat the lead at the notice table: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const hero = sheets.createSheet(
      table.id,
      world.owner.id,
      3,
      heroInput({ name: "Oren Vale", class: "fighter", level: 3, equipment: [{ name: "Longsword", qty: 1, equipped: true }] }),
    );
    const started = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: player.id }, {
      name: "start_encounter",
      args: { enemies: [{ monster: "goblin", count: 1 }] },
    });
    if (!started.ok) {
      throw new Error(`the notice table's fight did not start: ${started.error}`);
    }
    const encounter = encounterRows.getActiveEncounter(table.id);
    const board = maps.getBattleMapForEncounter(encounter.id);
    maps.setBattleMapTerrain(board.id, ".".repeat(board.width * board.height));
    getDatabase().prepare("UPDATE battle_maps SET doors_json = '{}' WHERE id = ?").run(board.id);
    const place = encounter.order.findIndex((entry) => entry.characterId === hero.id);
    if (place < 0) {
      throw new Error("the notice table's fighter has no place in the order");
    }
    encounterRows.saveEncounter({
      ...encounter,
      orderReady: true,
      round: Math.max(1, encounter.round),
      turnIndex: place,
      turnBudget: null,
      legendary: { ...encounter.legendary, due: [] },
    });
    const { initiativeFloorFor } = await import("../../src/lib/dm/encounter-tools.ts");
    campaigns.setFloor(table.id, initiativeFloorFor(table.id) ?? { mode: "open" });
    noticeTables[viewport] = { id: table.id, hero: hero.id };
  }
}

// PR 782: the after-the-roll card on a real parked roll. A table the player
// runs, with the lead's hero holding the Lucky feat, one per viewport: the
// scenario asks for a check from the GM's seat and the lead answers the card.
const AFTER_ROLL_TITLE = "Lucky Table";
// Lets every initiative still waiting on its roller's after-the-roll card
// stand, as the player pressing Keep does, so a seeded fight has its order.
async function keepOpeningRolls(campaignId) {
  const { listOpenPendingRolls } = await import("../../src/lib/db/dm-turns.ts");
  const { landPendingRoll } = await import("../../src/lib/dm/pending-roll-land.ts");
  for (let pass = 0; pass < 8; pass += 1) {
    const waiting = listOpenPendingRolls(campaignId).filter((roll) => roll.kind === "initiative" && roll.parkedFor === "after_roll" && roll.thrown);
    if (!waiting.length) {
      return;
    }
    for (const roll of waiting) {
      landPendingRoll(campaigns.getCampaignById(campaignId), roll, roll.thrown.outcome, roll.thrown.landing);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const afterRollTables = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(player.id, {
    title: `${AFTER_ROLL_TITLE} (${viewport})`,
    description: "A gate that will not lift.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 3,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false, dmMode: "human" },
  });
  const seated = campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(table.id).inviteCode);
  if ("error" in seated) {
    throw new Error(`could not seat the lead at the lucky table: ${seated.error}`);
  }
  campaigns.setCampaignStatus(table.id, "active");
  const hero = sheets.createSheet(table.id, world.owner.id, 3, heroInput({ name: "Tamsin Reed", class: "fighter", level: 3, feats: ["Lucky"] }));
  afterRollTables[viewport] = { id: table.id, hero: hero.id };
}

// PR 848: the after-the-roll card on an attack. A fight the player runs, with
// the lead's fighter beside a goblin, holding the Lucky feat and a Bardic
// Inspiration die. The lead rolls real dice, so the scenario enters a 10: with
// the seeded hero's +0, a miss against the goblin's AC 15 that both could
// save, every run. (A test table's dice script could force the server's
// throw, but the app's list of tables leaves test tables out.)
const AFTER_ATTACK_TITLE = "Lucky Swing";
const afterAttackTables = {};
const WRATH_TITLE = "Storm Swing";
const wrathTables = {};
// The same lane for the features chosen on that card: Guided Strike, Master
// Duelist and Favored by the Gods (scenario after-roll-riders).
const AFTER_RIDER_TITLE = "Favored Swing";
const afterRiderTables = {};
// A second player's swing, with the lead's cleric beside them holding War God's
// Blessing (scenario ally-reaction-on-roll).
const ALLY_TITLE = "Blessed Swing";
const allyTables = {};
// The same, with an artificer beside them (scenario flash-of-genius-on-roll).
const FLASH_TITLE = "Flash of Insight";
const flashTables = {};
const TOUCH_TITLE = "Deathly Swing";
const touchTables = {};
// A fighter whose real d20 is never entered: the lead skips the turn and the
// card leaves the screen with it (scenario after-roll-attack).
const SKIPPED_TITLE = "Skipped Swing";
const skippedTables = {};
// A player's hit with the lead's Graviturgy wizard beside them (Violent
// Attraction): scenario after-roll-helpers. Restore Balance is used before
// the roll (issue #908), so it has no lane on the after-the-roll card.
const ATTRACTION_TITLE = "Heavy Swing";
const attractionTables = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const maps = await import("../../src/lib/db/battle-maps.ts");
  const encounterRows = await import("../../src/lib/db/encounters.ts");
  const { initiativeFloorFor } = await import("../../src/lib/dm/encounter-tools.ts");
  for (const [title, tables, feats, patch] of [
    [AFTER_ATTACK_TITLE, afterAttackTables, ["Lucky"], { conditions: ["bardic inspiration (d8)"] }],
    [WRATH_TITLE, wrathTables, [], {
      class: "cleric",
      features: [{ name: "Channel Divinity: Destructive Wrath", source: "choice" }],
      resources: { channel_divinity: { max: 1, used: 0 } },
      spellcasting: { ability: "wis", known: [], prepared: [], cantrips: ["Shocking Grasp"], slots: {} },
    }],
    [AFTER_RIDER_TITLE, afterRiderTables, [], {
      features: [{ name: "Channel Divinity: Guided Strike", source: "choice" }, { name: "Master Duelist", source: "choice" }, { name: "Favored by the Gods", source: "choice" }],
      resources: { channel_divinity: { max: 2, used: 0 }, sub_master_duelist: { max: 1, used: 0 }, sub_favored_by_the_gods: { max: 1, used: 0 } },
    }],
    [ALLY_TITLE, allyTables, [], {
      class: "cleric",
      otherRolls: true,
      features: [{ name: "Channel Divinity: War God's Blessing", source: "choice" }],
      resources: { channel_divinity: { max: 2, used: 0 } },
    }],
    [FLASH_TITLE, flashTables, [], {
      class: "artificer",
      otherRolls: true,
      abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 },
      features: [{ name: "Flash of Genius", source: "choice" }],
      resources: { art_flash_of_genius: { max: 3, used: 0 } },
    }],
    [SKIPPED_TITLE, skippedTables, [], {}],
    [TOUCH_TITLE, touchTables, [], {
      class: "cleric",
      features: [{ name: "Channel Divinity: Touch of Death", source: "choice" }],
      resources: { channel_divinity: { max: 1, used: 0 } },
    }],
    [ATTRACTION_TITLE, attractionTables, [], {
      class: "wizard",
      otherRolls: true,
      features: [{ name: "Violent Attraction", source: "choice" }],
      resources: { sub_violent_attraction: { max: 3, used: 0 } },
    }],
  ]) for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(player.id, {
      title: `${title} (${viewport})`,
      description: "One goblin in a lane.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human", dicePolicy: "real_allowed" },
    });
    const seated = campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(table.id).inviteCode);
    if ("error" in seated) {
      throw new Error(`could not seat the lead at the lucky swing table: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const hero = sheets.createSheet(
      table.id,
      world.owner.id,
      3,
      heroInput({ name: "Tamsin Reed", class: patch.class ?? "fighter", level: 3, feats, equipment: [{ name: "Longsword", qty: 1, equipped: true }] }),
    );
    const { class: _heroClass, otherRolls, rollerPatch, ...heroPatch } = patch;
    sheets.patchSheet(hero.id, heroPatch);
    const roller = otherRolls
      ? sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Bren Ash", class: "fighter", level: 3, feats: [], equipment: [{ name: "Longsword", qty: 1, equipped: true }] }))
      : hero;
    if (rollerPatch) {
      sheets.patchSheet(roller.id, rollerPatch);
    }
    const started = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: player.id }, {
      name: "start_encounter",
      args: { enemies: [{ monster: "goblin", count: 1 }] },
    });
    if (!started.ok) {
      throw new Error(`the lucky swing table's fight did not start: ${started.error}`);
    }
    // A hero who holds Lucky has an after-the-roll card on their initiative,
    // and the fight's order waits on it: their player lets it stand here.
    await keepOpeningRolls(table.id);
    const encounter = encounterRows.getActiveEncounter(table.id);
    const board = maps.getBattleMapForEncounter(encounter.id);
    maps.setBattleMapTerrain(board.id, ".".repeat(board.width * board.height));
    getDatabase().prepare("UPDATE battle_maps SET doors_json = '{}' WHERE id = ?").run(board.id);
    const [goblin] = encounterRows.listEnemies(encounter.id);
    for (const [token, x] of maps.listTokens(board.id).map((entry) => [entry, entry.refId === goblin.id ? 3 : 2])) {
      maps.moveToken(token.id, x, otherRolls && token.refId === hero.id ? 3 : 6, 0);
    }
    const place = encounter.order.findIndex((entry) => entry.characterId === roller.id);
    if (place < 0) {
      throw new Error("the lucky swing table's fighter has no place in the order");
    }
    encounterRows.saveEncounter({ ...encounterRows.getActiveEncounter(table.id), orderReady: true, round: Math.max(1, encounter.round), turnIndex: place, turnBudget: null, legendary: { ...encounter.legendary, due: [] } });
    campaigns.setFloor(table.id, initiativeFloorFor(table.id) ?? { mode: "open" });
    // Set once the order is: real dice would have parked the initiative too.
    campaigns.setMemberRealDice(table.id, otherRolls ? player.id : world.owner.id, true);
    tables[viewport] = { id: table.id, hero: hero.id, roller: roller.id, goblin: goblin.id };
  }
}

// Portent's numbers on a real parked roll: a table the player runs, with the
// lead's hero a School of Divination wizard holding two numbers.
const PORTENT_TITLE = "Seer's Table";
const portentTables = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(player.id, {
    title: `${PORTENT_TITLE} (${viewport})`,
    description: "Runes that will not read.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 5,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false, dmMode: "human" },
  });
  const seated = campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(table.id).inviteCode);
  if ("error" in seated) {
    throw new Error(`could not seat the lead at the seer's table: ${seated.error}`);
  }
  campaigns.setCampaignStatus(table.id, "active");
  const hero = sheets.createSheet(table.id, world.owner.id, 5, heroInput({ name: "Ione Vale", class: "wizard", subclass: "School of Divination", level: 5 }));
  sheets.patchSheet(hero.id, { resources: { ...hero.resources, sub_portent: { max: 2, used: 0 } }, foretold: [17, 3] });
  portentTables[viewport] = { id: table.id, hero: hero.id };
}

// Watching a fight for Portent (src/lib/dm/foresight.ts): a table the AI GM
// runs with the player steering, in a fight with one goblin, where the lead's
// Divination wizard holds two numbers. The stops come in the AI's turns, so
// the button stands only at a table like this one.
const WATCH_TITLE = "Seer's Watch";
const watchTables = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const encounterRows = await import("../../src/lib/db/encounters.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(player.id, {
      title: `${WATCH_TITLE} (${viewport})`,
      description: "A goblin, and a wizard who has seen this before.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 5,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "steered" },
    });
    const seated = campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(table.id).inviteCode);
    if ("error" in seated) {
      throw new Error(`could not seat the lead at the seer's watch: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const hero = sheets.createSheet(table.id, world.owner.id, 5, heroInput({ name: "Ione Vale", class: "wizard", subclass: "School of Divination", level: 5 }));
    sheets.patchSheet(hero.id, { resources: { ...hero.resources, sub_portent: { max: 2, used: 0 } }, foretold: [17, 3] });
    const started = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: player.id }, {
      name: "start_encounter",
      args: { enemies: [{ monster: "goblin", count: 1 }] },
    });
    if (!started.ok) {
      throw new Error(`the seer's watch fight did not start: ${started.error}`);
    }
    const encounter = encounterRows.getActiveEncounter(table.id);
    encounterRows.saveEncounter({ ...encounter, orderReady: true, round: Math.max(1, encounter.round), legendary: { ...encounter.legendary, due: [] } });
    watchTables[viewport] = { id: table.id, hero: hero.id };
  }
}

// Out of a fight, the lead's Circle of Stars druid holds Weal (the ruling on
// issue #908): the Watch toggle stands for her at a table the AI GM plays,
// and her own check waits before the throw for the omen's d6 (scenario
// before-roll).
const STAR_TITLE = "Star Watch";
const starTables = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(player.id, {
    title: `${STAR_TITLE} (${viewport})`,
    description: "A druid who reads the stars.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 6,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false, dmMode: "steered" },
  });
  const seated = campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(table.id).inviteCode);
  if ("error" in seated) {
    throw new Error(`could not seat the lead at the star watch: ${seated.error}`);
  }
  campaigns.setCampaignStatus(table.id, "active");
  const hero = sheets.createSheet(table.id, world.owner.id, 6, heroInput({ name: "Vela Stars", class: "druid", subclass: "Circle of Stars", level: 6 }));
  sheets.patchSheet(hero.id, { resources: { ...hero.resources, sub_cosmic_omen: { max: 3, used: 0 } }, omen: "weal" });
  starTables[viewport] = { id: table.id, hero: hero.id };
}

// A pointer move held for a watch stop (src/lib/dm/turn-hold.ts): the lead's
// fighter is up and frightened by a hold she saves against as her turn ends,
// and the player's Divination wizard watches the fight. The lead's End Turn
// waits on the wizard's stop; the scenario answers it as the player.
const HELD_TURN_TITLE = "Held Breath";
const heldTurnTables = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const encounterRows = await import("../../src/lib/db/encounters.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(player.id, {
      title: `${HELD_TURN_TITLE} (${viewport})`,
      description: "A goblin, a frightened fighter, and a wizard who has seen this before.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 5,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "steered" },
    });
    const seated = campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(table.id).inviteCode);
    if ("error" in seated) {
      throw new Error(`could not seat the lead at the held turn: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const hero = sheets.createSheet(table.id, world.owner.id, 5, heroInput({ name: "Wren Hale", class: "fighter", level: 5 }));
    const seer = sheets.createSheet(table.id, player.id, 5, heroInput({ name: "Ione Vale", class: "wizard", subclass: "School of Divination", level: 5 }));
    sheets.patchSheet(seer.id, { resources: { ...seer.resources, sub_portent: { max: 2, used: 0 } }, foretold: [17, 3] });
    const started = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: player.id }, {
      name: "start_encounter",
      args: { enemies: [{ monster: "goblin", count: 1 }] },
    });
    if (!started.ok) {
      throw new Error(`the held turn's fight did not start: ${started.error}`);
    }
    const encounter = encounterRows.getActiveEncounter(table.id);
    const entry = (id) => encounter.order.find((each) => (each.kind === "pc" ? each.characterId : each.enemyId) === id);
    const goblin = encounter.order.find((each) => each.kind === "enemy");
    encounterRows.saveEncounter({ ...encounter, order: [entry(hero.id), entry(seer.id), goblin], turnIndex: 0, orderReady: true, round: Math.max(1, encounter.round), legendary: { ...encounter.legendary, due: [] } });
    sheets.patchSheet(hero.id, { conditions: ["frightened"], conditionMeta: { frightened: { spell: "Fear", source: "a shadow", saveEnds: { ability: "wis", dc: 30 } } } });
    sheets.setSheetWatching(seer.id, encounter.id);
    heldTurnTables[viewport] = { id: table.id, hero: hero.id, seer: seer.id };
  }
}

// Chronal Shift on another creature's roll (src/lib/dm/chronal-shift.ts). The
// lead's Chronurgy wizard beside the player's own fighter at a table the
// player runs: a check of the fighter's that fails waits on the wizard's
// screen too. And a fight the AI GM runs with the player steering, where the
// same wizard has the watch button for Chronal Shift.
const SHIFT_TITLE = "Turning Hour";
const CHRONAL_WATCH_TITLE = "Clockwork Watch";
const shiftTables = {};
const chronalWatchTables = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const encounterRows = await import("../../src/lib/db/encounters.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(player.id, {
      title: `${SHIFT_TITLE} (${viewport})`,
      description: "A gate, a fighter, and a wizard who can turn the moment back.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 5,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    const seated = campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(table.id).inviteCode);
    if ("error" in seated) {
      throw new Error(`could not seat the lead at the turning hour: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const wizard = sheets.createSheet(table.id, world.owner.id, 5, heroInput({ name: "Ilse Marrow", class: "wizard", subclass: "Chronurgy Magic", level: 5 }));
    const ally = sheets.createSheet(table.id, player.id, 5, heroInput({ name: "Bran Ostler", class: "fighter", level: 5 }));
    shiftTables[viewport] = { id: table.id, wizard: wizard.id, ally: ally.id };

    const fight = campaigns.createCampaign(player.id, {
      title: `${CHRONAL_WATCH_TITLE} (${viewport})`,
      description: "A goblin, and a wizard who can turn the moment back.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 5,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "steered" },
    });
    const joined = campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(fight.id).inviteCode);
    if ("error" in joined) {
      throw new Error(`could not seat the lead at the clockwork watch: ${joined.error}`);
    }
    campaigns.setCampaignStatus(fight.id, "active");
    const watcher = sheets.createSheet(fight.id, world.owner.id, 5, heroInput({ name: "Ilse Marrow", class: "wizard", subclass: "Chronurgy Magic", level: 5 }));
    const started = await invokeEngine(campaigns.getCampaignById(fight.id), { kind: "human", userId: player.id }, {
      name: "start_encounter",
      args: { enemies: [{ monster: "goblin", count: 1 }] },
    });
    if (!started.ok) {
      throw new Error(`the clockwork watch fight did not start: ${started.error}`);
    }
    const encounter = encounterRows.getActiveEncounter(fight.id);
    encounterRows.saveEncounter({ ...encounter, orderReady: true, round: Math.max(1, encounter.round), legendary: { ...encounter.legendary, due: [] } });
    chronalWatchTables[viewport] = { id: fight.id, hero: watcher.id };
  }
}

// One account holding both the roller and the wizard who may answer the roll
// (play-test 2026-11-09, W-08): the lead plays a fighter and a Chronurgy
// wizard at a table the player runs, so a check of the fighter's that fails
// waits on the lead's own screen twice over, as the roller and as the helper.
const TWO_HANDS_TITLE = "Two Hands";
const twoHandsTables = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(player.id, {
    title: `${TWO_HANDS_TITLE} (${viewport})`,
    description: "A gate, and one player at two seats.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 5,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false, dmMode: "human" },
  });
  const seated = campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(table.id).inviteCode);
  if ("error" in seated) {
    throw new Error(`could not seat the lead at two hands: ${seated.error}`);
  }
  campaigns.setCampaignStatus(table.id, "active");
  const roller = sheets.createSheet(table.id, world.owner.id, 5, heroInput({ name: "Wren Ashby", class: "fighter", level: 5 }));
  const wizard = sheets.createSheet(table.id, world.owner.id, 5, heroInput({ name: "Ilse Marrow", class: "wizard", subclass: "Chronurgy Magic", level: 5 }));
  twoHandsTables[viewport] = { id: table.id, roller: roller.id, wizard: wizard.id };
}

// The damage roll card on real dice (play-test 2026-11-07, B5): a table the
// player runs, at real_allowed, in a fight with one goblin beside the lead's
// fighter, whose Piercer and Savage Attacker change the damage dice. It is
// her turn; she turns real dice on once the order is rolled. She is a
// halfling, so her attack card asks for one d20 and says Lucky's reroll.
const DAMAGE_STEPS_TITLE = "Quarry Table";
const damageStepTables = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const { dice, clearDice } = await import("../lib/enforce-world.mjs");
  const maps = await import("../../src/lib/db/battle-maps.ts");
  const encounterRows = await import("../../src/lib/db/encounters.ts");
  const { initiativeFloorFor } = await import("../../src/lib/dm/encounter-tools.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(player.id, {
      title: `${DAMAGE_STEPS_TITLE} (${viewport})`,
      description: "Raiders at the old quarry.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 5,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human", dicePolicy: "real_allowed" },
    });
    const seated = campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(table.id).inviteCode);
    if ("error" in seated) {
      throw new Error(`could not seat the lead at the quarry table: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const hero = sheets.createSheet(table.id, world.owner.id, 5, heroInput({
      name: "Kestra Holm", race: "halfling", class: "fighter", level: 5, maxHp: 44, abilities: { str: 12, dex: 16 },
      feats: ["Piercer", "Savage Attacker"], equipment: [{ name: "Rapier", qty: 1, equipped: true }],
      features: [{ name: "Lucky (reroll nat 1 on d20)", source: "race" }],
    }));
    // The goblin's die, then the hero's: the hero acts first.
    clearDice();
    dice(1, 20);
    const started = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: player.id }, {
      name: "start_encounter",
      args: { enemies: [{ monster: "goblin", count: 1 }] },
    });
    clearDice();
    if (!started.ok) {
      throw new Error(`the quarry table's fight did not start: ${started.error}`);
    }
    const encounter = encounterRows.getActiveEncounter(table.id);
    const board = maps.getBattleMapForEncounter(encounter.id);
    maps.setBattleMapTerrain(board.id, ".".repeat(board.width * board.height));
    getDatabase().prepare("UPDATE battle_maps SET doors_json = '{}' WHERE id = ?").run(board.id);
    const [goblin] = encounterRows.listEnemies(encounter.id);
    for (const token of maps.listTokens(board.id)) {
      maps.moveToken(token.id, token.refId === hero.id ? 5 : 6, 5, 0);
    }
    const index = encounter.order.findIndex((entry) => entry.characterId === hero.id);
    encounterRows.saveEncounter({ ...encounter, orderReady: true, turnIndex: Math.max(0, index), turnBudget: null, surprisedIds: [], reactionsUsed: [] });
    campaigns.setFloor(table.id, initiativeFloorFor(table.id) ?? { mode: "open" });
    campaigns.setMemberRealDice(table.id, world.owner.id, true);
    damageStepTables[viewport] = { id: table.id, hero: hero.id, goblin: goblin.id };
  }
}

// Healing dice on real dice (issue 902): a table the player runs, at
// real_allowed, where the lead's fighter is hurt and rolls physical dice. The
// GM's seat plays her Second Wind, and the d10 is hers to roll.
const HEALING_DICE_TITLE = "Infirmary Table";
const healingDiceTables = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(player.id, {
    title: `${HEALING_DICE_TITLE} (${viewport})`,
    description: "A long road and a short breath.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 3,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false, dmMode: "human", dicePolicy: "real_allowed" },
  });
  const seated = campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(table.id).inviteCode);
  if ("error" in seated) {
    throw new Error(`could not seat the lead at the infirmary table: ${seated.error}`);
  }
  campaigns.setCampaignStatus(table.id, "active");
  const hero = sheets.createSheet(table.id, world.owner.id, 3, heroInput({ name: "Maren Vost", class: "fighter", level: 3, maxHp: 28, abilities: { str: 16, con: 14 } }));
  sheets.patchSheet(hero.id, { currentHp: 6 });
  campaigns.setMemberRealDice(table.id, world.owner.id, true);
  healingDiceTables[viewport] = { id: table.id, hero: hero.id };
}

// Hit dice on real dice (issue 902): the same kind of table just after a
// short rest, with the lead's hurt fighter still choosing her hit dice and a
// bard in the party, so the first die she spends carries the song's d6.
const HIT_DICE_TITLE = "Rest Stop Table";
const hitDiceTables = {};
{
  const { openShortRestWindow } = await import("../../src/lib/db/clock.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(player.id, {
      title: `${HIT_DICE_TITLE} (${viewport})`,
      description: "An hour by the road, and a song.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human", dicePolicy: "real_allowed" },
    });
    const seated = campaigns.joinByInviteCode(world.owner.id, campaigns.getCampaignById(table.id).inviteCode);
    if ("error" in seated) {
      throw new Error(`could not seat the lead at the rest stop table: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const hero = sheets.createSheet(table.id, world.owner.id, 3, heroInput({ name: "Maren Vost", class: "fighter", level: 3, maxHp: 28, abilities: { str: 16, con: 14 } }));
    sheets.patchSheet(hero.id, { currentHp: 6 });
    sheets.createSheet(table.id, player.id, 2, heroInput({ name: "Lira Quill", class: "bard", level: 2, maxHp: 15, abilities: { cha: 16 } }));
    campaigns.setMemberRealDice(table.id, world.owner.id, true);
    openShortRestWindow(table.id, [hero.id]);
    hitDiceTables[viewport] = { id: table.id, hero: hero.id };
  }
}

// Issue 530: a running campaign the lead steers, one per viewport, to step
// out of play to its prep and back without ending anything.
const PREP_RETURN_TITLE = "Waystation Table";
const prepReturn = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(world.owner.id, {
    title: `${PREP_RETURN_TITLE} (${viewport})`,
    description: "A campaign between sessions.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 3,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false },
  });
  const seated = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
  if ("error" in seated) {
    throw new Error(`could not seat the player at ${PREP_RETURN_TITLE}: ${seated.error}`);
  }
  campaigns.setCampaignStatus(table.id, "active");
  sheets.createSheet(table.id, world.owner.id, 3, heroInput({ name: "Odile Fenwick", class: "fighter", level: 3 }));
  sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Ansel Fenwick", class: "rogue", level: 3 }));
  messages.insertCampaignMessage({
    campaignId: table.id,
    seq: campaigns.allocateSeq(table.id),
    authorType: "dm",
    speech: [],
    content: "The waystation's fire burns low. The road north waits for morning.",
  });
  prepReturn[viewport] = table.id;
}

// Issue 668: the "Previously" recap that opens a session took the faint
// italic of a system line. A table that has just been given one, under the
// passage it follows, one per viewport, so the scenario reads the card.
const RECAP_TITLE = "Recap Table";
const recapTables = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(world.owner.id, {
    title: `${RECAP_TITLE} (${viewport})`,
    description: "A table back after a week away.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 3,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false },
  });
  const seated = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
  if ("error" in seated) {
    throw new Error(`could not seat the player at ${RECAP_TITLE}: ${seated.error}`);
  }
  campaigns.setCampaignStatus(table.id, "active");
  sheets.createSheet(table.id, world.owner.id, 3, heroInput({ name: "Corra Venn", class: "fighter", level: 3 }));
  sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Ilse Marsh", class: "rogue", level: 3 }));
  messages.insertCampaignMessage({
    campaignId: table.id,
    seq: campaigns.allocateSeq(table.id),
    authorType: "dm",
    speech: [],
    content: "The mill wheel turns in the dark, and nobody answers at the miller's door.",
  });
  messages.insertCampaignMessage({
    campaignId: table.id,
    seq: campaigns.allocateSeq(table.id),
    authorType: "system",
    glyph: "cue-bell",
    content: "Previously: You reached the mill at dusk, found the miller's daughter gone, and followed her lantern's tracks to the edge of the fen.",
  });
  recapTables[viewport] = table.id;
}

// Issue 917: a line a short tag splits ("...," she says. "...") was drawn
// as two cards for one speaker with the tag stranded between. A passage
// with both kinds of split and a reply from someone else, its lines stored
// as the claims reader stores them, one table per viewport.
const SPLIT_LINE_TITLE = "Split Line Table";
const splitLineTables = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(world.owner.id, {
    title: `${SPLIT_LINE_TITLE} (${viewport})`,
    description: "A table at the crossroads.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 3,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false },
  });
  campaigns.setCampaignStatus(table.id, "active");
  sheets.createSheet(table.id, world.owner.id, 3, heroInput({ name: "Corra Venn", class: "fighter", level: 3 }));
  const marla = { kind: "npc", id: "npc-split-marla", name: "Marla" };
  const pike = { kind: "npc", id: "npc-split-pike", name: "Old Pike" };
  messages.insertCampaignMessage({
    campaignId: table.id,
    seq: campaigns.allocateSeq(table.id),
    authorType: "dm",
    speech: [
      { line: "We ride at dawn,", speaker: marla },
      { line: "and not a moment later.", speaker: marla },
      { line: "Aye,", speaker: pike },
      { line: "Two roads,", speaker: marla },
      { line: "Pick one.", speaker: marla },
    ],
    content:
      'Marla rolls the map flat on the crate. "We ride at dawn," said Marla, "and not a moment later." "Aye," says Old Pike, and spits into the fire.' +
      '\n\nShe taps the fork in the road. "Two roads," she says. "Pick one."',
  });
  splitLineTables[viewport] = table.id;
}

// Issue 539: a table outside a fight, narration on, with two passages to
// read aloud one after the other (scenario narration-replay).
const REPLAY_TITLE = "Replay Table";
const replayTable = campaigns.createCampaign(world.owner.id, {
  title: REPLAY_TITLE,
  description: "Two passages to hear, one after the other.",
  theme: "high-fantasy",
  maxPlayers: 4,
  startingLevel: 3,
  difficulty: "normal",
  gameSettings: { ttsEnabled: true },
});
campaigns.setCampaignStatus(replayTable.id, "active");
sheets.createSheet(replayTable.id, world.owner.id, 3, heroInput({ name: "Maren Holt", class: "bard", level: 3 }));
for (const content of [
  "Fog lifts off the millpond. A heron stands in the reeds and watches the road.",
  "Bells ring from the abbey on the hill. The gate below swings open for the carts.",
]) {
  messages.insertCampaignMessage({ campaignId: replayTable.id, seq: campaigns.allocateSeq(replayTable.id), authorType: "dm", speech: [], content });
}

// Audit 2026-10-26: a lobby with voice and transcription on, the player
// seated beside the lead, for the microphone checks (scenario voice-mic).
const VOICE_TITLE = "Voice Table";
const voiceTable = campaigns.createCampaign(world.owner.id, {
  title: VOICE_TITLE,
  description: "A table that talks before it plays.",
  theme: "high-fantasy",
  maxPlayers: 4,
  startingLevel: 1,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false, voice: { enabled: true, transcribe: true } },
});
campaigns.joinByInviteCode(player.id, voiceTable.inviteCode);

// Audit 2026-10-26 K01: a quiet table whose music, takes and stings are
// heard one after another (scenario ambience-takes).
const SOUND_TITLE = "Sound Table";
const soundTable = campaigns.createCampaign(world.owner.id, {
  title: SOUND_TITLE,
  description: "Music that changes with the scene.",
  theme: "high-fantasy",
  maxPlayers: 4,
  startingLevel: 3,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false },
});
campaigns.setCampaignStatus(soundTable.id, "active");
sheets.createSheet(soundTable.id, world.owner.id, 3, heroInput({ name: "Ilsa Venn", class: "bard", level: 3 }));
messages.insertCampaignMessage({
  campaignId: soundTable.id,
  seq: campaigns.allocateSeq(soundTable.id),
  authorType: "dm",
  speech: [],
  content: "Rain taps on the shutters. Somewhere below, a fiddler starts a slow tune.",
});

// Backlog F9: two lobbies at level 5 for the multiclass build (scenario
// builder-multiclass), one that allows a second class and one that turns
// multiclassing off. The lead builds a hero at each; the scenario gives up
// the seat again.
const multiclassTable = campaigns.createCampaign(world.owner.id, {
  title: "Two Paths",
  description: "A level 5 table where a hero may split their levels.",
  theme: "high-fantasy",
  maxPlayers: 4,
  startingLevel: 5,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false },
});
const singleClassTable = campaigns.createCampaign(world.owner.id, {
  title: "One Path",
  description: "A level 5 table that turns multiclassing off.",
  theme: "high-fantasy",
  maxPlayers: 4,
  startingLevel: 5,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false, multiclassingEnabled: false },
});

// A table that meets weekly (the session-hold scenario, issue 586): the lead
// ends tonight's session from the header, every seat waits between sessions
// with the next date and its RSVP in a banner, and the lead starts the next
// one where play stopped. One per viewport so each run starts in play.
const weekly = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(world.owner.id, {
    title: `The Weekly Road (${viewport})`,
    description: "A caravan road the party travels one evening a week.",
    theme: "high-fantasy",
    maxPlayers: 4,
    startingLevel: 2,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false },
  });
  const joinedWeekly = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
  if ("error" in joinedWeekly) {
    throw new Error(`could not seat the player at the weekly table: ${joinedWeekly.error}`);
  }
  campaigns.setCampaignStatus(table.id, "active");
  sheets.createSheet(table.id, world.owner.id, 2, heroInput({ name: "Wren Ashby", class: "ranger", level: 2 }));
  const rider = sheets.createSheet(table.id, player.id, 2, heroInput({ name: "Tamsin Holt", class: "fighter", level: 2 }));
  messages.insertCampaignMessage({
    campaignId: table.id,
    seq: campaigns.allocateSeq(table.id),
    authorType: "dm",
    speech: [],
    content: "The caravan stops at the toll bridge as the sun goes down. The bridge-warden wants a word.",
  });
  weekly[viewport] = { id: table.id, title: `The Weekly Road (${viewport})`, rider: rider.id };
}

// A table that plays one character each, in play, where the lead's level 4
// hero has died (the fallen-hero scenario): the lead keeps the table and is
// offered a new hero at level 4 while the other player's hero plays on. One
// per viewport, since seating the replacement ends the state it checks.
const fallenTables = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(world.owner.id, {
    title: `The Fallen Watch (${viewport})`,
    description: "A barrow road at dusk, one of the party already lost to it.",
    theme: "high-fantasy",
    maxPlayers: 4,
    startingLevel: 1,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false, multiCharacter: "off" },
  });
  const joinedFallen = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
  if ("error" in joinedFallen) {
    throw new Error(`could not seat the player at the fallen table: ${joinedFallen.error}`);
  }
  campaigns.setCampaignStatus(table.id, "active");
  const fallen = sheets.createSheet(table.id, world.owner.id, 4, heroInput({ name: "Ilsa Marr", class: "rogue", level: 4 }));
  sheets.patchSheet(fallen.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  sheets.createSheet(table.id, player.id, 4, heroInput({ name: "Oren Dusk", class: "fighter", level: 4 }));
  messages.insertCampaignMessage({
    campaignId: table.id,
    seq: campaigns.allocateSeq(table.id),
    authorType: "dm",
    speech: [],
    content: "Ilsa falls on the barrow road, and the wights fall back into the dark. Oren kneels beside her.",
  });
  fallenTables[viewport] = table.id;
}

// Issue #622: a hero lies dying outside a fight at a person's table. The GM
// passes time from the console, the clock rolls the hero's death saves, and
// the event log reverts the turn with its hours. One per viewport, since the
// scenario reverts turns on it.
const clockTables = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(world.owner.id, {
    title: `Clock Table (${viewport})`,
    description: "A hero bleeding out on the moor road while the night wears on.",
    theme: "high-fantasy",
    maxPlayers: 4,
    startingLevel: 3,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false, dmMode: "human" },
  });
  // Seated in the lobby: a table in play turns a newcomer away.
  const seated = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
  if ("error" in seated) {
    throw new Error(`could not seat the player at the clock table: ${seated.error}`);
  }
  campaigns.setCampaignStatus(table.id, "active");
  const hero = sheets.createSheet(table.id, player.id, 3, heroInput({ name: "Corra Venn", class: "fighter", level: 3 }));
  sheets.patchSheet(hero.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  clockTables[viewport] = { id: table.id, hero: hero.id, heroName: hero.name };
}

// Issue 685, gap 4: a table the lead runs as its GM, in a fight on the
// player's wizard's turn, so her Web card waits in the console's "Waiting on
// you" list and the GM resolves it as played. One per viewport, since the
// card is answered once.
const RESOLVE_TITLE = "Resolve Table";
const resolveTables = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const maps = await import("../../src/lib/db/battle-maps.ts");
  const encounterRows = await import("../../src/lib/db/encounters.ts");
  const { initiativeFloorFor } = await import("../../src/lib/dm/encounter-tools.ts");
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `${RESOLVE_TITLE} (${viewport})`,
      description: "A goblin in a lane and a wizard with a web to spin.",
      theme: "high-fantasy",
      maxPlayers: 4,
      startingLevel: 5,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    const seated = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(table.id).inviteCode);
    if ("error" in seated) {
      throw new Error(`could not seat the player at the resolve table: ${seated.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    const iris = sheets.createSheet(
      table.id,
      player.id,
      5,
      heroInput({
        name: "Iris Vane",
        class: "wizard",
        level: 5,
        maxHp: 27,
        abilities: { int: 16, dex: 14 },
        equipment: [{ name: "Dagger", qty: 1 }, { name: "Component pouch", qty: 1 }],
        spellcasting: {
          ability: "int",
          slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } },
          known: [],
          prepared: ["Web"],
          cantrips: [],
          spellbook: ["Web"],
        },
      }),
    );
    const started = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: world.owner.id }, {
      name: "start_encounter",
      args: { enemies: [{ monster: "goblin", count: 1 }] },
    });
    if (!started.ok) {
      throw new Error(`the resolve table's fight did not start: ${started.error}`);
    }
    const encounter = encounterRows.getActiveEncounter(table.id);
    const board = maps.getBattleMapForEncounter(encounter.id);
    maps.setBattleMapTerrain(board.id, ".".repeat(board.width * board.height));
    getDatabase().prepare("UPDATE battle_maps SET doors_json = '{}' WHERE id = ?").run(board.id);
    // Iris at (2,6), the goblin at (10,6): the web goes on (5,4), in range
    // and on nobody (the scenario's card names that square).
    for (const token of maps.listTokens(board.id)) {
      maps.moveToken(token.id, token.refId === iris.id ? 2 : 10, 6, 0);
    }
    const place = encounter.order.findIndex((entry) => entry.characterId === iris.id);
    if (place < 0) {
      throw new Error("the resolve table's wizard has no place in the order");
    }
    encounterRows.saveEncounter({
      ...encounter,
      orderReady: true,
      round: Math.max(1, encounter.round),
      turnIndex: place,
      turnBudget: null,
      legendary: { ...encounter.legendary, due: [] },
    });
    campaigns.setFloor(table.id, initiativeFloorFor(table.id) ?? { mode: "open" });
    resolveTables[viewport] = { id: table.id, iris: iris.id };
  }
}

// A fighter's Ring of Spell Storing in the Hand (scenario 122-ring-cards): a table
// the lead runs and plays at, so a card resolves as it is played, in a fight on
// the fighter's turn with two goblins beside them. One per viewport: the spells go.
const ringTables = {};
// Spells magic items cast, in the Hand (scenario 123-item-cards): a fighter with a
// wand and a scroll they cannot read, and a wizard with a staff, a wand and a scroll.
const itemTables = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const maps = await import("../../src/lib/db/battle-maps.ts");
  const encounterRows = await import("../../src/lib/db/encounters.ts");
  const { initiativeFloorFor } = await import("../../src/lib/dm/encounter-tools.ts");
  // Two goblins beside the hero, on the hero's turn: a person's table shows the
  // Hand only in a fight, and Hold Person can take one and leave one to swing.
  const ringFight = async (campaignId, heroId) => {
    const started = await invokeEngine(campaigns.getCampaignById(campaignId), { kind: "human", userId: world.owner.id }, {
      name: "start_encounter",
      args: { enemies: [{ monster: "goblin", count: 2 }] },
    });
    if (!started.ok) {
      throw new Error(`the ring table's fight did not start: ${started.error}`);
    }
    const encounter = encounterRows.getActiveEncounter(campaignId);
    const board = maps.getBattleMapForEncounter(encounter.id);
    maps.setBattleMapTerrain(board.id, ".".repeat(board.width * board.height));
    getDatabase().prepare("UPDATE battle_maps SET doors_json = '{}' WHERE id = ?").run(board.id);
    let rank = 0;
    for (const token of maps.listTokens(board.id)) {
      if (token.refId === heroId) maps.moveToken(token.id, 5, 6, 0);
      else maps.moveToken(token.id, 6, 5 + rank++, 0);
    }
    const place = encounter.order.findIndex((entry) => entry.characterId === heroId);
    if (place < 0) {
      throw new Error("the ring table's hero has no place in the order");
    }
    encounterRows.saveEncounter({
      ...encounter,
      orderReady: true,
      round: Math.max(1, encounter.round),
      turnIndex: place,
      turnBudget: null,
      legendary: { ...encounter.legendary, due: [] },
    });
    campaigns.setFloor(campaignId, initiativeFloorFor(campaignId) ?? { mode: "open" });
  };
  for (const viewport of ["desktop", "phone"]) {
    const table = campaigns.createCampaign(world.owner.id, {
      title: `Ring Table (${viewport})`,
      description: "Goblins in a lane and a ring that holds three spells.",
      theme: "high-fantasy",
      maxPlayers: 4,
      startingLevel: 5,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    campaigns.setCampaignStatus(table.id, "active");
    const hero = sheets.createSheet(
      table.id,
      world.owner.id,
      5,
      heroInput({
        name: "Corin Ashvale",
        class: "fighter",
        level: 5,
        maxHp: 44,
        equipment: [
          { name: "Longsword", qty: 1, equipped: true },
          {
            name: "Ring of Spell Storing",
            qty: 1,
            equipped: true,
            attuned: true,
            storedSpells: [
              { spell: "Knock", level: 2, saveDc: 15, attackBonus: 7, by: "Iris" },
              { spell: "Hold Person", level: 2, saveDc: 15, attackBonus: 7, by: "Iris" },
              { spell: "Shield", level: 1, saveDc: 15, attackBonus: 7, by: "Iris" },
            ],
          },
        ],
      }),
    );
    await ringFight(table.id, hero.id);
    // A wizard whose own spells fold Spells and whose gear folds
    // Items, so the ring's cards are under both.
    const study = campaigns.createCampaign(world.owner.id, {
      title: `Ring Study (${viewport})`,
      description: "A wizard's study and a ring on the desk.",
      theme: "high-fantasy",
      maxPlayers: 4,
      startingLevel: 5,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    campaigns.setCampaignStatus(study.id, "active");
    const wizardHero = sheets.createSheet(
      study.id,
      world.owner.id,
      5,
      heroInput({
        name: "Maren Oake",
        class: "wizard",
        level: 5,
        abilities: { int: 16 },
        equipment: [
          { name: "Dagger", qty: 1, equipped: true },
          { name: "Ring of Spell Storing", qty: 1, equipped: true, attuned: true, storedSpells: [{ spell: "Knock", level: 2, saveDc: 15, attackBonus: 7 }, { spell: "Hold Person", level: 2, saveDc: 15, attackBonus: 7 }] },
        ],
        spellcasting: {
          ability: "int",
          slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } },
          known: [],
          prepared: ["Shield", "Sleep", "Magic Missile", "Mage Armor"],
          cantrips: [],
          spellbook: ["Shield", "Sleep", "Magic Missile", "Mage Armor"],
        },
      }),
    );
    await ringFight(study.id, wizardHero.id);
    ringTables[viewport] = { id: table.id, hero: hero.id, study: study.id };

    const itemTable = campaigns.createCampaign(world.owner.id, {
      title: `Item Table (${viewport})`,
      description: "Goblins in a lane, a borrowed wand and a scroll in a script nobody here reads.",
      theme: "high-fantasy",
      maxPlayers: 4,
      startingLevel: 5,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    campaigns.setCampaignStatus(itemTable.id, "active");
    const scrollRow = (spell) => ({ name: `Spell Scroll (${spell})`, qty: 1, tags: ["consumable", "scroll", "carried"], spell });
    const itemHero = sheets.createSheet(
      itemTable.id,
      world.owner.id,
      5,
      heroInput({
        name: "Dov Harrow",
        class: "fighter",
        level: 5,
        maxHp: 44,
        equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Wand of Magic Missiles", qty: 1, charges: 5 }, scrollRow("Magic Missile")],
      }),
    );
    await ringFight(itemTable.id, itemHero.id);
    const itemStudy = campaigns.createCampaign(world.owner.id, {
      title: `Item Study (${viewport})`,
      description: "A wizard with a staff, a wand and one scroll left.",
      theme: "high-fantasy",
      maxPlayers: 4,
      startingLevel: 5,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human" },
    });
    campaigns.setCampaignStatus(itemStudy.id, "active");
    const itemMage = sheets.createSheet(
      itemStudy.id,
      world.owner.id,
      5,
      heroInput({
        name: "Sera Vane",
        class: "wizard",
        level: 5,
        abilities: { int: 16 },
        equipment: [
          { name: "Dagger", qty: 1, equipped: true },
          { name: "Staff of Fire", qty: 1, equipped: true, attuned: true, charges: 7 },
          { name: "Wand of Magic Missiles", qty: 1, charges: 3 },
          scrollRow("Magic Missile"),
        ],
        spellcasting: {
          ability: "int",
          slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } },
          known: [],
          prepared: ["Shield", "Sleep", "Thunderwave", "Mage Armor"],
          cantrips: [],
          spellbook: ["Shield", "Sleep", "Thunderwave", "Mage Armor"],
        },
      }),
    );
    await ringFight(itemStudy.id, itemMage.id);
    itemTables[viewport] = { id: itemTable.id, hero: itemHero.id, study: itemStudy.id, mage: itemMage.id };
  }
}

// Issue 685, round 2 (scenario 115-fight-bench-2): a table per moment, one
// per viewport, since each step plays on its own. At the first four the
// player runs the table and the lead plays (the page is the lead's, on the
// website and in the app); at the rest the lead runs it.
const bench2 = {};
const bench2Titles = {};
{
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const maps = await import("../../src/lib/db/battle-maps.ts");
  const encounterRows = await import("../../src/lib/db/encounters.ts");
  const { initiativeFloorFor } = await import("../../src/lib/dm/encounter-tools.ts");
  const { createDmTurn } = await import("../../src/lib/db/dm-turns.ts");
  const { createCompanionUser } = await import("../../src/lib/db/users.ts");
  const { dice, clearDice } = await import("../lib/enforce-world.mjs");
  const slots = () => ({ 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } });
  const tableFor = (title, gm, seated, gameSettings = {}) => {
    const table = campaigns.createCampaign(gm.id, {
      title,
      description: "A bench for the fight's newer controls.",
      theme: "high-fantasy",
      maxPlayers: 6,
      startingLevel: 5,
      difficulty: "normal",
      gameSettings: { ttsEnabled: false, dmMode: "human", ...gameSettings },
    });
    const joined = campaigns.joinByInviteCode(seated.id, campaigns.getCampaignById(table.id).inviteCode);
    if ("error" in joined) {
      throw new Error(`could not seat a player at ${title}: ${joined.error}`);
    }
    campaigns.setCampaignStatus(table.id, "active");
    bench2Titles[table.id] = title;
    return table;
  };
  // A fight on an open board, every token placed by `spots` (refId to its
  // square); the rest in a row along the bottom.
  const fightAt = async (table, gm, enemies, extra = {}) => {
    const started = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: gm.id }, { name: "start_encounter", args: { enemies, ...extra } });
    if (!started.ok) {
      throw new Error(`${campaigns.getCampaignById(table.id).title}'s fight did not start: ${started.error}`);
    }
    await keepOpeningRolls(table.id);
    const encounter = encounterRows.getActiveEncounter(table.id);
    const board = maps.getBattleMapForEncounter(encounter.id);
    maps.setBattleMapTerrain(board.id, ".".repeat(board.width * board.height));
    getDatabase().prepare("UPDATE battle_maps SET doors_json = '{}' WHERE id = ?").run(board.id);
    const [cx, cy] = [Math.floor(board.width / 2), Math.floor(board.height / 2)];
    maps.listTokens(board.id).forEach((token, index) => maps.moveToken(token.id, 1 + index, board.height - 2, 0));
    const place = (refId, dx, dy) => maps.moveToken(maps.getTokenByRef(board.id, refId).id, cx + dx, cy + dy, 0);
    return { encounter, board, rows: encounterRows.listEnemies(encounter.id), place };
  };
  const named = (rows, slug, index = 0) => rows.filter((enemy) => enemy.slug === slug)[index] ?? (() => { throw new Error(`no ${slug} ${index + 1} in the fight`); })();
  // The pointer on `refId`'s turn, the order in, nothing spent this turn.
  const turnOf = (table, refId, patch = {}) => {
    const encounter = encounterRows.getActiveEncounter(table.id);
    const index = encounter.order.findIndex((entry) => (entry.characterId ?? entry.enemyId) === refId);
    if (index < 0) {
      throw new Error(`${refId} has no place in the order`);
    }
    encounterRows.saveEncounter({
      ...encounter,
      orderReady: true,
      round: Math.max(2, encounter.round),
      turnIndex: index,
      turnBudget: null,
      surprisedIds: [],
      reactionsUsed: [],
      ...patch,
      legendary: { ...encounter.legendary, due: [], ...(patch.legendary ?? {}) },
    });
    campaigns.setFloor(table.id, initiativeFloorFor(table.id) ?? { mode: "open" });
  };
  // The goblins' pass as one GM turn, each handed its turn (legendary.due,
  // as end_turn hands them to the AI): each swing lands (the d20's face,
  // then the damage die's), so every hit stays open for a reaction.
  const pass = async (table, swings) => {
    const turn = createDmTurn(table.id, [], "ai");
    for (const [enemyId, targetId, faces, attack] of swings) {
      dice(...faces);
      const out = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "ai", turnId: turn.id }, { name: "enemy_attack", args: { enemyId, targetCharacterId: targetId, ...(attack ? { attack } : {}) } });
      clearDice();
      if (!out.ok) {
        throw new Error(`a goblin's swing at ${table.title} failed: ${out.error}`);
      }
    }
  };
  // The lead's two heroes: Ada, a wizard with Shield, and Bram, a rogue with
  // Uncanny Dodge, both fielded at once.
  const pair = (table) => [
    sheets.createSheet(table.id, world.owner.id, 5, heroInput({
      name: "Ada Quill", class: "wizard", level: 5, maxHp: 30, abilities: { int: 16, dex: 14 },
      spellcasting: { ability: "int", slots: slots(), known: [], prepared: ["Shield"], cantrips: [], spellbook: ["Shield"] },
    })),
    sheets.createSheet(table.id, world.owner.id, 5, heroInput({
      name: "Bram Tallow", class: "rogue", level: 5, maxHp: 30, abilities: { dex: 16 },
      features: [{ name: "Uncanny Dodge", source: "class" }],
    })),
  ];
  for (const viewport of ["desktop", "phone"]) {
    const at = {};
    // ---- 1 and 3: Speaking as, and a companion's reaction card ----
    {
      const table = tableFor(`Reaction Table (${viewport})`, player, world.owner, { multiCharacter: "all_active", companions: "full" });
      const [ada, bram] = pair(table);
      const bot = createCompanionUser("Pip Quickfoot");
      const pip = sheets.createSheet(table.id, bot.id, 5, heroInput({
        name: "Pip Quickfoot", class: "rogue", level: 5, maxHp: 30, abilities: { dex: 16 },
        features: [{ name: "Uncanny Dodge", source: "class" }],
      }));
      sheets.markSheetAsCompanion(pip.id, "party", "Quick, cheerful, and never far from a joke.");
      sheets.setCompanionCommander(pip.id, world.owner.id);
      const { rows, place } = await fightAt(table, player, [{ monster: "goblin", count: 2 }]);
      const [g1, g2] = [named(rows, "goblin", 0), named(rows, "goblin", 1)];
      [[ada.id, -4, 0], [bram.id, 0, 0], [g1.id, 1, 0], [pip.id, 4, 0], [g2.id, 5, 0]].forEach(([refId, dx, dy]) => place(refId, dx, dy));
      turnOf(table, g1.id, { legendary: { due: [g1.id, g2.id] } });
      await pass(table, [[g1.id, bram.id, [15, 3]], [g2.id, pip.id, [15, 3]]]);
      turnOf(table, ada.id);
      at.react = { id: table.id, ada: { id: ada.id, name: ada.name }, bram: { id: bram.id, name: bram.name }, pip: { id: pip.id, name: pip.name } };
    }
    // ---- 2: two hits on each hero, one GM turn ----
    {
      const table = tableFor(`Two Hits Table (${viewport})`, player, world.owner, { multiCharacter: "all_active" });
      const [ada, bram] = pair(table);
      const { rows, place } = await fightAt(table, player, [{ monster: "goblin", count: 4 }]);
      const goblins = [0, 1, 2, 3].map((index) => named(rows, "goblin", index));
      [[ada.id, -3, 0], [goblins[0].id, -2, 0], [goblins[1].id, -3, 1], [bram.id, 3, 0], [goblins[2].id, 4, 0], [goblins[3].id, 3, 1]].forEach(([refId, dx, dy]) => place(refId, dx, dy));
      turnOf(table, goblins[0].id, { legendary: { due: goblins.map((goblin) => goblin.id) } });
      // Ada's two hits are low (14 and 15 against her 12): the +5 of Shield
      // turns both. Bram's land at 19.
      await pass(table, [[goblins[0].id, ada.id, [10, 3]], [goblins[1].id, ada.id, [11, 2]], [goblins[2].id, bram.id, [15, 3]], [goblins[3].id, bram.id, [15, 4]]]);
      turnOf(table, ada.id);
      at.hits = { id: table.id, ada: { id: ada.id, name: ada.name }, bram: { id: bram.id, name: bram.name } };
    }
    // ---- 4: Conjure Animals on the Hand, the druid's turn ----
    {
      const table = tableFor(`Conjure Table (${viewport})`, player, world.owner);
      const fenn = sheets.createSheet(table.id, world.owner.id, 5, heroInput({
        name: "Fenn Alder", class: "druid", level: 5, maxHp: 34, abilities: { wis: 16 },
        equipment: [{ name: "Component pouch", qty: 1 }],
        spellcasting: { ability: "wis", slots: slots(), known: [], prepared: ["Conjure Animals"], cantrips: [] },
      }));
      const { rows, place } = await fightAt(table, player, [{ monster: "goblin", count: 1 }]);
      place(fenn.id, -3, 0);
      place(named(rows, "goblin").id, 4, 0);
      turnOf(table, fenn.id);
      at.conjure = { id: table.id, fenn: { id: fenn.id, name: fenn.name } };
    }
    // ---- 4: the sheet's summoning, out of a fight ----
    {
      const table = tableFor(`Familiar Table (${viewport})`, player, world.owner);
      const wren = sheets.createSheet(table.id, world.owner.id, 5, heroInput({
        name: "Wren Hollow", class: "wizard", level: 5, maxHp: 28, abilities: { int: 16 },
        // Gold for Find Familiar's 10 gp of charcoal, incense and herbs.
        gold: 50,
        equipment: [{ name: "Component pouch", qty: 1 }],
        spellcasting: { ability: "int", slots: slots(), known: [], prepared: ["Find Familiar", "Animate Dead"], cantrips: [], spellbook: ["Find Familiar", "Animate Dead"] },
      }));
      at.familiar = { id: table.id, wren: { id: wren.id, name: wren.name } };
    }
    // ---- 5: the GM console's summoning fields, out of a fight ----
    {
      const table = tableFor(`Console Table (${viewport})`, world.owner, player);
      const hale = sheets.createSheet(table.id, player.id, 5, heroInput({
        name: "Hale Brightwater", class: "paladin", level: 5, maxHp: 44, abilities: { str: 16, cha: 14 },
        spellcasting: { ability: "cha", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, known: [], prepared: ["Find Steed"], cantrips: [] },
      }));
      const corvin = sheets.createSheet(table.id, player.id, 5, heroInput({
        name: "Corvin Ashe", class: "wizard", level: 5, maxHp: 28, abilities: { int: 16 },
        equipment: [{ name: "Component pouch", qty: 1 }],
        spellcasting: { ability: "int", slots: slots(), known: [], prepared: ["Animate Dead"], cantrips: [], spellbook: ["Animate Dead"] },
      }));
      at.console = { id: table.id, hale: { id: hale.id, name: hale.name }, corvin: { id: corvin.id, name: corvin.name } };
    }
    // ---- 6: a gynosphinx at the end of Kara's turn, its lair due ----
    // Its Teleport asks for a square and its Cast a Spell for a spell from
    // its list: the aim bar's two pickers. Two heroes of 13th level, so the
    // fight is within what the table allows.
    {
      const table = tableFor(`Sphinx Table (${viewport})`, world.owner, player, { multiCharacter: "all_active" });
      const kara = sheets.createSheet(table.id, player.id, 13, heroInput({ name: "Kara Venn", class: "fighter", level: 13, maxHp: 120 }));
      const dorn = sheets.createSheet(table.id, player.id, 13, heroInput({ name: "Dorn Ashby", class: "cleric", level: 13, maxHp: 90 }));
      const { rows, place } = await fightAt(table, world.owner, [{ monster: "gynosphinx", count: 1 }], { lair: true });
      const sphinx = named(rows, "gynosphinx");
      [[kara.id, 0, 0], [dorn.id, -2, 1], [sphinx.id, 3, 0]].forEach(([refId, dx, dy]) => place(refId, dx, dy));
      // The pack's SRD creatures print no lair; the sphinx is given the one
      // the GM seat's suite gives its dragon (test-enforce-gm-seat.mjs).
      const stats = JSON.parse(getDatabase().prepare("SELECT stat_json FROM encounter_enemies WHERE id = ?").get(sphinx.id).stat_json);
      stats.traits = [
        ...(stats.traits ?? []),
        "Lair action: Magma erupts from a point on the ground. Each creature in the geyser's area must make a DC 15 Dexterity saving throw, taking 21 (6d6) fire damage on a failed save, or half as much damage on a successful one.",
        "Lair action: The ground shakes; each creature makes a DC 15 Dex save or falls prone.",
      ];
      getDatabase().prepare("UPDATE encounter_enemies SET stat_json = ? WHERE id = ?").run(JSON.stringify(stats), sphinx.id);
      const round = Math.max(2, encounterRows.getActiveEncounter(table.id).round);
      turnOf(table, kara.id, { round, legendary: { lair: true, lairDue: round, lairUsedRound: 0 } });
      at.sphinx = { id: table.id, kara: { id: kara.id, name: kara.name }, sphinx: { id: sphinx.id, name: sphinx.displayName } };
    }
    // ---- 7: a hero the other side dominates, on his turn ----
    {
      const table = tableFor(`Dominated Turn Table (${viewport})`, world.owner, player);
      const bran = sheets.createSheet(table.id, player.id, 9, heroInput({ name: "Bran Holt", class: "fighter", level: 9, maxHp: 80, equipment: [{ name: "Longsword", qty: 1, equipped: true }] }));
      const sela = sheets.createSheet(table.id, player.id, 9, heroInput({ name: "Sela Morrow", class: "cleric", level: 9, maxHp: 60 }));
      const { rows, place } = await fightAt(table, world.owner, [{ monster: "mage", count: 1 }]);
      const mage = named(rows, "mage");
      [[sela.id, -2, 0], [bran.id, 0, 0], [mage.id, 3, 0]].forEach(([refId, dx, dy]) => place(refId, dx, dy));
      sheets.patchSheet(bran.id, { conditions: ["charmed"], conditionMeta: { charmed: { spell: "Dominate Person", source: mage.id } } });
      turnOf(table, bran.id);
      at.dominated = { id: table.id, bran: { id: bran.id, name: bran.name }, sela: { id: sela.id, name: sela.name }, mage: { id: mage.id, name: mage.displayName } };
    }
    // ---- 8: a steered table, the AI playing the goblins ----
    {
      const table = tableFor(`Steered Table (${viewport})`, world.owner, player);
      campaigns.setDmMode(table.id, "steered", world.owner.id);
      const tess = sheets.createSheet(table.id, player.id, 5, heroInput({ name: "Tess Rowan", class: "fighter", level: 5, maxHp: 44 }));
      const { rows, place } = await fightAt(table, world.owner, [{ monster: "goblin", count: 1 }]);
      place(tess.id, -2, 0);
      place(named(rows, "goblin").id, 2, 0);
      turnOf(table, tess.id);
      at.steered = { id: table.id, tess: { id: tess.id, name: tess.name } };
    }
    // ---- 9: a fight for the event log's revert ----
    {
      const table = tableFor(`Revert Fight Table (${viewport})`, world.owner, player);
      const orla = sheets.createSheet(table.id, player.id, 5, heroInput({ name: "Orla Fenn", class: "fighter", level: 5, maxHp: 44 }));
      const { rows, place } = await fightAt(table, world.owner, [{ monster: "goblin", count: 1 }]);
      const goblin = named(rows, "goblin");
      place(orla.id, -2, 0);
      place(goblin.id, 2, 0);
      turnOf(table, orla.id);
      at.revert = { id: table.id, orla: { id: orla.id, name: orla.name }, goblin: goblin.id };
    }
    // ---- 11: a blow that drops a hero (#777): Necrotic Husk's card, open
    // to her at 0, beside the lead's other hero whose turn it is ----
    {
      const table = tableFor(`Fall Table (${viewport})`, player, world.owner, { multiCharacter: "all_active" });
      const corin = sheets.createSheet(table.id, world.owner.id, 10, heroInput({
        name: "Corin Ashe", class: "fighter", level: 10, maxHp: 60, equipment: [{ name: "Longsword", qty: 1, equipped: true }],
      }));
      const mara = sheets.createSheet(table.id, world.owner.id, 10, heroInput({ name: "Mara Thorn", class: "warlock", subclass: "The Undead", level: 10, maxHp: 40 }));
      const { rows, place } = await fightAt(table, player, [{ monster: "goblin", count: 1 }]);
      const goblin = named(rows, "goblin", 0);
      [[corin.id, -2, 0], [mara.id, 0, 0], [goblin.id, 1, 0]].forEach(([refId, dx, dy]) => place(refId, dx, dy));
      sheets.patchSheet(mara.id, { currentHp: 1 });
      turnOf(table, goblin.id, { legendary: { due: [goblin.id] } });
      await pass(table, [[goblin.id, mara.id, [15, 3]]]);
      if (sheets.getSheetById(mara.id).currentHp !== 0) {
        throw new Error("the Fall Table's goblin did not drop Mara");
      }
      turnOf(table, corin.id);
      at.fall = { id: table.id, corin: { id: corin.id, name: corin.name }, mara: { id: mara.id, name: mara.name } };
    }
    // ---- 10: a paladin's reaction for an ally hit, inside its reach and out ----
    // Glorious Defense covers a creature within 10 feet: Bran stands beside
    // Sela, Tam 25 feet off, and a goblin's hit is open on each.
    {
      const table = tableFor(`Paladin Reactions Table (${viewport})`, player, world.owner);
      const sela = sheets.createSheet(table.id, world.owner.id, 15, heroInput({
        name: "Sela Brightvow", class: "paladin", subclass: "Oath of Glory", level: 15, maxHp: 120, abilities: { str: 16, cha: 16 },
      }));
      const ally = (name) => {
        const bot = createCompanionUser(name);
        const sheet = sheets.createSheet(table.id, bot.id, 5, heroInput({ name, class: "fighter", level: 5, maxHp: 44 }));
        sheets.markSheetAsCompanion(sheet.id, "party", "Steady, and slow to speak.");
        return sheet;
      };
      const [near, far] = [ally("Bran Holt"), ally("Tam Reed")];
      const { rows, place } = await fightAt(table, player, [{ monster: "goblin", count: 2 }]);
      const [g1, g2] = [named(rows, "goblin", 0), named(rows, "goblin", 1)];
      [[sela.id, 0, 0], [near.id, 1, 0], [g1.id, 2, 0], [far.id, -5, 0], [g2.id, -6, 0]].forEach(([refId, dx, dy]) => place(refId, dx, dy));
      turnOf(table, g1.id, { legendary: { due: [g1.id, g2.id] } });
      await pass(table, [[g1.id, near.id, [15, 3]], [g2.id, far.id, [15, 3]]]);
      turnOf(table, sela.id);
      at.paladin = { id: table.id, sela: { id: sela.id, name: sela.name }, near: { id: near.id, name: near.name }, far: { id: far.id, name: far.name } };
    }
    // ---- 11: Shadow Martyr answers an ally's hit, not the fighter's own ----
    {
      const table = tableFor(`Echo Reactions Table (${viewport})`, player, world.owner);
      const knight = sheets.createSheet(table.id, world.owner.id, 15, heroInput({
        name: "Vesna Greymark", class: "fighter", subclass: "Echo Knight", level: 15, maxHp: 120, abilities: { str: 16, con: 14 },
      }));
      // Her echo is out, as Manifest Echo leaves it: Shadow Martyr sends the
      // echo into a hit only while one is (authored-effects-data-b.ts ECHO_OUT).
      sheets.patchSheet(knight.id, { conditions: ["echo manifested"] });
      const bot = createCompanionUser("Odo Fenn");
      const ally = sheets.createSheet(table.id, bot.id, 5, heroInput({ name: "Odo Fenn", class: "fighter", level: 5, maxHp: 44 }));
      sheets.markSheetAsCompanion(ally.id, "party", "Steady, and slow to speak.");
      const { rows, place } = await fightAt(table, player, [{ monster: "goblin", count: 2 }]);
      const [g1, g2] = [named(rows, "goblin", 0), named(rows, "goblin", 1)];
      [[knight.id, 0, 0], [g1.id, 1, 0], [ally.id, -2, 0], [g2.id, -3, 0]].forEach(([refId, dx, dy]) => place(refId, dx, dy));
      turnOf(table, g1.id, { legendary: { due: [g1.id, g2.id] } });
      await pass(table, [[g1.id, knight.id, [15, 3]], [g2.id, ally.id, [15, 3]]]);
      turnOf(table, knight.id);
      at.echo = { id: table.id, knight: { id: knight.id, name: knight.name }, ally: { id: ally.id, name: ally.name } };
    }
    // ---- 12: Reflexive Resistance answers the ranger's hit, not an ally's ----
    {
      const table = tableFor(`Drake Reactions Table (${viewport})`, player, world.owner);
      const ranger = sheets.createSheet(table.id, world.owner.id, 15, heroInput({
        name: "Ilse Marrow", class: "ranger", subclass: "Drakewarden", level: 15, maxHp: 120, abilities: { dex: 16, wis: 14 },
      }));
      const bot = createCompanionUser("Pell Arden");
      const ally = sheets.createSheet(table.id, bot.id, 5, heroInput({ name: "Pell Arden", class: "fighter", level: 5, maxHp: 44 }));
      sheets.markSheetAsCompanion(ally.id, "party", "Steady, and slow to speak.");
      const bonded = await invokeEngine(campaigns.getCampaignById(table.id), { kind: "human", userId: player.id }, { name: "summon_pet", args: { characterId: ranger.id, kind: "drake", form: "drake", essence: "fire" } });
      if (!bonded.ok) {
        throw new Error(`the drake did not come: ${bonded.error}`);
      }
      const { rows, place } = await fightAt(table, player, [{ monster: "goblin", count: 2 }]);
      const [g1, g2] = [named(rows, "goblin", 0), named(rows, "goblin", 1)];
      [[ranger.id, 0, 0], [g1.id, 1, 0], [ally.id, -2, 0], [g2.id, -3, 0]].forEach(([refId, dx, dy]) => place(refId, dx, dy));
      turnOf(table, g1.id, { legendary: { due: [g1.id, g2.id] } });
      await pass(table, [[g1.id, ranger.id, [15, 3]], [g2.id, ally.id, [15, 3]]]);
      turnOf(table, ranger.id);
      at.drake = { id: table.id, ranger: { id: ranger.id, name: ranger.name }, ally: { id: ally.id, name: ally.name } };
    }
    // ---- 13: Runic Shield for an ally hit, inside its reach and out ----
    // It covers a creature within 60 feet: Bran stands beside Runa, Tam 65 feet
    // off, and a goblin's hit is open on each.
    {
      const table = tableFor(`Runic Shield Table (${viewport})`, player, world.owner);
      const runa = sheets.createSheet(table.id, world.owner.id, 7, heroInput({
        name: "Runa Stonehand", class: "fighter", subclass: "Rune Knight", level: 7, maxHp: 70,
      }));
      const ally = (name) => {
        const bot = createCompanionUser(name);
        const sheet = sheets.createSheet(table.id, bot.id, 5, heroInput({ name, class: "fighter", level: 5, maxHp: 44 }));
        sheets.markSheetAsCompanion(sheet.id, "party", "Steady, and slow to speak.");
        return sheet;
      };
      const [near, far] = [ally("Bran Holt"), ally("Tam Reed")];
      const { rows, place } = await fightAt(table, player, [{ monster: "goblin", count: 2 }]);
      const [g1, g2] = [named(rows, "goblin", 0), named(rows, "goblin", 1)];
      [[runa.id, 0, 0], [near.id, 1, 0], [g1.id, 2, 0], [far.id, -13, 0], [g2.id, -14, 0]].forEach(([refId, dx, dy]) => place(refId, dx, dy));
      turnOf(table, g1.id, { legendary: { due: [g1.id, g2.id] } });
      await pass(table, [[g1.id, near.id, [15, 3]], [g2.id, far.id, [15, 3]]]);
      turnOf(table, runa.id);
      at.runic = { id: table.id, runa: { id: runa.id, name: runa.name }, near: { id: near.id, name: near.name }, far: { id: far.id, name: far.name } };
    }
    // ---- 14: the same reaction played from the GM's own seat, which the engine
    // resolves as it is played (the actions route's direct card calls) ----
    {
      const table = tableFor(`Runic Shield GM Table (${viewport})`, world.owner, player);
      const runa = sheets.createSheet(table.id, world.owner.id, 7, heroInput({
        name: "Runa Stonehand", class: "fighter", subclass: "Rune Knight", level: 7, maxHp: 70,
      }));
      const bot = createCompanionUser("Bran Holt");
      const near = sheets.createSheet(table.id, bot.id, 5, heroInput({ name: "Bran Holt", class: "fighter", level: 5, maxHp: 44 }));
      sheets.markSheetAsCompanion(near.id, "party", "Steady, and slow to speak.");
      const { rows, place } = await fightAt(table, world.owner, [{ monster: "goblin", count: 1 }]);
      const goblin = named(rows, "goblin", 0);
      [[runa.id, 0, 0], [near.id, 1, 0], [goblin.id, 2, 0]].forEach(([refId, dx, dy]) => place(refId, dx, dy));
      turnOf(table, goblin.id, { legendary: { due: [goblin.id] } });
      await pass(table, [[goblin.id, near.id, [15, 3]]]);
      turnOf(table, runa.id);
      at.runicGm = { id: table.id, runa: { id: runa.id, name: runa.name }, near: { id: near.id, name: near.name } };
    }
    // ---- 14b: Chronal Shift for a hit by a goblin within 30 feet of the
    // wizard: Bran stands beside Ilse, Tam 35 feet off with his goblin 40 feet
    // off, and a goblin's hit is open on each of the three ----
    {
      const table = tableFor(`Chronal Shift Table (${viewport})`, player, world.owner);
      const ilse = sheets.createSheet(table.id, world.owner.id, 2, heroInput({
        name: "Ilse Marrow", class: "wizard", subclass: "Chronurgy Magic", level: 2, maxHp: 30,
      }));
      const ally = (name) => {
        const bot = createCompanionUser(name);
        const sheet = sheets.createSheet(table.id, bot.id, 5, heroInput({ name, class: "fighter", level: 5, maxHp: 44 }));
        sheets.markSheetAsCompanion(sheet.id, "party", "Steady, and slow to speak.");
        return sheet;
      };
      const [near, far] = [ally("Bran Holt"), ally("Tam Reed")];
      const { rows, place } = await fightAt(table, player, [{ monster: "goblin", count: 3 }]);
      const [g1, g2, g3] = [named(rows, "goblin", 0), named(rows, "goblin", 1), named(rows, "goblin", 2)];
      [[ilse.id, 0, 0], [near.id, 1, 0], [g1.id, 2, 0], [g3.id, 0, 1], [far.id, -7, 0], [g2.id, -8, 0]].forEach(([refId, dx, dy]) => place(refId, dx, dy));
      turnOf(table, g1.id, { legendary: { due: [g1.id, g2.id, g3.id] } });
      await pass(table, [[g1.id, near.id, [15, 3]], [g2.id, far.id, [15, 3]], [g3.id, ilse.id, [15, 3]]]);
      turnOf(table, ilse.id);
      at.chronal = { id: table.id, ilse: { id: ilse.id, name: ilse.name }, near: { id: near.id, name: near.name }, far: { id: far.id, name: far.name } };
    }
    // ---- 15: Misdirection from the GM's own seat, which the engine resolves as
    // it is played: a goblin's arrow from 15 feet hits Vex, another goblin stands
    // beside them in its line (the cover Misdirection needs), and a third 25 feet
    // off ----
    {
      const table = tableFor(`Misdirection Table (${viewport})`, world.owner, player);
      const vex = sheets.createSheet(table.id, world.owner.id, 13, heroInput({
        name: "Vex Marlowe", class: "rogue", subclass: "Mastermind", level: 13, maxHp: 80,
      }));
      const { rows, place } = await fightAt(table, world.owner, [{ monster: "goblin", count: 3 }]);
      const [striker, beside, far] = [named(rows, "goblin", 0), named(rows, "goblin", 1), named(rows, "goblin", 2)];
      [[vex.id, 0, 0], [striker.id, 3, 0], [beside.id, 1, 0], [far.id, 0, 5]].forEach(([refId, dx, dy]) => place(refId, dx, dy));
      turnOf(table, striker.id, { legendary: { due: [striker.id] } });
      await pass(table, [[striker.id, vex.id, [15, 3], "Shortbow"]]);
      turnOf(table, vex.id);
      at.misdirection = { id: table.id, vex: { id: vex.id, name: vex.name }, striker: striker.id, beside: beside.id, far: far.id };
    }
    // ---- 16: the same card for a hero off their turn: the lead plays Vex and
    // Brom, it is Brom's turn, and the board measures from Brom. A goblin's arrow
    // hits Vex, another stands beside Vex in its line, and the third beside Brom,
    // 50 feet from Vex ----
    {
      const table = tableFor(`Misdirection Off Turn Table (${viewport})`, world.owner, player, { multiCharacter: "all_active" });
      const vex = sheets.createSheet(table.id, world.owner.id, 13, heroInput({
        name: "Vex Marlowe", class: "rogue", subclass: "Mastermind", level: 13, maxHp: 80,
      }));
      const brom = sheets.createSheet(table.id, world.owner.id, 13, heroInput({ name: "Brom Ashe", class: "fighter", level: 13, maxHp: 90 }));
      const { rows, place } = await fightAt(table, world.owner, [{ monster: "goblin", count: 3 }]);
      const [striker, beside, byBrom] = [named(rows, "goblin", 0), named(rows, "goblin", 1), named(rows, "goblin", 2)];
      [[vex.id, 0, 0], [striker.id, 3, 0], [beside.id, 1, 0], [brom.id, 10, 0], [byBrom.id, 11, 0]].forEach(([refId, dx, dy]) => place(refId, dx, dy));
      turnOf(table, striker.id, { legendary: { due: [striker.id] } });
      await pass(table, [[striker.id, vex.id, [15, 3], "Shortbow"]]);
      turnOf(table, brom.id);
      at.misdirectionOff = { id: table.id, vex: { id: vex.id, name: vex.name }, striker: striker.id, beside: beside.id, byBrom: byBrom.id };
    }
    bench2[viewport] = at;
  }
}

const ids = {
  fallenTables,
  clockTables,
  resolveTables,
  ringTables,
  itemTables,
  bench2,
  weekly,
  multiclassTableId: multiclassTable.id,
  singleClassTableId: singleClassTable.id,
  qualityTurnIds,
  spellbook,
  witchBolt,
  tidesOfChaos,
  speciesSpells,
  noticeTables,
  afterRollTables,
  afterAttackTables,
  wrathTables,
  afterRiderTables,
  allyTables,
  flashTables,
  touchTables,
  skippedTables,
  attractionTables,
  portentTables,
  watchTables,
  starTables,
  heldTurnTables,
  shiftTables,
  chronalWatchTables,
  twoHandsTables,
  damageStepTables,
  healingDiceTables,
  hitDiceTables,
  recapTables,
  splitLineTables,
  prepReturn,
  prepReturnTitle: PREP_RETURN_TITLE,
  chipTables,
  offerTableId: offerTable.id,
  offerWorkshopId: offerWorkshop.id,
  offeredPregen: offeredPregen.id,
  offeredPregenName: offeredPregen.name,
  hiddenPregen: hiddenPregen.id,
  revised: ysolde.id,
  orc: grask.id,
  curioTableId: curioTable.id,
  curioShop: CURIO_SHOP,
  lead: world.owner.username,
  player: player.username,
  walker: tourAccounts[0].username,
  sharer: tourAccounts[1].username,
  heir: tourAccounts[2].username,
  password: PASSWORD,
  title: TITLE,
  lobbyTitle: LOBBY_TITLE,
  campaignId: world.campaignId,
  lobbyId: lobby.id,
  tavi: tavi.id,
  bree: bree.id,
  goblin: goblin.id,
  library: brann.id,
  libraryName: LIBRARY_NAME,
  lifeCleric: wren.id,
  lifeClericName: LIFE_NAME,
  heldFeats: sable.id,
  heldFeatsName: HELD_FEATS_NAME,
  offerId: offer.id,
  offerSummary: offer.summary,
  quietId: quiet.id,
  marketTableId: marketTable.id,
  marketShop: MARKET_SHOP,
  marketHeroId: marketHero.id,
  marketSecondId: marketSecond.id,
  quietTitle: QUIET_TITLE,
  quietLoreTurnId,
  tourTableId: tourTable.id,
  tourTableTitle: TOUR_TITLE,
  ama: ama.id,
  corin: corin.id,
  preparedId: prepared.id,
  preparedTitle: PREP_TITLE,
  prepSourceId: prepSource.id,
  prepSourceTitle: PREP_SOURCE_TITLE,
  closing,
  stopTables,
  questTables,
  wardrobe,
  spotlightTables,
  directed,
  longOpening,
  fightInBuilding,
  enemyTurns,
  enemyMoves,
  levelTableId: levelTable.id,
  secretsTableId: secretsTable.id,
  dragonTables,
  commandTableId: commandTable.id,
  replayTableId: replayTable.id,
  voiceTableId: voiceTable.id,
  soundTableId: soundTable.id,
  courting,
  conscience,
  masked,
  turncoat,
  gone,
  dominate,
  pileup,
  conduct,
  farScout,
  bondTables,
  knownTables,
  romanceTables,
  nameTables,
  pacts: pactTables,
  pip: pip.id,
  // Issue 548's made-up world, one table per viewport.
  regionTables,
  // Issue 643's courting companion with a scene due, one per viewport.
  romancePace,
  // Every campaign a scenario opens, by id, for the app's home tiles.
  titles: {
    [levelTable.id]: "Level Table",
    [secretsTable.id]: "Secrets Table",
    ...Object.fromEntries(Object.entries(dragonTables).map(([viewport, table]) => [table.id, `Dragon Table (${viewport})`])),
    [commandTable.id]: COMMAND_TITLE,
    [replayTable.id]: REPLAY_TITLE,
    [voiceTable.id]: VOICE_TITLE,
    [soundTable.id]: SOUND_TITLE,
    ...Object.fromEntries(Object.entries(courting).map(([viewport, table]) => [table.id, `${COURTING_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(conscience).map(([viewport, table]) => [table.id, `${CONSCIENCE_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(masked).map(([viewport, table]) => [table.id, `${MASKED_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(turncoat).map(([viewport, table]) => [table.id, `${TURNCOAT_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(gone).map(([viewport, table]) => [table.id, `${GONE_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(conduct).map(([viewport, table]) => [table.id, `${CONDUCT_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(farScout).map(([viewport, table]) => [table.id, `${FAR_SCOUT_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.values(weekly).map((table) => [table.id, table.title])),
    ...Object.fromEntries(Object.entries(fallenTables).map(([viewport, id]) => [id, `The Fallen Watch (${viewport})`])),
    ...Object.fromEntries(Object.entries(clockTables).map(([viewport, table]) => [table.id, `Clock Table (${viewport})`])),
    ...Object.fromEntries(Object.entries(resolveTables).map(([viewport, table]) => [table.id, `${RESOLVE_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(ringTables).flatMap(([viewport, table]) => [[table.id, `Ring Table (${viewport})`], [table.study, `Ring Study (${viewport})`]])),
    ...Object.fromEntries(Object.entries(itemTables).flatMap(([viewport, table]) => [[table.id, `Item Table (${viewport})`], [table.study, `Item Study (${viewport})`]])),
    ...bench2Titles,
    ...Object.fromEntries(Object.entries(pactTables).flatMap(([kind, tables]) => Object.entries(tables).map(([viewport, table]) => [table.id, `Pact ${kind.charAt(0).toUpperCase()}${kind.slice(1)} (${viewport})`]))),
    ...Object.fromEntries(Object.entries(chipTables).map(([viewport, table]) => [table.id, `Chip Table (${viewport})`])),
    ...Object.fromEntries(Object.entries(spellbook).map(([viewport, table]) => [table.id, `${SPELLBOOK_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(noticeTables).map(([viewport, table]) => [table.id, `${NOTICE_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(afterRollTables).map(([viewport, table]) => [table.id, `${AFTER_ROLL_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(afterAttackTables).map(([viewport, table]) => [table.id, `${AFTER_ATTACK_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(wrathTables).map(([viewport, table]) => [table.id, `${WRATH_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(afterRiderTables).map(([viewport, table]) => [table.id, `${AFTER_RIDER_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(allyTables).map(([viewport, table]) => [table.id, `${ALLY_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(flashTables).map(([viewport, table]) => [table.id, `${FLASH_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(touchTables).map(([viewport, table]) => [table.id, `${TOUCH_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(skippedTables).map(([viewport, table]) => [table.id, `${SKIPPED_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(attractionTables).map(([viewport, table]) => [table.id, `${ATTRACTION_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(portentTables).map(([viewport, table]) => [table.id, `${PORTENT_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(watchTables).map(([viewport, table]) => [table.id, `${WATCH_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(starTables).map(([viewport, table]) => [table.id, `${STAR_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(heldTurnTables).map(([viewport, table]) => [table.id, `${HELD_TURN_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(shiftTables).map(([viewport, table]) => [table.id, `${SHIFT_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(chronalWatchTables).map(([viewport, table]) => [table.id, `${CHRONAL_WATCH_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(twoHandsTables).map(([viewport, table]) => [table.id, `${TWO_HANDS_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(damageStepTables).map(([viewport, table]) => [table.id, `${DAMAGE_STEPS_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(healingDiceTables).map(([viewport, table]) => [table.id, `${HEALING_DICE_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(hitDiceTables).map(([viewport, table]) => [table.id, `${HIT_DICE_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(recapTables).map(([viewport, id]) => [id, `${RECAP_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(splitLineTables).map(([viewport, id]) => [id, `${SPLIT_LINE_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(prepReturn).map(([viewport, id]) => [id, `${PREP_RETURN_TITLE} (${viewport})`])),
    [world.campaignId]: TITLE,
    [lobby.id]: LOBBY_TITLE,
    [quiet.id]: QUIET_TITLE,
    [marketTable.id]: MARKET_TITLE,
    ...Object.fromEntries(Object.entries(regionTables).map(([viewport, id]) => [id, `${REGION_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(romancePace).map(([viewport, table]) => [table.id, `${ROMANCE_PACE_TITLE} (${viewport})`])),
    [prepared.id]: PREP_TITLE,
    [tourTable.id]: TOUR_TITLE,
    [prepSource.id]: PREP_SOURCE_TITLE,
    [offerTable.id]: OFFER_TITLE,
    ...Object.fromEntries(Object.entries(closing).map(([viewport, id]) => [id, `Closing Table (${viewport})`])),
    ...Object.fromEntries(Object.entries(bondTables).map(([viewport, table]) => [table.id, `Bonds Table (${viewport})`])),
    ...Object.fromEntries(Object.entries(knownTables).map(([viewport, id]) => [id, `Known Table (${viewport})`])),
    ...Object.fromEntries(Object.entries(romanceTables).map(([viewport, table]) => [table.id, `Romance Table (${viewport})`])),
    ...Object.fromEntries(Object.entries(nameTables).map(([key, id]) => [id, key.endsWith("Gm") ? `Names GM Table (${key.slice(0, -2)})` : `Names Table (${key})`])),
    ...Object.fromEntries(Object.entries(stopTables).map(([viewport, id]) => [id, `Stop Table (${viewport})`])),
    ...Object.fromEntries(Object.entries(questTables).map(([viewport, table]) => [table.id, `Quest Table (${viewport})`])),
    ...Object.fromEntries(Object.entries(wardrobe).map(([viewport, id]) => [id, `Wardrobe (${viewport})`])),
    ...Object.fromEntries(Object.entries(spotlightTables).map(([viewport, id]) => [id, `${SPOTLIGHT_TITLE} (${viewport})`])),
    ...Object.fromEntries(Object.entries(directed).map(([viewport, table]) => [table.id, `Directed Table (${viewport})`])),
    ...Object.fromEntries(Object.entries(enemyTurns).map(([viewport, table]) => [table.id, `Enemy Turn Table (${viewport})`])),
    ...Object.fromEntries(Object.entries(enemyMoves).map(([viewport, table]) => [table.id, `Enemy Moves Table (${viewport})`])),
    ...Object.fromEntries(Object.entries(dominate).flatMap(([viewport, table]) => [[table.id, `Dominate Table (${viewport})`], [table.heldId, `Held Table (${viewport})`]])),
  },
  systemLine,
  oocQuestion,
  oocAnswer,
  paragraphs: paragraphs.map((text) => text.replace(/[*_]/g, "")),
};
getDatabase().pragma("wal_checkpoint(TRUNCATE)");
fs.copyFileSync(process.env.SQLITE_DB_PATH, path.join(out, "world.sqlite"));
fs.writeFileSync(path.join(out, "key"), process.env.DB_ENCRYPTION_KEY);
fs.writeFileSync(path.join(out, "ids.json"), JSON.stringify(ids, null, 2));
getDatabase().close();
console.log(`seeded ${TITLE} (${world.campaignId}), ${QUIET_TITLE}, ${LOBBY_TITLE} and ${PREP_TITLE} into ${out}`);
