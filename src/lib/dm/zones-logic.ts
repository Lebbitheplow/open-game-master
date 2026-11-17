// Zones of a place (docs/specs/ogm-npc-perception.md §6): a few named parts of
// a scene with which part touches which, so a whisper, a look in the storm
// or a hand on someone can be decided by distance. A model proposes them once
// from the place's description; these rules check and use them. Pure.
import { clipText, textKey } from "@/lib/language/text-logic";
import { replyJsonObject } from "@/lib/reply-json-logic";

export type Zone = { name: string; adjacent: string[] };
export type PlaceZones = { zones: Zone[] };

export const MAX_ZONES = 6;

// 0 same zone, 1 next to it, 2 farther. An unknown zone is taken as next to
// everything: nothing is hidden by a position the server never had.
export type Distance = 0 | 1 | 2;

export function zoneNamed(place: PlaceZones, name: string): string | null {
  return place.zones.find((zone) => textKey(zone.name) === textKey(name))?.name ?? null;
}

export function distance(place: PlaceZones | null, a: string, b: string): Distance {
  if (!place || !a || !b) {
    return a && b && textKey(a) === textKey(b) ? 0 : 1;
  }
  const from = zoneNamed(place, a);
  const to = zoneNamed(place, b);
  if (!from || !to) {
    return 1;
  }
  if (textKey(from) === textKey(to)) {
    return 0;
  }
  return place.zones.find((zone) => zone.name === from)?.adjacent.some((name) => textKey(name) === textKey(to)) ? 1 : 2;
}

// The zones as proposed, kept only if they make a place: at most six, named
// once each, every neighbour a real zone, the relation made symmetric, all
// of them reachable from the first. Otherwise null, and the place is one zone.
export function validateZones(raw: unknown): PlaceZones | null {
  const list = Array.isArray(raw) ? raw : [];
  const zones: Zone[] = [];
  for (const entry of list.slice(0, MAX_ZONES)) {
    const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const name = typeof record.name === "string" ? clipText(record.name.trim(), 40) : "";
    if (!name || zones.some((zone) => textKey(zone.name) === textKey(name))) {
      continue;
    }
    zones.push({ name, adjacent: (Array.isArray(record.adjacent) ? record.adjacent : []).filter((value): value is string => typeof value === "string") });
  }
  if (zones.length < 2) {
    return null;
  }
  const real = (name: string) => zones.find((zone) => textKey(zone.name) === textKey(name))?.name ?? null;
  for (const zone of zones) {
    zone.adjacent = [...new Set(zone.adjacent.map(real).filter((name): name is string => Boolean(name) && name !== zone.name))];
  }
  for (const zone of zones) {
    for (const name of zone.adjacent) {
      const other = zones.find((entry) => entry.name === name)!;
      if (!other.adjacent.includes(zone.name)) {
        other.adjacent.push(zone.name);
      }
    }
  }
  const seen = new Set([zones[0].name]);
  const queue = [zones[0].name];
  while (queue.length) {
    const next = queue.shift();
    const current = zones.find((zone) => zone.name === next)!;
    for (const name of current.adjacent) {
      if (!seen.has(name)) {
        seen.add(name);
        queue.push(name);
      }
    }
  }
  return seen.size === zones.length ? { zones } : null;
}

export const ZONES_SYSTEM = [
  "You divide one place of a tabletop role-playing scene into a few zones, so the game can tell who is near whom.",
  `Give 2 to ${MAX_ZONES} zones, each a short name in the scene's language (a part of the place: "centro", "bordo nord", "poppa", "la porta", "il bancone"), and for each the zones it touches. Small places get few zones.`,
  "Then say in which zone each listed person stands now, from the description and the recent scene; a person not placed anywhere goes to the first zone.",
  'Answer with ONE JSON object and nothing else: {"zones": [{"name": "...", "adjacent": ["..."]}], "placements": {"Name": "zone"}}.',
].join("\n");

export function renderZonesPrompt(input: { place: string; layout: string; people: readonly string[]; scene: string }): string {
  return [
    `Place: ${input.place}`,
    input.layout ? `What it looks like: ${clipText(input.layout, 1200)}` : "",
    input.scene ? `The recent scene: ${clipText(input.scene, 1200)}` : "",
    `People here: ${input.people.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseZoneProposal(text: string, people: readonly string[]): { zones: PlaceZones; placements: Record<string, string> } | null {
  const parsed = replyJsonObject(text);
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  const zones = record ? validateZones(record.zones) : null;
  if (!zones) {
    return null;
  }
  const raw = record?.placements && typeof record.placements === "object" ? (record.placements as Record<string, unknown>) : {};
  const placements: Record<string, string> = {};
  for (const person of people) {
    const said = Object.entries(raw).find(([name]) => textKey(name) === textKey(person))?.[1];
    placements[person] = (typeof said === "string" && zoneNamed(zones, said)) || zones.zones[0].name;
  }
  return { zones, placements };
}

// Where everyone stands, as a mind or the referee reads it.
export function positionsLine(place: PlaceZones, positions: ReadonlyArray<{ name: string; zone: string }>, self?: string): string {
  return place.zones
    .map((zone) => {
      const here = positions.filter((entry) => textKey(entry.zone) === textKey(zone.name)).map((entry) => (self && textKey(entry.name) === textKey(self) ? "you" : entry.name));
      return `${zone.name} (next to: ${zone.adjacent.join(", ") || "nothing"}): ${here.join(", ") || "nobody"}`;
    })
    .join("; ");
}

// Verbs that need a hand on the other: done to someone in another zone, the
// actor goes to them first.
export const CONTACT_VERBS = new Set(["push", "grab", "strike", "touch", "embrace", "bind", "free", "give", "steal", "heal"]);
