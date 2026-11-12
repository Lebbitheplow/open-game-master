// The shapes of the authored subclass layer's engine hooks
// (src/lib/srd/authored-effects.ts). Kept apart from the data and the readers
// so both data files and every reader import the same words without a cycle.

import type { CheckAbout, SaveAgainstValue } from "@/lib/dm/roll-about";
import type { ItemTag } from "@/lib/schemas/item-tags";

export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

// A number or dice that grow with the level of the class that granted the
// feature: a plain expression ("2d6", "level", "half + cha"), a ladder of
// [class level, value] rows where the last row reached wins, or a function
// of the level and the ability modifiers.
export type Formula =
  | string
  | Array<[number, string]>
  | ((level: number, mods: Record<string, number>) => string | number);

// When an effect holds. Every named test must pass.
export type Gate = {
  // The holder is raging (the rage condition, not in heavy armor).
  raging?: boolean;
  // The holder wears heavy armor.
  heavyArmor?: boolean;
  // The holder wears no body armor (Dragon Wings).
  unarmored?: boolean;
  // The holder is concentrating on a spell.
  concentrating?: boolean;
  // The holder has (or has not) a condition, by name or "name (" prefix.
  // `because`: what the refusal says is missing, in place of the mark's name.
  condition?: string;
  because?: string;
  notCondition?: string;
  // Every one of these conditions as well (Body of the Astral Self: the arms
  // and the visage both).
  conditions?: string[];
  // The option chosen for this feature ("Totem Spirit (Bear)"), or for
  // another feature of the same sheet ("Armor Model (Guardian)").
  choice?: string;
  choiceOf?: { feature: string; value: string };
  // The class that granted the feature has reached this level (a part of
  // the feature that arrives later: Spiritual Focus's d6 from 6th level).
  level?: number;
  // The holder has a living pet of this kind on their sheet (Exceptional
  // Training commands the companion; the card stays shut without one).
  pet?: "familiar" | "beast_companion" | "drake";
};

type Base = { gate?: Gate; note?: string };

