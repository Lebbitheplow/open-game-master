// The SRD 5.1 magic weapons and armor, as numbers the engines read. Written
// by hand from each item's own text in the SRD, because a sentence like
// "when you hit a fiend or an undead with it, that creature takes an extra
// 2d10 radiant damage" names a creature type, a die and a damage type that a
// general parser would have to guess at. scripts/generate-magic-items.mjs
// lays these onto the generated rows by the item's name in lower case.
//
// The base item a magic weapon or armor is built on comes from the pack
// row's category ("weapon (any sword)", "armor (plate)"), read by
// categoryBase below; a sheet row whose name says which one ("Flame Tongue
// Scimitar", "Mithral Half Plate") wins over that default.
//
// weapon:
//   bonus        +N to attack and damage rolls
//   bonusVs      a higher bonus against these creature types (Mace of Smiting)
//   damageType   the damage type the weapon deals instead of its own
//   properties   properties the magic adds (Sun Blade's finesse)
//   rangeFt, longRangeFt   thrown range the magic gives (Dwarven Thrower)
//   extra        dice added on every hit: { dice, type ("weapon" = the
//                weapon's own type), vs (creature types), ranged (only on a
//                ranged attack) }
//   critExtra    dice added when the attack roll is a natural 20
//   onHit        a save the creature hit makes or takes a condition: { vs
//                (creature types), save (ability), dc, condition }
//   wounds       a hit wounds the creature once per turn (Sword of Wounding)
//   oath         the Oathbow's sworn enemy (src/lib/dm/oathbow.ts)
// cursed: attuning curses the wearer, and the attunement cannot be ended
//   (nor the item set aside) until remove curse or similar magic.
// armor:
//   bonus             +N to AC
//   noStrength        no Strength requirement (mithral)
//   noStealthPenalty  no disadvantage on Stealth (mithral)
//   proficientAnyway  worn as if trained (Elven Chain)
//   critProof         a critical hit against the wearer is a normal hit
//                     (Adamantine Armor)

const d = (dice, type, extra = {}) => ({ dice, type, ...extra });

export const GEAR_RIDERS = {
  // ---- weapons ----
  "berserker axe": { weapon: { bonus: 1 }, cursed: true },
  "dagger of venom": { weapon: { bonus: 1 } },
  "dancing sword": { weapon: {} },
  defender: { weapon: { bonus: 3 } },
  "dragon slayer": { weapon: { bonus: 1, extra: [d("3d6", "weapon", { vs: ["dragon"] })] } },
  "dwarven thrower": {
    weapon: {
      bonus: 3,
      properties: ["thrown"],
      rangeFt: 20,
      longRangeFt: 60,
      extra: [d("1d8", "weapon", { ranged: true }), d("1d8", "weapon", { ranged: true, vs: ["giant"] })],
    },
  },
  "flame tongue": { weapon: { extra: [d("2d6", "fire")] } },
  "frost brand": { weapon: { extra: [d("1d6", "cold")] } },
  // "When you hit a giant with it, the giant takes an extra 2d6 damage of
  // the weapon's type and must succeed on a DC 15 Strength saving throw or
  // fall prone."
  "giant slayer": { weapon: { bonus: 1, extra: [d("2d6", "weapon", { vs: ["giant"] })], onHit: [{ vs: ["giant"], save: "str", dc: 15, condition: "prone" }] } },
  "hammer of thunderbolts": { weapon: { bonus: 1 } },
  "holy avenger": { weapon: { bonus: 3, extra: [d("2d10", "radiant", { vs: ["fiend", "undead"] })] } },
  "javelin of lightning": { weapon: {} },
  "luck blade": { weapon: { bonus: 1 } },
  "mace of disruption": { weapon: { extra: [d("2d6", "radiant", { vs: ["fiend", "undead"] })] } },
  "mace of smiting": {
    weapon: {
      bonus: 1,
      bonusVs: { types: ["construct"], bonus: 3 },
      critExtra: [d("2d6", "bludgeoning"), d("2d6", "bludgeoning", { vs: ["construct"] })],
    },
  },
  "mace of terror": { weapon: {} },
  "nine lives stealer": { weapon: { bonus: 2 } },
  // The sworn enemy's advantage, cover, range and 3d6 (src/lib/dm/oathbow.ts).
  oathbow: { weapon: { oath: true } },
  "scimitar of speed": { weapon: { bonus: 2 } },
  "sun blade": {
    weapon: {
      bonus: 2,
      damageType: "radiant",
      properties: ["finesse"],
      extra: [d("1d8", "radiant", { vs: ["undead"] })],
    },
  },
  "sword of life stealing": { weapon: { critExtra: [d("3d6", "necrotic", { notVs: ["construct", "undead"] })] } },
  "sword of sharpness": { weapon: { critExtra: [d("4d6", "slashing")] } },
  // "Once per turn, when you hit a creature with an attack using this magic
  // weapon, you can wound the target" (src/lib/dm/sword-wounding.ts).
  "sword of wounding": { weapon: { wounds: true } },
  "trident of fish command": { weapon: {} },
  "vicious weapon": { weapon: { critExtra: [d("2d6", "weapon")] } },
  "vorpal sword": { weapon: { bonus: 3 } },
  "weapon, +1, +2, or +3": { weapon: {} },

  // ---- armor ----
  "adamantine armor": { armor: { critProof: true } },
  "animated shield": { armor: {} },
  "armor of invulnerability": { armor: {} },
  "armor of resistance": { armor: {} },
  "armor of vulnerability": { armor: {}, cursed: true },
  "arrow-catching shield": { armor: {} },
  "demon armor": { armor: { bonus: 1 }, cursed: true },
  "dragon scale mail": { armor: {} },
  "dwarven plate": { armor: { bonus: 2 } },
  "elven chain": { armor: { bonus: 1, proficientAnyway: true } },
  "glamoured studded leather": { armor: { bonus: 1 } },
  "mithral armor": { armor: { noStrength: true, noStealthPenalty: true } },
  "plate armor of etherealness": { armor: {} },
  "shield of missile attraction": { armor: {}, cursed: true },
  "spellguard shield": { armor: {} },
};

