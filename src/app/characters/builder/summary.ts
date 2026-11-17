import { ABILITIES } from "@/lib/schemas/abilities";
import type { Ability, AbilityScores } from "@/lib/schemas/sheet";
import { owedPicks, type OwedPick } from "./owed";
import type { StepBlock } from "./submit";
import { pluralOf } from "@/lib/messages-logic";

// The summary at the top of the last step (backlog F3): one row per step,
// what it holds in plain words and every pick it still owes, each with a
// way to the field that takes it. An edit opens here and a new build ends
// here, so the rows are what a player reads before saving. Pure, for
// scripts/test-builder-summary.mjs.

// One row per step before the summary, in the wizard's order (backlog F4:
// the class first, the name and story last).
export type SummaryRowKey = "calling" | "ancestry" | "abilities" | "spells-gear" | "identity";

export type SummaryRow = {
  key: SummaryRowKey;
  label: string;
  // What the step holds, one plain line each.
  lines: string[];
  // What it still owes, in the gate's order (owed.ts).
  owed: OwedPick[];
};

export type SummaryInput = {
  name: string;
  background?: string;
  race?: string;
  klass?: string;
  subclass?: string;
  level: number;
  // Asked on the class step, above the cards it changes, so its row says it.
  gender?: string;
  abilities: AbilityScores | null;
  casts: boolean;
  cantrips: string[];
  spells: string[];
  gear: Array<{ name: string; qty: number }>;
  alignment?: string;
  portrait: boolean;
  appearance: boolean;
  backstory: boolean;
  owed: {
    identity: ReadonlyArray<StepBlock>;
    ancestry: ReadonlyArray<StepBlock>;
    calling: ReadonlyArray<StepBlock>;
    abilities: ReadonlyArray<StepBlock>;
    spells: ReadonlyArray<StepBlock>;
  };
};

const ABILITY_SHORT: Record<Ability, string> = {
  str: "Str",
  dex: "Dex",
  con: "Con",
  int: "Int",
  wis: "Wis",
  cha: "Cha",
};

// "Fire Bolt, Light and 2 more": a few names, then a count. `t` says the
// join and the count in the reader's language; without it the English.
export function someNames(names: string[], shown = 3, t?: (key: string, vars?: Record<string, string | number>) => string): string {
  if (names.length <= shown) {
    if (names.length <= 1) return names.join("");
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, shown).join(", ")}${t ? t(" and {count} more", { count: names.length - shown, context: "builder.summaryrow.andMore" }) : ` and ${names.length - shown} more`}`;
}

// The caller's translator (home/types.ts agoLabel pattern): the rows, their
// lines and the owed picks' labels all read in the reader's language. The
// ability codes ("Str 15") stay the sheet's own shorthand.
export function summaryRows(t: (key: string, vars?: Record<string, string | number>) => string, input: SummaryInput): SummaryRow[] {
  const tp = pluralOf(t);
  const name = input.name.trim();
  const items = input.gear.reduce((sum, item) => sum + Math.max(item.qty, 1), 0);
  const gearLine = items
    ? tp("Gear: {count} item, {names}", "Gear: {count} items, {names}", { count: items, names: someNames(input.gear.map((item) => item.name), 3, t) })
    : t("No gear packed");
  const touches = [
    input.alignment ? t("Alignment {alignment}", { alignment: input.alignment }) : null,
    input.portrait ? t("Portrait added") : t("No portrait yet"),
    input.appearance ? t("Appearance written") : null,
    input.backstory ? t("Backstory written") : t("No backstory yet"),
  ].filter((line): line is string => Boolean(line));
  return [
    {
      key: "calling",
      label: t("Class"),
      lines: [
        ...(input.klass
          ? [t("{klass}, level {level}", { klass: input.klass, level: input.level }), ...(input.subclass ? [input.subclass] : [])]
          : [t("No class chosen")]),
        // Said only once chosen: it is optional, and owes nothing unset.
        ...(input.gender ? [t("Gender: {gender}", { gender: input.gender })] : []),
      ],
      owed: owedPicks(t, input.owed.calling),
    },
    {
      key: "ancestry",
      label: t("Ancestry and background"),
      lines: [
        input.race ? t("{race}", { race: input.race }) : t("No ancestry chosen"),
        input.background ? t("{background} background", { background: input.background }) : t("No background chosen"),
      ],
      owed: owedPicks(t, input.owed.ancestry),
    },
    {
      key: "abilities",
      label: t("Ability scores", { context: "builder.summaryrow.abilities" }),
      lines: [
        input.abilities
          ? ABILITIES.map((ability) => `${ABILITY_SHORT[ability]} ${input.abilities?.[ability]}`).join(", ")
          : t("Not set yet"),
      ],
      owed: owedPicks(t, input.owed.abilities),
    },
    {
      key: "spells-gear",
      label: input.casts ? t("Spells and gear") : t("Gear"),
      lines: [
        ...(input.casts
          ? [
              input.cantrips.length ? t("Cantrips: {names}", { names: someNames(input.cantrips, 3, t) }) : t("No cantrips chosen"),
              input.spells.length ? t("Spells: {names}", { names: someNames(input.spells, 3, t) }) : t("No spells chosen"),
            ]
          : []),
        gearLine,
      ],
      owed: owedPicks(t, input.owed.spells),
    },
    {
      key: "identity",
      label: t("Name and story"),
      lines: [name || t("No name yet"), ...touches],
      owed: owedPicks(t, input.owed.identity),
    },
  ];
}

// Every pick still owed across the rows, for the line above them.
export function summaryOwedCount(rows: SummaryRow[]): number {
  return rows.reduce((sum, row) => sum + row.owed.length, 0);
}
