// Bonds between a mind and each person it knows (docs/specs/ogm-npc-
// perception.md §10): trust, affection and fear from −100 to 100, moved only
// by what the mind itself took in, by a fixed table, each move keeping its
// reason. They do not fade. Pure.
import type { SceneEvent, SenseChannel } from "@/lib/dm/scene-events-logic";
import { textKey } from "@/lib/language/text-logic";

export type Bond = { toward: string; trust: number; affection: number; fear: number; reasons: string[] };
export type BondDelta = { toward: string; trust: number; affection: number; fear: number; reason: string };

type Row = { trust: number; affection: number; fear: number; did: string };

// Done to the mind itself.
const TO_ME: Partial<Record<SceneEvent["verb"], Row>> = {
  strike: { trust: -20, affection: -10, fear: 15, did: "struck you" },
  push: { trust: -10, affection: -5, fear: 5, did: "shoved you" },
  grab: { trust: -10, affection: -5, fear: 5, did: "grabbed you" },
  bind: { trust: -25, affection: -10, fear: 20, did: "tied you up" },
  steal: { trust: -25, affection: -10, fear: 0, did: "stole from you" },
  threaten: { trust: -10, affection: -5, fear: 10, did: "threatened you" },
  give: { trust: 10, affection: 10, fear: 0, did: "gave you something" },
  heal: { trust: 15, affection: 10, fear: 0, did: "tended your wounds" },
  free: { trust: 15, affection: 10, fear: -5, did: "freed you" },
  help: { trust: 10, affection: 5, fear: 0, did: "helped you" },
  embrace: { trust: 5, affection: 5, fear: 0, did: "embraced you" },
};

// Seen done to someone else: the actor is judged by it, more so when the
// one it was done to is dear to the mind.
const TO_OTHER: Partial<Record<SceneEvent["verb"], Row>> = {
  strike: { trust: -5, affection: 0, fear: 5, did: "struck" },
  bind: { trust: -5, affection: 0, fear: 5, did: "tied up" },
  steal: { trust: -10, affection: 0, fear: 0, did: "stole from" },
  threaten: { trust: -3, affection: 0, fear: 3, did: "threatened" },
  give: { trust: 3, affection: 0, fear: 0, did: "gave something to" },
  heal: { trust: 5, affection: 3, fear: 0, did: "tended" },
  free: { trust: 3, affection: 0, fear: 0, did: "freed" },
  help: { trust: 3, affection: 0, fear: 0, did: "helped" },
};

const DEAR = 20;

// How the bonds of one observer move for one event it took in. Hearing alone
// carries a threat, not a blow it did not see; nothing it does itself moves
// its own bonds; a dear one hurt doubles the blame (and a foe hurt halves it).
export function bondDeltas(
  event: Pick<SceneEvent, "actor" | "verb" | "targets" | "object">,
  observer: string,
  channels: readonly SenseChannel[],
  affectionToward: (name: string) => number,
): BondDelta[] {
  if (!event.actor || textKey(event.actor) === textKey(observer)) {
    return [];
  }
  const witnessed = channels.includes("sight") || channels.includes("touch") || (event.verb === "threaten" && channels.includes("hearing"));
  if (!witnessed) {
    return [];
  }
  const thing = event.object ? ` (${event.object})` : "";
  if (event.targets.some((target) => textKey(target) === textKey(observer))) {
    const row = TO_ME[event.verb];
    return row ? [{ toward: event.actor, trust: row.trust, affection: row.affection, fear: row.fear, reason: `${row.did}${thing}` }] : [];
  }
  const row = TO_OTHER[event.verb];
  const victim = event.targets[0];
  if (!row || !victim) {
    return [];
  }
  const care = affectionToward(victim);
  const harm = row.trust < 0;
  const scale = care >= DEAR ? 2 : care <= -DEAR ? (harm ? 0.5 : 1) : 1;
  const out: BondDelta[] = [{ toward: event.actor, trust: Math.round(row.trust * scale), affection: harm && care >= DEAR ? -10 : row.affection, fear: row.fear, reason: `${row.did} ${victim}${thing}` }];
  return out;
}

const clamp = (value: number) => Math.max(-100, Math.min(100, Math.round(value)));

export function applyDelta(bond: Bond | null, delta: BondDelta): Bond {
  const base = bond ?? { toward: delta.toward, trust: 0, affection: 0, fear: 0, reasons: [] };
  return {
    toward: base.toward,
    trust: clamp(base.trust + delta.trust),
    affection: clamp(base.affection + delta.affection),
    fear: clamp(Math.max(0, base.fear + delta.fear)),
    reasons: [...base.reasons.filter((reason) => reason !== delta.reason), delta.reason].slice(-3),
  };
}

// The bond in plain words, with why: "you do not trust them, a little afraid
// of them (they: struck you; stole from Kaku (Galletta))". "" when neutral.
export function bondWords(bond: Bond): string {
  const feelings = [
    bond.trust <= -30 ? "you do not trust them" : bond.trust <= -10 ? "you are wary of them" : bond.trust >= 30 ? "you trust them" : bond.trust >= 10 ? "you rather trust them" : "",
    bond.affection <= -30 ? "you dislike them" : bond.affection >= 30 ? "you care for them" : bond.affection >= 10 ? "you are fond of them" : "",
    bond.fear >= 30 ? "you fear them" : bond.fear >= 10 ? "a little afraid of them" : "",
  ].filter(Boolean);
  return feelings.length ? `${bond.toward}: ${feelings.join(", ")}${bond.reasons.length ? ` (they ${bond.reasons.join("; ")})` : ""}` : "";
}
