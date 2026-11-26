// A player's turn ends where the table was told it ends. pc_attack's
// endTurn ends it with the attack (encounter-tools.ts endTurnAfterAttack),
// and a narration that hands the turn on ("It is now Kara's turn") ends it
// after the narration although the model never called end_turn (claims.ts
// turnOverFor, turn.ts). A narration that asks what they do next, or asks
// whether they end the turn, ends nothing in any language, and neither does
// one from a turn that asked that player for their answer (issue 761). The
// player's own words ("...then I end my turn") end it too, once the DM ruled
// on what they did (claims.ts readTurnEndInWords); English words that only
// keep it open answer without the reader. And a later
// reply in the same turn that recalls a swing the turn already rolled is not
// sent back as a blow nobody rolled (engine-boundary.ts resolveOutcomes, the
// turn budget's struck swings).
//
// On the skirmish smoke (2026-10-20) gpt-oss-20b and Qwen3.6-35B wrote "Your
// turn ends. It's now Avery's move." with no end_turn, so the next player's
// line went to the same character, round after round; and Qwen, asked to
// attack again on a spent turn, recalled its hit, was told no tool rolled
// it, and rewrote the hit into a miss.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { aiEngine, call, fakeModel, held, reply, settleQueue } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-enforce-turn-handoff");
const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { ttsEnabled: false } });
const kit = await combatKit(world);
const model = await fakeModel();
model.pointAt(world);
const ai = await aiEngine(world);
const { updateGameSettings } = await import("../src/lib/db/campaigns.ts");

const hero = (name) =>
  world.addHero({
    name,
    class: "fighter",
    level: 3,
    abilities: { str: 16, dex: 12 },
    proficiencies: TRAINED,
    equipment: [{ name: "Longsword", qty: 1, equipped: true }],
    maxHp: 60,
  });
const avery = hero("Avery");
const kara = hero("Kara");

const current = () => {
  const encounter = world.encounter();
  const entry = encounter?.orderReady ? encounter.order[encounter.turnIndex] : null;
  return entry?.kind === "pc" ? entry.characterId : null;
};
const corrections = () =>
  model.requests.flatMap((request) =>
    request.messages.filter((message) => message.role === "user" && String(message.content).startsWith("[System]")),
  );

// One sturdy goblin beside Avery, whose turn it is; Kara acts next and the
// goblin last.
async function stage() {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [avery.id]: 20, [kara.id]: 15 } });
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { maxHp: 400 });
  kit.place(avery.id, 5, 5);
  kit.place(kara.id, 5, 8);
  kit.place(goblin.id, 6, 5);
  kit.giveTurn(avery.id);
  return goblin;
}

async function playerTurn(line, entries, claims = []) {
  model.claims(claims);
  model.script(entries);
  const message = await model.turn(world, line, avery.id, avery.userId);
  await settleQueue(world.campaignId);
  world.clearDice();
  return message;
}

