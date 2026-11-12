// Factions and reputation (docs/vtt-parity-implementation-plan.md section
// 6): the pure half. A faction has a stance toward the party and a power
// the world's arcs move; the party has a reputation with each, minus five
// to five, that leans every social check with one of its members.

import { containsPhrase, textKey } from "../language/text-logic.ts";

export const FACTION_ATTITUDES = ["hostile", "wary", "neutral", "friendly", "allied"] as const;
export type FactionAttitude = (typeof FACTION_ATTITUDES)[number];

export type Faction = {
  id: string;
  campaignId: string;
  name: string;
  blurb: string;
  // DM-only: what they are working toward.
  goal: string;
  attitude: FactionAttitude;
  // 0 (a rumour) to 5 (they run the city). DM-only.
  power: number;
  tags: string[];
  portraitPath: string;
  createdAt: string;
  updatedAt: string;
};

export const REPUTATION_MIN = -5;
export const REPUTATION_MAX = 5;
export const POWER_MAX = 5;

export function clampReputation(value: number): number {
  return Math.max(REPUTATION_MIN, Math.min(REPUTATION_MAX, Math.round(value) || 0));
}

export function clampPower(value: number): number {
  return Math.max(0, Math.min(POWER_MAX, Math.round(value) || 0));
}

export function normalizeFactionAttitude(raw: unknown): FactionAttitude {
  return FACTION_ATTITUDES.includes(raw as FactionAttitude) ? (raw as FactionAttitude) : "neutral";
}

export function normalizeReputation(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object") {
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      const number = Number(value);
      if (id && Number.isFinite(number) && number !== 0) {
        out[id] = clampReputation(number);
      }
    }
  }
  return out;
}

// The words a player sees for a standing, so the table never watches a
// number tick.
export function reputationLabel(value: number): string {
  if (value <= -4) return "hunted";
  if (value <= -2) return "disliked";
  if (value < 0) return "suspected";
  if (value === 0) return "unknown";
  if (value < 2) return "noticed";
  if (value < 4) return "trusted";
  return "honoured";
}

// A social check with a faction's member leans on the party's standing:
// each point of reputation is a point off the DC, each point against is a
// point on. Bounded by the reputation range itself.
export function reputationDcOffset(reputation: number): number {
  return 0 - clampReputation(reputation) || 0;
}

// The chapter tick (section 6): a faction's goal advances on background
// dice the way an NPC's does, and its power drifts with it. Returns the
// facts the world should record.
export function advanceFactionGoals(
  factions: Faction[],
  random: () => number = Math.random,
): Array<{ faction: Faction; power: number; fact: string }> {
  const out: Array<{ faction: Faction; power: number; fact: string }> = [];
  for (const faction of factions) {
    if (!faction.goal.trim()) {
      continue;
    }
    const roll = random();
    if (roll < 0.25) {
      const power = clampPower(faction.power + 1);
      out.push({ faction, power, fact: `${faction.name} gained ground toward: ${faction.goal}` });
    } else if (roll > 0.9) {
      const power = clampPower(faction.power - 1);
      out.push({ faction, power, fact: `${faction.name} suffered a setback in: ${faction.goal}` });
    }
  }
  return out;
}

// A world arc names a faction when the faction's whole name stands in the
// arc's own name or driver as whole words, never inside another word ("the
// Ashford Rebellion" names no Ash); a rung reached moves that faction's
// power.
export function factionsNamedBy(text: string, factions: Faction[]): Faction[] {
  return factions.filter((faction) => Boolean(textKey(faction.name)) && containsPhrase(text, faction.name));
}

// A line of play read for faction names: what it says and when.
export type NamedLine = { content: string; createdAt: string };
// An NPC who belongs to a faction: naming them deals with the faction.
export type FactionMember = { name: string; factionId: string };

function namesFaction(text: string, faction: Faction, members: readonly FactionMember[]): boolean {
  return (
    (Boolean(textKey(faction.name)) && containsPhrase(text, faction.name)) ||
    members.some((member) => member.factionId === faction.id && Boolean(textKey(member.name)) && containsPhrase(text, member.name))
  );
}