// Passive effects, each read by one engine (AUTHORED_READERS names where).
export type AuthoredEffect = Base &
  (
    // Damage resistance. `spells`: only to damage from spells.
    // `fromCreatures`: only damage a creature deals, not a fall, a trap or
    // harm the GM applies with no creature behind it (Emissary of Redemption:
    // "damage dealt by other creatures").
    | { kind: "resist"; types: string[] | "all"; except?: string[]; nonmagical?: boolean; spells?: boolean; fromCreatures?: boolean }
    | { kind: "immune_damage"; types: string[] }
    | { kind: "immune_condition"; conditions: string[] }
    // Advantage on a save: against what the save resists (one of the
    // roll's `against` values, or magic), or every save of an ability.
    | { kind: "save_adv"; against?: SaveAgainstValue[]; magical?: true; ability?: Ability }
    // `elseOneOf`: a holder already proficient in every one of `abilities`
    // gains the one of these the feature's option names instead (Elegant
    // Courtier: "Intelligence or Charisma if you already have it").
    | { kind: "save_prof"; abilities: Ability[]; elseOneOf?: Ability[] }
    // `abilities`: only saves of these (Frost Rune: Strength and Constitution);
    // `checks`: the same bonus on ability checks of those abilities, skills too.
    | { kind: "save_bonus"; amount: number; abilities?: Ability[]; checks?: true }
    // A save of one ability uses another ability's modifier when higher.
    // `checks`: ability checks of that ability too (Arms of the Astral Self:
    // "Wisdom for Strength checks and saves").
    | { kind: "save_swap"; save: Ability; use: Ability; checks?: true }
    | { kind: "ac"; amount: number }
    // Walking speed, through feature-effects' speed_bonus. `allies`: an ally
    // who starts their turn within the ladder's reach of the holder (up and
    // not incapacitated) holds `condition`, whose row carries the speed,
    // until that turn ends (Aura of Alacrity; src/lib/dm/divine-auras.ts).
    | { kind: "speed"; amount: number; allies?: { rangeFt: Array<[number, number]>; condition: string } }
    // Carrying, pushing, dragging and lifting capacity times `factor`, and
    // flat feet on long and high jumps after the Strength reach (Peerless
    // Athlete: 2 and 10; src/lib/srd/carry-jump-effects.ts).
    | { kind: "carry_factor"; factor: number }
    | { kind: "jump_feet"; feet: number }
    // Other movement modes: a number of feet, or "walk" for the walking speed.
    // "double_walk": twice the walking speed (Revelation in Flesh's swim).
    | { kind: "move"; fly?: number | "walk"; swim?: number | "walk" | "double_walk"; climb?: number | "walk" }
    | { kind: "init_adv" }
    | { kind: "init_ability"; ability: Ability }
    // Advantage on checks: named skills, or checks of an ability about one
    // circumstance (the roll's `about`).
    | { kind: "check_adv"; skills?: string[]; abilities?: Ability[]; about?: CheckAbout }
    // An ability modifier (never less than 0) added to checks with these
    // skills (Elegant Courtier: Wisdom on Persuasion).
    | { kind: "check_bonus"; skills: string[]; ability: Ability }
    // A critical hit against the holder is a normal hit.
    | { kind: "crit_immune" }
    // The holder's damage of these types ignores resistance.
    | { kind: "ignore_resist"; types: string[] }
    // Attacks against the holder by creatures of these types are at
    // disadvantage.
    | { kind: "attacked_disadv"; from: string[] }
    // Attack rolls against the holder are at disadvantage while the holder
    // stands entirely in darkness (Lunar Empowerment's New Moon:
    // src/lib/dm/ar-ws-lunar-empowerment.ts darkVeil).
    | { kind: "attacked_disadv_dark" }
    // A creature of these types that targets the holder with an attack must
    // first save against the holder's spell save DC or lose the attack
    // (Among the Dead: undead, Wisdom).
    | { kind: "ward_vs"; types: string[]; save: Ability }
    // Opportunity attacks against the holder are made at disadvantage
    // (Totem Spirit: Eagle).
    | { kind: "oa_disadv" }
    // The holder uses this ability for the attack and damage rolls of the
    // weapon the feature's option names, when it is higher (Hex Warrior:
    // Charisma, "Hex Warrior (Longsword)"). `pactWeapons`: with Pact of the
    // Blade it holds for the pact weapon too, whatever its form ("this also
    // holds for every pact weapon you conjure").
    | { kind: "weapon_ability"; ability: Ability; magicOnly?: boolean; pactWeapons?: boolean }
    // Darkvision to this range, or `orAdd` more feet when the holder already
    // sees in the dark (Umbral Sight: 60, or 30 more).
    | { kind: "darkvision"; feet: number; orAdd?: number }
    // Dim light costs the holder's Perception nothing (Aspect of the Beast,
    // Eagle): src/lib/dm/dim-sight.ts, read by every Perception door.
    | { kind: "dim_sight" }
    // On the road (Aspect of the Beast): Elk doubles the pace of the holder and
    // up to `companions` others travelling with them; Wolf moves stealthily at
    // a normal pace (src/lib/dm/world-tools.ts, roll-gates.ts).
    | { kind: "travel"; doubles?: { companions: number }; stealthAt?: "normal" }
    // An ability modifier (at least +1) added to the damage of the holder's weapon attacks
    // (Aura of Hate: Charisma, melee; Song of Victory: Intelligence, melee,
    // while bladesinging).
    // `aura`: creatures of these types within the ladder's reach of the
    // holder (up) add it to their melee weapon blows too (Aura of Hate:
    // fiends and undead; src/lib/dm/divine-auras.ts hateAuraDamage).
    | {
        kind: "damage_ability";
        ability: Ability;
        when: "melee" | "weapon";
        requiresCondition?: string;
        aura?: { rangeFt: Array<[number, number]>; types: string[] };
      }
    // The proficiency bonus added to initiative (Aura of the Sentinel).
    // `rangeFt`: allies within the ladder's reach of the holder (up) add the
    // holder's bonus to theirs (src/lib/dm/divine-auras.ts allyInitiativeAura).
    | { kind: "init_prof"; rangeFt?: Array<[number, number]> }
    // A d20 at or below `floor` - 1 counts as `floor` on checks with these
    // skills (Silver Tongue: 10 on Persuasion and Deception).
    // `abilities`: every check of those abilities (Starry Form's Dragon:
    // Intelligence and Wisdom checks).
    // `about`: only on a check about that circumstance (Ear for Deceit: 8 on
    // an Insight check "to tell whether a creature is lying").
    | { kind: "check_floor"; skills: string[]; floor: number; abilities?: Ability[]; about?: CheckAbout }
    // An ability's modifier added to checks of other abilities (Otherworldly
    // Glamour: Wisdom on Charisma checks; src/lib/srd/authored-check-mod.ts).
    | { kind: "check_ability_mod"; checks: Ability[]; ability: Ability }
    // A spell of 1st level or higher that kills heals the holder twice its
    // level, three times for necromancy, once a turn (Grim Harvest).
    | { kind: "grim_harvest" }
    // The holder's attacks have advantage: against a creature that has not
    // taken a turn in the fight yet, against one the holder frightened,
    // against one the holder distracted, or against creatures of these types.
    // "beside_illusion": a creature within 5 feet of the holder that can see
    // (Invoke Duplicity's double, placed beside the creature fought).
    | { kind: "attack_adv"; vs: "not_acted" | "frightened_by_self" | "distracted" | "types" | "beside_illusion"; types?: string[] }
    | { kind: "auto_crit"; vs: "surprised" }
    // Rolling initiative with none of this counter left gives one back.
    | { kind: "init_refill"; resource: string }
    // A creature within 5 feet of the holder drops to 0: temporary HP.
    | { kind: "kill_temp_hp"; formula: Formula }
    // An enemy dying within range: the most hurt ally in reach regains HP
    // equal to its Hit Dice (Keeper of Souls), once a turn.
    | { kind: "death_heal"; rangeFt: number }
    // Hit points at the start or end of the holder's turn in a fight.
    | { kind: "turn_heal"; when: "start" | "end"; formula: Formula; belowHalf?: boolean }
    // An aura while the holder's spend holds (gate.condition): each character
    // who ends a turn within `rangeFt` of the holder, the holder too, loses one
    // of `ends` laid on them or, holding none, gains temporary hit points
    // (Twilight Sanctuary). Ends with the holder down or incapacitated.
    | { kind: "turn_end_aura"; rangeFt: number; tempHp: Formula; ends: string[] }
    // Temporary HP after every rest, for the holder and up to `count` allies.
    | { kind: "rest_temp_hp"; formula: Formula; allies?: { count: number; formula: Formula } }
    // Extra damage dice on the holder's weapon hits (feature-effects rider).
    | {
        kind: "rider";
        dice: Formula;
        type: string;
        when: "weapon" | "melee" | "ranged" | "attack";
        oncePerTurn?: boolean;
        requiresCondition?: string;
        // Only the weapon of this name (the Infiltrator's lightning launcher).
        weapon?: string;
      }
    // A weapon hit marks the creature: it attacks anyone but the holder at
    // disadvantage (halving that damage when `halve`), or attacks against it
    // have advantage, or its next save against the holder is at disadvantage.
    | {
        kind: "mark";
        condition: string;
        effect: "disadv_others" | "attacked_adv" | "save_disadv" | "ally_bonus_dice";
        melee?: boolean;
        oncePerTurn?: boolean;
        firstRoundOnly?: boolean;
        // The mark lasts until the end of the holder's next turn, not its start
        // (Unwavering Mark), and binds only while the creature stands within
        // `rangeFt` of the holder ("while it is within 5 feet of you").
        untilNextTurnEnds?: boolean;
        rangeFt?: number;
        halve?: boolean;
        dice?: string;
        damageType?: string;
        // Only a hit with the weapon of this name (the Guardian's thunder
        // gauntlets, the Infiltrator's lightning launcher).
        weapon?: string;
      }
    // A creature within 5 feet of the raging holder attacks anyone but the
    // holder at disadvantage (Totemic Attunement: Bear).
    | { kind: "guard_aura"; rangeFt: number }
    // Allies' melee attacks against a creature within 5 feet of the holder
    // have advantage (Totem Spirit: Wolf).
    | { kind: "pack_adv"; rangeFt: number }
    // An action taken as a bonus action.
    | { kind: "bonus_route"; action: "dash" | "disengage" | "hide" | "dodge" | "help" | "search" | "grapple" }
    // A bonus-action weapon attack after something this turn.
    // `run`: only against a creature of that size or smaller the holder ran at
    // least that many feet straight at right before a melee attack on it this
    // turn (Totemic Attunement's tiger; src/lib/dm/mt-fb-charge.ts).
    | { kind: "bonus_attack"; after: "spell" | "cantrip" | "attack" | "telekinesis" | "missed_arrow"; run?: { feet: number; maxSize: string } }
    // Enemies save at disadvantage: when the holder casting is hidden from
    // them, when they carry the holder's mark, or when they stand within
    // range of the holder (a spell's save, any caster when `anyCaster`).
    // `channel`: also against the holder's Channel Divinity (Elder Champion:
    // "against your spells and Channel Divinity").
    // `damageTypes`: only against a spell that deals one of these (Corona of
    // Light: fire or radiant).
    | { kind: "enemy_save"; when: "hidden" | "marked" | "near"; mark?: string; rangeFt?: number; anyCaster?: boolean; damageTypes?: string[]; channel?: boolean }
    // Once on each of the holder's turns, a creature their attack hits saves
    // against their spell save DC or takes `condition` until the end of the
    // holder's next turn (Form of Dread: src/lib/dm/hit-save.ts).
    | { kind: "hit_save"; save: Ability; condition: string }
    // Allies in range (and the holder) resist: spell damage, or the damage
    // type the holder's own condition names.
    | {
        kind: "aura_resist";
        rangeFt: number | Array<[number, number]>;
        spells?: boolean;
        typeFrom?: { condition: string; map: Record<string, string> };
      }
    // A creature that hits the holder takes damage back.
    | { kind: "retaliate"; formula: Formula | "half_dealt"; type: string; melee?: boolean }
    // Enemies starting their turn near the holder take damage (Aura of
    // Conquest: only frightened ones).
    // `holdsSpeed`: a creature frightened of the holder has speed 0 while in
    // the aura (Aura of Conquest; src/lib/dm/aura-hold.ts).
    // `heldIn`: only a creature held in this condition the holder laid, at any
    // range (Fire Rune's shackles burn a creature restrained by them).
    | { kind: "enemy_turn_damage"; formula: Formula; type: string; rangeFt: number | Array<[number, number]>; frightenedOnly?: boolean; holdsSpeed?: boolean; heldIn?: string }
    // Flurry of Blows grants this many strikes instead of two.
    | { kind: "flurry"; strikes: number }
    // Sneak Attack with no advantage and no ally when the rogue duels one
    // creature alone (Rakish Audacity).
    | { kind: "sneak_duel" }
    // A healing spell on a creature at 0 hit points heals the maximum
    // (Circle of Mortality).
    | { kind: "heal_max" }
    // ---- the final round's hooks (src/lib/srd/authored-effects-more.ts) ----
    // A weapon the feature itself is (Form of the Beast's bite, claws and
    // tail, the Soulknife's psychic blade, Radiant Sun Bolt): pc_attack names
    // it as the weapon, proficient, with the ability a weapon of its kind
    // uses. `second` is the die of the bonus-action second attack (the
    // psychic blade's off-hand blade); `onHit` a rider of its own.
    | {
        kind: "natural_weapon";
        weapon: NaturalWeapon;
      }
    // Melee weapon reach grows by this many 5-foot squares (Demiurgic
    // Colossus while raging).
    // `unarmed`: only the unarmed strike's (Arms of the Astral Self).
    | { kind: "reach"; tiles: number; unarmed?: boolean }
    // The weapon the holder swings deals this damage type and can be thrown,
    // coming back to the hand (Elemental Cleaver's infused weapon).
    | { kind: "infuse"; type: string; rangeFt: number; longRangeFt: number }
    // Feet added to the long jump and the high jump, running or standing
    // (Totem Spirit's tiger, while raging).
    | { kind: "jump"; long: number; high: number }
    // Sneak Attack gains dice against a creature the holder marked
    // (Eye for Weakness: 3d6 against the Insightful Fighting target).
    | { kind: "sneak_bonus"; dice: number; mark: string }
    // A die added to the holder's saves against the effects of a creature
    // they marked (Supernatural Defense against Slayer's Prey).
    | { kind: "save_die_vs"; die: string; mark: string }
    // Dice added to one damage (or healing) roll of the holder's spells
    // (Enhanced Bond while the wildfire spirit is out; Arcane Firearm through
    // a wand, staff or rod).
    | {
        kind: "spell_rider";
        dice: Formula;
        damageTypes?: string[];
        healing?: boolean;
        classes?: string[];
        // Cantrips only (Potent Spellcasting).
        cantrips?: boolean;
        // Cast through a carried item that is one of these
        // (src/lib/srd/item-tags.ts).
        items?: ItemTag[];
        // Or through a carried item of one of these names, a focus no tag
        // names alone (Alchemical Savant: alchemist's supplies, which the
        // gear table tags only as tools).
        itemNames?: string[];
        // Against one of the spell's targets only (Radiant Soul: "one radiant
        // or fire damage roll of that spell against one of its targets"): an
        // area spell adds it to its first creature alone (aoe-damage.ts).
        oneTarget?: boolean;
      }
    // Casting the spell gives temporary hit points, and damage never breaks
    // the concentration on it (Grasping Tentacles).
    // `school`: every spell of that school (Focused Conjuration).
    | { kind: "concentration_guard"; spell?: string; school?: string; tempHp: Formula }
    // A single-target spell of the school and level range strikes a second
    // creature within 5 feet of the first (Improved Reaper: 1st to 5th level
    // necromancy; Reaper: a necromancy cantrip; Moon Fire: sacred flame).
    // `anywhere`: the text sets no distance between the two, and the second
    // creature need only be in the spell's own range (Split Enchantment).
    | { kind: "twin_spell"; school: string; maxLevel: number; minLevel?: number; spells?: string[]; anywhere?: boolean }
    // pc_attack rapidStrike: an attack with advantage forgoes it for one more
    // attack of the action, once a turn (Rapid Strike).
    | { kind: "rapid_strike" }
    // One attack of the holder's Attack action may be a cantrip with a
    // casting time of one action (the Bladesinger's Extra Attack:
    // src/lib/dm/ar-ws-cantrip-attack.ts, through cast-rules.ts turnCharge).
    | { kind: "attack_cantrip" }
    // An opportunity attack on every other creature's turn, each with its own
    // reaction (Vigilant Defender).
    | { kind: "oa_each_turn" }
    // Standing up from prone costs this many feet of movement (Tipsy Sway).
    | { kind: "stand_cost"; feet: number }
    // Walking speed added on a turn the holder took the Attack action, to
    // the turn's end (Blade Flourish: src/lib/battlemap/view.ts pcMoveBudget).
    | { kind: "attack_turn_speed"; feet: number }
    // The holder's Bardic Inspiration die carries a mote that bursts when the
    // die is spent (Mote of Potential).
    | { kind: "mote" }
    // The swarm's push knocks the moved creature prone (Mighty Swarm).
    | { kind: "swarm_prone" }
    // The School of Abjuration's ward: hit points that take the wizard's
    // damage first (src/lib/dm/arcane-ward.ts).
    | { kind: "arcane_ward" }
    // What the holder summons with a conjuration spell arrives with these
    // temporary hit points (Durable Summons, src/lib/dm/summon-cast.ts).
    | { kind: "summon_temp_hp"; amount: number; school: string }
    // Casting a spell of this school with a slot of `minLevel` or higher
    // gives back one spent slot of a lower level, `maxLevel` at most (Expert
    // Divination: divination, 2nd, 5th).
    | { kind: "slot_refund"; school: string; minLevel: number; maxLevel: number }
    // What the holder summons with a spell, of these creature types, gains
    // this many hit points per Hit Die (Mighty Summoner: 2, beasts and fey).
    | { kind: "summon_hp_per_hd"; amount: number; types: string[] }
    // The holder's hit point maximum cannot be reduced, by a drain, an effect
    // or exhaustion (Inured to Undeath, src/lib/dm/ar-ws-inured-logic.ts).
    | { kind: "max_hp_fixed" }
    // A casting of this spell makes this many more creatures (Undead Thralls:
    // Animate Dead, one; src/lib/dm/ar-ws-thralls.ts).
    | { kind: "summon_extra"; spell: string; amount: number }
    // What the holder makes with a spell of this school, of these creature
    // types, has its hit point maximum raised by the holder's level in the
    // class and adds the holder's proficiency bonus to its weapon damage
    // (Undead Thralls: necromancy, undead; src/lib/dm/ar-ws-thralls.ts).
    | { kind: "summon_thrall"; school: string; types: string[] }
    // The attacks of the holder's companion of these kinds count as magical
    // (Exceptional Training: the beast companion).
    | { kind: "pet_magical"; pets: Array<"familiar" | "beast_companion" | "drake" | "other"> }
    // Indomitable's reroll of an Intelligence, Wisdom or Charisma save lets
    // one ally in range that failed the same save reroll it too (Bulwark).
    | { kind: "indomitable_ally"; rangeFt: number }
    // The steel defender grows sturdier: its armor class rises by this much
    // (Improved Defender, src/lib/dm/summon-defender.ts).
    | { kind: "defender_upgrade"; ac: number }
    // The proficiency bonus added to an ability check made as part of a spell
    // of this school (Improved Abjuration: the checks of Counterspell and
    // Dispel Magic; src/lib/dm/ar-ws-spell-check.ts, through contest-roll.ts).
    | { kind: "spell_check_prof"; school: string }
    // Casting a spell of 1st level or higher that deals one of these damage
    // types deals `amount` of one of them to the hostile creatures within
    // `feet` the holder can see (Heart of the Storm: src/lib/dm/ar-ws-heart-storm.ts,
    // from the cast door).
    | { kind: "cast_burst"; types: string[]; feet: number; amount: Formula }
  );