await test("pc_attack with endTurn ends the attacker's turn with the attack, and its result names who acts next", async () => {
  const goblin = await stage();
  world.dice(15, 4);
  await playerTurn("I cut at the goblin, then I end my turn.", [
    reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Longsword", endTurn: true })] }),
    reply({ text: "Avery's longsword bites, and Avery falls back a step." }),
  ]);
  const attack = model.requests[1] && model.results(model.requests[1]).at(-1)?.result;
  assert.match(String(attack?.turnEnded?.note ?? ""), /Avery's turn is over/, JSON.stringify(attack));
  assert.equal(current(), kara.id, "the pointer stayed on Avery");
});

// The model's own endTurn on one swing of a level 5 fighter's Attack action:
// the player said only "I attack", and Extra Attack's second swing went with
// the turn. The player's own "then I end my turn" still ends it.
await test("pc_attack's endTurn keeps the turn open while Extra Attack's swing is left, unless the player's words end it", async () => {
  const goblin = await stage();
  world.patch(avery.id, { level: 5 });
  try {
    world.dice(15, 4);
    await playerTurn("I attack the goblin.", [
      reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Longsword", endTurn: true })] }),
      reply({ text: "Avery's longsword bites." }),
    ]);
    const attack = model.requests[1] && model.results(model.requests[1]).at(-1)?.result;
    assert.equal(current(), avery.id, "the model's endTurn took the second attack of Extra Attack");
    assert.match(String(attack?.turnNotEnded ?? ""), /1 attack of this turn's Attack action/, JSON.stringify(attack));
    const second = await stage();
    world.patch(avery.id, { level: 5 });
    world.dice(15, 4);
    await playerTurn("I cut at the goblin once, then I end my turn.", [
      reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: second.id, weapon: "Longsword", endTurn: true })] }),
      reply({ text: "Avery's longsword bites, and Avery falls back a step." }),
    ]);
    const ended = model.requests.at(-1) && model.results(model.requests.at(-1)).at(-1)?.result;
    assert.match(String(ended?.turnEnded?.note ?? ""), /Avery's turn is over/, JSON.stringify(ended));
    assert.equal(current(), kara.id, "the player's own words ended nothing");
  } finally {
    world.patch(avery.id, { level: 3 });
  }
});

await test("approach with endTurn: a walk that falls short ends the turn as the player asked, nothing attacked", async () => {
  const goblin = await stage();
  kit.place(goblin.id, 16, 5);
  await playerTurn("I close in on the goblin and attack it, then I end my turn.", [
    reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Longsword", approach: true, endTurn: true })] }),
    reply({ text: "Avery charges across the stones but cannot reach the goblin before the moment passes." }),
  ]);
  const attack = model.results(model.requests[1]).at(-1)?.result;
  assert.equal(attack?.outOfReach, true, JSON.stringify(attack));
  assert.ok(attack?.turnEnded, "the short walk did not end the turn");
  assert.equal(kit.enemy(goblin.id).currentHp, 400);
  assert.equal(current(), kara.id);
});

await test("approach walks nobody into a swing something else refuses, and that refusal ends no turn", async () => {
  // Qwen3.6-35B sent a fighter's approach and endTurn with a monk's bonus
  // strike: he was walked, refused, and lost the turn.
  const goblin = await stage();
  kit.place(goblin.id, 9, 5);
  await playerTurn("I rush the goblin and strike, then I end my turn.", [
    reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Longsword", approach: true, endTurn: true, bonusAttack: "martial arts" })] }),
    reply({ text: "Avery hesitates." }),
  ]);
  const attack = model.results(model.requests[1]).at(-1)?.result;
  assert.match(String(attack?.error ?? ""), /Martial Arts/, JSON.stringify(attack));
  assert.deepEqual([kit.token(avery.id).x, kit.token(avery.id).y], [5, 5], "Avery walked for a swing that was refused anyway");
  assert.equal(attack?.turnEnded, undefined);
});

await test("A narration that hands the turn on ends it after the narration, though the model never called end_turn", async () => {
  await stage();
  const text = "Avery feints and slips clear of the goblin's blade. It is now Kara's turn.";
  await playerTurn("I feint and slip clear.", [reply({ text })], [[{ kind: "turn_over", quote: "It is now Kara's turn." }]]);
  assert.ok(model.readerRequests.some((request) => String(request.messages?.[1]?.content ?? "").includes("turn_over")), "the reader was never asked whether the turn was handed on");
  assert.equal(current(), kara.id, "the table was told it is Kara's turn and the pointer stayed on Avery");
});

