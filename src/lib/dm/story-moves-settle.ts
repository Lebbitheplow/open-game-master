import type { Campaign } from "@/lib/db/campaigns";
import { saveDmTurn, type DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { insertFact } from "@/lib/db/facts";
import { getRelationship } from "@/lib/db/relationships";
import { listPendingAdvances } from "@/lib/db/advances";
import type { NarrationClaim } from "@/lib/dm/claims-logic";
import { collectExchanges, type GuardMessage } from "@/lib/dm/engine-boundary";
import { handleRelationshipBeat } from "@/lib/dm/relationship-tools";
import { resolveActor, resolveSubject, type Subject } from "@/lib/dm/relationship-subject";
import { mergedCallText } from "@/lib/dm/tool-merge-logic";
import { publishEphemeral } from "@/lib/events";
import { containsPhrase, textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { exchangeWords, expireMoveNotes, holdFightStep, romanceReadable, type ExchangeWords } from "@/lib/dm/story-moves";
import {
  MOVE_NOTES_PER_EXCHANGE,
  moveNoteSubject,
  pairKey,
  pairOf,
  recordedNote,
  settlePair,
  type BondClaim,
  type PairClaim,
  type PairRecord,
} from "@/lib/dm/story-moves-logic";

// What the engine does at the end of an exchange with the bonds the claims
// reader found (issue 641): each pair the GM recorded nothing for is settled
// by src/lib/dm/story-moves-logic.ts settlePair, a beat the engine records
// goes through relationship_beat as a model's call would, and the rest is a
// note the GM reads next turn.

// What the exchange's own calls recorded for one pair, read from the turn's
// conversation as the guard reads it.
function pairRecord(
  conversation: readonly GuardMessage[],
  sheet: CharacterSheet,
  subject: Subject,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  pendingMove: boolean,
): PairRecord {
  const record: PairRecord = { recorded: false, step: null, npcMove: pendingMove };
  const isSubject = (name: unknown) => typeof name === "string" && textKey(name) === textKey(subject.name);
  for (const exchange of collectExchanges(conversation)) {
    if (!exchange.result || !["relationship_beat", "romance_advance", "relationship_end", "relationship_scheme"].includes(exchange.name)) {
      continue;
    }
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(mergedCallText(exchange.name, exchange.arguments || "{}").rawArguments || "{}") as Record<string, unknown>;
    } catch {
      continue;
    }
    const actor = typeof args.characterId === "string" ? resolveActor({ characterId: args.characterId }, sheets, sheetsById) : null;
    const named = isSubject(args.subject) || [args.witnesses, args.victims].some((list) => Array.isArray(list) && list.some(isSubject));
    if (actor?.id !== sheet.id || !named) {
      continue;
    }
    const result = exchange.result;
    // An argument the handler could not read recorded nothing.
    if (result.ok !== true && !result.refused) {
      continue;
    }
    record.recorded = true;
    if (exchange.name !== "romance_advance" || !isSubject(args.subject)) {
      continue;
    }
    if (args.initiator === "npc") {
      record.npcMove = true;
    } else if (result.ok === true && result.accepted === true && typeof result.romance === "string") {
      record.step = { accepted: true, to: result.romance as Extract<PairRecord["step"], { accepted: true }>["to"] };
    } else {
      record.step = { accepted: false, why: result.ok === true ? `${subject.name} said no` : String(result.error ?? "the rules refused it").slice(0, 160) };
    }
  }
  return record;
}

// The character's own player declared the move: their words hold its quote,
// or name the other person in it.
function declared(claim: BondClaim, sheet: CharacterSheet, subject: Subject, words: readonly ExchangeWords[]): boolean {
  if (claim.said === sheet.id) {
    return true;
  }
  const theirs = words.find((entry) => entry.characterId === sheet.id)?.text ?? "";
  return [subject.name, ...(subject.npc?.aliases ?? [])].some((name) => name.trim() !== "" && containsPhrase(theirs, name));
}

// The end of an exchange: last exchange's notes expire, and each pair this
// exchange's bonds name that the GM recorded nothing for is settled
// (story-moves-logic.ts settlePair). A beat the engine records goes through
// relationship_beat as a model's call would, and joins the turn's
// conversation; record is false where the engine does not own the turn.
export function settleStoryMoves(
  campaign: Campaign,
  input: { turn: DmTurn | null; sheets: readonly CharacterSheet[]; claims: readonly NarrationClaim[]; record: boolean },
): { recorded: number; noted: number } {
  const fight = Boolean(getActiveEncounter(campaign.id));
  let changed = expireMoveNotes(campaign.id, fight);
  const { turn } = input;
  const sheets = [...input.sheets];
  const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  // A kindness told in the same words as a deed is the deed's, which the
  // deed note asks the GM to record with its witnesses (deed-claims.ts).
  const deedQuotes = input.claims.flatMap((claim) => (claim.kind === "deed" ? [textKey(claim.quote)] : []));
  const groups = new Map<string, { pair: NonNullable<ReturnType<typeof pairOf>>; claims: BondClaim[] }>();
  for (const claim of input.claims) {
    const pair = claim.kind === "bond" && campaign.gameSettings.relationships !== "off" ? pairOf(claim) : null;
    if (!pair || (claim.kind === "bond" && (claim.move === "help" || claim.move === "defend") && deedQuotes.some((quote) => quote.includes(textKey(claim.quote)) || textKey(claim.quote).includes(quote)))) {
      continue;
    }
    const key = pairKey(pair.characterId, pair.subject);
    const group = groups.get(key) ?? { pair, claims: [] };
    group.claims.push(claim as BondClaim);
    groups.set(key, group);
  }
  const words = groups.size ? exchangeWords(campaign.id, sheets, turn?.createdAt) : [];
  const pending = groups.size ? listPendingAdvances(campaign.id) : [];
  const options = { fight, romance: romanceReadable(campaign), record: input.record && turn !== null };
  const notes: Array<{ character: string; subject: string; text: string; afterFight: boolean }> = [];
  let recorded = 0;
  for (const { pair, claims } of groups.values()) {
    const sheet = sheetsById.get(pair.characterId);
    const subject = sheet && !sheet.isCompanion ? resolveSubject(campaign, pair.subject, sheets) : null;
    if (!sheet || !subject || "error" in subject) {
      continue;
    }
    const row = getRelationship(campaign.id, sheet.id, subject.name);
    const waitingMove = pending.some((offer) => offer.characterId === sheet.id && textKey(offer.args.subject) === textKey(subject.name));
    const record = pairRecord(turn?.conversation ?? [], sheet, subject, sheets, sheetsById, waitingMove);
    const onPair: PairClaim[] = claims.map((claim) => ({
      move: claim.move,
      byCharacter: pairOf(claim)?.byCharacter ?? true,
      quote: claim.quote,
      declared: declared(claim, sheet, subject, words),
    }));
    const settled = settlePair(
      { characterId: sheet.id, character: sheet.name, subject: subject.name },
      onPair,
      record,
      { romance: row?.romance ?? "none", status: row?.status ?? "active", openToAdvances: Boolean(sheet.openToAdvances) },
      options,
    );
    for (const step of settled) {
      if (step.kind === "note") {
        notes.push({ character: sheet.name, subject: subject.name, text: step.text, afterFight: step.afterFight });
      } else if (step.kind === "hold") {
        if (!holdFightStep(campaign, { characterId: sheet.id, subject: subject.name, to: step.to, quote: step.quote })) {
          notes.push({ character: sheet.name, subject: subject.name, text: step.note, afterFight: true });
        }
      } else if (turn) {
        const result = recordFromStory(campaign, turn, sheets, sheetsById, { characterId: sheet.id, subject: subject.name, beat: step.beat, note: step.quote.slice(0, 160) });
        if (result) {
          recorded += 1;
          notes.push({ character: sheet.name, subject: subject.name, text: recordedNote(result), afterFight: false });
        }
      }
    }
  }
  // One fact a pair, the first pairs the exchange named.
  const byPair = new Map<string, { character: string; subject: string; texts: string[]; afterFight: boolean }>();
  for (const entry of notes) {
    const key = `${entry.afterFight}|${pairKey(entry.character, entry.subject)}`;
    const known = byPair.get(key);
    if (known) {
      known.texts.push(entry.text);
    } else if (byPair.size < MOVE_NOTES_PER_EXCHANGE) {
      byPair.set(key, { ...entry, texts: [entry.text] });
    }
  }
  for (const entry of byPair.values()) {
    insertFact({ campaignId: campaign.id, category: "party", subject: moveNoteSubject(entry, entry.afterFight), fact: entry.texts.join(" "), knownBy: "dm", source: "manual" });
    changed = true;
  }
  if (changed) {
    publishEphemeral(campaign.id, "facts_updated", {});
  }
  if (recorded || byPair.size) {
    console.warn(`[story-moves] turn ${turn?.id ?? "(none)"}: the server recorded ${recorded} beat(s) the story showed and left ${byPair.size} note(s) for the GM`);
  }
  return { recorded, noted: byPair.size };
}

// One beat recorded from the story, through relationship_beat with every
// rule it keeps (the roll a flirt makes, repeats counting for less, a
// finished bond refused), as a model's call would be and beside them in the
// turn's conversation. The result when it landed; null when the rules
// refused it, which leaves nothing to say.
function recordFromStory(
  campaign: Campaign,
  turn: DmTurn,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  args: { characterId: string; subject: string; beat: string; note: string },
): Record<string, unknown> | null {
  const id = `story_${turn.conversation.length}`;
  const rawArguments = JSON.stringify(args);
  turn.conversation.push({ role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name: "relationship_beat", arguments: rawArguments } }] });
  const result = handleRelationshipBeat(campaign, turn, rawArguments, sheets, sheetsById) as Record<string, unknown>;
  turn.conversation.push({ role: "tool", tool_call_id: id, content: JSON.stringify(result) });
  saveDmTurn(turn);
  return result.ok === true ? result : null;
}
