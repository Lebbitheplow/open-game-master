import { z } from "zod";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { adminAddonsState, installedResponse } from "@/lib/addons/admin-view";
import { installFromGitHub, installFromRegistry } from "@/lib/addons/install";
import { addonRegistryUrl, fetchAddonRegistry } from "@/lib/addons/registry";
import { readAddonConfig, updateAddonConfig } from "@/lib/addons/store";
import { addonSupport } from "@/lib/addons/support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The addon manager behind Admin > Addons.
//
// GET: installed addons, the catalog, and the server-wide switches.
// POST { do: "install", addonId, parts? }: install or update from the addon
//   list. What is downloaded (the author's repository at the audited
//   commit, checked against the entry's content hash) comes from the list,
//   never from the request; `parts` picks which of its parts setup fetches
//   (left out, the author's defaults, or what an update had before).
// POST { do: "install-github", url }: install from a GitHub link (a
//   repository, a release, or a folder at a branch). Unreviewed, so only
//   with "Install addons from files and links" on.
// POST { do: "config", registryUrl?, allowFiles? }: the catalog address and
//   whether an admin may install an unreviewed .zip or link.
//
// An install whose addon is already switched on starts its setup when one
// is due; the task's id comes back as setupTask. An install over a copy of
// the same id from somewhere else answers 409 with `replaces` until it is
// sent again with replace: true.
//
// Admin-only: every one of these writes programs onto the server.

const bodySchema = z.discriminatedUnion("do", [
  z.object({
    do: z.literal("install"),
    addonId: z.string().min(1).max(60),
    replace: z.boolean().optional(),
    parts: z.array(z.string().min(1).max(40)).max(30).optional(),
  }),
  z.object({ do: z.literal("install-github"), url: z.string().trim().min(3).max(500), replace: z.boolean().optional() }),
  z.object({
    do: z.literal("config"),
    registryUrl: z.string().trim().max(500).optional(),
    allowFiles: z.boolean().optional(),
  }),
]);

export async function GET() {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  return Response.json(await adminAddonsState());
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Send do: install, do: install-github or do: config." }, { status: 400 });
  }
  const body = parsed.data;
  if (body.do === "config") {
    if (body.registryUrl && body.registryUrl.toLowerCase() !== "off" && !/^https:\/\//i.test(body.registryUrl)) {
      return Response.json({ error: "A catalog address starts with https://, or is off." }, { status: 400 });
    }
    updateAddonConfig((config) => {
      if (body.registryUrl !== undefined) config.registryUrl = body.registryUrl;
      if (body.allowFiles !== undefined) config.allowFiles = body.allowFiles;
    });
    return Response.json(await adminAddonsState());
  }
  const support = addonSupport();
  if (!support.supported) {
    return Response.json({ error: support.reason }, { status: 400 });
  }
  if (body.do === "install-github") {
    if (!readAddonConfig().allowFiles) {
      return Response.json({ error: "Installing addons from links is switched off. Switch on \"Install addons from files and links\" first." }, { status: 403 });
    }
    return installedResponse(await installFromGitHub(body.url, { replace: body.replace }), admin);
  }
  const url = addonRegistryUrl();
  if (!url) {
    return Response.json({ error: "This server has its addon catalog turned off." }, { status: 400 });
  }
  const catalog = await fetchAddonRegistry(url);
  if (!catalog.ok) {
    return Response.json({ error: catalog.error }, { status: 502 });
  }
  const entry = catalog.addons.find((candidate) => candidate.id === body.addonId);
  if (!entry) {
    return Response.json({ error: "The catalog does not list that addon." }, { status: 404 });
  }
  const unknown = (body.parts ?? []).find((partId) => !entry.parts.some((part) => part.id === partId));
  if (unknown) {
    return Response.json({ error: `${entry.name} has no part "${unknown}".` }, { status: 400 });
  }
  return installedResponse(await installFromRegistry(entry, { replace: body.replace, parts: body.parts }), admin);
}
