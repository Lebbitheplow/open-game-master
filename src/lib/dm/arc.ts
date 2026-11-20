import { withLanguage } from "@/lib/dm/table-language-logic";
import { campaignSeats, getCampaignById, latestSeq, setStoryArc } from "@/lib/db/campaigns";
import { listChapters } from "@/lib/db/chapters";
import { slainFoeNames } from "@/lib/db/encounters";
import { retireArcQuests } from "@/lib/db/quests";
import { hasHumanDm, narratorIsAi } from "@/lib/dm/viewer";
import { listMessagesInSeqRange } from "@/lib/db/messages";
import { listSheets } from "@/lib/db/sheets";
import { backgroundWords, classWords, raceWords } from "@/lib/sheet-words";
import { presetFor, packWorldHints } from "@/lib/worlds/preset";
import { nameRegisterHint } from "@/lib/genres";
import {
  activeBeatNumber,
  applyActDetail,
  applyArcDelta,
  applyArcUpgrade,
  applyReplot,
  applySagaChain,
  arcRoom,
  plannedBossesAhead,
  completeBeat,
  concludeSaga,
  courseFromCheck,
  courseMayChange,
  fallenBosses,
  parseCourseCheckJson,
  renderPlanForCourseCheck,
  renderPlanForReplot,
  parseReplotJson,
  parseOpeningActJson,
  parseSagaPlanJson,
  openingActProblems,
  renderSagaPlan,
  sagaPlanProblems,
  sagaWithOpeningAct,
  applyArcEnrichment,
  applyArcExtension,
  arcExhausted,
  extractPreviousResolution,
  lengthProfile,
  needsEnrichment,
  needsSagaUpgrade,
  nextSketchAct,
  parseActDetailJson,
  parseArcDeltaJson,
  parseArcEnrichmentJson,
  parseArcExtensionJson,
  parseSagaJson,
  parseSagaUpgradeJson,
  renderArcForPrompt,
  sagaComplete,
  actTransition,
  parseActRecapJson,
  recordActRecap,
  romanNumeral,
  applyWaypointFill,
  needsWaypoints,
  parseWaypointFillJson,
  type ArcCourse,
  type ArcReplot,
  type CourseCheck,
  type LengthProfile,
  type StoryArc,
} from "@/lib/dm/arc-logic";
import { activeBeat, beatGated, openWaypoints } from "@/lib/dm/waypoint-logic";
import { publishTitleCard } from "@/lib/dm/scene-state";
import { insertCampaignMessage } from "@/lib/db/messages";
import { publishEphemeral, publishWithSeq } from "@/lib/events";
import { requestUtilityMessage } from "@/lib/dm/model";
import { trackUtilityCall } from "@/lib/dm/call-tracker";
import { isStageEnabled } from "@/lib/dm/stages";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { requestDmMessage } from "@/lib/dm/model";
import { stripReasoningArtifacts } from "@/lib/story-prompt";
import { setDmStatus } from "@/lib/dm/status";
import { renderWorldArcsForPrompt } from "@/lib/dm/world-arc-logic";
import { ensureWorldArcs } from "@/lib/dm/world-arc";
import { badArguments, type ToolResult } from "@/lib/dm/tool-errors";
import { partyStoryOf, partyStoryPlannerBlock } from "@/lib/dm/party-story";
import { tableNoteSeq } from "@/lib/dm/narration-slot";

// Story-arc generation and upkeep. The arc is the DM's secret spine: a saga
// sized by the lead's campaign-length setting is generated once at campaign
// activation (for every campaign, whether or not AI story setup wrote the
// premise) and refreshed with a small clamped delta at each chapter close.
// The other passes hang off that same heartbeat: a v1 campaign gets its
// cast/event layers filled in once, a v2 campaign gets its saga tier once,
// a party that finished the current act gets the next sketch detailed into
// real beats, and a party that finished the whole saga gets a sequel saga
// instead of quietly losing its [NOW] marker. Each close also asks whether
// the plan ahead still fits: a table that overtook it gets the rest of the
// saga plotted again, and one that ended the central conflict early gets
// its sequel at that close, not after acts nobody will play. Every failure
// path is a silent no-op: the campaign falls back to dm_outline (or
// nothing) and generation retries at the next chapter close.

