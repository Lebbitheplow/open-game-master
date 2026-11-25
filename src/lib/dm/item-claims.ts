import { createHash } from "node:crypto";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { insertFact, listActiveFacts, setFactStatus } from "@/lib/db/facts";
import { getSheetById } from "@/lib/db/sheets";
import { readerSystem } from "@/lib/dm/claims-logic";
import { collectExchanges, type GuardMessage } from "@/lib/dm/engine-boundary";
import { gearKindOf } from "@/lib/dm/gear-hands";
import { requestUtilityMessage } from "@/lib/dm/model";
import { normalizeSubject } from "@/lib/dm/fact-logic";
import {
  ITEM_NOTE,
  ITEM_NOTES_PER_EXCHANGE,
  engineItemCall,
  itemNote,
  itemNoteSubject,
  unrecordedItems,
  wordsName,
  type EngineItemCall,
  type ItemCall,
} from "@/lib/dm/item-claims-logic";
import { checkItemMoves, itemRequest, type ItemClaim } from "@/lib/dm/item-read-logic";
import { exchangeWords, type ExchangeWords } from "@/lib/dm/story-moves";
import { mergedCallText } from "@/lib/dm/tool-merge-logic";
import { publishEphemeral } from "@/lib/events";
import { arcTextTimeoutMs } from "@/lib/model-client";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { SRD_SKILLS } from "@/lib/srd";
import { purseCopper } from "@/lib/srd/currency";
import { lineNamed } from "@/lib/srd/item-row";
import { stripReasoningArtifacts } from "@/lib/story-prompt";

// The database and model half of the item claims (issue 1097; the read's
// words are src/lib/dm/item-read-logic.ts and the rulings
// src/lib/dm/item-claims-logic.ts): the one utility
// call that reads an exchange for hand-offs, which claims stay open against
// the turn's calls and the sheets as they stand, and what the end of a turn
// does about them. Runs where the claims reader runs: the storyteller's turn
// (src/lib/dm/turn.ts) and a connected agent program's narration
// (src/lib/dm/agent-turn.ts), which gets the notes alone.
//
// A read that fails or answers something unreadable fails open, as the
// claims reader does (src/lib/dm/claims.ts): the passage counts as moving
// nothing, the turn is told as it would have been, and the failure is
// logged, naming the turn and never the text.

// A pack is listed line by line; past this many the rest go unlisted, and a
// thing from them is simply not read (a sheet holds sixty at most).
const LINES_LISTED = 40;

// What each party character carries, by the ref the reader copies: the lines
// a thing can leave. A summoned creature carries nothing of its own.
export function carriedRefs(sheets: readonly CharacterSheet[]): Map<string, { characterId: string; name: string; qty: number; by: string }> {
  const refs = new Map<string, { characterId: string; name: string; qty: number; by: string }>();
  for (const sheet of sheets.filter((entry) => !entry.summon)) {
    for (const line of sheet.equipment.slice(0, LINES_LISTED)) {
      refs.set(`i${refs.size + 1}`, { characterId: sheet.id, name: line.name, qty: line.qty, by: sheet.name });
    }
  }
  return refs;
}

// Whether an exchange is read at all: the table's outcome check on and a
// pack or a purse to move. In a fight the prose names weapons in every line
// and a turn has four calls to spend, so it is read only when a player's own
// words name something they carry that is no weapon, armor or shield (a
// potion drunk, a rope thrown to a friend). The same holds at a table a
// connected agent program narrates: with no helper model set, a read goes
// through the program and starts one (party-split.ts readParting keeps off it
// for the same reason), so it is made only on a player's own word.
export function itemsReadable(campaign: Campaign, sheets: readonly CharacterSheet[], words: readonly ExchangeWords[]): boolean {
  const party = sheets.filter((sheet) => !sheet.summon);
  if (!campaign.gameSettings.narrationGuard || !party.length) {
    return false;
  }
  if (!getActiveEncounter(campaign.id) && campaign.settings.textProvider !== "harness") {
    return true;
  }
  const language = campaign.gameSettings.tableLanguage;
  return words.some((entry) => {
    const sheet = party.find((member) => member.id === entry.characterId);
    return Boolean(sheet?.equipment.some((line) => gearKindOf(line) === "carried" && wordsName(entry.text, line.name, language)));
  });
}

// The system prompt the read rides: the claims reader's own, as a read that
// asks no speaker and no bond sends it (see the head of item-read-logic.ts).
const SKILL_IDS = SRD_SKILLS.map((skill) => skill.id);