export type NaturalWeapon = {
  name: string;
  aliases?: string[];
  dice: Formula;
  type: string;
  // Ranged (Radiant Sun Bolt), finesse (the psychic blade: the better of STR
  // and DEX), a reach of 10 feet (the tail), thrown with its range.
  ranged?: boolean;
  finesse?: boolean;
  reach?: boolean;
  thrown?: boolean;
  light?: boolean;
  rangeFt?: number;
  longRangeFt?: number;
  // The die of the bonus-action second attack, when the feature grants one.
  second?: string;
  // The bite: a hit while below half hit points heals the proficiency bonus,
  // once a turn. The claws: one more claw attack in the Attack action, once a
  // turn.
  onHit?: "bite_heal";
  extraAttack?: boolean;
  // Its attack and damage rolls use this ability, whatever the weapon's kind
  // (Armor Model: "you use Intelligence for the attack and damage rolls of
  // the armor's weapon").
  ability?: Ability;
};

export type AuthoredEffectKind = AuthoredEffect["kind"];

// What a use_resource call on the feature does (src/lib/dm/authored-spends.ts).
export type SpendDoes =
  // A condition on the holder, an ally (targetCharacterId), the named enemy
  // (targetEnemyId), or allies in range. `variants` maps a variant word to
  // the condition written; `tempHp` rides along.
  // The condition may name "{bardic}" (the bard's inspiration die) or
  // "{units}" (what the call spent), or step with the class level.
  | {
      kind: "buff";
      // The named creature's mark comes with the Hound of Ill Omen itself, a
      // creature on the holder's side bound to it (src/lib/dm/ar-ws-hound.ts).
      hound?: boolean;
      condition: string | Array<[number, string]>;
      rounds: number;
      // The length is this many rounds for each point of the holder's
      // proficiency bonus, in place of `rounds` (Bottled Respite: "twice your
      // proficiency bonus in hours", 1,200 rounds a point); `rounds` is then
      // the length at +2. Read by authored-spend-effects.ts resolveSpendEffect.
      roundsPerProf?: number;
      // "creature": a creature of either side (Adjust Density: "a creature's
      // ... weight"): the enemy named in targetEnemyId, else the ally named in
      // targetCharacterId, else the holder.
      target?: "self" | "ally" | "enemy" | "allies" | "creature";
      // The mark lasts until the holder's long rest, not a count of rounds
      // (Awakened Spellbook's ritual at its normal casting time, kept until
      // a ritual uses it: src/lib/dm/ar-ws-swift-ritual.ts).
      untilLongRest?: boolean;
      // The mark has no clock: it lasts until the next use of the feature
      // replaces it (Whispers of the Dead's proficiency).
      lasting?: boolean;
      // An ally other than the holder ("a willing creature other than
      // yourself": Blessing of the Trickster): the holder is no target.
      othersOnly?: boolean;
      variants?: Record<string, string>;
      tempHp?: Formula;
      rangeFt?: number;
      count?: Formula;
      teleportFeet?: number;
      // A mark laid on the named creature beside the holder's own condition
      // (Slayer's Prey: the prey Supernatural Defense reads).
      mark?: string;
      // The holder's condition is a mark on the named creature (its meta's
      // quarry, src/lib/dm/attack-marks.ts): Target Lock, Quarry.
      quarry?: boolean;
      // An enemy target no larger than this (Wolf Takedown: "a Large or smaller
      // creature"); with the spend's afterWeaponHit, the creature is the one
      // a melee weapon attack hit this turn (src/lib/dm/mt-fb-spend.ts).
      maxSize?: string;
      // The holder's condition ends when they are incapacitated (Hexblade's
      // Curse), read by set-condition.ts with concentration.
      endsIfIncapacitated?: boolean;
      // The spend's own burst (Arms of the Astral Self, Avenging Angel).
      // `mark`: a second condition each creature that failed carries
      // (Avenging Angel: "menaced", which gives every attacker advantage).
      // `endsOnDamage`: the condition and the mark end when the creature takes
      // damage (Avenging Angel: "for a minute or until it takes damage").
      // `aura`: the burst is an aura that also asks each enemy as it first
      // enters it or starts its turn in it (src/lib/dm/aura-menace.ts).
      // `untilNextTurnEnds`: the burst's condition lasts until the end of the
      // holder's next turn (Hour of Reaping), not a count of rounds.
      burst?: { save: Ability; dcAbility: Ability | "spell"; rangeFt: number; dice?: Formula; type?: string; condition?: string; mark?: string; rounds?: number; endsOnDamage?: boolean; aura?: boolean; untilNextTurnEnds?: boolean };
      // Until the end of the holder's next turn, not a count of rounds (Cloak
      // of Shadows). `rounds` still states its length on the card.
      untilNextTurnEnds?: boolean;
      // A condition of this family the holder already carries is taken off
      // first: one form at a time (Starry Form's constellations).
      replaces?: string;
      // Until the rest it was raised for ends, short or long (Hearth of
      // Moonlight and Shadow): take_rest takes it off.
      untilRestEnds?: boolean;
      // Only allies the holder can see (Watcher's Will: "creatures you can
      // see"): an invisible one, or any while the holder is blinded, is left
      // out, and one named for it is refused with nothing spent.
      sight?: boolean;
      // The area the holder's condition carries on the board, laid around
      // them with it (Dread Lord's gloom: a row of
      // src/lib/battlemap/zones-features.ts, gone with the condition).
      zone?: string;
    }
  // Choose an option for the feature, outside a fight: the feature is
  // renamed "Feature (Option)", which the passive effects read.
  // `feature`: the feature whose option is renamed, when it is another one
  // than the spend's own (Waxing and Waning changes Lunar Embodiment's phase).
  // `changeAfterCast`: the first choice follows the spend's own rules; a
  // change needs a spell of this school and level just cast by the holder,
  // in a fight or out, and each casting opens one (Transmuter's Stone,
  // src/lib/dm/ar-ws-stone.ts).
  // `changeAt: "level"`: once chosen, changed only by a level-up in the
  // feature's class (Storm Aura: "changed when you gain a barbarian level"),
  // which the level-up dialog offers (src/lib/srd/level-up-changes.ts).
  | { kind: "choose"; options: string[]; feature?: string; changeAfterCast?: { school: string; minLevel: number }; changeAt?: "level" }
  // One enemy saves or suffers: damage (per unit spent when `perUnit`),
  // a condition, or a note on movement the DM makes on the board.
  | {
      kind: "save_effect";
      // On a failed save the creature uses its reaction to make one melee
      // attack against the creature the call names in targetEnemyIds, the
      // holder's choice (Infectious Fury; src/lib/dm/mt-fb-spend.ts forcedStrike).
      strikes?: boolean;
      save: Ability;
      // The creature picks: it rolls whichever of the two is better for it
      // (Nature's Wrath: "a Strength or Dexterity save").
      orSave?: Ability;
      dcAbility: Ability | "spell";
      dice?: Formula;
      perUnit?: string;
      type?: string;
      half?: boolean;
      // The dice land whether or not the save is made: the save is only for
      // the condition (Fire Rune: the extra fire is the hit's, the save the
      // shackles').
      whole?: true;
      condition?: string;
      rounds?: number;
      // The condition lasts until the creature saves at a round's end; with
      // `orSave`, it picks between the two again at each of those saves.
      saveEnds?: boolean;
      rangeFt?: number;
      // Only a creature the holder can see (Nature's Wrath): in line of sight,
      // not invisible or hidden, and the holder not blinded.
      sight?: boolean;
      onFail?: string;
      // Only a creature this size or smaller, one size or a ladder by class
      // level (Elk Trample: Large; Mighty Impel: Medium, Large from 14th), and
      // a failed save throws it up to this many feet (Mighty Impel):
      // src/lib/dm/mt-fb-spend.ts.
      maxSize?: string | Array<[number, string]>;
      throws?: { feet: number };
      // A failed save pushes it this many feet straight away from the holder
      // (Telekinetic Thrust's push).
      pushes?: { feet: number };
      typeFromVariant?: string[];
      // Only a creature of these types (its block's type, creature-type.ts):
      // any other is refused before the use is paid.
      types?: string[];
      // The creature rolls with advantage when its score in this ability is
      // at least `atLeast` (Command Undead: "if the target has an
      // Intelligence of 8 or higher, it has advantage on the saving throw").
      advantageAt?: { ability: Ability; atLeast: number };
      // The condition hands the creature to the holder: it fights on their
      // side while the condition lasts, and the holder's next use lets the
      // last creature go (src/lib/dm/command-undead.ts).
      commands?: boolean;
      // A creature that failed, with this ability at `atLeast` or more,
      // repeats the save at the end of every hour and breaks free on a
      // success (Command Undead: Intelligence 12; rolled as the clock moves,
      // src/lib/dm/ar-ws-command-hours.ts).
      hourlySaveAt?: { ability: Ability; atLeast: number };
      // A second condition laid with it, ending with it (Hypnotic Gaze:
      // incapacitated beside charmed); both end on any damage, or once the
      // holder is more than `leashFeet` away (src/lib/dm/condition-leash.ts).
      alsoCondition?: string;
      endsOnDamage?: boolean;
      leashFeet?: number;
      // Until the end of the holder's next turn, not a count of rounds.
      untilNextTurnEnds?: boolean;
      // Refused when the creature can neither see nor hear the holder.
      senses?: "see_or_hear";
      // Once used on a creature, whatever the result, not on it again until
      // the holder's long rest; a use while it still holds renews it
      // (src/lib/dm/authored-save-effect-extras.ts).
      oncePerCreature?: boolean;
    }
  // Every foe in reach that the holder can see saves or suffers, with one roll
  // of damage shared among them. `types` keeps it to creatures of those types;
  // with none of them in reach, nothing is spent.
  | {
      kind: "save_area";
      save: Ability;
      dcAbility: Ability | "spell";
      rangeFt: number;
      dice?: Formula;
      type?: string;
      half?: boolean;
      condition?: string;
      rounds?: number;
      // Until the end of the holder's next turn, not a count of rounds.
      untilNextTurnEnds?: boolean;
      endsOnDamage?: boolean;
      // Held while the holder stands within this many feet and is neither down
      // nor incapacitated, with no count of rounds (src/lib/dm/condition-leash.ts).
      leashFeet?: number;
      onFail?: string;
      types?: string[];
      // The creatures of the user's choice in reach, named in targetEnemyIds
      // (every one when none is named): "each creature of your choice".
      chosen?: boolean;
      // Only creatures the holder can see (a wall or a heavily obscured space
      // hides one). Without it every creature in reach is caught: Radiance of the
      // Dawn's text asks no sight, and Order's Demand's "see or hear" carries
      // through a fog. True also leaves out an invisible or hidden creature, and
      // every one while the holder is blinded (Champion Challenge: "that you can
      // see"). "seesHolder" turns it round: Charm Animals and Plants takes a
      // beast "that can see you", so a blinded one is left out, and every one
      // while the cleric is invisible or hidden from it.
      sight?: true | "seesHolder";
      // A creature with total cover from the holder is not affected, seen or
      // not (Radiance of the Dawn reaches into a fog, not through a wall).
      coverShields?: boolean;
      // Every area of magical darkness within rangeFt of the holder ends, of
      // any spell level (Radiance of the Dawn). With darkness in reach the use
      // is not refused for want of a foe.
      dispelsDarkness?: boolean;
      // Only a creature that can see or hear the holder: one deafened that
      // cannot see them is left out (Order's Demand).
      seesOrHears?: true;
      // A second condition each creature that failed carries, until it is
      // taken off (Order's Demand: "disarmed", what it held dropped).
      mark?: string;
      // The condition lasts until the end of each creature's own next turn
      // (Lunar Phenomenon: "until the end of its next turn"), not the holder's.
      untilItsTurnEnds?: boolean;
      // One creature of the holder's choice in reach regains this: the
      // character named in targetCharacterId, else the holder (Full Moon).
      heals?: { formula: Formula; rangeFt: number };
      // The holder turns invisible until the end of their next turn, or until
      // they attack or cast a spell (New Moon). Both read by
      // src/lib/dm/ar-ws-lunar-phenomenon.ts.
      veils?: boolean;
    }
  | { kind: "reroll_save" }
  // The healing dice of a spell cast this turn rolled again, the new roll
  // standing (Empowered Healing: src/lib/dm/ar-ws-empowered-healing.ts).
  | { kind: "reroll_heal" }
  // Temporary hit points: to the holder, or to allies in range.
  | { kind: "temp_hp"; formula: Formula; allies?: { rangeFt: number; count: Formula } }
  // A ward of dice on a creature in reach, one die for each unit spent, which
  // the creature spends off damage it takes until its next long rest (Bastion
  // of Law: src/lib/dm/ar-ws-bastion.ts).
  | { kind: "damage_ward"; die: string; rangeFt: number; condition: string }
  // Hit points to the characters in reach (Turn the Tide, Balm of Peace), at
  // least 1 each. `rangeFt` "move": the holder's speed plus 5 feet, for a
  // healing the holder deals as they walk past. `belowHalf`: only those at or
  // under half their maximum. `othersOnly`: not the holder. `each`: one roll
  // per creature, not one shared. `hears`: not a deafened creature. With
  // nobody to heal, nothing is spent (src/lib/dm/authored-heal-area.ts).
  // `divided`: the formula is a total shared among those healed (Clockwork
  // Cavalcade's 100 hit points), not each one's.
  // `chosen`: creatures of the holder's choice (Turn the Tide): a character
  // named in targetCharacterId is the one healed, and with none named every
  // one in reach is.
  | { kind: "heal_area"; formula: Formula; rangeFt: number | "move"; belowHalf?: boolean; othersOnly?: boolean; each?: boolean; hears?: boolean; note?: string; divided?: boolean; chosen?: boolean }
  // A creature touched rolls the die and regains one spent spell slot of
  // that level or lower (Bolstering Magic).
  | { kind: "regain_slot"; die: string }
  // An area the model resolves with aoe_damage: the dice, save and DC.
  // `noHalf`: a creature that saves takes nothing (Searing Sunburst).
  // `rangeFt`: how far from the holder a creature named may stand.
  | { kind: "aoe_report"; dice: Formula; perUnit?: string; baseUnits?: number; save: Ability; dcAbility: Ability | "spell"; type: string; area: string; noHalf?: boolean; rangeFt?: number }
  // `touched`: a willing creature the holder touches is the one moved.
  // `shadows`: only from dim light or darkness to dim light or darkness
  // (Shadow Walk: src/lib/dm/ar-ws-shadow-light.ts).
  // `companionFt`: one willing creature within that many feet, named in
  // targetCharacterId, goes too; `ward`: a condition on the holder and the
  // companion until the start of the holder's next turn (Crescent Moon:
  // src/lib/dm/ar-ws-lunar-phenomenon.ts).
  | { kind: "teleport"; feet: number; note?: string; touched?: boolean; shadows?: boolean; companionFt?: number; ward?: string }
  // Dice of damage onto the creature the holder just hit.
  // `afterSneak`: it answers the turn's Sneak Attack hit (action-budget.ts
  // SNEAK_HIT) and lands on a second creature within `rangeFt` of the one the
  // Sneak Attack struck, never that one; holding `firstToo`, the struck one
  // takes it as well (Wails from the Grave, Death's Friend).
  | { kind: "die_damage"; dice: Formula; type: string; afterSneak?: { rangeFt: number; firstToo?: string } }
  // Blade Flourish: the Bardic Inspiration die onto the hit, and AC for a
  // defensive flourish.
  | { kind: "flourish" }
  // Storm Aura's three environments.
  | { kind: "storm_aura" }
  // Cauterizing Flames: heal an ally or burn an enemy. `healOnly`: it only
  // heals (Hand of Healing).
  // `healReachFt`: the creature healed stands within that many feet of the
  // creature the turn's weapon hit landed on, and in the holder's sight
  // (Arcane Jolt: "a creature or object you can see within 30 feet of it").
  | { kind: "flames"; formula: Formula; type: string; healOnly?: boolean; healReachFt?: number }
  // A variant word picks one of several spends.
  // An option that rides a weapon hit this turn (Telekinetic Thrust after
  // Psionic Strike's) says so; the others of the same spend do not.
  // `roll`: with no variant named, this die picks the option, in the order
  // listed (Experimental Elixir's d6); a use bought with a spell slot still
  // names its own (src/lib/dm/authored-spends.ts).
  | { kind: "variants"; options: Record<string, { does: SpendDoes; action?: SpendAction; afterWeaponHit?: boolean }>; roll?: string }
  // Insightful Fighting: an Insight check against the creature's Deception.
  // A contest of the holder's skill against the creature's (Insightful
  // Fighting: Insight against Deception; Panache: Persuasion against
  // Insight), the condition laid on the creature for `rounds` when the
  // holder wins. `goads`: the condition is Panache's goad (goaded.ts).
  | { kind: "insight_contest"; condition: string; rounds: number; mine?: "persuasion"; theirs?: "insight"; goads?: true }
  // Gathered Swarm's push: after the holder's hit this turn, the creature hit
  // makes a STR save or is moved 15 feet (Mighty Swarm: and knocked prone);
  // it takes the swarm's once-a-turn place of the damage.
  | { kind: "swarm_push"; feet: number }
  // A creature the feature makes, as an ally with its stat block (the steel
  // defender, src/lib/dm/summon-defender.ts).
  | { kind: "summon"; form: string }
  // One option of an Arcane Archer's Arcane Shot (src/lib/dm/mt-fb-arcane-shot.ts).
  | { kind: "arcane_shot"; option: "banishing" | "beguiling" | "bursting" | "enfeebling" | "grasping" | "piercing" | "seeking" | "shadow" }
  // A nonmagical item the player names (in the variant) put in the holder's
  // pack, worth no more than `gpPerLevel` times the class level (Performance
  // of Creation: src/lib/dm/authored-spend-arcane.ts).
  | { kind: "create_item"; gpPerLevel: number }
  // A light the holder sheds and carries, lit by one call and doused by the
  // next: bright for `brightFt`, dim for `dimFt` beyond, the condition the
  // sheet carries while it is lit (Lunar Empowerment's Full Moon:
  // src/lib/dm/ar-ws-lunar-empowerment.ts toggleLight).
  | { kind: "light"; brightFt: number; dimFt: number; condition: string }
  // Nothing the engine moves: the spend pays its cost and the text says
  // what happens (Spirit Totem's move, the cannon's ballista option).
  | { kind: "note"; text: string }
  // Willing allies the holder can see within `rangeFt` answer the holder's
  // call (Call the Hunt): up to `count` of them, the one named in
  // targetCharacterId or else the nearest, each gain `condition`; the holder
  // gains `tempHpEach` temporary hit points for each one. `whileRaging`: the
  // condition ends with the holder's rage (src/lib/dm/rage-bound.ts).
  // Resolved by src/lib/dm/allies-join.ts.
  | { kind: "allies_join"; condition: string; rangeFt: number; count: Formula; rounds: number; tempHpEach?: number; whileRaging?: boolean }
  // One more attack in the Attack action being taken (Unleash Incarnation):
  // src/lib/dm/turn-budget.ts grantActionAttack. `note`: what the attack is
  // held to that the engine leaves to the GM (melee, from the echo's space).
  // `fromEcho`: the attack is made from the holder's echo, so a creature must
  // stand in reach of it (Unleash Incarnation; src/lib/dm/mt-fb-echo.ts).
  | { kind: "action_attack"; note: string; fromEcho?: boolean }
  // Manifest Echo: the echo placed on the board, swapped with or dismissed
  // (src/lib/dm/mt-fb-echo.ts echoSpend).
  | { kind: "echo" }
  // Manifest Mind: the spellbook's mind placed on the board
  // (src/lib/dm/scribe-mind.ts mindSpend).
  | { kind: "mind" }
  // Tales from Beyond: the tale rolled and kept, and the tale held played on
  // a creature (src/lib/dm/spirit-tales.ts).
  | { kind: "tell_tale" }
  // Magic Awareness and Unerring Eye: what the engine holds near the holder,
  // told to them (src/lib/dm/sense-magic.ts).
  | { kind: "sense"; what: "magic" | "deceit" }
  | { kind: "release_tale" }
  // Soul of Artifice: the attunement its hold at 1 hit point would end, named
  // as the variant (src/lib/dm/soul-of-artifice.ts).
  | { kind: "soul_ready" }
  // Spent dice come back to a pool (Psionic Recovery: one Psionic Energy die).
  // `clears`: the mark the spend's gate asked for is spent with it.
  | { kind: "restore"; pool: string; amount: number; clears?: string }
  // A scroll of a spell from the holder's book, named in the variant, of
  // these levels and cast with an action, written onto their pack (Master
  // Scrivener: src/lib/dm/ar-ws-scrivener.ts).
  | { kind: "scribe_scroll"; minLevel: number; maxLevel: number }
  // The GM's surge (a sorcerer's; the barbarian's Wild Surge is `wild_surge` below): with the pool's use spent it rolls on the wild magic
  // table and gives the use back; otherwise the holder's d20 is rolled and a 1
  // rolls on the table. `clears`: the mark the spend's gate asked for (Wild
  // Magic Surge: src/lib/dm/ar-ws-wild-surge.ts).
  | { kind: "wild_magic_surge"; pool: string; clears: string }
  // Controlled Chaos: one of the two wild magic rolls the surge left (src/lib/dm/ar-ws-wild-surge.ts pickChaos).
  | { kind: "chaos_pick" }
  // A creature the holder charmed saves or loses hours of memory, as many as
  // the call's amount, at most the ability modifier plus one; the mark it
  // then carries says how many (Alter Memories: src/lib/dm/ar-ws-alter-memories.ts).
  | { kind: "strip_memory"; save: Ability; dcAbility: Ability | "spell"; hoursAbility: Ability; condition: string }
  // Ends these conditions on the holder; refused, with nothing spent, when
  // they carry none of them (Guarded Mind: src/lib/dm/mt-fb-spend.ts).
  | { kind: "cleanse"; conditions: string[] }
  // Wild Surge (src/lib/dm/mt-fb-wild-surge.ts): `pick`, Controlled Surge's
  // choice of that number among the two rolled; `again`, the bonus-action
  // repeat of that effect while it is the surge in force.
  | { kind: "wild_surge"; pick?: number; again?: number }
  // Hunter's Sense: the named creature's damage immunities, resistances and
  // vulnerabilities, read from its stat block (src/lib/dm/authored-spend-divine.ts).
  | { kind: "reveal_defenses"; sight: true }
  // Inspiring Smite: right after a Divine Smite this turn, temporary hit
  // points rolled once and shared between the holder and the creature named
  // within rangeFt (amount: the named creature's part, the rest the holder's).
  | { kind: "smite_temp_hp"; formula: Formula; rangeFt: number }
  // Blessing of the Forge: the condition on the creature whose armor or
  // weapon is blessed (the holder or an ally), and the holder's earlier
  // blessing, of the family, taken off whoever carries it.
  | { kind: "forge_blessing"; condition: string; family: string; rounds: number }
  // Cauterizing Flames: on a creature standing in one of the druid's spectral
  // flames (src/lib/dm/cauterizing-flames.ts), heal it or burn it (the
  // flames kind, its `mode` the variant), and the flame goes out.
  | { kind: "cauterizing"; mode: "heal" | "burn"; formula: Formula; type: string }
  // The cleric spends of the divine package (src/lib/dm/authored-spend-divine-clr.ts):
  // Read Thoughts' save and reading, Invoke Duplicity's double (four with
  // Improved Duplicity), Artisan's Blessing's item, Eyes of the Grave's sense.
  | { kind: "read_thoughts"; rangeFt: number }
  | { kind: "duplicity"; condition: string; rounds: number }
  | { kind: "forge_item" }
  | { kind: "sense_undead"; rangeFt: number }
  // Exceptional Training: the Beast Master's bonus-action command to its
  // companion, one of `options` (src/lib/dm/authored-spend-divine-rng.ts).
  | { kind: "pet_command"; options: string[] }
  // A condition on the holder for the rest of this turn (Ethereal Step's
  // etherealness, "for one turn"); a round out of a fight.
  | { kind: "this_turn"; condition: string }
  // The druid and artificer spends of the divine package
  // (src/lib/dm/authored-spend-divine-dra.ts). Spirit Totem: the spirit called
  // to the point named (use_resource x and y, else the druid's square) within 60 feet, its
  // 30-foot aura a board area, and the bonus action that moves it 60 feet
  // (src/lib/dm/spirit-totem.ts).
  | { kind: "spirit_totem"; spirit: "bear" | "hawk" | "unicorn"; rounds: number }
  | { kind: "spirit_totem_move" }
  // Spreading Spores: a 10-foot cube at the square named within rangeFt, a
  // board area for `rounds` (src/lib/dm/spreading-spores.ts).
  | { kind: "spreading_spores"; rangeFt: number; rounds: number }
  // A creature the feature makes beside its holder, and the condition the
  // holder carries while it stands (src/lib/dm/feature-summons-dra.ts):
  // Summon Wildfire Spirit, Eldritch Cannon.
  | { kind: "wildfire_spirit"; condition: string; rounds: number }
  | { kind: "eldritch_cannon"; condition: string; rounds: number }
  // A monk's or a rogue's subclass spend wave 2 built, resolved by its id in
  // src/lib/dm/mt-mr-spends.ts. `aims`: who the Hand's card is aimed at.
  | { kind: "mr"; id: MrSpendId; aims?: "enemy" | "ally"; rangeFt?: number };

