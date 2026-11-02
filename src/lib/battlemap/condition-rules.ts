// What each SRD condition does, in a line or two a player reads on the
// board's hover plate. The engine's other conditions ("halted", "hasted",
// "turned") already lead their note with their registry row's summary
// (condition-notes.ts); the SRD's own were left bare, as if every player knew
// them by heart. Paraphrased from SRD 5.1, Appendix A: Conditions, plus the
// few combat states the board badges like one (Dodge, Rage, Hide,
// concentration).
//
// Pure and small: the plate imports it on the client.
import { textKey } from "@/lib/language/text-logic";

const CONDITION_RULES: Record<string, string> = {
  blinded: "Can't see, and fails any check that needs sight. Attacks against it have advantage; its own attacks have disadvantage.",
  charmed: "Can't attack the charmer or target them with harmful abilities or magic. The charmer has advantage on social checks with it.",
  deafened: "Can't hear, and fails any check that needs hearing.",
  frightened: "Disadvantage on ability checks and attack rolls while the source of its fear is in sight. Can't willingly move closer to it.",
  grappled: "Speed 0. Ends if the grappler is incapacitated or it is moved out of the grappler's reach.",
  incapacitated: "Can't take actions or reactions.",
  invisible: "Can't be seen without magic or a special sense. Attacks against it have disadvantage; its own attacks have advantage.",
  paralyzed: "Incapacitated, can't move or speak, and fails Strength and Dexterity saves. Attacks against it have advantage, and a hit from within 5 feet is a critical hit.",
  petrified: "Turned to stone: incapacitated, can't move or speak, and fails Strength and Dexterity saves. Attacks against it have advantage; it resists all damage and is immune to poison and disease.",
  poisoned: "Disadvantage on attack rolls and ability checks.",
  prone: "Can only crawl, or spend half its speed to stand. Disadvantage on its attack rolls. Attacks against it have advantage from within 5 feet, disadvantage from farther away.",
  restrained: "Speed 0. Attacks against it have advantage, its own attacks have disadvantage, and it has disadvantage on Dexterity saves.",
  stunned: "Incapacitated, can't move, and speaks only falteringly. Fails Strength and Dexterity saves, and attacks against it have advantage.",
  unconscious: "Incapacitated, can't move or speak, drops what it holds and falls prone. Fails Strength and Dexterity saves; attacks against it have advantage, and a hit from within 5 feet is a critical hit.",
  concentrating: "Holding a spell. Taking damage calls for a Constitution save, DC 10 or half the damage if higher, to keep it.",
  dodging: "Attacks against it have disadvantage while it can see the attacker, and it has advantage on Dexterity saves, until its next turn.",
  raging: "Advantage on Strength checks and saves, extra damage on Strength melee attacks, and resistance to bludgeoning, piercing and slashing damage. Can't cast or concentrate on spells.",
  hidden: "Unseen and unheard. Attacks against it have disadvantage, its own attacks have advantage, and attacking gives away where it is.",
};

// A stage row's id ("prone", "concentrating"; a "Dying 1/2" row is
// "unconscious"), or a bare condition name.
export function conditionRule(id: string): string | null {
  return CONDITION_RULES[textKey(id)] ?? null;
}
