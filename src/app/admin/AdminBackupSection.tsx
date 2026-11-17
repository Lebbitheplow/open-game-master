"use client";

import { LoadFailed } from "@/app/campaigns/[campaignId]/PanelKit";
import { readLoad, useLoadStatus } from "@/lib/load-state";
import { Check, DatabaseBackup, Download, Loader2, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { EmptyState } from "@/components/EmptyState";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { Switch } from "@/components/ui/Switch";
import { useT } from "@/lib/locale";

// Verified backups of the campaign state, mirroring scripts/odm-backup.mjs
// and scripts/odm-restore.mjs. An archive holds the encrypted database plus
// uploads, generated media, .env.server and, when asked, the downloaded
// models, so it carries the encryption key: treat it like a password.
type BackupEntry = {
  name: string;
  sizeBytes: number;
  createdAt: string;
  sha256: string;
};

type Proof = { campaigns: number; users: number; messages: number };

function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function AdminBackupSection() {
  const t = useT();
  const [backups, setBackups] = useState<BackupEntry[] | null>(null);
  // A refused or failed read is shown in the server's words with a way to
  // ask again, never as "nothing here yet" (issue 140).
  const { loaded, loadError, settle } = useLoadStatus();
  const [reloads, setReloads] = useState(0);
  const [dir, setDir] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyName, setBusyName] = useState("");
  const [verified, setVerified] = useState<Record<string, Proof>>({});
  const [restoredName, setRestoredName] = useState("");
  const [error, setError] = useState("");
  const [includeModels, setIncludeModels] = useState(false);
  // What the running backup is doing now, read from the list route while
  // it works (src/lib/ops/backup.ts).
  const [phase, setPhase] = useState("");

  useEffect(() => {
    if (!creating) {
      return;
    }
    const timer = setInterval(() => {
      fetch("/api/admin/backup")
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { job?: { phase?: string } | null } | null) => setPhase(data?.job?.phase ?? ""))
        .catch(() => undefined);
    }, 1500);
    return () => clearInterval(timer);
  }, [creating]);

  useEffect(() => {
    readLoad<{ backups?: BackupEntry[]; dir?: string }>(t, fetch("/api/admin/backup"), t("The backups")).then((outcome) => {
      settle(outcome);
      if (outcome.payload) {
        setBackups(outcome.payload.backups ?? []);
        if (outcome.payload.dir) setDir(outcome.payload.dir);
      }
    });
  }, [ reloads, settle, t ]);
  async function create() {
    setPhase("");
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/admin/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeModels }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || t("Could not create the backup."));
        return;
      }
      setBackups((current) => [data.backup, ...(current ?? [])].filter((entry, index, all) => all.findIndex((e) => e.name === entry.name) === index));
    } catch {
      setError(t("Could not reach the server.", { context: "admin.worlds.unreachable" }));
    } finally {
      setCreating(false);
    }
  }

  async function verify(name: string) {
    setBusyName(name);
    setError("");
    try {
      const response = await fetch("/api/admin/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mode: "verify" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || t("This archive failed verification."));
        return;
      }
      setVerified((current) => ({ ...current, [name]: data.proof }));
    } catch {
      setError(t("Could not reach the server.", { context: "admin.error.unreachable" }));
    } finally {
      setBusyName("");
    }
  }

  async function restore(name: string) {
    const sure = await appConfirm(t("Restore {name}? Everything now on this server — campaigns, accounts, uploads and settings — is replaced by the contents of this archive. The server stops taking play the moment the files are in place; restart it to load the restored world.", { name }), {
      title: t("Restore this backup?"),
      actionLabel: t("Restore"),
      tone: "danger",
    });
    if (!sure) return;
    setBusyName(name);
    setError("");
    try {
      const response = await fetch("/api/admin/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mode: "live" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || t("The restore failed."));
        return;
      }
      setRestoredName(name);
    } catch {
      setError(t("Could not reach the server.", { context: "admin.error.unreachable" }));
    } finally {
      setBusyName("");
    }
  }

  async function remove(name: string) {
    const sure = await appConfirm(t("Delete the backup {name}? The archive and its fingerprint go away.", { name }), {
      title: t("Delete this backup?"),
      actionLabel: t("Delete"),
      tone: "danger",
    });
    if (!sure) return;
    const response = await fetch(`/api/admin/backup/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (response.ok) {
      setBackups((current) => (current ?? []).filter((entry) => entry.name !== name));
    }
  }

  if (backups === null && loadError) {

    return <LoadFailed error={loadError} onRetry={() => setReloads((current) => current + 1)} />;

  }

  if (backups === null) {
    return <div className="skeleton-block mt-3 h-16 rounded-xl" aria-label={t("Loading backups")} />;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-stone-500">
        {t("A backup snapshots the encrypted campaign database, uploads, generated media and server settings into one archive. Downloaded models are left out unless you include them; they download again on first use. The archive carries the database encryption key, so keep it like a password: whoever holds it can read every campaign. ")}
        {dir ? <span className="font-code text-stone-600">{dir}</span> : null}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={create} disabled={creating} aria-busy={creating} className={ui.btnSmall}>
          {creating ? <Loader2 className="size-4 animate-spin" /> : <DatabaseBackup className="size-4" />}
          {t("Take backup now")}
        </button>
        <label className="flex items-center gap-2 text-xs text-stone-400">
          <Switch label={t("Include downloaded models")} on={includeModels} onChange={setIncludeModels} disabled={creating} />
          {t("Include downloaded models")}
        </label>
        {creating ? (
          <span key={phase} className="live-in text-xs text-stone-500">
            {phase ? `${phase[0].toUpperCase()}${phase.slice(1)}…` : t("Snapshotting the database and packing the archive…")}
          </span>
        ) : null}
      </div>
      {error ? <p role="alert" className="motion-shake text-sm text-red-400">{error}</p> : null}
      {restoredName ? (
        <p role="status" className="live-in text-sm text-amber-300">
          <TriangleAlert className="mr-1 inline size-4" />
          {t("Restored {name}. The server has stopped taking play; restart it now to load the restored world.", { name: restoredName })}
        </p>
      ) : null}
      {backups.length === 0 ? (
        (loadError ? (
          <LoadFailed
            error={loadError}
            onRetry={() => setReloads((current) => current + 1)}
          />
        ) : loaded ? (
          <EmptyState
            size="sm"
            art="scrolls"
            title={t("No backups yet. Take one before a big session, or restore one you made with scripts/odm-backup.mjs.")}
          />
        ) : null)
      ) : (
        <ul className="stagger space-y-2">
          {backups.map((backup) => (
            <li key={backup.name} className="plate-row flex-wrap gap-2">
              <span className="truncate font-code text-xs text-stone-300" title={backup.name}>
                {backup.name}
              </span>
              <span className="text-xs tabular-nums text-stone-500">{formatSize(backup.sizeBytes)}</span>
              <span className="text-xs text-stone-500">{new Date(backup.createdAt).toLocaleString()}</span>
              {verified[backup.name] ? (
                <span
                  className="live-in inline-flex items-center gap-1 text-xs text-emerald-400"
                  title={t("integrity ok — {campaigns} campaigns, {users} users, {messages} messages", {
                    campaigns: verified[backup.name].campaigns,
                    users: verified[backup.name].users,
                    messages: verified[backup.name].messages,
                  })}
                >
                  <ShieldCheck className="size-3.5" />
                  {t("verified")}
                </span>
              ) : null}
              {restoredName === backup.name ? (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                  <Check className="size-3.5" /> {t("restored")}
                </span>
              ) : null}
              <span className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => verify(backup.name)}
                  disabled={busyName === backup.name}
                  aria-busy={busyName === backup.name}
                  title={t("Verify integrity and open the encrypted database without touching anything")}
                  className={ui.btnSmall}
                >
                  {busyName === backup.name ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
                  {verified[backup.name] ? t("Re-verify") : t("Verify")}
                </button>
                {verified[backup.name] && restoredName !== backup.name ? (
                  <button
                    type="button"
                    onClick={() => restore(backup.name)}
                    disabled={busyName === backup.name}
                    title={t("Replace this server's state with the archive")}
                    className={cn(ui.btnSmall, "hover:border-red-500/50 hover:text-red-400")}
                  >
                    {t("Restore")}
                  </button>
                ) : null}
                <a
                  href={`/api/admin/backup/${encodeURIComponent(backup.name)}`}
                  download={backup.name}
                  title={t("Download the archive")}
                  className={ui.btnSmall}
                >
                  <Download className="size-3.5" />
                </a>
                <button
                  type="button"
                  onClick={() => remove(backup.name)}
                  title={t("Delete {name}", { name: backup.name })}
                  aria-label={t("Delete {name}", { name: backup.name })}
                  className={cn(ui.btnSmall, "px-2 hover:border-red-500/50 hover:text-red-400")}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </span>
              {backup.sha256 ? (
                <span className="w-full truncate font-code text-[10px] text-stone-600" title={backup.sha256}>
                  sha256 {backup.sha256.slice(0, 16)}…
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
