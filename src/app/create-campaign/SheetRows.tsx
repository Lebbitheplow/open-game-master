"use client";

import type { CSSProperties } from "react";
import { InfoButton } from "@/components/ui/InfoDialog";
import {
  BONDS_INFO,
  LIVING_WORLD_INFO,
  NARRATION_GUARD_INFO,
  ROMANCE_INFO,
} from "@/app/campaigns/[campaignId]/GameSettingsPanel";
import type { StepProps } from "@/app/create-campaign/draft";
import { flipRow, tableSheet, type SheetInfo, type SheetRowKey } from "@/app/create-campaign/table-sheet";
import { useT } from "@/lib/locale";

// The rows' own labels and hints come from table-sheet.ts (the table sheet's
// own vocabulary, still English); the ⓘ dialogs' questions and texts are
// translated (the text constants are message keys).
const INFO: Record<SheetInfo, { labelKey: string; text: string }> = {
  livingWorld: { labelKey: "What does Living World do?", text: LIVING_WORLD_INFO },
  bonds: { labelKey: "What are Bonds?", text: BONDS_INFO },
  romance: { labelKey: "How does Romance work?", text: ROMANCE_INFO },
  narrationGuard: { labelKey: "What is the outcome check?", text: NARRATION_GUARD_INFO },
};

// Some of the table sheet's switches (table-sheet.ts decides which exist in
// this mode, what each says, and what a press does), drawn wherever the
// experience step groups them. A row the mode hides is simply absent, and a
// dependent row arrives beside its parent. The gold dot still marks a switch
// the "features on" total counts.
export function SheetRows({
  draft,
  patch,
  gates,
  keys,
  onFlip,
}: StepProps & { keys: readonly SheetRowKey[]; onFlip?: () => void }) {
  const t = useT();
  const rows = tableSheet(t, draft, gates)
    .flatMap((group) => group.rows)
    .filter((row) => keys.includes(row.key))
    .sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key));
  if (!rows.length) {
    return null;
  }
  return (
    <div className="cc-sheet-grid">
      {rows.map((row) => (
        <div
          key={row.key}
          className="cc-row-slot"
          data-dependent={row.dependent ? "true" : "false"}
          data-info={row.info ? "true" : "false"}
        >
          <button
            type="button"
            disabled={row.disabled}
            aria-pressed={row.on}
            onClick={() => {
              patch(flipRow(draft, row.key));
              onFlip?.();
            }}
            className="cc-row motion-press"
          >
            <span className="cc-switch" style={{ "--knob": row.knob } as CSSProperties} aria-hidden="true" />
            <span className="min-w-0">
              <span className="cc-row-label">{row.label}</span>
              <span className="cc-row-hint">{row.hint}</span>
            </span>
          </button>
          {row.counted && row.on ? <span className="cc-dot" aria-hidden="true" /> : null}
          {row.info ? (
            <InfoButton label={t(INFO[row.info].labelKey)} text={t(INFO[row.info].text)} className="absolute right-1.5 top-1.5" />
          ) : null}
        </div>
      ))}
    </div>
  );
}
