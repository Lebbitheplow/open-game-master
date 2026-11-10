// Sibling doors: every way a fight opens, held to what start_encounter does.
//
// A fight is opened by the GM console's form, by the AI's tool call, by the
// AI's run_prepared_encounter, by the GM's Deploy of a prepared fight (the
// dm/encounter-templates/[id]/deploy route) and by the engine itself when a
// companion turns on the party where no fight runs (encounter-tools.ts
// startFightAgainst, registered with turncoat.ts). They all reach one
// handler; what differs is what each door does around it. Two generators:
//
//   1. Initiative. After a door opens a fight, every hero who fights is in
//      the order, or holds an open initiative roll, or the door's answer went
//      to a model that is told to ask them. Walked for every door at an AI-run
//      and a person-run table, with and without a seat on physical dice.
//
//   2. Options. Every option the console's Start a fight form has (read from
//      the catalog entry, src/lib/dm/catalog-combat.ts) can be said at every
//      other door and does the same thing there. An option with no reader
//      below has a written reason in SKIP.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { BROM } from "./lib/sweep-doors.mjs";

const { test, gap, finish } = suite("test-enforce-sweep-doors-openings");

const { ADJUDICATIONS } = await import("../src/lib/dm/invoke-catalog.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");
const turns = await import("../src/lib/db/dm-turns.ts");
const maps = await import("../src/lib/db/battle-maps.ts");
const templates = await import("../src/lib/db/encounter-templates.ts");
const { listSheets } = await import("../src/lib/db/sheets.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const tools = await import("../src/lib/dm/encounter-tools.ts");

const ROSTER = [{ monster: "goblin", count: 2 }];

async function table({ person, realDice }) {
  const world = await openWorld({
    campaign: { maxPlayers: 8, startingLevel: 5 },
    gameSettings: { ttsEnabled: false, ...(realDice ? { dicePolicy: "real_allowed" } : {}) },
  });
  const brom = world.addHero({ user: world.addUser(), ...BROM });
  const kara = world.addHero({ user: world.addUser(), ...BROM, name: "Kara" });
  if (person) {
    assert.ok(campaigns.setDmMode(world.campaignId, "human", world.owner.id)?.dmUserId, "the owner takes the GM's chair");
  }
  if (realDice) {
    campaigns.setMemberRealDice(world.campaignId, kara.userId, true);
  }
  const template = templates.insertEncounterTemplate({
    campaignId: world.campaignId, name: "The Goblin Gate", enemies: ROSTER, battlefield: "", notes: "Two goblins hold the gate.",
    map: { mapId: null, seed: null, theme: null, ambient: null, width: null, height: null, scene: null }, createdByUserId: world.owner.id,
  });
  return { world, brom, kara, template };
}

const aiCall = (t, name, args) => {
  const turn = turns.createDmTurn(t.world.campaignId, [], "ai");
  return invokeEngine(t.world.campaign(), { kind: "ai", turnId: turn.id }, { name, args });
};

// The doors. `model`: whether the door's answer is read by a model (which
// is told to ask for the initiative the server did not). `open(t, options)`
// opens the fight saying `options` the way that door can; a door with no way
// to say an option answers null.
const DOORS = [
  {
    id: "console", model: () => false,
    open: (t, options = {}) => t.world.invoke("start_encounter", { enemies: ROSTER, ...options }),
  },
  {
    id: "ai-tool", model: () => true,
    open: (t, options = {}) => aiCall(t, "start_encounter", { enemies: ROSTER, ...options }),
  },
  {
    id: "ai-prepared", model: () => true,
    says: ["absent", "ambush", "surprised", "distanceFeet", "buildingEnemySide", "buildingOpenings"],
    open: async (t, options = {}) => {
      const turn = turns.createDmTurn(t.world.campaignId, [], "ai");
      const sheets = listSheets(t.world.campaignId);
      const { building, ...rest } = options;
      const result = tools.applyEncounterCall(
        t.world.campaign(), turn, "run_prepared_encounter", JSON.stringify({ name: t.template.name, ...rest, ...(building ? { building } : {}) }),
        sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])), { realDiceUserIds: new Set(), toolCallId: null },
      ).result;
      return typeof result.error === "string" ? { ok: false, error: result.error } : { ok: true, result };
    },
  },
  {
    // The GM's Deploy button: the route's body is all a person can say.
    id: "deploy", model: () => false, personOnly: true,
    open: async (t, options = {}) => {
      const handler = await t.world.route("campaigns/[campaignId]/dm/encounter-templates/[templateId]/deploy");
      t.world.signIn({ id: t.world.owner.id });
      const response = await handler.POST(
        new Request("http://odm.test/deploy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options) }),
        { params: Promise.resolve({ campaignId: t.world.campaignId, templateId: t.template.id }) },
      );
      const body = await response.json();
      return response.status < 300 ? { ok: true, result: body.result ?? body } : { ok: false, error: `${response.status} ${body.error}` };
    },
  },
  {
    // A companion turning on the party where no fight runs: at an AI-run
    // table the next GM turn asks the seats the opening left (turn.ts
    // prepareTurn, issue 503); at a person's table there is no such turn.
    id: "turns-on-the-party", model: (person) => !person, says: [],
    open: async (t) => {
      const result = tools.startFightAgainst(t.world.campaign(), "goblin", "A goblin turns on the party");
      return typeof result.error === "string" ? { ok: false, error: result.error } : { ok: true, result };
    },
  },
];

