// A prepared fight's events, as the pure module reads them (issue 685,
// src/lib/dm/fight-event-logic.ts): what a save keeps, the limits, the words
// the GM's plan note and the table read, when each trigger is met, and that
// no event can name a die or a result.
import assert from "node:assert/strict";

const {
  normalizeFightEvents,
  FIGHT_EVENTS_INPUT,
  EXTRAS_INPUT,
  FIGHT_EVENT_LIMITS,
  triggerMet,
  isBloodied,
  hurtTarget,
  outcomeLine,
  fitArrivals,
  eventsUnreadable,
  fitEventsToBoard,
  UNSEEN,
} = await import("../src/lib/dm/fight-event-logic.ts");
const { GROUND_LIMITS, fitGroundTiles, readBoardStamp, sameBoard } = await import("../src/lib/dm/fight-ground-logic.ts");
const { normalizeTemplateExtras, describeExtras, EMPTY_TEMPLATE_EXTRAS } = await import("../src/lib/dm/encounter-template-logic.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
  passed += 1;
}

const roster = [{ monster: "goblin", count: 2 }, { monster: "bugbear", count: 1 }];

test("old rows, with no events at all, read as none", () => {
  assert.deepEqual(normalizeTemplateExtras({ rewards: "12 sp" }, 3).events, []);
  assert.deepEqual(normalizeTemplateExtras(null, 3).events, []);
  assert.deepEqual(EMPTY_TEMPLATE_EXTRAS.events, []);
});

test("an event keeps its trigger and its actions in the order the GM wrote them", () => {
  const events = normalizeFightEvents(
    [
      {
        trigger: { kind: "round", round: 3 },
        actions: [
          { kind: "say", text: "  Horns on the ridge.  " },
          { kind: "reinforce", enemies: [{ monster: "wolf", count: 2 }], at: "entry" },
        ],
      },
    ],
    3,
  );
  assert.deepEqual(events, [
    {
      trigger: { kind: "round", round: 3 },
      actions: [
        { kind: "say", text: "Horns on the ridge." },
        { kind: "reinforce", enemies: [{ monster: "wolf", count: 2 }], at: "entry" },
      ],
    },
  ]);
});

test("a slot past the roster goes, and an event left with nothing to do goes with it", () => {
  const events = normalizeFightEvents(
    [
      { trigger: { kind: "falls", slot: 5 }, actions: [{ kind: "say", text: "gone" }] },
      { trigger: { kind: "falls", slot: 2 }, actions: [{ kind: "hurt", slot: 9, to: "half" }, { kind: "visibility", slot: 1, hidden: false }] },
      { trigger: { kind: "start" }, actions: [{ kind: "hurt", slot: 7, to: "half" }] },
      { trigger: { kind: "start" }, actions: [] },
    ],
    3,
  );
  assert.deepEqual(events, [{ trigger: { kind: "falls", slot: 2 }, actions: [{ kind: "visibility", slot: 1, hidden: false }] }]);
  // A roster cut to two slots takes an event about the third with it.
  const shrunk = normalizeTemplateExtras({ events }, 2).events;
  assert.deepEqual(shrunk, []);
});

test("no action names a die or a result: a forged one is read as nothing, and the route refuses it", () => {
  const raw = [
    {
      trigger: { kind: "round", round: 2 },
      actions: [
        { kind: "roll", die: "d20", face: 20 },
        { kind: "force_dice", faces: [20, 20] },
        { kind: "say", text: "The ogre roars.", dice: [20] },
      ],
    },
  ];
  const events = normalizeFightEvents(raw, 3);
  assert.deepEqual(events, [{ trigger: { kind: "round", round: 2 }, actions: [{ kind: "say", text: "The ogre roars." }] }]);
  assert.equal(JSON.stringify(events).includes("face"), false);
  assert.equal(FIGHT_EVENTS_INPUT.safeParse(raw).success, false, "the route's gate let a die through");
  assert.equal(EXTRAS_INPUT.safeParse({ rewards: "x", events: raw }).success, false);
  assert.equal(EXTRAS_INPUT.safeParse({ rewards: "x", events: events }).success, true);
  assert.equal(eventsUnreadable({ name: "x", extras: { events: raw } }), true);
  assert.equal(eventsUnreadable({ name: "x", extras: { events } }), false);
  assert.equal(eventsUnreadable({ name: "" }), false, "a body with no extras is not refused for its events");
  // The other extras still pass the gate as they did.
  assert.equal(EXTRAS_INPUT.safeParse({ placements: [{ slot: 0, x: 1, y: 1 }], phases: ["a"] }).success, true);
});

