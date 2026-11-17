// NPC perception (docs/specs/ogm-npc-perception.md): the pure rules that
// decide what a mind took in, how it reads, and what it feels. Same inputs,
// same text.
import assert from "node:assert/strict";
import { register } from "node:module";
import { suite } from "./lib/enforce-harness.mjs";

register("./lib/register-alias.mjs", import.meta.url);
const { test, finish } = suite("test-npc-perception");
const events = await import("../src/lib/dm/scene-events-logic.ts");
const senses = await import("../src/lib/dm/senses-logic.ts");
const stage = await import("../src/lib/dm/npc-stage-logic.ts");

const people = ["Kaku", "Mairon", "Ottone Kranz", "Brakk"];
const watchers = [
  { id: "k", name: "Kaku", condition: "up" },
  { id: "m", name: "Mairon", condition: "up" },
  { id: "o", name: "Ottone Kranz", condition: "up" },
  { id: "x", name: "Volodar", condition: "unconscious" },
];

await test("an event's shape is read field by field, unknown values fall to an open, plain action", () => {
  const shape = events.readEventShape({ verb: "STEAL", targets: ["kaku", "Nessuno", "Kaku"], object: "una ciotola di legno", volume: "loud", covert: true }, people);
  assert.deepEqual(shape, { verb: "steal", targets: ["Kaku"], object: "una ciotola di legno", zoneTo: "", volume: "normal", covert: true });
  assert.equal(events.readEventShape({}, people, "Ciao").verb, "speak", "words alone are speech");
  assert.equal(events.readEventShape({ verb: "strike" }, people).volume, "shout", "a blow is heard");
  assert.equal(events.readEventShape({ verb: "whisper" }, people).volume, "whisper");
});

await test("the senses: the actor knows its deed, the awake see and hear, the target feels, the unconscious nothing", () => {
  const push = { actor: "Ottone Kranz", verb: "push", targets: ["Kaku"], volume: "normal", covert: false };
  const got = Object.fromEntries(senses.perceive(push, watchers).map((entry) => [entry.observerId, entry.channels]));
  assert.deepEqual(got.o, ["sight", "hearing", "touch"]);
  assert.deepEqual(got.k, ["touch", "sight", "hearing"]);
  assert.deepEqual(got.m, ["sight", "hearing"]);
  assert.equal(got.x, undefined, "out cold, nothing reaches them");
  const knocked = senses.perceive({ ...push, targets: ["Volodar"] }, watchers).find((entry) => entry.observerId === "x");
  assert.equal(knocked, undefined, "unconscious: not even touch");
  const asleep = senses.perceive({ actor: "Kaku", verb: "shout", targets: [], volume: "shout", covert: false }, [{ id: "s", name: "Gruoch", condition: "up", asleep: true }]);
  assert.deepEqual(asleep[0].channels, ["hearing"], "a shout reaches a sleeper");
  const covert = Object.fromEntries(senses.perceive({ actor: "Mairon", verb: "steal", targets: ["Kaku"], volume: "silent", covert: true }, watchers).map((entry) => [entry.observerId, entry.channels]));
  assert.equal(covert.o, undefined, "a covert act is not seen by a bystander (until stealth is rolled)");
  assert.deepEqual(covert.k, ["sight"], "its target sees it; nothing is heard of a silent act");
});

await test("a perceived event reads as the observer took it in, and only by the channels that reached them", () => {
  const event = { actor: "Ottone Kranz", verb: "push", targets: ["Kaku"], speech: "Spostati.", outcome: "Ottone Kranz spinge Kaku verso il bordo." };
  assert.equal(events.perceivedLine(event, "Ottone Kranz", ["sight", "hearing", "touch"]), "You said «Spostati.» You did: Ottone Kranz spinge Kaku verso il bordo.");
  assert.equal(events.perceivedLine(event, "Kaku", ["touch", "sight", "hearing"]), "Done to you, you saw: Ottone Kranz spinge Kaku verso il bordo. Ottone Kranz said «Spostati.»");
  assert.equal(events.perceivedLine(event, "Mairon", ["sight"]), "You saw: Ottone Kranz spinge Kaku verso il bordo. Ottone Kranz spoke, but you could not make out the words.");
  assert.equal(events.perceivedLine(event, "Kaku", ["touch"]), "You felt it on your body: Ottone Kranz spinge Kaku verso il bordo.");
  assert.equal(events.perceivedLine(event, "Gruoch", ["hearing"]), "You heard Ottone Kranz's voice say «Spostati.»");
});