// Extra Attack is part of the Attack action the player took: the prose
// telling the turn over after one swing is not the player ending it, and the
// fighter's second attack went with it (issue 761's kin).
await test("A narration that hands the turn on ends nothing while the Attack action has a swing of Extra Attack left", async () => {
  const goblin = await stage();
  world.patch(avery.id, { level: 5 });
  try {
    world.dice(15, 4);
    await playerTurn(
      "I attack the goblin.",
      [
        reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Longsword" })] }),
        reply({ text: "Avery's blade bites into the goblin. It is now Kara's turn." }),
      ],
      [[{ kind: "turn_over", quote: "It is now Kara's turn." }], [{ kind: "turn_over", quote: "It is now Kara's turn." }]],
    );
    assert.equal(current(), avery.id, "the second attack of Extra Attack was lost to the narration");
    assert.equal(world.encounter().turnBudget?.attacksMade, 1, "one swing made");
  } finally {
    world.patch(avery.id, { level: 3 });
  }
});

// Issue 966: a two-weapon fighter's scimitar swing was narrated as the whole
// turn ("Your turn ends."), the enemies went, and the shortsword's off-hand
// attack, a bonus action the Attack action had earned, was lost with the
// fighter's life. The turn stays theirs, and the story does not tell it over.
const PAIR = [
  { name: "Scimitar", qty: 1, equipped: true },
  { name: "Shortsword", qty: 1, equipped: true },
];
const LONGSWORD = [{ name: "Longsword", qty: 1, equipped: true }];

await test("A narration that hands the turn on ends nothing while the Attack action's off-hand attack is open, and the hand-off is cut from the story", async () => {
  const goblin = await stage();
  world.patch(avery.id, { equipment: PAIR });
  try {
    world.dice(15, 4);
    const message = await playerTurn(
      "I attack the goblin with my Scimitar.",
      [
        reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Scimitar" })] }),
        reply({ text: "Avery's scimitar bites deep into the goblin's side, and it staggers back. Your turn ends." }),
      ],
      [[{ kind: "turn_over", quote: "Your turn ends." }], [{ kind: "turn_over", quote: "Your turn ends." }]],
    );
    assert.equal(current(), avery.id, "the off-hand attack two-weapon fighting earned was lost to the narration");
    assert.equal(world.encounter().turnBudget?.bonusUsed, false);
    assert.ok(message && !/Your turn ends/.test(message.content), `the story still tells the kept turn over: ${message?.content}`);
    assert.match(message?.content ?? "", /scimitar bites deep/, "the rest of the story was cut with the hand-off");
    // Once the bonus action is spent, the hand-off ends the turn as before.
    world.dice(15, 4);
    await playerTurn(
      "I follow up with my Shortsword.",
      [
        reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Shortsword", offHand: true })] }),
        reply({ text: "The shortsword finds the goblin's ribs. It is now Kara's turn." }),
      ],
      [[{ kind: "turn_over", quote: "It is now Kara's turn." }], [{ kind: "turn_over", quote: "It is now Kara's turn." }]],
    );
    assert.equal(current(), kara.id, "the hand-off after the off-hand attack ended nothing");
  } finally {
    world.patch(avery.id, { equipment: LONGSWORD });
  }
});

await test("pc_attack's endTurn keeps the turn open while the off-hand attack is open, unless the player's words end it", async () => {
  const goblin = await stage();
  world.patch(avery.id, { equipment: PAIR });
  try {
    world.dice(15, 4);
    await playerTurn("I attack the goblin with my Scimitar.", [
      reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Scimitar", endTurn: true })] }),
      reply({ text: "Avery's scimitar bites." }),
    ]);
    const attack = model.requests.at(-1) && model.results(model.requests.at(-1)).at(-1)?.result;
    assert.equal(current(), avery.id, "the model's endTurn took the off-hand attack");
    assert.match(String(attack?.turnNotEnded ?? ""), /off-hand attack with Shortsword/, JSON.stringify(attack));
    const second = await stage();
    world.dice(15, 4);
    await playerTurn("I slash at the goblin with my Scimitar, then I end my turn.", [
      reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: second.id, weapon: "Scimitar", endTurn: true })] }),
      reply({ text: "Avery's scimitar bites, and Avery falls back a step." }),
    ]);
    assert.equal(current(), kara.id, "the player's own words ended nothing");
  } finally {
    world.patch(avery.id, { equipment: LONGSWORD });
  }
});

