// The cyberpunk classes' rows the fifth genre-a round adds (WAVE2 D5: the
// genre text is the rule, played on the SRD 5.1 engine). Same shapes as
// src/lib/srd/authored-effects-genre-a.ts; kept apart so the three genre
// branches of the round each append to a file of their own. The ledger
// (scripts/clauses/genre-cyberpunk.json) says which clause each row holds.
import type { AuthoredEffect, AuthoredEntry } from "@/lib/srd/authored-effects-types";
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

const row = (classId: string, feature: string, effects: AuthoredEffect[], more: Partial<AuthoredEntry> = {}): GenreRow => ({
  feature,
  classes: [classId],
  entry: { subclass: "genre", effects, ...more },
});

// "Pick one: +2 to ranged attack rolls, +1 AC in light or medium armor, or
// +2 melee damage." The pick is kept on the sheet as "Combat Wetware
// (Smartlink)", the form a "choose" spend writes (Totem Spirit's), and each
// option's row holds only while it is the one chosen.
export const COMBAT_WETWARE_OPTIONS = ["Smartlink", "Dermal Weave", "Muscle Graft"] as const;
const [SMARTLINK, WEAVE, GRAFT] = COMBAT_WETWARE_OPTIONS;

export const GENRE_A_CYBERPUNK: GenreRow[] = [
  row(
    "street_samurai",
    "Combat Wetware",
    [
      { kind: "attack_bonus", amount: 2, when: "ranged", gate: { choice: SMARTLINK } },
      { kind: "ac", amount: 1, gate: { choice: WEAVE, lightOrMedium: true } },
      { kind: "hit_rider", dice: "2", when: "melee", gate: { choice: GRAFT } },
    ],
    { spends: [{ name: "Combat Wetware", fight: "out", does: { kind: "choose", options: [...COMBAT_WETWARE_OPTIONS] } }] },
  ),
];

// The defenses read by src/lib/dm/genre-a-cyberpunk-defenses.ts.
GENRE_A_CYBERPUNK.push(
  // "Resistance to falling damage; 1/turn, shove a target 10 ft with a psionic hit."
  row("esper", "Kinetic Buffer", [{ kind: "fall_resist" }, { kind: "spell_push", feet: 10, oncePerTurn: true }]),
  row("esper", "Split Focus", [{ kind: "concentration_adv" }]),
  row("trauma_doc", "Shield the Fallen", [{ kind: "attacked_disadv", from: [], besideDowned: true }]),
);

// The programs and psionics, read by src/lib/dm/genre-a-cyberpunk-programs.ts.
GENRE_A_CYBERPUNK.push(
  row("netrunner", "Lethal Payload", [{ kind: "program_rider", dice: "1d8", type: "lightning", oncePerTurn: true }]),
  row("esper", "Neural Spike", [{ kind: "program_rider", dice: "cha", type: "psychic", oncePerTurn: true }]),
  row("netrunner", "Flatline Protocol", [{ kind: "program_crit", low: 19, vsTypes: ["construct"], casters: true }]),
);
