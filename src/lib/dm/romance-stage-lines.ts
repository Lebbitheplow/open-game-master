import type { Campaign } from "@/lib/db/campaigns";
import { insertCampaignMessage } from "@/lib/db/messages";
import { listRelationships } from "@/lib/db/relationships";
import { tableNoteSeq } from "@/lib/dm/narration-slot";
import { DIED_FLAG } from "@/lib/dm/relationship-logic";
import { defaultMilestoneText } from "@/lib/dm/relationship-subject";
import { cooledNote, romanceLinesAllowed, rungChange, rungLine, type Rung } from "@/lib/dm/romance-stage-logic";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { publishWithSeq } from "@/lib/events";

// Every romance rung a call moves is told to the table (issue 640; the words
// are romance-stage-logic.ts). The rung moves in several places (a step
// taken, a beat or a deed that sank the meter past a rung's grace, a social
// check, a break-up, an act unmasked, a bystander's share of a deed), so the
// calls that can move one are watched as a whole, at the one dispatch both
// the AI's turn and a person's console go through (invoke-dispatch.ts),
// rather than each path remembering to say so. An NPC's first move answered
// yes already posts its own line (npc-advance.ts announceAdvanceSettled).
//
// Who reads the line: the whole table. The rung is already on every seat's
// Bonds tab (the relationships route sends it to every member, unlike the
// meter's number, an act's truth or a companion's kept-in unease), and the
// line names nothing but the rung.

export const RUNG_TOOLS: ReadonlySet<string> = new Set([
  "romance_advance",
  "relationship_beat",
  "relationship_end",
  "relationship_scheme",
  "social_check",
]);

type Reading = Rung & { characterName: string; subjectName: string };

export function readRungs(campaignId: string): Map<string, Reading> {
  return new Map(
    listRelationships(campaignId).map((bond) => [
      bond.id,
      {
        romance: bond.romance,
        status: bond.status,
        died: bond.flags.includes(DIED_FLAG),
        characterName: bond.characterName,
        subjectName: bond.subjectName,
      },
    ]),
  );
}

// Below the narration that caused it while a turn's narration is on screen
// (narration-slot.ts, issue 668), as every server line is.
function postLine(campaign: Campaign, content: string) {
  const seq = tableNoteSeq(campaign.id);
  const message = insertCampaignMessage({ campaignId: campaign.id, seq, authorType: "system", glyph: "system-party", content });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

// Posts a line for each rung that moved since `before`, and returns what
// whoever made the call is told of one that cooled.
export function tellRungChanges(campaign: Campaign, before: ReadonlyMap<string, Reading>): string[] {
  if (!romanceLinesAllowed(campaign.gameSettings)) {
    return [];
  }
  const notes: string[] = [];
  for (const [id, now] of readRungs(campaign.id)) {
    const was = before.get(id);
    const change = was ? rungChange(was, now) : null;
    if (!change) {
      continue;
    }
    const { characterName: character, subjectName: subject } = now;
    postLine(campaign, rungLine(change, character, subject, (stage) => defaultMilestoneText(character, subject, stage)));
    const note = cooledNote(change, character, subject);
    if (note) {
      notes.push(note);
    }
  }
  return notes;
}

// Runs a call, watching the rungs when it is one that can move them. A
// cooled romance is added to the call's own note, which the model reads and
// the console shows.
export async function watchRungs(campaign: Campaign, name: string, run: () => Promise<ToolResult>): Promise<ToolResult> {
  if (!RUNG_TOOLS.has(name)) {
    return run();
  }
  const before = readRungs(campaign.id);
  const result = await run();
  const notes = tellRungChanges(campaign, before);
  if (!notes.length || result.error) {
    return result;
  }
  const said = typeof result.note === "string" ? result.note : "";
  return { ...result, note: [said, ...notes].filter(Boolean).join(" ") };
}
