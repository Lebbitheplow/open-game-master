// The stagings the steampunk classes' counters answer, for the "spends" sweep
// (scripts/lib/sweep-spends-walk.mjs asks here before its own steps). Each is
// what happened at the table before the call, staged through the engine's own
// doors where it has one. Kept apart so the genre rounds that run beside this
// one never add a case at the same line of the walk.
//
//   "the holder was disarmed"  Backup Rig ("1/long rest, ignore being
//     disarmed") answers the mark a disarm leaves on a creature
//     (src/lib/srd/genre-b-steampunk-attacks.ts DISARMED), laid as the GM lays it.
export const STEAMPUNK_OWN_TURN = ["the holder was disarmed"];

export async function steampunkStep(rig, scene, name) {
  const { world } = rig;
  const holder = scene.holder.id;
  switch (name) {
    case "the holder was disarmed":
      return world.invoke("set_condition", { characterId: holder, condition: "disarmed", reason: "the foe's disarm" });
    default:
      return null;
  }
}
