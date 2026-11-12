// Every choice a character may make after a d20 has landed and before the game
// says what it did: one row per feature. The choices made before a d20 is
// thrown are not rows: Portent, Cosmic Omen and Restore Balance are the
// stop's own powers (STOP_POWERS below), used at the hold before the
// holder's own roll and at the watch stop before another's, and never on
// this card (the maintainer's ruling on issue #908). The after-the-roll card
// (after-roll-logic.ts, after-roll.ts, AfterRollCard.tsx), the watch stop
// before a roll inside a call (foresight.ts, chronal-shift.ts, WatchCard.tsx),
// the route enums and the client's types all read this table.
//
// Before it, each feature was written out by hand in about ten files across
// those two systems (Favored by the Gods in the option builders, the spend
// branches, the card route's enum, the watch stop's power list, its route,
// the card's labels, the stream's type ...), and a new one meant finding
// them all. A new feature here is a row, and the code that is not the same
// for every row is the row's own effect.
//
// Pure and client-safe: no database, no sheet reads. What a row holds is
// what its rules say, in our own words.

// What a row costs: a use of its own counter (`counter`), a use of Channel
// Divinity, a Lucky feat's luck point, a die already held as a condition
// (Bardic Inspiration, a called-up Dark One's Own Luck), or what the row's
// own module charges (`own`: Psionic Energy paid only on a success, a level
// of exhaustion, sorcery points, the reaction alone).
export type AfterRollCost = "counter" | "channel_divinity" | "luck_point" | "held_die" | "own";

// Which rolls a row answers, by the card's words: an ability check (initiative
// among them), a saving throw (a death save among them), an attack roll.
export type AfterRollKind = "check" | "save" | "attack";

// Whose roll: the holder's own; another creature's within `rangeFt`
// ("an ally" on the card, since only a player's roll waits on a card); or
// either.
export type AfterRollWhose = "own" | "other" | "own_or_other";

// What choosing it does to the roll:
//   extra_d20     another d20 joins the pool and the player picks the one that counts (Lucky)
//   add_die       a die is added to the total (Bardic Inspiration, Dark One's Own Luck)
//   add_dice      dice are added to the total (Favored by the Gods' 2d4)
//   add_flat      a number is added (Guided Strike's 10, Flash of Genius's Intelligence modifier)
//   reroll        the d20s are rolled again, and the new roll stands (Chronal Shift)
//   reroll_edge   rolled again with advantage, and the new roll stands (Master Duelist)
//   hit_damage    the hit deals more: flat, dice, or its lightning and thunder at their maximum
//   own           the row's `module` offers it and spends it, since what it does
//                 reads more than the table holds (a once-a-turn mark, a die paid
//                 only if it turns the roll, a proficiency, a roll dictated outright)
export type AfterRollEffect = "extra_d20" | "add_die" | "add_dice" | "add_flat" | "reroll" | "reroll_edge" | "hit_damage" | "own";

// How much an add_* or hit_damage row adds. `ability`: the holder's modifier
// for it. `held`: the size of the die held on the sheet. `level`: 5 + twice
// the class level (Touch of Death). `max`: lightning and thunder at their
// maximum (Destructive Wrath).
export type AfterRollAmount =
  | { kind: "flat"; value: number }
  | { kind: "dice"; count: number; sides: number; type?: string }
  | { kind: "ability"; ability: "int" }
  | { kind: "held"; condition: "bardic inspiration" | "dark one's own luck"; fallback?: string }
  | { kind: "level"; className: string; base: number; per: number; type: string }
  | { kind: "max" };

// When it is offered: on a roll that falls short of its target (a miss, a
// failed check or save, or one with no known target), or on a hit.
export type AfterRollWhen = "short" | "hit";

