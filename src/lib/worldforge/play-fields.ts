import { parseRef, type Shelf, type Veracity, type WorldDoc, type WorldLink } from "@/lib/worldforge/model";

// The two places a World link and play's own columns say the same thing
// about a Cast member (audit finding WF-12): which faction they belong to
// ("member of") and where they live ("lives in", "located in"). Play reads
// the Cast's columns, not the links, so a link alone changes nothing at the
// table. Here each such link is set beside the column as a proposal, with
// what applying it would do; nothing is copied until the author picks one
// (src/lib/db/world-play.ts). Every other link stays story only. Pure.

export type PlayField = "faction" | "home";

export const PLAY_FIELDS: PlayField[] = ["faction", "home"];

// The link words each column reads, and the shelf the link must reach.
export const PLAY_WORDS: Record<PlayField, readonly string[]> = {
  faction: ["member of"],
  home: ["lives in", "located in"],
};

const TARGET: Record<PlayField, Shelf> = { faction: "faction", home: "location" };

// A link set beside the column:
// - "same": the column already says it.
// - "fills": the column is empty, and this would fill it.
// - "differs": the column says something else; applying it replaces that.
// - "false": a false belief. Play never takes it, because it is not true.
export type PlayState = "same" | "fills" | "differs" | "false";

export type PlayCandidate = {
  linkId: string;
  to: string;
  name: string;
  rank: string;
  veracity: Veracity;
  state: PlayState;
};

export type PlayAdapter = {
  field: PlayField;
  // What play uses now: the record it names ("" when the home is a place
  // name no World entry has), or null for nothing.
  current: { ref: string; name: string } | null;
  candidates: PlayCandidate[];
};

// The column a link from a Cast member speaks to, or null for a link that
// stays story only.
export function playFieldOf(label: string, shelf: Shelf | undefined): PlayField | null {
  return PLAY_FIELDS.find((field) => PLAY_WORDS[field].includes(label) && TARGET[field] === shelf) ?? null;
}

// The links from one Cast member that could set this column.
export function linksFor(doc: Pick<WorldDoc, "links">, npcRef: string, field: PlayField): WorldLink[] {
  return doc.links.filter((link) => link.from === npcRef && playFieldOf(link.label, parseRef(link.to)?.shelf) === field);
}

// Both columns, for an entry page. A column no link speaks to is left out:
// there is nothing to review, and the Cast's value shows with the rest.
export function playAdapters(
  doc: Pick<WorldDoc, "links">,
  npcRef: string,
  current: Record<PlayField, { ref: string; name: string } | null>,
  names: ReadonlyMap<string, string>,
): PlayAdapter[] {
  const out: PlayAdapter[] = [];
  for (const field of PLAY_FIELDS) {
    const now = current[field];
    const candidates = linksFor(doc, npcRef, field)
      .filter((link) => names.has(link.to))
      .map((link): PlayCandidate => ({
        linkId: link.id,
        to: link.to,
        name: names.get(link.to) ?? "",
        rank: link.rank,
        veracity: link.veracity,
        state: link.veracity === "believed" ? "false" : !now ? "fills" : now.ref === link.to ? "same" : "differs",
      }));
    if (candidates.length) out.push({ field, current: now, candidates });
  }
  return out;
}

// Whether one link may set the column. A false belief never does; a
// hidden truth only when the author says to use the truth (`truth`).
export function playLink(doc: Pick<WorldDoc, "links">, npcRef: string, field: PlayField, linkId: string, truth: boolean): { link: WorldLink } | { error: string } {
  const link = linksFor(doc, npcRef, field).find((entry) => entry.id === linkId);
  if (!link) return { error: field === "faction" ? "That is not one of their \"member of\" links to a faction." : "That is not one of their links to a place they live." };
  if (link.veracity === "believed") return { error: "That link is a false belief, so play does not take it." };
  if (link.veracity === "hidden" && !truth) return { error: "That link is a hidden truth. Say to use the truth in play to apply it." };
  return { link };
}
