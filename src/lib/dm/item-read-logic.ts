// The read of one exchange for things and money changing hands (issue 1097):
// what the reader is asked, and how its reply is held to the narration and the
// engine's refs before any of it acts. The rulings on what survives are
// src/lib/dm/item-claims-logic.ts, where the whole story is told; the call
// itself is src/lib/dm/item-claims.ts readItemMoves.
//
// The read is a call of its own, not one more kind in the claims reader's
// (claims-logic.ts). Measured on gpt-oss-20b, the 16 GB minimum, over the
// issue's own passages and a dozen or so more (2026-11-24): asked as a claim
// kind among the others it read about six in ten right and missed the
// issue's ration outright; asked alone it read eight in ten, the issue's
// ration and its ledger every time, and every passage where nothing moved
// (a thing offered, a bribe refused, a gift cut short, a meal) as nothing.
//
// It rides the claims reader's own system prompt, word for word, and puts
// everything of its own in the message. A local server keeps a prompt it has
// read by its opening words, and the two reads share a helper slot: a prompt
// of its own would be read whole on every turn, and the claims reader's read
// whole again after it. Riding it, a read took in about 60 new tokens by the
// server's own count (a BC-250, the same day). Told in the message that the
// rules above do not apply, the small model read it about as well as it read
// a prompt of its own.
//
// Pure, so scripts/test-items-change-hands.mjs loads it directly.

import { z } from "zod";
import { parseReaderReply, squash } from "./claims-logic.ts";
import { stems } from "../language/language.ts";
import { textKey } from "../language/text-logic.ts";
import type { TableLanguage } from "../schemas/game-settings-options.ts";
import { parseCoins } from "../srd/currency.ts";
import { baseName, lineNamed } from "../srd/item-row.ts";

// How a thing or money moves: into a party character's keeping, handed on by
// them, used up by them, or taken from them.
export const ITEM_CHANGES = ["gains", "gives", "uses", "loses"] as const;
export type ItemChange = (typeof ITEM_CHANGES)[number];

// One hand-off the narration shows, held to the engine's refs
// (checkItemMoves): who, by id and name, and what. `item` is the carried
// line's own name when `carried` is set, the narration's words for a thing
// gained, and the amount as written for money, which `copper` holds counted.
// `to` is the other party character who receives a thing given, by id.
// `said`: the character's own player wrote that they do it.
export type ItemClaim = {
  kind: "item";
  character: string;
  name: string;
  change: ItemChange;
  item: string;
  carried?: true;
  copper?: number;
  qty?: number;
  to?: string;
  said?: true;
  quote: string;
};

// Money as the reader writes it: digits and the coins' codes ("5 gp", "3 sp
// 2 cp"), in copper. A bare number is no amount here: parseCoins reads one as
// gold, and "2" may be two of anything.
const COIN_CODE = /(?:^|[\s\d])(?:pp|gp|ep|sp|cp)(?![\p{L}\p{N}])/iu;

export function copperOf(text: string): number | null {
  return COIN_CODE.test(text) ? parseCoins(text) : null;
}

export type ItemRefs = {
  party: ReadonlyArray<{ ref: string; name: string }>;
  // What each party character carries, by the ref the reader copies.
  carried: ReadonlyArray<{ ref: string; name: string; qty: number; by: string }>;
};

// What the read is asked, in the message: the claims reader's system prompt
// goes before it unchanged (see the head of this file), so the kind is
// defined here, with its own rules. Narrow on purpose: a claim sends the
// narrator back to its tools or takes a thing off a sheet, so everything
// that only looks like a hand-off is named as not one. A thing leaving a
// character is named by the ref of the line they carry, so "one of my
// rations" is the sheet's own "Rations (1 day)" and a strip of dried meat
// nobody carries is no claim at all. A meal is no use: the day's food is the
// server's to count at dawn (supplies.ts), and a ration told eaten by the
// fire would be eaten twice.
const ITEM_ASK = `Ask: item
This message is a different job from the one described above. The claim kinds and the rules above do not apply to it: follow only what this message says. Here you read one exchange of the game for things and money changing hands. Below are what each party character carries, what the players wrote this turn, and the narration that answered them. List every thing or amount of money that passes into or out of a party character's keeping in the narration, and nothing else.

Answer as before with exactly one JSON object, {"claims":[ ... ]}, holding only item claims; with nothing to report, {"claims":[]}.

One item claim: {"kind":"item","who":PARTY_REF,"change":"gains"|"gives"|"uses"|"loses","item":ITEM,"qty":N,"to":PARTY_REF,"said":true|false,"quote":Q}
- who: the party character whose pack or purse changes, by the ref listed below.
- change: "gains" when they are handed it, are paid it, or take it and keep it. "gives" when they hand it over, give it away or pay it, to anyone; when someone takes or accepts what the character holds out, that is the character's gives. "uses" when they drink it, read it, light it or use it up (a potion drunk, a scroll read, a torch lit); an ordinary meal or a drink of water is not a use and is left out. "loses" when it is stolen or taken from them against their will, lost or destroyed.
- item: the Item ref, when the thing is one listed below as carried by that character. Otherwise its name in a few words, as the narration writes it. Money is only ever the amount in digits with the coin's code pp, gp, ep, sp or cp: "5 gp", "14 sp".
- qty: only when the narration says how many.
- to: only when another party character is the one who receives it.
- said: true when that character's own player wrote, in the Player's words below, that their character does this ("I hand her one of my rations", "I pay him 5 gold", "I drink the potion"); false when the narration does it without their player having written it.
- quote: a short span copied exactly from the Narration, the words that show it happen. Never from the Player's words.

Rules:
- The Player's words say what a character tries to do. The narration decides whether it happens: a thing a player hands over or pays is an item only when the narration has it taken, accepted, pocketed or used. When the other refuses it or pushes it back ("Keep it."), or the narration interrupts it or does not get to it, nothing moved: no item of any kind.
- "you" in the narration is a party character: the one whose player wrote, or the only one when the party has one.
- What characters say aloud is read like the rest of the narration here: a thing handed over between two spoken lines still changed hands.
- No item for: a thing only offered, shown, held out, priced, asked for or promised and not yet taken; gear its owner draws, puts away, puts on, wields, throws or sets down and keeps; what a character only says, remembers or reports; anything told as already done before now ("the ration you gave her yesterday").`;

