import type { Campaign } from "@/lib/db/campaigns";
import { getTemplateSetup, listEncounterTemplates, setTemplateCued, type EncounterTemplate } from "@/lib/db/encounter-templates";
import { layFightSetup } from "@/lib/workshop/fight-setup";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getPreparedMap } from "@/lib/db/prepared-maps";
import { describeExtras, formatRoster, rosterSummary, savedMapNote } from "@/lib/dm/encounter-template-logic";
import { preparedFit } from "@/lib/dm/prepared-fit";
import { fightingParty } from "@/lib/dm/party-budget";
import { atTheFight, resolveAwayNames, withFollowers } from "@/lib/dm/fight-away-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { applyTemplateExtras, applyTemplateMap } from "@/lib/dm/template-apply";
import { firedEventsBlock, firedEventsNote } from "@/lib/dm/fight-events";
import type { ToolDef } from "@/lib/dm/encounter-tool-defs";
import { BUILDING_SIDES, MAX_OPENINGS } from "@/lib/battlemap/building";
import { openingOptionsFrom, preparedOpening } from "@/lib/dm/fight-opening";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { findNamed } from "@/lib/language/text-logic";
import { recordTurnChange } from "@/lib/db/turn-changes";
import { currentTurnId, owningTurnOf } from "@/lib/dm/job-control";

// The prepared fights, offered to the AI storyteller (#154).
//
// A DM at a table a person runs deploys a prepared fight from the console.
// At an AI-narrated table the storyteller runs the fights, and until now it
// could not see the prepared ones at all: its prompt never listed them and
// start_encounter takes a roster, not a name. So a workshop's fights,
// imported with their maps and plans, sat in a drawer the narrator could not
// open. This module is the drawer handle: the prepared fights appear in the
// storyteller's game state, and run_prepared_encounter starts one by name
// through the same start_encounter the model already uses, then lays down
// the fight's saved map and the rest of its plan exactly as a DM's Deploy
// does (src/lib/dm/template-apply.ts).
//
// The lead of an AI table cues one from the lead's desk
// (src/app/api/campaigns/[campaignId]/dm/encounter-templates/[templateId]/
// deploy/route.ts): a flag on the fight, listed first and marked in the
// storyteller's game state until it runs. A flag rather than a lead
// direction, because a direction is posted in the transcript and the name
// of the fight waiting for the party is exactly what the players must not
// read. A storyboard fight card arrives as a beat whose waypoint names the
// same fight.

export const RUN_PREPARED_ENCOUNTER = "run_prepared_encounter";

// At most this many are listed, newest work first by name order; a longer
// drawer is still reachable by name.
const LISTED = 8;

// The fights the storyteller can run: the ones with a roster. A placeholder
// a storyboard card made (no monsters yet) is the DM's to finish first.
export function readyTemplates(campaignId: string): EncounterTemplate[] {
  return listEncounterTemplates(campaignId).filter((template) =>
    template.enemies.some((row) => typeof row.monster === "string" && row.monster.trim()),
  );
}

export function preparedEncounterTools(campaign: Campaign): ToolDef[] {
  return readyTemplates(campaign.id).length ? [runPreparedEncounterTool] : [];
}

export const runPreparedEncounterTool: ToolDef = {
  type: "function",
  function: {
    name: RUN_PREPARED_ENCOUNTER,
    description:
      "Start one of the PREPARED FIGHTS listed in GAME STATE by its name, instead of start_encounter, when the scene reaches it. The server fills in its roster, lays out its saved battle map and opening positions, and notes what it is worth; you narrate the fight as usual.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", description: "The prepared fight's name, exactly as listed." },
        ambush: {
          type: "string",
          enum: ["enemies", "party"],
          description: "Who was lying in wait, as for start_encounter.",
        },
        surprised: {
          type: "string",
          enum: ["none", "enemies", "party"],
          description: "A whole side caught off guard, as for start_encounter.",
        },
        distanceFeet: {
          type: "integer",
          minimum: 5,
          description: "How far the nearest enemy stands as it opens, when the story has said.",
        },
        absent: {
          type: "array",
          items: { type: "string" },
          description: "Those not at it, as for start_encounter.",
        },
        // The ground, lair and edge when the fight has none of its own (WAVE1
        // ruling R9). Measured: the three cost 46 tokens of the compact set
        // (331 to 377 for this tool, scripts/test-prompt-window.mjs and
        // test-tool-profiles.mjs pass); scene's id list would cost 100 more,
        // and start_encounter checks the id.
        scene: { type: "string", description: "start_encounter's scene, if the fight has no ground of its own." },
        lair: { type: "boolean" },
        from: { type: "string", enum: ["ahead", "behind"] },
        building: {
          type: "object",
          description: "Party inside a building, as for start_encounter. A fight with its own saved map or positions keeps them.",
          properties: {
            enemySide: { type: "string", enum: [...BUILDING_SIDES] },
            openings: { type: "integer", maximum: MAX_OPENINGS },
          },
          required: ["enemySide"],
        },
      },
      required: ["name"],
    },
  },
};

