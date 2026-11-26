// Things and money the story moved with no tool behind them (issue 1097). A
// player handed an NPC one of their ten rations, the narrator wrote her
// taking it, called no tool, and the sheet still showed ten; a turn earlier
// the same narrator pressed a ledger into the hero's hands that never reached
// the pack. The engine boundary names gold and inventory as the server's
// (engine-boundary.ts), and nothing checked it: a spell, a blow and a fight
// told in prose alone were each caught, a hand-off was not.
//
// One read of the exchange finds the hand-offs (src/lib/dm/item-read-logic.ts),
// and this module holds the three rulings on what it found, all from the
// engine's own state:
//   - which moves a call of this turn already recorded (unrecordedItems);
//   - which of the rest the engine carries out itself (engineItemCall): only
//     a thing a character's own player said they hand over or use, that the
//     narration then shows happening, from a line their sheet holds. The
//     player decided it and the narrator agreed; nothing is invented;
//   - what is left, which is the narrator's to settle: it is sent back once
//     to its tools (unrecordedItemsPrompt), and what is still open when the
//     turn ends is a note it reads next turn (itemNote).
// A thing the world gives or takes is never moved by the engine alone: only
// the narrator knows whether the ledger was taken or only held out.
//
// Pure: the reply, the turn's calls and the players' words in, the claims,
// the calls and the texts out. src/lib/dm/item-claims.ts is its database
// half.

import { stems } from "../language/language.ts";
import { containsPhrase, textKey, words } from "../language/text-logic.ts";
import type { TableLanguage } from "../schemas/game-settings-options.ts";
import { coinMove } from "../srd/currency.ts";
import { baseName, lineNamed } from "../srd/item-row.ts";
import type { ItemClaim } from "./item-read-logic.ts";

// One call of the turn, as the turn reads its own calls (turn.ts turnCalls):
// under the name and the argument names the engine reads now.
export type ItemCall = { name: string; args: Record<string, unknown>; result: Record<string, unknown> | null };

// What one call moved for one character. `who` is "*" for a call that moves
// things for the whole party (a hoard rolled and split, a night's rations).
// `item` is absent for a move of anything (a rest eats what it eats).
type ItemMove = { who: string; way: "in" | "out"; money: boolean; item?: string };

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

// The items a call names: grant_item and purchase list theirs, the rest name
// one.
function namedItems(args: Record<string, unknown>): string[] {
  const listed = Array.isArray(args.items) ? args.items.flatMap((entry) => (entry && typeof entry === "object" ? [text((entry as Record<string, unknown>).item)] : [])) : [];
  return [...listed, text(args.item)].filter(Boolean);
}

// The tools that eat or grant without naming what: a rest and the road eat
// the day's rations, downtime hands over what it finished.
const EATS = new Set(["take_rest", "travel", "pass_time", "downtime"]);

// Everything the turn's calls moved. A call the engine turned down moved
// nothing; one still waiting on its answer (a card in a player's hand) counts
// as made.
export function itemMoves(calls: readonly ItemCall[]): ItemMove[] {
  const moves: ItemMove[] = [];
  for (const call of calls) {
    if (call.result && "error" in call.result) {
      continue;
    }
    const who = text(call.args.characterId);
    const things = (way: "in" | "out", to = who) => {
      for (const item of namedItems(call.args)) {
        moves.push({ who: to, way, money: false, item });
      }
    };
    switch (call.name) {
      case "grant_item":
        things("in");
        break;
      case "remove_item":
      case "use_item":
        things("out");
        break;
      case "handle_item":
        if (call.args.action === "drop") {
          things("out");
        } else if (call.args.action === "pick_up") {
          things("in");
        } else if (call.args.action === "hand") {
          things("out");
          things("in", text(call.args.toCharacterId));
        }
        break;
      case "purchase": {
        const selling = call.args.action === "sell";
        things(selling ? "out" : "in");
        moves.push({ who, way: selling ? "in" : "out", money: true });
        break;
      }
      case "modify_gold": {
        const move = coinMove(call.args.delta, call.args.coins);
        if ("copper" in move && move.copper !== 0) {
          moves.push({ who, way: move.copper > 0 ? "in" : "out", money: true });
        }
        break;
      }
      case "party_award": {
        const ids = Array.isArray(call.args.characterIds) ? call.args.characterIds.map(text).filter(Boolean) : [];
        const gold = Number(call.args.gold) || 0;
        for (const id of gold ? ids : []) {
          moves.push({ who: id, way: gold > 0 ? "in" : "out", money: true });
        }
        if (text(call.args.item) && ids[0]) {
          moves.push({ who: ids[0], way: "in", money: false, item: text(call.args.item) });
        }
        break;
      }
      case "roll_treasure":
        moves.push({ who: "*", way: "in", money: true });
        break;
      default:
        if (EATS.has(call.name)) {
          moves.push({ who: "*", way: "out", money: false });
          moves.push({ who: "*", way: "in", money: false });
        }
    }
  }
  return moves;
}

