import { z } from "zod";
import { capsFor, isErrorResponse, requireMember } from "@/lib/campaign-api";
import { previewBuiltJoin, previewLibraryJoin, previewPregenJoin, type JoinPreview } from "@/lib/characters/seat-preview";
import { companionRoleRefusal, getCharacterForUser } from "@/lib/db/characters";
import { heroFell } from "@/lib/characters/fallen-logic";
import { heroDoorFor } from "@/lib/characters/hero-door";
import { getSheetForUser, listSheetsForUser } from "@/lib/db/sheets";
import { createSheetSchema } from "@/lib/schemas/sheet";
import { olderBuilderOf } from "@/lib/srd/legality/older-builder";
import { pregenById } from "@/lib/starter/pregens";
import { seatPicksSchema } from "@/lib/characters/seat-picks";
import { bookLocaleOf } from "@/lib/rulebook/book";
import { translate, type Locale } from "@/lib/messages-logic";
import { claimRefusal, offeredPregenFor, pregenSeatRefusal } from "@/lib/db/pregen-offers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const previewSchema = z
  .object({
    libraryCharacterId: z.string().min(1).max(80).optional(),
    pregenId: z.string().trim().min(1).max(40).optional(),
    // A pregen the table's DM offers its players (src/lib/db/pregen-offers.ts).
    offeredPregenId: z.string().trim().min(1).max(80).optional(),
    // A character the builder just made for this table ("Help me build" on
    // the hero chooser), judged as POST or PUT /sheet would judge it.
    sheet: createSheetSchema.optional(),
    // join = a first seat (POST /sheet); replace = a lobby switch (PUT
    // /sheet), which gives up the current character first.
    flow: z.enum(["join", "replace"]).default("join"),
    // The owed choices picked on the sheet (src/lib/characters/seat-picks.ts),
    // judged as the join will judge them.
    picks: seatPicksSchema.optional(),
  })
  .refine((body) => [body.libraryCharacterId, body.pregenId, body.offeredPregenId, body.sheet].filter(Boolean).length === 1, {
    message: "Pick one hero.",
  });

// The confirm sheet before a hero takes its seat (backlog F6): the hero at
// the table's level, what joining changes, and the table's rules check, by
// the same code the join runs (src/lib/characters/seat-preview.ts). Nothing
// is stored and no roll is spent; the join itself is still POST or PUT
// /sheet, or POST /sheet/pregen, and checks again.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  // The confirm sheet reads the asker's language: the sentences the route
  // words itself and the ones the shared builders word for it.
  const locale: Locale = bookLocaleOf(request);
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  if (!capsFor(context).needsCharacter) {
    return Response.json({ error: t("The GM seat plays no character.") }, { status: 400 });
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = previewSchema.safeParse(raw);
  if (!parsed.success) {
    // The schema's own message is the English sentence; the route's words
    // follow the asker's language.
    const firstIssue = parsed.error.issues[0]?.message;
    const message = firstIssue === "Pick one hero." ? t("Pick one hero.") : firstIssue || t("Pick a hero.");
    return Response.json({ error: message }, { status: 400 });
  }
  const { libraryCharacterId, pregenId, offeredPregenId, sheet, flow, picks } = parsed.data;
  // A first seat is judged at the level it joins at: a fallen hero's
  // replacement at the level they reached (src/lib/characters/hero-door.ts).
  // A lobby switch is the table's own level, as PUT /sheet seats it.
  const door = heroDoorFor(context.campaign, context.user.id);
  const seatCampaign = flow === "join" ? door.campaign : context.campaign;
  let fallenPick = "";

  let preview: JoinPreview;
  let alreadyHere = false;
  if (libraryCharacterId) {
    const character = getCharacterForUser(context.user.id, libraryCharacterId);
    if (!character) {
      return Response.json({ error: t("Character not found in your library.") }, { status: 404 });
    }
    if (character.role === "companion") {
      return Response.json({ error: companionRoleRefusal(character, t) }, { status: 400 });
    }
    preview = previewLibraryJoin(character, seatCampaign, context.user.id, picks, t, locale);
    // A hero already at this table is selected again, not copied twice
    // (instantiateIntoCampaign), so a join changes nothing about it.
    const here = listSheetsForUser(campaignId, context.user.id).find(
      (sheet) => sheet.libraryCharacterId === character.id && !sheet.isCompanion,
    );
    // A fallen hero is not picked again: the sheet answers with the refusal
    // alone, not "already at this table" beside it.
    alreadyHere = here !== undefined && !heroFell(here);
    if (here && heroFell(here)) {
      fallenPick = t("{name} fell at this table. Bring in someone else.", { name: here.name });
    }
    // A copy of a DM's offered pregen does not sit where another sheet plays
    // that pregen (src/lib/db/pregen-offers.ts), as the join will say. A lobby
    // switch gives up the current sheet first, which holds nothing then.
    const replacing = flow === "replace" ? (getSheetForUser(campaignId, context.user.id)?.id ?? "") : "";
    const held = here ? null : pregenSeatRefusal(campaignId, character, context.user.id, replacing, t);
    if (held) {
      preview = { ...preview, ok: false, problems: [held, ...preview.problems] };
    }
  } else if (sheet) {
    preview = previewBuiltJoin(sheet, seatCampaign, context.user.id, olderBuilderOf((raw as { sheet?: unknown } | null)?.sheet), t, locale);
  } else if (offeredPregenId) {
    // Unticked, another table's, or not a pregen at all: no such hero. The
    // DM's own pregens are in their library already.
    const offer = offeredPregenFor(campaignId, offeredPregenId);
    if (!offer || offer.character.userId === context.user.id) {
      return Response.json({ error: t("No such hero.") }, { status: 404 });
    }
    preview = previewLibraryJoin(offer.character, seatCampaign, context.user.id, picks, t, locale);
    const refusals = [
      ...(flow !== "join" ? [t("A pregen the GM offers takes a first seat; a lobby switch is to one of your own heroes.")] : []),
      ...[claimRefusal(offer, context.user.id, t)].filter((line): line is string => Boolean(line)),
    ];
    if (refusals.length) {
      preview = { ...preview, ok: false, problems: [...refusals, ...preview.problems] };
    }
  } else {
    const pregen = pregenById(pregenId ?? "", locale);
    if (!pregen) {
      return Response.json({ error: t("No such hero.") }, { status: 404 });
    }
    preview = previewPregenJoin(pregen, seatCampaign, context.user.id, picks, t, locale);
  }

  // The door rules the join answers with before it reads the sheet, so the
  // sheet does not offer a seat the join will refuse.
  if (fallenPick) {
    // Nothing about joining applies to a hero who cannot join: no changes,
    // no picks, no other rule, only why not.
    preview = { ...preview, ok: false, problems: [fallenPick], changes: [], owed: [], rollsHp: false, picks: undefined };
    return Response.json({ preview: { ...preview, alreadyHere } });
  }
  const doorProblems: string[] = [];
  if (flow === "join" && !alreadyHere && !door.open) {
    doorProblems.push(t("You already have a character in this campaign."));
  }
  if (flow === "replace" && context.campaign.status !== "lobby") {
    doorProblems.push(t("Characters can only be changed in the lobby."));
  }
  if (doorProblems.length) {
    preview = { ...preview, ok: false, problems: [...doorProblems, ...preview.problems] };
  }
  return Response.json({ preview: { ...preview, alreadyHere } });
}
