import { getCampaignById, setStoryArc } from "@/lib/db/campaigns";
import { tickedObjective } from "@/lib/dm/binder-tools";
import { listMessagesInSeqRange } from "@/lib/db/messages";
import { latestSeq } from "@/lib/db/campaigns";
import { publishEphemeral } from "@/lib/events";
import { narratorIsAi } from "@/lib/dm/viewer";
import { requestDmMessage } from "@/lib/dm/model";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { stripReasoningArtifacts } from "@/lib/story-prompt";
import type { ArcBeat, StoryArc } from "@/lib/dm/arc-logic";
import type { Campaign } from "@/lib/db/campaigns";
import {
  activeBeat,
  matchSignal,
  openWaypoints,
  parseWaypointJudge,
  setWaypointDone,
  signalFromToolCall,
  taggedWaypoint,
  tickWaypoints,
} from "@/lib/dm/waypoint-logic";
import { mergedCallText } from "@/lib/dm/tool-merge-logic";

// Ticking the [NOW] beat's waypoints (issue #31). Two sources, in order of
// trust: the DM's own tool calls, which name the place, person, item,
// objective or foe outright and cost no model call; and the judge, one
// small YES-list call on the chapter's cadence for whatever the tools did
// not catch (a narrative step, or an arrival the DM narrated without
// move_party). A tool call ticks a step when the DM tags it with the step's
// number, or when the name it used matches the step's words. A name worded
// differently and untagged is left to the judge: no similarity score can
// tell "the drowned cathedral" from a different place that reads like it,
// and its scale changes with the embedding model.

type ToolCall = { name: string; rawArguments: string };

// Which open waypoints, if any, the turn's tool calls satisfied. Returns
// the texts ticked, for the caller's debug line. `enemyNames` are the foes
// of the encounter as it stood BEFORE the calls ran, since end_encounter
// has no names of its own. `accepted` holds the calls the engine has run
// without an error: a step a call's tag names ticks only for one of those,
// so a refused move_party cannot claim an arrival. `refused` holds the calls
// the engine ran and turned down: they tick nothing by name either (a
// move_party refused for its scene once ticked the place it named, and the
// DM narrated an arrival the map never made).
export async function tickWaypointsFromCalls(
  campaignId: string,
  calls: ToolCall[],
  extra: { enemyNames?: string[]; accepted?: ReadonlySet<ToolCall>; refused?: ReadonlySet<ToolCall> } = {},
): Promise<string[]> {
  const campaign = getCampaignById(campaignId);
  if (!campaign?.storyArc || !narratorIsAi(campaign.gameSettings.dmMode) || !calls.length) {
    return [];
  }
  const active = activeBeat(campaign.storyArc);
  if (!active || !openWaypoints(active.beat).length) {
    return [];
  }
  const matched = matchCalls(campaign, active.beat, calls, extra);
  if (!matched.size) {
    return [];
  }
  return applyTicks(campaignId, campaign.storyArc, active.number, [...matched]);
}

type TickExtra = { enemyNames?: string[]; accepted?: ReadonlySet<ToolCall>; refused?: ReadonlySet<ToolCall> };

// The open waypoints of `beat` the calls satisfy.
function matchCalls(campaign: Campaign, beat: ArcBeat, calls: ToolCall[], extra: TickExtra): Set<number> {
  const matched = new Set<number>();
  for (const call of calls) {
    if (extra.refused?.has(call)) {
      continue;
    }
    // Read under the names it ran by: a retired tool, an older argument name.
    const ran = mergedCallText(call.name, call.rawArguments);
    const tagged = extra.accepted?.has(call) ? taggedWaypoint(beat, ran.name, ran.rawArguments) : null;
    if (tagged !== null) {
      matched.add(tagged);
    }
    const signal = signalFromToolCall(ran.name, ran.rawArguments, {
      enemyNames: extra.enemyNames,
      objectiveText: ran.name === "tick_objective" ? objectiveText(campaign.id, ran.rawArguments) : undefined,
    });
    if (signal) {
      for (const index of matchSignal(beat, signal, campaign.gameSettings.tableLanguage)) {
        matched.add(index);
      }
    }
  }
  return matched;
}

// The [NOW] beat as it stood before a reply's calls ticked it, or null.
export type BeatMark = { number: number; beat: ArcBeat } | null;

export function markActiveBeat(campaignId: string): BeatMark {
  const arc = getCampaignById(campaignId)?.storyArc;
  return arc ? activeBeat(arc) : null;
}