function worldContext(campaignId: string): string {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return "";
  }
  const preset = presetFor(campaign.gameSettings);
  const party = listSheets(campaignId)
    .map(
      (sheet) =>
        `- ${sheet.name}: level ${sheet.level} ${raceWords(sheet)} ${classWords(sheet.class)}${sheet.subclass ? ` (${sheet.subclass})` : ""}, background ${backgroundWords(sheet) || "unknown"}, ${sheet.spellcasting ? "casts spells" : "casts nothing at all"}${sheet.backstory ? `\n  backstory: ${sheet.backstory}` : ""}${sheet.hopes ? `\n  their player hopes the story holds: ${sheet.hopes}` : ""}`,
    )
    .join("\n");
  return [
    `Difficulty: ${campaign.difficulty}.`,
    party ? `Party:\n${party}` : "",
    campaign.theme ? `World/theme set by the table: ${campaign.theme}` : "",
    campaign.description ? `Premise: ${campaign.description}` : "",
    campaign.gameSettings.genre === "custom"
      ? campaign.gameSettings.customGenreText
      : `Genre: ${preset.name}. ${preset.dmFlavor} ${nameRegisterHint(preset.nameHints)}`,
    // The pack's factions and hooks give the saga real named powers to plan
    // against instead of inventing a pantheon the world does not have.
    packWorldHints(campaign.gameSettings),
    // The table's combat pace (issue #432) shapes how many beats are fights.
    campaign.gameSettings.combatPace === "frequent"
      ? "Pacing: this table wants more fights. Give most acts at least one beat that is a fight the party cannot talk its way past."
      : campaign.gameSettings.combatPace === "rare"
        ? "Pacing: this table wants fewer fights. Favor beats of talk, intrigue, travel and discovery; keep fights to the moments the story turns on."
        : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function recentChapterLines(campaignId: string): string {
  return listChapters(campaignId)
    .filter((chapter) => chapter.status === "closed")
    .slice(-6)
    .map(
      (chapter) =>
        `${chapter.index}. "${chapter.title}"${chapter.highlights[0] ? ` - ${chapter.highlights[0]}` : ""}`,
    )
    .join("\n");
}

// Party-composition planning lines: the table's shared party backstory when
// it wrote one, pets, and AI companions the saga should
// plan moments for. A beastmaster's wolf or a drakewarden's drake is a
// promise the story ought to keep, so saga-scale generation (initial,
// upgrade, and sequel passes) is told explicitly to plan around them. The
// per-chapter refresh skips this to stay cheap; classes, subclasses, and
// backstories already ride along in worldContext's party roster.
const PET_PLANNING: Record<string, string> = {
  familiar:
    "plan a moment where the familiar matters (a scouting reveal, a creature only it can approach, a threat to it)",
  beast_companion:
    "plan encounters with notable beasts and at least one moment that tests the bond with the companion",
  drake: "plan draconic creatures, lore, or foes that resonate with the drake bond",
  other: "plan a moment where this creature companion matters",
};

function partyCompositionContext(campaignId: string): string {
  const lines: string[] = [];
  for (const sheet of listSheets(campaignId)) {
    if (sheet.isCompanion) {
      lines.push(
        `- ${sheet.name} is an AI ${sheet.companionKind === "guest" ? "guest ally" : "party companion"}${sheet.personality ? ` (personality: ${sheet.personality.slice(0, 120)})` : ""}: give them a personal stake somewhere in the saga.`,
      );
      continue;
    }
    const build = `${sheet.subclass ? `${sheet.subclass} ` : ""}${classWords(sheet.class)}`;
    for (const pet of sheet.pets ?? []) {
      lines.push(
        `- ${sheet.name} is a ${build} with a ${pet.kind.replace("_", " ")} ("${pet.name}", ${pet.form}): ${PET_PLANNING[pet.kind] ?? PET_PLANNING.other}.`,
      );
    }
  }
  // The table's own account of why the party is together rides with the
  // composition notes, so every saga-scale pass (initial, upgrade, act
  // detail, sequel) keeps it and the per-chapter refresh stays as cheap.
  const campaign = getCampaignById(campaignId);
  return [
    campaign ? partyStoryPlannerBlock(partyStoryOf(campaign)) : "",
    lines.length
      ? `Party composition notes; the plan must keep these promises (tie at least one boss, ally, or event to each line):\n${lines.join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Capability roster for the passes that write real beats. They see the arc
// and the chapters but never the sheets, and a planner told not to gate the
// story behind magic nobody has needs to know who is actually holding what.
// Deliberately coarse: spell lists change at every level, and the question a
// beat turns on is only whether ANYONE at this table can do the thing.
// Saga generation skips it because worldContext already carries the roster.
function partyCapabilityContext(campaignId: string): string {
  const lines = listSheets(campaignId).map(
    (sheet) =>
      `- ${sheet.name}: level ${sheet.level} ${sheet.subclass ? `${sheet.subclass} ` : ""}${classWords(sheet.class)}${sheet.isCompanion ? " (AI companion)" : ""}, ${sheet.spellcasting ? "casts spells" : "casts nothing at all"}.`,
  );
  if (!lines.length) {
    return "";
  }
  return `Who is actually at this table; every beat you write must be reachable by these people:\n${lines.join("\n")}`;
}

// The planning-side half of the DM's "never gate the story behind a
// capability nobody has" rule. A beat whose only road runs through a
// dispelled ward is unplayable at a party with no caster, and the DM cannot
// rescue it at the table without abandoning the beat, so it must never be
// written in the first place.
const SOLVABLE_RULE = `Every beat, sub-arc step, and event must be reachable by THIS party, so read the roster before you write one. Never make the only way forward a spell, proficiency, or item nobody has: no "dispel the ward" with no caster who could, no "read the Draconic tablet" with no reader. Build the obstacle around what these characters can actually do, or write in the ally, item, or second route that gets them through.`;

const EVENT_SHAPE =
  '{"kind": "npc_encounter"|"ally"|"twist"|"betrayal"|"deadline"|"discovery"|"setpiece", "name": string, "detail": string, "trigger": string, "actHint": int|null}';

// Shared by every prompt that can propose events. Both rules exist because
// the model broke them in verification: it wrote "Beat 5 occurs" as a
// trigger, and it wrote a "twist" that merely restated the antagonist line
// the DM already has in front of it.
const EVENT_RULES = `Two rules for every event you write. trigger is something that HAPPENS IN THE STORY and that the GM can recognise at the table ("the first time the party sleeps outside the walls", "when they open the reliquary"); it may never be a beat, act, chapter, or turn number, and never the word "beat" followed by a number. A twist or betrayal must reveal something that is NOT already stated in the premise, the stakes, the antagonist line, or any beat; if the GM already knows it, it reveals nothing and is not a twist.`;

const BOSS_SHAPE = '{"name": string, "detail": string}';

// Chapter pacing credits one beat per stretch of play (chapter-close.ts),
// so beats that are really one scene ("reach the village", then "speak to
// its elder") burn an act in a single evening. Every prompt that writes
// main beats carries this rule.
const BEAT_RULE = `Each beat is a turning point that takes a stretch of play to reach: a different place, confrontation, or discovery from the beat before it, never the next small step of the same scene (do not follow "reach the village" with "speak to its elder"; fold those into one beat). Leave room between beats for the travel, investigation, and trouble the GM improvises.`;

// A beat with its checklist (issue #31). The steps are what the chapter
// engine gates the beat on: the server ticks them from the DM's tool calls
// or its own check of play, and complete_beat is refused until all are
// done, so a beat can no longer land in the reply that reaches its place.
const BEAT_PLAN_SHAPE = `{"text": string, "waypoints": [{"kind": "place"|"npc"|"item"|"objective"|"fight"|"narrative", "text": string}]}`;
const WAYPOINT_RULE = `Each beat carries 2 to 4 waypoints: concrete steps the party must take before the beat can land, each one short line with a kind. place is a named location reached, npc a named person spoken with, item a named thing obtained, objective a quest objective completed, fight a named foe defeated, narrative anything else. Name places, people, items and foes exactly as the arc and cast name them, and make the steps different places or people from the beat before, so a beat takes a stretch of play to reach. List a fight after the beat's places and people, and save the act's boss for its last beat, never its first. When someone in a beat knows what the party needs, hearing it from them is a narrative step.`;

// The full saga JSON shape, shared by initial generation and sequel
// chaining (the chain adds one extra field in front).
// One act as a planner sketches it. `place` is asked for so that every act
// is somewhere of its own.
const ACT_SKETCH_FIELDS = `"title": string, "place": string, "milestone": string, "boss": ${BOSS_SHAPE}, "allies": string[], "hooks": string[]`;
const ACT_SKETCH_RULES = `place is where the act is set, a named place or region that no other act is set in; milestone is one sentence saying what the act accomplishes; boss names the major set-piece fight the act builds toward, with one sentence of detail; allies is 0 to 2 planned companion or temporary-ally encounters for the act; hooks is 0 to 2 ways the act touches a specific party member's abilities, pets, or backstory.`;

// The saga's plan: its acts as sketches, and no beats. Act 1's beats are a
// second reply (OPENING_ACT_SYSTEM below), written from this plan. Asked
// for both in one reply, with the acts in one list and "act 1 beats" in
// another beside it, the default local model wrote one beat per ACT: the
// whole saga inside act 1, the villain's fall its last beat, which is the
// saga a table then finished in an evening. Two replies are also half the
// JSON each, and a small model drops less of it.
const SAGA_SHAPE = `{"title": string, "premise": string, "stakes": string, "antagonist": string, "actPlan": [{${ACT_SKETCH_FIELDS}}], "finale": string, "finaleBoss": ${BOSS_SHAPE}, "cast": [{"name": string, "role": string, "agenda": string}], "subArcs": [{"name": string, "goal": string, "hook": string, "beats": string[]}]}`;

// Acts are announced to the players on title cards (issue #31), so every
// act carries a name that is safe to show them, separate from the
// milestone that states the plan.
const ACT_TITLE_RULE = `title is a short, evocative, spoiler-free name for the act, two to five words, fit to show the players on a title card ("The Drowned Road"); never a plan, a reveal, or a villain's name.`;

// One table's four acts were four stages of a single errand, with its
// villain waiting at the end of the first: the party finished the whole
// "campaign" in act 1. Every prompt that sketches acts carries this rule,
// and sagaPlanProblems (arc-logic.ts) checks the marks it can see.
const ACT_SHAPE_RULE = `Each act is an adventure of its own, with its own place, its own problem and its own boss, and it ends on a turn that makes the next act a new situation. The acts are never the next stages of one errand (not "find the lair", "enter the lair", "reach its heart", "kill its master": that whole errand is ONE act). The antagonist and the final boss stay beyond the party's reach until the last act: every earlier boss is someone or something else (a lieutenant, a rival, a creature, a traitor), no two acts share a boss, and winning an early act costs the antagonist something without ending the danger.`;

function sagaFieldRules(profile: LengthProfile): string {
  return `title: a name for the whole saga.
actPlan: ${profile.actsText} acts, ordered, escalating to the finale. Each entry is a SKETCH of one act: ${ACT_TITLE_RULE} ${ACT_SKETCH_RULES} The acts stay sketches on purpose; each is written into beats when the party reaches it, so keep them broad enough to survive whatever the table does first. ${ACT_SHAPE_RULE}
finaleBoss: the last act's boss is the saga's final boss; repeat them here.
cast: 2 to 4 recurring NPCs the campaign returns to, each with a concrete name and something they personally want. The antagonist may be one of them.
subArcs: ${profile.subArcsText} opening quest- or dungeon-scale threads; name and goal are player-safe and may appear in a quest log, hook is a GM-only secret tying the quest to the main story, beats are 2 to 4 expected steps.`;
}

// Act 1, written from the saga's plan (see SAGA_SHAPE). The saga's planned
// moments come with it, since they hang on act 1's people and places.
const OPENING_ACT_SYSTEM = `You are writing the opening act of the secret story saga an AI Game Master will steer a long D&D 5e campaign by. The saga is already plotted and you are given its plan. Write act 1 ONLY. Keep it brief and answer quickly.

Reply with ONLY a strict JSON object, no code fences, shaped exactly: {"beats": [${BEAT_PLAN_SHAPE}], "events": [${EVENT_SHAPE}]}

beats: 3 to 5 ordered beats for act 1, one short sentence each as text, ALL of them inside act 1: they happen in and around act 1's place, build to act 1's own milestone, and the last one is the fight with act 1's own boss. They are NOT a summary of the saga: nothing of the later acts appears in them (not their places, not their bosses), and no beat confronts the antagonist, fights the final boss, or settles the stakes. ${BEAT_RULE} ${WAYPOINT_RULE} Never number them yourself.
events: 4 to 6 planned special moments, most of them placed in the first two acts (actHint); later acts get their events when they are detailed. Use the kinds: a recurring NPC turning up (npc_encounter), a temporary ally or companion joining the party (ally), a revelation that reframes what came before (twist), someone the party trusted turning on them (betrayal), a clock that forces a choice (deadline), a find that opens a new road (discovery), or a memorable staged scene (setpiece). actHint is a soft placement only.

${EVENT_RULES}

${SOLVABLE_RULE}

Name people and places exactly as the plan names them, carry any twists a premise or outline you are given already names into events, and keep every promise in the party composition notes when they are given. Every string under 200 characters. Players never see any of this.`;

const SAGA_STYLE_RULES = `Name concrete people, factions, and places instead of roles ("Vicar Osseth", "the Ashen Concord", "the drowned undercroft"), and stay consistent with any premise or outline you are given. Hook at least one boss or cast member to each party member's own background, abilities, or backstory, and keep every promise in the party composition notes when they are given. Every string under 200 characters. Players never see any of this.`;

function sagaGenerateSystem(profile: LengthProfile): string {
  return `You plot the secret story saga an AI Game Master will steer a long D&D 5e campaign by. It is a loose guideline of people and events to keep the story moving, not a script: the table will wander, and the GM must be able to improvise around it.

Reply with ONLY a strict JSON object, no code fences, shaped exactly: ${SAGA_SHAPE}

${sagaFieldRules(profile)}

${SOLVABLE_RULE}

${SAGA_STYLE_RULES}`;
}

// A planned or refreshed arc brings its sub-arcs' quests with it; the quest
// log and the table's glance refetch when they changed (issue 581).
// `base`: the arc the job read before it awaited the model, so the table's
// edits made meanwhile survive (db/campaigns.ts setStoryArc).
function storeArc(campaignId: string, arc: StoryArc, base: StoryArc | null = null): boolean {
  const changed = setStoryArc(campaignId, arc, base);
  if (changed) {
    publishEphemeral(campaignId, "quests_updated", { at: Date.now() });
  }
  return changed;
}

// A saga from its plan's reply: the plan is checked for shape and plotted
// once more when something is wrong with it (arc-logic.ts
// sagaPlanProblems), then act 1 is written from it as a reply of its own
// and checked the same way (openingActProblems). A second try is kept only
// when it is better, so a model that cannot fix a thing costs one call and
// never the saga. A reply that could not be read at all, the plan's or act
// 1's, is asked for once more, since a plan without beats is no arc.
// `planRaw` is the plan reply as the model wrote it; the returned raw is
// the plan that was kept. `opening` says what act 1 opens on, for a sequel.
async function sagaFromPlan(
  campaignId: string,
  planSystem: string,
  context: string,
  profile: LengthProfile,
  planRaw: string,
  opening = "",
): Promise<{ arc: StoryArc; raw: string } | null> {
  let raw = planRaw;
  let plan = parseSagaPlanJson(raw, profile);
  if (!plan) {
    // A model that ignored the plan's shape and answered with a whole arc,
    // beats and all (nested acts, a flat list of beats), still yields a
    // working arc, as it always has.
    const whole = parseSagaJson(raw, profile);
    if (whole) {
      return { arc: whole, raw };
    }
    // A plan that cannot be read at all (cut short, or prose) is asked for
    // once more before the campaign goes without a spine until its first
    // chapter closes.
    if (process.env.DM_DEBUG) {
      console.log("[dm-debug] saga plan: unreadable reply, asking once more:", raw.slice(0, 200));
    }
    const again = await arcModelCall(campaignId, planSystem, context, "saga plan retry");
    if (again === null) {
      return null;
    }
    plan = parseSagaPlanJson(again, profile);
    if (!plan) {
      const wholeAgain = parseSagaJson(again, profile);
      return wholeAgain ? { arc: wholeAgain, raw: again } : null;
    }
    raw = again;
  }
  const feedback = (problems: string[], what: string) =>
    `Your last ${what} had these problems. Write it again, whole, without them:\n${problems.map((line) => `- ${line}`).join("\n")}`;
  const planProblems = sagaPlanProblems(plan);
  if (planProblems.length) {
    if (process.env.DM_DEBUG) {
      console.log(`[dm-debug] saga plan: plotting again (${planProblems.join(" | ")})`);
    }
    const again = await arcModelCall(campaignId, planSystem, `${context}\n\n${feedback(planProblems, "plan")}`, "saga replan");
    const second = again === null ? null : parseSagaPlanJson(again, profile);
    if (again !== null && second && sagaPlanProblems(second).length < planProblems.length) {
      plan = second;
      raw = again;
    }
  }
  const user = [context, `The saga's plan:\n${renderSagaPlan(plan)}`, opening].filter(Boolean).join("\n\n");
  const write = async (extra: string) => {
    const reply = await arcModelCall(campaignId, OPENING_ACT_SYSTEM, extra ? `${user}\n\n${extra}` : user, "opening act");
    return reply === null ? null : parseOpeningActJson(reply);
  };
  let act = await write("");
  const actProblems = act ? openingActProblems(plan, act.beats) : [];
  if (!act || actProblems.length) {
    if (process.env.DM_DEBUG) {
      console.log(`[dm-debug] opening act: writing again (${act ? actProblems.join(" | ") : "unreadable reply"})`);
    }
    const second = await write(actProblems.length ? feedback(actProblems, "act") : "");
    if (second && (!act || openingActProblems(plan, second.beats).length < actProblems.length)) {
      act = second;
    }
  }
  if (!act) {
    return null;
  }
  const arc = sagaWithOpeningAct(plan, act, profile);
  return arc ? { arc, raw } : null;
}

// Runs on the campaign's DM queue at activation (after runStorySetup, so a
// freshly invented premise/outline is already in place) and from the lead's
// regenerate action.
export async function generateStoryArc(
  campaignId: string,
  opts?: { force?: boolean },
) {
  try {
    const campaign = getCampaignById(campaignId);
    if (!campaign || (campaign.storyArc && !opts?.force)) {
      return;
    }
    // A person is telling this story, so the secret spine is theirs to write.
    // The arc table stays (the DM authors and edits it from the arc panel);
    // what goes is the planner running by itself. `force` is the DM standing
    // at the panel asking for a plan, which is a different thing entirely.
    if (!narratorIsAi(campaign.gameSettings.dmMode) && !opts?.force) {
      return;
    }
    setDmStatus(campaignId, "plotting_arc");
    const profile = lengthProfile(campaign.gameSettings.campaignLength);
    const context = [
      worldContext(campaignId),
      partyCompositionContext(campaignId),
      campaign.dmOutline
        ? `The GM's existing secret outline; keep the arc consistent with it:\n${campaign.dmOutline}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const { message, error } = await requestDmMessage(
      campaign.settings,
      [
        { role: "system", content: withLanguage(sagaGenerateSystem(profile), campaign.gameSettings.tableLanguage) },
        { role: "user", content: context },
      ],
      { meta: { task: "arc_generate" }, timeoutMs: arcTextTimeoutMs() },
    );
    if (error) {
      const payload = (await error
        .clone()
        .json()
        .catch(() => null)) as { error?: string } | null;
      console.warn(`[arc] campaign ${campaignId}: the story arc was not planned; the model call failed (${error.status}): ${payload?.error ?? "no detail"}`);
      return;
    }
    const raw = typeof message?.content === "string" ? message.content : "";
    const plotted = await sagaFromPlan(campaignId, sagaGenerateSystem(profile), context, profile, raw);
    if (!plotted) {
      console.warn(`[arc] campaign ${campaignId}: the story arc was not planned; the model's reply was not a readable plan`);
      if (process.env.DM_DEBUG) {
        console.log("[dm-debug] arc generation: unparseable reply:", raw.slice(0, 500));
      }
      return;
    }
    const arc = plotted.arc;
    // A regenerated arc numbers its threads from the start again.
    const retired = retireArcQuests(campaignId);
    if (!storeArc(campaignId, arc) && retired) {
      publishEphemeral(campaignId, "quests_updated", { at: Date.now() });
    }
    // The off-screen clocks orbit the fresh arc; a failure here simply
    // retries at the next chapter close (ensureWorldArcs is self-healing).
    const withWorld = await ensureWorldArcs(campaignId, arc);
    if (withWorld !== arc) {
      storeArc(campaignId, withWorld, arc);
    }
  } catch (error) {
    // Always logged: a plan that silently never arrived is what an operator
    // reading the server log needs to see (issue #383).
    console.error(`[arc] campaign ${campaignId}: the story arc could not be planned`, error);
  } finally {
    setDmStatus(campaignId, "idle");
  }
}

// complete_beat: the DM reports that the story actually reached the [NOW]
// beat. Marks it done, advances the marker, and tells the caller so the
// turn can close the chapter. One beat per turn: the cap stops a confused
// model from burning the whole arc in a single reply, and out-of-order
// numbers are refused with the real active beat so it can correct itself.
export function handleCompleteBeat(
  campaignId: string,
  rawArguments: string,
  alreadyCompleted: boolean,
): { result: ToolResult; completed: boolean; gated: boolean } {
  const campaign = getCampaignById(campaignId);
  if (!campaign?.storyArc) {
    return { result: { error: "This campaign has no story arc yet.", retry: true }, completed: false, gated: false };
  }
  if (alreadyCompleted) {
    return {
      result: { error: "A beat was already completed this turn; let the story breathe.", retry: true },
      completed: false,
      gated: false,
    };
  }
  let args: { beat?: unknown };
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch (error) {
    return { result: badArguments("Invalid arguments: complete_beat needs a beat.", error, rawArguments), completed: false, gated: false };
  }
  const arc = campaign.storyArc;
  const active = activeBeatNumber(arc);
  // A missing or unparseable number means the current beat, which is what
  // the model means the overwhelming majority of the time.
  const requested = Number(args.beat);
  const beatNumber = Number.isInteger(requested) && requested >= 1 ? requested : active;
  if (beatNumber === null) {
    return {
      result: { error: "Every beat of the arc is already finished.", retry: true },
      completed: false,
      gated: false,
    };
  }
  // The checklist is the gate (issue #31): a beat whose steps are still
  // open is refused with the steps named, so the DM keeps steering rather
  // than closing a chapter on the party's arrival.
  const target = arc.beats[beatNumber - 1];
  if (target && beatGated(target)) {
    return {
      result: {
        error: `Beat ${beatNumber} still has open waypoints: ${openWaypoints(target)
          .map((waypoint) => waypoint.text)
          .join("; ")}. Steer the party through them first. They tick from your own tool calls (move_party, set_npc, grant_item, tick_objective, end_encounter) or from the server's check of play, and the beat completes once every one is done.`,
        retry: true,
        openWaypoints: openWaypoints(target).map((waypoint) => waypoint.text),
      },
      completed: false,
      gated: true,
    };
  }
  const advanced = completeBeat(arc, beatNumber);
  if (!advanced) {
    return {
      result: {
        error: `Beat ${beatNumber} is not an open beat.`,
        retry: true,
        ...(active === null ? {} : { activeBeat: active }),
      },
      completed: false,
      gated: false,
    };
  }
  setStoryArc(campaignId, advanced.arc);
  const nextActive = activeBeatNumber(advanced.arc);
  return {
    result: {
      ok: true,
      completedBeat: beatNumber,
      ...(nextActive === null
        ? {
            note: nextSketchAct(advanced.arc)
              ? "That act is complete; the next act will be planned at the chapter break. Play a breather or transition scene until then."
              : "That was the saga's last beat; what comes next will be plotted at the chapter break. Play the aftermath.",
          }
        : { nextBeat: advanced.arc.beats[nextActive - 1].text }),
    },
    completed: true,
    gated: Boolean(target?.waypoints?.length),
  };
}

// The DM claimed the [NOW] beat while its waypoints were open, and the
// server's own check has since ticked the last of them: the claim stands.
// chapter-close.ts calls this instead of waiting for the next complete_beat.
export function completeActiveBeat(campaignId: string): { completed: boolean; gated: boolean } {
  const campaign = getCampaignById(campaignId);
  if (!campaign?.storyArc) {
    return { completed: false, gated: false };
  }
  const active = activeBeat(campaign.storyArc);
  if (!active || beatGated(active.beat)) {
    return { completed: false, gated: false };
  }
  const advanced = completeBeat(campaign.storyArc, active.number);
  if (!advanced) {
    return { completed: false, gated: false };
  }
  setStoryArc(campaignId, advanced.arc);
  return { completed: true, gated: Boolean(active.beat.waypoints?.length) };
}

const WAYPOINT_FILL_SYSTEM = `You are adding waypoints to the beats of an AI GM's secret story arc for a D&D 5e campaign already in progress. Keep it brief and answer quickly.

Reply with ONLY a strict JSON object, no code fences, shaped exactly: {"beats": [{"beat": int, "waypoints": [{"kind": "place"|"npc"|"item"|"objective"|"fight"|"narrative", "text": string}]}]}

beat is the 1-based number of a beat listed as [NOW] or [ahead] in the current act. ${WAYPOINT_RULE} Write nothing for beats marked [done] or [skipped] or for other acts. Every string under 120 characters. Players never see this.`;

// Arcs written before beats carried steps get them once, for the act in
// play, the way v1 arcs got their cast and event layers. Returns the arc
// unchanged on any failure; the next chapter close tries again.
async function fillWaypoints(campaignId: string, arc: StoryArc): Promise<StoryArc> {
  const raw = await arcModelCall(
    campaignId,
    WAYPOINT_FILL_SYSTEM,
    [`Current arc:\n${renderArcForPrompt(arc)}`, partyCapabilityContext(campaignId)]
      .filter(Boolean)
      .join("\n\n"),
    "waypoint fill",
  );
  if (raw === null) {
    return arc;
  }
  const fills = parseWaypointFillJson(raw);
  if (!fills.length) {
    if (process.env.DM_DEBUG) {
      console.log("[dm-debug] waypoint fill: unparseable reply:", raw.slice(0, 500));
    }
    return arc;
  }
  return applyWaypointFill(arc, fills);
}

const JUDGE_SYSTEM = `You are checking whether one specific story beat of a D&D campaign has actually happened yet. Answer in one word.

You are given the beat and the most recent play. Reply with ONLY the word YES if the beat has clearly and fully happened in that play, or ONLY the word NO if it has not. Working toward the beat is NO. A beat is YES only when the thing it describes has actually occurred in the narration.`;

// Backstop for complete_beat. The DM reliably NARRATES a beat landing but
// only calls the tool about half the time (measured on qwen3.6-35b), so
// chapter pacing cannot rest on the tool alone. This is one tiny model call
// asking a single yes/no question, and only when a chapter is already long
// enough to close, so a short chapter never pays for it. Any failure is a
// silent NO: the chapter simply stays open until the next check or the cap.
// `sinceSeq` bounds what the judge may read: play after the previous beat
// landed, inside the open chapter. Reading further back let the scene that
// finished one beat be credited for the next (issue #31).
export async function judgeBeatCompleted(campaignId: string, sinceSeq: number): Promise<boolean> {
  try {
    const campaign = getCampaignById(campaignId);
    if (!campaign?.storyArc) {
      return false;
    }
    const active = activeBeatNumber(campaign.storyArc);
    if (active === null) {
      return false;
    }
    const beat = campaign.storyArc.beats[active - 1];
    const recent = listMessagesInSeqRange(campaignId, sinceSeq, latestSeq(campaignId))
      .filter((message) => message.authorType !== "system")
      .slice(-8)
      .map((message) => `${message.authorType === "dm" ? "GM" : "Player"}: ${message.content}`)
      .join("\n\n")
      .slice(-6_000);
    if (!recent) {
      return false;
    }
    const { message, error } = await requestDmMessage(
      campaign.settings,
      [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: `Beat: ${beat.text}\n\nRecent play:\n${recent}` },
      ],
      { meta: { task: "beat_judge" }, timeoutMs: arcTextTimeoutMs() },
    );
    if (error) {
      return false;
    }
    const raw = stripReasoningArtifacts(
      typeof message?.content === "string" ? message.content : "",
    )
      .trim()
      .toUpperCase();
    const verdict = /^\W*YES\b/.test(raw);
    if (process.env.DM_DEBUG) {
      console.log(`[dm-debug] beat judge: beat ${active} "${beat.text}" -> ${raw.slice(0, 20)}`);
    }
    if (!verdict) {
      return false;
    }
    // Mark it exactly the way the tool would, so both paths converge.
    const advanced = completeBeat(campaign.storyArc, active);
    if (!advanced) {
      return false;
    }
    storeArc(campaignId, advanced.arc, campaign.storyArc);
    return true;
  } catch {
    return false;
  }
}

const REFRESH_SYSTEM = `You maintain the AI GM's secret story arc between chapters of a D&D 5e campaign. Keep it brief and answer quickly. Compare the arc with what actually happened in the chapter that just closed and reply with ONLY a strict JSON object, no code fences, shaped exactly: {"beatsDone": int[], "beatsSkipped": int[], "beatAnnotations": [{"beat": int, "detail": string}], "beatRewrites": [{"beat": int, "text": string}], "activeBeat": int|null, "subArcUpdates": [{"id": string, "status": "active"|"resolved"|"abandoned", "resolution": string}], "newSubArcs": [{"name": string, "goal": string, "hook": string, "beats": string[]}], "eventsFired": string[], "eventsDropped": string[], "newEvents": [${EVENT_SHAPE}], "castUpdates": [{"id": string, "notes": string, "status": "active"|"gone"}], "newCast": [{"name": string, "role": string, "agenda": string, "notes": string}], "sketchUpdates": [{"act": int, "milestone": string, "boss": ${BOSS_SHAPE}|null, "allies": string[]}], "worldArcUpdates": [{"id": string, "stance": "unaware"|"ignoring"|"opposing"|"aiding"|"fleeing", "consequence": string}]}

Be conservative. Empty arrays are a correct answer when little changed.
- beatsDone: mark a main beat done only if the chapter clearly accomplished it. Never renumber existing beats.
- beatsSkipped: use only when the party's own choices made a beat genuinely moot and it will never happen. This is how a story that went its own way keeps moving instead of stalling on a beat nobody will reach.
- beatAnnotations: at most 3. Attach what the table specifically did to the beat it touched, so later scenes can call back to it by name ("they let Marl go free and he owes them"). This is the normal way play changes the main beats; the beat's own text stays exactly as written.
- beatRewrites: at most 2, and ONLY when the players killed, exposed, or permanently altered the very thing a not-yet-played beat depends on, so the beat as written can no longer happen at all; rewrite it to the nearest beat that CAN happen. Prefer beatsSkipped plus a new sub-arc when the story merely went around a beat. Never rewrite a done or skipped beat, or a beat from a past act.
- eventsFired: ids of planned events the chapter actually delivered. eventsDropped: ids the story has moved past or made impossible. Dropping an event that no longer fits is correct and expected, not a failure.
- newEvents: at most 2, only for genuinely new special moments the players' own choices have set up.
- castUpdates: notes record how an NPC now stands with the party; status "gone" when they die or leave for good. newCast: at most 2, for people the players made important.
- newSubArcs: at most 2, only for genuinely new threads.
- sketchUpdates: at most 2, only for FUTURE acts (listed as "ahead, sketch only") whose plan this chapter invalidated, for example when the party already slew a planned boss. Set boss to null if the planned boss is gone, or name the replacement.
- worldArcUpdates: for each listed off-screen world arc (ids "wa1"...), judge the party's stance from the chapter: "unaware" (they have not learned of it), "ignoring" (they know and chose to look away), "opposing", "aiding", or "fleeing". When they knowingly ignored or fled a direct threat, also record a one-sentence permanent consequence of that choice. Omit arcs whose stance is unchanged.

${EVENT_RULES}

The plan follows the table, never the other way round. Never add a sub-arc, an event or a rewrite whose purpose is to pull the party back to a beat the story has already answered or left behind: mark that beat done if the party did what it is about another way, skip it if they made it moot, and revise the sketch of any act ahead that what happened has overtaken.`;

const ACT_DETAIL_SYSTEM = `The party of a D&D 5e campaign has finished the current act of the AI GM's secret story arc, and the next act exists only as a sketch. Write that act's real beats now, growing out of what the table actually did. Keep it brief and answer quickly.

Reply with ONLY a strict JSON object, no code fences, shaped exactly: {"beats": [${BEAT_PLAN_SHAPE}], "title": string, "milestone": string, "finale": string, "bossEvent": ${EVENT_SHAPE}|null, "newEvents": [${EVENT_SHAPE}], "newCast": [{"name": string, "role": string, "agenda": string}]}

beats: 3 to 5 ordered beats for the new act, one short sentence each as text, escalating from where play actually stands, ALL of them inside this act: they build to its own boss, and unless it is the saga's last act none fights the boss of an act still ahead, the antagonist, or the final boss. ${BEAT_RULE} ${WAYPOINT_RULE} Never restate, renumber, or rewrite existing beats.
milestone: the sketch's milestone, revised only if play has changed what this act must accomplish; otherwise repeat it. ${ACT_TITLE_RULE}
bossEvent: the act's planned boss as a set-piece event with a trigger the GM can recognise in the fiction. If play already killed or dissolved the planned boss, name who or what fills that role now; null only if this act genuinely no longer has a boss.
finale: what this act escalates toward.
newEvents: at most 2 additional planned moments for the act; include one ally event if the sketch planned allies. newCast: at most 2.

${EVENT_RULES}

${SOLVABLE_RULE}

If play has invalidated parts of the sketch (a dead boss, a betrayed ally, a problem already solved), adapt the act to what is true now rather than forcing the sketch, and never write a beat that replays or returns to something the chapters show the party has already finished. Reuse the campaign's existing cast and open threads instead of inventing a fresh world, and honor the party composition notes when they are given. Do NOT re-propose an event the arc already lists. Every string under 200 characters. Players never see this.`;

const UPGRADE_SYSTEM = `An ongoing D&D 5e campaign has a story arc but no saga plan above it. Wrap the existing arc into a longer saga: treat the acts already written as the saga's opening acts and sketch ONLY the acts still ahead. Keep it brief and answer quickly.

Reply with ONLY a strict JSON object, no code fences, shaped exactly: {"title": string, "plannedActs": int, "sketches": [{${ACT_SKETCH_FIELDS}}], "finaleBoss": ${BOSS_SHAPE}}

title: a name for the whole saga, existing acts included. sketches: one entry per FUTURE act, in order, escalating toward a new larger finale beyond the arc's current one; each has its own ${ACT_TITLE_RULE} ${ACT_SKETCH_RULES} finaleBoss: the last act's boss. plannedActs: the total number of acts including the ones already written.

${ACT_SHAPE_RULE}

${SOLVABLE_RULE}

You may NOT change, reword, reorder, or renumber the existing beats or acts: those already happened or are in play. Grow the future out of the arc's own antagonist, threats, and unfinished threads, and honor the party composition notes when they are given. Every string under 200 characters. Players never see this.`;

function sagaChainSystem(profile: LengthProfile): string {
  return `The party of a D&D 5e campaign has played the AI GM's secret story saga to its conclusion, and the table is still playing. Plot the SEQUEL saga: a new large story that grows out of the concluded one's consequences.

Reply with ONLY a strict JSON object, no code fences, shaped exactly (the fields after previousResolution form a complete new saga): {"previousResolution": string, ${SAGA_SHAPE.slice(1)}

previousResolution: one line recording how the concluded saga actually ended for the party.
${sagaFieldRules(profile)}

${SOLVABLE_RULE}

Sequel rules: give the sequel a title of its own, never the concluded saga's, and grow the new premise and stakes out of the concluded saga's consequences (a power vacuum, a surviving lieutenant, a debt come due, something the party's own victory unleashed). Never recycle a dead antagonist as the villain again. Reuse surviving cast members the party cares about in cast, and let act 1 open in the aftermath of the finale the party just played. ${SAGA_STYLE_RULES}`;
}

// Asked at every chapter close the plan may turn at. Each answer is a fact
// about the play, with a default that changes nothing; arc-logic.ts
// courseFromCheck adds them up.
const COURSE_SYSTEM = `You are checking the secret story plan of a D&D 5e campaign against what the table has actually played. You are given the plan (its antagonist, its stakes, and the acts still ahead) and the play. Judge only by what the play shows happened; something that is not shown to have happened has not happened.

Reply with ONLY a strict JSON object, no code fences, shaped exactly: {"antagonist": "at large"|"defeated", "stakes": "open"|"settled", "acts": [{"act": int, "state": "ahead"|"done"|"moot"}], "note": string}

antagonist: "defeated" only if the antagonist named in the plan is dead, beaten for good, or won over. Wounded, escaped, exposed, delayed, or only their servants beaten is "at large".
stakes: "settled" only if the thing the stakes threaten can no longer happen, or has already happened for good. Otherwise "open".
acts: one entry for each act listed as still ahead, by its number. "done" if the party has ALREADY accomplished what that act is about or already beaten its boss; "moot" if what happened makes that act impossible or pointless as written; "ahead" if it could still be played as written.
note: one sentence saying what the party did, when any answer is "defeated", "settled", "done" or "moot"; otherwise "".`;

const REPLOT_SYSTEM = `The table of a D&D 5e campaign has overtaken the AI GM's secret story saga: the party already did, solved, destroyed or left behind what the acts ahead were about. Plot the REST of the saga again from what is true now. Keep it brief and answer quickly.

Reply with ONLY a strict JSON object, no code fences, shaped exactly: {"stakes": string, "antagonist": string, "actPlan": [{${ACT_SKETCH_FIELDS}}], "finale": string, "finaleBoss": ${BOSS_SHAPE}, "keepEvents": string[], "newCast": [{"name": string, "role": string, "agenda": string}]}

actPlan: the acts still to come, in order; the first is the act the table plays next, opening where the last chapter ended. An old act marked ALREADY DONE is behind the party for good: its place, its boss and its problem are not planned again, in any act. Each entry is a SKETCH of one act: ${ACT_TITLE_RULE} ${ACT_SKETCH_RULES} ${ACT_SHAPE_RULE}
stakes, antagonist: what is at risk and who opposes the party NOW. Repeat the existing lines only if they are still true; an antagonist who is dead, beaten or won over is replaced by whoever or whatever the story has put in that place (a survivor with a grudge, a rival who gains from the fall, something the party's own actions set loose).
finale: what the saga now escalates toward. finaleBoss: the last act's boss.
keepEvents: the ids of planned events listed in the arc that still fit the new plan; every other planned event is let go with the old plan. newCast: at most 2.

${SOLVABLE_RULE}

Never plan what the party has already done: no act or boss may replay, undo or return to anything the arc or the chapters show as finished, and nobody dead comes back as the villain. Grow the new plan out of the consequences of what the table did, reuse the campaign's surviving cast and open quests instead of inventing a fresh world, and honor the party composition notes when they are given. Every string under 200 characters. Players never see this.`;

const EXTEND_SYSTEM = `The party has played through every beat of an AI GM's secret story arc for a D&D 5e campaign, and the campaign is still running. Write the next act. Keep it brief and answer quickly.

Reply with ONLY a strict JSON object, no code fences, shaped exactly: {"beats": [${BEAT_PLAN_SHAPE}], "finale": string, "antagonist": string, "newEvents": [${EVENT_SHAPE}]}

beats: 3 to 4 ordered beats for the new act, one short sentence each as text, growing out of what the party actually did rather than repeating the old plot. ${BEAT_RULE} ${WAYPOINT_RULE} finale: what this act escalates toward. antagonist: keep the existing one if they survived and still matter, otherwise name who steps into the role now (an escalation of the old threat, a survivor with a grudge, or something the party's own victory unleashed). newEvents: at most 2 planned special moments for the new act.

${EVENT_RULES}

${SOLVABLE_RULE}

Reuse the campaign's existing cast and unfinished threads instead of inventing a fresh world. Do NOT re-propose an event the arc already lists; newEvents is only for moments that do not exist yet. Every string under 200 characters. Players never see this.`;

const ENRICH_SYSTEM = `You are adding two planning layers to an AI GM's existing secret story arc for a D&D 5e campaign already in progress. Keep it brief and answer quickly.

Reply with ONLY a strict JSON object, no code fences, shaped exactly: {"cast": [{"name": string, "role": string, "agenda": string}], "events": [${EVENT_SHAPE}], "beatActs": [{"beat": int, "act": int}]}

cast: 2 to 4 recurring NPCs already implied by the arc, each with a concrete name and something they personally want. events: 3 to 5 planned special moments still ahead of the party, using the kinds npc_encounter, ally, twist, betrayal, deadline, discovery, setpiece. beatActs: group the arc's existing beats into 2 or 3 acts by their 1-based number, in order.

${EVENT_RULES}

You may NOT change, reword, reorder, or renumber the existing beats, and you may not contradict beats already marked done: those already happened. Every string under 200 characters. Players never see this.`;

async function arcModelCall(
  campaignId: string,
  system: string,
  user: string,
  label: string,
): Promise<string | null> {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return null;
  }
  const { message, error } = await requestDmMessage(
    campaign.settings,
    [
      { role: "system", content: withLanguage(system, campaign.gameSettings.tableLanguage) },
      { role: "user", content: user },
    ],
    { meta: { task: "arc_plan" }, timeoutMs: arcTextTimeoutMs() },
  );
  if (error) {
    if (process.env.DM_DEBUG) {
      console.log(`[dm-debug] ${label}: model call failed`);
    }
    return null;
  }
  return typeof message?.content === "string" ? message.content : "";
}

// One-time v1 -> v2 upgrade for a campaign already in progress: fills in the
// cast and event layers and tags beats with acts, leaving every beat's text
// and status untouched. Returns the enriched arc, or the original on any
// failure (it retries at the next chapter close).
async function enrichStoryArc(campaignId: string, arc: StoryArc): Promise<StoryArc> {
  const raw = await arcModelCall(
    campaignId,
    ENRICH_SYSTEM,
    `Current arc:\n${renderArcForPrompt(arc)}`,
    "arc enrichment",
  );
  if (raw === null) {
    return arc;
  }
  const enrichment = parseArcEnrichmentJson(raw);
  if (!enrichment) {
    if (process.env.DM_DEBUG) {
      console.log("[dm-debug] arc enrichment: unparseable reply:", raw.slice(0, 500));
    }
    return arc;
  }
  return applyArcEnrichment(arc, enrichment);
}

// The party outlasted the plot: append a whole new act rather than leaving
// the arc with no [NOW] beat to steer by.
async function extendStoryArc(campaignId: string, arc: StoryArc): Promise<StoryArc> {
  const chapters = recentChapterLines(campaignId);
  const raw = await arcModelCall(
    campaignId,
    EXTEND_SYSTEM,
    [
      `Completed arc:\n${renderArcForPrompt(arc)}`,
      chapters ? `Chapters the party actually played:\n${chapters}` : "",
      partyCapabilityContext(campaignId),
    ]
      .filter(Boolean)
      .join("\n\n"),
    "arc extension",
  );
  if (raw === null) {
    return arc;
  }
  const extension = parseArcExtensionJson(raw);
  if (!extension) {
    if (process.env.DM_DEBUG) {
      console.log("[dm-debug] arc extension: unparseable reply:", raw.slice(0, 500));
    }
    return arc;
  }
  return applyArcExtension(arc, extension);
}

// One-time v2 -> v3 upgrade for a campaign already in progress: wraps the
// existing acts into a saga sized by the campaign-length setting and
// sketches the acts still ahead. Returns the original arc on any failure
// (it retries at the next chapter close, steering by the v2 render until
// then).
async function upgradeToSaga(campaignId: string, arc: StoryArc): Promise<StoryArc> {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return arc;
  }
  const profile = lengthProfile(campaign.gameSettings.campaignLength);
  const minFuture = Math.max(1, profile.minActs - arc.acts);
  const maxFuture = Math.max(minFuture, profile.maxActs - arc.acts);
  const chapters = recentChapterLines(campaignId);
  const raw = await arcModelCall(
    campaignId,
    UPGRADE_SYSTEM,
    [
      `Current arc:\n${renderArcForPrompt(arc)}`,
      chapters ? `Chapters the party actually played:\n${chapters}` : "",
      partyCapabilityContext(campaignId),
      partyCompositionContext(campaignId),
      `Sketch ${minFuture === maxFuture ? String(minFuture) : `${minFuture} to ${maxFuture}`} future act${maxFuture === 1 ? "" : "s"}.`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    "saga upgrade",
  );
  if (raw === null) {
    return arc;
  }
  const upgrade = parseSagaUpgradeJson(raw);
  if (!upgrade) {
    if (process.env.DM_DEBUG) {
      console.log("[dm-debug] saga upgrade: unparseable reply:", raw.slice(0, 500));
    }
    return arc;
  }
  return applyArcUpgrade(arc, upgrade);
}

// The party finished the current act: turn the next saga sketch into real
// beats, using everything that actually happened on the way here. On any
// failure the arc renders its "act complete, next act being planned"
// steering line and this pass retries at the next chapter close.
async function detailNextAct(campaignId: string, arc: StoryArc): Promise<StoryArc> {
  const sketch = nextSketchAct(arc);
  if (!sketch) {
    return arc;
  }
  const sketchLines = [
    `Milestone: ${sketch.milestone}`,
    sketch.place ? `Place: ${sketch.place}` : "",
    sketch.boss ? `Planned boss: ${sketch.boss.name}. ${sketch.boss.detail}` : "",
    sketch.allies.length ? `Planned allies: ${sketch.allies.join("; ")}` : "",
    sketch.hooks.length ? `Party hooks: ${sketch.hooks.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const chapters = recentChapterLines(campaignId);
  const raw = await arcModelCall(
    campaignId,
    ACT_DETAIL_SYSTEM,
    [
      `Current arc:\n${renderArcForPrompt(arc)}`,
      `The next act's sketch:\n${sketchLines}`,
      chapters ? `Chapters the party actually played:\n${chapters}` : "",
      partyCapabilityContext(campaignId),
      partyCompositionContext(campaignId),
    ]
      .filter(Boolean)
      .join("\n\n"),
    "act detail",
  );
  if (raw === null) {
    return arc;
  }
  const detail = parseActDetailJson(raw);
  if (!detail) {
    if (process.env.DM_DEBUG) {
      console.log("[dm-debug] act detail: unparseable reply:", raw.slice(0, 500));
    }
    return arc;
  }
  return applyActDetail(arc, detail);
}

