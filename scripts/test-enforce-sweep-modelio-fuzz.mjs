// Sweep, modelio (3): every tool's arguments, generated from the schema the
// tool publishes, with the slips models make.
//
// For every tool a turn can offer (scripts/lib/sweep-modelio-tools.mjs
// toolUniverse) a call is built from its schema, with a real id wherever a
// field names one, and sent through the model's door (lists split, "false"
// read, names routed, the AI's gate: scripts/lib/sweep-modelio-fuzz.mjs
// modelDoor). Then one slip at a time, for every field the slip applies to:
//
//   bool-as-string        "false" / "true" for a boolean      the same as the boolean
//   number-as-string      "2" for a number                    the same, or a retry naming the field
//   null-optional         null for an optional field          as if left out, or a retry naming it
//   empty-optional        "" for an optional number or choice as if left out, or a retry naming it
//   one-for-list          one value where a list is asked     the same, or a retry naming it
//   list-for-one          a list where one value is asked     the same, or a retry naming it
//   id-dropped-char       an id with its last character gone  a retry that names the field or
//   id-case-changed       an id in the other case             lists who there is; never ok
//   ...-beside-a-good-one a list of one good id and a bad one never ok with the bad one dropped
//   name-for-id           the name where the id is asked      the same record, or a retry
//   extra-key             a key the tool does not take        the same
//
// and for every slip: never a thrown error, never the text of one in the
// refusal, never a refusal with no kind (src/lib/dm/tool-errors.ts).
//
// Each call runs inside a savepoint that is rolled back, on seeded dice, so
// a slip is compared with the call it was made from on equal ground. Where
// that call is itself refused the comparison says nothing and the row is
// counted as indeterminate (the crash and kind checks still ran); BASES
// gives the busiest tools a call that goes through at this suite's tables.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";
import { toolUniverse } from "./lib/sweep-modelio-tools.mjs";
import { baseArgs, judge, modelDoor, normalised, sameOutcome, slipsFor } from "./lib/sweep-modelio-fuzz.mjs";

const { test, gap, finish } = suite("test-enforce-sweep-modelio-fuzz");

// ---- the tables -------------------------------------------------------------

const WIZARD = {
  class: "wizard",
  level: 5,
  abilities: { int: 16 },
  gold: 50,
  equipment: [{ name: "Rope", qty: 2 }, { name: "Quarterstaff", qty: 1, equipped: true }],
  spellcasting: {
    ability: "int",
    slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } },
    prepared: ["Magic Missile", "Fireball", "Shield", "Mage Armor", "Hold Person"],
    known: [],
    cantrips: ["Fire Bolt"],
    spellbook: ["Magic Missile", "Fireball", "Shield", "Mage Armor", "Hold Person"],
  },
};

const model = await fakeModel();

async function table(fight) {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const mage = world.addHero({ ...WIZARD, name: "Mira" });
  const sword = world.addHero({
    class: "fighter", level: 5, name: "Brann", gold: 50,
    equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Rope", qty: 1 }],
  });
  model.pointAt(world);
  let enemy = null;
  if (fight) {
    await world.beginFight([{ monster: "goblin", count: 2 }], { heroFaces: { [mage.id]: 20, [sword.id]: 19 } });
    enemy = world.enemies()[0];
  } else {
    // A place to stand, someone to talk to and a quest to tick.
    for (const [name, args] of [
      ["move_party", { name: "The Crossroads", layoutDescription: "A signpost where two roads meet.", visionClear: true }],
      ["set_npc", { name: "Orla", attitude: "indifferent", gender: "Female" }],
      ["set_quest", { title: "Find the bell" }],
    ]) {
      const done = await world.invoke(name, args);
      assert.equal(done.ok, true, `${name}: ${done.error}`);
    }
  }
  // The AI acts for a character on their player's word (player-word.ts).
  world.say("player", "I do it.", mage);
  world.say("player", "I do it.", sword);
  return {
    world,
    fixtures: { characterId: mage.id, characterName: "Mira", otherCharacterId: sword.id, otherCharacterName: "Brann", enemyId: enemy?.id ?? null, enemyName: enemy?.name ?? null },
  };
}