// A daily power that is not a charge in the text ("can't be used again until
// the next dawn") is tracked as one charge that comes back at dawn, so the
// engine can refuse a second use before the dawn the item waits for.
export const DAILY_POWERS = {
  "armor of invulnerability": "resistance becomes immunity to nonmagical damage for 10 minutes",
  // "you can use it to cast the dimension door spell as an action. This
  // property of the cape can't be used again until the next dawn."
  "cape of the mountebank": "the dimension door spell, leaving a cloud of smoke behind and arriving in another",
  "dagger of venom": "the blade drips poison: the next hit forces a DC 15 Constitution save or 2d10 poison and poisoned for 1 minute",
  "dragon scale mail": "sense the nearest dragon of its kind within 30 miles",
  // "Each creature in the line excluding you and the target must make a DC
  // 13 Dexterity saving throw, taking 4d6 lightning damage on a failed save,
  // and half as much damage on a successful one." The line once read "DC 13
  // Dexterity save or 4d6 lightning", and a save was resolved as no damage.
  "javelin of lightning": "a 5-foot-wide line to a target within 120 feet: each other creature in it makes a DC 13 Dexterity save, 4d6 lightning or half on a success; then a ranged attack, and a hit adds 4d6 lightning",
  "plate armor of etherealness": "the etherealness spell for 10 minutes",
  // "regain one expended spell slot. If the expended slot was of 4th level
  // or higher, the new slot is 3rd level. Once you use the pearl, it can't
  // be used again until the next dawn." The slot comes back at use_item
  // (src/lib/dm/item-use.ts).
  "pearl of power": "regain one expended spell slot of 3rd level or lower",
  // "The rod can't be used again until the next dawn."
  "rod of rulership": "each creature of your choice within 120 feet: DC 15 Wisdom save or charmed by you for 8 hours",
  // "Once the bands are used, they can't be used again until the next dawn."
  "iron bands of binding": "a ranged attack (Dexterity modifier + proficiency bonus) that restrains a Huge or smaller creature within 60 feet",
};

// The properties of one item that each have their own use, beside its
// charges or without any: SRD 5.1, Staff of Thunder and Lightning, "When one
// of these properties is used, it can't be used again until the next dawn".
// Keyed by the property's name as the SRD heads it; use_item names it in
// `spell`, and a property named for a spell the item casts (a Luck Blade's
// Wish) gates that cast. `activation` "free": it rides a hit or needs no
// action ("When you hit with a melee attack using the staff", "no action
// required"); an action otherwise.
const once = (activation) => ({ max: 1, regain: "all", unit: "use", ...(activation ? { activation } : {}) });
export const POWERS = {
  // Call Dragons: "Once you have used this property, it can't be used again
  // for 1 hour." Its spells spend the orb's own charges.
  "orb of dragonkind": { "Call Dragons": { max: 1, regainHours: 1, unit: "use" } },
  "staff of thunder and lightning": {
    Lightning: once("free"),
    Thunder: once("free"),
    "Lightning Strike": once(),
    Thunderclap: once(),
    // "Doing so doesn't expend the daily use of those properties, only the
    // use of this one."
    "Thunder and Lightning": once(),
  },
  // Drain Life and Paralyze ride a melee hit; Terrify is an action. "This
  // property can't be used again until the next dawn", each.
  "rod of lordly might": { "Drain Life": once("free"), Paralyze: once("free"), Terrify: once() },
  // "This property can't be used again until the next dawn."
  "rod of alertness": { "Protective Aura": once() },
  // Luck: "(no action required) to reroll one attack roll, ability check,
  // or saving throw"; Wish: "expend 1 charge and cast the wish spell ...
  // This property can't be used again until the next dawn."
  "luck blade": { Luck: once("free"), Wish: once() },
  // "you can turn your failed save into a successful one. You can't use
  // this property of the staff again until the next dawn."
  "staff of charming": { "Turn a Failed Save": once("free") },
};

