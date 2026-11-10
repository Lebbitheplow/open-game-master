// The Deploy dialog's questions and the body it sends (DeployOpeningDialog.tsx):
// the console's Start a fight fields for how a fight opens, by name, and the
// deploy route's body made from them (fight-opening.ts openingOptionsSchema).
// Pure, so a suite can hold the names to both lists.

// The start_encounter fields the dialog asks, in its order.
export const OPENING_FIELDS = ["absent", "ambush", "surprised", "scene", "distanceFeet", "buildingEnemySide", "buildingOpenings", "lair", "from"] as const;

// The deploy route's body from the form's arguments: the building's two
// fields are one object there.
export function openingBody(args: Record<string, unknown>): Record<string, unknown> {
  const { buildingEnemySide, buildingOpenings, ...rest } = args;
  const openings = Number(buildingOpenings);
  return {
    ...rest,
    ...(typeof buildingEnemySide === "string" && buildingEnemySide
      ? { building: { enemySide: buildingEnemySide, ...(Number.isFinite(openings) && openings > 0 ? { openings } : {}) } }
      : {}),
  };
}