// The watch stop's side of a row: the roll is inside a call where no card can
// wait, so the player says at the stop before it "if it goes the wrong way"
// and the roll site takes it (chronal-shift.ts). `button` is the card's
// button with `{when}` ("if it fails") and `{amount}` filled in; `hint` what
// watching lets the player do; `title` the button's tooltip; `spentError` the
// watch route's refusal when it can no longer be paid.
export type AfterRollWatch = { hint: string; button: string; title: string; spentError: string };

export type AfterRollRow = {
  id: string;
  // The feature's name as a sheet holds it, and as the card and the logs say it.
  feature: string;
  cost: AfterRollCost;
  // The counter a "counter" row spends.
  counter?: string;
  // Spending it takes the holder's reaction.
  reaction: boolean;
  kinds: readonly AfterRollKind[];
  whose: AfterRollWhose;
  // "within N feet": for another creature's roll.
  rangeFt?: number;
  // "a creature you can see": another's roll in the holder's sight.
  sight?: boolean;
  effect: AfterRollEffect;
  // The file that offers and spends an `own` row.
  module?: string;
  amount?: AfterRollAmount;
  when: AfterRollWhen;
  // A hit with a melee attack only (Touch of Death), or with a weapon
  // (Violent Attraction).
  hitBy?: "melee" | "weapon";
  // The Hand deals no card for it: one played after the roll had landed
  // spent a use and changed nothing (hand-spells.ts, hand-options.ts).
  // use_resource still takes it, for a roll that cannot wait.
  cardOnly?: boolean;
  // The holder's own use is offered among the helpers' choices, after
  // theirs, where whether its reaction is free is read from the fight
  // (after-roll.ts allyChoicesFor), not with the roller's own options.
  ownAmongHelpers?: boolean;
  watch?: AfterRollWatch;
  // The button and its tooltip on the card, on the holder's own roll and on
  // another's. {what} is "save", "check" or "attack roll"; {roll} "roll" or
  // "attack roll"; {amount} what it adds; {name} whose roll.
  label: string;
  note: string;
  otherLabel?: string;
  otherNote?: string;
};