export type MrSpendId = "hand_of_healing" | "flurry_healing" | "hand_of_harm" | "deft_strike" | "cloak_of_shadows" | "question_spirit" | "psychic_teleport" | "rend_mind" | "wings_unfurled" | "wyrm_frighten" | "wyrm_ward";

// A precondition of a spend that a gate's words cannot say: the light on the
// holder's square, or a mark this turn left (src/lib/dm/mt-mr-needs.ts).
export type SpendNeed = "shadows" | "unarmed_in_action" | "flurry_harm" | "attack_action";

export type SpendAction = "action" | "bonus" | "reaction" | "none";

export type AuthoredSpend = {
  // The resource name use_resource sends (and other names it answers to).
  name: string;
  aliases?: string[];
  // A counter this spend uses: its own authored counter, or a shared pool
  // (ki, bardic_inspiration, sorcery_points, wild_shape...). `perUnit`: the
  // call's amount is what is spent (Touch of the Long Death's ki); `optional`
  // lets a call spend none.
  // `slot`: with the counter spent, a spell slot of 1st level or higher pays
  // for one more (Experimental Elixir, Eldritch Cannon), the lowest left.
  // `slotFallback`: with the counter spent, a spell slot of exactly this
  // level buys the use again (Living Legend: "Once per long rest, or by
  // expending a 5th-level spell slot").
  // `free`: the spend takes nothing from the pool while this holds (Flurry of
  // Healing and Harm's Hand of Harm on a Flurry of Blows strike).
  // `fallbackAmount`: what the fallback pool pays when it is not the same
  // amount (Rend Mind: three Psionic Energy dice for its one use).
  // `orTrinket`: with none left in the pool, a Phantom's soul trinket is
  // destroyed in its place (src/lib/dm/mt-mr-trinkets.ts).
  // `freeDie`: with no use left, a holder of that feature rolls the die in
  // place of the pool's and spends nothing (Master's Flourish: "you can roll
  // a d6 and use it instead of expending a Bardic Inspiration die").
  pool?: { id: string; amount?: number; perUnit?: boolean; max?: number; optional?: boolean; fallback?: string; slot?: boolean; slotFallback?: number; fallbackAmount?: number; free?: SpendNeed; orTrinket?: boolean; min?: number; freeDie?: { feature: string; die: string } };
  action?: SpendAction;
  gate?: Gate;
  // Asked after the gate and before anything is spent; unmet, the refusal
  // says what is missing.
  needs?: SpendNeed;
  // Once per rage and similar: a marker condition the spend leaves.
  oncePer?: { marker: string; rounds: number };
  oncePerTurn?: boolean;
  // The turn key oncePerTurn claims, when the spend shares its once-a-turn
  // with a rider (Gathered Swarm's push and its damage: "rider:gathered swarm").
  onceKey?: string;
  // Rides a weapon's hit (Arcane Jolt): on the holder's own turn one must have
  // landed, and a burn goes to the creature it hit. Off their turn (their steel
  // defender's hit, an opportunity attack) the engine has no record to ask. Any
  // weapon counts: an infused or attuned weapon reads as a plain one here, so
  // asking for a magic one would shut the feature for the artificers it is for.
  afterWeaponHit?: boolean;
  // Rides a run: the creature named was run at, at least this many feet
  // straight, right before a melee attack on it this turn (Ferocious Charger;
  // src/lib/dm/mt-fb-charge.ts chargeRefusal).
  chargeFeet?: number;
  // Rides a hit of one of the holder's natural weapons this turn, on the
  // creature named (Infectious Fury; src/lib/dm/mt-fb-charge.ts naturalHitRefusal).
  afterNaturalHit?: boolean;
  // Rides a wizard spell's damage of the holder's own turn (Power Surge): one
  // must have hurt a creature this turn, and the spend lands on a creature it
  // hurt (src/lib/dm/spell-damage-mark.ts).
  afterSpellDamage?: boolean;
  // Follows a spell of 1st level or higher the holder cast this turn
  // (Tempestuous Magic: src/lib/dm/ar-ws-tempest-logic.ts has the ruling).
  afterLevelledCast?: boolean;
  // Master of Hexes: moving the curse takes back the hit points its first
  // creature's death gave (src/lib/dm/master-of-hexes.ts).
  takesBackCurseHeal?: boolean;
  // Chosen outside a fight only, or only in one.
  fight?: "in" | "out";
  // Why an out-of-fight spend is refused in one, where its reason is not a
  // choice made when a rest ends (Artisan's Blessing is an hour's ritual):
  // the words after the spend's name.
  outOfFightWhy?: string;
  // The GM's call, not the player's: no card in the Hand (Wild Magic Surge,
  // which the GM may have the sorcerer roll).
  gm?: boolean;
  // The thing the spend works through must stand within `feet` of the
  // holder: its board area (Eldritch Cannon: "a bonus action activates it if
  // it is within 60 feet").
  nearZone?: { zone: string; feet: number; label: string };
  // While the holder carries a condition of `family` and holds `feature`, the
  // spend changes it for free, once a turn: no use, no action
  // (Twinkling Constellations: "you may change constellation each turn").
  swap?: { family: string; feature: string };
  // The creature the spend is given to (targetCharacterId, else the holder)
  // also gains these temporary hit points while the holder holds `feature`
  // (Restorative Reagents on an Experimental Elixir drunk).
  drinker?: { feature: string; tempHp: Formula };
  // The option chosen for this feature is the variant, and no other may be
  // named (Lunar Phenomenon releases the power of the current phase, the
  // choice of Lunar Embodiment).
  variantFrom?: string;
  does: SpendDoes;
};