// The block in GAME STATE. Empty when there is nothing to run, so a table
// without prep pays nothing for this. While a fight is on it holds what that
// fight's prepared events have done instead (src/lib/dm/fight-events.ts),
// empty until one has.
export function preparedFightsBlock(campaign: Campaign): string {
  if (getActiveEncounter(campaign.id)) {
    return firedEventsBlock(campaign.id);
  }
  const ready = readyTemplates(campaign.id);
  if (!ready.length) {
    return "";
  }
  // Cued fights first: the lead asked for those.
  const ordered = [...ready.filter((template) => template.cued), ...ready.filter((template) => !template.cued)];
  const lines = ordered.slice(0, LISTED).map((template) => {
    const map = template.map.mapId ? getPreparedMap(campaign.id, template.map.mapId)?.name : "";
    const plan = describeExtras(template.extras, template.enemies)[0] ?? "";
    const note = template.notes.split("\n")[0]?.trim().slice(0, 120) ?? "";
    return `- ${template.cued ? "[CUED by the party lead: run this one as soon as the scene allows] " : ""}${template.name}: ${formatRoster(template.enemies)}${template.battlefield ? ` | ${template.battlefield.slice(0, 100)}` : ""}${map ? ` | on the map "${map}"` : ""}${note ? ` | ${note}` : ""}${plan ? ` | ${plan.slice(0, 100)}` : ""}`;
  });
  const more = ready.length > LISTED ? `\n(${ready.length - LISTED} more are prepared; run any by its exact name.)` : "";
  return `Prepared fights (secret; the table's prep. When the story reaches one, start it with ${RUN_PREPARED_ENCOUNTER} rather than inventing a roster):\n${lines.join("\n")}${more}`;
}

// The sheets an `absent` names with what goes with them, read as
// start_encounter reads it; none when it names nobody it can place, which
// start_encounter then refuses.
function awayIdsAsked(absent: unknown, party: CharacterSheet[]): string[] {
  const names = typeof absent === "string" ? [absent] : Array.isArray(absent) ? absent.filter((name): name is string => typeof name === "string") : [];
  const away = names.length ? resolveAwayNames(names, party) : null;
  return away && "ids" in away ? withFollowers(away.ids, party) : [];
}

function findTemplate(campaignId: string, name: string): EncounterTemplate | null {
  return findNamed(readyTemplates(campaignId), name, (template) => [template.name]);
}

