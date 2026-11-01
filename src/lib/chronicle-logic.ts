// What the Chronicle beside the battle map shows, and when it moves
// (issues 212 and 213). Pure: scripts/test-chronicle.mjs.
import type { CampaignMessage } from "@/lib/db/messages";
import { LEAD_NOTE_PREFIX, isHaltedTurnNotice, systemNoteWords } from "@/lib/campaign-types";
import { isOocAnswer } from "@/lib/dm/ooc-question";

// The newest entries the scroll holds. It held 14 beside a short board; the
// pane now runs the full height of the fight stage (issue 213), so it holds
// more, and anything older is a click away in the story view.
export const CHRONICLE_ENTRIES = 40;

type Entry = Pick<CampaignMessage, "id" | "authorType" | "dmTurnId" | "content">;

// Narration, the party's lines and the table's notes: every message but the
// system line a halted DM turn leaves (it belongs to the turn, not the tale).
// A lair action is linked to its turn as well, and is the tale's.
// `earlier` counts what the window leaves out.
export function chronicleWindow<M extends Entry>(
  messages: readonly M[],
  limit = CHRONICLE_ENTRIES,
): { recent: M[]; earlier: number } {
  const eligible = messages.filter((message) => !isHaltedTurnNotice(message));
  return { recent: eligible.slice(-limit), earlier: Math.max(0, eligible.length - limit) };
}

// The halted turn a staged fight shows above its controls. The scroll leaves
// the halt out (above), and while the board holds the stage the transcript,
// where its notice and Retry live, is not drawn, so without this the reason
// the GM stopped flashed and was gone and the table sat on the enemies'
// turn with no way on (0.31.3 playtest, a test fight's GM signed out). The
// newest notice still linked to its turn, until the GM narrates again: table
// talk after it, the GM's out-of-character answer included, leaves it up.
export function stagedHaltedTurn<M extends Entry>(messages: readonly M[]): M | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.authorType === "dm" && !isOocAnswer(message.content)) {
      return null;
    }
    if (isHaltedTurnNotice(message)) {
      return message;
    }
  }
  return null;
}

// Everything that changes what the scroll draws, as one string. The scroll
// used to follow its entry COUNT, which stops moving once the window is
// full (a new entry pushes the oldest out) and never moves for an edit, so
// the newest passage slid below the fold (issue 212). Ids and lengths catch
// both; `rolls` catches a roll card that lands after its passage.
export function chronicleSignature(recent: ReadonlyArray<Pick<CampaignMessage, "id" | "content">>, rolls: number): string {
  return `${recent.map((message) => `${message.id}:${message.content.length}`).join("|")}#${rolls}`;
}

// How close to the end still counts as reading the latest. A reader above
// it has scrolled back on purpose and is left where they are.
export const FOLLOW_SLACK_PX = 48;

export function atBottom(
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number },
  slack = FOLLOW_SLACK_PX,
): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= slack;
}

// A system line as the scroll shows it, whole (PR 232: it used to be cut at
// 200 characters, so an enemy turn naming two attacks showed one). The
// transcript draws the lead's direction and a joiner as cards from their
// stored prefixes (src/lib/campaign-types.ts); the scroll has no cards, so
// the prefixes become words.
export function chronicleSystemLine(content: string): string {
  if (content.startsWith(LEAD_NOTE_PREFIX)) {
    return `Party lead: ${content.slice(LEAD_NOTE_PREFIX.length)}`;
  }
  // A joiner's and a settled offer's markers come off (issue 239): the
  // words say who answered and how; the marker is for the DM.
  return systemNoteWords(content);
}
