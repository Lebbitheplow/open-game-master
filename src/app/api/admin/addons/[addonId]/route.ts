import { z } from "zod";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { adminAddon, installedResponse } from "@/lib/addons/admin-view";
import { conflictsWith, findInstalledAddon, hostFacts, listInstalledAddons } from "@/lib/addons/installed";
import { partProblem } from "@/lib/addons/parts";
import { removeAddon, updateFromGitHub } from "@/lib/addons/install";
import { checkRequirements } from "@/lib/addons/requirements";
import { probeAddon, readAddonLog, runningAddonIds, stopAddon } from "@/lib/addons/runtime";
import { cancelSetup, partsEdit, settingsEdit, setupIfDue, startSetup } from "@/lib/addons/setup";
import { readAddonConfig, setAddonState } from "@/lib/addons/store";
import { taskView } from "@/lib/addons/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One installed addon, for the admin.
//
// GET: its state, its log, and whether the programs it needs are here.
// PATCH { enabled?, accept?, settings?, parts? }: switch it on (accepting
//   the permissions it asks for, all at once) or off, fill in its settings,
//   and choose its parts (a change makes its setup due: it fetches what was
//   added and removes what was left out).
//   It is stopped after any change; its next call starts it with the new
//   settings. Switching it on is refused while an addon it conflicts with is
//   on. A change to a setting its setup reads makes the setup due again.
//   Switching it on, or filling in what its setup waited for, starts its
//   setup when one is due (setupTask).
// POST { do: "test" }: start it and list its tools. { do: "stop" }: stop it.
//   { do: "setup" }: run its setup (again). { do: "cancel-setup" }.
//   { do: "update" }: a GitHub-installed addon to its newest release or
//   commit (a catalog addon updates through do: install on the list).
// DELETE: remove it and its data folder.

type Params = { params: Promise<{ addonId: string }> };

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  accept: z.array(z.string().max(40)).max(20).optional(),
  settings: z.record(z.string().max(40), z.union([z.string().max(4_000), z.number(), z.boolean()])).optional(),
  parts: z.array(z.string().min(1).max(40)).max(30).optional(),
});

const postSchema = z.object({ do: z.enum(["test", "stop", "setup", "cancel-setup", "update"]) });

export async function GET(_request: Request, { params }: Params) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) return admin;
  const { addonId } = await params;
  const addon = findInstalledAddon(addonId);
  if (!addon) return Response.json({ error: "That addon is not installed." }, { status: 404 });
  const requirements = addon.manifest ? await checkRequirements(addon.manifest, addon.state.settings) : [];
  return Response.json({
    addon: adminAddon(addon, new Set(runningAddonIds()), []),
    log: readAddonLog(addon.id),
    requirements,
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) return admin;
  const { addonId } = await params;
  const addon = findInstalledAddon(addonId);
  if (!addon) return Response.json({ error: "That addon is not installed." }, { status: 404 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid change." }, { status: 400 });
  const body = parsed.data;
  const patch: Parameters<typeof setAddonState>[1] = { source: addon.source };
  if (body.enabled === true) {
    if (!addon.manifest || ["broken", "missing-files", "unfit", "unsupported"].includes(addon.status)) {
      return Response.json({ error: addon.problem || "That addon cannot run here." }, { status: 409 });
    }
    const asked = addon.manifest.permissions;
    const accepted = new Set(body.accept ?? addon.state.granted);
    const missing = asked.filter((permission) => !accepted.has(permission));
    if (missing.length) {
      return Response.json(
        { error: "Accept the permissions it asks for to switch it on.", permissions: asked },
        { status: 409 },
      );
    }
    const clashes = conflictsWith(addon, listInstalledAddons());
    if (clashes.length) {
      const [first] = clashes;
      return Response.json(
        { error: `${addon.manifest.name} cannot run beside ${first.name}: ${first.reason.replace(/[.!?]?$/, ".")} Switch ${first.name} off first.`, conflicts: clashes },
        { status: 409 },
      );
    }
    patch.enabled = true;
    patch.granted = [...asked];
  } else if (body.enabled === false) {
    patch.enabled = false;
  }
  if (body.settings) {
    if (!addon.manifest) return Response.json({ error: "Its manifest does not read, so its settings cannot be checked." }, { status: 409 });
    const edited = settingsEdit({ ...addon, manifest: addon.manifest }, body.settings);
    if (!edited.ok) return Response.json({ error: edited.error }, { status: edited.status });
    Object.assign(patch, edited.patch);
  }
  if (body.parts) {
    if (!addon.manifest) return Response.json({ error: "Its manifest does not read, so its parts cannot be checked." }, { status: 409 });
    const withManifest = { ...addon, manifest: addon.manifest };
    const facts = hostFacts();
    const edited = partsEdit(withManifest, body.parts, (partId) => partProblem(withManifest, partId, `${facts.platform}-${facts.arch}`));
    if (!edited.ok) return Response.json({ error: edited.error }, { status: edited.status });
    Object.assign(patch, edited.patch);
  }
  setAddonState(addon.id, patch);
  await stopAddon(addon.id);
  const switchedOn = body.enabled === true || (body.enabled === undefined && addon.state.enabled);
  const setupTask = switchedOn ? await setupIfDue(addon.id, admin) : "";
  const fresh = findInstalledAddon(addon.id);
  return Response.json({ addon: fresh ? adminAddon(fresh, new Set(runningAddonIds()), []) : null, setupTask });
}

export async function POST(request: Request, { params }: Params) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) return admin;
  const { addonId } = await params;
  const parsed = postSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Send do: test, stop, setup, cancel-setup or update." }, { status: 400 });
  const body = parsed.data;
  if (body.do === "stop") {
    await stopAddon(addonId);
    return Response.json({ ok: true });
  }
  if (body.do === "test") {
    const result = await probeAddon(addonId);
    return Response.json({ ...result, log: readAddonLog(addonId) }, { status: result.ok ? 200 : 409 });
  }
  if (body.do === "setup") {
    const started = await startSetup(addonId, admin);
    if (!started.ok) return Response.json({ error: started.error }, { status: started.status });
    return Response.json({ task: taskView(started.task) });
  }
  if (body.do === "cancel-setup") {
    cancelSetup(addonId);
    return Response.json({ ok: true });
  }
  // do: update. New code nobody reviewed, so it waits for the same switch as
  // the first install did.
  if (!readAddonConfig().allowFiles) {
    return Response.json({ error: "Updating from GitHub needs \"Install addons from files and links\" switched on." }, { status: 403 });
  }
  return installedResponse(await updateFromGitHub(addonId), admin);
}

export async function DELETE(_request: Request, { params }: Params) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) return admin;
  const { addonId } = await params;
  const result = await removeAddon(addonId);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true });
}
