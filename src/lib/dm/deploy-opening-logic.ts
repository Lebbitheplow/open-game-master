// The Deploy dialog's questions and the body it sends (DeployOpeningDialog.tsx):
// the console's Start a fight fields for how a fight opens, by name, and the
// deploy route's body made from them (fight-opening.ts openingOptionsSchema).
// Pure, so a suite can hold the names to both lists.

// The start_encounter fields the dialog asks, in its order.
export const OPENING_FIELDS = ["absent", "ambush", "surprised", "scene", "distanceFeet", "buildingEnemySide", "buildingOpenings", "lair", "from"] as const;

// A field the GM left as it opened: no answer. The form holds a blank select
// or number as "", nobody away as [], and an unticked lair as false; the
// console's own door drops a blank input the same way (src/lib/dm/invoke.ts
// normalizeArgs). The deploy route's schema takes none of them, so the
// dialog's first Deploy, every field untouched, was refused for "ambush";
// and an unticked box sent would undo a lair the fight was prepared with.
function blank(value: unknown): boolean {
  return value === undefined || value === null || value === false || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);
}

// The deploy route's body from the form's arguments: only the fields given,
// the distance as a number (a number input holds text), and the building's
// two fields as one object.
export function openingBody(args: Record<string, unknown>): Record<string, unknown> {
  const { buildingEnemySide, buildingOpenings, ...rest } = args;
  const openings = Number(buildingOpenings);
  const given = Object.entries(rest).filter(([, value]) => !blank(value));
  return {
    ...Object.fromEntries(given.map(([name, value]) => [name, name === "distanceFeet" ? Number(value) : value])),
    ...(typeof buildingEnemySide === "string" && buildingEnemySide
      ? { building: { enemySide: buildingEnemySide, ...(Number.isFinite(openings) && openings > 0 ? { openings } : {}) } }
      : {}),
  };
}
