"use client";

import { Check, Keyboard, X } from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { chordFromEvent, chordProblem, formatChord } from "@/lib/dictation-shortcut";
import {
  setListeningForShortcut,
  useDictationShortcut,
  useMacKeyboard,
  writeDictationShortcut,
} from "@/lib/use-dictation-shortcut";
import { ui } from "@/lib/ui";

// Choosing the hold-to-dictate key (issue 291): press Set, then the keys.
// A key the rules refuse (src/lib/dictation-shortcut.ts) is not saved, and
// the reason shows; Escape stops listening. Used on the account Settings
// page and in the apps' Audio and dice settings, both writing the same
// device store the table's mic reads.

const BUTTON = cn(ui.btnSmall, "shrink-0 px-2.5 py-1 text-xs");

function heldModifiers(event: KeyboardEvent, mac: boolean): string {
  return [event.ctrlKey ? "Ctrl" : "", event.altKey ? (mac ? "Option" : "Alt") : "", event.shiftKey ? "Shift" : ""]
    .filter(Boolean)
    .join("+");
}

export function DictationShortcutField({ className }: { className?: string }) {
  const chord = useDictationShortcut();
  const mac = useMacKeyboard();
  const [listening, setListening] = useState(false);
  const [held, setHeld] = useState("");
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState(false);

  // Before paint, so a key pressed the moment "Press the keys..." shows is
  // heard (the apps' Preact runs a plain effect a frame later).
  useLayoutEffect(() => {
    if (!listening) {
      return;
    }
    setListeningForShortcut(true);
    const stopListening = () => {
      setListening(false);
      setHeld("");
    };
    const down = (event: KeyboardEvent) => {
      // Nothing else on the page hears the keys while they are being chosen.
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
        stopListening();
        return;
      }
      const next = chordFromEvent(event);
      if (!next) {
        setHeld(heldModifiers(event, mac));
        return;
      }
      if (event.repeat) {
        return;
      }
      const why = chordProblem(next, event.key);
      if (why) {
        setProblem(why);
        setHeld("");
        return;
      }
      writeDictationShortcut(next);
      setProblem("");
      setSaved(true);
      stopListening();
    };
    const up = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setHeld(heldModifiers(event, mac));
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", stopListening);
    return () => {
      setListeningForShortcut(false);
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", stopListening);
    };
  }, [listening, mac]);

  useEffect(() => {
    if (!saved) {
      return;
    }
    const timer = window.setTimeout(() => setSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const name = chord ? formatChord(chord, mac) : "";
  return (
    <div className={cn("space-y-1.5", className)} data-dictation-shortcut>
      <div className="flex flex-wrap items-center gap-2">
        {listening ? (
          <kbd
            className="motion-pop min-w-24 rounded border border-amber-400/70 bg-amber-950/40 px-2 py-1 text-center font-code text-xs text-amber-100 shadow-[0_0_12px_rgba(251,191,36,0.25)]"
            aria-live="polite"
          >
            {held ? `${held}+...` : "Press the keys..."}
          </kbd>
        ) : name ? (
          <kbd
            key={name}
            className="reveal-pop rounded border border-stone-700 bg-stone-900 px-2 py-1 font-code text-xs text-amber-100"
            data-dictation-key={name}
          >
            {name}
          </kbd>
        ) : (
          <span className="text-xs text-stone-500">None set</span>
        )}
        {listening ? (
          <button type="button" onClick={() => setListening(false)} className={BUTTON}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setProblem("");
              setSaved(false);
              setListening(true);
            }}
            className={BUTTON}
            data-dictation-set
          >
            <Keyboard className="size-3.5" /> {chord ? "Change" : "Set a key"}
          </button>
        )}
        {chord && !listening ? (
          <button
            type="button"
            onClick={() => {
              writeDictationShortcut(null);
              setProblem("");
              setSaved(false);
            }}
            className={BUTTON}
            data-dictation-clear
          >
            <X className="size-3.5" /> Clear
          </button>
        ) : null}
        {saved ? (
          <span role="status" className="live-in inline-flex items-center gap-1 text-xs text-emerald-400">
            <Check className="size-3.5" /> Saved on this device
          </span>
        ) : null}
      </div>
      {problem ? (
        <p role="alert" className="motion-shake text-xs text-amber-300" data-dictation-problem>
          {problem}
        </p>
      ) : null}
      <p className="text-xs text-stone-500">
        {listening
          ? "Hold Ctrl or Alt with a letter, or press a key that does not type, such as F8 or F9. Escape stops listening."
          : "Hold it at the table, in the message box or anywhere outside another field, to speak as the mic button does. Let go and the words wait in the box; only Send sends them."}
      </p>
    </div>
  );
}