// The party played the whole saga to its end: plot the sequel. The old saga
// joins priorSagas and its unresolved threads and surviving cast carry over
// (applySagaChain). On failure the concluded arc stays as-is, its aftermath
// steering line holds the table, and the chain retries at the next close.
async function chainSaga(campaignId: string, arc: StoryArc): Promise<StoryArc> {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return arc;
  }
  const profile = lengthProfile(campaign.gameSettings.campaignLength);
  const chapters = recentChapterLines(campaignId);
  const system = sagaChainSystem(profile);
  const user = [
    `The concluded saga:\n${renderArcForPrompt(arc)}`,
    // The sequel of a saga the table ended early grows out of what the
    // table did, never out of the acts it made unnecessary.
    arc.saga?.concluded
      ? `The party ended this saga before its planned finale: ${arc.saga.concluded} Beats marked [skipped] and the acts that were still ahead never happened; build the sequel only on what did.`
      : "",
    chapters ? `Chapters the party actually played:\n${chapters}` : "",
    partyCapabilityContext(campaignId),
    partyCompositionContext(campaignId),
  ]
    .filter(Boolean)
    .join("\n\n");
  const raw = await arcModelCall(campaignId, system, user, "saga chain");
  if (raw === null) {
    return arc;
  }
  const sequel = await sagaFromPlan(
    campaignId,
    system,
    user,
    profile,
    raw,
    "This is a sequel saga: act 1 opens in the aftermath of what the party just played.",
  );
  if (!sequel) {
    if (process.env.DM_DEBUG) {
      console.log("[dm-debug] saga chain: unparseable reply:", raw.slice(0, 500));
    }
    return arc;
  }
  return applySagaChain(arc, sequel.arc, extractPreviousResolution(sequel.raw));
}