export const AFTER_ROLL_ROWS = [
  {
    // Lucky (feat): a luck point buys one more d20, and the player picks which die counts.
    id: "lucky",
    feature: "Lucky",
    cost: "luck_point",
    reaction: false,
    kinds: ["check", "save", "attack"],
    whose: "own",
    effect: "extra_d20",
    when: "short",
    label: "Lucky: roll another d20",
    note: "Spend a luck point: roll another d20, then choose which die counts.",
  },
  {
    id: "bardic",
    feature: "Bardic Inspiration",
    cost: "held_die",
    reaction: false,
    kinds: ["check", "save", "attack"],
    whose: "own",
    effect: "add_die",
    amount: { kind: "held", condition: "bardic inspiration" },
    when: "short",
    label: "Add Bardic Inspiration ({amount})",
    note: "Spend your Bardic Inspiration die: add 1{amount} to this {roll}.",
  },
  {
    // Dark One's Own Luck: a d10 added to the warlock's own check or save.
    id: "own_luck",
    feature: "Dark One's Own Luck",
    cost: "held_die",
    counter: "dark_ones_own_luck",
    reaction: false,
    kinds: ["check", "save"],
    whose: "own",
    effect: "add_die",
    amount: { kind: "held", condition: "dark one's own luck", fallback: "d10" },
    when: "short",
    label: "Add Dark One's Own Luck ({amount})",
    note: "Add 1{amount} to this check or save.",
  },
  {
    // Chronal Shift (Chronurgy 2): once the wizard has seen an attack roll,
    // check or save made by themselves or a creature in sight within 30 feet,
    // their reaction makes it be rolled again.
    id: "chronal_shift",
    feature: "Chronal Shift",
    cost: "counter",
    counter: "sub_chronal_shift",
    reaction: true,
    kinds: ["check", "save", "attack"],
    whose: "own_or_other",
    rangeFt: 30,
    sight: true,
    effect: "reroll",
    when: "short",
    watch: {
      hint: "use Chronal Shift on it",
      button: "Roll it again {when}",
      title: "Spend a use of Chronal Shift and your reaction only if the roll goes that way: it is rolled again and the new roll stands.",
      spentError: "Your Chronal Shift is spent, or your reaction is.",
    },
    label: "Chronal Shift: roll it again",
    note: "Spend a use of Chronal Shift and your reaction: roll this {what} again, and the new roll stands.",
    otherLabel: "Chronal Shift: make {name} roll again",
    otherNote: "Spend a use of Chronal Shift and your reaction: {name} rolls this {what} again, and the new roll stands.",
  },
  {
    // Guided Strike (War Domain 2, Oath of Conquest 3): +10, after the roll
    // and before the GM says whether it hits.
    id: "guided_strike",
    feature: "Guided Strike",
    cost: "channel_divinity",
    reaction: false,
    kinds: ["attack"],
    whose: "own",
    effect: "add_flat",
    amount: { kind: "flat", value: 10 },
    when: "short",
    cardOnly: true,
    label: "Guided Strike: add {amount}",
    note: "Spend a use of Channel Divinity: add {amount} to this attack roll.",
  },
  {
    // Master Duelist (Swashbuckler 17): a missed attack may be rolled again
    // with advantage.
    id: "master_duelist",
    feature: "Master Duelist",
    cost: "counter",
    counter: "sub_master_duelist",
    reaction: false,
    kinds: ["attack"],
    whose: "own",
    effect: "reroll_edge",
    when: "short",
    cardOnly: true,
    label: "Master Duelist: roll again with advantage",
    note: "Spend your use of Master Duelist: roll this attack again with advantage, and the new roll stands.",
  },
  {
    // Flash of Genius (Artificer 7): the artificer's reaction adds their
    // Intelligence modifier to a check or save made by themselves or a
    // creature in sight within 30 feet.
    id: "flash_of_genius",
    feature: "Flash of Genius",
    cost: "counter",
    counter: "art_flash_of_genius",
    reaction: true,
    kinds: ["check", "save"],
    whose: "own_or_other",
    rangeFt: 30,
    sight: true,
    effect: "add_flat",
    amount: { kind: "ability", ability: "int" },
    when: "short",
    cardOnly: true,
    ownAmongHelpers: true,
    watch: {
      hint: "add your Intelligence modifier to a save that fails",
      button: "Add {amount} {when}",
      title: "Spend a use of Flash of Genius and your reaction only if the save fails and your Intelligence modifier would carry it.",
      spentError: "Your Flash of Genius is spent, or your reaction is.",
    },
    label: "Flash of Genius: add {amount}",
    note: "Use your reaction and a use of Flash of Genius: add {amount} to this roll.",
  },
  {
    // Favored by the Gods (Divine Soul 1): on a failed save or a missed
    // attack, 2d4 is rolled and added to the total.
    id: "favored_by_the_gods",
    feature: "Favored by the Gods",
    cost: "counter",
    counter: "sub_favored_by_the_gods",
    reaction: false,
    kinds: ["save", "attack"],
    whose: "own",
    effect: "add_dice",
    amount: { kind: "dice", count: 2, sides: 4 },
    when: "short",
    cardOnly: true,
    watch: {
      hint: "add 2d4 to your save if it fails",
      button: "Add {amount} {when}",
      title: "Spend Favored by the Gods only if the save fails and 2d4 could carry it: the 2d4 is added to the save.",
      spentError: "Your Favored by the Gods is spent.",
    },
    label: "Favored by the Gods: add {amount}",
    note: "Spend your use of Favored by the Gods: add {amount} to this {what}.",
  },
  {
    // War God's Blessing (War Domain 6): the cleric's reaction gives +10 to
    // an attack roll made by a creature within 30 feet. Range only: the
    // feature does not ask the cleric to see the attacker.
    id: "war_gods_blessing",
    feature: "War God's Blessing",
    cost: "channel_divinity",
    reaction: true,
    kinds: ["attack"],
    whose: "other",
    rangeFt: 30,
    effect: "add_flat",
    amount: { kind: "flat", value: 10 },
    when: "short",
    cardOnly: true,
    label: "War God's Blessing: add {amount}",
    note: "Use your reaction and a use of Channel Divinity: add {amount} to this attack roll.",
  },
  {
    // Touch of Death (Death Domain 2): a melee hit may spend Channel Divinity
    // on extra necrotic damage, 5 + twice the cleric level.
    id: "touch_of_death",
    feature: "Touch of Death",
    cost: "channel_divinity",
    reaction: false,
    kinds: ["attack"],
    whose: "own",
    effect: "hit_damage",
    amount: { kind: "level", className: "cleric", base: 5, per: 2, type: "necrotic" },
    when: "hit",
    hitBy: "melee",
    cardOnly: true,
    label: "Touch of Death: add {amount} necrotic",
    note: "Spend a use of Channel Divinity: this hit deals {amount} extra necrotic damage.",
  },
  {
    // Destructive Wrath (Tempest Domain 2): Channel Divinity deals lightning
    // or thunder damage at its maximum instead of rolling it.
    id: "destructive_wrath",
    feature: "Destructive Wrath",
    cost: "channel_divinity",
    reaction: false,
    kinds: ["attack"],
    whose: "own",
    effect: "hit_damage",
    amount: { kind: "max" },
    when: "hit",
    label: "Destructive Wrath: maximum lightning and thunder",
    note: "Spend a use of Channel Divinity: this hit's lightning and thunder dice are dealt at their maximum instead of rolled.",
  },
  {
    // Violent Attraction (Graviturgy 10): when a creature in sight within 60
    // feet hits with a weapon attack, a reaction adds 1d10 to its damage.
    // Offered on an ally's hit; the falling-damage half has no event to ride.
    id: "violent_attraction",
    feature: "Violent Attraction",
    cost: "counter",
    counter: "sub_violent_attraction",
    reaction: true,
    kinds: ["attack"],
    whose: "other",
    rangeFt: 60,
    sight: true,
    effect: "hit_damage",
    amount: { kind: "dice", count: 1, sides: 10 },
    when: "hit",
    hitBy: "weapon",
    label: "Violent Attraction: add 1d10 to {name}'s hit",
    note: "Use your reaction and a use of Violent Attraction: {name}'s hit deals 1d10 more damage.",
  },
  {
    // Combat Inspiration (Valor bard): the holder of a Valor bard's die may
    // add it to a hit's damage (ar-wbf-bard-dice-logic.ts). {amount}: the die.
    id: "combat_inspiration",
    feature: "Combat Inspiration",
    cost: "held_die",
    reaction: false,
    kinds: ["attack"],
    whose: "own",
    effect: "own",
    module: "ar-wbf-bard-dice-logic.ts",
    when: "hit",
    label: "Combat Inspiration: add 1{amount} damage",
    note: "Spend your Bardic Inspiration die: add 1{amount} to this hit's damage.",
  },
  {
    // Unerring Accuracy (Kensei 17): a missed monk-weapon attack rolled
    // again, once on each of the monk's turns (mt-mr-offers-logic.ts).
    id: "unerring_accuracy",
    feature: "Unerring Accuracy",
    cost: "own",
    reaction: false,
    kinds: ["attack"],
    whose: "own",
    effect: "own",
    module: "mt-mr-offers-logic.ts",
    when: "short",
    label: "Unerring Accuracy: roll it again",
    note: "Once on each of your turns: roll this missed monk-weapon attack again, and the new roll stands.",
  },
  {
    // Homing Strikes (Soulknife 9): a Psionic Energy die added to a missed
    // Psychic Blades attack, spent only if it makes the hit. {amount}: the die.
    id: "homing_strikes",
    feature: "Homing Strikes",
    cost: "own",
    reaction: false,
    kinds: ["attack"],
    whose: "own",
    effect: "own",
    module: "mt-mr-offers-logic.ts",
    when: "short",
    label: "Homing Strikes: add 1{amount}",
    note: "Roll a Psionic Energy die and add it to this attack roll. The die is spent only if it turns the miss into a hit.",
  },
  {
    // Psi-Bolstered Knack (Soulknife 3): a Psionic Energy die added to a
    // failed check with a proficient skill or tool, spent only if it succeeds.
    id: "psi_knack",
    feature: "Psi-Bolstered Knack",
    cost: "own",
    reaction: false,
    kinds: ["check"],
    whose: "own",
    effect: "own",
    module: "mt-mr-offers-logic.ts",
    when: "short",
    label: "Psi-Bolstered Knack: add 1{amount}",
    note: "Roll a Psionic Energy die and add it to this check. The die is spent only if it turns the failure into a success.",
  },
  {
    // Draconic Presence (Ascendant Dragon 3): a reaction rolls a failed
    // Intimidation or Persuasion check again; the use goes once it succeeds.
    id: "draconic_presence",
    feature: "Draconic Presence",
    cost: "own",
    counter: "sub_draconic_presence",
    reaction: true,
    kinds: ["check"],
    whose: "own",
    effect: "own",
    module: "mt-mr-offers-logic.ts",
    when: "short",
    label: "Draconic Presence: roll it again",
    note: "Use your reaction to roll this check again; the new roll stands. Once it turns a failure into a success, it waits for a long rest.",
  },
  {
    // Convergent Future (Chronurgy 14): a reaction sets the roll of the
    // wizard or a creature in sight within 60 feet to the least that
    // succeeds, or one less, at a level of exhaustion (fate-turn-logic.ts).
    id: "convergent_future",
    feature: "Convergent Future",
    cost: "own",
    reaction: true,
    kinds: ["check", "save", "attack"],
    whose: "own_or_other",
    rangeFt: 60,
    sight: true,
    effect: "own",
    module: "fate-turn-logic.ts",
    when: "short",
    watch: {
      hint: "decide a save or check with Convergent Future",
      button: "Decide it {when}",
      title: "Use your reaction and gain a level of exhaustion only if the roll goes that way: the die is ignored, and the roll goes the other way by one.",
      spentError: "Your reaction is spent.",
    },
    label: "Convergent Future: make it succeed",
    note: "Use your reaction and gain a level of exhaustion: the die is ignored, and this {what} is the lowest number that succeeds.",
    otherLabel: "Convergent Future: {name} succeeds",
    otherNote: "Use your reaction and gain a level of exhaustion: the die is ignored, and this {what} is the lowest number that succeeds.",
  },
  {
    // Bend Luck (Wild Magic 6): a reaction and 2 sorcery points roll 1d4 as a
    // bonus or a penalty on another creature's roll in sight (fate-turn-logic.ts).
    id: "bend_luck",
    feature: "Bend Luck",
    cost: "own",
    reaction: true,
    kinds: ["check", "save", "attack"],
    whose: "other",
    sight: true,
    effect: "own",
    module: "fate-turn-logic.ts",
    when: "short",
    watch: {
      hint: "bend a save or check by 1d4",
      button: "Bend it 1d4 {when}",
      title: "Spend your reaction and 2 sorcery points only if the roll goes that way and 1d4 could turn it: the d4 is added to a friend's roll or taken off a foe's.",
      spentError: "Your sorcery points are spent, or your reaction is.",
    },
    label: "Bend Luck: add 1d4 to {name}'s roll",
    note: "Use your reaction and 2 sorcery points: roll 1d4 and add it to this {what}.",
  },
  {
    // The Storm Rune's prophetic state (Rune Knight 7): a reaction gives a
    // roll of the knight or a creature in sight within 60 feet advantage
    // (mt-fb-runes.ts).
    id: "prophetic_state",
    feature: "Prophetic State",
    cost: "own",
    reaction: true,
    kinds: ["check", "save", "attack"],
    whose: "own_or_other",
    rangeFt: 60,
    sight: true,
    effect: "own",
    module: "mt-fb-runes.ts",
    when: "short",
    label: "Prophetic State: roll with advantage",
    note: "Use your reaction (the Storm Rune's prophetic state): this {what} has advantage, one more d20 and the higher kept.",
    otherLabel: "Prophetic State: {name} rolls with advantage",
    otherNote: "Use your reaction (the Storm Rune's prophetic state): this {what} has advantage, one more d20 and the higher kept.",
  },
] as const satisfies readonly AfterRollRow[];