// ---- 1. initiative ----

const KNOWN_INITIATIVE = {};

const INITIATIVE_RULE = "SRD 5.1, Initiative: \"When combat starts, every participant makes a Dexterity check to determine their place in the initiative order.\" Every door that opens a fight sees that every hero is asked.";

for (const door of DOORS) {
  for (const person of [false, true]) {
    if (door.personOnly && !person) {
      continue;
    }
    for (const realDice of [false, true]) {
      const id = `initiative|${door.id}|${person ? "person" : "ai-run"}|${realDice ? "real" : "server"}`;
      const run = async () => {
        const t = await table({ person, realDice });
        t.world.diceLog();
        const out = await door.open(t);
        assert.ok(out.ok, `${door.id} could not open a plain fight: ${out.error}`);
        const encounter = t.world.encounter();
        assert.ok(encounter, "a fight is running");
        const placed = new Set(encounter.order.map((entry) => entry.characterId).filter(Boolean));
        const asked = new Set(turns.listOpenPendingRolls(t.world.campaignId).filter((roll) => roll.kind === "initiative").map((roll) => roll.characterId));
        const told = door.model(person) ? JSON.stringify(out.result) : "";
        const left = [t.brom, t.kara].filter((hero) => !placed.has(hero.id) && !asked.has(hero.id) && !(told.includes("request_roll") && told.includes(hero.name)));
        // A seat on physical dice is never rolled for by the server.
        if (realDice) {
          assert.ok(!placed.has(t.kara.id), `${door.id} rolled initiative on the server's dice for Kara, whose seat rolls its own`);
        }
        // At an AI-run table the next GM turn asks whoever a fight no model
        // opened has left (turn.ts prepareTurn): nobody is left for good.
        const selfHeals = door.id === "turns-on-the-party" && !person;
        assert.deepEqual(selfHeals ? [] : left.map((hero) => hero.name), [], `${door.id} opened a fight and neither placed nor asked: order [${encounter.order.map((entry) => entry.name).join(", ")}], open initiative rolls ${asked.size}`);
        // Everyone at the fight stands on the board.
        const map = maps.getBattleMapForEncounter(encounter.id);
        assert.ok(map, "the fight has a board");
        const tokens = new Set(maps.listTokens(map.id).map((token) => token.refId));
        const missing = [t.brom.id, t.kara.id, ...t.world.enemies().map((enemy) => enemy.id)].filter((ref) => !tokens.has(ref));
        assert.deepEqual(missing, [], `${door.id}: creatures of the fight with no token`);
      };
      if (KNOWN_INITIATIVE[id]) {
        await gap(id, { rule: INITIATIVE_RULE, ...KNOWN_INITIATIVE[id] }, run);
      } else {
        await test(id, run);
      }
    }
  }
}

// ---- 2. options ----

