import { currentUser } from "@/lib/auth";
import { unauthorized } from "@/lib/auth";
import { assessModel, findCatalogModel, providerForBaseUrl } from "@/lib/model-registry/catalog-logic";
import { translate } from "@/lib/messages-logic";

// English-bound: the verdict's words are rules for now; the picker words
// what it shows around them.
const enT = (key: string, vars?: Record<string, string | number>) => translate("en", key, vars);
import { modelCatalog } from "@/lib/model-registry/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What the catalog says of one model, for a campaign's Story AI panel:
// its window and abilities, and whether it can do the role's work. Catalog
// only: no backend is asked and no key is involved, so any signed-in
// player may ask about the model their table runs on.
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const url = new URL(request.url);
  const model = (url.searchParams.get("model") ?? "").trim().slice(0, 200);
  const baseUrl = (url.searchParams.get("baseUrl") ?? "").trim().slice(0, 500);
  const roleParam = url.searchParams.get("role");
  const role = roleParam === "utility" || roleParam === "image" ? roleParam : "story";
  if (!model) {
    return Response.json({ error: "Name the model." }, { status: 400 });
  }
  const { providers } = modelCatalog();
  const catalog = findCatalogModel(providers, model, providerForBaseUrl(baseUrl, providers));
  return Response.json({ model, catalog, verdict: assessModel(enT, { role, id: model, catalog, listed: null }) });
}
