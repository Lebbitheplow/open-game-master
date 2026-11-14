import { currentUser, unauthorized } from "@/lib/auth";
import { bookLocaleOf, rulebookContents } from "@/lib/rulebook/book";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/rulebook: the rulebook's contents (chapters, every page's title
// and folio, the quick links). No page text; that comes a page at a time.
// The book reads the request's language (the reader sends its locale in
// Accept-Language); Vary keeps a cached French answer out of an English ask.
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  return Response.json(rulebookContents(bookLocaleOf(request)), {
    headers: { "Cache-Control": "private, max-age=300", Vary: "Accept-Language" },
  });
}
