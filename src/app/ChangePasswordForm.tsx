"use client";

import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/locale";
import { ui } from "@/lib/ui";

// Change-password form shared by account settings and the forced flow after
// an admin reset (there, the temp password is prefilled as the current one).
export function ChangePasswordForm({
  currentPassword: initialCurrent,
  lockCurrent = false,
  submitLabel,
  onChanged,
}: {
  currentPassword?: string;
  lockCurrent?: boolean;
  submitLabel?: string;
  onChanged: () => void;
}) {
  const t = useT();
  const [currentPassword, setCurrentPassword] = useState(initialCurrent ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirm) {
      setError(t("New passwords don't match."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || t("Could not change the password."));
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      onChanged();
    } catch {
      setError(t("Could not reach the server.", { context: "password.unreachable" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {lockCurrent ? null : (
        <label className="block text-sm">
          <span className="mb-1 block text-stone-400">{t("Current password")}</span>
          <input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            required
            maxLength={100}
            className={ui.input}
          />
        </label>
      )}
      <label className="block text-sm">
        <span className="mb-1 block text-stone-400">{t("New password")}</span>
        <input
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={100}
          className={ui.input}
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-stone-400">{t("Confirm new password")}</span>
        <input
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={100}
          className={ui.input}
        />
      </label>
      {error ? <p className="motion-shake text-sm text-red-400">{error}</p> : null}
      <button type="submit" disabled={busy} aria-busy={busy} className={cn(ui.btnPrimary, "w-full")}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        {submitLabel ?? t("Change password")}
      </button>
    </form>
  );
}
