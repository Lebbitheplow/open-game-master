"use client";

import { ChevronDown, Download, FlaskConical, Loader2, RefreshCw, ScrollText, Trash2, Wrench } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AddonFields, fieldDefaults, type FieldValues } from "@/components/addons/AddonFields";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { Switch } from "@/components/ui/Switch";
import type { AdminAddon, AdminAddonsState } from "@/lib/addons/admin-view";
import { cancelTask, followTask } from "@/lib/addons/follow-task";
import { CONTRIBUTION_KINDS, CONTRIBUTION_LABELS } from "@/lib/addons/manifest";
import type { RequirementCheck } from "@/lib/addons/requirements";
import type { TaskView } from "@/lib/addons/tasks";
import { forgetAddons } from "@/lib/addons/use-addons";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

// One installed addon on Admin > Addons: what it is and where it came from,
// whether it is on, what it asks for, its setup, its settings, the programs
// it needs, its log, and its update and remove buttons.

const SOURCE_LABEL: Record<AdminAddon["source"], string> = {
  registry: "From the addon list",
  file: "From a file, not reviewed",
  github: "From GitHub, not reviewed",
  dev: "Development folder",
};

const STATUS: Record<AdminAddon["status"], { label: string; tone: string }> = {
  ready: { label: "On", tone: "bg-emerald-400" },
  disabled: { label: "Off", tone: "bg-stone-500" },
  "needs-approval": { label: "Waiting for your yes", tone: "bg-amber-400" },
  "needs-settings": { label: "Needs settings", tone: "bg-amber-400" },
  "needs-setup": { label: "Needs setup", tone: "bg-amber-400" },
  conflict: { label: "Conflict", tone: "bg-red-400" },
  "missing-files": { label: "Files missing", tone: "bg-red-400" },
  broken: { label: "Broken", tone: "bg-red-400" },
  unfit: { label: "Cannot run here", tone: "bg-red-400" },
  unsupported: { label: "Not available", tone: "bg-stone-600" },
};

type Details = { requirements: RequirementCheck[]; log: string[] };

