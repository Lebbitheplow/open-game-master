import type { BoardView, MapGenerator, OptionField, WorkshopImporter } from "@/lib/addons/manifest";
import { creditFor, type AddonCredit } from "@/lib/addons/credits";
import { grantedPermission, hostFacts, listInstalledAddons, type InstalledAddon } from "@/lib/addons/installed";
import { downloadRepo } from "@/lib/addons/manifest-parts";
import { installableParts } from "@/lib/addons/parts";
import { addonSupport } from "@/lib/addons/support";

// What the ready addons contribute, flattened for the pages that offer them
// (GET /api/addons). The shape is the client's (src/lib/addons/use-addons.ts).

// `addonAuthor` and `addonUrl` credit its creator wherever what it adds is
// offered (absent from older hosts).
type Owner = { addonId: string; addonName: string; addonVersion: string; addonAuthor?: string; addonUrl?: string };

export type OfferedImporter = Owner & Pick<WorkshopImporter, "id" | "title" | "description" | "accepts" | "maxInputMB"> & { options: OptionField[] };
export type OfferedGenerator = Owner & Pick<MapGenerator, "id" | "title" | "description"> & { options: OptionField[] };
// `threads`: the admin accepted the addon's threads permission, so the table
// lets its frame be cross-origin isolated (AddonBoardView.tsx).
// `parts`: the addon's chosen parts that this server can fetch, handed to
// the view in its snapshot.
export type OfferedBoardView = Owner & Pick<BoardView, "id" | "title" | "description" | "needsViewData" | "combatOnly" | "sessionLayout" | "sessionTheme"> & { url: string; options: OptionField[]; threads?: boolean; parts?: string[] };

export type OfferedContributions = {
  supported: boolean;
  workshopImporters: OfferedImporter[];
  mapGenerators: OfferedGenerator[];
  boardViews: OfferedBoardView[];
};

// The address a board view's page is served at (src/app/api/addons/
// [addonId]/ui/[...path]/route.ts), versioned so an update is never answered
// from a cache.
export function boardViewUrl(addonId: string, version: string, entry: string): string {
  const inside = entry.replace(/^ui\//, "");
  return `/api/addons/${encodeURIComponent(addonId)}/ui/${inside.split("/").map(encodeURIComponent).join("/")}?v=${encodeURIComponent(version)}`;
}

export function offeredContributions(): OfferedContributions {
  const support = addonSupport();
  const offered: OfferedContributions = { supported: support.supported, workshopImporters: [], mapGenerators: [], boardViews: [] };
  if (!support.supported) return offered;
  for (const addon of listInstalledAddons()) {
    if (addon.status !== "ready" || !addon.manifest) continue;
    const credit = installedCredit(addon);
    const owner: Owner = {
      addonId: addon.id,
      addonName: addon.manifest.name,
      addonVersion: addon.manifest.version,
      addonAuthor: credit.author,
      addonUrl: credit.url,
    };
    const parts = installableParts({ ...addon, manifest: addon.manifest }, `${hostFacts().platform}-${hostFacts().arch}`);
    const { contributes } = addon.manifest;
    for (const importer of contributes.workshopImporters) {
      offered.workshopImporters.push({
        ...owner,
        id: importer.id,
        title: importer.title,
        description: importer.description,
        accepts: importer.accepts,
        maxInputMB: importer.maxInputMB,
        options: importer.options,
      });
    }
    for (const generator of contributes.mapGenerators) {
      offered.mapGenerators.push({ ...owner, id: generator.id, title: generator.title, description: generator.description, options: generator.options });
    }
    for (const view of contributes.boardViews) {
      offered.boardViews.push({
        ...owner,
        id: view.id,
        title: view.title,
        description: view.description,
        needsViewData: view.needsViewData,
        combatOnly: view.combatOnly,
        sessionLayout: view.sessionLayout,
        sessionTheme: view.sessionTheme,
        url: boardViewUrl(addon.id, addon.manifest.version, view.entry),
        options: view.options,
        threads: grantedPermission(addon, "threads"),
        parts,
      });
    }
  }
  return offered;
}

// An installed addon's credit: its author, and the GitHub repository it
// was fetched from (else the one its homepage names), with any other
// repositories its parts come from.
export function installedCredit(addon: InstalledAddon): AddonCredit {
  const repo = addon.state.fetchedFrom?.repo ?? addon.state.github?.repo ?? "";
  return creditFor({
    author: addon.manifest?.author ?? "",
    homepage: addon.manifest?.homepage,
    repo,
    also: [...new Set((addon.manifest?.setup?.downloads ?? []).filter((download) => download.part).map(downloadRepo).filter(Boolean))],
  });
}

export type CreditedAddon = AddonCredit & { id: string; name: string; version: string; license: string; description: string };

// The switched-on addons and who made them, for the licenses page: what
// everyone at this server's tables meets, credited to its creator.
export function addonCredits(): CreditedAddon[] {
  if (!addonSupport().supported) return [];
  return listInstalledAddons()
    .filter((addon) => addon.status === "ready" && addon.manifest)
    .map((addon) => ({
      ...installedCredit(addon),
      id: addon.id,
      name: addon.manifest!.name,
      version: addon.manifest!.version,
      license: addon.manifest!.license,
      description: addon.manifest!.description,
    }));
}
