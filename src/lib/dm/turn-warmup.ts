// The next turn's prompt start, read by the narrator before the turn asks.
//
// llama.cpp keeps a prompt's start from one request to the next and reads
// only what follows it, but its cache restarts where a message starts (Qwen's
// hybrid layers, gpt-oss's sliding window), and a turn's first message holds
// the rules and the tools. A fight starting or ending, or a companion joining,
// changes that message, and the next turn read the whole prompt again: about
// 35K tokens, a minute on the Framework Desktop and two on a BC-250 (measured
// 385 tokens a second there, 2026-10-23), while the player waited.
//
// So when a turn ends and the next one's first message will differ from what
// the narrator last read, it is sent ahead asking for almost no reply, while
// the table reads and the player types. The turn that follows reuses it; one
// whose first message turned out different stops it and goes as before. It
// never competes with play: it runs as background work, and stops the moment
// any table's turn calls the same narrator (a two-slot server shares one
// cache, and two long prompts do not fit it together).
import { campaignSeats, getCampaignById, listMembers } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { listSheets } from "@/lib/db/sheets";
import { createDmJobControl, runInDmJob, type DmJobControl } from "@/lib/dm/job-control";
import { interactiveInFlight } from "@/lib/dm/inference-gate";
import { requestDmMessage, storyRouteKey } from "@/lib/dm/model";
import { turnRulesMessage } from "@/lib/dm/prompt";
import { keepPromptHead, keepsPromptSnapshots, notePromptReuse, promptHeadKey, readyPromptHead, type NarratorAddress } from "@/lib/dm/prompt-snapshot";
import { relationshipRosterForPrompt } from "@/lib/dm/relationship-tools";
import { endpointKind } from "@/lib/dm/sampling-logic";
import { hasHumanDm } from "@/lib/dm/viewer";
import { serverEnv } from "@/lib/server-env";
import type { StorySettings } from "@/lib/types";

// What the next turn's first call is offered, from the turn machinery
// (src/lib/dm/turn.ts), which this module does not import: the tools for the
// fight state as the turn left it, and the tuning that chose them.
export type NextTurnCall = {
  tools: readonly unknown[];
  thinking: boolean;
  // The compact and short-rules profiles choose tools and rules from the
  // players' words, so nothing can be sent ahead of those.
  wordsDecide: boolean;
};

// The longest a turn waits on a warm-up of its own first message: past it,
// the turn goes and reads the rest itself.
const MAX_TURN_WAIT_MS = 180_000;
const WATCH_MS = 250;

type Warming = { key: string; control: DmJobControl; done: Promise<void>; awaited: boolean };

declare global {
  var __odmTurnHeads: Map<string, string> | undefined;
  var __odmTurnWarmups: Map<string, Warming> | undefined;
}

// What each campaign's narrator last read as a turn's first message.
function heads() {
  return (globalThis.__odmTurnHeads ??= new Map<string, string>());
}

function warmups() {
  return (globalThis.__odmTurnWarmups ??= new Map<string, Warming>());
}

// One key per narrator, model, first message and tool list: two that match
// render the same prompt start.
export function turnHeadKey(settings: StorySettings, rules: string, tools: readonly unknown[]): string {
  return promptHeadKey(narratorAddress(settings), rules, tools);
}

function narratorAddress(settings: StorySettings): NarratorAddress {
  return { baseUrl: settings.customBaseUrl || "", model: settings.customModel, apiKey: settings.customApiKey };
}

// Before a turn's call with this first message, on a narrator that keeps
// prompt snapshots (src/lib/dm/prompt-snapshot.ts): the slot the call is
// pinned to, with the first message restored from its snapshot when the slot
// holds another. Undefined for every other narrator.
export async function readyTurnHead(settings: StorySettings, campaignId: string, key: string, firstCall: boolean): Promise<number | undefined> {
  return narratorKeepsPromptStart(settings) ? readyPromptHead(narratorAddress(settings), campaignId, key, firstCall) : undefined;
}

// After that call: how much of the prompt the narrator reused.
export function noteTurnReuse(settings: StorySettings, campaignId: string, cachedTokens: number | undefined): void {
  if (narratorKeepsPromptStart(settings)) {
    notePromptReuse(narratorAddress(settings), campaignId, cachedTokens);
  }
}

// A turn's call went out with this first message: the narrator holds it now.
export function noteTurnHead(campaignId: string, key: string): void {
  heads().set(campaignId, key);
}

// Called by a turn before its first call. A warm-up of the same first
// message is waited for, since it is reading what the turn needs (up to a
// bound); one of another is stopped, so it never holds the turn up.
export async function settleTurnWarmup(campaignId: string, key: string): Promise<void> {
  const warming = warmups().get(campaignId);
  if (!warming) {
    return;
  }
  if (warming.key !== key) {
    warming.control.controller.abort();
    return;
  }
  warming.awaited = true;
  await Promise.race([warming.done, new Promise((resolve) => setTimeout(resolve, MAX_TURN_WAIT_MS).unref?.())]);
}

// Only a local OpenAI-compatible narrator (llama.cpp and its kind) keeps a
// prompt's start this way. Exported so a check between turns costs nothing
// at a table whose narrator does not (turn.ts).
export function narratorKeepsPromptStart(settings: StorySettings): boolean {
  return settings.textProvider === "custom" && Boolean(settings.customModel.trim()) && endpointKind(settings.customBaseUrl) === "local";
}

function warmable(settings: StorySettings, next: NextTurnCall): boolean {
  return narratorKeepsPromptStart(settings) && !next.wordsDecide;
}