// The table overtook the plan (courseFromCheck "overtaken"): plot the rest
// of the saga again from what is true now, as sketches. The arc comes back
// with its act ended and the new sketches waiting, and planNextAct writes
// the first of them into beats in the same close. On any failure the arc
// is returned as it was, and the next chapter close is asked again.
async function replotSaga(
  campaignId: string,
  arc: StoryArc,
  verdict: CourseVerdict,
  chapter: ClosedChapter,
): Promise<StoryArc> {
  if (!arc.saga) {
    return arc;
  }
  // The saga keeps the length it was planned at; a party that overtook the
  // plan in its last act gets one more.
  const acts = Math.max(1, arc.saga.plannedActs - arc.acts);
  const chapters = recentChapterLines(campaignId);
  const user = [
      `The saga so far:\n${renderPlanForReplot(arc, verdict.acts)}`,
      chapters ? `Chapters the party actually played, oldest first:\n${chapters}` : "",
      // What happened is the plan's raw material: without the chapter itself
      // the new plan was written from the old one.
      `The chapter that just closed, "${chapter.title}":\n${chapter.summary || chapter.highlights.join(" ")}`,
      verdict.note ? `What overtook the plan: ${verdict.note}` : "",
      partyCapabilityContext(campaignId),
      partyCompositionContext(campaignId),
      `Plan exactly ${acts} act${acts === 1 ? ", the saga's last" : "s"}, the first opening where that chapter ended.`,
    ]
      .filter(Boolean)
      .join("\n\n");
  const raw = await arcModelCall(campaignId, REPLOT_SYSTEM, user, "saga replot");
  if (raw === null) {
    return arc;
  }
  let replot = parseReplotJson(raw, acts);
  if (!replot) {
    if (process.env.DM_DEBUG) {
      console.log("[dm-debug] saga replot: unparseable reply:", raw.slice(0, 500));
    }
    return arc;
  }
  // The new acts are held to the shape a fresh saga's are, with one more
  // plot when it is wrong and the better of the two kept (sagaFromPlan).
  const problemsOf = (plan: ArcReplot) =>
    sagaPlanProblems({
      antagonist: plan.antagonist ?? arc.antagonist,
      finaleBoss: plan.finaleBoss,
      sketches: plan.sketches.map((sketch, index) => ({ ...sketch, act: arc.acts + 1 + index, status: "sketch" as const })),
    });
  const problems = problemsOf(replot);
  if (problems.length) {
    if (process.env.DM_DEBUG) {
      console.log(`[dm-debug] saga replot: plotting again (${problems.join(" | ")})`);
    }
    const again = await arcModelCall(
      campaignId,
      REPLOT_SYSTEM,
      `${user}\n\nYour last plan had these problems. Write it again, whole, without them:\n${problems.map((line) => `- ${line}`).join("\n")}`,
      "saga replot retry",
    );
    const second = again === null ? null : parseReplotJson(again, acts);
    if (second && problemsOf(second).length < problems.length) {
      replot = second;
    }
  }
  return applyReplot(arc, replot, chapter.index);
}

