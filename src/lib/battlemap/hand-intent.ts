// The parts of a Hand card's structured intent that the engine's newer rules
// need beyond the card itself: a reaction and what it answers, a feature's
// variant (a ki technique), a basic action taken as the bonus action through
// a feature, Ready's trigger and readied spell, Search's skill, a spell's
// chosen form (Command's word, Bestow Curse's curse), the square a spell's
// area is laid on, and the class options
// pc_attack resolves (Martial Arts', Frenzy's and a subclass's bonus strikes,
// Stunning Strike, Reckless Attack, a blow that knocks out, Inspiration,
// Stroke of Luck, Open Hand Technique, Hurl Through Hell), and a casting
// shared out among several creatures (Magic Missile's darts, Scorching Ray's
// rays, the creatures Bless or an upcast Hold Person takes).
//
// The message schema itself is the narrator's (src/lib/dm/intent-logic.ts);
// it spreads these fields in and calls the two describers, so a card that
// carries an option reaches the model as the tool argument it stands for.
// Pure: zod and strings only.
import { READIABLE } from "@/lib/dm/readied-kinds";
import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const square = z.number().int().min(0).max(200).optional();

export const HAND_INTENT_ACTIONS = ["search", "escape", "stand-up", "stabilize", "dismount"] as const;

// What a gear card does with an item (issue #424): handle_item's actions,
// and use for a potion or another consumable (use_item).
export const HAND_GEAR_ACTIONS = ["equip", "unequip", "drop", "pick_up", "hand", "use"] as const;
export type HandGearAction = (typeof HAND_GEAR_ACTIONS)[number];

// The engine's bonusAttack values (src/lib/dm/pc-attack-options.ts
// BONUS_ATTACKS), which a card's attack still carries flat
// (src/lib/dm/intent-logic.ts directCardCall), and Open Hand Technique's
// riders (attack-choice-rules.ts).
const HAND_BONUS_ATTACKS = ["martial arts", "frenzy", "feature"] as const;
const HAND_OPEN_HAND = ["prone", "push", "no reactions"] as const;

export const handIntentExtras = {
  // A reaction card: the feature or reaction spell use_reaction resolves,
  // and the hit it answers when its character has several open (issue 685),
  // use_reaction's `hit`.
  feature: text(80).optional(),
  hit: text(120).optional(),
  // A resource's variant: "flurry of blows", "patient defense", "step of the
  // wind"; a restoration spell's condition to end (cast_buff variant); the
  // creature a summoning spell calls ("Wolf", issue 685).
  variant: text(40).optional(),
  // How many of that creature, cast_buff's `count`: one of the numbers the
  // spell lets its caster choose (Conjure Animals' one, two, four or eight).
  count: z.number().int().min(1).max(40).optional(),
  // A summoning whose targets each take their own form, cast_buff's `mix`:
  // Animate Dead's skeletons and zombies, Animate Objects' sizes.
  mix: z.array(z.object({ variant: text(40), count: z.number().int().min(1).max(40) })).min(1).max(6).optional(),
  // A ritual spell cast as one (no slot, ten minutes longer).
  ritual: z.boolean().optional(),
  // A save spell's chosen form, cast_at_enemy's `condition`: Command's word,
  // Eyebite's form, Bestow Curse's curse, "armor" for Heat Metal.
  condition: text(40).optional(),
  // A basic action taken as the bonus action through a feature (Cunning Action).
  bonus: z.boolean().optional(),
  // Ready's trigger, which the engine refuses Ready without.
  trigger: text(200).optional(),
  // Ready with a spell: take_action's `spell` and `level`.
  readySpell: text(80).optional(),
  readyLevel: z.number().int().min(1).max(9).optional(),
  // Ready with another action: take_action's `readied` (readied-kinds.ts).
  readyAction: z.enum(READIABLE).optional(),
  // Search's skill.
  skill: z.enum(["perception", "investigation"]).optional(),
  // A gear card's item: the carried row's name, or the id of a thing on the
  // ground (handle_item, use_item).
  item: text(120).optional(),
  // Where a spell's area is laid on the battle map, under the placement
  // arguments' own names (src/lib/dm/zone-args.ts): a burst's centre or a
  // wall's first square, and the square a wall or a line runs toward.
  atX: square,
  atY: square,
  towardX: square,
  towardY: square,
  // A casting shared out among several creatures, asked in the Hand (issue
  // 570): Magic Missile's darts, Scorching Ray's rays and Eldritch Blast's
  // beams by how many each creature takes, or the creatures Bless or an
  // upcast Hold Person takes, one each. The card's own target comes first;
  // the rest are of its kind (targetKind).
  shares: z
    .array(z.object({ id: text(120), name: text(120).optional(), count: z.number().int().min(1).max(20) }))
    .min(1)
    .max(12)
    .optional(),
  // pc_attack's class options, under their own argument names.
  attack: z
    .object({
      bonusAttack: z.enum(HAND_BONUS_ATTACKS).optional(),
      stunningStrike: z.boolean().optional(),
      reckless: z.boolean().optional(),
      nonlethal: z.boolean().optional(),
      useInspiration: z.boolean().optional(),
      strokeOfLuck: z.boolean().optional(),
      hurlThroughHell: z.boolean().optional(),
      rapidStrike: z.boolean().optional(),
      openHand: z.enum(HAND_OPEN_HAND).optional(),
      // A Divine Smite rider's slot (issue 685): the riders list names it
      // and no more, and the swing and the smite are one pc_attack call.
      smite: z.number().int().min(1).max(9).optional(),
    })
    .optional(),
};