await test("A narration that asks what they do next ends nothing", async () => {
  await stage();
  await playerTurn("I feint at the goblin.", [reply({ text: "Avery feints, and the goblin flinches back. What does Avery do with the rest of the turn?" })], [[]]);
  assert.equal(current(), avery.id, "a question about the rest of the turn ended it");
});

// Issue 761, at an Italian table on 0.33.0: the GM offered the fighter's last
// step in a question, the reader read the turn handed on, and it ended before
// the player could answer.
await test("A narration that asks whether they end the turn ends nothing, though the reader read it as handed on, in any language", async () => {
  updateGameSettings(world.campaignId, { tableLanguage: "italian" });
  const goblin = await stage();
  kit.place(goblin.id, 15, 5);
  await playerTurn(
    "Attacco il goblin.",
    [
      reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Longsword" })] }),
      reply({ text: "Il goblin è troppo lontano per la spada di Avery. Avery, ti resta giusto un passo: lo usi o chiudi qui il turno?" }),
    ],
    [[{ kind: "turn_over", quote: "chiudi qui il turno" }], []],
  );
  updateGameSettings(world.campaignId, { tableLanguage: "english" });
  assert.equal(current(), avery.id, "the question about ending the turn ended it");
});

await test("A narration read as handing the turn on ends nothing when the same turn asked that player for their answer", async () => {
  const goblin = await stage();
  kit.place(goblin.id, 15, 5);
  await playerTurn(
    "I swing at the goblin.",
    [
      reply({
        calls: [
          call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Longsword" }),
          call("request_player_input", { characterIds: [avery.id], prompt: "Use the last step, or stop here?" }),
        ],
      }),
      reply({ text: "The goblin is too far off for Avery's blade. One step is left, and the turn ends with it." }),
    ],
    [[{ kind: "turn_over", quote: "the turn ends with it" }], []],
  );
  assert.equal(current(), avery.id, "the GM asked Avery's player and the turn passed before they answered");
});

const wordsRead = () => model.readerRequests.some((request) => String(request.messages?.[1]?.content ?? "").includes("Player's words:"));

await test("The player's own words end the turn once the DM ruled on what they did, though nothing else ended it", async () => {
  const goblin = await stage();
  kit.place(goblin.id, 15, 5);
  const ruled = [
    reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Longsword" })] }),
    reply({ text: "The goblin is too far off for Avery's blade to reach. What does Avery do?" }),
  ];
  // Plain English needs no reader call.
  await playerTurn("I close in on the goblin and attack it, then I end my turn.", ruled, [[]]);
  assert.equal(wordsRead(), false, "plain English was sent to the reader");
  assert.equal(current(), kara.id, "the player ended the turn and it stayed open");
  // Any other language is the reader's to read.
  const again = await stage();
  kit.place(again.id, 15, 5);
  await playerTurn(
    "Me acerco al goblin y lo ataco, y termino mi turno.",
    [
      reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: again.id, weapon: "Longsword" })] }),
      reply({ text: "The goblin is too far off for Avery's blade to reach. What does Avery do?" }),
    ],
    [[], [{ kind: "turn_over", quote: "y termino mi turno." }]],
  );
  assert.equal(wordsRead(), true, "the player's words were never read");
  assert.equal(current(), kara.id, "the player ended the turn in Spanish and it stayed open");
});