const quiet = await table(false);
const fight = await table(true);
const universe = await toolUniverse(quiet.world);
const doors = { quiet: await modelDoor(quiet.world), fight: await modelDoor(fight.world) };
const inFight = new Set(universe.sets.find((set) => set.id === "full/fight").tools.map((tool) => tool.function.name));
const exploring = new Set(universe.sets.find((set) => set.id === "full/explore").tools.map((tool) => tool.function.name));

// A call that goes through at these tables, for the tools whose schema alone
// cannot say what is valid here (a spell the caster has, a square on the
// map). Fixtures for the comparison, not the list of what is walked: a tool
// with no entry is still fuzzed from its required fields.
const BASES = {
  request_roll: (f) => ({ characterId: f.characterId, kind: "skill_check", skill: "perception", dc: 12, reason: "listening at the door" }),
  group_check: () => ({ skill: "stealth", dc: 12, reason: "creeping past" }),
  check_notice: () => ({ dc: 12, reason: "a hidden door" }),
  apply_hazard: (f) => ({ type: "falling", characterIds: [f.characterId], feet: 20, reason: "a pit" }),
  social_check: (f) => ({ characterId: f.characterId, npc: "Orla", approach: "persuade" }),
  relationship_beat: (f) => ({ characterId: f.characterId, subject: "Orla", beat: "helped" }),
  travel: () => ({ hours: 2 }),
  afflict: (f) => ({ characterId: f.characterId, kind: "disease", name: "Cackle Fever" }),
  set_quest: () => ({ title: "Ring the bell" }),
  party_stash: (f) => ({ do: "stow", characterId: f.characterId, item: "Rope" }),
  set_effect: (f) => ({ characterId: f.characterId, name: "Blessing of the Road", modifiers: [{ field: "ac", mode: "add", value: 1 }] }),
  mount_up: (f) => ({ characterId: f.characterId, mount: "Riding horse" }),
  handle_item: (f) => ({ characterId: f.characterId, action: "drop", item: "Rope" }),
  cast_buff: (f) => ({ characterId: f.characterId, spell: "Mage Armor" }),
  apply_damage: (f) => [
    { characterId: f.characterId, amount: 3, reason: "a trap" },
    { tag: "enemy", at: "fight", args: (g) => ({ enemyId: g.enemyId, amount: 3, source: "hazard", reason: "a falling beam" }) },
  ],
  heal: (f) => ({ characterId: f.characterId, amount: 3, reason: "a draught" }),
  party_award: (f) => ({ characterIds: [f.characterId], xp: 50, reason: "the road" }),
  modify_gold: (f) => ({ characterId: f.characterId, delta: 5, reason: "a find" }),
  // A binding condition on a character and on an enemy: the AI's gate asks
  // for a save for both (src/lib/dm/ai-gate.ts).
  set_condition: (f) => [
    { characterId: f.characterId, condition: "prone", reason: "a slip" },
    { tag: "enemy", at: "fight", args: (g) => ({ enemyId: g.enemyId, condition: "paralyzed", reason: "a cold touch" }) },
  ],
  update_sheet: (f) => ({ characterId: f.characterId, alignment: "LG", reason: "a change of heart" }),
  use_spell_slot: (f) => ({ characterId: f.characterId, spell: "Magic Missile", level: 1 }),
  pc_attack: (f) => ({ characterId: f.characterId, attacks: [{ targetEnemyId: f.enemyId, spell: "Fire Bolt" }] }),
  cast_at_enemy: (f) => ({ characterId: f.characterId, targets: [{ targetEnemyId: f.enemyId }], spell: "Hold Person" }),
  aoe_damage: (f) => ({ casterCharacterId: f.characterId, spell: "Fireball", enemyIds: [f.enemyId] }),
  cast_at_player: (f) => ({ characterId: f.characterId, saveAbility: "dex", dc: 12, damage: "1d6", damageType: "fire", reason: "a jet of flame" }),
  move_token: () => ({ token: "Mira", x: 2, y: 2 }),
  set_movement: () => ({ token: "Mira", movement: "walk" }),
  take_action: (f) => ({ characterId: f.characterId, action: "dodge" }),
};

