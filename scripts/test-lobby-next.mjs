// The lobby's "what happens next" line (src/lib/dm/lobby-next.ts): every
// seat is told its own next move, waiting names the people waited on, and
// the line agrees with the Begin button's blocker.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { lobbyNext } = await import("../src/lib/dm/lobby-next.ts");
const { translate } = await import("../src/lib/messages-logic.ts");
// The next line's words come from the dictionaries; this suite reads the English ones.
const en = (key, vars) => translate("en", key, vars);

const base = { solo: false, isDm: false, hasSheet: true, ready: true, canStart: false, blocker: "", needHero: [], notReady: [] };

assert.equal(lobbyNext(en, { ...base, hasSheet: false, ready: false }).tone, "do");
assert.match(lobbyNext(en, { ...base, hasSheet: false, ready: false }).text, /choose your hero/);
assert.match(lobbyNext(en, { ...base, ready: false }).text, /ready up/);
assert.match(lobbyNext(en, { ...base, isDm: true, hasSheet: false, ready: false }).text, /yours to open/, "the DM needs no hero");
assert.deepEqual(lobbyNext(en, { ...base, blocker: "Waiting for everyone to ready up.", notReady: ["Ada", "Bram", "Cole"] }), {
  text: "Waiting for Ada, Bram and 1 more to ready up.",
  tone: "wait",
});
assert.match(lobbyNext(en, { ...base, blocker: "Every player needs a character before the adventure starts.", needHero: ["Ada"] }).text, /Ada to choose a hero/);
assert.equal(lobbyNext(en, { ...base, blocker: "Waiting for a player to join." }).text, "Waiting for a player to join.", "a blocker with no names says itself");
assert.deepEqual(lobbyNext(en, { ...base, canStart: true }), { text: "Everyone is ready. Begin the adventure.", tone: "go" });
assert.equal(lobbyNext(en, { ...base }).tone, "wait", "a ready player who cannot begin waits on the owner or the DM");
assert.match(lobbyNext(en, { ...base, solo: true, hasSheet: false }).text, /choose your hero/);
assert.equal(lobbyNext(en, { ...base, solo: true }).tone, "go");
console.log("test-lobby-next: ok");
