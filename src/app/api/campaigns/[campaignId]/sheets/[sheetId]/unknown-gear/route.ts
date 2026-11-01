import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { isTableGearName, tableAuthors } from "@/lib/db/homebrew";
import { getSheetById } from "@/lib/db/sheets";
import { listWorkshopsForUser } from "@/lib/db/workshops";
import { itemsWithoutStats } from "@/lib/homebrew/unknown-gear";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The items on a sheet the rules at this table have no stats for: loot the
// model named that no list holds. The lead's Adjust dialog offers to give
// one stats, which is a workshop item of the same name, written by whoever
// runs the table (hydrateHomebrewGear reads only their entries). So the
// answer says whether this reader is one of them, and which of their
// workshops the editor opens in.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; sheetId: string }> },
) {
  const { campaignId, sheetId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const sheet = getSheetById(sheetId);
  if (!sheet || sheet.campaignId !== campaignId) {
    return Response.json({ error: "Character not found." }, { status: 404 });
  }
  const canAuthor = tableAuthors(campaignId).includes(context.user.id);
  return Response.json({
    names: itemsWithoutStats(sheet.equipment, (name) => isTableGearName(campaignId, name)),
    canAuthor,
    workshopId: canAuthor ? (listWorkshopsForUser(context.user.id)[0]?.id ?? null) : null,
  });
}
