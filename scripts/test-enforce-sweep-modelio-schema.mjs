// Sweep, modelio (1): every tool definition a model is handed, in every
// profile and at every door, against the strictest readers, and the token
// budgets each window profile keeps.
//
// A generator, not a list: the rows are the sets the turn's own builders
// return (scripts/lib/sweep-modelio-tools.mjs toolUniverse), so a tool or an
// argument added next month is linted the day it lands.
//
//   A. Schema lint (lintTool): arrays have items, objects have properties,
//      every node a type, no empty or mistyped enum, required inside
//      properties, defaults of the node's type, sane bounds, legal names.
//      0.32.0 shipped heal.targets with no items and llama.cpp's gpt-oss
//      template failed every call that carried the tools (#861).
//   B. Reader limits: a function description within OpenAI's 1,024
//      characters, a set within its 128 tools, an MCP schema within the
//      65,536 bytes the Codex adapter raises its cap to, an MCP description
//      within the 2,048 characters Claude Code keeps, and no JSON Schema
//      keyword outside the ones already reviewed (a new keyword fails here
//      until someone has checked it against the strict readers).
//   C. Budgets: the trimmed set on a 48K window and the full set on a 64K
//      one with every optional family switched on (scripts/test-prompt-window.mjs
//      measures a default table), and the compact set on a 16K window over
//      a matrix of tables: the first call of a turn offers the richest
//      compact set, with room to spare for one more argument.
import assert from "node:assert/strict";

process.env.OPENAI_COMPAT_CONTEXT = "16384";
process.env.DM_THINKING = "0";

const { openWorld } = await import("./lib/enforce-world.mjs");
const { suite } = await import("./lib/enforce-harness.mjs");
const { fakeModel, reply } = await import("./lib/enforce-narrator.mjs");
const { toolUniverse, lintTool, keywordCensus, toolShape, everythingOn } = await import("./lib/sweep-modelio-tools.mjs");

const { test, gap, finish } = suite("test-enforce-sweep-modelio-schema");

// What fails today, keyed by row id. A row with an entry runs through gap()
// and fails the suite the day it starts holding; a row without one runs
// through test().
const KNOWN = {
  "lint:chat:object-properties:heal.targets[]": {
    rule: "Every object a tool's schema declares names its properties: heal.targets is a list of {characterId, amount}, written only in the description, so a model reads `targets: object[]` and a reader that wants an object's properties (Gemini: 'should be non-empty for OBJECT type') refuses the whole tool list.",
    where: "src/lib/dm/mutations.ts mutationTools heal.targets (items: { type: \"object\" } with no properties, added by the #861 fix)",
    severity: "medium",
    note: "The #861 fix gave the array its items and stopped there. Every other list of objects in the catalogue (pc_attack.attacks, cast_at_enemy.targets, grant_item.items) declares its entry's fields.",
  },
  "limit:chat:description-1024:compact/every-tool:more_tools": {
    rule: "A function's description stays within the 1,024 characters OpenAI's Chat Completions accepts ('string too long. Expected a string with maximum length 1024'): more_tools lists every closed group with its summary in its description.",
    where: "src/lib/dm/tool-profiles.ts moreToolsTool (description joins every closed group's summary; 1,609 characters with every group closed)",
    severity: "medium",
    note: "A compact table is one whose window is small; on a strict OpenAI-compatible host the 400 it answers holds the words 'tools' and 'function', which toolsUnsupportedByServer reads as no function calling and retries without tools (see test-enforce-sweep-modelio-errors).",
  },
  "limit:chat:description-1024:compact/explore:more_tools": {
    rule: "A function's description stays within the 1,024 characters OpenAI's Chat Completions accepts: the more_tools a quiet 16K table is really sent.",
    where: "src/lib/dm/tool-profiles.ts moreToolsTool",
    severity: "medium",
  },
  "limit:chat:description-1024:compact/fight:more_tools": {
    rule: "A function's description stays within the 1,024 characters OpenAI's Chat Completions accepts: the more_tools a 16K table in a fight is really sent.",
    where: "src/lib/dm/tool-profiles.ts moreToolsTool",
    severity: "medium",
  },
  "lint:mcp-workbench:object-properties": {
    rule: "Every object an MCP tool's inputSchema declares names its properties: the workbench declares eight open objects (a sheet, a test fight's party, a dice queue's entries, odm_dm_invoke's args) with a description alone, so a connecting agent is not told a single field of them.",
    where: "src/lib/agents/workbench.ts WORKBENCH_TOOLS (odm_level_up.asiChoices[], odm_level_up.featChoices, odm_create_character.sheet, odm_update_character.sheet, odm_start_test_fight.party, odm_set_dice_script.queue[], odm_dm_invoke.args, odm_dm_narrate.speaker)",
    severity: "low",
    note: "Open by design for sheet and args (the route's own zod schema is the contract), but an agent whose client converts MCP tools for a strict reader loses the tool. Recorded for a ruling.",
  },
  "lint:mcp-workbench:type-list": {
    rule: "A schema node's type is one name, not a list: odm_set_dice_script.seed is [\"integer\", \"null\"].",
    where: "src/lib/agents/workbench.ts WORKBENCH_TOOLS odm_set_dice_script.seed",
    severity: "low",
  },
};