// A tool that is not walked, with the reason.
const SKIP = {
  more_tools: "answered by the turn loop itself (src/lib/dm/turn.ts handleMoreTools), not a handler; scripts/test-tool-profiles.mjs reads it",
};

// ---- what fails today -------------------------------------------------------

const CLASSES = {
  "dropped-id": {
    rule: "An id that names nobody is refused with who there is, as every other tool does (src/lib/dm/tool-errors.ts unknownRef): 'the server never takes the nearest one in its place', and never drops it in silence (#742: aoe_damage given an id that names nobody harmed nobody and reported nothing wrong).",
    where: "the handler's own id filter: src/lib/dm/prompt.ts request_player_input and send_whisper (whispers.ts), hazard-tools.ts apply_hazard, world-tools.ts roll_treasure, explore-tools.ts set_lifestyle",
    severity: "medium",
  },
  "bad-id-accepted": {
    rule: "An id that names nobody is refused with who there is (src/lib/dm/tool-errors.ts unknownRef); the call never goes through as if the field had not been sent.",
    where: "the handler named in the row",
    severity: "medium",
  },
  "no-candidates": {
    rule: "An id that is no character of the party is 'refused with the ones there are by name and id: a bare \"use one from GAME STATE\" sent the model back to search for it, or to give the attack up' (src/lib/dm/tool-errors.ts unknownRef).",
    where: "the handler named in the row",
    severity: "low",
  },
  threw: {
    rule: "A tool handler never throws: 'errors come back as {error} results' (src/lib/dm/mutations.ts), and a refusal names the field and says retry.",
    where: "the handler named in the row",
    severity: "medium",
  },
  "null-is-zero": {
    rule: "null or \"\" for an optional number is the field left out, not zero (#752: 'an improvised action's distance sent as null or empty read as 0 feet and passed the reach check').",
    where: "the handler named in the row (z.coerce.number() reads null and \"\" as 0)",
    severity: "medium",
  },
  "reason-dropped": {
    rule: "A call whose arguments its schema refused says which field and why (src/lib/dm/tool-errors.ts invalidArguments; #875: 'No tool handler answers a refused parse with a fixed line').",
    where: "the handler named in the row",
    severity: "low",
  },
  "gate-bypass": {
    rule: "A binding condition the AI lays on a character is a save the server rolls: 'cannot be made prone by narration alone: it is a save the server rolls. Give saveAbility and saveDc' (src/lib/dm/ai-gate.ts AI_BIND_REFUSAL). The rule holds whichever way the character is named.",
    where: "src/lib/dm/ai-gate.ts bind",
    severity: "high",
  },
  "outcome-lost": {
    rule: "end_encounter records the outcome the call names: 'victory' awards the fight's full XP. A fight can always be ended (encounter-tools.ts), but a readable outcome is not thrown away with an unreadable field beside it.",
    where: "src/lib/dm/encounter-tools.ts end_encounter",
    severity: "medium",
  },
  "ignored-malformed": {
    rule: "A field sent in a shape the tool does not take is refused by name, not read as absent: the call must not go through on arguments the model did not mean.",
    where: "the handler named in the row",
    severity: "low",
  },
};
// row id -> [class, where, note]. The rows the 2026-11-09 repair closed (the
// argument door, src/lib/dm/arg-coerce.ts doorArgs) run as tests.
const KNOWN_ROWS = {
};
const KNOWN = Object.fromEntries(
  Object.entries(KNOWN_ROWS).map(([id, [kind, where, note]]) => [id, { ...CLASSES[kind], where: where ?? CLASSES[kind].where, note }]),
);

// ---- the walk ---------------------------------------------------------------

const tally = { tools: 0, rows: 0, pass: 0, fail: 0, indeterminate: 0, skipped: 0 };
const indeterminateBy = {};
const failed = [];

