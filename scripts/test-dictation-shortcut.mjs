// Issue 291: the hold-to-dictate key. The rules that pick it (a key that
// cannot fight voice chat's push-to-talk, type in the box, edit or send
// there, or take a browser's, the desktop app's or a desktop's own
// shortcut), the press and release that start and end a take, and what a
// stored key reads back as. The table's handling of it is driven in a real
// browser by scripts/browser/scenarios/22-dictation-key.mjs.
import assert from "node:assert/strict";
import { translate } from "../src/lib/messages-logic.ts";
import {
  ariaShortcut,
  chordFromEvent,
  chordProblem,
  formatChord,
  matchesChord,
  parseChord,
  releasesChord,
  serializeChord,
} from "../src/lib/dictation-shortcut.ts";
// The refusals are the dictionary's; the tests read them in English, the source.
const t = (key, vars) => translate("en", key, vars);

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}

const press = (code, key, mods = {}) => ({ code, key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
const chordOf = (code, key, mods) => chordFromEvent(press(code, key, mods));

test("modifiers alone make no chord; a key with them does", () => {
  assert.equal(chordFromEvent(press("ControlLeft", "Control", { ctrlKey: true })), null);
  assert.equal(chordFromEvent(press("AltRight", "AltGraph", { altKey: true })), null);
  assert.deepEqual(chordOf("KeyM", "m", { altKey: true }), { code: "KeyM", ctrl: false, alt: true, shift: false, meta: false, label: "M" });
  assert.equal(chordOf("F8", "F8").label, "F8");
});

test("the layout's own letter names the key", () => {
  // A French keyboard's A sits where a US Q does.
  assert.equal(chordOf("KeyQ", "a", { ctrlKey: true, altKey: false }).label, "A");
  // Option on a Mac turns M into µ: the key keeps its own name.
  assert.equal(chordOf("KeyM", "µ", { altKey: true }).label, "M");
});

test("voice chat's push-to-talk key is refused at any modifier", () => {
  assert.match(chordProblem(t, chordOf("Backquote", "`")), /voice chat's push-to-talk/);
  assert.match(chordProblem(t, chordOf("Backquote", "`", { altKey: true })), /voice chat's push-to-talk/);
});

test("keys that type, edit or send in the box are refused", () => {
  assert.match(chordProblem(t, chordOf("KeyM", "m")), /types in the message box/);
  assert.match(chordProblem(t, chordOf("KeyM", "M", { shiftKey: true })), /types in the message box/);
  assert.match(chordProblem(t, chordOf("Space", " ")), /types in the message box/);
  assert.match(chordProblem(t, chordOf("Digit5", "5")), /types in the message box/);
  for (const code of ["Enter", "NumpadEnter", "Tab", "Escape", "Backspace", "Delete", "ArrowLeft", "Home", "PageDown"]) {
    assert.match(chordProblem(t, chordOf(code, code)), /moves, edits or sends/, code);
    assert.match(chordProblem(t, chordOf(code, code, { altKey: true })), /moves, edits or sends/, `Alt+${code}`);
  }
  assert.match(chordProblem(t, chordOf("Insert", "Insert", { shiftKey: true })), /moves, edits or sends/, "Shift+Insert pastes");
});

test("the browser's, the desktop app's and the system's shortcuts are refused", () => {
  // Copy, paste, find, a new tab, reload, zoom, the input language.
  for (const [code, key] of [["KeyC", "c"], ["KeyV", "v"], ["KeyF", "f"], ["KeyT", "t"], ["KeyR", "r"], ["Equal", "="], ["Minus", "-"], ["Digit0", "0"], ["Space", " "]]) {
    assert.match(chordProblem(t, chordOf(code, key, { ctrlKey: true })), /browser or system shortcut/, `Ctrl+${key}`);
  }
  // The desktop app's own menu: Home (Ctrl+M) and developer tools (Ctrl+Shift+I).
  assert.match(chordProblem(t, chordOf("KeyM", "m", { ctrlKey: true })), /browser or system shortcut/);
  assert.match(chordProblem(t, chordOf("KeyI", "I", { ctrlKey: true, shiftKey: true })), /browser or system shortcut/);
  for (const code of ["F1", "F3", "F5", "F6", "F7", "F10", "F11", "F12"]) {
    assert.match(chordProblem(t, chordOf(code, code)), /browser or the app window/, code);
  }
  assert.match(chordProblem(t, chordOf("F4", "F4", { altKey: true })), /closes the window/);
  assert.match(chordProblem(t, chordOf("KeyD", "d", { altKey: true })), /browser menu, the address bar/);
  assert.match(chordProblem(t, chordOf("Space", " ", { altKey: true })), /window menu/);
  assert.match(chordProblem(t, chordOf("KeyT", "t", { ctrlKey: true, altKey: true })), /desktop shortcut/);
  assert.match(chordProblem(t, chordOf("KeyM", "m", { metaKey: true })), /Windows, Command and Super/);
});

test("a Ctrl+Alt press that is AltGr typing a character stays typing", () => {
  // German layout: AltGr+Q (Ctrl+Alt+Q on Windows) types @.
  const atSign = chordOf("KeyQ", "@", { ctrlKey: true, altKey: true });
  assert.match(chordProblem(t, atSign, "@"), /types "@"/);
  assert.equal(chordProblem(t, atSign, "q"), null, "on a US layout the same chord is free");
  assert.equal(matchesChord(press("KeyQ", "@", { ctrlKey: true, altKey: true }), atSign), false, "a press that types @ is left to type");
  assert.equal(matchesChord(press("KeyQ", "q", { ctrlKey: true, altKey: true }), atSign), true);
});

test("free keys are accepted, and named the way the player reads them", () => {
  const alt = chordOf("KeyM", "m", { altKey: true });
  assert.equal(chordProblem(t, alt), null);
  assert.equal(formatChord(alt), "Alt+M");
  assert.equal(formatChord(alt, true), "Option+M");
  assert.equal(ariaShortcut(alt), "Alt+M");
  const f8 = chordOf("F8", "F8");
  assert.equal(chordProblem(t, f8), null);
  assert.equal(formatChord(f8), "F8");
  const ctrlAltSpace = chordOf("Space", " ", { ctrlKey: true, altKey: true });
  assert.equal(chordProblem(t, ctrlAltSpace), null);
  assert.equal(formatChord(ctrlAltSpace), "Ctrl+Alt+Space");
  assert.equal(ariaShortcut(ctrlAltSpace), "Control+Alt+Space");
  assert.equal(chordProblem(t, chordOf("F9", "F9", { shiftKey: true })), null);
});

test("a take starts on exactly the chord and ends on the key or any modifier it holds", () => {
  const alt = chordOf("KeyM", "m", { altKey: true });
  assert.equal(matchesChord(press("KeyM", "m", { altKey: true }), alt), true);
  assert.equal(matchesChord(press("KeyM", "m"), alt), false, "without Alt it is typing");
  assert.equal(matchesChord(press("KeyM", "m", { altKey: true, ctrlKey: true }), alt), false, "an extra modifier is another chord");
  assert.equal(matchesChord(press("KeyM", "m", { altKey: true, metaKey: true }), alt), false);
  assert.equal(releasesChord({ code: "KeyM", key: "m" }, alt), true);
  assert.equal(releasesChord({ code: "AltLeft", key: "Alt" }, alt), true, "letting go of Alt first ends it");
  assert.equal(releasesChord({ code: "ShiftLeft", key: "Shift" }, alt), false);
  assert.equal(releasesChord({ code: "KeyN", key: "n" }, alt), false);
});

test("a stored key reads back; a broken or now-refused one reads as none", () => {
  const alt = chordOf("KeyM", "m", { altKey: true });
  assert.deepEqual(parseChord(serializeChord(alt)), alt);
  assert.equal(parseChord(null), null);
  assert.equal(parseChord("{not json"), null);
  assert.equal(parseChord(JSON.stringify({ code: "Backquote" })), null, "a key the rules refuse is never used");
  assert.equal(parseChord(JSON.stringify({ code: "Enter", alt: true })), null);
  assert.equal(parseChord(JSON.stringify({ code: "Key M", alt: true })), null, "a code the keyboard never sends");
  assert.equal(parseChord(JSON.stringify({ code: "KeyM", alt: true, meta: true, label: "M" })).meta, false, "a stored Meta is never read back");
  assert.equal(parseChord(JSON.stringify({ code: "F8" })).label, "F8", "a missing name comes from the code");
});

console.log(`dictation shortcut: ${passed} checks passed.`);
