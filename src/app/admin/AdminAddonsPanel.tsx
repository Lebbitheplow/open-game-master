"use client";

import { Download, GitBranch, Loader2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminAddonCard } from "@/app/admin/AdminAddonCard";
import { CreditLine, formatBytes, ModifiesLine, PartsPicker } from "@/app/admin/AddonParts";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { SectionHead } from "@/components/ui/SectionHead";
import { Switch } from "@/components/ui/Switch";
import type { AdminAddonsState, CatalogAddon } from "@/lib/addons/admin-view";
import { platformName } from "@/lib/addons/manifest";
import { catalogCredit } from "@/lib/addons/credits";
import { sourceFacts } from "@/lib/addons/registry-index";
import { forgetAddons } from "@/lib/addons/use-addons";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { useT, useTp } from "@/lib/locale";
import type { MessageKey } from "@/lib/messages-logic";

// Admin > Addons: the downloader list (addons/catalog.json in the Open
// Dungeon Master repository, audited entry by entry), the addons this
// server has, and the two server-wide switches (which catalog, and whether a
// .zip or a GitHub link from anywhere may be installed). docs/addons.md is
// the operator's guide to all of it.

const MAX_FILE_BYTES = 64 * 1024 * 1024;

const CATEGORY_KEYS: Record<CatalogAddon["category"], MessageKey> = {
  maps: "Maps and the board",
  content: "Content and import",
  table: "At the table",
  tools: "Tools",
};

const KIND_KEYS: Record<string, MessageKey> = {
  workshopImporters: "Imports",
  mapGenerators: "Maps",
  boardViews: "Board view",
};