export type AfterRollId = (typeof AFTER_ROLL_ROWS)[number]["id"];
export const AFTER_ROLL_IDS = AFTER_ROLL_ROWS.map((row) => row.id) as [AfterRollId, ...AfterRollId[]];

const BY_ID = new Map<string, AfterRollRow>(AFTER_ROLL_ROWS.map((row) => [row.id, row]));
export function afterRollRow(id: AfterRollId): AfterRollRow {
  return BY_ID.get(id)!;
}

// The rows a module of their own offers and spends (`effect: "own"`): the
// generic builders and spend pass them by.
export const ownsItself = (row: AfterRollRow) => row.effect === "own";

// The words of a card option a module builds from its row.
export function rowWords(id: AfterRollId, words: { kind?: string; amount?: string; name?: string; other?: boolean }): { label: string; note: string } {
  const row = afterRollRow(id);
  const other = words.other === true && row.otherLabel !== undefined && row.otherNote !== undefined;
  return { label: fillWords(other ? row.otherLabel! : row.label, words), note: fillWords(other ? row.otherNote! : row.note, words) };
}

// The rows the watch stop arms on a roll, to be taken once it goes the wrong
// way (chronal-shift.ts): every row with watch words.
type WatchRowOf<R> = R extends { watch: AfterRollWatch; id: infer I } ? I : never;
export type WatchRowId = WatchRowOf<(typeof AFTER_ROLL_ROWS)[number]>;
export const WATCH_ROWS = AFTER_ROLL_ROWS.filter((row): row is Extract<(typeof AFTER_ROLL_ROWS)[number], { watch: AfterRollWatch }> => "watch" in row);
// The watch rows that add to a failed save or check (Flash of Genius, Favored
// by the Gods): not Chronal Shift, which rolls it again, nor the rows of
// their own (Convergent Future, Bend Luck), which fate-turn.ts takes.
type SaveHelpOf<R> = R extends { watch: AfterRollWatch; id: infer I; effect: "add_flat" | "add_dice" } ? I : never;
export type SaveHelp = SaveHelpOf<(typeof AFTER_ROLL_ROWS)[number]>;
export const SAVE_HELPS = WATCH_ROWS.filter((row) => row.effect === "add_flat" || row.effect === "add_dice").map((row) => row.id as SaveHelp);
export const isSaveHelp = (power: string): power is SaveHelp => (SAVE_HELPS as readonly string[]).includes(power);

