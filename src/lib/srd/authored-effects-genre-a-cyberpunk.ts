// The cyberpunk classes' rows the fifth genre-a round adds (WAVE2 D5: the
// genre text is the rule, played on the SRD 5.1 engine). Same shapes as
// src/lib/srd/authored-effects-genre-a.ts; kept apart so the three genre
// branches of the round each append to a file of their own. The ledger
// (scripts/clauses/genre-cyberpunk.json) says which clause each row holds.
import type { AuthoredEffect, AuthoredEntry } from "@/lib/srd/authored-effects-types";
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

const counted = (classId: string, feature: string, counter: string, more: Omit<AuthoredEntry, "subclass" | "counter">): GenreRow => ({
  feature,
  classes: [classId],
  entry: { subclass: "genre", counter, ...more },
});

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

// "Your healing dice each count as at least half their maximum."
GENRE_A_CYBERPUNK.push(row("trauma_doc", "Perfected Formula", [{ kind: "heal_floor" }]));

// "1/turn, dropping a foe to 0 HP grants one extra weapon attack immediately."
GENRE_A_CYBERPUNK.push(row("street_samurai", "Apex Predator", [{ kind: "kill_attack" }]));

// The counters spent through src/lib/dm/genre-a-cyberpunk-spends.ts.
GENRE_A_CYBERPUNK.push(
  // "1/long rest, one drone turns invisible for 1 minute."
  counted("rigger", "Ghost Protocol", "cyberpunk_ghost_protocol", {
    spends: [{ name: "Ghost Protocol", pool: { id: "cyberpunk_ghost_protocol" }, action: "none", does: { kind: "cyber_spend", what: "ghost_protocol" } }],
  }),
  // "1/week, restore a creature dead less than 1 minute to life at half HP."
  counted("trauma_doc", "Lazarus Protocol", "cyberpunk_lazarus_protocol", {
    spends: [{ name: "Lazarus Protocol", pool: { id: "cyberpunk_lazarus_protocol" }, action: "action", does: { kind: "cyber_spend", what: "lazarus" } }],
  }),
  // "1/long rest, a creature hit by your psionic saves (WIS) or is stunned until your next turn."
  counted("esper", "Synaptic Overload", "cyberpunk_synaptic_overload", {
    spends: [{ name: "Synaptic Overload", pool: { id: "cyberpunk_synaptic_overload" }, action: "none", does: { kind: "cyber_spend", what: "synaptic" } }],
  }),
  // "Replace one attack with a spinning slash: weapon damage to every foe within 5 ft."
  { feature: "Whirl of Edges", classes: ["street_samurai"], entry: { subclass: "genre", spends: [{ name: "Whirl of Edges", action: "none", does: { kind: "cyber_spend", what: "whirl" } }] } },
);

// The capstones that mark a minute or the next cast.
GENRE_A_CYBERPUNK.push(
  // "1/long rest, split one single-target damaging program among up to three
  // targets": the program reaches three creatures at any distance, one
  // casting (the twin of src/lib/dm/authored-reaper.ts, with one more share).
  counted("netrunner", "Daemon Swarm", "cyberpunk_daemon_swarm", {
    effects: [{ kind: "twin_spell", school: "", anySchool: true, minLevel: 0, maxLevel: 9, anyRange: true, targets: 3, gate: { condition: "daemon swarm" } }],
    spends: [{ name: "Daemon Swarm", pool: { id: "cyberpunk_daemon_swarm" }, action: "none", does: { kind: "buff", condition: "daemon swarm", rounds: 1 } }],
  }),
  // "1/long rest, your next damaging psionic deals maximum damage": the mark
  // the next damaging cast takes off (genre-a-cyberpunk-spends.ts).
  counted("esper", "Reality Rend", "cyberpunk_reality_rend", {
    spends: [{ name: "Reality Rend", pool: { id: "cyberpunk_reality_rend" }, action: "none", does: { kind: "buff", condition: "reality rend", rounds: 600 } }],
  }),
  // "1/long rest, for 1 minute your drones act independently and you may cast
  // one routine through each": a minute's mark; the drones already act as
  // allies on the board with no command to wait for.
  counted("rigger", "Deus in Machina", "cyberpunk_deus_in_machina", {
    spends: [{ name: "Deus in Machina", pool: { id: "cyberpunk_deus_in_machina" }, action: "none", does: { kind: "buff", condition: "deus in machina", rounds: 10 } }],
  }),
);

// "1/short rest, reroll a failed CHA-based check."
GENRE_A_CYBERPUNK.push(
  counted("fixer", "Grease the Wheels", "cyberpunk_grease_the_wheels", {
    spends: [{ name: "Grease the Wheels", pool: { id: "cyberpunk_grease_the_wheels" }, action: "none", does: { kind: "cyber_spend", what: "grease" } }],
  }),
);