await test("the stage frame: time, what the senses took in, and the narration only as a short mood line", () => {
  const frame = stage.stageFrame({ perceived: ["You saw: Kaku mangia una galletta."], elapsed: "2 hours passed", atmosphere: "x".repeat(900) });
  assert.match(frame, /^Since your last turn: 2 hours passed\./);
  assert.match(frame, /What you took in with your own senses since your last turn \(it already happened\):\n- You saw: Kaku mangia una galletta\./);
  const mood = frame.split("an impression, not a fact you witnessed): ")[1];
  assert.ok(mood.length <= stage.ATMOSPHERE_CHARS);
  assert.equal(stage.stageFrame({ perceived: [], elapsed: "", atmosphere: "" }), "");
  assert.equal(frame, stage.stageFrame({ perceived: ["You saw: Kaku mangia una galletta."], elapsed: "2 hours passed", atmosphere: "x".repeat(900) }), "same inputs, same text");
});

const zones = await import("../src/lib/dm/zones-logic.ts");

await test("zones: a proposal is kept only if it makes a place; neighbours are symmetric; distance 0/1/2", () => {
  const raft = zones.validateZones([
    { name: "prua", adjacent: ["centro", "nowhere"] },
    { name: "centro", adjacent: ["poppa"] },
    { name: "poppa", adjacent: [] },
    { name: "Prua", adjacent: [] },
  ]);
  assert.deepEqual(raft.zones.map((zone) => zone.name), ["prua", "centro", "poppa"], "duplicates dropped");
  assert.deepEqual(raft.zones.find((zone) => zone.name === "poppa").adjacent, ["centro"], "adjacency made symmetric, unknown names dropped");
  assert.equal(zones.distance(raft, "prua", "PRUA"), 0);
  assert.equal(zones.distance(raft, "prua", "centro"), 1);
  assert.equal(zones.distance(raft, "prua", "poppa"), 2);
  assert.equal(zones.distance(raft, "prua", "the mast"), 1, "an unknown zone hides nothing");
  assert.equal(zones.validateZones([{ name: "a", adjacent: [] }, { name: "b", adjacent: [] }]), null, "unreachable parts are not a place");
  assert.equal(zones.validateZones([{ name: "solo", adjacent: [] }]), null, "one zone is no zones");
  const proposal = zones.parseZoneProposal('{"zones":[{"name":"prua","adjacent":["poppa"]},{"name":"poppa","adjacent":[]}],"placements":{"kaku":"poppa","Brakk":"the sea"}}', ["Kaku", "Brakk"]);
  assert.deepEqual(proposal.placements, { Kaku: "poppa", Brakk: "prua" }, "unknown zones fall to the first");
});

