"use client";

import Link from "next/link";
import { useState } from "react";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { SessionBanner, bannerButtonClass } from "@/app/campaigns/[campaignId]/SessionBanner";
import { PanelError } from "@/app/campaigns/[campaignId]/PanelKit";
import { TurnTraceButton } from "@/app/campaigns/[campaignId]/TurnTraceSheet";
import { TestDiceScript } from "@/app/campaigns/[campaignId]/TestDiceScript";
import { navigateTo } from "@/lib/navigation";
import { SaveSetupButton } from "@/app/campaigns/[campaignId]/SaveSetupButton";
import { workshopHref } from "@/lib/workshop/links";
import { useT } from "@/lib/locale";

// The test fight's way back (issue 553, src/lib/workshop/test-fight.ts): a
// test table is in no campaign list, so the table itself says what it is and
// offers the two ways out. Back keeps the test for later, from the
// workshop's Encounters; End deletes the table and everything played on it.

export function TestFightBanner({
  campaignId,
  source,
  runsIt,
}: {
  campaignId: string;
  source: { workshopId: string; title: string };
  // Who runs the enemies: the AI DM, with the author steering from the GM
  // seat (issue 685), or the author from the DM seat.
  runsIt: "ai" | "person";
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const back = workshopHref(`/workshop/${source.workshopId}`, { system: "encounters" });

  async function end() {
    if (
      !(await appConfirm(t("End this test fight? Its table and everything played on it are deleted. The prepared fight stays in the workshop."), {
        title: t("End the test"),
        actionLabel: t("End the test"),
      }))
    ) {
      return;
    }
    setBusy(true);
    setError("");
    const response = await fetch(`/api/campaigns/${campaignId}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) {
      const payload = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
      setError(payload?.error ?? (response ? t("The test could not be ended.", { context: "table.misc.testFight.endFailed" }) : t("Could not reach the server, so the test is still open.")));
      setBusy(false);
      return;
    }
    navigateTo(back);
  }

  return (
    <SessionBanner
      glyph="tab-battle"
      title={t("Test fight")}
      className="test-fight-banner"
      actions={
        <>
          <Link href={back} className={bannerButtonClass()}>
            {t("Back to the workshop")}
          </Link>
          <SaveSetupButton campaignId={campaignId} />
          <TurnTraceButton campaignId={campaignId} />
          <TestDiceScript campaignId={campaignId} />
          <button type="button" disabled={busy} aria-busy={busy} onClick={() => void end()} className={bannerButtonClass(true)}>
            {t("End the test")}
          </button>
        </>
      }
    >
      {/* Left out on a phone while a Hand is dealt (hand.css): the title
          and the way out stay, and the chronicle and the Hand get the room
          (issue 713). */}
      <span className="test-fight-say">
        {runsIt === "ai"
          ? t("From {name}. Only you can see this table: the AI GM runs the enemies and you play the party, each hero on their own turn. The GM console is yours for set-ups and corrections.", { name: source.title })
          : t("From {name}. Only you can see this table, and you run it: the party's cards on each hero's turn, the enemies' cards on theirs.", { name: source.title })}
      </span>
      {error ? <PanelError className="mt-1 text-[11px]">{error}</PanelError> : null}
    </SessionBanner>
  );
}
