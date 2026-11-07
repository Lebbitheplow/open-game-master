"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { AddFromList } from "@/components/ui/AddFromList";
import { useSpellLookups } from "@/components/sheet/useSpellPool";
import { useContentSearch } from "@/app/characters/builder/useContentSearch";
import { addChip, rowIcon } from "@/app/workshop/kit";
import { compareNames, textKey } from "@/lib/language/text-logic";
import { checklistSpellsMatching, checklistSpellsOn, spellLevelOf } from "@/lib/srd/spell-lists";
import { CUSTOM_LIST_MAX, SPELL_LISTS } from "@/lib/homebrew/class-data";

// A workshop class's list of its own (issue #833): the spells it may learn
// or prepare, picked from every spell this server knows (the SRD's, the
// content pack's when it is installed, and the author's homebrew), shown by
// spell level. A published class's whole list can be added in one pick and
// trimmed from there, so nobody clicks two hundred spells in one by one.

const LEVEL_WORDS = ["Cantrips", "1st level", "2nd level", "3rd level", "4th level", "5th level", "6th level", "7th level", "8th level", "9th level"];

type Found = { name: string; level: number; source?: string; document?: string };

// Every spell a published class's list holds, as this server files them:
// the checklist's, and the pack's and the author's homebrew tagged with it,
// names and levels only (`lite=1`).
async function listSpells(list: string): Promise<Found[]> {
  const spells: Found[] = checklistSpellsOn(list);
  try {
    for (let offset = 0; offset < 2000; offset += 200) {
      const params = new URLSearchParams({ class: list, level: "9", limit: "200", offset: String(offset), lite: "1" });
      const response = await fetch(`/api/content/spells?${params}`);
      if (!response.ok) break;
      const page = ((await response.json()) as { results?: Found[] }).results ?? [];
      spells.push(...page.map((row) => ({ name: row.name, level: Number(row.level ?? 0) })));
      if (page.length < 200) break;
    }
  } catch {
    // Unreachable: the checklist's own list stands.
  }
  return spells;
}

