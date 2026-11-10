"use client";

import { useMemo, useState } from "react";
import { Loader2, Swords } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { ui } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { FieldLabel } from "@/app/campaigns/[campaignId]/DmConsoleParts";
import { FieldInput, argsFor, initialValue, type Value } from "@/app/campaigns/[campaignId]/DmActionFields";
import { ADJUDICATIONS } from "@/lib/dm/invoke-catalog";
import type { CatalogField } from "@/lib/dm/invoke-catalog";
import { fieldForHost, fieldShown } from "@/lib/dm/catalog-types";
import { hostOffers, useCapabilities, type HostFeature } from "@/lib/use-capabilities";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { OPENING_FIELDS, openingBody } from "@/lib/dm/deploy-opening-logic";

// How a prepared fight opens, asked as the GM deploys it: who is away, who
// lies in wait or is surprised, the ground, the distance, a building around
// the party, a lair, the side the enemies come from. The same fields as the
// console's Start a fight (catalog-combat.ts start_encounter), read from that
// entry so the two never drift, sent in the deploy route's body
// (fight-opening.ts openingOptionsSchema). Every field starts empty, which
// deploys the fight as it was prepared.
//
// Why a GM is asked here (AGENTS.md, settings and options): who is away and
// who is surprised must be said before the first initiative roll, and no
// default serves a split party; Start a fight already asks it, so this is
// the same control at a second door, not a new option. The lead's cue at a
// table the AI narrates asks nothing: the storyteller decides the opening.

export function DeployOpeningDialog({
  open,
  name,
  sheets,
  busy,
  onCancel,
  onDeploy,
}: {
  open: boolean;
  // The prepared fight's name, for the title.
  name: string;
  sheets: CharacterSheet[];
  busy: boolean;
  onCancel: () => void;
  onDeploy: (options: Record<string, unknown>) => void;
}) {
  const capabilities = useCapabilities();
  const fields = useMemo(() => {
    const entry = ADJUDICATIONS.find((candidate) => candidate.name === "start_encounter");
    return (entry?.fields ?? [])
      .filter((field) => (OPENING_FIELDS as readonly string[]).includes(field.name))
      .map((field) => fieldForHost(field, (feature) => hostOffers(capabilities, feature as HostFeature)))
      .filter((field): field is CatalogField => field !== null)
      // Who is away is picked from the table's characters: none to pick, no field.
      .filter((field) => field.kind !== "characters" || sheets.length > 0);
  }, [capabilities, sheets.length]);
  const empty = () => Object.fromEntries(fields.map((field) => [field.name, initialValue(field)]));
  const [values, setValues] = useState<Record<string, Value>>(empty);
  const shown = fields.filter((field) => fieldShown(field, values));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={`Deploy ${name}`}
      icon={<Swords className="size-5 text-amber-300" aria-hidden="true" />}
    >
      <p className="mb-3 text-xs leading-snug text-stone-400">How the fight opens. Leave a field empty and it opens as you prepared it.</p>
      {/* A div per field, not a label: the kit controls hold several buttons,
          and each carries the field's name (DmActionForm.tsx). */}
      <div className="space-y-2.5">
        {shown.map((field) => (
          <div key={field.name} className={cn(field.kind === "boolean" && "flex flex-wrap items-center justify-between gap-x-3")}>
            <FieldLabel className={cn(field.kind === "boolean" && "mb-0")}>{field.label}</FieldLabel>
            <FieldInput field={field} value={values[field.name]} onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))} sheets={sheets} enemies={[]} />
            {field.help ? <span className="mt-1 block basis-full text-[11px] leading-snug text-stone-500">{field.help}</span> : null}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className={cn(ui.btnSecondary, "min-h-10")} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onDeploy(openingBody(argsFor(shown, values)))}
          disabled={busy}
          aria-busy={busy}
          className={cn(ui.btnPrimary, "min-h-10")}
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Swords className="size-4" aria-hidden="true" />}
          Deploy
        </button>
      </div>
    </Dialog>
  );
}
