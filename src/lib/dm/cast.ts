import { listCastNpcs, markNpcsHeard, type Npc } from "@/lib/db/npcs";
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
export function castForSeat(campaignId: string, secretStory: boolean): CastMember[] {
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

export function publishCast(campaignId: string) {
  publishEphemeral(campaignId, "cast_updated", { cast: wholeCast(campaignId) });
}

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