const world = await openWorld({ gameSettings: { ttsEnabled: false } });
world.addHero({ class: "fighter", level: 3 });
const universe = await toolUniverse(world);

// ---- A. schema lint ---------------------------------------------------------

// One row per issue, whatever the number of sets that carry the tool: the
// chat door's rows are keyed by code and path, the workbench's by code (its
// open objects are one decision, not eight).
const lintRows = new Map();
let linted = 0;
for (const set of [...universe.sets, ...universe.mcp]) {
  const workbench = set.id === "mcp/workbench";
  for (const tool of set.tools) {
    linted += 1;
    for (const issue of lintTool(tool)) {
      const id = workbench ? `lint:mcp-workbench:${issue.code}` : `lint:chat:${issue.code}:${issue.path}`;
      const row = lintRows.get(id) ?? { id, sets: new Set(), says: new Set() };
      row.sets.add(set.id);
      row.says.add(`${issue.path}: ${issue.say}`);
      lintRows.set(id, row);
    }
  }
}

await test(`the walk covers the whole catalogue (${universe.byName.size} tools, ${linted} definitions over ${universe.sets.length + universe.mcp.length} sets)`, () => {
  assert.ok(universe.byName.size >= 90, `only ${universe.byName.size} tools were found`);
  for (const set of [...universe.sets, ...universe.mcp]) {
    assert.ok(set.tools.length > 0, `${set.id} is empty`);
  }
});

for (const row of lintRows.values()) {
  const say = `${[...row.says].join(" | ")} (in ${[...row.sets].join(", ")})`;
  if (KNOWN[row.id]) {
    await gap(row.id, KNOWN[row.id], () => assert.fail(say));
  } else {
    await test(row.id, () => assert.fail(`a schema shape a strict reader refuses, with no entry in KNOWN: ${say}`));
  }
}
// A known lint row that no longer appears has closed: gap() says so.
for (const id of Object.keys(KNOWN).filter((key) => key.startsWith("lint:") && !lintRows.has(key))) {
  await gap(id, KNOWN[id], () => {});
}

await test("every tool in every set lints clean but for the rows above", () => {
  assert.ok(linted > 400, `${linted} definitions linted`);
});

// ---- B. reader limits -------------------------------------------------------

const OPENAI_DESCRIPTION_MAX = 1_024;
const OPENAI_TOOLS_MAX = 128;
const CODEX_SCHEMA_MAX_BYTES = 65_536;
const CLAUDE_MCP_DESCRIPTION_MAX = 2_048;
// The keywords reviewed against the strict readers. A keyword outside the
// list (oneOf, $ref, pattern, format, const, nullable, default) fails until
// it is checked and added: the gpt-oss template branches on oneOf, default
// and nullable, and a provider that validates its body refuses a key it does
// not know.
const KEYWORDS = {
  chat: ["type", "properties", "required", "description", "enum", "items", "additionalProperties", "minimum", "maximum", "minItems", "maxItems"],
  mcp: ["type", "properties", "required", "description", "enum", "items", "additionalProperties", "minimum", "maximum", "minItems", "maxItems", "maxLength"],
};

async function row(id, fn) {
  if (KNOWN[id]) await gap(id, KNOWN[id], fn);
  else await test(id, fn);
}

