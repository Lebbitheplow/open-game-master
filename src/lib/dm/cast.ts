import { createHash } from "node:crypto";
import { listCastNpcs, markNpcsHeard, onCastTouched, type Npc } from "@/lib/db/npcs";
import { departedSheet } from "@/lib/db/companion-conscience";
import { characterPlaceholder } from "@/lib/placeholders";
import { publishEphemeral } from "@/lib/events";
import { heardKey, knownCast } from "@/lib/dm/cast-logic";
import type { SpokenLine } from "@/lib/dm/speech";

// The cast as the seats may see it (docs/vtt-parity-implementation-plan.md
// 8.1): names and faces, nothing of what they want or think. The snapshot
// carries it and cast_updated refreshes it whenever the DM changes a
// person, so a player's transcript can put a face beside a line, and the
// composer's @ menu can offer the names the table knows (issue 650).
//
// A seat is sent only the people the table knows (`known`, met or heard:
// src/lib/dm/cast-logic.ts). The whole cast, each marked, goes to the seats
// that already read it through the GM's people panel (secretStory: the GM
// seat, and the lead who steers an AI table), so a module's prepared cast
// never reaches a player's device (src/lib/table-delivery.ts).

// `aliases` are the other names they answer to, so a line tagged "Marla"
// finds Marla Venn (src/lib/dm/speech.ts).
// `plate` is the stand-in face for a companion who left the party: the
// painted plate for the class and ancestry their sheet had, which their
// lines showed while they travelled with the party and had no portrait.
// The row behind them speaks their parting line, and without it that line
// showed a letter (issue 660). Worked out here from the sheet kept on the
// departure record, never written onto the row, so a portrait the row has
// or is painted later comes first (castFaces, src/lib/speaker-faces.ts).
// `known` is absent from an older host, which sent everyone unmarked.
export type CastMember = {
  id: string;
  name: string;
  portraitUrl: string;
  hasVoice: boolean;
  aliases?: string[];
  plate?: string;
  known?: boolean;
};

// The whole cast, each marked known or not: the storyteller's view.
export function wholeCast(campaignId: string): CastMember[] {
  // A companion in the party shows as a party member, not as cast.
  return listCastNpcs(campaignId)
    .filter((npc) => !npc.archived)
    .map((npc) => {
      // Sent beside a portrait too, so an upload that cannot be reached
      // gives way to it, as a character's portrait does (speakerFaces).
      const plate = departedPlate(npc);
      return {
        id: npc.id,
        name: npc.name,
        portraitUrl: npc.portraitUrl,
        hasVoice: npc.voice !== null,
        aliases: npc.aliases,
        ...(plate ? { plate } : {}),
        known: Boolean(npc.metAt || npc.heardAt),
      };
    });
}

// The cast one seat is sent in its snapshot, as cast_updated sends it.
// A seat loading the table holds the cast as it stands now, which need not
// be what the open seats were last sent: a rewind or an import wrote the
// rows without telling them, and every seat reloads after it. So the next
// change is sent whatever it is; held against the older cast, a change
// back to it (meeting again someone a rewind unmet) was dropped, and the
// reloaded seats never heard it (issue 733).
export function castForSeat(campaignId: string, secretStory: boolean): CastMember[] {
  lastSent().delete(campaignId);
  const cast = wholeCast(campaignId);
  return secretStory ? cast : knownCast(cast);
}

function departedPlate(npc: Npc): string {
  if (!npc.companionSheetId) {
    return "";
  }
  const sheet = departedSheet(npc.id)?.sheet;
  if (!sheet) {
    return "";
  }
  const word = (value: unknown) => (typeof value === "string" ? value : undefined);
  return characterPlaceholder({ race: word(sheet.race) ?? "", class: word(sheet.class), gender: word(sheet.gender) });
}

// What a table's seats were last sent of its cast: the whole cast the
// story's seats hold, and the known part every other seat holds.
type SentCast = { whole: string; known: string };

declare global {
  var __odmCastSent: Map<string, SentCast> | undefined;
  var __odmCastPending: Set<string> | undefined;
}

// The cast each campaign's seats were last sent, as digests of its JSON, so
// a write that changed nothing they see sends nothing. Digests and not the
// JSON itself: the map keeps one entry for every table and workshop touched
// since the server started, and a large cast's JSON runs to tens of
// kilobytes.
function lastSent() {
  return (globalThis.__odmCastSent ??= new Map<string, SentCast>());
}

function castDigest(cast: CastMember[]): string {
  return createHash("sha1").update(JSON.stringify(cast)).digest("base64");
}

function digestsOf(cast: CastMember[]): SentCast {
  return { whole: castDigest(cast), known: castDigest(knownCast(cast)) };
}

// Sends the cast now, whatever the seats were last sent.
export function publishCast(campaignId: string) {
  sendCast(campaignId, true);
}

// Sends the cast when it differs from what the seats were last sent.
// Returns whether it did.
export function syncCast(campaignId: string): boolean {
  return sendCast(campaignId, false);
}

// A change only the story's seats can see (someone registered or prepared
// before the story names them, a prepared person renamed) is marked
// storyOnly and reaches them alone (src/lib/table-delivery.ts): a player's
// seat sent its own unchanged list at that moment would learn that the story
// had just added someone it has not met.
function sendCast(campaignId: string, always: boolean): boolean {
  const cast = wholeCast(campaignId);
  const sent = digestsOf(cast);
  const last = lastSent().get(campaignId);
  if (!always && last?.whole === sent.whole) {
    return false;
  }
  lastSent().set(campaignId, sent);
  publishEphemeral(campaignId, "cast_updated", last?.known === sent.known ? { cast, storyOnly: true } : { cast });
  return true;
}

// A write to a person (src/lib/db/npcs.ts touchCast) is weighed once the
// work in hand is done, so a tool call that meets, renames and paints
// several people sends one cast, and none when nothing a seat sees moved.
// Every path that changes the cast reaches the seats this way: a person met
// through a rule (a reaction roll, a social check, a first relationship
// beat) set met_at and told no one, so an open seat kept them unknown and
// its @ menu could not find them until a reload (issue 733). A line that
// must find its face as it lands still sends the cast itself first
// (noteNamesHeard), and the check here then finds nothing new.
onCastTouched((campaignId) => {
  const pending = (globalThis.__odmCastPending ??= new Set<string>());
  if (pending.has(campaignId)) {
    return;
  }
  pending.add(campaignId);
  setImmediate(() => {
    pending.delete(campaignId);
    try {
      syncCast(campaignId);
    } catch (error) {
      console.error(`[cast] ${campaignId}: the cast was not sent (${error instanceof Error ? error.message : "error"})`);
    }
  });
});

// A GM or system message has just been written or rewritten: anyone it
// names for the first time is now known to the table, and every seat is
// sent them before the message itself, so the line's face is there when it
// lands. A player's own message is not passed here (cast-logic.ts).
export function noteNamesHeard(campaignId: string, content: string, speech: readonly SpokenLine[] = []) {
  const key = heardKey(content, speech.map((line) => line.speaker.name));
  if (markNpcsHeard(campaignId, key).length) {
    publishCast(campaignId);
  }
}
