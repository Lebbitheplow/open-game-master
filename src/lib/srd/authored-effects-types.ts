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
  // The option chosen for this feature ("Totem Spirit (Bear)"), or for
  // another feature of the same sheet ("Armor Model (Guardian)").
  choice?: string;
  choiceOf?: { feature: string; value: string };
  // The class that granted the feature has reached this level (a part of
  // the feature that arrives later: Spiritual Focus's d6 from 6th level).
  level?: number;
};

type Base = { gate?: Gate; note?: string };

// Passive effects, each read by one engine (AUTHORED_READERS names where).
export type AuthoredEffect = Base &
  (
    // Damage resistance. `spells`: only to damage from spells.
    | { kind: "resist"; types: string[] | "all"; except?: string[]; nonmagical?: boolean; spells?: boolean }
    | { kind: "immune_damage"; types: string[] }
    | { kind: "immune_condition"; conditions: string[] }
    // Advantage on a save: against what the save resists (one of the
    // roll's `against` values, or magic), or every save of an ability.
    | { kind: "save_adv"; against?: SaveAgainstValue[]; magical?: true; ability?: Ability }
    | { kind: "save_prof"; abilities: Ability[] }
    | { kind: "save_bonus"; amount: number }
    // A save of one ability uses another ability's modifier when higher.
    | { kind: "save_swap"; save: Ability; use: Ability }
    | { kind: "ac"; amount: number }
    // Walking speed, through feature-effects' speed_bonus.
    | { kind: "speed"; amount: number }
    // Other movement modes: a number of feet, or "walk" for the walking speed.
    | { kind: "move"; fly?: number | "walk"; swim?: number | "walk" }
    | { kind: "init_adv" }
    | { kind: "init_ability"; ability: Ability }
    // Advantage on checks: named skills, or checks of an ability about one
    // circumstance (the roll's `about`).
    | { kind: "check_adv"; skills?: string[]; abilities?: Ability[]; about?: CheckAbout }
    // A critical hit against the holder is a normal hit.
    | { kind: "crit_immune" }
    // The holder's damage of these types ignores resistance.
    | { kind: "ignore_resist"; types: string[] }
    // Attacks against the holder by creatures of these types are at
    // disadvantage.
    | { kind: "attacked_disadv"; from: string[] }
    // A creature of these types that targets the holder with an attack must
    // first save against the holder's spell save DC or lose the attack
    // (Among the Dead: undead, Wisdom).
    | { kind: "ward_vs"; types: string[]; save: Ability }
    // Opportunity attacks against the holder are made at disadvantage
    // (Totem Spirit: Eagle).
    | { kind: "oa_disadv" }
    // The holder uses this ability for the attack and damage rolls of the
    // weapon the feature's option names, when it is higher (Hex Warrior:
    // Charisma, "Hex Warrior (Longsword)").
    | { kind: "weapon_ability"; ability: Ability; magicOnly?: boolean }
    // Darkvision to this range, or `orAdd` more feet when the holder already
    // sees in the dark (Umbral Sight: 60, or 30 more).
    | { kind: "darkvision"; feet: number; orAdd?: number }
    // An ability modifier (at least +1) added to the damage of the holder's weapon attacks
    // (Aura of Hate: Charisma, melee; Song of Victory: Intelligence, melee,
    // while bladesinging).
    | { kind: "damage_ability"; ability: Ability; when: "melee" | "weapon"; requiresCondition?: string }
    // The proficiency bonus added to initiative (Aura of the Sentinel).
    | { kind: "init_prof" }
    // A d20 at or below `floor` - 1 counts as `floor` on checks with these
    // skills (Silver Tongue: 10 on Persuasion and Deception).
    | { kind: "check_floor"; skills: string[]; floor: number }
    // A spell of 1st level or higher that kills heals the holder twice its
    // level, three times for necromancy, once a turn (Grim Harvest).
    | { kind: "grim_harvest" }
    // The holder's attacks have advantage: against a creature that has not
    // taken a turn in the fight yet, against one the holder frightened,
    // against one the holder distracted, or against creatures of these types.
    | { kind: "attack_adv"; vs: "not_acted" | "frightened_by_self" | "distracted" | "types"; types?: string[] }
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
        when: "weapon" | "melee" | "ranged";
        oncePerTurn?: boolean;
        requiresCondition?: string;
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
        halve?: boolean;
        dice?: string;
        damageType?: string;
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
    | { kind: "bonus_attack"; after: "spell" | "cantrip" | "attack" | "telekinesis" | "missed_arrow" }
    // Enemies save at disadvantage: when the holder casting is hidden from
    // them, when they carry the holder's mark, or when they stand within
    // range of the holder (a spell's save, any caster when `anyCaster`).
    | { kind: "enemy_save"; when: "hidden" | "marked" | "near"; mark?: string; rangeFt?: number; anyCaster?: boolean }
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
    | { kind: "enemy_turn_damage"; formula: Formula; type: string; rangeFt: number | Array<[number, number]>; frightenedOnly?: boolean }
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
    | { kind: "reach"; tiles: number }
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
      }
    // Casting the spell gives temporary hit points, and damage never breaks
    // the concentration on it (Grasping Tentacles).
    // `school`: every spell of that school (Focused Conjuration).
    | { kind: "concentration_guard"; spell?: string; school?: string; tempHp: Formula }
    // A single-target spell of the school and level range strikes a second
    // creature within 5 feet of the first (Improved Reaper: 1st to 5th level
    // necromancy; Reaper: a necromancy cantrip; Moon Fire: sacred flame).
    | { kind: "twin_spell"; school: string; maxLevel: number; minLevel?: number; spells?: string[] }
    // pc_attack rapidStrike: an attack with advantage forgoes it for one more
    // attack of the action, once a turn (Rapid Strike).
    | { kind: "rapid_strike" }
    // An opportunity attack on every other creature's turn, each with its own
    // reaction (Vigilant Defender).
    | { kind: "oa_each_turn" }
    // Standing up from prone costs this many feet of movement (Tipsy Sway).
    | { kind: "stand_cost"; feet: number }
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
    // The attacks of the holder's companion of these kinds count as magical
    // (Exceptional Training: the beast companion).
    | { kind: "pet_magical"; pets: Array<"familiar" | "beast_companion" | "drake" | "other"> }
    // Indomitable's reroll of an Intelligence, Wisdom or Charisma save lets
    // one ally in range that failed the same save reroll it too (Bulwark).
    | { kind: "indomitable_ally"; rangeFt: number }
    // The steel defender grows sturdier: its armor class rises by this much
    // (Improved Defender, src/lib/dm/summon-defender.ts).
    | { kind: "defender_upgrade"; ac: number }
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
      condition: string | Array<[number, string]>;
      rounds: number;
      target?: "self" | "ally" | "enemy" | "allies";
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
      // The spend's own burst (Arms of the Astral Self, Avenging Angel).
      // `mark`: a second condition each creature that failed carries
      // (Avenging Angel: "menaced", which gives every attacker advantage).
      burst?: { save: Ability; dcAbility: Ability | "spell"; rangeFt: number; dice?: Formula; type?: string; condition?: string; mark?: string; rounds?: number };
      // Until the end of the holder's next turn, not a count of rounds (Cloak
      // of Shadows). `rounds` still states its length on the card.
      untilNextTurnEnds?: boolean;
      // Only allies the holder can see (Watcher's Will: "creatures you can
      // see"): an invisible one, or any while the holder is blinded, is left
      // out, and one named for it is refused with nothing spent.
      sight?: boolean;
    }
  // Choose an option for the feature, outside a fight: the feature is
  // renamed "Feature (Option)", which the passive effects read.
  | { kind: "choose"; options: string[] }
  // One enemy saves or suffers: damage (per unit spent when `perUnit`),
  // a condition, or a note on movement the DM makes on the board.
  | {
      kind: "save_effect";
      save: Ability;
      // The creature picks: it rolls whichever of the two is better for it
      // (Nature's Wrath: "a Strength or Dexterity save").
      orSave?: Ability;
      dcAbility: Ability | "spell";
      dice?: Formula;
      perUnit?: string;
      type?: string;
      half?: boolean;
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
    }
  | { kind: "reroll_save" }
  // Temporary hit points: to the holder, or to allies in range.
  | { kind: "temp_hp"; formula: Formula; allies?: { rangeFt: number; count: Formula } }
  // Hit points to the characters in reach (Turn the Tide, Balm of Peace), at
  // least 1 each. `rangeFt` "move": the holder's speed plus 5 feet, for a
  // healing the holder deals as they walk past. `belowHalf`: only those at or
  // under half their maximum. `othersOnly`: not the holder. `each`: one roll
  // per creature, not one shared. `hears`: not a deafened creature. With
  // nobody to heal, nothing is spent (src/lib/dm/authored-heal-area.ts).
  // `divided`: the formula is a total shared among those healed (Clockwork
  // Cavalcade's 100 hit points), not each one's.
  | { kind: "heal_area"; formula: Formula; rangeFt: number | "move"; belowHalf?: boolean; othersOnly?: boolean; each?: boolean; hears?: boolean; note?: string; divided?: boolean }
  // A creature touched rolls the die and regains one spent spell slot of
  // that level or lower (Bolstering Magic).
  | { kind: "regain_slot"; die: string }
  // An area the model resolves with aoe_damage: the dice, save and DC.
  | { kind: "aoe_report"; dice: Formula; perUnit?: string; baseUnits?: number; save: Ability; dcAbility: Ability | "spell"; type: string; area: string }
  // `touched`: a willing creature the holder touches is the one moved.
  | { kind: "teleport"; feet: number; note?: string; touched?: boolean }
  // Dice of damage onto the creature the holder just hit.
  | { kind: "die_damage"; dice: Formula; type: string }
  // Blade Flourish: the Bardic Inspiration die onto the hit, and AC for a
  // defensive flourish.
  | { kind: "flourish" }
  // Storm Aura's three environments.
  | { kind: "storm_aura" }
  // Cauterizing Flames: heal an ally or burn an enemy. `healOnly`: it only
  // heals (Hand of Healing).
  | { kind: "flames"; formula: Formula; type: string; healOnly?: boolean }
  // A variant word picks one of several spends.
  // An option that rides a weapon hit this turn (Telekinetic Thrust after
  // Psionic Strike's) says so; the others of the same spend do not.
  | { kind: "variants"; options: Record<string, { does: SpendDoes; action?: SpendAction; afterWeaponHit?: boolean }> }
  // Insightful Fighting: an Insight check against the creature's Deception.
  | { kind: "insight_contest"; condition: string; rounds: number }
  // Gathered Swarm's push: after the holder's hit this turn, the creature hit
  // makes a STR save or is moved 15 feet (Mighty Swarm: and knocked prone);
  // it takes the swarm's once-a-turn place of the damage.
  | { kind: "swarm_push"; feet: number }
  // A creature the feature makes, as an ally with its stat block (the steel
  // defender, src/lib/dm/summon-defender.ts).
  | { kind: "summon"; form: string }
  // Nothing the engine moves: the spend pays its cost and the text says
  // what happens (Spirit Totem's move, the cannon's ballista option).
  | { kind: "note"; text: string }
  // Spent dice come back to a pool (Psionic Recovery: one Psionic Energy die).
  // `clears`: the mark the spend's gate asked for is spent with it.
  | { kind: "restore"; pool: string; amount: number; clears?: string };

