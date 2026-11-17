// The key a player holds to dictate into the table's message box (issue
// 291): the same take as holding the composer's mic, started on the key's
// press and ended on its release, with the words left in the box to be
// checked and sent. Nothing is ever sent by it.
//
// A shortcut is a physical key (KeyboardEvent.code, the same key whatever
// the layout prints on it) and the modifiers held with it. It is kept on
// the device (src/lib/use-dictation-shortcut.ts), as the microphone and
// voice chat's push-to-talk are: a key that suits one keyboard, browser or
// app can clash in another.
//
// The rules below refuse a key that would fight something else, and say
// what: voice chat's push-to-talk key, a key that types, edits or sends in
// the box, and the shortcuts browsers, the desktop app's menu and common
// desktops keep for themselves. Pure, and free of alias imports (the only
// import is the relative translator), so scripts/test-dictation-shortcut.mjs
// and the client apps' tests read it directly.
import { translate } from "./messages-logic.ts";

// English-bound, for the checks that only ask whether a chord is refused.
const enT = (key: string, vars?: Record<string, string | number>) => translate("en", key, vars);

export type DictationChord = {
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  // The Windows, Command or Super key: refused (the system's), kept on the
  // type so a refusal can name it.
  meta: boolean;
  // What the key is called on the keyboard it was set on ("A" for KeyQ on
  // a French layout).
  label: string;
};

export const DICTATION_SHORTCUT_KEY = "odm.dictation.shortcut";

// Voice chat's push-to-talk key (useVoicePrefs.ts PTT_KEY), which voice chat
// answers with any modifier held.
const VOICE_PTT_CODE = "Backquote";

const MODIFIER_KEYS = new Set(["Control", "Alt", "AltGraph", "Shift", "Meta", "OS", "Super", "Hyper", "Fn", "FnLock"]);

// Keys that move, edit, send or toggle something wherever they are pressed.
const EDITING_CODES = new Set([
  "Enter",
  "NumpadEnter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "CapsLock",
  "NumLock",
  "ContextMenu",
  "PrintScreen",
]);

// Function keys the browser or the window keeps: help, find next, reload,
// the address bar, caret browsing, the menu bar, full screen, developer
// tools. F4 is kept only with Ctrl or Alt (close).
const KEPT_FUNCTION_KEYS = new Set(["F1", "F3", "F5", "F6", "F7", "F10", "F11", "F12"]);

// Keys that put a character in the box.
const TYPING = /^(Key[A-Z]|Digit\d|Numpad(\d|Add|Subtract|Multiply|Divide|Decimal|Comma|Equal)|Space|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|IntlBackslash|IntlRo|IntlYen)$/;

// Alt with these opens a browser menu or the address bar (Chrome, Edge and
// Firefox on Windows and Linux), or the window's own menu (Space).
const ALT_MENU_CODES = new Set(["KeyD", "KeyE", "KeyF", "KeyV", "KeyS", "KeyB", "KeyT", "KeyH", "Space"]);

// Ctrl+Alt with these is a desktop's: a terminal, the lock screen, the
// desktop shown.
const CTRL_ALT_DESKTOP_CODES = new Set(["KeyT", "KeyL", "KeyD"]);

const NAMED: Record<string, string> = {
  Space: "Space",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
  IntlBackslash: "\\",
  IntlRo: "\\",
  IntlYen: "¥",
  NumpadAdd: "Num +",
  NumpadSubtract: "Num -",
  NumpadMultiply: "Num *",
  NumpadDivide: "Num /",
  NumpadDecimal: "Num .",
  NumpadComma: "Num ,",
  NumpadEqual: "Num =",
  NumpadEnter: "Num Enter",
  ScrollLock: "Scroll Lock",
  CapsLock: "Caps Lock",
  NumLock: "Num Lock",
  PageUp: "Page Up",
  PageDown: "Page Down",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ContextMenu: "Menu",
  PrintScreen: "Print Screen",
};

// The key's name from its code, on a US layout.
export function keyLabel(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) {
    return letter[1];
  }
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) {
    return digit[1];
  }
  const pad = /^Numpad(\d)$/.exec(code);
  if (pad) {
    return `Num ${pad[1]}`;
  }
  return NAMED[code] ?? code;
}

export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key);
}