// Uses the text counts without calling them charges, kept as charges so
// use_item spends one per use and refuses the use that is not there.
export const COUNTED_USES = {
  // "This necklace has 1d6+3 beads hanging from it. You can use an action to
  // detach a bead and throw it": each bead is gone once thrown, and with the
  // last of them the necklace.
  "necklace of fireballs": { max: "1d6+3", spentAway: true },
  // "Six stars ... you can use an action to pull off one of the stars and use
  // it to cast magic missile as a 5th-level spell. Daily at dusk, 1d6 removed
  // stars reappear on the robe."
  "robe of stars": { max: 6, regain: "1d6", regainAtDusk: true },
  // "This necklace has 1d4+2 magic beads ... Once a magic bead's spell is
  // cast, that bead can't be used again until the next dawn."
  "necklace of prayer beads": { max: "1d4+2", regain: "all" },
  // "Once used, the fan shouldn't be used again until the next dawn. Each
  // time it is used again before then, it has a cumulative 20 percent chance
  // of not working and tearing into useless, nonmagical tatters." One use a
  // dawn, and a use past it rolls the tearing (src/lib/dm/item-charges.ts).
  "wind fan": { max: 1, regain: "all", daily: "the gust of wind spell", overuseRisk: 20 },
  // "The robe has two of each of the following patches" (six kinds), "In
  // addition, the robe has 4d4 other patches ... Once the last patch is
  // removed, the robe becomes an ordinary garment."
  "robe of useful items": { max: "4d4+12", spentAway: true },
  // "you can use a bonus action and click the boots' heels together ...
  // When the boots' property has been used for a total of 10 minutes, the
  // magic ceases to function until you finish a long rest": ten minutes,
  // each use spending the minutes it runs.
  "boots of speed": { max: 10, regain: "all", regainOn: "long_rest", unit: "minute", activation: "bonus" },
  // "you can use an action to speak its command word ... Whenever you use the
  // ring again before taking a long rest, you must succeed on a DC 15
  // Constitution saving throw or gain one level of exhaustion": one use a
  // long rest, and each use past it rolls the wearer's save
  // (src/lib/dm/item-use.ts).
  "ring of x-ray vision": { max: 1, regain: "all", regainOn: "long_rest", unit: "use", overuseSave: { ability: "con", dc: 15 } },
  // "When you draw this weapon, you can extinguish all nonmagical flames
  // within 30 feet of you. This property can be used no more than once per
  // hour": no action of its own (it rides the draw), back an hour after use.
  "frost brand": { max: 1, regainHours: 1, unit: "use", activation: "free" },
  // "After the djinni departs, it can't be summoned again for 24 hours":
  // counted from the summoning (the djinni serves up to an hour), so the
  // wait may end that hour early.
  "ring of djinni summoning": { max: 1, regainHours: 24, unit: "use" },
  // "A full deck has 34 cards ... that card can't be used again": each draw
  // spends a card, and the deck is used up with its last. "A deck found as
  // treasure is usually missing 1d20 - 1 cards": the GM sets the row's count.
  "deck of illusions": { max: 34, spentAway: true, unit: "card" },
};

// The last charge's d20 where a 1 leaves an item its text describes rather
// than names: "On a 1, the staff retains its +2 bonus to attack and damage
// rolls but loses all other properties" (Staff of Power) is a +2
// quarterstaff. The staffs that become "a nonmagical quarterstaff" are read
// from their words.
export const LAST_CHARGE_BECOMES = {
  "staff of power": "+2 Quarterstaff",
};

// The base item a pack category names. "weapon (any sword)" is a longsword
// unless the sheet's name says otherwise; "armor (medium or heavy)" is chain
// mail. Ammunition is not a weapon the attack engine swings.
const WEAPON_DEFAULTS = {
  "any sword": "Longsword",
  "any sword that deals slashing damage": "Longsword",
  "any axe or sword": "Longsword",
  "any axe": "Battleaxe",
  any: "Longsword",
  "shortbow or longbow": "Longbow",
};
const ARMOR_DEFAULTS = {
  "medium or heavy": "Chain Mail",
  light: "Leather",
  plate: "Plate",
  shield: "Shield",
};
const titled = (text) => text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

export function categoryBase(category) {
  const match = /^(weapon|armor)\s*\((.+)\)\s*$/i.exec(String(category ?? "").trim());
  if (!match) {
    return null;
  }
  const kind = match[1].toLowerCase();
  const inner = match[2].trim().toLowerCase();
  if (kind === "weapon") {
    if (/arrow|ammunition|bolt/.test(inner)) {
      return null;
    }
    return { kind, name: WEAPON_DEFAULTS[inner] ?? titled(inner), any: inner in WEAPON_DEFAULTS ? inner : undefined };
  }
  return { kind, name: ARMOR_DEFAULTS[inner] ?? titled(inner), any: inner === "medium or heavy" || inner === "light" ? inner : undefined };
}