// The stop's own powers, not rows of this table: chosen at the stop before
// the roll rather than armed for after it. The `before` ones go on the d20
// as it is thrown and are paid only if one took them (foresight.ts
// runWithForetold): Portent's number, Cosmic Omen's d6, Restore Balance's
// one d20. Slayer's Counter and the Cloud Rune act at the stop itself
// (`atStop`), arming nothing on the dice (turn-hold.ts). `words` are the
// card's where they differ from a roll's ("Let it land" for a hit).
// {amount} in Cosmic Omen's button: "Weal: add 1d6" or "Woe: take off 1d6".
export type StopWords = { group?: string; pickGroup?: string; pickPrompt?: string; pickFirst?: string; pass?: string; passing?: string };
export type StopPower = { id: string; feature: string; hint: string; button?: string; title?: string; spentError?: string; atStop?: boolean; before?: boolean; words?: StopWords };
export const STOP_POWERS = [
  { id: "portent", feature: "Portent", hint: "use a foretold number", before: true, words: { group: "Use a number Portent foretold, or let it roll" } },
  {
    // Cosmic Omen (Circle of Stars 6, before-roll-logic.ts): the omen read at
    // the last long rest, on a roll in sight within 30 feet before it is made.
    id: "cosmic_omen",
    feature: "Cosmic Omen",
    hint: "add a d6 to a friend's roll (Weal) or take one off a foe's (Woe) before it is made",
    button: "{amount}",
    title: "Spend your reaction and a use of Cosmic Omen: a d6 is rolled with the roll and added (Weal) or taken off (Woe), however the roll turns out. Paid only if the roll is made.",
    spentError: "Your Cosmic Omen is spent, or your reaction is.",
    before: true,
  },
  {
    // Restore Balance (Clockwork Soul 1, before-roll-logic.ts): a roll within
    // 60 feet is made with one d20, its advantage or disadvantage cancelled.
    id: "restore_balance",
    feature: "Restore Balance",
    hint: "cancel the advantage or disadvantage of a roll before it is made",
    button: "Cancel its advantage or disadvantage",
    title: "Spend your reaction and a use of Restore Balance: the roll is made with one d20. Paid only if the roll had advantage or disadvantage to cancel.",
    spentError: "Your Restore Balance is spent, or your reaction is.",
    before: true,
  },
  {
    // Slayer's Counter (Monster Slayer 15): asked without a Watch button, at
    // the ranger's own save that their prey forces (foresight.ts).
    id: "slayers_counter",
    feature: "Slayer's Counter",
    hint: "attack your prey before a save it forces on you",
    button: "Attack it first",
    title: "Spend your reaction on one weapon attack against your prey before the save is rolled: if it hits, your save succeeds.",
    spentError: "Your reaction is spent.",
    atStop: true,
  },
  {
    // The Cloud Rune (Rune Knight 3): asked without a Watch button, at a hit
    // on the knight or a creature they see within 30 feet, before its damage
    // (cloud-rune.ts). {pick}: the creature the hit turns onto.
    id: "cloud_rune",
    feature: "Cloud Rune",
    hint: "turn a hit onto another creature before its damage",
    button: "Turn it onto {pick}",
    title: "Spend your reaction and a use of the Cloud Rune: the attack targets {pick} instead, on the same roll, and its damage is rolled for them.",
    spentError: "Your reaction is spent, or the Cloud Rune's uses are.",
    atStop: true,
    words: {
      group: "Turn the hit with the Cloud Rune, or let it land",
      pickGroup: "The creature the attack turns onto",
      pickPrompt: "Turn it onto:",
      pickFirst: "Choose the creature it turns onto first.",
      pass: "Let it land",
      passing: "It lands on its own in ",
    },
  },
] as const satisfies readonly StopPower[];
export type StopPowerId = (typeof STOP_POWERS)[number]["id"];
export const PORTENT = STOP_POWERS[0];