// Readings kept for a few minutes, a bounded handful: a retried or resumed
// turn reads its kept narration again, and the same request is the same
// answer (src/lib/dm/claims.ts keeps its own the same way).
const READING_TTL_MS = 10 * 60_000;
const READINGS_KEPT = 64;

declare global {
  var __odmItemReadings: Map<string, { at: number; reply: string }> | undefined;
}

function readings() {
  return (globalThis.__odmItemReadings ??= new Map());
}

// One read of a passage of narration for the things and money it moves,
// beside what the players wrote this exchange. The claims that may act, or
// none when nothing could be read.
export async function readItemMoves(
  campaign: Campaign,
  input: {
    // Who is reading, for the log line: a turn id, never text.
    label: string;
    text: string;
    sheets: readonly CharacterSheet[];
    words: readonly ExchangeWords[];
  },
): Promise<ItemClaim[]> {
  if (!input.text.trim()) {
    return [];
  }
  // The packs as they stand: a call of this turn may have changed them.
  const sheets = input.sheets.map((sheet) => getSheetById(sheet.id) ?? sheet);
  const carried = carriedRefs(sheets);
  const party = sheets.filter((sheet) => !sheet.summon).map((sheet) => ({ ref: sheet.id, name: sheet.name }));
  const messages = [
    { role: "system" as const, content: readerSystem(SKILL_IDS, false) },
    {
      role: "user" as const,
      content: itemRequest(
        { party, carried: [...carried].map(([ref, line]) => ({ ref, name: line.name, qty: line.qty, by: line.by })) },
        input.words.map((entry) => `${entry.name}: ${entry.text}`).join("\n"),
        input.text,
      ),
    },
  ];
  // The model that read it is part of the request: another backend reads anew.
  const route = campaign.settings;
  const key = createHash("sha1")
    .update(JSON.stringify([campaign.id, route.textProvider, route.customBaseUrl, route.customModel, route.localTextModel, route.utilityProvider, route.utilityBaseUrl, route.utilityModel, messages]))
    .digest("hex");
  const known = readings().get(key);
  let reply = known && Date.now() - known.at < READING_TTL_MS ? known.reply : null;
  if (reply === null) {
    const { message, error } = await requestUtilityMessage(campaign.settings, messages, {
      meta: { task: "item_moves" },
      timeoutMs: arcTextTimeoutMs(),
      thinking: false,
      temperature: 0,
    });
    if (error) {
      console.error(`[items] ${input.label}: the reader call failed; the passage counts as moving nothing`);
      return [];
    }
    reply = String(message?.content ?? "");
  }
  const claims = checkItemMoves(stripReasoningArtifacts(reply), {
    text: input.text,
    party: new Map(party.map((member) => [member.ref, member.name])),
    carried,
    language: campaign.gameSettings.tableLanguage,
  });
  if (!claims) {
    console.error(`[items] ${input.label}: the reader's reply was unreadable; the passage counts as moving nothing`);
    return [];
  }
  // Only a reading that parsed is kept: an unreadable one is worth asking again.
  const kept = readings();
  kept.set(key, { at: Date.now(), reply });
  if (kept.size > READINGS_KEPT) {
    kept.delete(kept.keys().next().value as string);
  }
  if (process.env.DM_DEBUG) {
    console.log(`[dm-debug] items ${input.label}: ${JSON.stringify(claims)}`);
  }
  return claims;
}

// The turn's calls as the rulings read them: under the names the engine
// reads now, so a call sent by a retired name still counts.
function callsOf(conversation: readonly GuardMessage[]): ItemCall[] {
  return collectExchanges(conversation)
    .filter((exchange) => exchange.name)
    .map((exchange) => {
      const merged = mergedCallText(exchange.name, exchange.arguments || "{}");
      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(merged.rawArguments || "{}");
        args = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
      } catch {
        // Arguments that never parsed ran nothing.
      }
      return { name: merged.name, args, result: exchange.result };
    });
}

export type OpenItems = {
  // What the engine carries out itself, with the call that does it.
  settled: Array<{ claim: ItemClaim; call: EngineItemCall }>;
  // What is the narrator's to settle.
  owed: ItemClaim[];
};

