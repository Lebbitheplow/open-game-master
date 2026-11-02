// The GM's status as the campaign stream heard it
// (src/app/campaigns/[campaignId]/useCampaignStream.ts), for a control that
// sits outside the stream's state and reads again as a turn runs, parks and
// ends: the test fight's turn trace (issue 685). One stream per table; a
// second one opened for the trace would cost a connection for one sheet.
// Browser only, and no "@/" imports.

export const DM_STATUS_EVENT = "odm:dm-status";

export type DmStatusDetail = { campaignId: string; state: string };

export function announceDmStatus(campaignId: string, state: unknown): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<DmStatusDetail>(DM_STATUS_EVENT, { detail: { campaignId, state: typeof state === "string" ? state : "" } }),
  );
}