let limitRows = 0;
for (const set of universe.sets) {
  limitRows += 1;
  await row(`limit:chat:count-128:${set.id}`, () => {
    const names = set.tools.map((tool) => tool.function.name);
    assert.ok(names.length <= OPENAI_TOOLS_MAX, `${set.id} offers ${names.length} tools, over the ${OPENAI_TOOLS_MAX} one request takes`);
  });
  if (set.id !== "full/waiting") {
    limitRows += 1;
    await row(`limit:chat:unique-names:${set.id}`, () => {
      const names = set.tools.map((tool) => tool.function.name);
      const repeated = names.filter((name, index) => names.indexOf(name) !== index);
      assert.deepEqual(repeated, [], `${set.id} offers a name twice`);
    });
  }
  limitRows += 1;
  await row(`limit:chat:keywords:${set.id}`, () => {
    const strange = [...keywordCensus(set.tools).keys()].filter((key) => !KEYWORDS.chat.includes(key));
    assert.deepEqual(strange, [], `${set.id} uses JSON Schema keywords nobody has checked against the strict readers`);
  });
  for (const tool of set.tools) {
    const { name, description } = toolShape(tool);
    const id = `limit:chat:description-1024:${set.id}:${name}`;
    if ((description ?? "").length <= OPENAI_DESCRIPTION_MAX && !KNOWN[id]) {
      continue;
    }
    limitRows += 1;
    await row(id, () => {
      assert.ok((description ?? "").length <= OPENAI_DESCRIPTION_MAX, `${name}'s description is ${description.length} characters in ${set.id}, over ${OPENAI_DESCRIPTION_MAX}`);
    });
  }
}
await test("every function description in the full and trimmed sets is within 1,024 characters", () => {
  const over = universe.sets
    .filter((set) => !set.id.startsWith("compact/"))
    .flatMap((set) => set.tools.map(toolShape).filter((tool) => (tool.description ?? "").length > OPENAI_DESCRIPTION_MAX).map((tool) => `${set.id}:${tool.name} ${tool.description.length}`));
  assert.deepEqual(over, []);
});
for (const set of universe.mcp) {
  limitRows += 1;
  await row(`limit:mcp:schema-bytes:${set.id}`, () => {
    const over = set.tools.map((tool) => [tool.name, Buffer.byteLength(JSON.stringify(tool.inputSchema))]).filter(([, bytes]) => bytes > CODEX_SCHEMA_MAX_BYTES);
    assert.deepEqual(over, [], `${set.id}: an input schema past the ${CODEX_SCHEMA_MAX_BYTES} bytes the Codex adapter allows (src/lib/harness/adapters/codex.ts)`);
  });
  limitRows += 1;
  await row(`limit:mcp:description-2048:${set.id}`, () => {
    const over = set.tools.filter((tool) => tool.description.length > CLAUDE_MCP_DESCRIPTION_MAX).map((tool) => `${tool.name} ${tool.description.length}`);
    assert.deepEqual(over, [], `${set.id}: a description Claude Code cuts at ${CLAUDE_MCP_DESCRIPTION_MAX} characters`);
  });
  limitRows += 1;
  await row(`limit:mcp:keywords:${set.id}`, () => {
    const strange = [...keywordCensus(set.tools).keys()].filter((key) => !KEYWORDS.mcp.includes(key));
    assert.deepEqual(strange, [], `${set.id} uses JSON Schema keywords nobody has checked`);
  });
  limitRows += 1;
  await row(`limit:mcp:root-object:${set.id}`, () => {
    const wrong = set.tools.filter((tool) => tool.inputSchema?.type !== "object" || typeof tool.inputSchema.properties !== "object").map((tool) => tool.name);
    assert.deepEqual(wrong, [], `${set.id}: an inputSchema that is not an object with properties`);
  });
}

// ---- C. budgets -------------------------------------------------------------

const { estimateTokens } = await import("../src/lib/dm/context-budget.ts");
const { MIN_LEAN_ROOM_TOKENS, MIN_STORY_ROOM_TOKENS } = await import("../src/lib/dm/model-tuning-logic.ts");
const turnModule = await import("../src/lib/dm/turn.ts");
const { requestTokens } = await import("../src/lib/dm/request-fit.ts");
const { getDmTurn, getLatestDmTurnId } = await import("../src/lib/db/dm-turns.ts");
const { listSheets } = await import("../src/lib/db/sheets.ts");