// The item claims no call recorded, split by who settles them, against the
// sheets as they stand now (a thing a call of this very turn already took is
// no longer carried, and is no claim).
export function openItems(
  campaign: Campaign,
  input: {
    turn: Pick<DmTurn, "conversation" | "createdAt"> | null;
    sheets: readonly CharacterSheet[];
    claims: readonly ItemClaim[];
    // The calls of a reply being read, which have not answered yet.
    pending?: readonly ItemCall[];
  },
): OpenItems {
  const open: OpenItems = { settled: [], owed: [] };
  if (!input.claims.length) {
    return open;
  }
  const unrecorded = unrecordedItems(input.claims, [...callsOf(input.turn?.conversation ?? []), ...(input.pending ?? [])]);
  if (!unrecorded.length) {
    return open;
  }
  const said = new Map(exchangeWords(campaign.id, input.sheets, input.turn?.createdAt).map((entry) => [entry.characterId, entry.text]));
  for (const claim of unrecorded) {
    const sheet = getSheetById(claim.character);
    if (!sheet) {
      continue;
    }
    // Gone from the pack since it was read: whatever took it recorded it.
    if (claim.carried && lineNamed(sheet.equipment, claim.item) < 0) {
      continue;
    }
    // A purse with nothing in it pays nothing.
    if (claim.copper !== undefined && claim.change !== "gains" && purseCopper(sheet) <= 0) {
      continue;
    }
    const receiver = input.claims.find((other) => other.change === "gains" && other.character !== claim.character && other.copper === undefined && lineNamed([{ name: claim.item }], other.item) >= 0);
    const call = engineItemCall(claim, {
      said: said.get(claim.character) ?? "",
      language: campaign.gameSettings.tableLanguage,
      others: input.sheets.filter((other) => other.id !== claim.character && !other.summon).map((other) => ({ id: other.id, name: other.name })),
      receiverId: receiver?.character ?? null,
      purse: purseCopper(sheet),
    });
    if (call) {
      open.settled.push({ claim, call });
    } else {
      open.owed.push(claim);
    }
  }
  // A thing the engine hands to a party character is their gain too.
  const handed = new Set(open.settled.flatMap(({ call }) => (call.name === "handle_item" ? [`${String(call.args.toCharacterId)}|${String(call.args.item)}`] : [])));
  open.owed = open.owed.filter((claim) => !(claim.change === "gains" && [...handed].some((key) => key.startsWith(`${claim.character}|`) && lineNamed([{ name: key.slice(claim.character.length + 1) }], claim.item) >= 0)));
  return open;
}

// By the subject's first words, as the facts table keeps it (normalized).
function isItemNote(subject: string): boolean {
  return subject.startsWith(`${normalizeSubject(ITEM_NOTE)} `);
}

// A note lasts the one exchange it was written for.
function expireItemNotes(campaignId: string): boolean {
  let changed = false;
  for (const fact of listActiveFacts(campaignId).filter((entry) => isItemNote(entry.subject))) {
    setFactStatus(fact.id, "retired");
    changed = true;
  }
  return changed;
}

// The end of an exchange: last exchange's notes expire; each claim the engine
// may settle is carried out through `run`, the turn's own rails (a model's
// call would take the same road, and it joins the turn's conversation, so a
// turn read again finds it recorded); and what is left, with whatever the
// rules refused, is a note the GM reads next turn. Without `run` (an agent
// program's narration, which the engine does not own) everything open is a
// note.
export async function settleItemClaims(
  campaign: Campaign,
  input: {
    turn: DmTurn | null;
    sheets: readonly CharacterSheet[];
    claims: readonly ItemClaim[];
    run?: (call: EngineItemCall) => Promise<Record<string, unknown>>;
  },
): Promise<{ applied: number; noted: number }> {
  let changed = expireItemNotes(campaign.id);
  const open = openItems(campaign, input);
  const left = [...open.owed];
  let applied = 0;
  for (const { claim, call } of open.settled) {
    const result = input.run ? await input.run(call) : null;
    if (result && typeof result.error !== "string") {
      applied += 1;
    } else {
      left.push(claim);
    }
  }
  const byCharacter = new Map<string, ItemClaim[]>();
  for (const claim of left) {
    const known = byCharacter.get(claim.character);
    if (known) {
      known.push(claim);
    } else if (byCharacter.size < ITEM_NOTES_PER_EXCHANGE) {
      byCharacter.set(claim.character, [claim]);
    }
  }
  for (const claims of byCharacter.values()) {
    insertFact({ campaignId: campaign.id, category: "party", subject: itemNoteSubject(claims[0].name), fact: itemNote(claims), knownBy: "dm", source: "manual" });
    changed = true;
  }
  if (changed) {
    publishEphemeral(campaign.id, "facts_updated", {});
  }
  if (applied || byCharacter.size) {
    console.warn(`[items] turn ${input.turn?.id ?? "(none)"}: the server carried out ${applied} hand-off(s) the story showed and left ${byCharacter.size} note(s) for the GM`);
  }
  return { applied, noted: byCharacter.size };
}