await test("The English phrases are read at an English table only: at every other table the player's words, English ones included, are the reader's to read", async () => {
  const wordReads = () => model.readerRequests.filter((request) => String(request.messages?.[1]?.content ?? "").includes("Player's words:")).length;
  const swing = (goblin) => [
    reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Longsword" })] }),
    reply({ text: "The goblin is too far off for Avery's blade to reach. What does Avery do?" }),
  ];
  for (const language of ["italian", "french", "spanish", "german"]) {
    updateGameSettings(world.campaignId, { tableLanguage: language });
    // The reader reads no end in them: the turn stays open.
    const goblin = await stage();
    kit.place(goblin.id, 15, 5);
    await playerTurn(`I close in on the goblin and attack it, then I end my turn (${language}, first).`, swing(goblin), [[], []]);
    assert.equal(wordReads(), 1, `${language}: the words were not sent to the reader`);
    assert.equal(current(), avery.id, `${language}: the English phrase ended the turn without the reader`);
    // The reader reads the end: the turn ends.
    const again = await stage();
    kit.place(again.id, 15, 5);
    await playerTurn(`I close in on the goblin and attack it, then I end my turn (${language}, second).`, swing(again), [[], [{ kind: "turn_over", quote: "then I end my turn" }]]);
    assert.equal(current(), kara.id, `${language}: the reader read the end and the turn stayed open`);
  }
  updateGameSettings(world.campaignId, { tableLanguage: "english" });
});

// Issue 966: the helper model read "I use Second Wind as a bonus action." as
// the end of the fighter's turn. At an English table a reader's end on words
// that only declare an action or a bonus action ends nothing.
await test("At an English table a reader's turn end on words that only declare a bonus action ends nothing", async () => {
  const swing = (goblin) => [
    reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Longsword" })] }),
    reply({ text: "The goblin is too far off for Avery's blade to reach. What does Avery do?" }),
  ];
  const goblin = await stage();
  kit.place(goblin.id, 15, 5);
  await playerTurn("I use Second Wind as a bonus action.", swing(goblin), [[], [{ kind: "turn_over", quote: "I use Second Wind as a bonus action." }]]);
  assert.equal(current(), avery.id, "a bonus action read as the end of the turn ended it");
  const again = await stage();
  kit.place(again.id, 15, 5);
  await playerTurn("Over to the goblin.", swing(again), [[], [{ kind: "turn_over", quote: "Over to the goblin." }]]);
  assert.equal(current(), kara.id, "a phrasing the pattern does not hold, read by the reader, ended nothing");
});

await test("The player's words end nothing when the DM only asked them a question", async () => {
  await stage();
  await playerTurn("I attack it, then I end my turn.", [reply({ text: "Which of them, Avery: the goblin on the left or the one on the ledge?" })], [[], [{ kind: "turn_over", quote: "then I end my turn." }]]);
  assert.equal(wordsRead(), false, "words were read on a turn nothing was ruled on");
  assert.equal(current(), avery.id);
});

await test("The player's words that keep the turn open keep it, though the DM ruled on what they did", async () => {
  const goblin = await stage();
  kit.place(goblin.id, 15, 5);
  await playerTurn(
    "I close in on the goblin and attack it. Don't end my turn yet, I want to move after.",
    [
      reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Longsword" })] }),
      reply({ text: "The goblin is too far off for Avery's blade to reach. What does Avery do?" }),
    ],
    // A reader that misreads them is never asked (issue 761).
    [[], [{ kind: "turn_over", quote: "Don't end my turn yet" }]],
  );
  assert.equal(wordsRead(), false, "the words that already answered were sent to the reader");
  assert.equal(current(), avery.id, "the words that kept the turn open ended it");
});

await test("A later reply that recalls this turn's own swing is not sent back as a blow nobody rolled", async () => {
  const goblin = await stage();
  world.say("player", "I cut at the goblin.", world.sheet(avery.id));
  world.dice(19, 4);
  const swing = await ai.invoke("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Longsword" });
  world.clearDice();
  assert.equal(swing.result?.hit, true, swing.error);
  const dealt = swing.result.damage;
  const text = `Avery's earlier cut already bit the goblin for ${dealt} damage, and Avery eases back.`;
  await playerTurn(
    "I ease back from it.",
    [reply({ text })],
    [[
      { kind: "hit", target: "goblin", quote: "Avery's earlier cut already bit the goblin" },
      { kind: "amount", value: dealt, of: "damage", quote: `for ${dealt} damage` },
    ]],
  );
  assert.deepEqual(corrections().map((message) => String(message.content).slice(0, 80)), [], "the recalled swing was sent back");
  assert.equal(model.served(), 1);
  assert.equal(current(), avery.id);
});

