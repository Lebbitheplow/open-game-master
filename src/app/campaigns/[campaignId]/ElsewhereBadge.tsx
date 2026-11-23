"use client";

import { cn } from "@/lib/cn";
import { nameList, placeAway, type PartyGroup } from "@/lib/dm/party-split-logic";
import type { PartyState } from "@/lib/dm/party-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { useT } from "@/lib/locale";

// A party that split up (issue 951): who is not where the story is, said
// wherever the party is listed. The server keeps it on the party record
// (party.away, src/lib/dm/party-split.ts); a host that keeps no such record
// sends none, and nothing here shows. Each mark comes in over 300 ms when the
// server moves somebody, as a combatant's side does (globals.css .side-badge);
// reduced motion keeps the words.

type T = (key: string, vars?: Record<string, string | number>) => string;

// Where a character is when they are not in the scene, or null. "" is
// somewhere the story never named.
export function elsewherePlace(away: readonly PartyGroup[] | undefined, id: string, sheets: readonly CharacterSheet[]): string | null {
  return away?.length ? placeAway(away, id, sheets) : null;
}

export function elsewhereWords(t: T, place: string): string {
  return place ? t("at {place}", { place }) : t("elsewhere");
}

// The pill beside a name.
export function ElsewhereBadge({ place, className }: { place: string | null; className?: string }) {
  const t = useT();
  if (place === null) {
    return null;
  }
  return (
    <span
      key={place}
      data-elsewhere={place}
      title={t("Not where the story is now. The story comes back to them when they act.")}
      className={cn(
        "side-badge inline-flex max-w-full items-center rounded-full border border-stone-500 bg-stone-800 px-1.5 text-[10px] font-medium leading-4 text-stone-100",
        className,
      )}
    >
      <span className="truncate">{place ? t("At {place}", { place }) : t("Elsewhere")}</span>
    </span>
  );
}

// The scene line under the title while the party is split up: the place, and
// who the story is with there.
export function sceneWithWords(scene: string, party: PartyState | undefined, sheets: readonly CharacterSheet[]): string {
  if (!party?.away?.length) {
    return scene;
  }
  const here = sheets.filter((sheet) => !sheet.isCompanion && !sheet.summon && placeAway(party.away, sheet.id, sheets) === null).map((sheet) => sheet.name);
  return scene && here.length ? `${scene} · ${nameList(here)}` : scene;
}

// Above the composer, for a player whose own character is elsewhere: why the
// story did not answer them at once.
export function ElsewhereNotice({ party, sheets, meUserId }: { party: PartyState | undefined; sheets: CharacterSheet[]; meUserId: string }) {
  const t = useT();
  const mine = sheets.filter((sheet) => sheet.userId === meUserId && !sheet.isCompanion && !sheet.summon);
  const gone = mine.flatMap((sheet) => {
    const place = elsewherePlace(party?.away, sheet.id, sheets);
    return place === null ? [] : [{ sheet, place }];
  });
  if (!gone.length) {
    return null;
  }
  return (
    <div role="status" className="space-y-1">
      {gone.map(({ sheet, place }) => (
        <p key={sheet.id} data-elsewhere-notice={sheet.id} className="side-badge rounded-lg border border-stone-500 bg-stone-800 px-3 py-1.5 text-xs text-stone-100">
          {t("{name} is {where}, away from where the story is now. Say what {name} does: the story comes to them once the others have had their reply.", {
            name: sheet.name,
            where: elsewhereWords(t, place),
          })}
        </p>
      ))}
    </div>
  );
}
