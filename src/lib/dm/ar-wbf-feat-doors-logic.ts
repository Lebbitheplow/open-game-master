// The rules of four feats that had no reader, as pure functions (no
// database: cast-rules.ts and the Hand read components from here). The doors
// that run them are in ar-wbf-feat-doors.ts.
//
// Telekinetic: "You learn mage hand and can cast it without components at 30
// extra feet, and as a bonus action you can shove a creature within 30 feet 5
// feet on a failed Strength save." The save's DC is 8 + proficiency bonus +
// the modifier of the score the feat raised.
// Mounted Combatant: "While mounted you have advantage on melee attacks
// against unmounted creatures smaller than your mount, you can redirect an
// attack aimed at your mount to yourself".
// Linguist: "written ciphers that others cannot read without an Intelligence
// check against a DC of 8 plus your Intelligence modifier and proficiency
// bonus."
import { textKey } from "@/lib/language/text-logic";
import { holdsFeat } from "@/lib/srd/feat-use";

type FeatHolder = { feats?: readonly string[] | null };
type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

const holds = (sheet: FeatHolder, feat: string) => holdsFeat({ feats: [...(sheet.feats ?? [])] }, feat);

// Mage Hand as a Telekinetic casts it: no words and no gestures (the spell
// has no material). Every other spell, and anyone else's Mage Hand, is cast
// as written. Asked by cast-rules.ts componentsAsCast, where every casting
// reads its components. The 30 extra feet have nothing to hold them back: no
// cast door measures how far off a Mage Hand appears.
export function telekineticComponents<F extends { name: string; verbal: boolean; somatic: boolean }>(sheet: FeatHolder, facts: F): F {
  if (textKey(facts.name) !== "mage hand" || !holds(sheet, "Telekinetic")) {
    return facts;
  }
  return { ...facts, verbal: false, somatic: false };
}

export const TELEKINETIC_FEET = 30;
const MENTAL: Ability[] = ["int", "wis", "cha"];

// The score Telekinetic raised: the one recorded with the feat (a level-up's
// choice, or a variant human's), else the highest of the three it offers,
// which is what a feat granted in play with no choice on record can mean.
export function telekineticAbility(sheet: {
  asiChoices?: ReadonlyArray<{ mode: string; feat?: string; ability?: string | null }> | null;
  racialChoices?: { featAbility?: string | null } | null;
  abilities: Record<Ability, number>;
}): Ability {
  const recorded = (sheet.asiChoices ?? []).find((choice) => holdsFeat({ feats: choice.feat ? [choice.feat] : [] }, "Telekinetic"))?.ability;
  const chosen = recorded ?? sheet.racialChoices?.featAbility ?? null;
  if (chosen && (MENTAL as string[]).includes(chosen)) {
    return chosen as Ability;
  }
  return [...MENTAL].sort((a, b) => sheet.abilities[b] - sheet.abilities[a])[0];
}

const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
const rank = (size: string | null | undefined) => {
  const at = SIZES.indexOf(textKey(size ?? "medium"));
  return at < 0 ? 2 : at;
};

// "Smaller than your mount": a creature with no size on record is Medium.
export function smallerThanMount(creatureSize: string | null | undefined, mountSize: string): boolean {
  return rank(creatureSize) < rank(mountSize);
}

// The mark of a Mounted Combatant who lets attacks at the mount land on it
// ("you can redirect": the feat's holder takes them unless they say so).
export const MOUNT_UNSHIELDED = "mount unshielded";

export const holdsMountedCombatant = (sheet: FeatHolder) => holds(sheet, "Mounted Combatant");
export const holdsTelekinetic = (sheet: FeatHolder) => holds(sheet, "Telekinetic");
export const holdsLinguist = (sheet: FeatHolder) => holds(sheet, "Linguist");
