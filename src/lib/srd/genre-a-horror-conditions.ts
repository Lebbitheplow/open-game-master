// The conditions the horror classes' counters lay (src/lib/dm/genre-a-horror-spends.ts
// and the rows of src/lib/srd/authored-effects-genre-a-horror.ts), as rows of
// the condition effects registry: src/lib/srd/genre-a-conditions.ts spreads
// them in, so the three genre branches never append to the same array.
import type { ConditionEffectRow } from "@/lib/srd/condition-effect-types";

export const GENRE_A_HORROR_CONDITIONS: ConditionEffectRow[] = [
  // The wards (src/lib/dm/genre-gh-wards.ts): what the setter carries while the ward holds.
  { id: "sanctified_ground", match: ["sanctified ground"], summary: "Sanctified Ground: the exorcist's ward holds where it was set; a fight there is fought in it (a hostile spirit entering is seen and takes 1d8 radiant)." },
  { id: "warding_sigil", match: ["warding sigil"], summary: "Warding Sigil: the occultist's sigil holds where it was set; the first hostile creature crossing it makes an INT save, 2d6 psychic (half on a success)." },
  { id: "warded", match: ["warded"], summary: "Hunter's Kit warding: +2 AC against attacks by the monster type it names, for the night." },
  { id: "grounding_rig", match: ["grounding rig"], summary: "Grounding Rig: for an hour nothing teleports into or out of 20 feet around the rig, and no ethereal creature crosses its edge." },
  { id: "binding_words", match: ["binding words"], summary: "Binding Words: the exorcist's next Rite of Repulsion also restrains, for a minute, the first creature it takes hold of." },
  { id: "terminal_focus", match: ["terminal focus"], summary: "Terminal Focus: the survivor's second full turn of the first round." },
  { id: "observed", match: ["observed"], summary: "Observer Effect: forced into its true visible form for a minute; it cannot turn invisible or change shape while it lasts." },
  { id: "the_stake_remembers", match: ["the stake remembers"], summary: "The Stake Remembers: the slayer's next attack this turn on a creature at half its hit points or lower is a critical hit if it hits." },
  { id: "called_shot", match: ["called shot"], summary: "Called Shot: the slayer's next weapon hit this turn also costs the creature its movement, an attack or a sense until the slayer's next turn." },
  { id: "hobbling_shot", match: ["hobbling shot"], summary: "Called Shot: speed 0 until the start of the slayer's next turn.", speedSet: 0 },
  { id: "disarming_shot", match: ["disarming shot"], summary: "Called Shot: disadvantage on attack rolls until the start of the slayer's next turn.", attackDisadvantage: true },
  { id: "ectoplasmic_sample", match: ["ectoplasmic sample"], summary: "Ectoplasmic Sample: for a minute the party's attacks against this spirit count as magical." },
  { id: "downed_an_ally", match: ["downed an ally"], summary: "Downed an ally this fight: a survivor's attacks deal +1d8 to it (No Witnesses Left)." },
];