// A turn's end is not the only time the next turn's first message changes.
// Between turns a player opens their hero to advances, the lead shortens the
// narration or saves a prepared fight, and each one rewrites the rules or the
// tool list (issue 942: a hero opened to advances added the relationship
// rules' line and relationship_scheme, and the next turn read 54K tokens
// again, six minutes on a 16 GB card, before its first word). So any change
// the table hears of while no turn runs, and anyone sitting down at the
// table, checks again shortly after; a check whose first message the
// narrator already holds sends nothing.
const SETTLE_MS = 1_500;

declare global {
  var __odmTurnHeadChecks: Map<string, ReturnType<typeof setTimeout>> | undefined;
}

export function scheduleNextTurnCheck(campaignId: string, check: () => void): void {
  if (serverEnv("DM_TURN_WARMUP") === "0") {
    return;
  }
  // One check waits at a time and later changes ride it, since it reads the
  // table as it stands when it runs: a stream of typing notices must not
  // push it back past the player's send.
  const timers = (globalThis.__odmTurnHeadChecks ??= new Map());
  if (timers.has(campaignId)) {
    return;
  }
  const timer = setTimeout(() => {
    timers.delete(campaignId);
    check();
  }, SETTLE_MS);
  timer.unref?.();
  timers.set(campaignId, timer);
}

// A turn's first message as the table stands now: the rules, and the
// fight's own while one runs. What a warm-up sends ahead and what a turn
// whose fight began or ended swaps in (rulesAcrossFight), so the two agree
// to the letter.
function rulesNow(campaignId: string, inFight: boolean): string | null {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return null;
  }
  return turnRulesMessage({
    campaign,
    members: listMembers(campaignId),
    sheets: listSheets(campaignId),
    relationships: campaign.gameSettings.relationships === "off" ? [] : relationshipRosterForPrompt(campaignId),
    ruleContext: null,
    // Only whether a fight runs is read (turnRuleParts).
    encounter: inFight ? ({} as never) : null,
  });
}

// The rules for the side of a fight the turn's tools are now for, when its
// first message holds the other side's: a fight that began or ended in the
// turn. Null when the message is already right, or is neither side's as the
// table stands (a sheet changed in the turn), which is then left alone.
export function rulesAcrossFight(campaignId: string, current: string, inFight: boolean): string | null {
  const wanted = rulesNow(campaignId, inFight);
  if (!wanted || wanted === current) {
    return null;
  }
  return rulesNow(campaignId, !inFight) === current ? wanted : null;
}

// After a turn: sends the next turn's first message ahead when the narrator
// does not hold it. Never throws and is never waited on.
export function warmNextTurn(campaignId: string, next: NextTurnCall): void {
  // DM_TURN_WARMUP=0 sends nothing ahead (the test suites' scripted models
  // answer requests in order, and a warm-up would take a turn's reply). A
  // narrator that keeps prompt snapshots still has the first message a turn
  // read saved, below.
  const sendsNothing = serverEnv("DM_TURN_WARMUP") === "0";
  try {
    const campaign = getCampaignById(campaignId);
    if (!campaign || campaign.status !== "active" || hasHumanDm(campaignSeats(campaign))) {
      return;
    }
    if (sendsNothing && !keepsPromptSnapshots(narratorAddress(campaign.settings))) {
      return;
    }
    if (!warmable(campaign.settings, next)) {
      return;
    }
    const rules = rulesNow(campaignId, Boolean(getActiveEncounter(campaignId)));
    if (!rules) {
      return;
    }
    const { tools } = next;
    const key = turnHeadKey(campaign.settings, rules, tools);
    const address = narratorAddress(campaign.settings);
    if (heads().get(campaignId) === key || warmups().get(campaignId)?.key === key) {
      // Held, and read by a turn's own call: a first message with no
      // snapshot yet is saved now, while the table reads.
      if (heads().get(campaignId) === key) {
        void keepPromptHead(address, campaignId, key);
      }
      return;
    }
    if (sendsNothing) {
      return;
    }
    warmups().get(campaignId)?.control.controller.abort();
    const control = createDmJobControl(campaignId, "work", () => {});
    const routeKey = storyRouteKey(campaign.settings);
    const entry: Warming = { key, control, done: Promise.resolve(), awaited: false };
    // Another table's turn on the same narrator: this gives way at once.
    const watch = setInterval(() => {
      if (!entry.awaited && interactiveInFlight(routeKey) > 0) {
        control.controller.abort();
      }
    }, WATCH_MS);
    watch.unref?.();
    entry.done = runInDmJob(control, async () => {
      // A first message read before is restored from its snapshot, and the
      // request below then reads next to nothing.
      const slot = await readyPromptHead(address, campaignId, key);
      return requestDmMessage(
        campaign.settings,
        [
          { role: "system", content: rules },
          { role: "user", content: "(The table is reading. Wait for the players.)" },
        ],
        {
          tools: [...tools],
          // The same thinking request a turn's first call makes, so the
          // prompt renders the same.
          thinking: next.thinking,
          maxOutputTokens: 1,
          background: true,
          meta: { task: "turn_warmup" },
          ...(slot !== undefined ? { slot } : {}),
        },
      );
    })
      .then(async (result) => {
        if (!result.error) {
          heads().set(campaignId, key);
          // Kept before the turn's own call adds to the slot.
          await keepPromptHead(address, campaignId, key);
        }
      })
      .catch((error) => {
        console.warn(`[dm] campaign ${campaignId}: the next turn's warm-up failed`, error);
      })
      .finally(() => {
        clearInterval(watch);
        if (warmups().get(campaignId) === entry) {
          warmups().delete(campaignId);
        }
      });
    warmups().set(campaignId, entry);
  } catch (error) {
    console.warn(`[dm] campaign ${campaignId}: could not prepare the next turn's warm-up`, error);
  }
}
