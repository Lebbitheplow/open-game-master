// What holds a creature a hit restrains, read from the attack's printed line:
// the check that breaks it and the thing itself as an object. SRD 5.1, Giant
// Spider, Web: "Hit: The target is restrained by webbing. As an action, the
// restrained target can make a DC 12 Strength check, bursting the webbing on
// a success. The webbing can also be attacked and destroyed (AC 10; hp 5;
// vulnerability to fire damage; immunity to bludgeoning, poison, and psychic
// damage)." Before this both sentences went to the GM: a webbed hero's
// escape was refused ("not grappled; there is nothing to escape"), and a
// blow at the webbing was a blow at a generic object.
//
// Read by attack-text.ts readOnHit into the hit's rider; enemy-hit.ts lays
// the restraint with it, and creature-hold.ts plays the escape and the
// object. Pure.

export type CreatureHold = {
  // What holds it, as printed: "webbing", "webs".
  name: string;
  check: { ability: "str" | "dex"; dc: number };
  ac?: number;
  hp?: number;
  // Damage types, comma-joined in the words damageAdjust reads.
  vulnerable?: string;
  immune?: string;
};

const DAMAGE = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];

// "bludgeoning, poison, and psychic" -> "bludgeoning, poison, psychic".
function typeList(raw: string): string {
  return raw
    .split(/,\s*(?:and\s+)?|\s+and\s+/i)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => DAMAGE.includes(word))
    .join(", ");
}

// The hold a restraining hit prints, or null for one with no check to break
// it (a grapple's escape DC is read apart, attack-text.ts).
export function readHold(hit: string): CreatureHold | null {
  const held = /\brestrained by (?:(?:invisible|ghostly|sticky)\s+)?(webbing|webs?)\b/i.exec(hit);
  const check = /\bDC\s*(\d{1,2})\s+(strength|str|dexterity|dex)\b(?:\s*\([^)]*\))?\s+check\b/i.exec(hit);
  if (!held || !check || !/\baction\b/i.test(hit)) {
    return null;
  }
  const out: CreatureHold = {
    name: held[1].toLowerCase(),
    check: { ability: /^d/i.test(check[2]) ? "dex" : "str", dc: Number(check[1]) },
  };
  const object = /\b(?:attacked and destroyed|(?:has|have) AC)\b[\s\S]*$/i.exec(hit)?.[0] ?? "";
  const ac = /\bAC\s*(\d{1,2})\b/i.exec(object);
  const hp = /\bhp\s*(\d{1,3})\b|\b(\d{1,3})\s*(?:hp|hit points?)\b/i.exec(object);
  if (ac && hp) {
    out.ac = Number(ac[1]);
    out.hp = Number(hp[1] ?? hp[2]);
  }
  const vulnerable = /\bvulnerability to (.+?) damage\b/i.exec(object);
  if (vulnerable && typeList(vulnerable[1])) {
    out.vulnerable = typeList(vulnerable[1]);
  }
  const except = /\bimmunity to all damage except (.+?)(?:[.;)]|$)/i.exec(object);
  const immune = except ? null : /\bimmunity to (.+?) damage\b/i.exec(object);
  if (except) {
    const spared = typeList(except[1]).split(", ");
    out.immune = DAMAGE.filter((type) => !spared.includes(type)).join(", ");
  } else if (immune && typeList(immune[1])) {
    out.immune = typeList(immune[1]);
  }
  return out;
}

// The sentences the hold's reading carries, so they are not also told to
// the GM.
export const HOLD_SENTENCE = /\bcheck\b[^.]*\b(?:bursting|escaping|breaking|free)\b|\b(?:bursting|escaping|breaking|free)\b[^.]*\bcheck\b|\battacked and destroyed\b|\b(?:has|have) AC\b|\bthe effect also ends if the \w+ (?:is|are) destroyed\b/i;
