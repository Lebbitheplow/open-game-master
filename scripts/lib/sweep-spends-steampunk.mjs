// The stagings the steampunk classes' counters answer, for the "spends" sweep
// (scripts/lib/sweep-spends-walk.mjs asks here before its own steps). Each is
// what happened at the table before the call, staged through the engine's own
// doors where it has one. Kept apart so the genre rounds that run beside this
// one never add a case at the same line of the walk.
//
//   "the holder was disarmed"  Backup Rig ("1/long rest, ignore being
//     disarmed") answers the mark a disarm leaves on a creature
//     (src/lib/srd/genre-b-steampunk-attacks.ts DISARMED), laid as the GM lays it.
//   "a lightning hit on the holder"  Capacitor Soul ("reaction when a
//     lightning or aether effect hits you") answers a hit of that type.
export const STEAMPUNK_OWN_TURN = ["the holder was disarmed"];
export const STEAMPUNK_TRIGGERS = ["a lightning hit on the holder"];

export async function steampunkStep(rig, scene, name) {
  const { world } = rig;
  const holder = scene.holder.id;
  switch (name) {
    case "the holder was disarmed":
      return world.invoke("set_condition", { characterId: holder, condition: "disarmed", reason: "the foe's disarm" });
    case "a lightning hit on the holder":
      rig.kit.setEnemy(scene.near.id, { stats: { attacks: [{ name: "Arc", toHit: 4, damage: "1d6+2", type: "lightning" }] } });
      rig.foesTurn(scene);
      world.dice(9, 4);
      return world.invoke("enemy_attack", { enemyId: scene.near.id, targetCharacterId: holder });
    default:
      return null;
  }
}