// Whether a call's item is the carried line the claim names: the line's own
// name, or the name without its trailing note, which is how a tool sends it
// ("Rations" for "Rations (1 day)"). Whole names only (item-row.ts lineNamed).
function sameLine(line: string, sent: string): boolean {
  return lineNamed([{ name: line }], sent) >= 0 || lineNamed([{ name: sent }], line) >= 0;
}

// The claims no call of the turn recorded, each once. A thing that left a
// pack is recorded by a call that took that line from that character; money
// by a call that moved their coin the same way; a thing gained by a call that
// gave them something, the one of the same name first and any other after it
// (the narrator's "soot-stained ledger" is granted as a "Charred Ledger"),
// each call answering one gain.
export function unrecordedItems(claims: readonly ItemClaim[], calls: readonly ItemCall[]): ItemClaim[] {
  const moves = itemMoves(calls);
  const mine = (move: ItemMove, claim: ItemClaim) => move.who === "*" || move.who === claim.character;
  const spent = new Set<ItemMove>();
  const seen = new Set<string>();
  const open: ItemClaim[] = [];
  // Named gains take their calls first, so a nameless match never spends the
  // call another claim names.
  const gainOf = (claim: ItemClaim, named: boolean) =>
    moves.find((move) => !spent.has(move) && move.way === "in" && !move.money && mine(move, claim) && (move.item === undefined || !named || textKey(move.item) === textKey(claim.item)));
  const unique = claims.filter((claim) => {
    const key = `${claim.character}|${claim.change === "gains" ? "in" : "out"}|${textKey(claim.item)}`;
    return seen.has(key) ? false : Boolean(seen.add(key));
  });
  const gains = unique.filter((claim) => claim.change === "gains" && claim.copper === undefined);
  const recorded = new Set<ItemClaim>();
  for (const named of [true, false]) {
    for (const claim of gains.filter((entry) => !recorded.has(entry))) {
      const move = gainOf(claim, named);
      if (move) {
        recorded.add(claim);
        // A move of anything (downtime's finished work) answers every gain.
        if (move.item !== undefined) {
          spent.add(move);
        }
      }
    }
  }
  for (const claim of unique) {
    const way = claim.change === "gains" ? "in" : "out";
    if (claim.copper !== undefined) {
      if (!moves.some((move) => move.money && move.way === way && mine(move, claim))) {
        open.push(claim);
      }
    } else if (claim.change === "gains") {
      if (!recorded.has(claim)) {
        open.push(claim);
      }
    } else if (!moves.some((move) => move.way === "out" && !move.money && mine(move, claim) && (move.item === undefined || sameLine(claim.item, move.item)))) {
      open.push(claim);
    }
  }
  return open;
}

export type EngineItemCall = { name: "remove_item" | "use_item" | "handle_item" | "modify_gold"; args: Record<string, unknown> };

// Whether a player's words name the carried line: every word of its name
// (without its trailing note, by stem, so "one of my rations" names "Rations
// (1 day)" and "my healing potion" a "Potion of Healing") is among theirs.
export function wordsName(said: string, line: string, language: TableLanguage): boolean {
  const wanted = stems(baseName(line), language);
  const theirs = new Set(stems(said, language));
  return wanted.length > 0 && wanted.every((stem) => theirs.has(stem));
}