export function AdminAddonCard({
  addon,
  permissions,
  onChanged,
  onInstall,
  busy,
}: {
  addon: AdminAddon;
  permissions: AdminAddonsState["permissions"];
  onChanged: (notice: string) => Promise<void>;
  onInstall: (addonId: string) => void;
  busy: boolean;
}) {
  const manifest = addon.manifest;
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [values, setValues] = useState<FieldValues>(() => ({ ...fieldDefaults(manifest?.settings ?? []), ...addon.settings }));
  const [dirty, setDirty] = useState(false);
  const [details, setDetails] = useState<Details | null>(null);
  const [test, setTest] = useState("");
  const status = STATUS[addon.status];
  const name = manifest?.name ?? addon.id;

  async function call(method: string, body?: unknown, path = ""): Promise<Record<string, unknown> | null> {
    setError("");
    const response = await fetch(`/api/admin/addons/${encodeURIComponent(addon.id)}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    const data = response ? ((await response.json().catch(() => ({}))) as Record<string, unknown>) : { error: "Could not reach the server." };
    if (!response?.ok) {
      setError(String(data.error ?? "That did not work."));
      return null;
    }
    return data;
  }

  async function toggle(next: boolean) {
    if (next && manifest?.permissions.length) {
      const asks = manifest.permissions
        .map((permission) => permissions[permission as keyof typeof permissions]?.label ?? permission)
        .join("; ");
      const sure = await appConfirm(`${name} asks to: ${asks}. Switch it on?`, {
        title: "Switch this addon on?",
        actionLabel: "Accept and switch on",
        tone: "plain",
      });
      if (!sure) return;
    }
    setWorking("toggle");
    const done = await call("PATCH", next ? { enabled: true, accept: manifest?.permissions ?? [] } : { enabled: false });
    setWorking("");
    if (done) {
      forgetAddons();
      const fresh = done.addon as AdminAddon | null;
      if (next && fresh?.status === "needs-settings") {
        // Its setup waits for these: open them where they are filled in.
        setOpen(true);
        await onChanged(`${name} is on. Fill in ${fresh.missingSettings.join(", ")} to finish setting it up.`);
        return;
      }
      await onChanged(next ? (done.setupTask ? `${name} is on. Its setup has started.` : `${name} is on.`) : `${name} is off.`);
    }
  }

  async function update() {
    if (addon.source !== "github") {
      onInstall(addon.id);
      return;
    }
    setWorking("update");
    const done = await call("POST", { do: "update" });
    setWorking("");
    if (done) {
      forgetAddons();
      const installed = done.installed as { version: string };
      await onChanged(`Updated ${name} to v${installed.version} (${String(done.from)}).${done.setupTask ? " Its setup has started." : ""}`);
    }
  }

  async function saveSettings() {
    setWorking("settings");
    const done = await call("PATCH", { settings: values });
    setWorking("");
    if (done) {
      setDirty(false);
      await onChanged(
        done.setupTask ? `Saved ${name}'s settings. Its setup has started.` : `Saved ${name}'s settings. It starts with them on its next run.`,
      );
    }
  }

  async function check() {
    setWorking("check");
    const data = await call("GET");
    setWorking("");
    if (data) setDetails({ requirements: (data.requirements as RequirementCheck[]) ?? [], log: (data.log as string[]) ?? [] });
  }

  async function runTest() {
    setWorking("test");
    setTest("");
    const response = await fetch(`/api/admin/addons/${encodeURIComponent(addon.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ do: "test" }),
    }).catch(() => null);
    const data = response ? ((await response.json().catch(() => ({}))) as { ok?: boolean; tools?: string[]; error?: string; log?: string[] }) : null;
    setWorking("");
    if (!data) {
      setError("Could not reach the server.");
      return;
    }
    setTest(data.ok ? `Started. It offers ${data.tools?.join(", ") || "no tools"}.` : "");
    if (!data.ok) setError(data.error ?? "It did not start.");
    setDetails((current) => ({ requirements: current?.requirements ?? [], log: data.log ?? [] }));
  }

  async function remove() {
    const sure = await appConfirm(`Remove ${name}? Its files and its data folder go with it. What it already made (workshops, maps) stays.`, {
      title: "Remove this addon?",
      actionLabel: "Remove",
      tone: "danger",
    });
    if (!sure) return;
    setWorking("remove");
    const done = await call("DELETE");
    setWorking("");
    if (done) {
      forgetAddons();
      await onChanged(`Removed ${name}.`);
    }
  }

  const contributes = manifest
    ? CONTRIBUTION_KINDS.flatMap((kind) => manifest.contributes[kind].map((title) => `${CONTRIBUTION_LABELS[kind]}: ${title}`))
    : [];
  const canSwitch = Boolean(manifest) && !["broken", "missing-files", "unfit", "unsupported"].includes(addon.status);

  return (
    <li className="plate-row" data-layout="stack">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm text-amber-100">{name}</p>
          <p className="text-[11px] text-stone-500">
            v{addon.version}
            {manifest?.author ? ` · by ${manifest.author}` : ""} · {SOURCE_LABEL[addon.source]}
          </p>
          {addon.origin ? (
            <p className="text-[11px] text-stone-500">
              GitHub:{" "}
              <a href={addon.origin.url} target="_blank" rel="noreferrer" className="text-amber-200/80 hover:text-amber-200">
                {addon.origin.repo}
              </a>{" "}
              · {addon.origin.label}
            </p>
          ) : null}
        </div>
        <span className="flex items-center gap-2 text-[11px] text-stone-400">
          <span className={cn("size-2 rounded-full", status.tone)} aria-hidden="true" />
          {status.label}
          {addon.running ? <span className="text-emerald-300/80">· running</span> : null}
        </span>
        {canSwitch ? (
          <Switch
            on={addon.enabled && addon.status !== "needs-approval"}
            onChange={(next) => void toggle(next)}
            label={`${name} on or off`}
            disabled={working === "toggle"}
          />
        ) : null}
      </div>
      {manifest?.description ? <p className="mt-1 text-xs text-stone-400">{manifest.description}</p> : null}
      {addon.conflicts.length ? (
        <ul className="mt-2 space-y-0.5">
          {addon.conflicts.map((conflict) => (
            <li key={conflict.id} className={cn("text-[11px] leading-4", conflict.on ? "text-red-300/90" : "text-stone-500")}>
              Cannot run beside {conflict.name}
              {conflict.on ? " (switched on)" : ""}: {conflict.reason}
            </li>
          ))}
        </ul>
      ) : null}
      {addon.exclusive.length ? (
        <p className="mt-1 text-[11px] leading-4 text-stone-500">
          Takes turns with other addons for: {addon.exclusive.join(", ")}.
        </p>
      ) : null}
      {/* While its setup runs, the setup's own progress says it. */}
      {addon.problem && !(addon.status === "needs-setup" && addon.setup.task) ? (
        <p className="live-in mt-1 text-xs text-amber-300/90">{addon.problem}</p>
      ) : null}
      {addon.status === "needs-settings" && !open ? (
        <button type="button" onClick={() => setOpen(true)} className={cn(ui.btnSmall, "mt-2 w-fit text-xs")}>
          Fill in its settings
        </button>
      ) : null}
      {contributes.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {contributes.map((line) => (
            <li key={line} className="rounded-full border border-stone-700/70 px-2 py-0.5 text-[10px] text-stone-400">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      {manifest?.permissions.length ? (
        <p className="mt-2 text-[11px] leading-4 text-stone-500">
          Asks to:{" "}
          {manifest.permissions.map((permission) => permissions[permission as keyof typeof permissions]?.label ?? permission).join("; ")}.
        </p>
      ) : null}
      {addon.setup.has ? <AddonSetup addon={addon} name={name} onChanged={onChanged} /> : null}
      {error ? <p role="alert" className="motion-shake mt-2 text-xs text-red-400">{error}</p> : null}
      {test ? <p role="status" className="live-in mt-2 text-xs text-emerald-300/90">{test}</p> : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {addon.update ? (
          <button type="button" onClick={() => void update()} disabled={busy || working === "update"} className={cn(ui.btnSmall, "text-xs")}>
            {busy || working === "update" ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            Update to {addon.update}
          </button>
        ) : addon.source === "registry" && (addon.status === "missing-files" || addon.status === "broken") ? (
          // Files gone (a world moved to a new machine, a folder deleted by
          // hand): the list still has it, so it is fetched again here.
          <button type="button" onClick={() => onInstall(addon.id)} disabled={busy} className={cn(ui.btnSmall, "text-xs")}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            Reinstall
          </button>
        ) : null}
        {manifest ? (
          <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className={cn(ui.btnSmall, "text-xs")}>
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            {open ? "Less" : "Settings and checks"}
          </button>
        ) : null}
        {addon.source !== "dev" ? (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={working === "remove"}
            className={cn(ui.btnSmall, "text-xs hover:border-red-500/50 hover:text-red-400")}
          >
            {working === "remove" ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Remove
          </button>
        ) : null}
      </div>

      {open && manifest ? (
        <div className="reveal mt-3 space-y-4 border-t border-stone-800/80 pt-3">
          {manifest.settings.length ? (
            <section className="space-y-3">
              <AddonFields
                idPrefix={`addon-${addon.id}`}
                fields={manifest.settings}
                values={values}
                secretsSet={addon.secretsSet}
                onChange={(key, value) => {
                  setValues((current) => ({ ...current, [key]: value }));
                  setDirty(true);
                }}
              />
              <button type="button" onClick={() => void saveSettings()} disabled={!dirty || working === "settings"} className={cn(ui.btnSmall, "text-xs")}>
                {working === "settings" ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {dirty ? "Save settings" : "Saved"}
              </button>
            </section>
          ) : (
            <p className="text-[11px] text-stone-500">It has no settings.</p>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void check()} disabled={working === "check"} className={cn(ui.btnSmall, "text-xs")}>
              {working === "check" ? <Loader2 className="size-3.5 animate-spin" /> : <ScrollText className="size-3.5" />}
              Check what it needs, and its log
            </button>
            <button
              type="button"
              onClick={() => void runTest()}
              disabled={working === "test" || addon.status !== "ready"}
              title={addon.status === "ready" ? undefined : "Switch it on first"}
              className={cn(ui.btnSmall, "text-xs")}
            >
              {working === "test" ? <Loader2 className="size-3.5 animate-spin" /> : <FlaskConical className="size-3.5" />}
              Start it and list its tools
            </button>
          </div>

          {details ? (
            <div className="live-in space-y-2">
              {details.requirements.length ? (
                <ul className="space-y-1">
                  {details.requirements.map((requirement) => (
                    <li key={requirement.program} className="text-[11px] leading-4">
                      <span className={requirement.ok ? "text-emerald-300/90" : "text-amber-300/90"}>
                        {requirement.ok ? "Found" : "Missing"} {requirement.program}
                        {requirement.version ? ` ${requirement.version}` : ""}
                      </span>
                      {requirement.found ? <span className="font-code text-stone-500"> {requirement.found}</span> : null}
                      {requirement.problem ? <span className="block text-stone-400">{requirement.problem} {requirement.hint}</span> : null}
                      {!requirement.ok && requirement.url ? (
                        <a href={requirement.url} target="_blank" rel="noreferrer" className="text-amber-200 underline-offset-2 hover:underline">
                          {requirement.url}
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-stone-500">It needs nothing else installed.</p>
              )}
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-stone-800 bg-stone-950/80 p-2 font-code text-[10px] leading-4 text-stone-400">
                {details.log.length ? details.log.join("\n") : "Nothing logged since the server started."}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

// An addon's setup on its card: what it will do and how much it fetches,
// how far a run has got (followed after a reload too), what went wrong last
// time, and the button to run it (again).
function AddonSetup({ addon, name, onChanged }: { addon: AdminAddon; name: string; onChanged: (notice: string) => Promise<void> }) {
  const [run, setRun] = useState<TaskView | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const live = useRef(true);
  const followed = useRef("");

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const follow = useCallback(
    async (task: TaskView) => {
      if (followed.current === task.id) return;
      followed.current = task.id;
      const done = await followTask(task, setRun, () => live.current);
      if (!live.current) return;
      setRun(null);
      await onChanged(
        done?.status === "done" ? `${name} is set up.` : done?.status === "cancelled" ? `Stopped ${name}'s setup.` : done ? `${name}'s setup did not finish.` : "",
      );
    },
    [name, onChanged],
  );

  // A setup started elsewhere (switching it on, an update) or before a reload.
  const incoming = addon.setup.task;
  useEffect(() => {
    if (incoming?.status === "running") void follow(incoming);
  }, [incoming, follow]);

  async function start() {
    setStarting(true);
    setError("");
    const response = await fetch(`/api/admin/addons/${encodeURIComponent(addon.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ do: "setup" }),
    }).catch(() => null);
    const data = response ? ((await response.json().catch(() => ({}))) as { task?: TaskView; error?: string }) : { error: "Could not reach the server." };
    setStarting(false);
    if (!response?.ok || !data.task) {
      setError(data.error ?? "Its setup did not start.");
      return;
    }
    void follow(data.task);
  }

  const { setup } = addon;
  const canRun = addon.enabled && (addon.status === "ready" || addon.status === "needs-setup");
  const blockedBy = !addon.enabled ? "Switch it on first" : addon.status === "needs-settings" ? "Fill in its settings first" : canRun ? undefined : addon.problem;
  return (
    <div className="mt-2 rounded-lg border border-stone-800/80 bg-stone-950/40 p-2.5">
      <p className="text-[11px] leading-4 text-stone-400">
        <Wrench className="mr-1 inline size-3 align-[-2px] text-stone-500" aria-hidden="true" />
        Setup: {setup.steps.join("; ")}
        {setup.diskMB ? `. Needs about ${setup.diskMB >= 1024 ? `${(setup.diskMB / 1024).toFixed(1)} GB` : `${setup.diskMB} MB`} of disk.` : "."}
      </p>
      {run ? (
        <div className="live-in mt-2 space-y-1.5" role="status">
          <div className="h-1.5 overflow-hidden rounded-full bg-stone-800">
            <div
              className={cn("h-full rounded-full bg-amber-400/80 transition-[width] duration-500", run.progress.fraction === null && "animate-pulse")}
              style={{ width: `${Math.round((run.progress.fraction ?? 0.15) * 100)}%` }}
            />
          </div>
          <p className="flex min-w-0 items-center gap-2 text-[11px] text-stone-300">
            <Loader2 className="size-3 shrink-0 animate-spin" />
            <span className="truncate">{run.progress.message || "Setting up"}</span>
          </p>
          <button type="button" onClick={() => void cancelTask(run.id)} className={cn(ui.btnSmall, "text-xs")}>
            Stop it
          </button>
        </div>
      ) : (
        <>
          {setup.error ? <p className="live-in mt-1 text-[11px] leading-4 text-red-300/90">Last setup failed: {setup.error}</p> : null}
          {error ? <p role="alert" className="motion-shake mt-1 text-[11px] text-red-400">{error}</p> : null}
          <button
            type="button"
            onClick={() => void start()}
            disabled={starting || !canRun}
            title={blockedBy}
            className={cn(ui.btnSmall, "mt-2 text-xs")}
          >
            {starting ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {setup.needed ? "Run its setup" : "Run its setup again"}
          </button>
        </>
      )}
    </div>
  );
}