export type WatchPower = StopPowerId | WatchRowId;
const STOP_BY_ID = new Map<string, StopPower>(STOP_POWERS.map((power) => [power.id, power]));
export const stopPower = (power: WatchPower): StopPower | null => STOP_BY_ID.get(power) ?? null;
export const WATCH_FEATURES = Object.fromEntries([...STOP_POWERS.map((power) => [power.id, power.feature]), ...WATCH_ROWS.map((row) => [row.id, row.feature])]) as Record<WatchPower, string>;
export const WATCH_HINTS = Object.fromEntries([...STOP_POWERS.map((power) => [power.id, power.hint]), ...WATCH_ROWS.map((row) => [row.id, row.watch.hint])]) as Record<WatchPower, string>;
export const watchRow = (power: WatchPower) => (STOP_BY_ID.has(power) ? null : (BY_ID.get(power) as AfterRollRow & { watch: AfterRollWatch }));
// A stop that is answered where it stands, before the held call runs again,
// rather than armed on its dice (Slayer's Counter, the Cloud Rune).
export const answeredAtStop = (power: WatchPower | undefined): boolean => Boolean(power && (STOP_BY_ID.get(power) as StopPower | undefined)?.atStop);
// A stop that arms a row on the dice, taken once the roll goes the wrong way.
export const armsWatchRow = (power: WatchPower | undefined): power is WatchRowId => Boolean(power) && !STOP_BY_ID.has(power!);
// A stop power that goes on the d20 as it is thrown (Portent, Cosmic Omen,
// Restore Balance), answered before the roll and paid only if a d20 took it.
export const armsBeforeRoll = (power: WatchPower | undefined): boolean => Boolean(power && (STOP_BY_ID.get(power) as StopPower | undefined)?.before);
// The words a stop's card shows: the row's watch words, or the stop power's own.
export function watchWords(power: WatchPower): { button: string; title: string; spentError: string } {
  const row = watchRow(power);
  if (row) return { button: row.watch.button, title: row.watch.title, spentError: row.watch.spentError };
  const own = STOP_BY_ID.get(power)!;
  return { button: own.button ?? "", title: own.title ?? "", spentError: own.spentError ?? "" };
}