export type HandBonusAttack = (typeof HAND_BONUS_ATTACKS)[number];
export type HandOpenHand = (typeof HAND_OPEN_HAND)[number];

export type HandAttackArgs = {
  bonusAttack?: HandBonusAttack;
  stunningStrike?: boolean;
  reckless?: boolean;
  nonlethal?: boolean;
  useInspiration?: boolean;
  strokeOfLuck?: boolean;
  hurlThroughHell?: boolean;
  rapidStrike?: boolean;
  openHand?: HandOpenHand;
  smite?: number;
};

export type HandIntentExtras = {
  feature?: string;
  hit?: string;
  variant?: string;
  count?: number;
  mix?: Array<{ variant: string; count: number }>;
  ritual?: boolean;
  condition?: string;
  bonus?: boolean;
  trigger?: string;
  readySpell?: string;
  readyLevel?: number;
  readyAction?: string;
  skill?: "perception" | "investigation";
  item?: string;
  atX?: number;
  atY?: number;
  towardX?: number;
  towardY?: number;
  shares?: HandShare[];
  attack?: HandAttackArgs;
};

export type HandShare = { id: string; name?: string; count: number };

// The tool arguments the extras stand for, as `name=value` pairs the model
// reads in the card line and in the corrective call.
export function handExtraArgs(intent: HandIntentExtras): string[] {
  const args: string[] = [];
  if (intent.feature) args.push(`feature=${intent.feature}`);
  if (intent.hit) args.push(`hit=${intent.hit}`);
  if (intent.variant) args.push(`variant=${intent.variant}`);
  if (intent.count) args.push(`count=${intent.count}`);
  if (intent.mix?.length) args.push(`mix=${intent.mix.map((entry) => `${entry.count} ${entry.variant}`).join(" + ")}`);
  if (intent.ritual) args.push("ritual=true");
  if (intent.condition) args.push(`condition=${intent.condition}`);
  if (intent.bonus) args.push("bonus=true");
  if (intent.trigger) args.push(`trigger=${intent.trigger}`);
  if (intent.readySpell) args.push(`spell=${intent.readySpell}`);
  if (intent.readySpell && intent.readyLevel) args.push(`level=${intent.readyLevel}`);
  if (intent.readyAction) args.push(`readied=${intent.readyAction}`);
  if (intent.skill) args.push(`skill=${intent.skill}`);
  if (intent.item) args.push(`item=${intent.item}`);
  for (const key of ["atX", "atY", "towardX", "towardY"] as const) {
    if (intent[key] !== undefined) args.push(`${key}=${intent[key]}`);
  }
  for (const [key, value] of Object.entries(intent.attack ?? {})) {
    if (value !== undefined && value !== false) args.push(`${key}=${value}`);
  }
  return args;
}

// The tail of the card line: " (bonus=true, trigger=...)", or "".
export function describeHandExtras(intent: HandIntentExtras): string {
  const args = handExtraArgs(intent);
  return args.length ? ` (${args.join(", ")})` : "";
}