for (const [name, tool] of universe.byName) {
  if (SKIP[name]) {
    tally.skipped += 1;
    continue;
  }
  tally.tools += 1;
  // A tool a fight offers and exploring does not runs at the fight's table.
  const where = exploring.has(name) && !BASES_IN_FIGHT(name) ? "quiet" : "fight";
  const { fixtures } = where === "quiet" ? quiet : fight;
  const door = doors[where];
  const made = BASES[name] ? BASES[name](fixtures) : baseArgs(tool, fixtures);
  const variants = Array.isArray(made) ? made : [made];
  for (const [variant, entry] of variants.entries()) {
    const variantDoor = entry.at ? doors[entry.at] : door;
    const variantFixtures = entry.at ? (entry.at === "quiet" ? quiet : fight).fixtures : fixtures;
    const base = entry.args ? entry.args(variantFixtures) : entry;
    const tag = variant ? `${name}#${entry.tag}` : name;
    await walk(tag, name, tool, base, variantDoor, variantFixtures, entry.at ?? where);
  }
}

async function walk(tag, name, tool, base, door, fixtures, where) {
  const cache = new Map();
  let unsteady = false;
  const cached = async (key, args) => {
    if (!cache.has(key)) {
      const first = await door.call(name, args);
      // A call that places tokens or draws at random differs from itself:
      // every slip of that tool is compared by what it answers, not by the
      // table after.
      const again = await door.call(name, args);
      if (!sameOutcome(first, again)) unsteady = true;
      cache.set(key, first);
    }
    return cache.get(key);
  };
  const loose = (outcome) => (outcome && unsteady ? { ...outcome, after: "" } : outcome);
  await cached("base", base);

  for (const slip of slipsFor(tool, base, fixtures)) {
    tally.rows += 1;
    const id = `${tag}:${slip.slip}:${slip.field}`;
    const baseOut = await cached("base", base);
    const from = slip.from === "base" ? baseOut : await cached(slip.from, slip.withField);
    // The call with the field left out: the base itself, or the base less
    // the field when the base sends it.
    const omitted = slip.field in base ? await cached(`omit:${slip.field}`, Object.fromEntries(Object.entries(base).filter(([key]) => key !== slip.field))) : baseOut;
    const asTrue = slip.expect === "as-true" ? await cached(`true:${slip.field}`, { ...slip.withField, [slip.field]: true }) : null;
    const got = await door.call(name, slip.args);
    const inert = slip.from !== "base" && sameOutcome(loose(from), loose(baseOut)) && normalised(JSON.stringify(from.result)) === normalised(JSON.stringify(baseOut.result));
    const verdict = judge(slip, { got: loose(got), from: loose(from), omitted: loose(omitted), asTrue: loose(asTrue), inert }, fixtures);
    if (verdict.verdict === "indeterminate") {
      tally.indeterminate += 1;
      indeterminateBy[name] = (indeterminateBy[name] ?? 0) + 1;
    }
    const say = `${tag} [${where}] ${slip.slip} on ${slip.field} (${JSON.stringify(slip.args[slip.field])?.slice(0, 90)}): ${String(verdict.why ?? "").slice(0, 320)}`;
    if (verdict.verdict === "fail") {
      tally.fail += 1;
      failed.push({ id, code: verdict.code, say });
    } else {
      tally.pass += 1;
    }
    if (KNOWN[id]) {
      await gap(id, KNOWN[id], () => assert.notEqual(verdict.verdict, "fail", say));
    } else if (verdict.verdict === "fail") {
      await test(id, () => assert.fail(`${verdict.code}: ${say}`));
    }
  }
}

function BASES_IN_FIGHT(name) {
  return inFight.has(name) && /attack|enemy|token|turn|encounter|legendary|lair|intent|aoe|take_action|use_reaction|cast_at|stabilize|flee|set_movement/.test(name);
}

await test(`the walk covered every tool (${tally.tools}) and ${tally.rows} slips`, () => {
  assert.ok(tally.tools >= 90, `${tally.tools} tools`);
  assert.ok(tally.rows >= 1500, `${tally.rows} slips`);
});