// A search over every spell this server knows, for a workshop list to pick
// from: the server is asked for what was typed (the content pack's rows and
// the author's homebrew, names and levels only), and the bundled SRD
// checklist answers beside it, so a server without the pack still offers the
// SRD's spells. Asked afresh as the person types, so a homebrew spell made a
// moment ago is found. It used to load every spell the server knows, text
// and all, whenever a form opened, and kept it for the page's life.
export function SpellSearch({
  exclude,
  onPick,
  label,
  placeholder,
  disabled = false,
  className,
  noCantrips = false,
}: {
  exclude: ReadonlySet<string>;
  onPick: (spell: Found) => void;
  label: string;
  placeholder: string;
  disabled?: boolean;
  className?: string;
  // A half caster learns no cantrips: none is offered.
  noCantrips?: boolean;
}) {
  const { query, setQuery, results: served, loading } = useContentSearch("spells", { lite: "1", limit: "30" });
  const wanted = textKey(query);
  const results: Found[] = useMemo(() => {
    if (!wanted) {
      return [];
    }
    const rows: Found[] = [
      ...served.map((row) => ({ name: row.name, level: Number(row.level ?? 0), source: row.source, document: row.document })),
      ...checklistSpellsMatching(query, 60),
    ];
    const seen = new Set<string>();
    return rows
      .filter((spell) => {
        const key = textKey(spell.name);
        if (seen.has(key) || exclude.has(key) || !key.includes(wanted) || (noCantrips && spell.level === 0)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.level - b.level || compareNames(a.name, b.name))
      .slice(0, 30);
  }, [served, query, wanted, exclude, noCantrips]);
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-stone-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={label}
          className={cn(ui.input, "w-full pl-7 text-sm pointer-coarse:min-h-10")}
        />
        {loading && wanted ? <Loader2 className="absolute right-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-stone-500" /> : null}
      </div>
      {wanted && !loading && !results.length ? (
        <p className="reveal text-[11px] text-stone-500">Nothing matched &quot;{query.trim()}&quot; that is not picked already.</p>
      ) : null}
      {results.length ? (
        <ul aria-label="Spells to add" className="reveal stagger-up max-h-64 space-y-1 overflow-y-auto rounded-lg border border-stone-800 bg-stone-950/60 p-1.5">
          {results.map((spell) => (
            <li key={spell.name}>
              <button
                type="button"
                onClick={() => onPick(spell)}
                className={cn(ui.btnSmall, addChip, "w-full justify-between text-left")}
              >
                <span className={cn("inline-flex items-center gap-1", spell.source === "homebrew" && "text-amber-300")}>
                  <Plus className="size-3" /> {spell.name}
                </span>
                <span className="text-[11px] text-stone-500">
                  {spell.level === 0 ? "cantrip" : `level ${spell.level}`}
                  {spell.source === "homebrew" ? ", yours" : spell.document ? `, ${spell.document}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CustomSpellList({
  names,
  onChange,
  noCantrips = false,
}: {
  names: string[];
  onChange: (names: string[]) => void;
  // A half caster's list: it learns no cantrips, so none is offered or added.
  noCantrips?: boolean;
}) {
  const [filling, setFilling] = useState("");
  // Levels of the picked names the checklist does not know (the pack's, the
  // author's homebrew), one lookup each, kept for the page's life.
  const lookups = useSpellLookups(names);
  const chosen = useMemo(() => new Set(names.map(textKey)), [names]);
  const levelOf = (name: string): number | null => spellLevelOf(name) ?? lookups.get(textKey(name))?.level ?? null;
  const homebrew = (name: string) => lookups.get(textKey(name))?.source === "homebrew";
  const full = names.length >= CUSTOM_LIST_MAX;
  const cantripsHeld = noCantrips ? names.filter((name) => levelOf(name) === 0).length : 0;

  const add = (more: string[]) => {
    const next = [...names];
    const seen = new Set(chosen);
    for (const name of more) {
      const key = textKey(name);
      if (!key || seen.has(key) || next.length >= CUSTOM_LIST_MAX) continue;
      seen.add(key);
      next.push(name);
    }
    onChange(next);
  };

  const groups = new Map<number | null, string[]>();
  for (const name of names) {
    const level = levelOf(name);
    groups.set(level, [...(groups.get(level) ?? []), name]);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a ?? 99) - (b ?? 99));

  return (
    <div className="space-y-2 text-sm" data-testid="custom-spell-list">
      <p className="text-[11px] text-stone-400" role="status">
        {names.length
          ? `${names.length} ${names.length === 1 ? "spell" : "spells"} on the list${full ? `, the most a list keeps (${CUSTOM_LIST_MAX})` : ""}.`
          : "No spells yet. Add a published class's list to start from, or find spells one by one."}
      </p>
      {noCantrips ? (
        <p className="text-[11px] text-stone-500" data-testid="no-cantrips-hint">
          A half caster learns no cantrips, so none is offered here.
          {cantripsHeld ? ` The ${cantripsHeld === 1 ? "cantrip" : `${cantripsHeld} cantrips`} on the list ${cantripsHeld === 1 ? "is" : "are"} never taken; take ${cantripsHeld === 1 ? "it" : "them"} off.` : ""}
        </p>
      ) : null}
      {ordered.map(([level, group]) => (
        <div key={String(level)} className="live-in flex flex-wrap items-center gap-1.5 text-xs">
          <span className="w-24 shrink-0 text-stone-400">
            {level === null ? "Level unknown" : LEVEL_WORDS[level]} ({group.length})
          </span>
          {group.sort(compareNames).map((name) => (
            <span
              key={name}
              className={cn("inline-flex items-center rounded-md border border-stone-700 pl-2 text-stone-200", homebrew(name) && "text-amber-300")}
            >
              {name}
              <button
                type="button"
                aria-label={`Take ${name} off the list`}
                onClick={() => onChange(names.filter((entry) => textKey(entry) !== textKey(name)))}
                className={cn(ui.iconAction, rowIcon, "hover:text-red-300")}
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      ))}
      <div className="flex flex-wrap items-start gap-2">
        <SpellSearch
          className="min-w-48 flex-1"
          exclude={chosen}
          disabled={full}
          noCantrips={noCantrips}
          label="Find a spell to add to the class's list"
          placeholder={full ? "The list is full" : "Find a spell to add: fire bolt, shield..."}
          onPick={(spell) => add([spell.name])}
        />
        <AddFromList
          // Short enough to read whole beside the search at any width.
          prompt={filling ? `Adding the ${filling}'s list` : "Add a class's list"}
          disabled={Boolean(filling) || full}
          // Wide enough for its prompt and room for its arrow: a native
          // select is as wide as its longest option, which is shorter.
          className="min-h-10 min-w-44 pr-7 sm:min-h-0"
          options={SPELL_LISTS.map((list) => ({ value: list, label: `The ${list}'s list` }))}
          onPick={(list) => {
            setFilling(list);
            void listSpells(list)
              .then((spells) => add(spells.filter((spell) => !noCantrips || spell.level !== 0).map((spell) => spell.name)))
              .finally(() => setFilling(""));
          }}
        />
      </div>
    </div>
  );
}