await test("senses by distance: a whisper reaches the same zone, a voice the next, a shout across; fog and dark narrow sight; wind covers voices", () => {
  const raft = zones.validateZones([{ name: "prua", adjacent: ["centro"] }, { name: "centro", adjacent: ["poppa"] }, { name: "poppa", adjacent: [] }]);
  const at = [
    { id: "k", name: "Kaku", condition: "up", zone: "prua" },
    { id: "m", name: "Mairon", condition: "up", zone: "centro" },
    { id: "o", name: "Ottone Kranz", condition: "up", zone: "poppa" },
  ];
  const clear = { zones: raft, eventZone: "prua", sightRange: 2, dark: false, noise: 0 };
  const said = (volume, scene) => Object.fromEntries(senses.perceive({ actor: "Brakk", verb: "speak", targets: [], volume, covert: false }, at, scene).map((entry) => [entry.observerId, entry.channels]));
  assert.ok(said("whisper", clear).k.includes("hearing"));
  assert.ok(!said("whisper", clear).m?.includes("hearing"), "a whisper does not reach the next zone");
  assert.ok(said("normal", clear).m.includes("hearing"));
  assert.ok(!said("normal", clear).o?.includes("hearing"), "a voice does not cross the raft");
  assert.ok(said("shout", clear).o.includes("hearing"));
  assert.ok(said("normal", clear).o.includes("sight"), "but it is seen on a clear day");
  assert.ok(!said("shout", { ...clear, noise: 1 }).o?.includes("hearing"), "a gale covers even a shout two zones off");
  assert.ok(!said("normal", { ...clear, sightRange: 0 }).m?.includes("sight"), "fog hides the next zone");
  assert.ok(!said("normal", { ...clear, dark: true }).m?.includes("sight"), "the dark hides all but one's own zone");
  assert.ok(said("normal", { ...clear, dark: true }).k.includes("sight"));
});

const body = await import("../src/lib/dm/body-logic.ts");

await test("the body: levels by hours since drink, food and sleep; rain soaks, wind and wet chill, a blanket helps; the worst sets the penalty", () => {
  const now = 100 * 60;
  const levels = body.moodles({ drankAt: now - 17 * 60, ateAt: now - 50 * 60, sleptAt: now - 21 * 60, wet: 3, cold: 1, condition: "wounded" }, now);
  assert.deepEqual(levels, { thirst: 2, hunger: 3, sleep: 2, cold: 1, wet: 3, pain: 2 });
  assert.equal(body.bodyPenalty(levels), 3);
  assert.deepEqual(body.moodles({ condition: "up" }, now), { thirst: 0, hunger: 0, sleep: 0, cold: 0, wet: 0, pain: 0 }, "nothing tracked, nothing felt");
  const gale = { temperature: "cold", wind: "gale", precipitation: 3, sheltered: false, covered: false };
  const soaked = body.tickBody({ wet: 0, cold: 0 }, 4, gale);
  assert.deepEqual(soaked, { wet: 4, cold: 4 }, "four hours of a cold gale and heavy rain: drenched and freezing");
  assert.deepEqual(body.tickBody({ wet: 0, cold: 0 }, 1, gale), { wet: 1, cold: 1 }, "it climbs a level an hour");
  assert.ok(body.tickBody({ wet: 0, cold: 0 }, 6, { ...gale, covered: true }).cold < 4, "a blanket keeps off the worst");
  assert.deepEqual(body.tickBody({ wet: 4, cold: 3 }, 4, { temperature: "mild", wind: "calm", precipitation: 0, sheltered: false, covered: false }), { wet: 2, cold: 1 }, "dry mild air dries and warms, while still wet a little chill stays");
  assert.match(body.bodyWords(levels), /tired|drowsy/);
  assert.doesNotMatch(body.bodyWords(levels), /hungry|parched/, "thirst and hunger are counted in hours elsewhere");
});

await test("things advertise what they ease: with hunger at 2 the frame names the biscuits on the deck, free, and whose the fish is", () => {
  assert.deepEqual(body.serves("Gallette"), ["hunger"]);
  assert.deepEqual(body.serves("Barile d'acqua"), ["thirst"]);
  assert.ok(body.serves("Coperta di lana").includes("cold"));
  const ads = body.adsWords({ thirst: 0, hunger: 2, sleep: 0, cold: 3, wet: 0, pain: 0 }, [
    { name: "Gallette", owner: "" },
    { name: "Pesce", owner: "Kaku", zone: "poppa" },
    { name: "Pane", owner: "Mairon" },
    { name: "Corda", owner: "" },
  ], "Mairon");
  assert.match(ads, /What could ease your hunger: Gallette \(nobody's, free to take\); Pesce \(Kaku's, at poppa\); Pane \(yours\)\./);
  assert.match(ads, /Nothing in sight would ease your cold\./);
});

finish();