// The counters spent from the card and no other (`cardOnly`): dealt to the
// Hand they spent a use and changed nothing.
export const AFTER_ROLL_COUNTERS: readonly string[] = AFTER_ROLL_ROWS.flatMap((row) => ("cardOnly" in row && row.cardOnly && row.cost === "counter" ? [row.counter] : []));
// The Channel Divinity options spent from the card and no other.
export const AFTER_ROLL_CHANNEL_OPTIONS: readonly string[] = AFTER_ROLL_ROWS.flatMap((row) => ("cardOnly" in row && row.cardOnly && row.cost === "channel_divinity" ? [row.feature] : []));

// The roll's kind in the table's words.
export function kindOf(rollKind: string): AfterRollKind | null {
  if (rollKind === "attack") return "attack";
  if (rollKind === "saving_throw") return "save";
  if (rollKind === "skill_check" || rollKind === "ability_check" || rollKind === "initiative") return "check";
  return null;
}

export const answers = (row: AfterRollRow, rollKind: string) => {
  const kind = kindOf(rollKind);
  return kind !== null && row.kinds.includes(kind);
};

// The most an add_* row can add, for whether it could carry the roll.
// `held`: the die a held_die row holds; `modifier`: the holder's ability modifier.
export function mostAdded(row: AfterRollRow, input: { held?: string | null; modifier?: number } = {}): number {
  const amount = row.amount;
  if (!amount) return 0;
  if (amount.kind === "flat") return amount.value;
  if (amount.kind === "dice") return amount.count * amount.sides;
  if (amount.kind === "ability") return input.modifier ?? 0;
  if (amount.kind === "held") return input.held ? Number(input.held.slice(1)) : 0;
  return 0;
}

// What the row adds, as the card writes it: "2d4", "10", "1d10".
export function amountWords(row: AfterRollRow, input: { held?: string | null; modifier?: number } = {}): string {
  const amount = row.amount;
  if (!amount) return "";
  if (amount.kind === "flat") return String(amount.value);
  if (amount.kind === "dice") return `${amount.count}d${amount.sides}`;
  if (amount.kind === "ability") return String(input.modifier ?? 0);
  if (amount.kind === "held") return input.held ?? "";
  return "";
}

// A row's label or note with its words filled in.
export function fillWords(template: string, words: { kind?: string; amount?: string; name?: string }): string {
  const kind = kindOf(words.kind ?? "");
  const what = kind === "attack" ? "attack roll" : kind ?? "roll";
  return template
    .replaceAll("{what}", what)
    .replaceAll("{roll}", kind === "attack" ? "attack roll" : "roll")
    .replaceAll("{amount}", words.amount ?? "")
    .replaceAll("{name}", words.name ?? "");
}