// What a use_reaction call on the feature does (src/lib/dm/authored-reactions.ts).
export type ReactionDoes =
  // Less damage from the last hit on the holder or an ally in range.
  // "ward": the holder's Arcane Ward takes what it can (Projected Ward).
  // `reflect`: with that feature held, the damage prevented strikes the
  // attacker (Spirit Shield with Vengeful Ancestors).
  // `nearZone`: the creature it covers, the holder too, must stand within
  // `feet` of the holder's zone of that spell (Guardian Coil's tentacle:
  // src/lib/dm/zone-reach.ts), in place of a reach from the holder.
  | { kind: "reduce"; amount: Formula | "half" | "slot5" | "psionic_int" | "ward"; who: "self" | "ally" | "either"; rangeFt?: number; nearZone?: { spell: string; feet: number }; types?: string[]; reflect?: { feature: string; type: string } }
  // A bonus to AC (the Bardic Inspiration die, or the holder's Charisma modifier,
  // at least 1) against the last hit. `rangeFt`: it may cover an ally that near.
  // `strikeOnMiss`: a miss it causes lets the holder attack the attacker.
  // `amount.die`: a die rolled as the reaction is taken. `attackerWithinFt`:
  // only against a creature that near. `beastForm`: it is that natural weapon
  // of Form of the Beast (the tail: src/lib/dm/mt-fb-beast.ts).
  // `cantripsOnly`: every use leaves the holder casting only cantrips until
  // the end of their next turn (Arcane Deflection: src/lib/dm/ar-ws-deflection.ts).
  // `orSave`: the same reaction instead adds this much to a saving throw the
  // holder has just failed (Arcane Deflection's other half).
  | { kind: "ac_vs_hit"; amount: number | "bardic" | "cha" | { die: string }; rangeFt?: number; strikeOnMiss?: boolean; attackerWithinFt?: number; beastForm?: string; cantripsOnly?: boolean; orSave?: number }
  // The attack that hit is rolled again at disadvantage. `notVsAdvantage`:
  // not against an attack rolled with advantage (Shadowy Dodge).
  // `allyWith`: holding this feature, it may also answer a hit on an ally within
  // `rangeFt` (Improved Flare). `advantageOnMiss`: a miss gives the holder
  // advantage on their next attack roll against the attacker before the end
  // of their next turn (Entropic Ward; authored-hooks.ts reads the mark).
  // `anyAlly`: it answers a hit on any ally within `rangeFt` too, with no
  // feature to hold first (the Storm Rune's prophetic state, 60 feet).
  | { kind: "disadv_vs_hit"; notVsAdvantage?: boolean; allyWith?: string; anyAlly?: true; rangeFt?: number; advantageOnMiss?: boolean }
  // The attacker rolls the d20 that hit an ally in range again and must use the
  // new roll, high or low (Runic Shield). `roller`: the reach is to the creature
  // that rolled, not the one it hit, so a hit on the holder counts too
  // (Chronal Shift: "after you or a creature you can see within 30 feet of you
  // makes an attack roll").
  | { kind: "reroll_hit"; rangeFt: number; roller?: boolean }
  // Resistance to the last hit's damage when it is one of these types.
  // `bond`: only for the holder, and only while that creature is on their sheet and up
  // (a Drakewarden's drake); no other ally.
  | { kind: "resist_instance"; types: string[]; who: "either"; rangeFt: number; bond?: "drake" }
  // The holder takes the hit an ally in range took.
  // `share`: "halved", the holder takes half of it and the ally none
  // (Penance Shared); "split", each takes half (Blood Bond).
  // `resistFrom`: from this class level the holder resists what it takes
  // (Protective Bond with Expansive Bond).
  // `bond`: both creatures carry this condition (Protective Bond, the
  // Emboldening Bond); `teleport`: the holder steps to an open square beside
  // the ally first (src/lib/dm/protective-bond.ts).
  | { kind: "take_for_ally"; rangeFt: number | Array<[number, number]>; share?: "halved" | "split"; resistFrom?: number; bond?: string; teleport?: true }
  // Damage back at a creature: the attacker, or the named enemy.
  | {
      kind: "strike_back";
      // It answers a save a creature made, not a hit: no record says who forced a
      // save, so no card offers it, and the call names the creature.
      afterSave?: boolean;
      amount: Formula;
      type: string;
      // Or this type, the holder's choice (Wrath of the Storm: "lightning or
      // thunder damage (your choice)"): the one named after the feature, else
      // whichever the creature's defenses let more of through.
      orType?: string;
      melee?: boolean;
      rangeFt?: number;
      // `pushFeet`: on a failed save the creature is moved that far straight
      // away from the holder, on the board (Storm's Fury: src/lib/dm/ar-ws-storm-fury.ts).
      save?: { ability: Ability; dcAbility: Ability | "spell"; half?: boolean; onFail?: string; damageRegardless?: boolean; pushFeet?: number };
    }
  // The damage a hit dealt another creature, back at whoever dealt it, on a
  // save for half (Rebuke the Violent). `rangeFt`: how near the attacker is.
  | { kind: "echo_hit"; type: string; rangeFt: number; save: { ability: Ability; dcAbility: Ability | "spell" } }
  // One weapon attack with the reaction (the holder's own, or an ally's
  // when the feature belongs to someone else in the party).
  // `vowed`: only at the creature under the holder's Vow of Enmity, once it has attacked.
  // `weaponRange`: any weapon attack, in the weapon's own reach or range
  // (Inspiring Surge: "one weapon attack"), not only one within rangeFt.
  // `answers`: how many allies may answer one trigger, by the holder's class
  // level (Inspiring Surge: one, two from 18th; src/lib/dm/mt-fb-surge.ts).
  // `turnsSave`: a hit makes the save this reaction answers a success
  // (Slayer's Counter; save-turned.ts).
  | { kind: "attack"; rangeFt: number; onHitCondition?: { name: string; rounds: number }; vowed?: boolean; weaponRange?: boolean; answers?: Array<[number, string]>; turnsSave?: true }
  // The creature saves or gains a condition (Beguiling Defenses, Raging Storm).
  // `pullFeet`: a creature that fails is pulled that far straight toward the
  // reactor; `attackWithin`: and, ending within that many feet, takes one melee
  // weapon attack as part of the reaction (Perfected Armor's Guardian).
  // `also`: conditions laid with it that end with it, and `saveEnds`: the
  // creature saves again at the end of each of its turns, one roll ending them
  // all (the Stone Rune's charm: incapacitated, speed 0, for a minute).
  | { kind: "save_condition"; save: Ability; dcAbility: Ability | "spell"; condition: string; rounds?: number; variants?: Record<string, string>; pullFeet?: number; attackWithin?: number; also?: string[]; saveEnds?: true }
  // The holder gains a condition (Tokens of the Departed's soul trinket).
  | { kind: "gain_condition"; condition: string; rounds: number }
  // The attack's die is lowered by a die (Bend Luck).
  | { kind: "attack_penalty"; die: string }
  // The last hit on the holder lands on the creature beside them instead.
  // `save`: the attacker first saves against the holder's DC and keeps its
  // target on a success (Instinctive Charm).
  // `within`: the hit on the holder or on a creature they can see within that
  // many feet turns onto another creature within as many feet of the holder,
  // not the attacker, on the same roll, at a stop before its damage is rolled
  // (the Cloud Rune: src/lib/dm/cloud-rune.ts); no card answers it afterwards.
  | { kind: "redirect"; save?: { ability: Ability; dcAbility: Ability | "spell" }; rangeFt?: number; within?: number }
  // The hit misses on this die or higher (Armor of Hexes: a d6, 4 or more),
  // against a creature the holder marked with this condition.
  | { kind: "chance_miss"; die: string; min: number; vsMark?: string }
  // The last hit is declared a miss, for a level of exhaustion.
  // `rangeFt`: the attacker made its roll within this many feet of the holder.
  | { kind: "force_miss"; exhaustion: number; rangeFt?: number }
  // A critical hit on the holder or a creature in range becomes a normal hit:
  // the same dice without the critical's, and a death-save failure for one blow
  // at 0 rather than two (Sentinel at Death's Door).
  | { kind: "uncrit"; rangeFt: number }
  // The holder's echo takes the attack that hit another creature, and the hit
  // becomes a miss for them. The echo is no creature the engine tracks.
  | { kind: "echo_takes_hit" }
  // A move off the holder's turn, up to half their speed, drawing no
  // opportunity attack: when an enemy stands within 5 feet (Skirmisher), or
  // right after the holder's opportunity attack hit, as part of that same
  // reaction (Relentless Avenger: `free`, the reaction already spent).
  | { kind: "move"; trigger: "enemy_adjacent" | "oa_hit"; free?: boolean }
  // A melee attack that missed the holder hits another creature within 5
  // feet of them instead (Tipsy Sway).
  | { kind: "redirect_miss"; rangeFt: number }
  // The holder's Wild Surge is rolled again (Unstable Backlash).
  | { kind: "resurge" };

