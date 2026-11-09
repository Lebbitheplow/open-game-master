"use client";

import { ArrowDown, ArrowUp, GripVertical, Link2, Unlink } from "lucide-react";
import { useState, type DragEvent } from "react";
import { cn } from "@/lib/cn";
import {
  joinPrevious,
  moveEarlier,
  moveLater,
  moveTo,
  ownStep,
  type PlanSequence,
} from "@/lib/dm/plan-order";
import { kitButtonClass } from "./PanelKit";

// The lead's order for a coordinated plan (issue 292): numbered steps, top
// to bottom, with two or more characters in a step when they act at the
// same time. A character is dragged onto a step to join it, or onto the gap
// between two to take a step of its own there; the buttons beside each name
// do the same from the keyboard or a phone (Earlier, Later, With the step
// above, Own step). The moves themselves are src/lib/dm/plan-order.ts's.

const DRAG_TYPE = "application/x-odm-plan-step";
const iconButton = kitButtonClass("small", "px-1.5 py-0.5 disabled:opacity-30");

type Item = { id: string; name: string; companion: boolean };
type Target = { step: number; join: boolean };

export function SequenceEditor({
  items,
  sequence,
  onChange,
  disabled = false,
  label,
}: {
  items: Item[];
  sequence: PlanSequence;
  onChange: (next: PlanSequence) => void;
  disabled?: boolean;
  label: string;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Target | null>(null);
  const [said, setSaid] = useState("");
  const nameOf = (id: string) => items.find((item) => item.id === id)?.name ?? id;

  const change = (id: string, next: PlanSequence) => {
    onChange(next);
    const at = next.findIndex((step) => step.includes(id));
    const mates = at >= 0 ? next[at].length - 1 : 0;
    setSaid(`${nameOf(id)}: step ${at + 1} of ${next.length}${mates ? `, with ${mates} more` : ""}.`);
  };

  // Taken on dragenter as well as dragover: the steps move under a still
  // pointer (the gaps open as a drag starts, a step reveals itself as the
  // editor opens), and a drop that lands on the step's other part after a
  // move is refused unless that part's dragenter was accepted.
  const dragOver = (event: DragEvent, target: Target) => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (over?.step !== target.step || over.join !== target.join) {
      setOver(target);
    }
  };
  const drop = (event: DragEvent, target: Target) => {
    const id = event.dataTransfer.getData(DRAG_TYPE);
    event.preventDefault();
    event.stopPropagation();
    setOver(null);
    setDragging(null);
    if (id && sequence.some((step) => step.includes(id))) {
      change(id, moveTo(sequence, id, target));
    }
  };
  const isOver = (target: Target) => over?.step === target.step && over.join === target.join;

  // A thin line between steps, which opens while something is dragged.
  const gap = (index: number) => (
    <li
      key={`gap-${index}`}
      aria-hidden="true"
      onDragEnter={(event) => dragOver(event, { step: index, join: false })}
      onDragOver={(event) => dragOver(event, { step: index, join: false })}
      onDragLeave={() => setOver(null)}
      onDrop={(event) => drop(event, { step: index, join: false })}
      className={cn(
        "rounded transition-[height,background-color] duration-150",
        dragging ? "h-3" : "h-0",
        isOver({ step: index, join: false }) && "h-6 bg-amber-400/20 ring-1 ring-amber-400/60",
      )}
    />
  );

  return (
    <div data-sequence-editor>
      <ol className="space-y-0.5" aria-label={label}>
        {gap(0)}
        {sequence.flatMap((ids, index) => [
          <li
            key={`step-${ids.join("+")}`}
            data-sequence-step={index + 1}
            onDragEnter={(event) => dragOver(event, { step: index, join: true })}
            onDragOver={(event) => dragOver(event, { step: index, join: true })}
            onDragLeave={() => setOver(null)}
            onDrop={(event) => drop(event, { step: index, join: true })}
            className={cn(
              "reveal rounded-md border px-2 py-1.5 transition-colors duration-150",
              isOver({ step: index, join: true }) ? "border-amber-400/70 bg-amber-400/10" : "border-stone-800 bg-stone-950/40",
            )}
          >
            <p className="mb-1 text-[10px] uppercase tracking-wide text-stone-500">
              Step {index + 1}
              {index > 0 ? ` · after step ${index}` : " · first"}
              {ids.length > 1 ? " · at the same time" : ""}
            </p>
            <ul className="space-y-1">
              {ids.map((id) => {
                const item = items.find((candidate) => candidate.id === id);
                const alone = ids.length === 1;
                const name = nameOf(id);
                return (
                  <li
                    key={id}
                    data-sequence-item={id}
                    draggable={!disabled}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(DRAG_TYPE, id);
                      event.dataTransfer.effectAllowed = "move";
                      setDragging(id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    className={cn(
                      "motion-pop flex flex-wrap items-center gap-1 text-xs",
                      dragging === id && "opacity-50",
                    )}
                  >
                    <GripVertical className="size-3.5 shrink-0 cursor-grab text-stone-500" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-medium text-stone-200">
                      {name}
                      {item?.companion ? <span className="text-[10px] font-normal text-stone-500"> companion</span> : null}
                    </span>
                    <button
                      type="button"
                      disabled={disabled || (alone && index === 0)}
                      onClick={() => change(id, moveEarlier(sequence, id))}
                      aria-label={`Move ${name} earlier`}
                      title="Earlier"
                      className={iconButton}
                      data-sequence-earlier
                    >
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={disabled || (alone && index === sequence.length - 1)}
                      onClick={() => change(id, moveLater(sequence, id))}
                      aria-label={`Move ${name} later`}
                      title="Later"
                      className={iconButton}
                      data-sequence-later
                    >
                      <ArrowDown className="size-3.5" />
                    </button>
                    {index > 0 ? (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => change(id, joinPrevious(sequence, id))}
                        aria-label={`${name} acts at the same time as step ${index}`}
                        title="At the same time as the step above"
                        className={iconButton}
                        data-sequence-join
                      >
                        <Link2 className="size-3.5" />
                      </button>
                    ) : null}
                    {!alone ? (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => change(id, ownStep(sequence, id))}
                        aria-label={`${name} takes a step of their own`}
                        title="A step of their own"
                        className={iconButton}
                        data-sequence-split
                      >
                        <Unlink className="size-3.5" />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </li>,
          gap(index + 1),
        ])}
      </ol>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </div>
  );
}
