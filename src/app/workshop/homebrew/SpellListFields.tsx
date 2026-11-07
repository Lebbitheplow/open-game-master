"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { AddFromList } from "@/components/ui/AddFromList";
import { ANY_SPELL_LIST, useSpellLookups, useSpellPool, type PoolSpell } from "@/components/sheet/useSpellPool";
import { addChip, rowIcon } from "@/app/workshop/kit";
import { compareNames, textKey } from "@/lib/language/text-logic";
import { checklistSpellsOn, spellLevelOf } from "@/lib/srd/spell-lists";
import { CUSTOM_LIST_MAX, SPELL_LISTS } from "@/lib/homebrew/class-data";

// A workshop class's list of its own (issue #833): the spells it may learn
// or prepare, picked from every spell this server knows (the SRD's, the
// content pack's when it is installed, and the author's homebrew), shown by
// spell level. A published class's whole list can be added in one pick and
// trimmed from there, so nobody clicks two hundred spells in one by one.

const LEVEL_WORDS = ["Cantrips", "1st level", "2nd level", "3rd level", "4th level", "5th level", "6th level", "7th level", "8th level", "9th level"];

// Every spell a published class's list holds, as this server files them:
// the checklist's, and the pack's and the author's homebrew tagged with it.
async function listNames(list: string): Promise<string[]> {
  const names = checklistSpellsOn(list).map((spell) => spell.name);
  try {
    for (let offset = 0; offset < 2000; offset += 200) {
      const params = new URLSearchParams({ class: list, level: "9", limit: "200", offset: String(offset) });
      const response = await fetch(`/api/content/spells?${params}`);
      if (!response.ok) break;
      const page = ((await response.json()) as { results?: Array<{ name: string }> }).results ?? [];
      names.push(...page.map((row) => row.name));
      if (page.length < 200) break;
    }
  } catch {
    // Unreachable: the checklist's own list stands.
  }
  return names;
}

// A search over every spell this server knows, for a workshop list to pick
// from: the content pack's and the author's homebrew, or the bundled SRD
// checklist on a server without the pack (useSpellPool's own fallback). The
// catalog picker (ContentPick) shows nothing without the pack, so a subclass's
// spells could not be picked on such a server at all.
export function SpellSearch({
  exclude,
  onPick,
  label,
  placeholder,
  disabled = false,
  className,
}: {
  exclude: ReadonlySet<string>;
  onPick: (spell: PoolSpell) => void;
  label: string;
  placeholder: string;
  disabled?: boolean;
  className?: string;
}) {
  const { pool, loading } = useSpellPool(ANY_SPELL_LIST, 9);
  const [query, setQuery] = useState("");
  const wanted = textKey(query);
  const results: PoolSpell[] = wanted
    ? pool
        .filter((spell) => !exclude.has(textKey(spell.name)) && textKey(spell.name).includes(wanted))
        .sort((a, b) => a.level - b.level || compareNames(a.name, b.name))
        .slice(0, 30)
    : [];
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
        {loading ? <Loader2 className="absolute right-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-stone-500" /> : null}
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

export function CustomSpellList({ names, onChange }: { names: string[]; onChange: (names: string[]) => void }) {
  const { pool } = useSpellPool(ANY_SPELL_LIST, 9);
  const [filling, setFilling] = useState("");
  const byKey = useMemo(() => new Map(pool.map((spell) => [textKey(spell.name), spell])), [pool]);
  const lookups = useSpellLookups(names);
  const chosen = useMemo(() => new Set(names.map(textKey)), [names]);
  const levelOf = (name: string): number | null =>
    byKey.get(textKey(name))?.level ?? spellLevelOf(name) ?? lookups.get(textKey(name))?.level ?? null;
  const full = names.length >= CUSTOM_LIST_MAX;

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
      {ordered.map(([level, group]) => (
        <div key={String(level)} className="live-in flex flex-wrap items-center gap-1.5 text-xs">
          <span className="w-24 shrink-0 text-stone-400">
            {level === null ? "Level unknown" : LEVEL_WORDS[level]} ({group.length})
          </span>
          {group.sort(compareNames).map((name) => (
            <span
              key={name}
              className={cn(
                "inline-flex items-center rounded-md border border-stone-700 pl-2 text-stone-200",
                byKey.get(textKey(name))?.source === "homebrew" && "text-amber-300",
              )}
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
          label="Find a spell to add to the class's list"
          placeholder={full ? "The list is full" : "Find a spell to add: fire bolt, shield..."}
          onPick={(spell) => add([spell.name])}
        />
        <AddFromList
          prompt={filling ? `Adding the ${filling}'s list` : "Add a published class's whole list"}
          disabled={Boolean(filling) || full}
          className="min-h-10 sm:min-h-0"
          options={SPELL_LISTS.map((list) => ({ value: list, label: `The ${list}'s list` }))}
          onPick={(list) => {
            setFilling(list);
            void listNames(list)
              .then(add)
              .finally(() => setFilling(""));
          }}
        />
      </div>
    </div>
  );
}
