import type { Campaign } from "@/lib/db/campaigns";
import { requestUtilityMessage } from "@/lib/dm/model";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { stripReasoningArtifacts } from "@/lib/story-prompt";
import { getClock } from "@/lib/db/clock";
import { getDmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getCurrentLocation } from "@/lib/db/locations";
import { insertCampaignMessage, listRecentMessages, type CampaignMessage } from "@/lib/db/messages";
import { getParty, updateParty } from "@/lib/db/party";
import { listSheets } from "@/lib/db/sheets";
import { departureNote, departureOpenings } from "@/lib/dm/departure";
import { currentTurnId } from "@/lib/dm/job-control";
import { tableNoteSeq } from "@/lib/dm/narration-slot";
import { fightingParty } from "@/lib/dm/party-budget";
import {
  awayIdsOf,
  cutDue,
  inScene,
  moveGroups,
  moveNote,
  parseParting,
  partingBlock,
  partingReading,
  restCredit,
  sceneLines,
  sceneRefusal,
  settleAway,
  splitStateBlock,
  tableLine,
  unanswered,
  type MoveOutcome,
  type PartyGroup,
} from "@/lib/dm/party-split-logic";
import type { PartyState } from "@/lib/dm/party-logic";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The party split up, kept on the party record (issue 951; the rules are in
// party-split-logic.ts). Until it was kept, a split was one sentence in
// move_party's result (issue 563): the next turn knew nothing of it, and the
// GM answered a table in two places with one passage for both.
//
// The scene's place is the campaign's current location, as it always was.
// What is added is who is not there: `party.away`, written by move_party and
// read by everything that used to mean "the whole party" when it meant
// "everyone here".

const samePlaceName = (one: string, other: string) => Boolean(one) && textKey(one) === textKey(other);

// A place for those left behind before the party ever had one on record: a
// person's "Who goes" on a table's first move. Needed because the scene cuts
// back to them by the place's name.
const UNNAMED_PLACE = "The Starting Point";

// The party in play, as a split counts it: its fielded, living characters
// and the companions with them (party-budget.ts). A summoned creature goes
// with whoever called it.
function members(campaign: Campaign, sheets?: CharacterSheet[]): CharacterSheet[] {
  return fightingParty(campaign, sheets).filter((sheet) => !sheet.summon);
}

function publishParty(campaignId: string, party: PartyState) {
  publishPersisted(campaignId, "party_updated", { party });
}

// The groups away as they stand now: someone who died, was benched or left
// the table holds no place in one, and a split nobody is left in is over.
// Saved when that changed anything.
export function settledAway(campaign: Campaign, sheets?: CharacterSheet[]): PartyGroup[] {
  const party = getParty(campaign.id);
  if (!party.away.length) {
    return party.away;
  }
  const away = settleAway(party.away, members(campaign, sheets).map((sheet) => sheet.id));
  if (JSON.stringify(away) !== JSON.stringify(party.away)) {
    publishParty(campaign.id, updateParty(campaign.id, (current) => ({ ...current, away })));
  }
  return away;
}

// The sheets in the scene: all of them while the party is together.
export function sceneSheets(campaignId: string, sheets: CharacterSheet[]): CharacterSheet[] {
  return inScene(getParty(campaignId).away, sheets);
}

// Who is elsewhere, by id, with the place: for GAME STATE's party lines and
// for what a call may reach.
export function elsewhereBySheet(campaignId: string, sheets: readonly CharacterSheet[]): Map<string, string> {
  const away = getParty(campaignId).away;
  const gone = awayIdsOf(away, sheets);
  return new Map(
    sheets.flatMap((sheet) => {
      if (!gone.has(sheet.id)) {
        return [];
      }
      const group = away.find((entry) => entry.ids.includes(sheet.id) || entry.ids.includes(sheet.summon?.casterId ?? ""));
      return [[sheet.id, group?.place ?? ""] as const];
    }),
  );
}

// The newest line of the transcript the scene has answered, for those a move
// leaves behind (party-split-logic.ts MoveInput): the GM's last reply, and,
// for the AI's own cut mid-turn, every line its prompt read, which are the
// ones made before the turn's row was.
function heardSeqs(campaignId: string, byPerson: boolean): { heard: number; heardHere: number } {
  const recent = listRecentMessages(campaignId, 60);
  const heard = [...recent].reverse().find((message) => message.authorType === "dm")?.seq ?? 0;
  const turnId = byPerson ? null : currentTurnId();
  const turn = turnId ? getDmTurn(turnId) : null;
  return { heard, heardHere: turn ? (recent.filter((message) => message.createdAt <= turn.createdAt).at(-1)?.seq ?? heard) : heard };
}

export type PartyMove = { outcome: MoveOutcome; to: string; from: string; byPerson: boolean };

// Where the scene's own walked here from, while that walk is still the
// latest thing told: at most one reply has followed it.
function cameFrom(campaignId: string): string {
  const came = getParty(campaignId).came;
  if (!came) {
    return "";
  }
  const since = listRecentMessages(campaignId, 60).filter((message) => message.authorType === "dm" && message.seq > came.at).length;
  return since <= 1 ? came.from : "";
}

// The scene's own walked from one place to another: kept, so the move that
// follows may say who made the walk (moveGroups `back`).
export function noteWalk(campaignId: string, from: string) {
  const at = listRecentMessages(campaignId, 1).at(-1)?.seq ?? 0;
  updateParty(campaignId, (current) => ({ ...current, came: { from, at } }));
}

type PartingReader = (messages: { role: "system" | "user"; content: string }[]) => Promise<string | null>;

// The players' words read once as the turn opens: do they part the party
// (party-split-logic.ts partingReading)? What is found is kept on the party
// record for this turn. Asked only where it can matter and is cheap: the
// table's outcome check on, the built-in storyteller (a connected agent
// program names who goes itself, and a read through it would start a
// program), no fight, two or more of the party in the scene, and a move in
// the lines this turn answers that is not only speech. A read that fails
// finds nothing, so it never stops play.
export async function readParting(
  campaign: Campaign,
  history: readonly CampaignMessage[],
  read: PartingReader = async (messages) => {
    const { message, error } = await requestUtilityMessage(campaign.settings, messages, {
      meta: { task: "party_split" },
      timeoutMs: arcTextTimeoutMs(),
      thinking: false,
      temperature: 0,
    });
    return error ? null : stripReasoningArtifacts(String(message?.content ?? ""));
  },
): Promise<void> {
  const before = getParty(campaign.id);
  const clear = () => {
    if (before.parting) {
      updateParty(campaign.id, (current) => ({ ...current, parting: null }));
    }
  };
  const lines = unanswered(history);
  if (
    !campaign.gameSettings.narrationGuard ||
    campaign.settings.textProvider === "harness" ||
    !lines.some((line) => !line.content.startsWith('"')) ||
    getActiveEncounter(campaign.id)
  ) {
    return clear();
  }
  const sheets = listSheets(campaign.id);
  const present = inScene(before.away, members(campaign, sheets));
  if (present.length < 2) {
    return clear();
  }
  const place = getCurrentLocation(campaign.id)?.name ?? "";
  const words = lines.map((line) => `[${sheets.find((sheet) => sheet.id === line.characterId)?.name ?? "Unknown"}] ${line.content.slice(0, 600)}`);
  const reply = await read(partingReading({ party: present.map((sheet) => sheet.name), place, words }));
  const found = reply === null ? null : parseParting(reply, present, lines.map((line) => line.content).join("\n"), place);
  if (!found) {
    return clear();
  }
  updateParty(campaign.id, (current) => ({ ...current, parting: { ...found, at: lines.at(-1)?.seq ?? 0 } }));
}

// What the read found for the turn that is running, while it still holds:
// those it names are in the scene with someone to go, and nothing has moved
// them since.
function partingNow(campaign: Campaign, sheets?: CharacterSheet[]): { stays: CharacterSheet[]; goes: CharacterSheet[]; to: string } | null {
  const party = getParty(campaign.id);
  if (!party.parting) {
    return null;
  }
  const present = inScene(party.away, members(campaign, sheets));
  const stays = present.filter((sheet) => party.parting?.ids.includes(sheet.id));
  const goes = present.filter((sheet) => !party.parting?.ids.includes(sheet.id));
  return stays.length && goes.length && stays.length === party.parting.ids.length ? { stays, goes, to: party.parting.to } : null;
}

// The read is spent: applied by a move, or the turn it was read for is over.
export function clearParting(campaignId: string) {
  if (getParty(campaignId).parting) {
    updateParty(campaignId, (current) => ({ ...current, parting: null }));
  }
}

// The turn ended with the parting its players asked for still unrecorded,
// and their words named where the others went: the move the server makes for
// it, or null. With no place named there is nowhere to put the scene, so the
// party stays as the record has it.
export function partingOwed(campaign: Campaign): { name: string; characterIds: string[] } | null {
  const now = partingNow(campaign);
  return now?.to && !getActiveEncounter(campaign.id) ? { name: now.to, characterIds: now.goes.map((sheet) => sheet.id) } : null;
}

// One move_party read against who is where, before the place changes. Null
// when the whole party is together and stays so: nothing to keep.
export function planPartyMove(campaign: Campaign, refs: unknown, to: string, from: string, byPerson: boolean): PartyMove | null {
  const party = members(campaign);
  const away = getParty(campaign.id).away;
  const wanted = Array.isArray(refs) ? refs.filter((ref): ref is string => typeof ref === "string").map((ref) => ref.trim()) : [];
  const said = party.filter((sheet) => wanted.some((ref) => ref === sheet.id || textKey(ref) === textKey(sheet.name))).map((sheet) => sheet.id);
  // The AI's move of "everyone", in a turn whose players parted the party
  // (readParting): a move of those who go.
  const parting = byPerson || said.length || samePlaceName(to, from) ? null : partingNow(campaign);
  const named = parting ? parting.goes.map((sheet) => sheet.id) : said;
  if (!away.length && !named.length) {
    return null;
  }
  const stayAt = from || UNNAMED_PLACE;
  const outcome = moveGroups({
    away,
    members: party.map((sheet) => sheet.id),
    from: stayAt,
    to,
    named,
    ...heardSeqs(campaign.id, byPerson),
    now: getClock(campaign.id).instant,
    back: cameFrom(campaign.id),
  });
  return outcome.wasSplit || outcome.split ? { outcome, to, from: outcome.stayedAt, byPerson } : null;
}

// Who travels with the party on this move (src/lib/db/locations.ts): everyone
// who does when it moves whole, and otherwise only those at a place the move
// leaves nobody of the party at. A scout going ahead takes nobody; a cut to
// the others takes nobody either, since nobody walked.
export function followersOf(move: PartyMove | null): true | string[] {
  return move ? move.outcome.emptied : true;
}

// The moves of those the scene has just taken in, made while it was elsewhere.
function waitingLines(campaignId: string, arrived: Record<string, number>, roster: readonly CharacterSheet[]): string[] {
  return listRecentMessages(campaignId, 60)
    .filter((message) => {
      const since = message.characterId ? arrived[message.characterId] : undefined;
      return since !== undefined && message.authorType === "player" && !message.content.startsWith("(ooc)") && message.seq > since;
    })
    .slice(-6)
    .map((message) => `[${roster.find((sheet) => sheet.id === message.characterId)?.name ?? "Unknown"}] ${message.content.slice(0, 300)}`);
}

// The move, kept: who is away now, the table's line about it, and what the
// storyteller is told. After the place has changed, so the line reads below
// anything the move itself said.
export function settlePartyMove(campaign: Campaign, move: PartyMove): string {
  const { outcome, to, from } = move;
  const roster = listSheets(campaign.id);
  const gone = new Set(outcome.away.flatMap((group) => group.ids));
  const here = members(campaign, roster).map((sheet) => sheet.id).filter((id) => !gone.has(id));
  const came = Object.keys(outcome.arrived).length > 0;
  const line = tableLine(outcome, to, from, here, roster);
  let at = 0;
  if (line) {
    at = tableNoteSeq(campaign.id);
    const message = insertCampaignMessage({ campaignId: campaign.id, seq: at, authorType: "system", glyph: "system-party", content: line });
    publishWithSeq(campaign.id, at, "message_added", { message });
  }
  // The AI's own cut, mid-turn, is handed the moves that waited there in the
  // call's result, so the reply it is writing answers them: nothing is left
  // for the next one. A cut made between turns leaves them to the turn that
  // follows it (party-split-logic.ts sceneLines).
  const handed = !move.byPerson && Boolean(currentTurnId());
  const waiting = came && handed ? waitingLines(campaign.id, outcome.arrived, roster) : [];
  const clock = getClock(campaign.id).instant;
  const party = updateParty(campaign.id, (current) => ({
    ...current,
    // Whatever the players' words asked of this turn is recorded now.
    parting: null,
    away: outcome.away,
    cut: came && at ? { at, from: handed ? {} : outcome.arrived, behind: outcome.behind, clock } : current.cut,
  }));
  publishParty(campaign.id, party);
  // Some of the party went and the rest stayed (issue 563): a moment a
  // companion holding a plan to slip away takes. Not a cut: nobody parted.
  const slipped = outcome.stayed.length && !came ? departureOpenings(campaign, "split").map(departureNote).filter(Boolean) : [];
  return [moveNote(outcome, to, here, roster, waiting), ...slipped].filter(Boolean).join(" ");
}

// Someone away has come to the scene with no move_party saying so: their
// initiative roll brought them into a fight (fight-away.ts).
export function joinScene(campaign: Campaign, ids: readonly string[]) {
  const party = getParty(campaign.id);
  if (!party.away.some((group) => group.ids.some((id) => ids.includes(id)))) {
    return;
  }
  const away = party.away.map((group) => ({ ...group, ids: group.ids.filter((id) => !ids.includes(id)) })).filter((group) => group.ids.length);
  publishParty(campaign.id, updateParty(campaign.id, (current) => ({ ...current, away })));
}

// The transcript as the turn at this scene reads it.
export function sceneHistory(campaign: Campaign, history: CampaignMessage[]): CampaignMessage[] {
  const party = getParty(campaign.id);
  return party.away.length || party.cut ? sceneLines(history, party.away, party.cut).lines : history;
}

// The group the scene cuts to before the next reply, or null.
export function sceneCutDue(campaign: Campaign, history: readonly CampaignMessage[]): PartyGroup | null {
  if (!getParty(campaign.id).away.length) {
    return null;
  }
  const sheets = listSheets(campaign.id);
  const away = settledAway(campaign, sheets);
  const gone = new Set(away.flatMap((group) => group.ids));
  return cutDue(history, away, getParty(campaign.id).cut, {
    fight: Boolean(getActiveEncounter(campaign.id)),
    present: members(campaign, sheets).filter((sheet) => !gone.has(sheet.id)).length,
  });
}

// GAME STATE's lines about the split, "" while the party is together and
// stays so this turn.
export function splitBlockFor(campaign: Campaign, sheets: readonly CharacterSheet[], place: string, history: readonly CampaignMessage[]): string {
  const party = getParty(campaign.id);
  const now = partingNow(campaign, [...sheets]);
  const parts = now ? partingBlock({ ids: now.stays.map((sheet) => sheet.id), to: now.to, at: 0 }, [...now.stays, ...now.goes]) : "";
  if (!party.away.length) {
    return parts;
  }
  const gone = new Set(party.away.flatMap((group) => group.ids));
  const here = members(campaign, [...sheets]).map((sheet) => sheet.id).filter((id) => !gone.has(id));
  // Said on the reply that follows the cut, not on every one after it.
  const fresh = party.cut && !history.some((message) => message.authorType === "dm" && message.seq > (party.cut?.at ?? 0));
  return [splitStateBlock({ here, place, away: party.away, roster: sheets, behind: fresh ? restCredit(party.cut, getClock(campaign.id).instant) : 0 }), parts].filter(Boolean).join(" ");
}

// A call that names someone who is not in the scene. A fight's own absentees
// are the fight's to refuse (fight-away-logic.ts): their initiative roll is
// how they arrive, and that call names them.
export function sceneCallRefusal(campaign: Campaign, name: string, args: Record<string, unknown>, sheetsById: ReadonlyMap<string, CharacterSheet>): string | null {
  const away = getParty(campaign.id).away;
  if (!away.length) {
    return null;
  }
  const atFight = new Set(getActiveEncounter(campaign.id)?.awayIds ?? []);
  const sheets = [...sheetsById.values()];
  const elsewhere = elsewhereBySheet(campaign.id, sheets);
  const roster = sheets.filter((sheet) => elsewhere.has(sheet.id) && !atFight.has(sheet.id)).map((sheet) => ({ id: sheet.id, name: sheet.name, place: elsewhere.get(sheet.id) ?? "" }));
  return roster.length ? sceneRefusal(name, args, roster, getCurrentLocation(campaign.id)?.name ?? "") : null;
}

// The time the scene was away from those it is with now, still unspent: a
// rest that fits in it was taken then, and passes no more (rest-tools.ts).
export function meanwhileMinutes(campaignId: string): number {
  const party = getParty(campaignId);
  return party.away.length || party.cut ? restCredit(party.cut, getClock(campaignId).instant) : 0;
}

// The rest was taken in that time: it is spent, so a second one passes its
// own hours.
export function spendMeanwhile(campaignId: string, minutes: number) {
  const party = getParty(campaignId);
  if (party.cut) {
    updateParty(campaignId, (current) => ({ ...current, cut: current.cut ? { ...current.cut, behind: Math.max(0, restCredit(current.cut, getClock(campaignId).instant) - minutes), clock: getClock(campaignId).instant } : null }));
  }
}