// Issues 1099 and 1101: the reply that opened a fight told its first
// character the turn was theirs ("Jason (12) > The Sentry (12). It is your
// turn."), the reader read that as the turn handed on, and the player's turn
// ended before they had one: the enemies went and the round turned over. A
// line written before the fight ("...seeing if they're approaching") counted
// as the player's word for that turn, and so did a card played while the
// opening was still being narrated.
const { englishOwnTurn } = await import("../src/lib/dm/claims-logic.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { allocateSeq } = await import("../src/lib/db/campaigns.ts");

await test("Words that tell the acting character the turn is theirs are no hand-off; words that end it still are", () => {
  for (const quote of ["It is your turn.", "It's your turn. What do you do?", "Jason (12) > The Sentry (12). It is your turn.", "Jason, you're up.", "It is Jason's turn now.", "The sentry's turn is done; it is your turn.", "You act first."]) {
    assert.equal(englishOwnTurn(quote, "Jason"), true, quote);
  }
  for (const quote of ["Your turn ends.", "Your turn is over. The goblins act next.", "It is now Bram's turn.", "The goblins act next.", "That ends Jason's turn.", "Jason's turn is done."]) {
    assert.equal(englishOwnTurn(quote, "Jason"), false, quote);
  }
});

await test("A fight the DM turn itself opens: the line that tells its first character the turn is theirs ends nothing, in any language", async () => {
  for (const language of ["english", "italian"]) {
    updateGameSettings(world.campaignId, { tableLanguage: language });
    await kit.endFight();
    // The goblin's initiative, then Avery's and Kara's.
    world.dice(3, 20, 5);
    const text = "A goblin breaks from the tree line, blade out. Avery is quickest. It is your turn. What do you do?";
    const message = await playerTurn(
      `I watch the tree line, seeing if they are approaching or running away (${language}).`,
      [reply({ calls: [call("start_encounter", { enemies: [{ monster: "goblin", count: 1 }], summary: "A goblin at the tree line" })] }), reply({ text })],
      // The reader reads the announcement as a hand-off, as it did in the reports.
      [[{ kind: "turn_over", quote: "It is your turn." }], [{ kind: "turn_over", quote: "It is your turn." }]],
    );
    const fight = world.encounter();
    assert.equal(fight?.orderReady, true, `${language}: the fight never opened`);
    assert.equal(fight.round, 1, `${language}: the round turned over on the fight's opening`);
    assert.equal(current(), avery.id, `${language}: the turn the fight opened on was ended by its own announcement`);
    assert.match(message?.content ?? "", /It is your turn\./, `${language}: the announcement was cut from the story`);
  }
  updateGameSettings(world.campaignId, { tableLanguage: "english" });
});

await test("A fight the DM turn opens and resolves a declared attack in is still handed on by its narration", async () => {
  await kit.endFight();
  // The ogre's initiative, Avery's and Kara's, then Avery's swing.
  world.dice(3, 20, 5, 15, 4);
  await playerTurn(
    "I charge the ogre and cut at it with my longsword.",
    [
      reply({ calls: [call("start_encounter", { enemies: [{ monster: "ogre", count: 1 }], summary: "An ogre on the road", distanceFeet: 5 })] }),
      reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: "Ogre", weapon: "Longsword", approach: true })] }),
      reply({ text: "Avery's longsword bites into the ogre's hide. It is now Kara's turn." }),
    ],
    [[{ kind: "turn_over", quote: "It is now Kara's turn." }], [{ kind: "turn_over", quote: "It is now Kara's turn." }]],
  );
  const swing = model.results(model.requests.at(-1)).at(-1)?.result;
  assert.equal(swing?.error, undefined, JSON.stringify(swing));
  assert.equal(current(), kara.id, "a turn the fight opened on, attacked in and told over stayed open");
});

