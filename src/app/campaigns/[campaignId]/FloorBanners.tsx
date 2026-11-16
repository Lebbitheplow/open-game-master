"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { SessionBanner, bannerButtonClass } from "@/app/campaigns/[campaignId]/SessionBanner";
import type { Floor } from "@/lib/db/campaigns";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import { extraTurnTagT, litOrderRows, orderRowKey } from "@/lib/battlemap/initiative-rows";
import { floorNoticeKey, liveNotice, type HandNotice } from "@/lib/battlemap/hand-table";
import { useT } from "@/lib/locale";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { TurnHoldNote, useTurnHeld } from "@/app/campaigns/[campaignId]/TurnHoldNote";

// Spotlight, held-responses, and initiative banners above the composer;
// the lead gets the release/skip buttons, the current player gets End turn.
export function FloorBanners({
  campaignId,
  floor,
  spotlighted,
  heldSpotlightNames,
  encounter,
  steersStory,
  meUserId = "",
  onRelease,
}: {
  campaignId: string;
  floor: Floor;
  spotlighted: CharacterSheet[];
  heldSpotlightNames: string[];
  encounter?: PublicEncounter | null;
  steersStory: boolean;
  meUserId?: string;
  onRelease: () => void;
}) {
  const [endingTurn, setEndingTurn] = useState(false);
  const t = useT();
  // The end-turn route's refusal, in its own words, under the banner, for
  // the turn it answered only (issue 668).
  const [refusalEntry, setRefusalEntry] = useState<HandNotice | null>(null);
  const refusalKey = floorNoticeKey(floor);
  const refusal = liveNotice(refusalEntry, refusalKey);
  const setRefusal = (text: string) => setRefusalEntry(text ? { text, key: refusalKey } : null);
  const myInitiativeTurn =
    floor.mode === "initiative" && meUserId !== "" && floor.userIds.includes(meUserId);
  // The End Turn is in and the move waits on a watcher's stop.
  const held = useTurnHeld(encounter);

  // Attacks no longer end the turn by themselves (movement and bonus
  // actions stay open), so this is the player's way to say "done".
  async function endTurn() {
    setEndingTurn(true);
    setRefusal("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/encounter/end-turn`, { method: "POST" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setRefusal(data.error ?? t("The turn could not be ended."));
      }
    } catch {
      setRefusal(t("Could not reach the table."));
    } finally {
      setEndingTurn(false);
    }
  }

  return (
    <>
      {floor.mode === "initiative" ? (
        <SessionBanner
          glyph="attitude-hostile"
          tone="blood"
          title={<>{t("Round {round}", { round: floor.round })}</>}
          actions={
            myInitiativeTurn || steersStory ? (
              <>
                {myInitiativeTurn ? (
                  <button
                    type="button"
                    onClick={endTurn}
                    disabled={endingTurn || Boolean(held)}
                    aria-busy={held ? true : undefined}
                    className={bannerButtonClass(true)}
                    title={t("Done with your action, movement, and bonus action? End your combat turn.")}
                  >
                    {held ? t("Ending turn…") : t("End turn")}
                  </button>
                ) : null}
                {steersStory ? (
                  <button
                    type="button"
                    onClick={onRelease}
                    className={bannerButtonClass()}
                    // Marks the banner as holding something only it offers
                    // (world.css keeps it over a docked Hand for this).
                    data-banner-lead=""
                    title={t("Skip the current player's turn")}
                  >
                    {t("Skip turn")}
                  </button>
                ) : null}
              </>
            ) : null
          }
        >
          <span className="block truncate">
              {encounter?.orderReady && encounter.order.length ? (
                <>
                  {encounter.order.map((entry, index) => {
                    // A player's order leaves hidden combatants out, so the
                    // pointer's index can point past them; the engine names
                    // who it rests on. A thief's second round-1 turn is a
                    // second row with the same id (Thief's Reflexes).
                    const current = litOrderRows(encounter.order, encounter.turnIndex, encounter.acting, encounter.enemiesUp).includes(index);
                    return (
                      <span
                        key={orderRowKey(entry, index)}
                        title={extraTurnTagT(t, entry)?.title}
                        className={cn(
                          "transition-opacity duration-200",
                          current ? "font-semibold" : "opacity-60",
                        )}
                      >
                        {index > 0 ? " > " : ""}
                        {entry.name}
                        {entry.reflex ? <sup className="motion-pop ml-0.5 text-[9px] text-amber-300">{extraTurnTagT(t, entry)?.short}</sup> : null}
                      </span>
                    );
                  })}
                </>
              ) : (
                <>{t("{name}'s turn", { name: floor.currentName })}</>
              )}
          </span>
          {held ? <TurnHoldNote held={held} mine={myInitiativeTurn} className="mt-0.5" /> : null}
          {refusal ? (
            <span key={refusal} role="alert" className="mt-0.5 block animate-fade-up text-xs text-amber-200">
              {refusal}
            </span>
          ) : null}
        </SessionBanner>
      ) : null}
      {floor.mode === "spotlight" ? (
        <SessionBanner
          glyph="sense-truesight"
          title={floor.respondedUserIds.length ? t("Spotlight, waiting on") : t("Spotlight")}
          lead={
            spotlighted.some((sheet) => sheet.portrait) ? (
              <span className="flex shrink-0 -space-x-2">
                {spotlighted
                  .filter((sheet) => sheet.portrait)
                  .slice(0, 4)
                  .map((sheet) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={sheet.id}
                      src={sheet.portrait!.url}
                      alt=""
                      className="size-8 rounded-full border border-amber-500/60 object-cover shadow-glow-gold"
                    />
                  ))}
              </span>
            ) : undefined
          }
          actions={
            steersStory ? (
              <button type="button" onClick={onRelease} className={bannerButtonClass(true)}>
                {t("Release")}
              </button>
            ) : null
          }
        >
            <span>
              {spotlighted.length
                ? spotlighted.map((sheet, index) => {
                    const responded = floor.respondedUserIds.includes(sheet.userId);
                    return (
                      <span
                        key={sheet.id}
                        className={responded ? "opacity-50" : undefined}
                      >
                        {index > 0 ? ", " : ""}
                        {sheet.name}
                        {responded ? <Check className="inline size-3 align-baseline" /> : null}
                      </span>
                    );
                  })
                : t("Someone")}
              {floor.prompt ? (
                <span className="opacity-80"> · {floor.prompt}</span>
              ) : null}
            </span>
        </SessionBanner>
      ) : null}
      {floor.mode === "hold" && floor.next.mode === "initiative" && encounter?.enemyTurns ? (
        // A fight held for the enemies' turns (src/lib/dm/enemies-due.ts).
        // Reactions still go through. Held responses wrap the fight's floor
        // too, and keep their own banner below.
        <SessionBanner
          glyph="tab-battle"
          title={t("Enemy turns")}
          actions={
            steersStory ? (
              <button type="button" onClick={onRelease} className={bannerButtonClass(true)}>
                {t("Hand on the turn", { context: "lead.floor.handOn" })}
              </button>
            ) : null
          }
        >
          <span>
            {t("The enemies act before {name}; the GM hands on the turn.", { name: floor.next.currentName || t("the next turn") })}
          </span>
        </SessionBanner>
      ) : floor.mode === "hold" ? (
        <SessionBanner
          glyph="rest-inspiration"
          title={t("Responses held")}
          actions={
            steersStory ? (
              <button type="button" onClick={onRelease} className={bannerButtonClass(true)}>
                {t("Allow responses")}
              </button>
            ) : null
          }
        >
          <span>
            {t("Talk it over; the lead opens the floor.")}
            {heldSpotlightNames.length ? (
              <span className="opacity-80">
                {" "}
                {t("Next: spotlight on {names}", { names: heldSpotlightNames.join(", ") })}
              </span>
            ) : null}
          </span>
        </SessionBanner>
      ) : null}
    </>
  );
}