// The closing chapter's last lines, as the judges read play: its climax is
// usually there, and a summary can lose the one line that matters (one
// dropped the villain's death and kept the bells that rang for it).
function chapterTail(campaignId: string, chapter: ClosedChapter): string {
  if (chapter.seqStart === undefined) {
    return "";
  }
  return listMessagesInSeqRange(campaignId, chapter.seqStart, chapter.seqEnd ?? latestSeq(campaignId))
    .filter((message) => message.authorType !== "system")
    .slice(-8)
    .map((message) => `${message.authorType === "dm" ? "GM" : "Player"}: ${message.content}`)
    .join("\n\n")
    .slice(-6_000);
}

// What the course check found: the verdict, the line saying what the party
// did, and what it said of each act ahead, for the planner that follows.
type CourseVerdict = { course: ArcCourse; note: string; acts: CourseCheck["acts"] };

// One small call at a chapter close: is the antagonist beaten, are the
// stakes settled, could each act ahead still be played? Null on any failure
// or unreadable reply, which leaves the plan as it is.
async function checkCourse(
  campaignId: string,
  arc: StoryArc,
  chapter: ClosedChapter,
  fallenLine: string,
): Promise<CourseVerdict | null> {
  const played = recentChapterLines(campaignId);
  const tail = chapterTail(campaignId, chapter);
  const raw = await arcModelCall(
    campaignId,
    COURSE_SYSTEM,
    [
      `The plan:\n${renderPlanForCourseCheck(arc)}`,
      played ? `Chapters played so far, oldest first:\n${played}` : "",
      `The chapter that just closed, "${chapter.title}":\n${chapter.summary || chapter.highlights.join(" ")}`,
      tail ? `How that chapter ended, word for word:\n${tail}` : "",
      fallenLine,
    ]
      .filter(Boolean)
      .join("\n\n"),
    "arc course",
  );
  const check = raw === null ? null : parseCourseCheckJson(raw);
  if (!check) {
    return null;
  }
  const course = courseFromCheck(arc, check);
  if (process.env.DM_DEBUG) {
    console.log(`[dm-debug] arc course: ${course} (${JSON.stringify(check)})`);
  }
  return { course, note: check.note, acts: check.acts };
}

