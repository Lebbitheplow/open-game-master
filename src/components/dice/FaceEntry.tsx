"use client";

// The dice of one roll, entered by the player who rolled them at their table:
// a number field for each die, a Pixels die that fills its own, and a mark for
// a die the server draws. One place for it, because a player on physical dice
// enters dice in more than one place and each must read their dice the same
// way: the roll card the GM's call parks (PendingRollCard.tsx), and the hit
// dice a player spends from their own sheet (SheetState.tsx HitDiceSpend),
// which has no card (issue 902). The hook keeps the faces; FaceInputs draws
// them; what is done with the roll is the caller's.

import { Dices } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { OptionalStepper } from "@/app/workshop/kit";
import { entryDice, entryRerollNotes, entryRerolls } from "@/lib/dice";
import { resolveFaceSource, useDiceSources, type FaceSource } from "@/lib/dice/dice-sources";
import { getConnectedPixels, getConnectedPixelsServer, onPixelRoll, onPixelsChanged } from "@/lib/dice/pixels-dice";

// What an expression gives, or `empty` for one that cannot be read (the
// server refuses it when the roll is sent).
function read<T>(from: () => T, empty: T): T {
  try {
    return from();
  } catch {
    return empty;
  }
}

// Plain-words instruction from the dice of a roll: "2 × d20 and 1 × d8".
export function diceSummaryOf(faces: readonly number[]): string {
  if (!faces.length) {
    return "";
  }
  const counts = new Map<number, number>();
  for (const sides of faces) {
    counts.set(sides, (counts.get(sides) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([sides, count]) => `${count} × d${sides}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
}

// The flat bonus a roll ends with ("+3"), which the server adds: the player
// enters raw die faces only.
export function flatModifierOf(expression: string): string | undefined {
  return /([+-]\d+)$/.exec(expression.replaceAll(" ", ""))?.[1];
}

// Every flat number in a roll, added up: "1d10+2+1d6" is 2. For a roll whose
// bonus is not its last term (a hit die with a song's die after it).
export function flatTotalOf(expression: string): number {
  return (expression.replaceAll(" ", "").match(/[+-]?[^+-]+/g) ?? [])
    .filter((term) => /^[+-]?\d+$/.test(term))
    .reduce((sum, term) => sum + Number(term), 0);
}

export type FaceEntry = ReturnType<typeof useFaceEntry>;

// The faces of `expression` as the player enters them. `listening`: this
// screen is the roller's, so a Pixels die landing fills its face here.
export function useFaceEntry(expression: string, listening: boolean) {
  const [values, setValues] = useState<Record<number, string>>({});
  // One field per die: a reroll the roll carries (a halfling's Lucky) is
  // made with the die in hand, and the face kept is the one entered.
  const faces = useMemo(() => read(() => entryDice(expression), []), [expression]);
  const rerolls = useMemo(() => read(() => entryRerolls(expression), []), [expression]);
  const rerollNotes = useMemo(() => read(() => entryRerollNotes(expression), []), [expression]);
  // Faces a Pixels die filled and then filled again for their reroll.
  const [rerolled, setRerolled] = useState<Record<number, boolean>>({});

  const [diceSources] = useDiceSources();
  const pixels = useSyncExternalStore(onPixelsChanged, getConnectedPixels, getConnectedPixelsServer);

  // Resolve every face to its source: the chosen preference, degraded to
  // typing when the assigned Pixels die isn't currently connected.
  const faceSources = useMemo<FaceSource[]>(
    () => faces.map((sides) => resolveFaceSource(diceSources[sides], sides, pixels)),
    [faces, diceSources, pixels],
  );

  // What a face has so far: the typed or Pixels-landed entry, else empty. A
  // digital face never has a client value; the server rolls it on submit, so
  // the browser has nothing a player could read ahead of time.
  const faceValue = (index: number): string => values[index]?.trim() ?? "";

  // The wire payload: numbers for typed and Pixels faces, the literal
  // "digital" for server-rolled ones.
  const submissionDice = (): Array<number | "digital"> =>
    faces.map((_, index) => (faceSources[index]?.kind === "digital" ? "digital" : Number(faceValue(index))));

  // A Pixels face that landed low enough for the roll's own reroll (Lucky's
  // 1) and has not taken it: the die's next landing goes in its place, and
  // the roll does not send itself until it has. Only one die of a kept pool
  // is rerolled.
  const landed = (current: Record<number, string>, index: number): number => Number(current[index]?.trim() || 0);
  const rerollDue = (index: number, current: Record<number, string>, marks: Record<number, boolean>): boolean => {
    const rule = rerolls[index];
    const face = landed(current, index);
    if (!rule?.at || faceSources[index]?.kind !== "pixel" || !face || face > rule.at || marks[index]) {
      return false;
    }
    if (!rule.once) {
      return true;
    }
    // The first face of the pool that qualifies, while none has been rerolled.
    const qualifies = (position: number) =>
      faceSources[position]?.kind === "pixel" && landed(current, position) > 0 && landed(current, position) <= rule.at;
    return (
      !rerolls.some((other, position) => other.term === rule.term && marks[position]) &&
      rerolls.findIndex((other, position) => other.term === rule.term && qualifies(position)) === index
    );
  };
  // What the Pixels listener reads: the faces as they stand, kept current
  // between renders by the listener itself.
  const latest = useRef({ values, rerolled });
  useEffect(() => {
    latest.current = { values, rerolled };
  }, [values, rerolled]);

  // A physical Pixels die landing fills the next empty face assigned to it,
  // or the face still owed its reroll.
  useEffect(() => {
    if (!listening) {
      return;
    }
    return onPixelRoll(({ systemId, faceCount, value }) => {
      const { values: current, rerolled: marks } = latest.current;
      const mineDie = (source: FaceSource, position: number) =>
        source.kind === "pixel" && source.systemId === systemId && faces[position] === faceCount;
      // Every die of the roll lands first (both of an advantage pair), and
      // only then does a landing stand in for a face owed its reroll.
      const index = faceSources.findIndex((source, position) => mineDie(source, position) && !current[position]?.trim());
      if (index >= 0) {
        const nextValues = { ...current, [index]: String(value) };
        latest.current = { values: nextValues, rerolled: marks };
        setValues(nextValues);
        return;
      }
      const again = faceSources.findIndex((source, position) => mineDie(source, position) && rerollDue(position, current, marks));
      if (again < 0) {
        return;
      }
      const nextMarks = { ...marks, [again]: true };
      const nextValues = { ...current, [again]: String(value) };
      latest.current = { values: nextValues, rerolled: nextMarks };
      setRerolled(nextMarks);
      setValues(nextValues);
    });
    // rerollDue reads the rules and sources these deps already name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, faceSources, faces, rerolls]);

  // A digital face is always ready (the server fills it); everything else
  // needs its number in hand before the roll can go.
  const complete =
    faces.length > 0 &&
    faces.every((_, index) => faceSources[index]?.kind === "digital" || (faceValue(index) && !rerollDue(index, values, rerolled)));
  // Every face comes from a die that fills itself (digital or a Pixels die):
  // no typing is needed, so the caller may send the roll once all have landed.
  const fullyAutomatic = faceSources.length > 0 && faceSources.every((source) => source.kind !== "manual");

  return {
    faces,
    faceSources,
    rerollNotes,
    // The entries as they stand: a caller's effect that sends the roll on
    // its own names this, to run again when a die lands.
    values,
    faceValue,
    setFace: (index: number, next: number | "") => setValues((current) => ({ ...current, [index]: next === "" ? "" : String(next) })),
    submissionDice,
    complete,
    fullyAutomatic,
    diceSummary: diceSummaryOf(faces),
    flatModifier: flatModifierOf(expression),
  };
}

// One field for each die of the roll. `dimClass` is the quiet text of the
// surface the fields sit on (the roll card's own, the sheet's).
export function FaceInputs({ entry, dimClass }: { entry: FaceEntry; dimClass: string }) {
  return (
    <>
      {entry.faces.map((sides, index) => {
        const source = entry.faceSources[index] ?? { kind: "manual" };
        const filled = entry.faceValue(index);
        // Digital faces are rolled by the server on submit: marked, not
        // typed, and showing no number the player could act on early.
        if (source.kind === "digital") {
          return (
            <div key={index} className="block">
              <span className="mb-0.5 block text-center text-[10px] text-sky-300/80">d{sides} · auto</span>
              <div
                role="img"
                aria-label={`d${sides} rolled for you`}
                className="flex h-[34px] w-14 items-center justify-center rounded-md border border-sky-800/70 bg-sky-950/30 text-sm text-sky-100"
              >
                <Dices className="size-4 text-sky-300/80" />
              </div>
            </div>
          );
        }
        // Pixels faces auto-fill when the die lands, but stay editable so a
        // stubborn die never blocks the roll.
        const isPixel = source.kind === "pixel";
        return (
          <div key={index} className="block">
            <span
              title={isPixel ? source.name : undefined}
              className={cn("mb-0.5 block max-w-24 truncate text-center text-[10px]", isPixel ? "text-sky-300/90" : dimClass)}
            >
              {isPixel ? source.name : `d${sides}`}
            </span>
            <div className="relative">
              {/* Blank means "not rolled yet", so the stepper is the optional
                  one: the cross clears a mistyped die back to blank. */}
              <OptionalStepper
                min={1}
                max={sides}
                fallback={1}
                value={filled === "" || !Number.isFinite(Number(filled)) ? undefined : Number(filled)}
                onChange={(next) => entry.setFace(index, next)}
                label={isPixel ? `${source.name}, d${sides}` : `d${sides}`}
                size="sm"
              />
              {isPixel && !filled ? (
                <Dices className="pointer-events-none absolute -right-1 -top-1 size-3 animate-pulse text-sky-400/70" />
              ) : null}
            </div>
          </div>
        );
      })}
    </>
  );
}
