"use client";

import { useState } from "react";
import { appConfirm, appNotice } from "@/components/ui/ConfirmDialog";
import { bannerButtonClass } from "@/app/campaigns/[campaignId]/SessionBanner";
import { readWrite } from "@/lib/load-state";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";

// "Save as set-up" on a test table (issue 685, src/lib/workshop/fight-setup.ts):
// the moment on the table becomes the prepared fight's set-up, and every
// test of it opens there from now on. The control the report asked for in
// place of redoing every console step by hand at each test; the set-up is
// loaded by default once it exists, so there is no second control to load
// it. Hidden on a host that cannot save one.

export function SaveSetupButton({ campaignId }: { campaignId: string }) {
  const capabilities = useCapabilities();
  const [busy, setBusy] = useState(false);
  if (!hostOffers(capabilities, "fightSetups")) {
    return null;
  }

  async function save() {
    if (
      !(await appConfirm(
        "Save this moment as the fight's set-up? Every test of it then opens here: the foes and heroes as they stand now, the initiative order, and the map. At a table, the foes start as they stand now too. It replaces any set-up saved before.",
        // A save, so the kit's own button, not the red of a deletion; the
        // sentence above already says it replaces an earlier set-up.
        { title: "Save as set-up", actionLabel: "Save as set-up", tone: "plain" },
      ))
    ) {
      return;
    }
    setBusy(true);
    const sent = await readWrite<{ lines: string[]; keptMap: boolean }>(
      fetch(`/api/campaigns/${campaignId}/fight-setup`, { method: "POST" }),
      "The set-up could not be saved.",
    );
    setBusy(false);
    if (sent.error !== null) {
      await appNotice(sent.error, "Not saved");
      return;
    }
    const kept = sent.payload.keptMap ? " The fight keeps this map too: it is in the workshop's maps." : "";
    await appNotice(`${sent.payload.lines.join(" ")}${kept}`, "Set-up saved");
  }

  return (
    <button type="button" disabled={busy} aria-busy={busy} onClick={() => void save()} className={bannerButtonClass()} data-save-setup>
      {busy ? "Saving..." : "Save as set-up"}
    </button>
  );
}
