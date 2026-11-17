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

finish();
