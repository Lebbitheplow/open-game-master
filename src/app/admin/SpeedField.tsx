"use client";

import { Zap } from "lucide-react";
import { useT } from "@/lib/locale";
import { Field, SelectField } from "@/app/admin/AdminSettingsFields";
import type { Speed, SpeedEligibility } from "@/lib/speed-tier";
import type { SpeedNote } from "@/lib/speed-status";

// Processing speed for one model role (issue 255): the provider's default or
// its paid Fast tier. Offered on a connection that has one, for a named
// model (src/lib/speed-tier.ts); otherwise it says why. The cost is said before Fast is chosen, and what
// the last calls actually ran at is shown under it, so a downgrade to
// standard speed is never read as Fast.
export function SpeedField({
  label,
  value,
  onChange,
  eligibility,
  note,
}: {
  label: string;
  value: Speed;
  onChange: (value: Speed) => void;
  eligibility: SpeedEligibility;
  note?: SpeedNote;
}) {
  const t = useT();
  if (!eligibility.ok) {
    return (
      <Field label={label} hint={eligibility.reason} group>
        <p className="rounded-md border border-stone-800 bg-stone-950/40 px-2.5 py-1.5 text-xs text-stone-400" data-speed-unavailable>
          {t("Provider default")}{value === "fast" ? t(" (Fast is set, but this connection has no Fast tier, so none is asked for)") : ""}
        </p>
      </Field>
    );
  }
  return (
    <div data-speed-field>
      <SelectField
        label={label}
        value={value}
        onChange={onChange}
        options={[
          { value: "" as const, label: t("Provider default") },
          { value: "fast" as const, label: t("Fast (premium price)") },
        ]}
        hint={value === "fast" ? t("Fast answers sooner for about twice the price per token (2x to 2.5x of a Codex or Claude plan's usage, paid from usage credits on Claude). It applies to every campaign this setting serves.") : t("Fast answers sooner at a premium price; the default keeps today's speed and cost.")}
      />
      {value === "fast" ? <SpeedNoteLine note={note} /> : null}
    </div>
  );
}

function SpeedNoteLine({ note }: { note?: SpeedNote }) {
  const t = useT();
  if (!note) {
    return <p className="mt-1 text-[11px] text-stone-500">{t("No call has run at this setting since the server started.")}</p>;
  }
  const when = new Date(note.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const said = (reported?: string) =>
    note.reported && note.reported !== "fast" ? t(" (the provider says \"{said}\")", { said: reported ?? note.reported ?? "" }) : "";
  const text = note.refused
    ? t("Last call ({time}): {message}", { time: when, message: note.refused })
    : note.effective === "fast"
      ? t("Last call ({time}) ran at Fast{reported}.", { time: when, reported: said(note.reported ?? undefined) })
      : note.effective === "standard"
        ? t("Last call ({time}) asked for Fast but ran at standard speed{reported}, and was billed as standard.", { time: when, reported: note.reported ? t(" (the provider says \"{said}\")", { said: note.reported }) : "" })
        : t("Last call ({time}) asked for Fast; the provider did not say which speed ran.", { time: when });
  return (
    <p className="mt-1 flex items-start gap-1 text-[11px] text-stone-400" data-speed-note>
      <Zap className="mt-px size-3 shrink-0 text-amber-300" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}