export function AdminAddonsPanel() {
  const t = useT();
  const tp = useTp();
  const [state, setState] = useState<AdminAddonsState | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const registryInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [githubLink, setGithubLink] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/addons").catch(() => null);
    if (response?.ok) setState(await response.json());
    else setError(t("Could not read this server's addons."));
  }, []);

  useEffect(() => {
    let live = true;
    fetch("/api/admin/addons")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("failed"))))
      .then((data) => {
        if (live) setState(data);
      })
      .catch(() => {
        if (live) setError(t("Could not read this server's addons."));
      });
    return () => {
      live = false;
    };
  }, []);

  const changed = useCallback(
    async (message: string) => {
      setNotice(message);
      setError("");
      await load();
    },
    [load],
  );

  // An install over a copy of the same id from somewhere else (the
  // catalog's, a fork on GitHub, a file) waits for a yes, then goes again.
  async function confirmReplace(data: { replaces?: { name: string; from: string } | null }): Promise<boolean> {
    if (!data.replaces) return false;
    return appConfirm(
      t("{name} is already installed from {from}. Replace it with this one? It keeps its settings and its data folder, and starts switched off so you can read what the new one asks for.", { name: data.replaces.name, from: data.replaces.from }),
      { title: t("Replace this addon?"), actionLabel: t("Replace it", { context: "admin.addons.replaceAction" }), tone: "plain" },
    );
  }

  async function post(body: Record<string, unknown>, key: string) {
    setBusyId(key);
    setError("");
    setNotice("");
    try {
      let response = await fetch("/api/admin/addons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let data = await response.json().catch(() => ({}));
      if (response.status === 409 && (await confirmReplace(data))) {
        response = await fetch("/api/admin/addons", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, replace: true }),
        });
        data = await response.json().catch(() => ({}));
      }
      if (!response.ok) {
        setError(data.replaces ? t("Nothing was replaced.") : data.error || t("That did not work.", { context: "admin.addons.fail" }));
        return null;
      }
      return data;
    } catch {
      setError(t("Could not reach the server.", { context: "admin.addons.unreachable" }));
      return null;
    } finally {
      setBusyId("");
    }
  }

  function installedNotice(data: { installed: { name: string; version: string }; updated: boolean; newPermissions?: string[]; setupTask?: string }, from = "") {
    const asks = data.newPermissions?.length ? t(" It asks for permissions: read them before you switch it on.") : "";
    const setup = data.setupTask ? t(" Its setup has started.") : "";
    return data.updated
      ? t("Updated {name} to v{version}{from}.{setup}{asks}", { name: data.installed.name, version: data.installed.version, from, setup, asks })
      : t("Installed {name}{from}. It is off until you switch it on below.{asks}", { name: data.installed.name, from, asks });
  }

  async function install(addonId: string, parts?: string[]) {
    const data = await post({ do: "install", addonId, ...(parts ? { parts } : {}) }, `install:${addonId}`);
    if (!data) return;
    forgetAddons();
    await changed(installedNotice(data));
  }

  async function installFromGitHub() {
    const url = githubLink.trim();
    if (!url) return;
    const data = await post({ do: "install-github", url }, "github");
    if (!data) return;
    setGithubLink("");
    forgetAddons();
    await changed(`${installedNotice(data, data.from ? ` (${data.from})` : "")}${t(" It has not been reviewed: read what it asks for before you switch it on.")}`);
  }

  async function saveConfig(patch: { registryUrl?: string; allowFiles?: boolean }) {
    const data = await post({ do: "config", ...patch }, "config");
    if (data) {
      setState(data);
      setNotice(
        patch.allowFiles !== undefined
          ? patch.allowFiles
            ? t("Installing from files and links is on.")
            : t("Installing from files and links is off.")
          : t("Catalog saved."),
      );
    }
  }

  async function onFile(file: File) {
    if (file.size >= MAX_FILE_BYTES) {
      setError(t("An addon archive installed from a file may be up to 64 MB."));
      return;
    }
    setBusyId("upload");
    setError("");
    setNotice("");
    try {
      const send = (replace: boolean) =>
        fetch(`/api/admin/addons/upload${replace ? "?replace=1" : ""}`, {
          method: "POST",
          headers: { "Content-Type": "application/zip" },
          body: file,
        });
      let response = await send(false);
      let data = await response.json().catch(() => ({}));
      if (response.status === 409 && (await confirmReplace(data))) {
        response = await send(true);
        data = await response.json().catch(() => ({}));
      }
      if (!response.ok) {
        setError(data.replaces ? t("Nothing was replaced.") : data.error || t("Could not install that archive."));
        return;
      }
      forgetAddons();
      await changed(data.updated
        ? t("Updated {name} from {file}. It has not been reviewed: read what it asks for before you switch it on.", { name: data.installed.name, file: file.name })
        : t("Installed {name} from {file}. It has not been reviewed: read what it asks for before you switch it on.", { name: data.installed.name, file: file.name }));
    } catch {
      setError(t("Could not reach the server.", { context: "admin.addons.unreachable" }));
    } finally {
      setBusyId("");
    }
  }

  if (!state) {
    return error ? <p role="alert" className="text-xs text-red-400">{error}</p> : <PageSkeleton kind="flat" className="px-0 py-2" />;
  }

  const available = state.catalog.addons.filter((entry) => !entry.installed);
  const categories = [...new Set(available.map((entry) => entry.category))];

  return (
    <div className="space-y-4 text-sm">
      <section className={cn(ui.card, "ornate texture-noise p-5")}>
        <SectionHead level="h2" title={t("Addons")} glyph="system-plugin" />
        <p className="text-xs leading-5 text-stone-400">
          {t("An addon is a program that runs beside this server and adds to what it can do: reading a rulebook PDF into a workshop, building a battle map with 3D tools, drawing the board another way. Addons only reach the app through the doors it opens for them, and what they make is checked by the same rules as everything else.")}
        </p>
        <p className="mt-2 text-xs leading-5 text-stone-500">
          {t("Addons on the list were audited before they were added: each lives in its author's own GitHub repository, and the exact files that were checked are what you install. An addon still runs as a program on this computer with this server's permissions, so install the ones you trust. Each is off until you switch it on.")}
        </p>
        {!state.support.supported ? (
          <p role="status" className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            {state.support.reason}
          </p>
        ) : state.support.note ? (
          <p className="mt-2 text-[11px] leading-4 text-amber-200/80">{state.support.note}</p>
        ) : null}
      </section>

      {error ? <p role="alert" className="motion-shake text-xs text-red-400">{error}</p> : null}
      {notice ? <p role="status" className="live-in text-xs text-amber-200">{notice}</p> : null}

      <section className={cn(ui.card, "texture-noise p-5")}>
        <SectionHead title={t("Installed", { context: "admin.worlds.installedHeading" })} glyph="system-homebrew" aside={<span className="tabular-nums">{state.installed.length}</span>} />
        {!state.installed.length ? (
          <EmptyState art="chest" size="sm" title={t("No addons yet.")} hint={t("Pick one from the list below.")} />
        ) : (
          <ul className="stagger space-y-2">
            {state.installed.map((addon) => (
              <AdminAddonCard
                key={`${addon.id}:${addon.version}`}
                addon={addon}
                permissions={state.permissions}
                onChanged={changed}
                onInstall={(id) => void install(id)}
                busy={busyId === `install:${addon.id}`}
              />
            ))}
          </ul>
        )}
      </section>

      <section className={cn(ui.card, "texture-noise p-5")}>
        <SectionHead
          title={t("Available to download")}
          glyph="system-share"
          aside={available.length ? <span className="tabular-nums">{available.length}</span> : undefined}
        />
        {!state.support.supported ? (
          <EmptyState art="scrolls" size="sm" title={t("Addons are not available on this server.")} />
        ) : !state.catalog.url ? (
          <EmptyState art="scrolls" size="sm" title={t("This server's addon list is turned off.")} hint={t("Clear the list address below to use the Open Game Master list.")} />
        ) : state.catalog.error ? (
          <p role="alert" className="motion-shake rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            {state.catalog.error}
          </p>
        ) : !available.length ? (
          <EmptyState
            art="chest"
            size="sm"
            title={state.catalog.addons.length ? t("Everything on the list is installed.") : t("No addons are on the list yet.")}
          />
        ) : (
          <div className="space-y-4">
            {categories.map((category) => (
              <div key={category}>
                <p className={cn(ui.sectionEyebrow, "mb-2")}>{t(CATEGORY_KEYS[category])}</p>
                <ul className="stagger grid gap-2 sm:grid-cols-2">
                  {available
                    .filter((entry) => entry.category === category)
                    .map((entry) => (
                      <CatalogEntry
                        key={entry.id}
                        entry={entry}
                        permissions={state.permissions}
                        busy={busyId === `install:${entry.id}`}
                        onInstall={(parts) => void install(entry.id, parts)}
                      />
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {state.catalog.bundled ? (
          <p className="mt-2 text-[11px] leading-4 text-stone-500">
            {t("GitHub could not be reached, so this is the list this version of Open Game Master shipped with. Addons added since then show once it can be reached again.")}
          </p>
        ) : null}
        {state.catalog.skipped ? (
          <p className="mt-2 text-[11px] text-stone-500">
            {tp("1 entry in the catalog could not be read and is not shown.", "{count} entries in the catalog could not be read and are not shown.", { count: state.catalog.skipped })}
          </p>
        ) : null}
      </section>

      <section className={cn(ui.card, "texture-noise p-5")}>
        <SectionHead title={t("Addon list, files and links")} glyph="tab-facts" />
        <div className="flex flex-wrap items-center gap-2">
          <input
            key={state.config.registryUrl}
            ref={registryInput}
            defaultValue={state.config.registryUrl}
            placeholder={t("Blank uses the Open Game Master list")}
            aria-label={t("Addon list address")}
            className={cn(ui.input, "min-w-0 flex-1 text-xs")}
          />
          <button
            type="button"
            onClick={() => void saveConfig({ registryUrl: registryInput.current?.value.trim() ?? "" })}
            disabled={busyId === "config"}
            className={cn(ui.btnSmall, "text-xs")}
          >
            {busyId === "config" ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t("Save", { context: "admin.worlds.save" })}
          </button>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-stone-500">
          {t("Blank falls through to the ")}
          <span className="font-code">ADDON_REGISTRY_URL</span>
          {t(" environment variable, then to the Open Game Master list. Point it at your own over https, or set it to ")}
          <span className="font-code">off</span>.
          {state.catalog.url ? <span className="block break-all font-code">Reading: {state.catalog.url}</span> : null}
        </p>

        <div className="mt-4 flex items-start justify-between gap-3">
          <span className="min-w-0 text-xs text-stone-300">
            {t("Install addons from files and links")}
            <span className="block text-[11px] leading-4 text-stone-500">
              {t("For trying an addon before it is on the list, or running your own: a .zip, or a GitHub repository. Nobody has reviewed an addon that arrives this way.")}
            </span>
          </span>
          <Switch
            on={state.config.allowFiles}
            onChange={(next) => void saveConfig({ allowFiles: next })}
            label={t("Install addons from files and links")}
            disabled={busyId === "config"}
          />
        </div>
        {state.config.allowFiles ? (
          <div className="reveal mt-3">
            <input
              ref={fileInput}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void onFile(file);
              }}
            />
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void installFromGitHub();
              }}
            >
              <input
                value={githubLink}
                onChange={(event) => setGithubLink(event.target.value)}
                placeholder={t("owner/repo, or a link to a repository, release or folder")}
                aria-label={t("GitHub link to an addon")}
                className={cn(ui.input, "min-w-0 flex-1 text-xs")}
              />
              <button
                type="submit"
                disabled={busyId === "github" || !githubLink.trim() || !state.support.supported}
                className={cn(ui.btnSmall, "text-xs")}
              >
                {busyId === "github" ? <Loader2 className="size-3.5 animate-spin" /> : <GitBranch className="size-3.5" />}
                {t("Install from GitHub")}
              </button>
            </form>
            <p className="mt-1 text-[11px] leading-4 text-stone-500">
              {t("Takes the newest release (its .zip, or its source), or the branch or folder the link points at. Its card offers an update when there is a newer release or commit.")}
            </p>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={busyId === "upload" || !state.support.supported}
              className={cn(ui.btnSmall, "mt-3 text-xs")}
            >
              {busyId === "upload" ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              {t("Choose an addon .zip")}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function CatalogEntry({
  entry,
  permissions,
  busy,
  onInstall,
}: {
  entry: CatalogAddon;
  permissions: AdminAddonsState["permissions"];
  busy: boolean;
  onInstall: (parts?: string[]) => void;
}) {
  const t = useT();
  const tp = useTp();
  const adds = Object.entries(entry.contributes)
    .filter(([, titles]) => titles.length)
    .map(([kind, titles]) => `${KIND_KEYS[kind] ? t(KIND_KEYS[kind]) : kind}: ${titles.join(", ")}`);
  const source = sourceFacts(entry.source);
  const parts = entry.parts ?? [];
  const [chosen, setChosen] = useState<string[]>(() => parts.filter((part) => part.default).map((part) => part.id));
  const partBytes = parts.filter((part) => chosen.includes(part.id)).reduce((sum, part) => sum + part.bytes, 0);
  return (
    <li className="plate-row" data-layout="stack">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-sm text-amber-100">{entry.name}</span>
        <span className="text-[11px] text-stone-500">v{entry.version}</span>
      </div>
      <CreditLine credit={entry.credit ?? catalogCredit(entry)} />
      {source ? (
        <p className="text-[11px] leading-4 text-stone-500">
          <a href={source.url} target="_blank" rel="noreferrer" className="hover:text-amber-200" title={t("{repo} at the reviewed commit", { repo: source.repo })}>
            {t("The reviewed commit, {hash}", { hash: entry.source.commit.slice(0, 7) })}
          </a>
        </p>
      ) : null}
      <p className="mt-1 text-xs text-stone-400">{entry.description}</p>
      <ModifiesLine modifies={entry.modifies} className="mt-1" />
      {adds.length ? <p className="mt-1 text-[11px] text-stone-400">{adds.join(" · ")}</p> : null}
      {entry.needs.length ? <p className="mt-1 text-[11px] text-stone-500">{t("Needs installed: {list}", { list: entry.needs.join(", ") })}</p> : null}
      {entry.permissions.length ? (
        <p className="mt-1 text-[11px] text-stone-500">
          {t("Asks to: {list}", { list: entry.permissions.map((permission) => permissions[permission]?.label ?? permission).join("; ") })}
        </p>
      ) : null}
      {entry.platforms ? <p className="mt-1 text-[11px] text-stone-500">{t("Runs on {list}", { list: entry.platforms.map(platformName).join(", ") })}</p> : null}
      {entry.exclusive.length ? (
        <p className="mt-1 text-[11px] text-stone-500">{t("Takes turns with other addons for: {list}", { list: entry.exclusive.join(", ") })}</p>
      ) : null}
      {entry.clashes.map((clash) => (
        <p key={clash.name} className="mt-1 text-[11px] text-amber-300/90">
          {t("Cannot run beside {name}, which this server has: {reason}", { name: clash.name, reason: clash.reason })}
        </p>
      ))}
      {!entry.fit.ok ? <p className="mt-1 text-[11px] text-amber-300/90">{entry.fit.reason}</p> : null}
      <PartsPicker idPrefix={`catalog-${entry.id}`} parts={parts} chosen={chosen} onChange={setChosen} disabled={busy} upTo />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onInstall(parts.length ? chosen : undefined)}
          disabled={busy || !entry.fit.ok}
          className={cn(ui.btnSmall, "text-xs")}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          {parts.length ? t("Install with {chosen} of {total} parts", { chosen: chosen.length, total: parts.length }) : t("Install")}
        </button>
        <span className="text-[10px] text-stone-500">
          {Math.max(1, Math.round(entry.bytes / 1024 / 1024))} MB
          {entry.setupMB
            ? t(", then about {size} at setup", { size: entry.setupMB >= 1024 ? `${(entry.setupMB / 1024).toFixed(1)} GB` : `${entry.setupMB} MB` })
            : ""}
          {partBytes ? t(", and up to {size} for its parts", { size: formatBytes(partBytes) }) : ""}
        </span>
        {entry.homepage && !source ? (
          <a href={entry.homepage} target="_blank" rel="noreferrer" className="text-[11px] text-amber-200/80 hover:text-amber-200">
            {t("Source")}
          </a>
        ) : null}
      </div>
    </li>
  );
}