// What each option does, read off the fight it opened. `value(t)` is what
// the form sends; `took(t, encounter)` whether the fight shows it.
const OPTIONS = {
  absent: {
    value: (t) => [t.kara.id],
    took: (t, encounter) => encounter.awayIds.includes(t.kara.id) && !encounter.order.some((entry) => entry.characterId === t.kara.id),
    says: "Kara is away from the fight (awayIds), with no place in the order",
  },
  surprised: {
    // The foes, not the party: a wholly surprised party's round is played
    // out and forgotten as the fight opens, which leaves nothing to read.
    value: () => "enemies",
    took: (t, encounter) => t.world.enemies().length > 0 && t.world.enemies().every((enemy) => encounter.surprisedIds.includes(enemy.id)),
    says: "both goblins are surprised (surprisedIds)",
  },
  scene: {
    value: () => "cave",
    took: (t, encounter) => maps.getBattleMapForEncounter(encounter.id).outdoors === false,
    says: "the board is underground (not outdoors)",
  },
};

const SKIP = {
  ambush: "decided by the ambushers' Stealth dice against passive Perception, rolled for real: no fixed outcome to read",
  buildingEnemySide: "a drawn building has no single field to read; held by scripts/test-fight-building*.mjs for start_encounter",
  buildingOpenings: "as buildingEnemySide",
  lair: "needs a creature with lair actions (a content pack row); the dummies have none",
  from: "which edge the foes come from: no fixed square to read on a generated board",
  distanceFeet: "the board is generated, and a plain fight's opening distance already varies around the asked one: no steady reading",
};

const KNOWN_OPTIONS = {};

const OPTION_RULE = "One rule at every door: an option the Start a fight form takes (who is absent, who is surprised, how far off the foes stand, the ground) is taken wherever a fight is opened, as issues 784 and 808 made run_prepared_encounter take absent and building.";

const formFields = ADJUDICATIONS.find((entry) => entry.name === "start_encounter").fields.map((field) => field.name).filter((name) => !["enemies", "summary"].includes(name));

await test("every option of the Start a fight form has a reader here or a written reason", () => {
  const unread = formFields.filter((name) => !OPTIONS[name] && !SKIP[name]);
  assert.deepEqual(unread, [], "a new option of start_encounter: give it a reader in OPTIONS or a reason in SKIP");
  const stale = [...Object.keys(OPTIONS), ...Object.keys(SKIP)].filter((name) => !formFields.includes(name));
  assert.deepEqual(stale, [], "an option the form no longer has");
});

for (const option of formFields.filter((name) => OPTIONS[name])) {
  const reader = OPTIONS[option];
  // The control: the console's own form shows the option's effect, and a
  // fight opened without it does not.
  await test(`option|${option}|control`, async () => {
    const plain = await table({ person: true, realDice: false });
    assert.ok((await DOORS[0].open(plain)).ok);
    assert.equal(reader.took(plain, plain.world.encounter()), false, `a plain fight already shows "${reader.says}", so the reader proves nothing`);
    const said = await table({ person: true, realDice: false });
    const out = await DOORS[0].open(said, { [option]: reader.value(said) });
    assert.ok(out.ok, `the console refused ${option}: ${out.error}`);
    assert.equal(reader.took(said, said.world.encounter()), true, `the console's form sent ${option} and the fight does not show: ${reader.says}`);
  });
  for (const door of DOORS.slice(1)) {
    const id = `option|${option}|${door.id}`;
    if (door.says && door.says.length === 0) {
      // The engine's own opening takes no words from anyone.
      continue;
    }
    const run = async () => {
      const t = await table({ person: door.id === "deploy", realDice: false });
      const out = await door.open(t, { [option]: reader.value(t) });
      assert.ok(out.ok, `${door.id} refused a fight with ${option}: ${out.error}`);
      assert.equal(reader.took(t, t.world.encounter()), true, `${door.id} was told ${option} = ${JSON.stringify(reader.value(t))} and the fight does not show it (${reader.says})`);
    };
    if (KNOWN_OPTIONS[id]) {
      await gap(id, { rule: OPTION_RULE, ...KNOWN_OPTIONS[id] }, run);
    } else {
      await test(id, run);
    }
  }
}

console.log(`openings: ${DOORS.length} doors, ${formFields.length} options of the form (${Object.keys(SKIP).length} skipped with a reason)`);
finish();
