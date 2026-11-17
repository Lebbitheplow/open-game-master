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
  assert.equal(covert.o, undefined, "a covert act with no stealth roll is not seen by a bystander");
  assert.equal(covert.k, undefined, "nor by its target, when no hand was laid on them");
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

const bonds = await import("../src/lib/dm/bonds-logic.ts");

await test("bonds: a theft seen by the robbed leaves distrust with the reason; a bystander judges less, more if the victim is dear; a heard blow moves nothing", () => {
  const theft = { actor: "Ottone", verb: "steal", targets: ["Kaku"], object: "Ciotola" };
  const [own] = bonds.bondDeltas(theft, "Kaku", ["sight", "touch"], () => 0);
  assert.deepEqual(own, { toward: "Ottone", trust: -25, affection: -10, fear: 0, reason: "stole from you (Ciotola)" });
  const kaku = bonds.applyDelta(null, own);
  assert.equal(bonds.bondWords(kaku), "Ottone: you are wary of them (they stole from you (Ciotola))");
  const twice = bonds.applyDelta(bonds.applyDelta(kaku, own), { ...own, reason: "struck you" });
  assert.match(bonds.bondWords(twice), /^Ottone: you do not trust them, you dislike them \(they stole from you \(Ciotola\); struck you\)$/, "reasons kept once each, newest last");
  assert.equal(bonds.bondDeltas(theft, "Mairon", ["sight"], () => 0)[0].trust, -10);
  assert.equal(bonds.bondDeltas(theft, "Mairon", ["sight"], () => 40)[0].trust, -20, "a dear one robbed doubles the blame");
  assert.deepEqual(bonds.bondDeltas({ actor: "Ottone", verb: "strike", targets: ["Kaku"], object: "" }, "Mairon", ["hearing"], () => 0), [], "a blow only heard moves no bond");
  assert.deepEqual(bonds.bondDeltas(theft, "Ottone", ["sight"], () => 0), [], "one's own deed moves nothing");
  assert.equal(bonds.bondDeltas({ actor: "Ottone", verb: "threaten", targets: ["Kaku"], object: "" }, "Kaku", ["hearing"], () => 0)[0].fear, 10, "a threat is heard");
});

const mood = await import("../src/lib/dm/mood-logic.ts");

await test("mood: the robbed is furious with the thief for hours, then it fades; the same cause renews, never piles up; temperament shapes it", () => {
  const at = 1000;
  const body = { thirst: 0, hunger: 0, sleep: 0, cold: 0, wet: 0, pain: 0 };
  const born = mood.appraise({ actor: "Ottone", verb: "steal", targets: ["Kaku"], object: "Ciotola", instant: at }, "Kaku", ["sight"], { careToward: () => 0, body });
  assert.deepEqual(born.map((entry) => [entry.emotion, entry.weight, entry.toward, entry.expiresAt - at]), [["anger", 35, "Ottone", 360]]);
  assert.equal(mood.moodWords(born, at), "You are angry with Ottone (Ottone stole from you (Ciotola)).");
  assert.equal(mood.weightNow(born[0], at + 180), 18, "half way, half the weight");
  assert.equal(mood.moodWords(born, at + 300), "", "after five hours it no longer colours the mind");
  assert.equal(mood.renew(born[0], { ...born[0], weight: 20, expiresAt: at + 999 }).weight, 35, "renewed, not summed");
  const volatile = mood.shapeByTemperament(born, { boldness: -3, warmth: 0, composure: -2 });
  assert.deepEqual(volatile.map((entry) => [entry.emotion, entry.weight]).sort(), [["anger", 26], ["fear", 26]], "the volatile feel more; the timid turn half their anger to fear");
  assert.equal(mood.shapeByTemperament(born, { boldness: 0, warmth: 0, composure: 3 })[0].weight, 18, "the unflappable feel half");
  const starving = mood.appraise({ actor: "Mairon", verb: "eat", targets: [], object: "Pesce", instant: at }, "Kaku", ["sight"], { careToward: () => 0, body: { ...body, hunger: 3 } });
  assert.deepEqual(starving.map((entry) => [entry.emotion, entry.weight]), [["jealousy", 30]]);
  assert.deepEqual(mood.bodyMoods({ ...body, cold: 3 }, true, at).map((entry) => entry.emotion), ["panic", "fear"]);
  assert.ok(mood.moodPresses([{ ...born[0], weight: 70 }], at));
});

await test("words read by the closed list: an insult angers, a threat frightens; anything unreadable is nothing", () => {
  const insult = mood.appraiseWords(mood.parseWordReading({ kind: "insult", intensity: 2 }), "Ottone", "Sei un verme", 0);
  assert.deepEqual(insult.map((entry) => [entry.emotion, entry.weight, entry.toward]), [["anger", 30, "Ottone"]]);
  assert.deepEqual(mood.parseWordReading({ kind: "love letter", intensity: 9 }), { kind: "nothing", intensity: 1 });
  assert.deepEqual(mood.appraiseWords(mood.parseWordReading(null), "Ottone", "ciao", 0), []);
});

await test("stealth: a hidden theft rolled 15 is caught only by a passive 15 or more, its victim included; a covert blow is still felt", () => {
  const at = [
    { id: "k", name: "Kaku", condition: "up", passive: 12 },
    { id: "m", name: "Mairon", condition: "up", passive: 15 },
    { id: "v", name: "Volodar", condition: "up", passive: 16 },
  ];
  const theft = { actor: "Ottone", verb: "steal", targets: ["Kaku"], volume: "silent", covert: true, stealth: 15 };
  const got = Object.fromEntries(senses.perceive(theft, at).map((entry) => [entry.observerId, entry.channels]));
  assert.equal(got.k, undefined, "the victim with passive 12 never notices");
  assert.deepEqual(got.m, ["sight"], "15 meets 15");
  assert.deepEqual(got.v, ["sight"]);
  assert.deepEqual(senses.perceive({ ...theft, stealth: null }, at), [], "no roll: nobody");
  const blow = senses.perceive({ actor: "Ottone", verb: "strike", targets: ["Kaku"], volume: "silent", covert: true, stealth: 20 }, at);
  assert.deepEqual(blow, [{ observerId: "k", channels: ["touch", "sight"] }], "a blow is felt and seen by its target alone");
  const line = events.perceivedLine({ actor: "Ottone", targets: ["Kaku"], speech: "", verb: "steal", covert: true, outcome: "Ottone sfila la ciotola a Kaku." }, "Mairon", ["sight"]);
  assert.match(line, /^You caught, though it was done so as not to be noticed: Ottone sfila/);
});

finish();
