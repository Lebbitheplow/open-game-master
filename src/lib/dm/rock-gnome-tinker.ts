// A rock gnome's Tinker (SRD 5.1, src/lib/srd/races.json): "Using those tools,
// you can spend 1 hour and 10 gp worth of materials to construct a Tiny
// clockwork device (AC 5, 1 hp). The device ceases to function after 24 hours
// (unless you spend 1 hour repairing it to keep the device functioning), or
// when you use your action to dismantle it; at that time, you can reclaim the
// materials used to create it. You can have up to three such devices active at
// a time." The devices: a clockwork toy, a fire starter, a music box.
//
// Each device is a row of the gnome's pack carrying the instant it was made
// or last repaired (`madeAt`, the clock's whole minutes): it works for the 24
// hours after that instant, and only working devices count toward three.
// use_resource "Tinker" with the device's name makes one (an hour on the
// clock, 10 gp from the purse, tinker's tools in the pack, out of a fight);
// "repair <device>" spends an hour and starts its 24 hours again;
// "dismantle <device>" takes it apart (an action in a fight) and gives the
// 10 gp back. Reached through mt-species-spends.ts speciesTraitSpend.
import type { Campaign } from "@/lib/db/campaigns";
import { advanceClock, getClock } from "@/lib/db/clock";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { priceTheAction, publishSheet } from "@/lib/dm/combat-features";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { fromCopper, purseCopper } from "@/lib/srd/currency";
import { holdsFeature } from "@/lib/srd/feature-names";
import { srdRaceId } from "@/lib/srd/race-id";

export const TINKER_DEVICES = ["Clockwork Toy", "Fire Starter", "Music Box"] as const;
const MAX_ACTIVE = 3;
const WORKS_MINUTES = 24 * 60;
const COST_COPPER = 10 * 100;
const TOOLS = "tinker's tools";

export function holdsTinker(sheet: Pick<CharacterSheet, "race" | "features">): boolean {
  return srdRaceId(sheet.race ?? "") === "rock_gnome" || holdsFeature(sheet as CharacterSheet, "Tinker");
}

const deviceNamed = (name: string) => TINKER_DEVICES.find((device) => textKey(device) === textKey(name)) ?? null;

// A Tinker device of the pack: one of the three names, with its instant.
export function isTinkerDevice(item: EquipmentItem): boolean {
  return typeof item.madeAt === "number" && deviceNamed(item.name) !== null;
}

// Working: made or repaired less than 24 hours ago. Pure.
export function deviceWorks(item: EquipmentItem, now: number): boolean {
  return isTinkerDevice(item) && now - (item.madeAt as number) < WORKS_MINUTES;
}

export function activeDevices(equipment: readonly EquipmentItem[], now: number): EquipmentItem[] {
  return equipment.filter((item) => deviceWorks(item, now));
}

// "repair music box" / "dismantle fire starter" / "music box".
const VERBS = new Set(["repair", "dismantle"]);
function readVariant(variant: string | undefined): { verb: "make" | "repair" | "dismantle"; device: string | null } {
  const [head = "", ...rest] = textKey(variant ?? "").split(" ");
  const verb = VERBS.has(head) ? (head as "repair" | "dismantle") : "make";
  const named = verb === "make" ? [head, ...rest].join(" ") : rest.join(" ");
  return { verb, device: named ? deviceNamed(named) : null };
}

export function tinker(campaign: Campaign, stale: CharacterSheet, variant: string | undefined): ToolResult {
  const sheet = getSheetById(stale.id) ?? stale;
  const { verb, device } = readVariant(variant);
  const choices = TINKER_DEVICES.join(", ");
  if (!device) {
    return { error: `Tinker makes a ${choices}; name one in variant (or "repair <device>", "dismantle <device>").`, retry: true };
  }
  const now = getClock(campaign.id).instant;
  const fight = getActiveEncounter(campaign.id);
  const rows = sheet.equipment.map((item, index) => ({ item, index })).filter(({ item }) => isTinkerDevice(item) && textKey(item.name) === textKey(device));
  if (verb === "dismantle") {
    const row = rows[0];
    if (!row) {
      return { error: `${sheet.name} has no ${device} of their Tinker to dismantle. Nothing was spent.`, refused: "rules" };
    }
    const price = fight ? priceTheAction(sheet, fight, "Tinker") : null;
    if (price && "error" in price) return toolError(price);
    const left = fromCopper(purseCopper({ gold: sheet.gold ?? 0, copper: sheet.copper ?? 0 }) + COST_COPPER);
    patchSheet(sheet.id, { equipment: sheet.equipment.filter((_, index) => index !== row.index), gold: left.gold, copper: left.copper });
    publishSheet(campaign, sheet.id);
    price?.commit();
    return { ok: true, resource: "Tinker", applied: `${sheet.name} dismantles the ${device} and reclaims its 10 gp of materials.` };
  }
  if (fight) {
    return { error: `Tinker is an hour's work, and a fight is on. Nothing was spent.`, refused: "rules" };
  }
  if (!sheet.equipment.some((item) => textKey(item.name) === textKey(TOOLS))) {
    return { error: `${sheet.name} needs tinker's tools to work on a clockwork device; their pack holds none. Nothing was spent.`, refused: "rules" };
  }
  const working = activeDevices(sheet.equipment, now);
  if (verb === "repair") {
    // A stopped one of that name first: the one the hour brings back.
    const row = rows.find(({ item }) => !deviceWorks(item, now)) ?? rows[0];
    if (!row) {
      return { error: `${sheet.name} has no ${device} of their Tinker to repair. Nothing was spent.`, refused: "rules" };
    }
    if (!deviceWorks(row.item, now) && working.length >= MAX_ACTIVE) {
      return { error: `${sheet.name} already has ${MAX_ACTIVE} clockwork devices working, as many as Tinker allows. Nothing was spent.`, refused: "rules" };
    }
    const hour = advanceClock(campaign.id, 1, "hours");
    if ("error" in hour) return toolError(hour);
    patchSheet(sheet.id, { equipment: sheet.equipment.map((item, index) => (index === row.index ? { ...item, madeAt: hour.clock.instant } : item)) });
    publishSheet(campaign, sheet.id);
    return { ok: true, resource: "Tinker", applied: `After an hour's repair ${sheet.name}'s ${device} works for another 24 hours.` };
  }
  if (working.length >= MAX_ACTIVE) {
    return { error: `${sheet.name} already has ${MAX_ACTIVE} clockwork devices working, as many as Tinker allows; dismantle one first. Nothing was spent.`, refused: "rules" };
  }
  const purse = purseCopper({ gold: sheet.gold ?? 0, copper: sheet.copper ?? 0 });
  if (purse < COST_COPPER) {
    return { error: `A clockwork device takes 10 gp of materials, and ${sheet.name} has less. Nothing was spent.`, refused: "rules" };
  }
  const hour = advanceClock(campaign.id, 1, "hours");
  if ("error" in hour) return toolError(hour);
  const left = fromCopper(purse - COST_COPPER);
  const made: EquipmentItem = { name: device, qty: 1, madeAt: hour.clock.instant } as EquipmentItem;
  patchSheet(sheet.id, { equipment: [...sheet.equipment, made], gold: left.gold, copper: left.copper });
  publishSheet(campaign, sheet.id);
  return {
    ok: true,
    resource: "Tinker",
    applied: `After an hour's work and 10 gp of materials ${sheet.name} has a ${device} (Tiny, AC 5, 1 hit point): it works for 24 hours. ${working.length + 1} of ${MAX_ACTIVE} devices working.`,
  };
}