export type AuthoredReaction = {
  name: string;
  aliases?: string[];
  gate?: Gate;
  pool?: { id: string; amount?: number } | { slot: true };
  // Who takes the reaction: the feature's holder (default), a creature
  // holding the holder's Bardic Inspiration, or any ally of the holder.
  usedBy?: "holder" | "inspired" | "party";
  // Its text needs the holder to see a creature: the one the hit fell on
  // ("a creature you can see", Runic Shield, Sentinel at Death's Door) or the
  // attacker (Warding Flare). On a board, line of sight decides; off one, it
  // is open. "both": the attacker and the ally it struck (Warding Flare with
  // Improved Flare: "a creature you can see within 30 feet attacks ... a
  // creature other than you that you can see").
  sees?: "target" | "attacker" | "both";
  does: ReactionDoes;
};

export type AuthoredEntry = {
  subclass: string;
  // Never borrowed by name (authored-effects.ts borrowedRow): the feature's
  // name is also a core feature of other classes, which mean something else
  // by it (the Bladesinger's Extra Attack is not a fighter's or a Valor bard's).
  ownClassOnly?: boolean;
  effects?: AuthoredEffect[];
  spends?: AuthoredSpend[];
  reactions?: AuthoredReaction[];
  // The counter authored-resources.json holds for it, when the feature is
  // limited-use as well.
  counter?: string;
  // An engine outside this layer applies it (the subclass spell table, the
  // beast forms, the maneuver die): the file and the call it makes there,
  // which the tests hold to the file.
  heldBy?: { file: string; call: string };
  // Pure roleplay or information, or a mechanic an engine outside this
  // layer must hold first: said why, never left blank.
  narrated?: string;
};
