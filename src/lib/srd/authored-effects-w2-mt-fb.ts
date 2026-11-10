// The fighter and barbarian subclass rows the martial package's fb part built
// in wave 2 of the 2026-11-09 gap sweep: registered in AUTHORED_TABLE
// (authored-effects.ts) with one line, so no other part appends to this
// object. A key here that an older table also carries replaces that row whole.

import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

export const AUTHORED_DATA_W2_MT_FB: Record<string, AuthoredEntry> = {
  // "a reaction-free end to being charmed or frightened by spending a die"
  // (the resistance is feature-effects.ts's): a die was spent under the
  // variant and the fighter stayed frightened.
  "fighter::Guarded Mind": {
    subclass: "Psi Warrior",
    spends: [{ name: "Guarded Mind", pool: { id: "sub_psionic_energy" }, action: "none", does: { kind: "cleanse", conditions: ["charmed", "frightened"] } }],
  },
};
