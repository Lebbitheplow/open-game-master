"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { GameIcon } from "@/components/ui/GameIcon";
import { overlayRoot } from "@/lib/overlay-root";
import { haptic } from "@/lib/effects-mode";
import {
  insertName,
  matchNames,
  NAME_GROUP_LABEL,
  nameMenuAt,
  type NameChoice,
  type NameGroup,
} from "@/app/campaigns/[campaignId]/name-menu-logic";

// The @ menu's state and keys, for one text box (issue 650). The rules are
// name-menu-logic.ts; this is the part that reads the caret and writes the
// text back. Focus never leaves the box: the list is pointed at with
// aria-activedescendant, and a press on it is kept from taking focus, so a
// phone's keyboard stays up through a pick.

const GROUP_GLYPH: Record<NameGroup, string> = { party: "system-party", people: "system-cast", places: "system-region" };

export type NameMenuState = ReturnType<typeof useNameMenu>;

export function useNameMenu({
  text,
  setText,
  field,
  choices,
}: {
  text: string;
  setText: (text: string) => void;
  field: RefObject<HTMLTextAreaElement | null>;
  choices: readonly NameChoice[];
}) {
  const listId = useId();
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  // The @ Escape put away: typing on after it does not bring the menu back,
  // a new @ does.
  const dismissed = useRef<number | null>(null);
  // Where the caret goes once a picked name is in the box.
  const caretAfter = useRef<number | null>(null);

  // Read again whenever the text or the caret moves.
  const read = useCallback(
    (box: HTMLTextAreaElement) => {
      const caret = box.selectionStart ?? box.value.length;
      const found = box.selectionEnd === caret ? nameMenuAt(box.value, caret, choices) : null;
      if (!found || found.start !== dismissed.current) {
        dismissed.current = null;
      }
      const next = found && found.start !== dismissed.current ? { start: found.start, query: found.query } : null;
      setMention((current) => (current?.start === next?.start && current?.query === next?.query ? current : next));
      setActive(0);
    },
    [choices],
  );

  // The cast can change while the menu is up (a name the story just said).
  const matches = useMemo(() => (mention ? matchNames(choices, mention.query) : []), [choices, mention]);
  const open = mention !== null;
  const lit = Math.min(active, Math.max(matches.length - 1, 0));

  const close = useCallback(() => setMention(null), []);

  const choose = useCallback(
    (choice: NameChoice) => {
      if (!mention) {
        return;
      }
      const result = insertName(text, mention.start, mention.start + 1 + mention.query.length, choice.name);
      caretAfter.current = result.caret;
      setMention(null);
      setText(result.text);
      haptic("tap");
    },
    [mention, setText, text],
  );

  // A controlled box puts its caret at the end on a new value; it belongs
  // just past the name.
  useLayoutEffect(() => {
    const box = field.current;
    const caret = caretAfter.current;
    if (box && caret !== null && box.value.length >= caret) {
      caretAfter.current = null;
      if (document.activeElement !== box) {
        box.focus();
      }
      box.setSelectionRange(caret, caret);
    }
  }, [field, text]);

  // True when the key was the menu's, so the box does not also act on it
  // (Enter picks a name instead of sending).
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open || event.nativeEvent.isComposing) {
        return false;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismissed.current = mention?.start ?? null;
        setMention(null);
        return true;
      }
      if (!matches.length) {
        return false;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((lit + step + matches.length) % matches.length);
        return true;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        choose(matches[lit]);
        return true;
      }
      return false;
    },
    [choose, lit, matches, mention, open],
  );

  return {
    open,
    matches,
    active: lit,
    setActive,
    listId,
    optionId: (index: number) => `${listId}-${index}`,
    read,
    close,
    choose,
    onKeyDown,
    // For the box: tells assistive tech the list exists and which row is lit.
    fieldProps: {
      "aria-autocomplete": "list" as const,
      "aria-controls": open ? listId : undefined,
      "aria-activedescendant": open && matches.length ? `${listId}-${lit}` : undefined,
    },
  };
}