test("the limits: eight events, six actions each, eight arrivals in four kinds, words trimmed", () => {
  const many = Array.from({ length: 12 }, () => ({
    trigger: { kind: "start" },
    actions: Array.from({ length: 9 }, () => ({ kind: "say", text: "x".repeat(400) })),
  }));
  const events = normalizeFightEvents(many, 3);
  assert.equal(events.length, FIGHT_EVENT_LIMITS.events);
  assert.equal(events[0].actions.length, FIGHT_EVENT_LIMITS.actions);
  assert.equal(events[0].actions[0].text.length, FIGHT_EVENT_LIMITS.say);
  assert.deepEqual(
    fitArrivals([
      { monster: "wolf", count: 5 },
      { monster: "goblin", count: 5 },
      { monster: "orc", count: 1 },
    ]),
    [
      { monster: "wolf", count: 5 },
      { monster: "goblin", count: 3 },
    ],
  );
  assert.equal(fitArrivals(Array.from({ length: 6 }, (_, index) => ({ monster: `m${index}`, count: 1 }))).length, FIGHT_EVENT_LIMITS.arrivalRows);
});

test("round 1 is the fight starting; a round past twenty is twenty", () => {
  const [first, late] = normalizeFightEvents(
    [
      { trigger: { kind: "round", round: 1 }, actions: [{ kind: "say", text: "a" }] },
      { trigger: { kind: "round", round: 99 }, actions: [{ kind: "say", text: "b" }] },
    ],
    3,
  );
  assert.deepEqual(first.trigger, { kind: "start" });
  assert.deepEqual(late.trigger, { kind: "round", round: FIGHT_EVENT_LIMITS.roundMax });
});

test("the GM's plan note lists each event in plain words, by the roster's names", () => {
  const extras = normalizeTemplateExtras(
    {
      rewards: "40 gp",
      events: [
        { trigger: { kind: "falls", slot: 2 }, actions: [{ kind: "say", text: "The bridge gives way." }, { kind: "visibility", slot: 1, hidden: false }] },
        { trigger: { kind: "round", round: 3 }, actions: [{ kind: "reinforce", enemies: [{ monster: "wolf", count: 2 }], at: "slot", slot: 0 }] },
        { trigger: { kind: "start" }, actions: [{ kind: "hurt", slot: 0, to: "hp", hp: 3 }, { kind: "condition", slot: 1, condition: "prone", remove: false }] },
      ],
    },
    3,
  );
  assert.deepEqual(describeExtras(extras, roster), [
    "Worth: 40 gp",
    'Event: When bugbear falls: the table hears: "The bridge gives way."; goblin 2 appears.',
    "Event: When round 3 begins: wolf x2 join the fight beside goblin 1.",
    "Event: When the fight starts: goblin 1 drops to 3 hit points; goblin 2 is prone.",
  ]);
});

test("each trigger reads the fight as it stands", () => {
  const moment = {
    round: 3,
    slots: new Map([
      [0, { hp: 7, maxHp: 7, defeated: false }],
      [1, { hp: 3, maxHp: 7, defeated: false }],
      [2, { hp: 0, maxHp: 30, defeated: true }],
    ]),
  };
  assert.equal(triggerMet({ kind: "start" }, moment), true);
  assert.equal(triggerMet({ kind: "round", round: 3 }, moment), true);
  assert.equal(triggerMet({ kind: "round", round: 4 }, moment), false);
  assert.equal(triggerMet({ kind: "bloodied", slot: 0 }, moment), false);
  assert.equal(triggerMet({ kind: "bloodied", slot: 1 }, moment), true);
  assert.equal(triggerMet({ kind: "falls", slot: 1 }, moment), false);
  assert.equal(triggerMet({ kind: "falls", slot: 2 }, moment), true);
  // A slot the fight never made (cut to fit the party) never triggers.
  assert.equal(triggerMet({ kind: "falls", slot: 5 }, moment), false);
  // Half of seven is three and a half: three is bloodied, four is not.
  assert.equal(isBloodied({ hp: 4, maxHp: 7 }), false);
  assert.equal(isBloodied({ hp: 3, maxHp: 7 }), true);
});