await test("In a running fight, words that tell the waiting character the turn is theirs hand nothing on and stay in the story", async () => {
  await stage();
  const text = "Avery shifts his grip and eyes the goblin. It is your turn, Avery. What do you do?";
  const message = await playerTurn("I size the goblin up.", [reply({ text })], [[{ kind: "turn_over", quote: "It is your turn, Avery." }]]);
  assert.equal(current(), avery.id, "the turn was ended by the words that gave it");
  assert.match(message?.content ?? "", /It is your turn, Avery\./, "the words were cut from the story");
});

await test("A card played while the DM turn was already running is not the word its narration answers", async () => {
  await stage();
  // Kara speaks out of turn; Avery, whose turn it is, has said nothing when the DM turn begins.
  const slow = held(reply({ text: "Kara calls a warning across the stones. The goblins act next." }));
  model.claims([[{ kind: "turn_over", quote: "The goblins act next." }], [{ kind: "turn_over", quote: "The goblins act next." }]]);
  model.script([slow.entry]);
  const seq = allocateSeq(world.campaignId);
  insertCampaignMessage({ campaignId: world.campaignId, seq, authorType: "player", userId: kara.userId, characterId: kara.id, content: "\"Watch the ledge, Avery!\"" });
  const { startDmTurn } = await import("../src/lib/dm/turn.ts");
  const running = startDmTurn(world.campaignId);
  // The reply is on its way when Avery's player plays a card from the Hand.
  for (let waited = 0; waited < 400 && model.served() < 1; waited += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const [goblin] = world.enemies();
  insertCampaignMessage({
    campaignId: world.campaignId,
    seq: allocateSeq(world.campaignId),
    authorType: "player",
    userId: avery.userId,
    characterId: avery.id,
    content: "I attack the goblin with my Longsword.",
    intent: { card: "attack", targetKind: "enemy", targetId: goblin.id, targetName: goblin.displayName },
  });
  slow.release();
  await running;
  assert.equal(current(), avery.id, "a card the narration never read let that narration end its player's turn");
  await settleQueue(world.campaignId);
  world.clearDice();
});

// Issue 1104: a two-weapon fighter's scimitar card was answered with the
// model's own end_turn. The enemy went, and the Second Wind the player played
// next came back as "the fight moved on before the GM answered it".
await test("The AI's own end_turn is refused while the Attack action's off-hand attack is open, and ends the turn once the player's words do", async () => {
  const goblin = await stage();
  world.patch(avery.id, { equipment: PAIR });
  try {
    world.dice(15, 4);
    const ending = call("end_turn", { characterId: avery.id });
    await playerTurn("I attack the goblin with my Scimitar.", [
      reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Scimitar" })] }),
      reply({ calls: [ending] }),
      reply({ text: "Avery's scimitar bites deep. What does Avery do?" }),
    ], [[]]);
    const refused = model.requests.flatMap((request) => model.results(request)).find((entry) => entry.id === ending.id)?.result;
    assert.match(String(refused?.error ?? ""), /off-hand attack with Shortsword.*stays open/, JSON.stringify(refused));
    assert.equal(refused?.retry, true);
    assert.equal(current(), avery.id, "the model's end_turn took the off-hand attack");
    const second = await stage();
    world.dice(15, 4);
    await playerTurn("I slash at the goblin with my Scimitar. That's my turn.", [
      reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: second.id, weapon: "Scimitar" })] }),
      reply({ calls: [call("end_turn", { characterId: avery.id })] }),
      reply({ text: "Avery's scimitar bites, and Avery falls back a step." }),
    ], [[]]);
    assert.equal(current(), kara.id, "the player's own words ended nothing");
  } finally {
    world.patch(avery.id, { equipment: LONGSWORD });
  }
});

await kit.endFight();
model.close();
world.close();
finish();
