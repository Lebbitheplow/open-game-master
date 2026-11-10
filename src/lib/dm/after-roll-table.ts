// Every choice a character may make after a d20 has landed and before the game
// says what it did: one row per feature. The after-the-roll card
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
// what its rules text says.

// What a row costs: a use of its own counter (`counter`), a use of Channel
// Divinity, a Lucky feat's luck point, or a die already held as a condition
// (Bardic Inspiration, a called-up Dark One's Own Luck).
export type AfterRollCost = "counter" | "channel_divinity" | "luck_point" | "held_die";

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
//   cancel_edge   advantage or disadvantage no longer applies: the first d20 thrown counts (Restore Balance)
//   hit_damage    the hit deals more: flat, dice, or its lightning and thunder at their maximum
export type AfterRollEffect = "extra_d20" | "add_die" | "add_dice" | "add_flat" | "reroll" | "reroll_edge" | "cancel_edge" | "hit_damage";

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
// button with `{when}` ("if it fails") filled in; `hint` what watching lets
// the player do; `title` the button's tooltip.
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
    // Lucky (feat): "you can spend one luck point to roll an additional d20 ... You can choose which of the d20s is used".
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
    // Dark One's Own Luck: "add a d10 to your roll" on a check or a save.
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
    // Chronal Shift (Chronurgy 2): "After you or a creature you can see within
    // 30 feet of you makes an attack roll, an ability check, or a saving throw,
    // you can use your reaction to force that creature to reroll."
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
    // Master Duelist (Swashbuckler 17): "if you miss with an attack roll, you
    // can roll it again with advantage".
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
    // Flash of Genius (Artificer 7): "when you or another creature you can see
    // within 30 feet of you makes an ability check or a saving throw, you can
    // use your reaction to add your Intelligence modifier to the roll."
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
    // Favored by the Gods (Divine Soul 1): "if you fail a saving throw or miss
    // with an attack roll, you can roll 2d4 and add it to the total".
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
      button: "Add 2d4 {when}",
      title: "Spend Favored by the Gods only if the save fails and 2d4 could carry it: the 2d4 is added to the save.",
      spentError: "Your Favored by the Gods is spent.",
    },
    label: "Favored by the Gods: add {amount}",
    note: "Spend your use of Favored by the Gods: add {amount} to this {what}.",
  },
  {
    // Restore Balance (Clockwork Soul 1): a reaction cancels advantage or
    // disadvantage on a roll within 60 feet. The rules have it chosen before
    // the roll; on the card it is chosen after the dice, and the first d20
    // thrown is the roll's one d20, as if the second had never been rolled.
    // Offered on the holder's or an ally's roll with disadvantage, where the
    // first die would carry it.
    id: "restore_balance",
    feature: "Restore Balance",
    cost: "counter",
    counter: "sub_restore_balance",
    reaction: true,
    kinds: ["check", "save", "attack"],
    whose: "own_or_other",
    rangeFt: 60,
    sight: true,
    effect: "cancel_edge",
    when: "short",
    label: "Restore Balance: no disadvantage",
    note: "Use your reaction and a use of Restore Balance: this {what} loses its disadvantage, and the first d20 rolled counts.",
    otherLabel: "Restore Balance: {name} without disadvantage",
    otherNote: "Use your reaction and a use of Restore Balance: {name}'s {what} loses its disadvantage, and the first d20 rolled counts.",
  },
  {
    // War God's Blessing (War Domain 6): "when a creature within 30 feet of you
    // makes an attack roll, you can use your reaction to grant that creature a
    // +10 bonus". The text asks for 30 feet and not for sight.
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
    // Touch of Death (Death Domain 2): "when you hit a creature with a melee
    // attack, you can use Channel Divinity to deal extra necrotic damage equal
    // to 5 + twice your cleric level".
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
    // Destructive Wrath (Tempest Domain 2): "When you roll lightning or thunder
    // damage, you can use your Channel Divinity to deal maximum damage".
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
    // Violent Attraction (Graviturgy 10): "When a creature you can see within
    // 60 feet hits with a weapon attack, a reaction adds 1d10 to its damage."
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
] as const satisfies readonly AfterRollRow[];

export type AfterRollId = (typeof AFTER_ROLL_ROWS)[number]["id"];
export const AFTER_ROLL_IDS = AFTER_ROLL_ROWS.map((row) => row.id) as [AfterRollId, ...AfterRollId[]];

const BY_ID = new Map<string, AfterRollRow>(AFTER_ROLL_ROWS.map((row) => [row.id, row]));
export function afterRollRow(id: AfterRollId): AfterRollRow {
  return BY_ID.get(id)!;
}

// The rows the watch stop answers, and its powers: Portent's number (before
// the roll, not a row of this table) and each watch row.
type WatchRowOf<R> = R extends { watch: AfterRollWatch; id: infer I } ? I : never;
export type WatchRowId = WatchRowOf<(typeof AFTER_ROLL_ROWS)[number]>;
export type WatchPower = "portent" | WatchRowId;
export const WATCH_ROWS = AFTER_ROLL_ROWS.filter((row): row is Extract<(typeof AFTER_ROLL_ROWS)[number], { watch: AfterRollWatch }> => "watch" in row);
// The watch rows that add to a roll that fails (not Chronal Shift, which rolls it again).
export type SaveHelp = Exclude<WatchRowId, "chronal_shift">;
export const SAVE_HELPS = WATCH_ROWS.filter((row) => row.effect !== "reroll").map((row) => row.id as SaveHelp);

export const PORTENT = { feature: "Portent", hint: "use a foretold number" } as const;
export const WATCH_FEATURES = Object.fromEntries([["portent", PORTENT.feature], ...WATCH_ROWS.map((row) => [row.id, row.feature])]) as Record<WatchPower, string>;
export const WATCH_HINTS = Object.fromEntries([["portent", PORTENT.hint], ...WATCH_ROWS.map((row) => [row.id, row.watch.hint])]) as Record<WatchPower, string>;
export const watchRow = (power: WatchPower) => (power === "portent" ? null : (BY_ID.get(power) as AfterRollRow & { watch: AfterRollWatch }));

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