// The compact rows share one rule; each row's note is the table it failed at.
const COMPACT_16K = (note) => ({
  rule: "docs/text-backends.md: '16K (-c 16384): narration, exploration and checks on the compact tool set'. The first call of an exploring turn on a 16,384 window carries the compact set its table's state and the players' words call for, with room for one more argument.",
  where: "src/lib/dm/turn.ts compactToolsThatFit / toolSetTokens (the rules and game state are packed against the window less the tools, but the rules a party needs do not shrink); src/lib/dm/prompt-rules.ts for the fixed lines; scripts/test-tool-profiles.mjs measures only a lone level 1 fighter",
  severity: "medium",
  note,
});
const COMPACT_24K = (note) => ({
  rule: "docs/text-backends.md: '24K (-c 24576): fights too, on a trimmed tool set' (src/lib/story-window.ts MIN_COMBAT_WINDOW). The first call of a fight's turn on a 24,576 window carries the fight's compact set.",
  where: "src/lib/dm/turn.ts compactToolsThatFit (falls to ESSENTIAL_TOOLS + ESSENTIAL_COMBAT_TOOLS); src/lib/story-window.ts MIN_COMBAT_WINDOW; scripts/test-tool-profiles.mjs 'the combat minimum' measures a lone level 1 fighter",
  severity: "medium",
  note,
});
const BUDGET_KNOWN = {
  "budget:lean-48k:every-family": {
    rule: "The trimmed tool set leaves a 48K window the 1,500 tokens the prompt-window guard keeps spare (scripts/test-prompt-window.mjs LEAN_SPARE), at a table with every optional family on as at a default one.",
    where: "scripts/test-prompt-window.mjs section 4 measures a default table only; src/lib/dm/turn.ts dmTurnTools adds settlements, ambience and pictures on top",
    severity: "low",
    note: "With world simulation, the sound library and pictures all on, the fight's trimmed set is 22,777 tokens: 1,223 spare, against 1,602 at the default table the guard measures.",
  },
  "budget:compact-16k:lone-fighter-1": COMPACT_16K("The one table the existing guard measures: 15,353 of 15,360 tokens, 7 spare. Any argument added to a core tool sheds tools (issue #746, then #755, #808, #832)."),
  "budget:compact-16k:lone-fighter-3": COMPACT_16K("A lone level 3 fighter: 15,806 tokens, 446 over; the call fell to 5 tools (request_roll, request_player_input, record_event, send_whisper, more_tools)."),
  "budget:compact-16k:lone-fighter-11": COMPACT_16K("A lone level 11 fighter: 466 over, 5 tools."),
  "budget:compact-16k:lone-wizard-5": COMPACT_16K("A lone level 5 wizard: 18,707 tokens, 3,347 over, 5 tools: the casting rules alone outgrow the window."),
  "budget:compact-16k:fighter-and-wizard": COMPACT_16K("A fighter and a wizard: 3,637 over, 5 tools."),
  "budget:compact-16k:four-heroes": COMPACT_16K("Four level 5 heroes: 4,360 over, 5 tools."),
  "budget:compact-16k:shop-words-fighter-1": COMPACT_16K("'I want to buy a rope' at the guard's own table: 292 over, so the lookups are shed to keep the shop (the #755 fix working as written, with nothing spare)."),
  "budget:compact-16k:shop-words-fighter-3": COMPACT_16K("'I want to buy a rope' with a level 3 fighter: 745 over; open_shop, haggle and purchase are all shed, the case #755 fixed for a level 1 fighter."),
  "budget:compact-16k:journey-words-fighter-3": COMPACT_16K("Three groups opened by the player's words (world, hazards, mounts): 3,117 over, 5 tools, none of the three groups offered."),
  "budget:compact-24k-fight:fight-fighter-1": COMPACT_24K("A lone level 1 fighter against one goblin: 817 over, the six spare tools shed."),
  "budget:compact-24k-fight:fight-fighter-3": COMPACT_24K("A lone level 3 fighter against two goblins: 1,491 over; the call fell to 8 tools (the four essentials, pc_attack, enemy_attack, end_turn, more_tools): no take_action, move_token, apply_damage, use_resource, end_encounter."),
  "budget:compact-24k-fight:fight-fighter-and-wizard": COMPACT_24K("A fighter and a wizard: 4,928 over, 8 tools: no cast_at_enemy, aoe_damage or use_spell_slot for the wizard's turn."),
  "budget:compact-24k-fight:fight-four-heroes": COMPACT_24K("Four level 5 heroes against four goblins: 6,137 over, 8 tools."),
};

