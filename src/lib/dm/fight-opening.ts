import { z } from "zod";
import { getTemplateSetup, type EncounterTemplate } from "@/lib/db/encounter-templates";
import { BUILDING_SIDES, MAX_OPENINGS, holdsBuilding } from "@/lib/battlemap/building";
import type { TemplateEnemy } from "@/lib/dm/encounter-template-logic";

// A fight's opening options, and the initiative ask, taken by every door that
// opens a fight: the console's start_encounter, the AI's start_encounter and
// run_prepared_encounter, the GM's Deploy of a prepared fight
// (dm/encounter-templates/[id]/deploy) and the engine's own opening when a
// companion turns on the party (encounter-tools.ts startFightAgainst, which
// asks initiative through fight-opening-ask.ts: kept apart, since this module
// is read by the prepared fights' tool and route, below encounter-tools).
//
// Each door used to say its own subset. The Deploy route read no body, so a
// GM who deployed "The Goblin Gate" could say neither who was away nor who
// was surprised (the whole party was staged, nobody was caught off guard);
// run_prepared_encounter took no ground, lair or edge; and a fight the engine
// opened at a table a person runs asked nobody for initiative, its "Now call
// request_roll" read by no model. A new opening option goes in
// OPENING_OPTIONS and preparedOpening below, and every door has it.
// scripts/test-enforce-sweep-doors-openings.mjs holds the doors to it.

// What a GM or the model may say as a fight opens, beside its roster: who is
// away, who lay in wait or is caught off guard, how far off the foes stand,
// the ground, a building around the party, a lair, the edge the foes come
// from. The shapes are start_encounter's own (encounter-tools.ts
// startArgsSchema checks them again).
export const openingOptionsSchema = z.object({
  absent: z.union([z.string().max(80), z.array(z.string().max(80)).max(12)]).optional(),
  ambush: z.enum(["enemies", "party"]).optional(),
  surprised: z.enum(["none", "enemies", "party"]).optional(),
  scene: z.string().max(40).optional(),
  distanceFeet: z.number().int().min(5).max(600).optional(),
  building: z
    .object({ enemySide: z.enum(BUILDING_SIDES), openings: z.number().int().min(1).max(MAX_OPENINGS).nullish() })
    .strict()
    .optional(),
  lair: z.boolean().optional(),
  from: z.enum(["ahead", "behind"]).optional(),
});

export type OpeningOptions = z.infer<typeof openingOptionsSchema>;

export const OPENING_OPTIONS = Object.keys(openingOptionsSchema.shape) as Array<keyof OpeningOptions>;

// The options a model's arguments name, as it sent them: start_encounter
// checks each (a building in the wrong shape is refused there rather than
// read as none, a weak caller's "none" for ambush read as none given), so
// what a door hands on is what start_encounter would have been told.
export function openingOptionsFrom(args: Record<string, unknown>): OpeningOptions {
  return Object.fromEntries(
    OPENING_OPTIONS.filter((name) => args[name] !== undefined && args[name] !== null).map((name) => [name, args[name]]),
  ) as OpeningOptions;
}

// Whether a prepared fight lays out its own board: a saved map, generator
// settings, opening positions, or a saved test's moment. A building asked
// for it would be drawn and then replaced, or have enemies set inside its
// walls, so it is left out (issue 743).
export function ownLayout(template: EncounterTemplate): boolean {
  const map = template.map;
  return (
    Boolean(map.mapId) ||
    [map.seed, map.theme, map.ambient, map.width, map.height].some((value) => value !== null) ||
    template.extras.placements.length > 0 ||
    Boolean(getTemplateSetup(template.id))
  );
}

// The start_encounter arguments for a prepared fight with the opening
// options its door was given. The fight's own ground is its word; a fight
// with none takes the ground asked (WAVE1 ruling R9: "run_prepared_encounter
// takes scene, lair and from when the template has none of its own"), and a
// building is drawn on open ground when that ground cannot hold one.
export function preparedOpening(
  template: EncounterTemplate,
  roster: TemplateEnemy[],
  asked: OpeningOptions,
): { args: Record<string, unknown>; buildingLeftOut: boolean } {
  const building = asked.building && !ownLayout(template) ? asked.building : undefined;
  const ground = template.map.scene || asked.scene || "";
  const scene = ground && !(building && !holdsBuilding(ground)) ? ground : undefined;
  const rest = Object.fromEntries(Object.entries(asked).filter(([name]) => name !== "building" && name !== "scene"));
  return {
    args: {
      enemies: roster,
      summary: template.notes.split("\n")[0]?.slice(0, 200) || template.name,
      ...rest,
      ...(scene ? { scene } : {}),
      ...(building ? { building } : {}),
    },
    buildingLeftOut: asked.building !== undefined && !building,
  };
}
