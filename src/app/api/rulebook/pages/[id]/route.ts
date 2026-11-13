import { currentUser, unauthorized } from "@/lib/auth";
import { bookLocaleOf, rulebookPage } from "@/lib/rulebook/book";
import { crosswalkFor } from "@/lib/rulebook/crosswalk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_ID = /^[a-z0-9-]{1,96}$/;

// GET /api/rulebook/pages/combat: one page's text, its chapter, and the
// pages either side of it — in the request's language (the reader sends its
// locale in Accept-Language; a page the French print lost falls back to its
// English page). The crosswalk speaks the request's language too: it names
// the screens as the app shows them (« Atelier », « Bestiaire »), the engine
// and tool names staying the protocol's English.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const { id } = await params;
  const locale = bookLocaleOf(request);
  const found = PAGE_ID.test(id) ? rulebookPage(id, locale) : null;
  if (!found) {
    return Response.json({ error: "No such page in the rulebook." }, { status: 404 });
  }
  const crosswalk = crosswalkFor(found.page, locale);
  return Response.json(
    crosswalk ? { ...found, crosswalk: { editor: crosswalk.editor, ...(crosswalk.catalogName ? { catalogName: crosswalk.catalogName } : {}), ...(crosswalk.classId ? { classId: crosswalk.classId } : {}), ...(crosswalk.template ? { template: crosswalk.template } : {}), support: crosswalk.support, where: crosswalk.where } } : found,
    { headers: { "Cache-Control": "private, max-age=300", Vary: "Accept-Language" } },
  );
}