const cost = (tools) => estimateTokens(JSON.stringify(tools));
const larger = (campaign, image, lean) => Math.max(cost(turnModule.dmTurnTools(campaign, false, image, lean)), cost(turnModule.dmTurnTools(campaign, true, image, lean)));
const budgetLines = [];

async function budgetRow(id, fn) {
  if (BUDGET_KNOWN[id]) await gap(id, BUDGET_KNOWN[id], fn);
  else await test(id, fn);
}

{
  const plain = world.campaign();
  const every = everythingOn(plain);
  for (const [label, campaign, image] of [["default", plain, false], ["every-family", every, true]]) {
    const leanTokens = larger(campaign, image, true);
    const fullTokens = larger(campaign, image, false);
    const leanSpare = 48_000 - leanTokens - MIN_LEAN_ROOM_TOKENS;
    const fullSpare = 64_000 - fullTokens - MIN_STORY_ROOM_TOKENS;
    budgetLines.push(`48K trimmed (${label}): ${leanTokens} tokens, ${leanSpare} spare; 64K full (${label}): ${fullTokens} tokens, ${fullSpare} spare`);
    await budgetRow(`budget:lean-48k:${label}`, () => {
      assert.ok(leanSpare >= 1_500, `the trimmed set is ${leanTokens} tokens at a ${label} table: ${leanSpare} spare on a 48K window, under the 1,500 the guard keeps`);
    });
    await budgetRow(`budget:full-64k:${label}`, () => {
      assert.ok(fullSpare >= 3_000, `the full set is ${fullTokens} tokens at a ${label} table: ${fullSpare} spare on a 64K window, under the 3,000 the guard keeps`);
    });
  }
}

// The compact windows the docs promise (src/lib/story-window.ts,
// docs/text-backends.md): "16K (-c 16384): narration, exploration and checks
// on the compact tool set", and 24K for fights. One first call per table of
// the matrix, at the window its moment is promised.
const { MIN_NARRATION_WINDOW, MIN_COMBAT_WINDOW, windowFlag } = await import("../src/lib/story-window.ts");
const REPLY_FLOOR = 1_024;
// Room for one more argument with a sentence of description on a core tool.
const COMPACT_SPARE = 120;

const WIZARD = {
  class: "wizard",
  level: 5,
  abilities: { int: 16 },
  spellcasting: {
    ability: "int",
    slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } },
    prepared: ["Magic Missile", "Fireball", "Shield"],
    known: [],
    cantrips: ["Fire Bolt"],
    spellbook: ["Magic Missile", "Fireball", "Shield"],
  },
};
const FIGHTER = (level) => ({ class: "fighter", level });
const QUIET = "I look around the crossroads.";
const SWING = "I attack the goblin with my longsword.";

const TABLES = [
  // The table scripts/test-tool-profiles.mjs measures: one level 1 fighter.
  { id: "lone-fighter-1", party: [FIGHTER(1)], line: QUIET },
  { id: "lone-fighter-3", party: [FIGHTER(3)], line: QUIET },
  { id: "lone-fighter-11", party: [FIGHTER(11)], line: QUIET },
  { id: "lone-wizard-5", party: [WIZARD], line: QUIET },
  { id: "fighter-and-wizard", party: [FIGHTER(3), WIZARD], line: QUIET },
  { id: "four-heroes", party: [FIGHTER(5), WIZARD, { class: "rogue", level: 5 }, { class: "cleric", level: 5 }], line: QUIET },
  { id: "shop-words-fighter-1", party: [FIGHTER(1)], line: "I want to buy a sturdy rope and sell my old boots." },
  { id: "shop-words-fighter-3", party: [FIGHTER(3)], line: "I want to buy a sturdy rope and sell my old boots." },
  { id: "journey-words-fighter-3", party: [FIGHTER(3)], line: "We saddle the horses and travel the road north, watching for traps." },
  { id: "fight-fighter-1", party: [FIGHTER(1)], line: SWING, fight: [{ monster: "goblin", count: 1 }] },
  { id: "fight-fighter-3", party: [FIGHTER(3)], line: SWING, fight: [{ monster: "goblin", count: 2 }] },
  { id: "fight-fighter-and-wizard", party: [FIGHTER(3), WIZARD], line: SWING, fight: [{ monster: "goblin", count: 2 }] },
  { id: "fight-four-heroes", party: [FIGHTER(5), WIZARD, { class: "rogue", level: 5 }, { class: "cleric", level: 5 }], line: SWING, fight: [{ monster: "goblin", count: 4 }] },
];

