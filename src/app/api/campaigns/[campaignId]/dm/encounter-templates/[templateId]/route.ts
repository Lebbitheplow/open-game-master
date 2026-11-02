import { z } from "zod";
import { isErrorResponse, requirePrepAuthority } from "@/lib/campaign-api";
import {
  deleteEncounterTemplate,
  getEncounterTemplate,
  getTemplateSetup,
  updateEncounterTemplate,
} from "@/lib/db/encounter-templates";
import { fitSetupToRoster } from "@/lib/workshop/fight-setup-logic";
import {
  checkRoster,
  expandRoster,
  normalizeTemplateExtras,
  normalizeTemplateMap,
  parseRoster,
  rosterSize,
  TEMPLATE_HINT_MAX,
  TEMPLATE_NAME_MAX,
  TEMPLATE_NOTES_MAX,
} from "@/lib/dm/encounter-template-logic";
import { templateDifficulty } from "@/lib/dm/encounter-templates";
import { EVENTS_REFUSAL, EXTRAS_INPUT, eventsUnreadable } from "@/lib/dm/fight-event-logic";
import { fitPlanToMap } from "@/lib/dm/fight-ground";
import { getPreparedMap } from "@/lib/db/prepared-maps";
import { MAP_THEMES } from "@/lib/battlemap/generate";
import { sceneIds } from "@/lib/ambience/catalog";
import { layOver } from "@/lib/schemas/parse-keeping-valid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(TEMPLATE_NAME_MAX).optional(),
  enemies: z.string().trim().max(2_000).optional(),
  battlefield: z.string().trim().max(TEMPLATE_HINT_MAX).optional(),
  notes: z.string().trim().max(TEMPLATE_NOTES_MAX).optional(),
  map: z.unknown().optional(),
  // Its events are checked here (fight-event-logic.ts): an action of a
  // kind no event has, a die or a result, is refused, not dropped.
  extras: EXTRAS_INPUT.optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; templateId: string }> },
) {
  const { campaignId, templateId } = await params;
  const context = await requirePrepAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const template = getEncounterTemplate(templateId);
  // The id comes from the URL, so the campaign check is what stops one
  // campaign's id being used to edit another's.
  if (!template || template.campaignId !== campaignId) {
    return Response.json({ error: "No such prepared encounter." }, { status: 404 });
  }
  const body: unknown = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: eventsUnreadable(body) ? EVENTS_REFUSAL : "Invalid edit." },
      { status: 400 },
    );
  }
  let enemies = template.enemies;
  if (parsed.data.enemies !== undefined) {
    const roster = checkRoster(parseRoster(parsed.data.enemies));
    if ("error" in roster) {
      return Response.json({ error: roster.error }, { status: 400 });
    }
    enemies = roster.rows;
  }
  // A map sent in part is laid over the stored one: the prep panel edits
  // only the prepared map's id, and a theme, seed or size set another way
  // (the API, an import) is not the panel's to clear. A null clears it all.
  const map =
    parsed.data.map === undefined
      ? template.map
      : normalizeTemplateMap(layOver(template.map, parsed.data.map), {
          themes: MAP_THEMES,
          ambients: ["bright", "dim", "dark"],
          scenes: sceneIds(),
        });
  // Same drawer check the create route makes; the normalizer is pure and
  // only shape-checks the id.
  if (parsed.data.map !== undefined && map.mapId && !getPreparedMap(campaignId, map.mapId)) {
    return Response.json(
      { error: "That prepared map is not in this campaign's drawer." },
      { status: 400 },
    );
  }
  // Re-fitted to the roster either way: a roster that shrank takes the
  // placements past its end with it. And to the map: a change of ground
  // goes with a map unlinked, and keeps only the squares a new one has.
  const extras = fitPlanToMap(
    campaignId,
    normalizeTemplateExtras(parsed.data.extras === undefined ? template.extras : parsed.data.extras, rosterSize(enemies)),
    map.mapId,
  );
  // A saved set-up keeps the foes the new roster still has, by kind and
  // number (updateEncounterTemplate fits it); the author is told which
  // creatures' saved state the edit let go.
  const setup = getTemplateSetup(templateId);
  const dropped = setup ? fitSetupToRoster(setup, expandRoster(template.enemies), expandRoster(enemies)).dropped : [];
  const updated = updateEncounterTemplate(templateId, {
    name: parsed.data.name ?? template.name,
    enemies,
    battlefield: parsed.data.battlefield ?? template.battlefield,
    map,
    notes: parsed.data.notes ?? template.notes,
    extras,
  });
  return Response.json({
    template: updated
      ? { ...updated, readout: templateDifficulty(context.campaign, updated.enemies) }
      : null,
    ...(dropped.length
      ? { setupNote: `Saved. Its set-up no longer holds ${dropped.join(", ")}: the roster has no such creature now. The rest of the set-up is kept.` }
      : {}),
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; templateId: string }> },
) {
  const { campaignId, templateId } = await params;
  const context = await requirePrepAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const template = getEncounterTemplate(templateId);
  if (!template || template.campaignId !== campaignId) {
    return Response.json({ error: "No such prepared encounter." }, { status: 404 });
  }
  deleteEncounterTemplate(templateId);
  return Response.json({ ok: true });
}