// Asks whether the plan ahead still fits (checkCourse) and acts on the
// answer. A concluded saga is settled here and its sequel plotted by
// planNextAct in the same close; an overtaken one has its remaining acts
// plotted again, and planNextAct writes the next of them into beats. An arc with no saga tier, or one with no room for another
// act, has nothing to re-plot: its unplayed beats are settled and the pass
// that writes what comes next (an extension, or a sequel) takes it from
// there. Not asked at all where the plan may not turn (courseMayChange) or
// has already been ended.
async function changeCourse(
  campaignId: string,
  arc: StoryArc,
  chapter: ClosedChapter,
  fallenLine: string,
): Promise<StoryArc> {
  if (arc.saga?.concluded || !courseMayChange(arc, chapter.index)) {
    return arc;
  }
  const verdict = await checkCourse(campaignId, arc, chapter, fallenLine);
  if (!verdict || verdict.course === "holds") {
    return arc;
  }
  if (verdict.course === "concluded" || !arc.saga || !arcRoom(arc).actRoom) {
    return concludeSaga(arc, verdict.note, chapter.index);
  }
  return replotSaga(campaignId, arc, verdict, chapter);
}

// Bosses the plan is still saving for acts the party has not reached (the
// saga's final boss among them) that share a name with a foe killed in a
// fight since `since`. Read from the fights themselves, so it costs no
// model call and survives a restart. chapter-close.ts closes the chapter
// on it, and the refresh is told, because a plan whose villain is already
// dead is the plan a GM kept steering a table back into.
export function fallenPlannedBosses(
  campaignId: string,
  arc: StoryArc,
  since: string,
): Array<{ name: string; act: number | null }> {
  if (!plannedBossesAhead(arc).length) {
    return [];
  }
  try {
    return fallenBosses(arc, slainFoeNames(campaignId, since));
  } catch {
    return [];
  }
}