const model = await fakeModel();
const names = (tools) => tools.map((tool) => tool.function.name).sort();
let budgetRows = 0;

for (const table of TABLES) {
  const window = windowFlag(table.fight ? MIN_COMBAT_WINDOW : MIN_NARRATION_WINDOW);
  const label = table.fight ? "24k-fight" : "16k";
  const id = `budget:compact-${label}:${table.id}`;
  budgetRows += 1;
  process.env.OPENAI_COMPAT_CONTEXT = String(window);
  const tableWorld = await openWorld({ gameSettings: { ttsEnabled: false } });
  const heroes = table.party.map((hero, index) => tableWorld.addHero({ name: `Hero ${index + 1}`, ...hero }));
  model.pointAt(tableWorld);
  if (table.fight) {
    await tableWorld.beginFight(table.fight, { heroFaces: { [heroes[0].id]: 20 } });
  }
  model.script([reply({ text: "The moment holds. What do you do?" })]);
  await model.turn(tableWorld, table.line, heroes[0].id, heroes[0].userId);
  const first = model.requests.find((body) => Array.isArray(body.tools));
  const turn = getDmTurn(getLatestDmTurnId(tableWorld.campaignId));
  const campaign = tableWorld.campaign();
  const inFight = Boolean(tableWorld.encounter());
  const intent = turn?.contextTrace?.profile?.intent ?? [];
  const richest = turnModule.compactTurnTools(campaign, inFight, false, turnModule.profileSignals(campaign, listSheets(tableWorld.campaignId), inFight), intent).tools;
  const need = first ? requestTokens(first.messages, richest) : null;
  const spare = need === null ? null : window - REPLY_FLOOR - need;
  const offered = first ? names(first.tools) : [];
  const shed = names(richest).filter((name) => !offered.includes(name));
  budgetLines.push(
    `${label} compact ${table.id}: profile ${turn?.contextTrace?.profile?.name}, intent [${intent.join(", ")}], richest set ${richest.length} tools / ${cost(richest)} tokens, ` +
      (first ? `call ${need} tokens, ${spare} spare of ${window - REPLY_FLOOR}; offered ${offered.length}${shed.length ? `, shed ${shed.length}: ${shed.join(", ")}` : ""}` : `NO CALL SENT: ${String(turn?.error ?? "").slice(0, 160)}`),
  );
  await budgetRow(id, () => {
    assert.equal(turn?.contextTrace?.profile?.name, "compact", `${table.id}: a ${window} window plays on the compact profile`);
    assert.ok(first, `${table.id}: the turn was refused for room on a ${window} window: ${String(turn?.error ?? "").slice(0, 200)}`);
    assert.deepEqual(shed, [], `${table.id}: the first call of the turn gave up ${shed.length} of the ${richest.length} tools its compact set offers (the call needs ${need} tokens of the ${window - REPLY_FLOOR} a ${window} window leaves)`);
    assert.ok(spare >= COMPACT_SPARE, `${table.id}: the compact call is ${need} tokens, ${spare} spare of the ${window - REPLY_FLOOR} a ${window} window leaves; under ${COMPACT_SPARE}, the next argument on a core tool sheds tools`);
  });
}
model.close();
process.env.OPENAI_COMPAT_CONTEXT = "16384";

for (const line of budgetLines) {
  console.log(`  ${line}`);
}
console.log(`  rows: ${lintRows.size} lint findings over ${linted} definitions, ${limitRows} reader-limit rows, ${budgetRows + 4} budget rows; skipped 0`);

world.close();
finish();