// A reply's waypoints tick before its beat is judged, from calls that have
// not run yet (issue #31: the arrival and the beat it lands in resolve in
// order). Once they have run, a step only a refused call (or a refused item
// of a call's list) named is open again: a grant_item refused for the Sun
// Blade had ticked "Recover the Sun Blade" with the blade nowhere on the
// sheet. A beat the same reply's complete_beat already closed keeps what
// the claim stood on. Returns the texts opened again.
export function settleEarlyTicks(campaignId: string, mark: BeatMark, calls: ToolCall[], extra: TickExtra): string[] {
  const campaign = getCampaignById(campaignId);
  if (!mark || !campaign?.storyArc) {
    return [];
  }
  const active = activeBeat(campaign.storyArc);
  if (!active || active.number !== mark.number) {
    return [];
  }
  const ticked = (active.beat.waypoints ?? []).flatMap((waypoint, index) => (waypoint.done && !mark.beat.waypoints?.[index]?.done ? [index] : []));
  if (!ticked.length) {
    return [];
  }
  const done = matchCalls(campaign, mark.beat, calls.filter((call) => extra.accepted?.has(call)), extra);
  const opened = ticked.filter((index) => !done.has(index));
  if (!opened.length) {
    return [];
  }
  const arc = opened.reduce((next, index) => setWaypointDone(next, active.number, index, false), campaign.storyArc);
  setStoryArc(campaignId, arc);
  publishEphemeral(campaignId, "arc_updated", {});
  return opened.map((index) => active.beat.waypoints?.[index]?.text ?? "").filter(Boolean);
}

function objectiveText(campaignId: string, rawArguments: string): string | undefined {
  try {
    const found = tickedObjective(campaignId, rawArguments);
    return found ? `${found.quest.title} ${found.objective.text}` : undefined;
  } catch {
    return undefined;
  }
}

function applyTicks(campaignId: string, arc: StoryArc, beatNumber: number, indexes: number[]): string[] {
  const next = tickWaypoints(arc, beatNumber, indexes);
  if (next === arc) {
    return [];
  }
  setStoryArc(campaignId, next);
  // The lead's arc card refetches on this; players never see the arc.
  publishEphemeral(campaignId, "arc_updated", {});
  const ticked = indexes.map((index) => arc.beats[beatNumber - 1].waypoints?.[index]?.text ?? "").filter(Boolean);
  if (process.env.DM_DEBUG) {
    console.log(`[dm-debug] waypoints ticked on beat ${beatNumber}: ${ticked.join(" | ")}`);
  }
  return ticked;
}

const WAYPOINT_JUDGE_SYSTEM = `You are checking which steps of a D&D story beat have actually happened in the most recent play. You are given the beat, a numbered list of its steps, and the recent play. Reply with ONLY a JSON array of the numbers of the steps that have clearly and fully happened in that play, for example [2] or [1,3]. Working toward a step is not the step. Reply [] if none has.`;

// The backstop: one small call that reads the chapter's play since the
// last beat and ticks whichever open waypoints it shows. Returns the texts
// ticked. Any failure ticks nothing; the tools and the next cadence remain.
export async function judgeWaypoints(campaignId: string, sinceSeq: number): Promise<string[]> {
  try {
    const campaign = getCampaignById(campaignId);
    if (!campaign?.storyArc) {
      return [];
    }
    const active = activeBeat(campaign.storyArc);
    if (!active) {
      return [];
    }
    const open = (active.beat.waypoints ?? [])
      .map((waypoint, index) => ({ waypoint, index }))
      .filter(({ waypoint }) => !waypoint.done);
    if (!open.length) {
      return [];
    }
    const recent = listMessagesInSeqRange(campaignId, sinceSeq, latestSeq(campaignId))
      .filter((message) => message.authorType !== "system")
      .slice(-8)
      .map((message) => `${message.authorType === "dm" ? "GM" : "Player"}: ${message.content}`)
      .join("\n\n")
      .slice(-6_000);
    if (!recent) {
      return [];
    }
    const { message, error } = await requestDmMessage(
      campaign.settings,
      [
        { role: "system", content: WAYPOINT_JUDGE_SYSTEM },
        {
          role: "user",
          content: `Beat: ${active.beat.text}\n\nSteps:\n${open
            .map((entry, at) => `${at + 1}. ${entry.waypoint.text}`)
            .join("\n")}\n\nRecent play:\n${recent}`,
        },
      ],
      { meta: { task: "waypoint_judge" }, timeoutMs: arcTextTimeoutMs() },
    );
    if (error) {
      return [];
    }
    const raw = stripReasoningArtifacts(typeof message?.content === "string" ? message.content : "");
    const picked = parseWaypointJudge(raw, open.length).map((at) => open[at].index);
    if (process.env.DM_DEBUG) {
      console.log(`[dm-debug] waypoint judge: ${raw.slice(0, 40)} -> ${picked.join(",") || "none"}`);
    }
    if (!picked.length) {
      return [];
    }
    return applyTicks(campaignId, campaign.storyArc, active.number, picked);
  } catch {
    return [];
  }
}
