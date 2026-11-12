// The martial subclasses' rows wave 2 built (fighter, barbarian, monk,
// rogue): registered in AUTHORED_TABLE (authored-effects.ts) with one line,
// so no other package appends to this array.

import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";
import { ECHO_OUT } from "@/lib/srd/authored-effects-data-b";

// The condition an ally who answered Call the Hunt carries until the
// barbarian's rage ends: its d6 rides one hit on each of the ally's turns
// (src/lib/dm/attack-damage-riders.ts).
export const CALL_THE_HUNT = "call the hunt";

export const AUTHORED_DATA_W2_MARTIAL: Record<string, AuthoredEntry> = {
  // "Make one extra melee attack from your echo's space when you take the
  // Attack action": one more attack in the action being taken, while the echo
  // is out. Before this the use was spent and the guidance returned.
  "fighter::Unleash Incarnation": {
    subclass: "Echo Knight",
    counter: "sub_unleash_incarnation",
    spends: [
      {
        name: "Unleash Incarnation",
        pool: { id: "sub_unleash_incarnation" },
        action: "none",
        gate: { condition: ECHO_OUT, because: "needs the echo out: use_resource Manifest Echo first" },
        does: { kind: "action_attack", fromEcho: true, note: "a melee attack made from the echo's space: pc_attack reaches from the echo's square when it is the nearer." },
      },
    ],
  },
  // "When you enter your rage" is the turn's RAGE_ENTERED mark
  // (trigger-table.ts sub_call_the_hunt), checked before the use is spent.
  "barbarian::Call the Hunt": {
    subclass: "Path of the Beast",
    counter: "sub_call_the_hunt",
    spends: [
      {
        name: "Call the Hunt",
        pool: { id: "sub_call_the_hunt" },
        // No raging gate: the rage just entered is the trigger, so it holds.
        action: "none",
        does: { kind: "allies_join", condition: CALL_THE_HUNT, rangeFt: 30, count: (_level, mods) => Math.max(1, mods.con ?? 0), rounds: 10, tempHpEach: 5, whileRaging: true },
      },
    ],
  },
};
