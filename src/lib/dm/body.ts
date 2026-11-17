// The body owner's clock work (docs/specs/ogm-npc-perception.md §8): the
// weather counted on each mind on stage since it was last counted, and the
// words a mind and the referee read of its body. The rules are body-logic's.
import type { Campaign } from "@/lib/db/campaigns";
import { npcThings } from "@/lib/db/cast-sheets";
import { getClock } from "@/lib/db/clock";
import { listDroppedItems } from "@/lib/db/dropped-items";
import { getCurrentLocation } from "@/lib/db/locations";
import { getNpcById, setNpcState, type Npc } from "@/lib/db/npcs";
import { listSheets } from "@/lib/db/sheets";
import { adsWords, bodyRefereeWords, bodyWords, isCovering, moodles, tickBody, type Visible } from "@/lib/dm/body-logic";
import { zoneOf } from "@/lib/dm/scene-place";
import { currentScene } from "@/lib/dm/sky";
import { textKey } from "@/lib/language/text-logic";

// The weather on each body, hour by whole hour since it was last counted. A
// body counted for the first time starts dry and warm from now.
export function weatherOnBodies(campaign: Campaign, npcs: readonly Npc[]) {
  const now = getClock(campaign.id).instant;
  const weather = currentScene(campaign).weather;
  for (const npc of npcs) {
    if (npc.state.condition === "dead") {
      continue;
    }
    const since = npc.state.bodyAt;
    if (since === undefined || !weather) {
      setNpcState(npc.id, { ...npc.state, bodyAt: now });
      continue;
    }
    const hours = Math.floor((now - since) / 60);
    if (hours < 1) {
      continue;
    }
    const next = tickBody({ wet: npc.state.wet ?? 0, cold: npc.state.cold ?? 0 }, hours, {
      temperature: weather.temperature,
      wind: weather.wind,
      precipitation: weather.precipitation,
      sheltered: false,
      covered: isCovering(npcThings(npc)),
    });
    setNpcState(npc.id, { ...npc.state, ...next, bodyAt: since + hours * 60 });
  }
}

// Everything in sight here a need could reach for: what lies loose, what the
// heroes and the minds here hold.
function visibleThings(campaign: Campaign, present: readonly Npc[]): Visible[] {
  const here = textKey(getCurrentLocation(campaign.id)?.name ?? "");
  const ground = listDroppedItems(campaign.id)
    .filter((entry) => !entry.heldByEnemy && (!here || textKey(entry.place) === here))
    .map((entry) => ({ name: entry.item.name, owner: "" }));
  const heroes = listSheets(campaign.id)
    .filter((sheet) => !sheet.isCompanion)
    .flatMap((sheet) => sheet.equipment.map((item) => ({ name: item.name, owner: sheet.name, zone: zoneOf(campaign, sheet.name) })));
  const minds = present.flatMap((npc) => npcThings(npc).map((name) => ({ name, owner: npc.name, zone: zoneOf(campaign, npc.name) })));
  return [...ground, ...heroes, ...minds];
}

// What a mind feels of its body beyond thirst and hunger, and what in sight
// would ease the needs that press.
export function bodyFrame(campaign: Campaign, npc: Npc, present: readonly Npc[]): string {
  const fresh = getNpcById(npc.id) ?? npc;
  const levels = moodles(fresh.state, getClock(campaign.id).instant);
  const felt = bodyWords(levels);
  return [felt ? `You also feel: ${felt}.` : "", adsWords(levels, visibleThings(campaign, present), npc.name)].filter(Boolean).join(" ");
}

export function bodyForReferee(campaign: Campaign, npc: Npc): string {
  return bodyRefereeWords(moodles(npc.state, getClock(campaign.id).instant));
}