type KeyEventLike = {
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

// The chord a key press makes, or null while only modifiers are held.
export function chordFromEvent(event: KeyEventLike): DictationChord | null {
  if (!event.code || isModifierKey(event.key)) {
    return null;
  }
  // The layout's own name for a letter or a digit, when Alt has not turned
  // it into another character.
  const typed = event.key.length === 1 && !event.altKey && /[\p{L}\p{N}]/u.test(event.key) ? event.key.toUpperCase() : "";
  return {
    code: event.code,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    label: (typed || keyLabel(event.code)).slice(0, 16),
  };
}

export function formatChord(chord: DictationChord, mac = false): string {
  return [
    chord.ctrl ? "Ctrl" : "",
    chord.alt ? (mac ? "Option" : "Alt") : "",
    chord.shift ? "Shift" : "",
    chord.meta ? (mac ? "Cmd" : "Win") : "",
    chord.label || keyLabel(chord.code),
  ]
    .filter(Boolean)
    .join("+");
}

// The chord in aria-keyshortcuts' own words ("Control+Alt+M").
export function ariaShortcut(chord: DictationChord): string {
  const letter = /^Key([A-Z])$/.exec(chord.code)?.[1];
  const digit = /^Digit(\d)$/.exec(chord.code)?.[1];
  return [
    chord.ctrl ? "Control" : "",
    chord.alt ? "Alt" : "",
    chord.shift ? "Shift" : "",
    letter ?? digit ?? (chord.code === "Space" ? "Space" : chord.label || chord.code),
  ]
    .filter(Boolean)
    .join("+");
}

// Whether a character the keyboard typed is the key's own (the letter or
// digit on it), rather than one AltGr or Option made of it.
function ownCharacter(typed: string, chord: Pick<DictationChord, "code" | "label">): boolean {
  const lowered = typed.toLowerCase();
  return lowered === chord.label.toLowerCase() || lowered === keyLabel(chord.code).toLowerCase();
}

// Why this chord cannot be the dictation key, or null when it can. `typed`
// is the character the press produced (KeyboardEvent.key), when known: on a
// layout where Ctrl+Alt is AltGr, Ctrl+Alt+Q types "@" and must stay typing.
//
// The refusals are sentences the settings field shows; they live in the
// dictionaries (dictation.problem.*) and take the translator from the
// surface that asks, as home/types.ts's agoLabel does. The key's own names
// (keyLabel, formatChord) are the keyboard's, and stay as printed.
export function chordProblem(
  t: (key: string, vars?: Record<string, string | number>) => string,
  chord: DictationChord,
  typed = "",
): string | null {
  const name = formatChord(chord);
  if (chord.meta) {
    return t("The Windows, Command and Super keys belong to the system. Hold Ctrl or Alt instead.");
  }
  if (chord.code === VOICE_PTT_CODE) {
    return t("` is voice chat's push-to-talk key. Pick another so the two never fight.");
  }
  if (EDITING_CODES.has(chord.code) || (chord.code === "Insert" && (chord.ctrl || chord.shift))) {
    return t("{name} moves, edits or sends in the message box. Pick another key.", { name: EDITING_CODES.has(chord.code) ? keyLabel(chord.code) : name });
  }
  if (KEPT_FUNCTION_KEYS.has(chord.code)) {
    return t("{name} belongs to the browser or the app window (help, reload, full screen, developer tools). Pick another key, such as F8 or F9.", { name });
  }
  if (chord.code === "F4" && (chord.ctrl || chord.alt)) {
    return t("{name} closes the window or the tab. Pick another key.", { name });
  }
  const types = TYPING.test(chord.code);
  if (types && !chord.ctrl && !chord.alt) {
    return t("{name} types in the message box. Hold Ctrl or Alt with it, or pick a key that does not type, such as F8 or F9.", { name });
  }
  if (types && chord.ctrl && !chord.alt) {
    return t("{name} is a browser or system shortcut (copy, find, a new tab, zoom, the input language). Add Alt, or pick another key.", { name });
  }
  if (chord.alt && !chord.ctrl && ALT_MENU_CODES.has(chord.code)) {
    return t("{name} opens a browser menu, the address bar or the window menu. Pick another key.", { name });
  }
  if (chord.ctrl && chord.alt && CTRL_ALT_DESKTOP_CODES.has(chord.code)) {
    return t("{name} is a desktop shortcut on many systems (a terminal, the lock screen, the desktop). Pick another key.", { name });
  }
  if (chord.ctrl && chord.alt && typed.length === 1 && !ownCharacter(typed, chord)) {
    return t("On this keyboard {name} types \"{typed}\". Pick another key so it keeps typing.", { name, typed });
  }
  return null;
}

// The press that starts a take: the key, with exactly the chord's
// modifiers. A Ctrl+Alt press that types a character of its own (AltGr on
// that layout) is left to type.
export function matchesChord(event: KeyEventLike, chord: DictationChord): boolean {
  if (
    event.code !== chord.code ||
    event.ctrlKey !== chord.ctrl ||
    event.altKey !== chord.alt ||
    event.shiftKey !== chord.shift ||
    event.metaKey
  ) {
    return false;
  }
  return !(chord.ctrl && chord.alt && event.key.length === 1 && !ownCharacter(event.key, chord));
}

// The release that ends it: the key itself, or any modifier the chord holds.
export function releasesChord(event: Pick<KeyEventLike, "code" | "key">, chord: DictationChord): boolean {
  return (
    event.code === chord.code ||
    (chord.ctrl && event.key === "Control") ||
    (chord.alt && (event.key === "Alt" || event.key === "AltGraph")) ||
    (chord.shift && event.key === "Shift")
  );
}

// A stored shortcut, or null for none, an unreadable one, or one the rules
// now refuse. The refusal words are only a check here, so an English-bound
// translator reads them; nothing user-facing is made of it.
export function parseChord(raw: string | null): DictationChord | null {
  if (!raw) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const stored = value as Record<string, unknown>;
  if (typeof stored.code !== "string" || !/^[A-Za-z0-9]{1,32}$/.test(stored.code)) {
    return null;
  }
  const chord: DictationChord = {
    code: stored.code,
    ctrl: stored.ctrl === true,
    alt: stored.alt === true,
    shift: stored.shift === true,
    meta: false,
    label: typeof stored.label === "string" && stored.label.trim() ? stored.label.trim().slice(0, 16) : keyLabel(stored.code),
  };
  return chordProblem(enT, chord) ? null : chord;
}

export function serializeChord(chord: DictationChord): string {
  const { code, ctrl, alt, shift, label } = chord;
  return JSON.stringify({ code, ctrl, alt, shift, label });
}