// The message of the read: the ask, the refs, what the players wrote this
// exchange and the narration that answered them. What changes least comes
// first, so a local server that keeps what it read keeps the most of it.
export function itemRequest(refs: ItemRefs, said: string, narration: string): string {
  const party = refs.party.map((entry) => `"${entry.ref}" for ${entry.name}`).join(", ") || "(none)";
  const carried = refs.carried.map((entry) => `"${entry.ref}" for ${entry.name}${entry.qty > 1 ? ` x${entry.qty}` : ""} (${entry.by})`).join(", ") || "(none)";
  return `${ITEM_ASK}\n\nParty refs: ${party}\nItem refs: ${carried}\n\nPlayer's words:\n<<<\n${said.trim() || "(none)"}\n>>>\n\nNarration:\n<<<\n${narration}\n>>>`;
}

// Whether a request is this read, for what answers the reader in a test
// (scripts/lib/claims-reader.mjs) apart from the claims reader's own.
export const ITEM_ASK_START = "Ask: item\n";

const moveSchema = z.object({
  kind: z.literal("item"),
  who: z.string().min(1).max(120),
  change: z.enum(ITEM_CHANGES),
  item: z.string().trim().min(1).max(120),
  // A model writes null, or a count as text, for a field it leaves empty or
  // copies from the prose: the claim still counts, as one of the thing.
  qty: z.coerce.number().int().min(1).max(999).nullable().optional().catch(undefined),
  to: z.string().max(120).nullable().optional().catch(undefined),
  said: z.boolean().nullable().optional().catch(undefined),
  quote: z.string().trim().min(1).max(600),
});

export type ItemContext = {
  // The narration that was read.
  text: string;
  // Party character id to name.
  party: ReadonlyMap<string, string>;
  // Each line a party character carries, by the ref the request listed.
  carried: ReadonlyMap<string, { characterId: string; name: string }>;
  language: TableLanguage;
};

type Line = { ref: string; characterId: string; name: string };

// A name's words without its trailing note, by stem and in order, so "ration"
// is "Rations (1 day)" and "healing potions" a "Potion of Healing" is not.
function stemmed(name: string, language: TableLanguage): string {
  return stems(baseName(name), language).join(" ");
}

// The one line of a character's the reader's words name, when it wrote the
// line's name out instead of copying its ref: the whole name (item-row.ts
// lineNamed), else the whole name by stem, when one line is so named.
function lineWritten(own: readonly Line[], written: string, language: TableLanguage): Line | undefined {
  const exact = own[lineNamed(own, written)];
  if (exact) {
    return exact;
  }
  const wanted = stemmed(written, language);
  const named = wanted ? own.filter((line) => stemmed(line.name, language) === wanted) : [];
  return new Set(named.map((line) => textKey(line.name))).size === 1 ? named[0] : undefined;
}

// The claims a reply makes that may act: shaped as an item, quoting the
// narration word for word, and naming a party character. A thing leaves only
// the pack that holds it: one nobody listed carries (a strip of dried meat
// the prose made up) is no claim, and what a character already carries is no
// gain. null when the reply cannot be read at all.
export function checkItemMoves(reply: string, context: ItemContext): ItemClaim[] | null {
  const raw = parseReaderReply(reply);
  if (!raw) {
    return null;
  }
  const narration = squash(context.text);
  const lines: Line[] = [...context.carried].map(([ref, line]) => ({ ref, ...line }));
  const kept: ItemClaim[] = [];
  for (const entry of raw) {
    const parsed = moveSchema.safeParse(entry);
    if (!parsed.success) {
      continue;
    }
    const claim = parsed.data;
    const name = context.party.get(claim.who);
    if (!name || !narration.includes(squash(claim.quote))) {
      continue;
    }
    const base = { kind: "item" as const, character: claim.who, name, quote: claim.quote, ...(claim.said === true && claim.change !== "gains" && claim.change !== "loses" ? { said: true as const } : {}) };
    const copper = copperOf(claim.item);
    if (copper !== null) {
      if (copper > 0) {
        kept.push({ ...base, change: claim.change, item: claim.item, copper });
      }
      continue;
    }
    const qty = claim.qty ? { qty: claim.qty } : {};
    const line = lines.find((entry) => entry.ref === claim.item) ?? lineWritten(lines.filter((entry) => entry.characterId === claim.who), claim.item, context.language);
    if (claim.change === "gains") {
      // Another's line gained is named by its name: the ref is its giver's.
      if (line?.characterId !== claim.who) {
        kept.push({ ...base, change: "gains", item: line?.name ?? claim.item, ...qty });
      }
      continue;
    }
    if (line?.characterId !== claim.who) {
      continue;
    }
    // Only another of the party is a receiver the engine can hand to.
    const to = claim.change === "gives" && claim.to && claim.to !== claim.who && context.party.has(claim.to) ? { to: claim.to } : {};
    kept.push({ ...base, change: claim.change, item: line.name, carried: true, ...qty, ...to });
  }
  return kept;
}