// The chapter a refresh reads. The seq range is there on a chapter row and
// lets the course check read how the chapter ended; without it the summary
// stands alone.
type ClosedChapter = {
  index: number;
  title: string;
  summary: string;
  highlights: string[];
  seqStart?: number;
  seqEnd?: number | null;
};

// Runs at chapter close, on the DM queue. Self-healing: a campaign that
// never got an arc (earlier failure, pre-feature campaign) generates one
// here instead, a pre-v2 arc gains its cast and event layers, a pre-v3 arc
// gains its saga tier, a finished act gets the next sketch detailed, and a
// finished saga chains into a sequel. The upgrade/detail/chain passes are
// mutually exclusive per close. The course check (changeCourse) is one
// small call more at each close, and a close that turns the plan spends
// one planning call on it, at most once every few chapters.
export async function refreshStoryArc(
  campaignId: string,
  closedChapter: ClosedChapter,
  // chapter-close.ts already showed the "End of Act" card when the arc was
  // visibly exhausted at the close; the recap is still written here.
  // `since` is when the closed chapter opened, for the fights it held.
  options: { endAnnounced?: boolean; since?: string } = {},
) {
  try {
    const campaign = getCampaignById(campaignId);
    if (!campaign) {
      return;
    }
    // Human-DM chapters close too (a beat or a typed narration gets them
    // there), and this is the cascade that would otherwise quietly plan,
    // enrich and rewrite an arc the DM never asked for. Their notes are not
    // the model's to edit.
    // That holds for an assisted table too: a person sits in the seat, and an
    // arc is theirs to ask for (the Story panel's generate), never one the
    // first chapter close plans behind their back.
    if (!narratorIsAi(campaign.gameSettings.dmMode) || hasHumanDm(campaignSeats(campaign))) {
      return;
    }
    if (!campaign.storyArc) {
      await generateStoryArc(campaignId);
      return;
    }
    setDmStatus(campaignId, "plotting_arc");

    let arc = campaign.storyArc;
    if (needsEnrichment(arc)) {
      arc = await enrichStoryArc(campaignId, arc);
    }
    if (needsSagaUpgrade(arc)) {
      arc = await upgradeToSaga(campaignId, arc);
    }
    if (needsWaypoints(arc)) {
      arc = await fillWaypoints(campaignId, arc);
    }

    const chapterLines = [
      `Chapter ${closedChapter.index} just closed: "${closedChapter.title}"`,
      closedChapter.summary ? `Summary: ${closedChapter.summary}` : "",
      closedChapter.highlights.length
        ? `Highlights:\n${closedChapter.highlights.map((line) => `- ${line}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const worldArcLines = renderWorldArcsForPrompt(arc.worldArcs);
    const fallen = options.since ? fallenPlannedBosses(campaignId, arc, options.since) : [];
    const fallenLine = fallen.length
      ? `Foes killed in a fight this chapter that share a name with a boss the plan is still saving: ${fallen
          .map((boss) => `${boss.name} (${boss.act === null ? "the saga's final boss" : `act ${boss.act}'s boss`})`)
          .join("; ")}. If that is who died, the plan ahead cannot use them as written.`
      : "";
    const raw = await arcModelCall(
      campaignId,
      REFRESH_SYSTEM,
      [`Current arc:\n${renderArcForPrompt(arc)}`, worldArcLines, chapterLines, fallenLine]
        .filter(Boolean)
        .join("\n\n"),
      "arc refresh",
    );
    const delta = raw === null ? null : parseArcDeltaJson(raw);
    if (raw !== null && !delta && process.env.DM_DEBUG) {
      console.log("[dm-debug] arc refresh: unparseable reply:", raw.slice(0, 500));
    }
    let next = delta ? applyArcDelta(arc, delta) : arc;
    // Whether the plan ahead still fits never waits on the delta either.
    next = await changeCourse(campaignId, next, closedChapter, fallenLine);
    // Planning the next act never waits on the refresh delta: an
    // unparseable delta on a finished act used to leave the arc exhausted,
    // and every chapter after that closed at the floor as a retry.
    next = await planNextAct(campaignId, next);
    next = await announceActs(campaignId, campaign.storyArc, next, Boolean(options.endAnnounced));
    if (delta) {
      // Replenish the off-screen clocks only when none are live (so at most
      // once per act in practice); no-op while any world arc still ticks.
      next = await ensureWorldArcs(campaignId, next);
    }
    if (next !== campaign.storyArc) {
      storeArc(campaignId, next, campaign.storyArc);
    }
  } catch (error) {
    console.error(`[arc] campaign ${campaignId}: the story arc could not be refreshed`, error);
  } finally {
    setDmStatus(campaignId, "idle");
  }
}

// An exhausted arc gets its next stretch of plot: the sequel saga when the
// whole saga is played out, the next sketched act when one is waiting, or
// a whole-act extension for a saga-less arc whose upgrade has not landed.
// Returns the arc unchanged when it still has open beats or planning fails.
async function planNextAct(campaignId: string, arc: StoryArc): Promise<StoryArc> {
  if (!arcExhausted(arc)) {
    return arc;
  }
  if (sagaComplete(arc)) {
    return chainSaga(campaignId, arc);
  }
  if (nextSketchAct(arc)) {
    return detailNextAct(campaignId, arc);
  }
  if (needsSagaUpgrade(arc)) {
    return extendStoryArc(campaignId, arc);
  }
  return arc;
}

// Mid-chapter retry of the planning that failed at the last chapter close
// (chapter-close.ts). A chapter that opens on an exhausted arc plans in
// place rather than closing again to reach refreshStoryArc, so a flaky arc
// model no longer produces a run of stub chapters. Returns true when the
// arc has a [NOW] beat again.
export async function planExhaustedArc(campaignId: string): Promise<boolean> {
  try {
    const campaign = getCampaignById(campaignId);
    if (
      !campaign?.storyArc ||
      !narratorIsAi(campaign.gameSettings.dmMode) ||
      !arcExhausted(campaign.storyArc)
    ) {
      return false;
    }
    setDmStatus(campaignId, "plotting_arc");
    let next = await planNextAct(campaignId, campaign.storyArc);
    if (next === campaign.storyArc || arcExhausted(next)) {
      return false;
    }
    next = await announceActs(campaignId, campaign.storyArc, next, true);
    storeArc(campaignId, next, campaign.storyArc);
    return true;
  } catch (error) {
    console.error(`[arc] campaign ${campaignId}: the next stretch of the arc could not be planned`, error);
    return false;
  } finally {
    setDmStatus(campaignId, "idle");
  }
}

// ---- Acts, as the table hears them (issue #31) ----

// The players never saw acts change: only "Chapter N" cards, while the
// act structure lived in the DM's secret arc. When a refresh or a
// mid-chapter plan finishes an act, the table gets an "End of Act" card and
// a spoiler-free recap in the log; when the next act has beats, an "Act N"
// card names it. Returns the arc with the recap recorded so the story tab,
// timeline and exports can show the saga's shape. `endAnnounced` means
// chapter-close.ts already put the end card up (the arc was exhausted at
// the close, so it knew before any model call).
async function announceActs(
  campaignId: string,
  before: StoryArc,
  after: StoryArc,
  endAnnounced: boolean,
): Promise<StoryArc> {
  const transition = actTransition(before, after);
  let next = after;
  if (transition.ended) {
    const ended = transition.ended;
    const written = await writeActRecap(campaignId, ended);
    next = recordActRecap(next, {
      act: ended.act,
      sagaIndex: ended.sagaIndex,
      title: written.title,
      recap: written.recap,
    });
    if (!endAnnounced) {
      publishActEndCard(campaignId, ended.act, written.title);
    }
    const numeral = romanNumeral(ended.act);
    const named = written.title ? `, "${written.title}",` : "";
    noteAtTable(
      campaignId,
      ended.sagaEnded && ended.sagaTitle
        ? `Act ${numeral}${named} comes to a close, and with it the saga of "${ended.sagaTitle}". ${written.recap}`
        : `Act ${numeral}${named} comes to a close. ${written.recap}`,
    );
  }
  if (transition.began) {
    const began = transition.began;
    publishTitleCard(campaignId, {
      title: `Act ${romanNumeral(began.act)}`,
      ...(began.title ? { subtitle: began.title } : {}),
      tone: "act",
    });
    noteAtTable(
      campaignId,
      `Act ${romanNumeral(began.act)}${began.title ? `, "${began.title}",` : ""} begins${
        began.act === 1 && began.sagaTitle ? `: the saga of "${began.sagaTitle}"` : ""
      }.`,
    );
  }
  return next;
}

// The "End of Act" card. Exported for chapter-close.ts, which shows it
// before the refresh when the arc is already exhausted at the close.
export function publishActEndCard(campaignId: string, act: number, title: string) {
  publishTitleCard(campaignId, {
    title: `End of Act ${romanNumeral(act)}`,
    ...(title ? { subtitle: title } : {}),
    tone: "act",
  });
}

const ACT_RECAP_SYSTEM = `You are closing an act of an ongoing D&D 5e campaign for the PLAYERS. Return STRICT JSON only, no code fences, shaped: {"title": string, "recap": string}. title: an evocative, spoiler-free name for the act that just ended, two to five words, no surrounding quotes. recap: two to four sentences in the past tense, addressed to the party as "you", covering only what the party witnessed and did: never hidden plans, secret motives, or what lies ahead.`;

// One small call per act. Any failure falls back to the chapters' own
// highlights so the card and the log never wait on the model.
async function writeActRecap(
  campaignId: string,
  ended: { act: number; sagaIndex: number; title: string; resolution: string },
): Promise<{ title: string; recap: string }> {
  const campaign = getCampaignById(campaignId);
  const closed = listChapters(campaignId).filter((chapter) => chapter.status === "closed");
  const own = closed.filter(
    (chapter) => chapter.act === ended.act && (chapter.saga ?? 1) === ended.sagaIndex,
  );
  // Chapters sealed before acts were stamped carry no act: the last few
  // closed chapters stand in for them.
  const pool = own.length ? own : closed.slice(-6);
  const fallback = {
    title: ended.title || "",
    recap:
      ended.resolution ||
      pool
        .map((chapter) => chapter.highlights[0])
        .filter(Boolean)
        .slice(-4)
        .join(" ") ||
      "The act came to a close.",
  };
  if (
    !campaign ||
    !pool.length ||
    !isStageEnabled(campaign.gameSettings.stages, "chapterSummary")
  ) {
    return fallback;
  }
  const source = pool
    .map(
      (chapter) =>
        `Chapter ${chapter.index}: ${chapter.title || "Untitled"}\n${
          chapter.summary || chapter.highlights.join(" ")
        }`,
    )
    .join("\n\n")
    .slice(-12_000);
  try {
    const { message, error } = await trackUtilityCall(campaignId, "act", () =>
      requestUtilityMessage(
        campaign.settings,
        [
          { role: "system", content: withLanguage(ACT_RECAP_SYSTEM, campaign.gameSettings.tableLanguage) },
          {
            role: "user",
            content: `Act ${romanNumeral(ended.act)}${ended.title ? ` ("${ended.title}")` : ""} has just ended.${
              ended.resolution ? ` How it ended: ${ended.resolution}` : ""
            }\n\nIts chapters:\n${source}`,
          },
        ],
        { meta: { task: "act_recap" }, timeoutMs: arcTextTimeoutMs() },
      ),
    );
    if (error) {
      return fallback;
    }
    const parsed = parseActRecapJson(
      stripReasoningArtifacts(typeof message?.content === "string" ? message.content : ""),
    );
    return { title: parsed.title || fallback.title, recap: parsed.recap || fallback.recap };
  } catch {
    return fallback;
  }
}

function noteAtTable(campaignId: string, content: string) {
  const seq = tableNoteSeq(campaignId);
  const message = insertCampaignMessage({ campaignId, seq, authorType: "system", glyph: "cue-bell", content });
  publishWithSeq(campaignId, seq, "message_added", { message });
}