// ---- a thrown handler, through a whole turn ---------------------------------
// handle_item with its item sent as a list throws inside the handler; this
// is what the table gets when the model does it on a real turn.
{
  const id = "turn:handle_item:list-for-one:item";
  const world = quiet.world;
  const mira = quiet.fixtures.characterId;
  const bad = call("handle_item", { characterId: mira, action: "drop", item: ["Rope"] });
  model.script([reply({ calls: [bad] }), reply({ text: "The rope stays where it is." })]);
  const { getDmTurn, getLatestDmTurnId } = await import("../src/lib/db/dm-turns.ts");
  await model.turn(world, "I put my rope down.", mira, world.owner.id);
  const turn = getDmTurn(getLatestDmTurnId(world.campaignId));
  const answers = model.requests.flatMap((request) => model.results(request));
  const answer = answers.find((entry) => entry.id === bad.id)?.result;
  // The slip's rule (list-for-one, the header): the same as the one value,
  // or a retry naming the field. Either way the turn finishes and the model
  // is never handed the handler's crash text.
  const check = () => {
    assert.equal(turn?.status, "done", `the turn ended "${turn?.status}": ${String(turn?.error ?? "").slice(0, 200)}`);
    assert.ok(answer, "the model's call was never answered");
    const asOne = typeof answer.error !== "string";
    assert.ok(asOne || answer.retry === true, `the model was answered ${JSON.stringify(answer)?.slice(0, 200)}`);
    assert.doesNotMatch(String(answer.error ?? ""), /is not a function|TypeError/, "the refusal is the handler's own crash text");
  };
  if (KNOWN[id]) await gap(id, KNOWN[id], check);
  else await test(id, check);
}
// The AI's gate on binding conditions, through a whole turn, by id and by name.
{
  const id = "turn:set_condition:name-for-id";
  const world = quiet.world;
  const mira = quiet.fixtures.characterId;
  const { getDmTurn, getLatestDmTurnId } = await import("../src/lib/db/dm-turns.ts");
  const answers = {};
  for (const [how, ref] of [["id", mira], ["name", "Mira"]]) {
    world.patch(mira, { conditions: [] });
    const sent = call("set_condition", { characterId: ref, condition: "prone", reason: "the floor tilts" });
    model.script([reply({ calls: [sent] }), reply({ text: "The floor tilts under Mira." })]);
    await model.turn(world, "I step onto the tilting floor.", mira, world.owner.id);
    const turn = getDmTurn(getLatestDmTurnId(world.campaignId));
    const answer = model.requests.flatMap((request) => model.results(request)).find((entry) => entry.id === sent.id)?.result;
    answers[how] = { answer, status: turn?.status, prone: (world.sheet(mira).conditions ?? []).some((entry) => /prone/i.test(typeof entry === "string" ? entry : (entry.name ?? ""))) };
  }
  world.patch(mira, { conditions: [] });
  const check = () => {
    assert.equal(answers.id.answer?.retry, true, `by id the gate asks for a save: ${JSON.stringify(answers.id.answer)?.slice(0, 160)}`);
    assert.equal(answers.id.prone, false, "by id nothing is laid");
    assert.ok(
      !(answers.name.answer?.ok === true && answers.name.prone),
      `by name the same call went through and Mira is prone with no save rolled: ${JSON.stringify(answers.name.answer)?.slice(0, 160)}`,
    );
  };
  if (KNOWN[id]) await gap(id, KNOWN[id], check);
  else await test(id, check);
}
model.close();

if (process.env.SWEEP_DUMP) {
  fs.writeFileSync(process.env.SWEEP_DUMP, failed.map((entry) => `${entry.id}\t${entry.code}\t${entry.say}`).join("\n"));
}
const busiest = Object.entries(indeterminateBy).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => `${name} ${count}`).join(", ");
console.log(`  rows: ${tally.rows} slips over ${tally.tools} tools: ${tally.pass - tally.indeterminate} held, ${tally.fail} failed, ${tally.indeterminate} indeterminate (the call the slip was made from is itself refused; most: ${busiest}); skipped ${tally.skipped} tool (${Object.keys(SKIP).join(", ")})`);
quiet.world.close();
finish();