// The call that carries out a claim the engine may settle itself, or null
// when it is the narrator's. Only what a player's own words declared and the
// narration then showed: a thing they hand over or use, from the line their
// sheet holds, or coin they pay. Declared is the reader's reading of their
// words (`said`, which serves a table in any language) or the words
// themselves naming the line or counting out the amount. A thing
// passed to another party character is handed, never destroyed, and only when
// the reader read that character receiving it (the claim's `to`, or a gain of
// theirs read beside it); named with no such reading, or with a reading that
// names someone else, it is left to the narrator.
export function engineItemCall(
  claim: ItemClaim,
  input: {
    // What the character's own player wrote this exchange ("" for none).
    said: string;
    language: TableLanguage;
    // The rest of the party, and who the same reading has gaining this thing.
    others: ReadonlyArray<{ id: string; name: string }>;
    receiverId: string | null;
    // The purse, in copper.
    purse: number;
  },
): EngineItemCall | null {
  const said = input.said.trim();
  if (!said || claim.change === "gains") {
    return null;
  }
  if (claim.copper !== undefined) {
    // The coins their words count out: the reader read them paying it, or
    // every number of the amount is one they wrote; and the purse covers it.
    // Coin their words counted out is paid whether the reader filed it as
    // given or as lost: gpt-oss-20b read a fare the ferryman pocketed as a
    // loss in every reading (2026-11-24), and the digits are theirs.
    const numbers = claim.item.match(/\d+/g) ?? [];
    const written = new Set(words(said));
    const counted = numbers.length > 0 && numbers.every((number) => written.has(number));
    const paid = claim.change === "gives" ? claim.said || counted : claim.change === "loses" && counted;
    if (!paid || claim.copper > input.purse) {
      return null;
    }
    return { name: "modify_gold", args: { characterId: claim.character, coins: `-${claim.item.trim()}`, reason: "Paid in the story" } };
  }
  if (claim.change === "loses") {
    return null;
  }
  // Declared: the reader read their player saying so (in any language), or
  // their words name the line outright.
  if (!claim.carried || !(claim.said || wordsName(said, claim.item, input.language))) {
    return null;
  }
  const qty = claim.qty && claim.qty > 1 ? { qty: claim.qty } : {};
  if (claim.change === "uses") {
    return { name: "use_item", args: { characterId: claim.character, item: claim.item } };
  }
  const named = input.others.filter((other) => containsPhrase(said, other.name));
  const receiver = claim.to ?? input.receiverId;
  if (named.length || receiver) {
    // The one the reader read receiving it, and nobody else their words name.
    const to = input.others.find((other) => other.id === receiver);
    return to && named.every((other) => other.id === to.id)
      ? { name: "handle_item", args: { characterId: claim.character, action: "hand", item: claim.item, toCharacterId: to.id, ...qty, reason: "Handed over in the story" } }
      : null;
  }
  return { name: "remove_item", args: { characterId: claim.character, item: claim.item, ...qty, reason: "Given away in the story" } };
}

const VERB: Record<ItemClaim["change"], string> = { gains: "gains", gives: "hands over", uses: "uses up", loses: "loses" };

function claimLine(claim: ItemClaim): string {
  return `${claim.name} ${VERB[claim.change]} ${claim.qty && claim.qty > 1 ? `${claim.qty} ` : ""}${claim.item} ("${claim.quote.slice(0, 160)}")`;
}

// What sends the narrator back, once a turn, for the claims the engine does
// not settle itself. The reply that told them is withheld and told again from
// the tools' results, as a spell cast in prose is (slotless-cast-logic.ts);
// and as with a fight announced in prose (engine-boundary.ts
// fakeEncounterPrompt) the narrator may answer that nothing changed hands: it
// alone knows whether the ledger was taken or only held out.
export function unrecordedItemsPrompt(open: readonly ItemClaim[]): string {
  return `[System] Your narration moves things that no tool moved this turn, so the sheets the table reads still show them as they were:
${open
  .slice(0, 6)
  .map((claim) => `- ${claimLine(claim)}`)
  .join("\n")}
Make each one real with its tool now, then narrate the moment again from the results: grant_item for a thing gained (a gift, loot, something picked up and kept); remove_item for a thing given to someone outside the party, taken or destroyed; handle_item with action hand for a thing passed to a party member; use_item for something eaten, drunk or used up; purchase for a sale or a buy; modify_gold when only coins move. If nothing changed hands (it was only offered, shown or asked for), call no tool and give the same narration again.`;
}

// The notes a turn leaves the GM for what is still open when it ends, as
// GM-only facts (the channel a deed nobody recorded uses, deed-claims.ts):
// one a character. A note lasts one exchange.
export const ITEM_NOTE = "Unrecorded item";

export function itemNoteSubject(name: string): string {
  return `${ITEM_NOTE}: ${name}`;
}

const TOOL: Record<ItemClaim["change"], string> = {
  gains: "grant_item",
  gives: "remove_item (handle_item with action hand, for a party member)",
  uses: "use_item",
  loses: "remove_item",
};

export function itemNote(claims: readonly ItemClaim[]): string {
  const tools = [...new Set(claims.map((claim) => (claim.copper !== undefined ? "modify_gold" : TOOL[claim.change])))];
  return `Your last narration had ${claims.map(claimLine).join("; ")}, and no tool recorded it, so the sheet has not changed. If it happened, make it real now with ${tools.join(", ")}; if it did not (the thing was only offered or shown), leave it.`;
}

// How many characters one exchange may leave notes for: the facts block
// holds six lines a category, and the party's own facts share it.
export const ITEM_NOTES_PER_EXCHANGE = 2;