// Starts the named fight through `start` (start_encounter as the
// encounter tools run it), then lays down its map and plan. A fight beyond
// the party as it stands runs cut down to fit (src/lib/dm/prepared-fit.ts),
// and one beyond it even cut down is held; either way the result says so in
// words run_prepared_encounter can act on, since "use fewer enemies" is not
// something it can do. A fight that cannot run for this party leaves the
// lead's cue, so the storyteller is not sent back to it every turn. Any
// other refusal from start_encounter (a fight already on) is returned as it
// came.
export function runPreparedEncounter(
  campaign: Campaign,
  rawArguments: string,
  start: (rawArguments: string) => Record<string, unknown>,
): ToolResult {
  // A weak tool caller sends null, an array or a bare string as often as an
  // object; each reads as no arguments and earns the refusal below.
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(rawArguments || "{}");
    args = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    args = {};
  }
  const template = findTemplate(campaign.id, typeof args.name === "string" ? args.name : "");
  if (!template) {
    const names = readyTemplates(campaign.id).map((entry) => entry.name);
    return {
      error: names.length
        ? `No prepared fight is called that. The prepared fights are: ${names.slice(0, 12).join(", ")}.`
        : "There are no prepared fights at this table; use start_encounter.",
      retry: true,
    };
  }
  // With nobody to fight it there is no party to fit it to: start_encounter
  // says so itself, as it does of a name in absent that fits nobody. The fit
  // is to who is at the fight: measured against someone away, it ran whole
  // and start_encounter refused it as too deadly, which this tool cannot cut.
  const party = fightingParty(campaign);
  const here = atTheFight({ awayIds: awayIdsAsked(args.absent, party) }, party);
  const fit = here.length ? preparedFit(campaign, template.enemies, here.map((sheet) => sheet.level)) : ({ kind: "fits" } as const);
  if (fit.kind === "unknown" || fit.kind === "held") {
    setTemplateCued(template.id, false);
    return {
      error:
        fit.kind === "unknown"
          ? `The prepared fight "${template.name}" names "${fit.monster}", which this world has no monster for; the party lead fixes it in their prep. Play the scene another way, or start_encounter a fight of your own.`
          : `The prepared fight "${template.name}" is beyond the party as it stands, even cut down to its strongest creature (difficulty ${campaign.difficulty}). It stays prepared for when they are stronger: play the scene another way, or start_encounter a smaller fight.`,
      retry: true,
    };
  }
  const roster = fit.kind === "scaled" ? fit.rows : template.enemies;
  // The opening options start_encounter takes, read as every door that
  // opens a fight reads them (fight-opening.ts): who is away (issue 740),
  // who lay in wait or is surprised, how far off, the ground, the lair, the
  // edge, and a building around the party (issue 743), left out when this
  // fight lays its own board.
  const asked = openingOptionsFrom(args);
  const opening = preparedOpening(template, roster, asked);
  const started = start(JSON.stringify(opening.args));
  if (typeof started.error === "string") {
    // A fight already on keeps the cue for when it ends; anything else
    // would refuse again next turn.
    if (!getActiveEncounter(campaign.id)) {
      setTemplateCued(template.id, false);
    }
    return started;
  }
  const mapError = applyTemplateMap(campaign, template);
  // The events that open the fight have happened by now; the model is told
  // so in the result, to narrate them.
  const opened = applyTemplateExtras(campaign, campaign.ownerUserId, template);
  // The foes as a test of the fight was saved to start (issue 685), as a
  // GM's Deploy lays them: after the opening events, since a saved moment
  // already holds what its own test's opening did.
  const setup = getTemplateSetup(template.id);
  if (setup) {
    layFightSetup(campaign, template, setup);
  }
  // The cue goes with the fight it began: "Revert this turn" takes the fight
  // away and cues the prepared fight again (turn-revert.ts). Before, the fight
  // went and the lead's cue stayed spent.
  const turnId = currentTurnId();
  if (template.cued && turnId) {
    recordTurnChange(campaign.id, owningTurnOf(turnId), "cue", { templateId: template.id });
  }
  setTemplateCued(template.id, false);
  // The plan rides back with the fight: what it is worth and when it
  // turns, so the storyteller can pay it out and play its phases.
  const plan = describeExtras(template.extras, template.enemies);
  return {
    ...started,
    prepared: template.name,
    ...(fit.kind === "scaled"
      ? { scaled: `As prepared it is beyond the party as it stands, so it runs without ${rosterSummary(fit.dropped)}. Narrate the fight that is here.` }
      : {}),
    ...(plan.length ? { plan } : {}),
    ...(opened.length ? { fightEvents: firedEventsNote(opened) } : {}),
    ...(mapError ? { mapNote: savedMapNote(mapError) } : {}),
    ...(opening.buildingLeftOut
      ? { building: "No building was drawn: this prepared fight lays out its own saved map and positions. Narrate the board as it stands." }
      : {}),
  };
}