export type SpendAction = "action" | "bonus" | "reaction" | "none";

export type AuthoredSpend = {
  // The resource name use_resource sends (and other names it answers to).
  name: string;
  aliases?: string[];
  // A counter this spend uses: its own authored counter, or a shared pool
  // (ki, bardic_inspiration, sorcery_points, wild_shape...). `perUnit`: the
  // call's amount is what is spent (Touch of the Long Death's ki); `optional`
  // lets a call spend none.
  pool?: { id: string; amount?: number; perUnit?: boolean; max?: number; optional?: boolean; fallback?: string };
  action?: SpendAction;
  gate?: Gate;
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
  // Chosen outside a fight only, or only in one.
  fight?: "in" | "out";
  // The GM's call, not the player's: no card in the Hand (Wild Magic Surge,
  // which the GM may have the sorcerer roll).
  gm?: boolean;
  does: SpendDoes;
};

// What a use_reaction call on the feature does (src/lib/dm/authored-reactions.ts).
export type ReactionDoes =
  // Less damage from the last hit on the holder or an ally in range.
  // "ward": the holder's Arcane Ward takes what it can (Projected Ward).
  // `reflect`: with that feature held, the damage prevented strikes the
  // attacker (Spirit Shield with Vengeful Ancestors).
  | { kind: "reduce"; amount: Formula | "half" | "slot5" | "psionic_int" | "ward"; who: "self" | "ally" | "either"; rangeFt?: number; types?: string[]; reflect?: { feature: string; type: string } }
  // A bonus to AC (the Bardic Inspiration die, or the holder's Charisma modifier,
  // at least 1) against the last hit. `rangeFt`: it may cover an ally that near.
  // `strikeOnMiss`: a miss it causes lets the holder attack the attacker.
  | { kind: "ac_vs_hit"; amount: number | "bardic" | "cha"; rangeFt?: number; strikeOnMiss?: boolean }
  // The attack that hit is rolled again at disadvantage. `notVsAdvantage`:
  // not against an attack rolled with advantage (Shadowy Dodge).
  // `allyWith`: holding this feature, it may also answer a hit on an ally within
  // `rangeFt` (Improved Flare). `advantageOnMiss`: a miss gives the holder
  // advantage on their next attack roll against the attacker before the end
  // of their next turn (Entropic Ward; authored-hooks.ts reads the mark).
  | { kind: "disadv_vs_hit"; notVsAdvantage?: boolean; allyWith?: string; rangeFt?: number; advantageOnMiss?: boolean }
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
  | { kind: "take_for_ally"; rangeFt: number | Array<[number, number]>; share?: "halved" | "split"; resistFrom?: number }
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
      save?: { ability: Ability; dcAbility: Ability | "spell"; half?: boolean; onFail?: string; damageRegardless?: boolean };
    }
  // The damage a hit dealt another creature, back at whoever dealt it, on a
  // save for half (Rebuke the Violent). `rangeFt`: how near the attacker is.
  | { kind: "echo_hit"; type: string; rangeFt: number; save: { ability: Ability; dcAbility: Ability | "spell" } }
  // One weapon attack with the reaction (the holder's own, or an ally's
  // when the feature belongs to someone else in the party).
  // `vowed`: only at the creature under the holder's Vow of Enmity, once it has attacked.
  | { kind: "attack"; rangeFt: number; onHitCondition?: { name: string; rounds: number }; vowed?: boolean }
  // The creature saves or gains a condition (Beguiling Defenses, Raging Storm).
  | { kind: "save_condition"; save: Ability; dcAbility: Ability | "spell"; condition: string; rounds?: number; variants?: Record<string, string> }
  // The holder gains a condition (Tokens of the Departed's soul trinket).
  | { kind: "gain_condition"; condition: string; rounds: number }
  // The attack's die is lowered by a die (Bend Luck).
  | { kind: "attack_penalty"; die: string }
  // The last hit on the holder lands on the creature beside them instead.
  // `save`: the attacker first saves against the holder's DC and keeps its
  // target on a success (Instinctive Charm).
  | { kind: "redirect"; save?: { ability: Ability; dcAbility: Ability | "spell" }; rangeFt?: number }
  // The hit misses on this die or higher (Armor of Hexes: a d6, 4 or more),
  // against a creature the holder marked with this condition.
  | { kind: "chance_miss"; die: string; min: number; vsMark?: string }
  // The last hit is declared a miss, for a level of exhaustion.
  | { kind: "force_miss"; exhaustion: number }
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
  | { kind: "redirect_miss"; rangeFt: number };

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
  // is open.
  sees?: "target" | "attacker";
  does: ReactionDoes;
};

export type AuthoredEntry = {
  subclass: string;
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