// How many of the lines name each faction, by its name or a member's,
// since its standing last moved (issue 870: 56 GM turns named one faction
// and its standing never moved, because nothing showed the GM it was being
// dealt with). Factions named in none are left out.
export function factionsNamedSince(
  factions: readonly Faction[],
  lines: readonly NamedLine[],
  members: readonly FactionMember[],
  movedAt: Readonly<Record<string, string>>,
): Map<string, number> {
  const named = new Map<string, number>();
  for (const faction of factions) {
    const since = movedAt[faction.id] ?? "";
    const count = lines.filter((line) => line.createdAt > since && namesFaction(line.content, faction, members)).length;
    if (count > 0) {
      named.set(faction.id, count);
    }
  }
  return named;
}

// The factions a chapter dealt with whose standing did not move during it:
// named in its play, unmoved since it began. The next GM turn is asked to
// settle each once (src/lib/dm/faction-attention.ts).
export function factionsToSettle(
  factions: readonly Faction[],
  transcript: string,
  members: readonly FactionMember[],
  movedAt: Readonly<Record<string, string>>,
  chapterStartedAt: string,
): string[] {
  return factions
    .filter((faction) => (movedAt[faction.id] ?? "") < chapterStartedAt && namesFaction(transcript, faction, members))
    .map((faction) => faction.id)
    .slice(0, 6);
}

// A faction named this often since its standing last moved is marked in the
// GM's block: once is a passing mention, twice is the party dealing with them.
export const NAMED_MARK_AT = 2;

// When standing moves, in the GM's block: the tool's description alone said
// how, never when, and a 589-turn campaign called it 0 times (issue 870).
export const FACTION_RULE =
  "Standing (-5 to +5) moves only through adjust_reputation, and a member's social checks lean on it. Move it when the party does something a faction's people see or hear of: helps or harms a member, keeps or breaks a bargain, finishes or fails a job for them, works for or against their goal. +1 or -1 for a deed, +2 or -2 for one they will remember. Call it when it happens, before narrating their reaction; ordinary talk moves nothing.";

// The factions block for the prompt: the DM's version carries power and
// goal, the player's carries only how each faction stands.
export function renderFactionsForPrompt(
  factions: Faction[],
  reputation: Record<string, number>,
  dmView: boolean,
  // The GM's view only: how often each faction was named since its standing
  // last moved, and the ones a chapter that just closed dealt with.
  attention: { named: ReadonlyMap<string, number>; settle: readonly string[] } = { named: new Map(), settle: [] },
): string {
  if (!factions.length) {
    return "";
  }
  // The factions in play first, so the twelve listed are the ones that matter.
  const inPlay = (faction: Faction) => (attention.settle.includes(faction.id) ? 1000 : 0) + (attention.named.get(faction.id) ?? 0);
  const ordered = dmView ? [...factions].sort((a, b) => inPlay(b) - inPlay(a)) : factions;
  const lines = ordered.slice(0, 12).map((faction) => {
    const standing = reputation[faction.id] ?? 0;
    const base = `- ${faction.name} (${faction.attitude} to the party; the party is ${reputationLabel(standing)} to them, ${standing >= 0 ? "+" : ""}${standing})`;
    if (!dmView) {
      return `${base}${faction.blurb ? `: ${faction.blurb}` : ""}`;
    }
    const named = attention.named.get(faction.id) ?? 0;
    const mark = named >= NAMED_MARK_AT ? ` | named in ${named} recent lines since its standing last moved` : "";
    return `${base}: ${faction.blurb}${faction.goal ? ` | GOAL (GM-only): ${faction.goal}` : ""} | power ${faction.power}/5${mark}`;
  });
  if (!dmView) {
    return `FACTIONS (standing shifts through adjust_reputation; a member's social checks lean on it):\n${lines.join("\n")}`;
  }
  const settle = attention.settle.map((id) => factions.find((faction) => faction.id === id)?.name).filter((name): name is string => Boolean(name));
  const settleLine = settle.length
    ? `\nThe chapter that just closed dealt with ${settle.join(", ")}, and the party's standing with ${settle.length === 1 ? "it" : "them"} did not move. Settle each once now with adjust_reputation if what the party did there earned regard or a grievance; leave it if nothing did.`
    : "";
  return `FACTIONS. ${FACTION_RULE}\n${lines.join("\n")}${settleLine}`;
}