test("a hurt only takes hit points away, and never to 0", () => {
  assert.equal(hurtTarget({ kind: "hurt", slot: 0, to: "half" }, 30, 30), 15);
  assert.equal(hurtTarget({ kind: "hurt", slot: 0, to: "half" }, 10, 30), null, "already below half stays as it is");
  assert.equal(hurtTarget({ kind: "hurt", slot: 0, to: "hp", hp: 5 }, 30, 30), 5);
  assert.equal(hurtTarget({ kind: "hurt", slot: 0, to: "hp", hp: 50 }, 30, 30), null, "more than it has is no hurt");
  assert.equal(hurtTarget({ kind: "hurt", slot: 0, to: "half" }, 1, 1), null);
});

test("the table's line names a creature the GM keeps off the board as nobody", () => {
  assert.equal(UNSEEN, "Someone unseen");
  assert.equal(outcomeLine({ kind: "hurt", name: UNSEEN, half: true }), "Someone unseen is bloodied.");
  assert.equal(outcomeLine({ kind: "hurt", name: "Grak", half: false }), "Grak is wounded.");
  assert.equal(outcomeLine({ kind: "condition", name: "Goblin 2", condition: "prone", remove: true }), "Goblin 2 is no longer prone.");
  assert.equal(outcomeLine({ kind: "visibility", name: "Goblin 3", hidden: true }), "Someone slips out of sight.");
  assert.equal(outcomeLine({ kind: "visibility", name: "Goblin 3", hidden: false }), "Goblin 3 appears.");
  assert.equal(outcomeLine({ kind: "reinforce", names: ["Wolf 1", "Wolf 2", "Wolf 3"] }), "Wolf 1, Wolf 2 and Wolf 3 join the fight.");
  assert.equal(outcomeLine({ kind: "reinforce", names: ["Wolf 1"] }), "Wolf 1 joins the fight.");
});

// ---- the ground changes (a bridge that falls when the boss does) ----

const bridge = [{ x: 6, y: 5 }, { x: 6, y: 4 }];

test("a change of ground keeps its squares once each, in reading order, and its kind", () => {
  const [event] = normalizeFightEvents(
    [{ trigger: { kind: "falls", slot: 0 }, actions: [{ kind: "ground", tiles: [...bridge, { x: 6, y: 4 }, { x: 6.2, y: 5 }], terrain: "lowwall" }] }],
    3,
  );
  assert.deepEqual(event.actions, [{ kind: "ground", tiles: [{ x: 6, y: 4 }, { x: 6, y: 5 }], terrain: "lowwall" }]);
});

test("a change with no squares, past the board's reach or of a kind the painter has not, is read as nothing", () => {
  const events = normalizeFightEvents(
    [
      {
        trigger: { kind: "start" },
        actions: [
          { kind: "ground", tiles: [], terrain: "wall" },
          { kind: "ground", tiles: bridge, terrain: "lava" },
          { kind: "ground", tiles: [{ x: 300, y: 4 }, { x: -1, y: 2 }, { x: "a", y: 2 }], terrain: "wall" },
          { kind: "say", text: "Nothing moves." },
        ],
      },
    ],
    3,
  );
  assert.deepEqual(events, [{ trigger: { kind: "start" }, actions: [{ kind: "say", text: "Nothing moves." }] }]);
});

test("the limits: a hundred squares a change, and the route's gate refuses more or a kind it does not know", () => {
  const many = Array.from({ length: 150 }, (_, index) => ({ x: (index % 20) + 1, y: Math.floor(index / 20) + 1 }));
  assert.equal(fitGroundTiles(many).length, GROUND_LIMITS.tiles);
  const [event] = normalizeFightEvents([{ trigger: { kind: "start" }, actions: [{ kind: "ground", tiles: many, terrain: "water" }] }], 3);
  assert.equal(event.actions[0].tiles.length, GROUND_LIMITS.tiles);
  const ok = [{ trigger: { kind: "start" }, actions: [{ kind: "ground", tiles: bridge, terrain: "wall" }] }];
  assert.equal(FIGHT_EVENTS_INPUT.safeParse(ok).success, true);
  assert.equal(FIGHT_EVENTS_INPUT.safeParse([{ ...ok[0], actions: [{ kind: "ground", tiles: many, terrain: "wall" }] }]).success, false);
  assert.equal(FIGHT_EVENTS_INPUT.safeParse([{ ...ok[0], actions: [{ kind: "ground", tiles: bridge, terrain: "lava" }] }]).success, false);
  assert.equal(FIGHT_EVENTS_INPUT.safeParse([{ ...ok[0], actions: [{ kind: "ground", tiles: [{ x: 256, y: 1 }], terrain: "wall" }] }]).success, false);
  assert.equal(eventsUnreadable({ extras: { events: [{ ...ok[0], actions: [{ kind: "ground", tiles: bridge, terrain: "lava" }] }] } }), true);
});

