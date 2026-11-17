// What each SRD condition does, in a line or two a player reads on the
// board's hover plate. The engine's other conditions ("halted", "hasted",
// "turned") already lead their note with their registry row's summary
// (condition-notes.ts); the SRD's own were left bare, as if every player knew
// them by heart. Paraphrased from SRD 5.1, Appendix A: Conditions, every
// clause kept, plus the few combat states the board badges like one (Dodge,
// Rage, Hide, concentration) from the rules that define them.
//
// Pure and small: the plate imports it on the client.
import { textKey } from "@/lib/language/text-logic";
import { translate } from "@/lib/messages-logic";

type T = (key: string, vars?: Record<string, string | number>) => string;
const enT: T = (key, vars) => translate("en", key, vars);

const CONDITION_KEYS = new Set([
  "blinded",
  "charmed",
  "deafened",
  "frightened",
  "grappled",
  "incapacitated",
  "invisible",
  "paralyzed",
  "petrified",
  "poisoned",
  "prone",
  "restrained",
  "stunned",
  "unconscious",
  "concentrating",
  "dodging",
  "raging",
  "hidden",
  "exhaustion",
  "exhaustion 1",
  "exhaustion 2",
  "exhaustion 3",
  "exhaustion 4",
  "exhaustion 5",
  "exhaustion 6",
]);

// A stage row's id ("prone", "concentrating", "exhaustion 2"; a "Dying 1/2"
// row is "unconscious"), or a bare condition name.
export function conditionRule(id: string, t: T = enT): string | null {
  const key = textKey(id);
  if (!CONDITION_KEYS.has(key)) return null;
  const slug = key.replace(/\s+/g, "_");
  return ({ "blinded": t("Can't see, and fails any ability check that needs sight. Attacks against it have advantage; its own attacks have disadvantage."), "charmed": t("Can't attack the charmer or target them with harmful abilities or magical effects. The charmer has advantage on ability checks to interact socially with it."), "deafened": t("Can't hear, and fails any ability check that needs hearing."), "frightened": t("Disadvantage on ability checks and attack rolls while the source of its fear is within line of sight. Can't willingly move closer to that source."), "grappled": t("Speed 0, and no bonus can raise it. Ends if the grappler is incapacitated, or if an effect takes it out of the grappler's reach."), "incapacitated": t("Can't take actions or reactions."), "invisible": t("Impossible to see without magic or a special sense; for hiding it is heavily obscured, though its noise or tracks can still give away where it is. Attacks against it have disadvantage; its own attacks have advantage."), "paralyzed": t("Incapacitated, can't move or speak, and automatically fails Strength and Dexterity saves. Attacks against it have advantage, and any hit from within 5 feet is a critical hit."), "petrified": t("Turned to stone with what it wears and carries, ten times as heavy and no longer aging: incapacitated, can't move or speak, unaware of its surroundings, and automatically fails Strength and Dexterity saves. Attacks against it have advantage; it resists all damage and is immune to poison and disease (one already in it is suspended)."), "poisoned": t("Disadvantage on attack rolls and ability checks."), "prone": t("Can only crawl, or spend half its speed to stand. Disadvantage on its attack rolls. Attacks against it have advantage from within 5 feet, disadvantage from farther away."), "restrained": t("Speed 0, and no bonus can raise it. Attacks against it have advantage, its own attacks have disadvantage, and it has disadvantage on Dexterity saves."), "stunned": t("Incapacitated, can't move, and can speak only falteringly. Automatically fails Strength and Dexterity saves, and attacks against it have advantage."), "unconscious": t("Incapacitated, can't move or speak, and unaware of its surroundings; drops what it holds and falls prone. Automatically fails Strength and Dexterity saves; attacks against it have advantage, and any hit from within 5 feet is a critical hit."), "concentrating": t("Holding a spell. Each time it takes damage it makes a Constitution save, DC 10 or half the damage if higher, or loses it; it also ends on casting another concentration spell, or on being incapacitated or killed."), "dodging": t("Until the start of its next turn, attacks against it have disadvantage if it can see the attacker, and it has advantage on Dexterity saves. Lost if it is incapacitated or its speed drops to 0."), "raging": t("Out of heavy armor: advantage on Strength checks and saves, extra damage on melee weapon attacks using Strength, and resistance to bludgeoning, piercing and slashing damage. Can't cast or concentrate on spells. Ends early if it is knocked unconscious, or if its turn ends without it attacking a hostile creature or taking damage since its last turn."), "hidden": t("Unseen and unheard. Attacks against it have disadvantage, its own attacks have advantage, and an attack, hit or miss, gives away where it is."), "exhaustion": t("Each level adds to those below it: 1, disadvantage on ability checks; 2, speed halved; 3, disadvantage on attack rolls and saves; 4, hit point maximum halved; 5, speed 0; 6, death. A long rest with food and drink lowers it by one level."), "exhaustion_1": t("Level 1: disadvantage on ability checks. A long rest with food and drink lowers it by one level."), "exhaustion_2": t("Level 2: disadvantage on ability checks; speed halved. A long rest with food and drink lowers it by one level."), "exhaustion_3": t("Level 3: disadvantage on ability checks; speed halved; disadvantage on attack rolls and saves. A long rest with food and drink lowers it by one level."), "exhaustion_4": t("Level 4: disadvantage on ability checks; speed halved; disadvantage on attack rolls and saves; hit point maximum halved. A long rest with food and drink lowers it by one level."), "exhaustion_5": t("Level 5: disadvantage on ability checks; speed 0; disadvantage on attack rolls and saves; hit point maximum halved. A long rest with food and drink lowers it by one level."), "exhaustion_6": t("Level 6: death.") } as Record<string, string>)[slug] ?? String(slug);
}