// The list, above the box it serves. Portalled into the overlay root and
// placed against the screen, because the composer's own panes scroll and
// clip (a staged fight's desk scrolls at 62dvh) and the apps confine the
// game's styles to .game-root (src/lib/overlay-root.ts).
export function NameMenu({ menu, anchor }: { menu: NameMenuState; anchor: RefObject<HTMLElement | null> }) {
  const [box, setBox] = useState<{ left: number; top: number; width: number; room: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { open, matches, active } = menu;

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (rect) {
        setBox({ left: rect.left, top: rect.top, width: Math.min(rect.width, 352), room: rect.top - 12 });
      }
    };
    place();
    // A phone's keyboard opening, a turn's banner arriving above the box,
    // the chat scrolling: the box moves, and the list moves with it.
    const viewport = window.visualViewport;
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    viewport?.addEventListener("resize", place);
    const watch = typeof ResizeObserver === "undefined" || !anchor.current ? null : new ResizeObserver(place);
    if (watch && anchor.current) {
      watch.observe(anchor.current);
    }
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      viewport?.removeEventListener("resize", place);
      watch?.disconnect();
    };
  }, [anchor, open]);

  // The lit row stays in sight as the arrows walk past the edge.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, matches]);

  if (!open || !box || typeof document === "undefined") {
    return null;
  }
  return createPortal(
    <div
      className="name-menu-anchor"
      style={{ left: box.left, top: box.top - 6, width: box.width }}
      // A press anywhere on the list leaves the focus, and a phone's
      // keyboard, with the box.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="name-menu panel panel-smoke ctx-menu flex flex-col overflow-hidden rounded-xl p-0" style={{ maxHeight: Math.max(Math.min(box.room, 440), 120) }}>
        {/* Reachable by key when it has to scroll (above a phone's keyboard),
            though the arrows in the box already walk it. */}
        <div ref={listRef} id={menu.listId} role="listbox" aria-label="Names at this table" tabIndex={0} className={matches.length ? "palette-list min-h-0 flex-1 overflow-y-auto p-1.5" : "hidden"}>
          {matches.map((choice, index) => (
            <NameRow
              key={`${choice.group}:${choice.name}`}
              id={menu.optionId(index)}
              choice={choice}
              heading={choice.group !== matches[index - 1]?.group ? NAME_GROUP_LABEL[choice.group] : null}
              selected={index === active}
              onHover={() => menu.setActive(index)}
              onPick={() => menu.choose(choice)}
            />
          ))}
        </div>
        {!matches.length ? <p className="reveal px-3 py-2.5 text-sm text-stone-500">No known name matches.</p> : null}
        {matches.length ? (
          <p className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-amber-400/10 px-3 py-1.5 text-[11px] text-stone-500 [@media(pointer:fine)]:flex">
            <span><span className="kbd-key">↑</span> <span className="kbd-key">↓</span> choose</span>
            <span><span className="kbd-key">Enter</span> or <span className="kbd-key">Tab</span> write it</span>
            <span><span className="kbd-key">Esc</span> close</span>
          </p>
        ) : null}
      </div>
    </div>,
    overlayRoot(anchor.current),
  );
}

function NameRow({
  id,
  choice,
  heading,
  selected,
  onHover,
  onPick,
}: {
  id: string;
  choice: NameChoice;
  heading: string | null;
  selected: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  return (
    <>
      {heading ? <div role="presentation" className="reveal palette-group">{heading}</div> : null}
      <div
        id={id}
        role="option"
        aria-selected={selected}
        // The pointer lights the same row the arrows do, so Enter never
        // writes a name other than the lit one.
        onPointerMove={selected ? undefined : onHover}
        onClick={onPick}
        className="palette-option text-stone-200"
      >
        <GameIcon icon={{ kind: "glyph", key: GROUP_GLYPH[choice.group] }} size="size-7" />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{choice.name}</span>
          {choice.unmet ? <span className="block truncate text-xs text-stone-500">Not introduced yet</span> : null}
        </span>
      </div>
    </>
  );
}
