import type { PdfImport } from "@/lib/db/pdf-imports";
import type { Draft, DraftRecord, RecordKind } from "@/lib/pdf-import/draft-logic";
import { matchKey } from "@/lib/pdf-import/ai-logic";
import { SYSTEM_LABELS } from "@/lib/pdf-import/foreign-statblock-logic";
import type { MatchOption } from "@/lib/pdf-import/match-logic";

// What the import screens are told: the row's progress, and in review the
// records to look over. A record's working data stays on the server; the
// review gets what it shows (the name, the pages, the words it was read
// from, what to check) and a line of what it holds.

export type ImportView = {
  id: string;
  campaignId: string | null;
  fileName: string;
  title: string;
  pageCount: number;
  pagesReceived: number;
  state: PdfImport["state"];
  step: string;
  done: number;
  total: number;
  useModel: boolean;
  reason: string;
  workshopId: string | null;
  updatedAt: string;
};

export type RecordView = {
  key: string;
  kind: RecordKind;
  name: string;
  pages: number[];
  source: string;
  check: string[];
  include: boolean;
  from: DraftRecord["from"];
  summary: string;
  picture: string;
};

export type ReviewView = {
  title: string;
  // The system the book was written for, in words, when it is not 5e.
  system: string;
  premise: string;
  party: Draft["party"];
  modelNote: string;
  modelUsed: boolean;
  // Pieces of the book the model could not read, which reading again asks
  // for once more.
  modelFailed: number;
  records: RecordView[];
  links: number;
  secrets: number;
  // The creatures to confirm against SRD 5.1, each with its options.
  matches: MatchView[];
};

export type MatchView = {
  key: string;
  name: string;
  about: string;
  pages: number[];
  own: boolean;
  options: MatchOption[];
  suggested: string | null;
  how: "name" | "model" | "guess" | "none";
  current: string | null;
  confirmed: boolean;
  // The records the choice changes, by key: when the GM leaves all of them
  // out, the match waits for nobody.
  records: string[];
  // The kept fights and people that would bring its creature in anyway.
  usedBy: string[];
};

export function importView(item: PdfImport): ImportView {
  return {
    id: item.id,
    campaignId: item.campaignId,
    fileName: item.fileName,
    title: item.title,
    pageCount: item.pageCount,
    pagesReceived: item.pagesReceived,
    state: item.state,
    step: item.step,
    done: item.done,
    total: item.total,
    useModel: item.useModel,
    reason: item.reason,
    workshopId: item.workshopId,
    updatedAt: item.updatedAt,
  };
}

const str = (value: unknown) => (typeof value === "string" ? value : "");
const short = (text: string, max = 180) => {
  const clean = text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 3).trimEnd()}...`;
};

// One line of what a record holds, in the review's words.
export function recordSummary(record: DraftRecord): string {
  const data = record.data;
  switch (record.kind) {
    case "monster": {
      const stats = data.stats as { ac?: number; maxHp?: number; cr?: number } | null | undefined;
      const srd = str(data.srd);
      // A creature that is the SRD's own shows only that; one with numbers
      // (its own, the SRD's under its name, or a conversion) shows them.
      const body = stats ? [(stats as { size?: string }).size, (stats as { type?: string }).type].filter(Boolean).join(" ") : "";
      const numbers = stats ? `AC ${stats.ac}, ${stats.maxHp} HP, CR ${stats.cr}` : "";
      return short([srd ? `SRD 5.1: ${srd}` : data.converted ? "Converted to 5.1" : "", body, numbers].filter(Boolean).join(" · "));
    }
    case "npc":
      return short([str(data.role), str(data.description) || str(data.trait)].filter(Boolean).join(": "));
    case "location":
      return short([str(data.partOf) && `In ${str(data.partOf)}.`, str(data.layoutDescription)].filter(Boolean).join(" "));
    case "faction":
      return short(str(data.goal) || str(data.description));
    case "item":
      return short([str(data.srd) ? `SRD 5.1: ${str(data.srd)}` : str(data.srdFamily) ? `SRD 5.1: ${str(data.srdFamily)} (the book's own)` : "", str(data.rarity), data.attunement ? "requires attunement" : "", str(data.description)].filter(Boolean).join(" · "));
    case "spell":
      return short([str(data.srd) ? `SRD 5.1: ${str(data.srd)}` : `Level ${data.level ?? 0}`, str(data.description)].filter(Boolean).join(" · "));
    case "table": {
      const entries = (data.entries as unknown[] | undefined)?.length ?? 0;
      return `d${data.die} · ${entries} rows`;
    }
    case "map": {
      const grid = data.grid as { cell?: number } | null | undefined;
      return grid?.cell ? `A battle map, grid of ${Math.round(grid.cell)} pixels a square` : "A map picture; set its scale in the map editor";
    }
    case "encounter": {
      const creatures = (data.creatures as Array<{ name: string; count: number }> | undefined) ?? [];
      return short(creatures.map((creature) => `${creature.count} ${creature.name}`).join(", "));
    }
    case "beat":
      return short(str(data.body));
    case "lore":
      return short(str(data.body));
    case "art":
      return "A picture from the book";
    default:
      return "";
  }
}

export function reviewView(draft: Draft): ReviewView {
  return {
    title: draft.title,
    system: draft.system && draft.system !== "5e" ? SYSTEM_LABELS[draft.system] : "",
    premise: draft.premise,
    party: draft.party,
    modelNote: draft.model?.note ?? "",
    modelUsed: draft.model?.used ?? false,
    modelFailed: draft.model?.failed ?? 0,
    records: draft.records.map((record) => ({
      key: record.key,
      kind: record.kind,
      name: record.name,
      pages: record.pages,
      source: record.source,
      check: [...record.check, ...((record.data.matchCheck as string[] | undefined) ?? [])],
      include: record.include,
      from: record.from,
      summary: recordSummary(record),
      picture: record.kind === "map" || record.kind === "art" ? str(record.data.picture) : "",
    })),
    links: draft.links?.length ?? 0,
    secrets: draft.secrets?.length ?? 0,
    matches: (draft.matches ?? []).map((ask) => ({
      key: ask.key,
      name: ask.name,
      about: ask.about,
      pages: ask.pages,
      own: ask.own,
      options: ask.options,
      suggested: ask.suggested,
      how: ask.how,
      current: ask.current,
      confirmed: ask.confirmed,
      records: [...new Set(ask.targets.map((target) => target.record))],
      usedBy: usersOf(draft, ask.targets.map((target) => target.record)),
    })),
  };
}

// The fights and people that fight with any of these creature records (by
// its name or its key), which bring it in though it is left out
// (takenRecords in bundle-logic.ts).
function usersOf(draft: Draft, recordKeys: string[]): string[] {
  const monsters = draft.records.filter((record) => record.kind === "monster" && recordKeys.includes(record.key));
  if (!monsters.length) return [];
  const names = new Set(monsters.flatMap((record) => [matchKey(record.name), matchKey(record.key)]));
  return draft.records
    .filter((record) =>
      record.kind === "encounter"
        ? ((record.data.creatures as Array<{ name: string }> | undefined) ?? []).some((creature) => names.has(matchKey(creature.name)))
        : record.kind === "npc" && names.has(matchKey(str(record.data.statBlock))),
    )
    .map((record) => record.key);
}
