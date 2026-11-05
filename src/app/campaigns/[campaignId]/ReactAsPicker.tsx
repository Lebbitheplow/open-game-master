"use client";

import { GameIcon } from "@/components/ui/GameIcon";
import { Select, type SelectOption } from "@/components/ui/Select";
import { cn } from "@/lib/cn";

// Speaking as, for a reaction typed in the box (issue 685). The box speaks
// for the hero whose turn it is, on their turn; while a hit is still open,
// words can go out as a reaction instead: that hero's own (answering a hit
// on them is no word on their turn), or another of the person's heroes', or
// a companion's they command, with that one's reaction unspent. The composer
// shows it only then (player-characters.ts typedReactors), in Do, and goes
// back to the turn after each send. The DM seat's own Speaking as
// (SpeakerPicker) is the pattern it follows.
export function ReactAsPicker({
  acting,
  reactors,
  value,
  onChange,
}: {
  // The hero whose turn it is, whom the box speaks for by default.
  acting: string;
  reactors: Array<{ id: string; name: string }>;
  value: string | null;
  onChange: (characterId: string | null) => void;
}) {
  const options: SelectOption<string>[] = [
    { value: "", label: `${acting}, their turn`, hint: "What they do with their turn" },
    ...reactors.map((hero) => ({ value: hero.id, label: `${hero.name}, a reaction`, hint: "Answering a hit, not their turn" })),
  ];
  return (
    <div data-react-as className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-400">
      <GameIcon icon={{ kind: "glyph", key: "tab-party" }} size="size-5" className="shrink-0" />
      Speaking as
      <Select
        // "" stands for the hero whose turn it is: the kit's select takes a
        // string, and that hero has no row in the reactors.
        value={value ?? ""}
        onChange={(next) => onChange(next || null)}
        options={options}
        label="Speaking as"
        size="sm"
        className={cn("w-auto min-w-[9rem] max-w-[14rem]", value && "border-amber-500/70 text-amber-100")}
      />
    </div>
  );
}