test("fitted to the board it is deployed on: squares off the board or on its edge go; with no map the change goes", () => {
  const events = normalizeFightEvents(
    [
      {
        trigger: { kind: "falls", slot: 0 },
        actions: [
          { kind: "ground", tiles: [...bridge, { x: 0, y: 4 }, { x: 11, y: 4 }, { x: 6, y: 9 }, { x: 40, y: 40 }], terrain: "lowwall" },
          { kind: "say", text: "The bridge gives way." },
        ],
      },
      { trigger: { kind: "round", round: 2 }, actions: [{ kind: "ground", tiles: [{ x: 30, y: 30 }], terrain: "wall" }] },
    ],
    3,
  );
  const board = { width: 12, height: 10 };
  assert.deepEqual(fitEventsToBoard(events, board), [
    {
      trigger: { kind: "falls", slot: 0 },
      actions: [
        { kind: "ground", tiles: [{ x: 6, y: 4 }, { x: 6, y: 5 }], terrain: "lowwall" },
        { kind: "say", text: "The bridge gives way." },
      ],
    },
  ]);
  assert.deepEqual(fitEventsToBoard(events, null), [{ trigger: { kind: "falls", slot: 0 }, actions: [{ kind: "say", text: "The bridge gives way." }] }]);
  // The rest of a plan passes untouched.
  const plain = normalizeFightEvents([{ trigger: { kind: "start" }, actions: [{ kind: "hurt", slot: 0, to: "half" }] }], 3);
  assert.deepEqual(fitEventsToBoard(plain, null), plain);
});

test("the board a change was fitted to is known again only by its size and seed", () => {
  const stamp = readBoardStamp({ width: 12, height: 10, seed: 4242 });
  assert.deepEqual(stamp, { width: 12, height: 10, seed: 4242 });
  assert.equal(readBoardStamp(undefined), null);
  assert.equal(readBoardStamp({ width: 0, height: 10, seed: 1 }), null);
  assert.equal(sameBoard(stamp, { width: 12, height: 10, seed: 4242 }), true);
  assert.equal(sameBoard(stamp, { width: 12, height: 10, seed: 7 }), false);
  assert.equal(sameBoard(null, { width: 12, height: 10, seed: 4242 }), false);
});

test("the GM's plan note and the table's line say what the ground does in plain words", () => {
  const extras = normalizeTemplateExtras(
    {
      events: [
        {
          trigger: { kind: "falls", slot: 2 },
          actions: [{ kind: "ground", tiles: bridge, terrain: "lowwall" }, { kind: "say", text: "The bridge gives way." }],
        },
        { trigger: { kind: "round", round: 3 }, actions: [{ kind: "ground", tiles: [{ x: 2, y: 2 }], terrain: "water" }] },
      ],
    },
    3,
  );
  assert.deepEqual(describeExtras(extras, roster), [
    'Event: When bugbear falls: 2 squares of the map become a low wall or ledge; the table hears: "The bridge gives way.".',
    "Event: When round 3 begins: 1 square of the map becomes water.",
  ]);
  assert.equal(outcomeLine({ kind: "ground", terrain: "lowwall", moved: [] }), "The ground gives way.");
  assert.equal(outcomeLine({ kind: "ground", terrain: "wall", moved: ["Goblin 2"] }), "The way is blocked. Goblin 2 is pushed clear.");
  assert.equal(outcomeLine({ kind: "ground", terrain: "water", moved: ["Kara", "Grak"] }), "Water floods the ground. Kara and Grak are pushed clear.");
});

console.log(`test-fight-event-logic: ${passed} passed`);
