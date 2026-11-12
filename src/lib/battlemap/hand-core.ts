// The Hand's shared vocabulary: what a card is, what a turn is, and the
// gates that stop a card being played. Split from hand.ts only to keep each
// file readable; hand.ts re-exports everything a caller needs.
import type { SpellMech } from "@/lib/srd/spell-mech-types";
import type { SpellFacts } from "@/lib/srd/spell-facts";
import {
  spendAction,
  spendAttack,
  type AttackSpendOptions,
  type SpendResult,
  type TurnBudget,
} from "@/lib/dm/action-budget";
import { canAct, type ActKind, type ActingEncounter } from "@/lib/dm/can-act";
import type { OrderEntry } from "@/lib/db/encounters";
import type { IconRef } from "@/lib/icons";
import type { SpellGlyph } from "@/lib/battlemap/spell-glyph-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { conditionBlocksReactions } from "@/lib/srd/condition-effects";
import { combatRiders } from "@/lib/srd/feature-effects";
import type { HandGearAction, HandIntentExtras } from "@/lib/battlemap/hand-intent";
import type { HandArea } from "@/lib/battlemap/hand-area";
// A type alone: the catalogue's stat blocks stay on the server.
import type { SummonCatalogue } from "@/lib/srd/summon-spells";

// "legendary" and "lair" are the GM's monsters' Hand only: a legendary
// creature's action at the end of another creature's turn, and the lair's own
// on initiative count 20 (src/lib/battlemap/monster-hand.ts).
export type HandCost = "action" | "bonus" | "reaction" | "rider" | "free" | "legendary" | "lair";
export type HandCardType = "attack" | "rider" | "spell" | "control" | "mend" | "ward" | "feature" | "basic";
export type HandTarget = "enemy" | "ally" | "self" | "none";
export type BasicActionId =
  | "dodge" | "dash" | "disengage" | "help" | "hide" | "ready" | "grapple" | "shove" | "use-object" | "end-turn"
  | "search" | "escape" | "stand-up" | "stabilize" | "dismount";

// What the structured commit carries beside the sentence. An optional extra
// field on the action body: a server that does not know it drops it. The
// extras (hand-intent.ts) carry what the newer rules need: a reaction's
// feature, a ki variant, a bonus-action route, Ready's trigger, the attack
// options pc_attack resolves.
export type HandIntent = (
  | { card: "attack"; weapon: string; offHand?: boolean }
  | { card: "rider"; rider: string; slotLevel?: number }
  | { card: "spell"; spell: string; slotLevel: number | null }
  | { card: "feature"; resourceId: string }
  | { card: "basic"; action: BasicActionId }
  | { card: "reaction"; feature: string; spell?: string; slotLevel?: number | null; hit?: string; variant?: string }
  // A gear card (issue #424, hand-gear.ts): a shield, a weapon, a thing
  // dropped, picked up, handed over or drunk. `item` rides as the extra.
  | { card: "gear"; action: HandGearAction }
  // A monster's card in the DM's hand (src/lib/battlemap/monster-hand.ts):
  // one of its stat block's attacks, a save ability, or breaking off. Sent
  // to the console's invoke route, never to the actions route.
  // Dash, Disengage and Dodge are take_action with its enemyId (issue #621).
  // A legendary action names its option, and the attack or ability it buys
  // (attackName, ability); a lair action its option's number and save.
  | {
      card: "monster";
      enemyId: string;
      action: "attack" | "ability" | "flee" | "legendary" | "lair" | MonsterMove;
      attackName?: string;
      ability?: MonsterAbilityUse;
      legendary?: string;
      // A legendary option's way to play when it has several, what it is
      // aimed at, the square a move or a jump needs, the spells it may cast
      // (src/lib/dm/enemy-actions-view.ts PublicLegendaryRoute).
      use?: string;
      aim?: "one" | "many";
      rows?: boolean;
      pick?: "allies" | "anyone";
      most?: number;
      square?: { feet: number; optional: boolean };
      spells?: string[];
      lair?: MonsterLairUse;
    }
) &
  HandIntentExtras;

export type MonsterMove = "dash" | "disengage" | "dodge";

// The numbers an ability card carries to cast_at_player or aoe_damage, as
// the DM projection read them off the block (src/lib/dm/enemy-actions-view.ts).
// The server re-reads the block whatever is sent; these only fill the form.
export type MonsterAbilityUse = {
  name: string;
  save: string;
  dc: number;
  damage?: string;
  damageType?: string;
  halfOnSave?: boolean;
  condition?: string;
  rounds?: number;
};

// A lair option as lair_action takes it (its number among the fight's), and
// the save it forces as aoe_damage takes it (legendary-logic.ts lairSave).
export type MonsterLairUse = {
  number: number;
  save?: { dc: number; saveAbility: string; damage?: string; type?: string; halfOnSave?: boolean; condition?: string; rounds?: number };
};

export type HandCard = {
  id: string;
  type: HandCardType;
  name: string;
  cost: HandCost;
  range: string;
  // The headline line ("1d8+3 slashing", "heals 1d8+3", "WIS save DC 13").
  dice: string;
  // The roll line under it ("+5 to hit", "no roll", "on a hit").
  roll: string;
  rules: string;
  // Full hover text when the card face uses a shortened summary.
  description?: string;
  // Slot, uses or ammunition ("Slot 1 · 3/4"); "" when the card costs nothing.
  resource: string;
  // The condition applied, or "Concentration".
  condition: string;
  icon: IconRef;
  // A spell card's glyph and the words beside it (issue 845,
  // spell-glyph-logic.ts): what the spell mainly does, and the area or the
  // creatures it takes. The card face draws these in place of the icon.
  glyph?: SpellGlyph;
  targetWords?: string;
  target: HandTarget;
  toHit: number | null;
  // Dice the attack roll adds beside its bonus ("+1d4" while blessed), and
  // the advantage a held condition gives it (True Strike), as the roll is
  // made (hand-attack-lines.ts attackRollLine). Absent when none.
  toHitDice?: string;
  rollAdvantage?: Array<"advantage" | "disadvantage">;
  // A ranged or thrown attack's reach in feet: its melee reach (0 for a
  // ranged weapon), its normal and its long range. The preview reads the
  // board's distance against them (hand-attack-lines.ts attackReach).
  shot?: { reachFt: number; normalFt: number; longFt: number; thrown: boolean };
  // A dice expression the preview can average; null when nothing is rolled.
  damage: string | null;
  damageType: string;
  // The second type of a spell that deals two at once (Ice Storm's cold).
  secondType?: string;
  heals: boolean;
  save: { ability: string; dc: number } | null;
  melee: boolean;
  // Why the card cannot be played right now; null when it can.
  disabled: string | null;
  // The reason is that something ran out, so the card dims rather than greys.
  spent: boolean;
  // The sentence needs finishing by hand (a Ready trigger, a Lay on Hands
  // amount), so the card fills the composer instead of sending.
  compose: boolean;
  // What a composed spend is counted in ("ki" for Touch of the Long Death);
  // hit points when absent (Lay on Hands).
  unit?: string;
  intent: HandIntent;
  // An ally card the holder cannot aim at themselves (Blessing of the
  // Trickster's "other than yourself"): the aim bar leaves out their chip.
  othersOnly?: boolean;
  // An ally card whose engine takes the dead, never the living (Revivify,
  // Hand of Ultimate Mercy: src/lib/srd/dead-targets.ts): the aim bar offers
  // the dead allies' chips and no others.
  takesTheDead?: boolean;
  // A card that takes "a creature you can see" (its spend's sight flag, the
  // one use_resource gates on): the aim bar leaves out the chip of a creature
  // the board says the holder cannot see, or, for "seesHolder", one that
  // cannot see the holder (hand-play.ts aimUnseen).
  sight?: true | "seesHolder";
  // A card that reaches only a creature holding this condition (Alter
  // Memories' "charmed"): the aim bar leaves out the chips of the others
  // (hand-play.ts aimLacks).
  aimHolds?: string;
  // The class options this attack may carry, each already judged by the
  // engine's checkAttackOptions (Reckless Attack, Stunning Strike, knock out).
  options?: HandAttackOption[];
  // The card needs a line from the player before it can go: Ready's trigger.
  asks?: "trigger";
  // A reaction card's reason to be offered now ("Goblin 2's scimitar hit
  // you for 7").
  prompt?: string;
  // One pick the card needs beside its target: a spell's form (Command's
  // word, Bestow Curse's curse, Heat Metal on worn armor), the condition a
  // restoration ends, the spell a Ready holds. Sent under the tool
  // argument's own name (hand-intent.ts).
  choice?: HandChoice;
  // A summoning spell that calls more than one creature at this slot
  // (issue 685, hand-summon.ts): its choice is the creature, and this says
  // how many of each the casting may bring.
  summon?: HandSummon;
  // The card is the turn's object interaction (hand-gear.ts): a draw, a
  // stow, a pick-up, a hand-over.
  interaction?: boolean;
  // An attack that is the whole action, not a swing of the Attack action
  // (Flame Blade, hand-granted.ts): afterCommit spends the action for it.
  wholeAction?: boolean;
  // A cantrip that is one attack of the Attack action (the Bladesinger's
  // Extra Attack, src/lib/dm/ar-ws-cantrip-attack.ts): afterCommit counts it
  // as the engine does.
  attackCantrip?: boolean;
  // The magic item a spell card casts from: Items shows a section per item with
  // what it has left (hand-groups.ts), as Spells shows one per level with its slots.
  fromItem?: { key: string; label: string; note: string };
  // A spell that leaves an area on the battle map: the square it is laid on
  // is picked on the board (src/lib/battlemap/hand-area.ts) and sent as the
  // tool's atX/atY/towardX/towardY.
  area?: HandArea;
  // A casting that can be shared out among several creatures (issue 570):
  // how many it holds at this slot and level, what one of them is called,
  // and whether one creature may take several (darts, rays, beams) or each
  // is taken once (Bless, Hold Person). Absent for a casting that holds one.
  shares?: HandShares;
  // A spell card's own level (0 for a cantrip) and whether it is held by
  // concentration: the Spells group's sections and its Concentration filter
  // (hand-groups.ts, issue 528).
  level?: number;
  concentration?: boolean;
  // The counter the card spends from, by resource id (ki, superiority dice,
  // a Channel Divinity use): cards that share one gather under one card.
  pool?: string;
  // Another of the player's characters takes this card: a reaction offered
  // to a hero who is not the one acting (hand-react.ts offTurnReactionCards).
  // Absent, the card is the acting character's.
  actor?: { id: string; name: string };
  // The hit a reaction card answers (hand-react.ts): the character hit, the
  // hit's id when the host gives one, and who made it. Its aim is fixed by
  // it (reactionAim), not picked.
  answers?: { characterId: string; hitId?: string; attackerId: string | null; attacker: string };
  // A reaction whose creature the player picks, from those this near the holder
  // other than the attacker (Misdirection): no aim is fixed by the hit
  // (reactionPicks).
  pickWithin?: number;
};

// `min`: how many the card must name before it can go (Infectious Fury's
// cursed creature and the one it attacks); absent, the aim alone will do.
// `attacks`: the second creature is the one the aimed creature is made to
// attack, not one more taken by the same effect, and the aim bar asks it so.
export type HandShares = { count: number; unit: "dart" | "ray" | "beam" | "creature"; stack: boolean; min?: number; attacks?: boolean };

// "Each creature of your choice" within an area feature's reach: the player
// aims at one and adds the others (Order's Demand, Champion Challenge,
// Conquering Presence, Dreadful Aspect). The engine refuses any outside the reach. Twelve is the most a
// card's intent carries (hand-intent.ts shares).
export const CHOSEN_CREATURES: HandShares = { count: 12, unit: "creature", stack: false };

// Each creature a summoning card's choice offers: the numbers it may come
// in from the card's slot, fewest first (the last is the most, what the
// engine brings when no number is picked), and the challenge rating it is
// listed under when the spell calls by rating ("CR 1/4").
export type HandSummon = {
  forms: Record<string, { counts: number[]; group?: string }>;
  // The kinds the creature may be instead of its own (Find Steed's
  // celestial, fey or fiend), the first being the engine's default.
  kinds?: Array<{ value: string; label: string }>;
  // A spell whose targets each take their own form (Animate Dead, Animate
  // Objects): the budget the forms share at this slot, and each one's cost.
  mix?: { budget: number; cost: Record<string, number> };
};

export type HandChoice = {
  arg: "condition" | "variant" | "readySpell" | "item";
  label: string;
  options: Array<{ value: string; label: string; note?: string }>;
  // What is sent when the player picks none (the first option otherwise).
  fallback?: string;
  // A readied spell's slot level, by spell name (take_action's `level`).
  levels?: Record<string, number>;
};

// The toggles an attack card carries. Open Hand Technique is one choice of
// three, so its ids carry the rider after a colon and share a group.
export type HandAttackOptionId =
  | "reckless"
  | "stunningStrike"
  | "nonlethal"
  | "useInspiration"
  | "strokeOfLuck"
  | "hurlThroughHell"
  | "rapidStrike"
  | "openHand:prone"
  | "openHand:push"
  | "openHand:no reactions";

export type HandAttackOption = {
  id: HandAttackOptionId;
  label: string;
  // What choosing it does, for the toggle's tooltip.
  note: string;
  // The engine's refusal when it cannot ride this swing now.
  disabled: string | null;
  // Options of one group exclude each other (Open Hand's three riders).
  group?: "openHand";
  // Open only on a swing with advantage (Rapid Strike): shut as dealt, and
  // judged again against the creature aimed at (hand-odds.ts aimedCard).
  needsAdvantage?: true;
};

// The turn so far, read from the engine's TurnBudget
// (src/lib/dm/action-budget.ts) through the encounter's public projection
// (hand-table.ts turnFromEncounter). The Hand keeps no ledger of its own: a
// card sent is spent when the engine says so.
export type HandTurn = {
  myTurn: boolean;
  // Whose turn it is when it is not mine, for the tooltip.
  currentName?: string;
  actionUsed: boolean;
  bonusUsed: boolean;
  reactionUsed: boolean;
  attacksMade: number;
  extraActions?: number;
  // Action Surge's additional action, not yet spent.
  grantedActions?: number;
  // The engine budget's once-per-turn marks (Martial Arts' strike open, a
  // levelled or bonus-action spell cast, Sneak Attack spent).
  marks?: string[];
  // Flurry of Blows strikes bought and not made.
  flurryStrikes?: number;
  // This turn's action went on an attack-roll spell, so Extra Attack is gone.
  castThisAction?: boolean;
  // What the Attack action was made with, for the off-hand swing (issue
  // 210). Absent from a server too old to send them.
  lightMeleeAttack?: boolean;
  oneHandMeleeAttack?: boolean;
  // The turn's free object interaction is spent (issue #424).
  interactionUsed?: boolean;
  // The engine's reading of the fight, so the gates ask canAct itself.
  table?: HandTable | null;
  // Whether a save this character failed is open on the record
  // (PublicEncounter.lastSaves): never out of a fight, where nothing is
  // recorded. Undefined from a caller that does not read the record.
  failedSave?: boolean;
};

// What canAct needs to know about the fight, off the public encounter.
export type HandTable = {
  round: number;
  orderReady: boolean;
  // The combatant the pointer rests on; `id` is empty unless a character.
  acting: { id: string; name: string } | null;
  surprised: { acting: string[]; reacting: string[] };
};

export const FRESH_TURN: HandTurn = {
  myTurn: true,
  actionUsed: false,
  bonusUsed: false,
  reactionUsed: false,
  attacksMade: 0,
};

// What the content pack says about a spell. Fetched by the component; the
// authored rows cover a table without the pack.
export type SpellFact = {
  level: number;
  school: string;
  castingTime: string;
  range: string;
  desc: string;
  higherLevel: string;
  concentration: boolean;
  // A table's workshop spell: its own block (which the cast tools read before
  // any published row), the published spell it runs as (its area, its
  // melee touch), and its casting facts (its material and price), so its
  // card says what the server will do.
  mech?: SpellMech;
  runsAs?: string;
  facts?: SpellFacts;
  // The engine plays this spell from mechanics it read from the text that
  // nobody checked (src/lib/content/reading-logic.ts): its card says so.
  bestEffort?: boolean;
};

export type HandOptions = {
  spells?: Record<string, SpellFact>;
  // The creatures each summoning spell on the sheet can call, by the
  // spell's name as the sheet holds it (textKey), read from the server's
  // own catalogue (GET /api/campaigns/[id]/summons, issue 685). Absent on a
  // host that has none, whose summon cards ask nothing as before.
  summons?: Record<string, SummonCatalogue>;
  // The table's ammunition variant rule. Undefined = unknown: the count is
  // shown but an empty quiver only warns.
  trackAmmo?: boolean;
  // What the gear cards need beyond the sheet (hand-gear.ts).
  gear?: HandGearContext;
  // Whether an instant blast's card is laid on the battle map (issue 570):
  // false for a host too old to catch the creatures in it, whose blasts are
  // aimed at one enemy as before. Absent means it is.
  blasts?: boolean;
  // Whether the spells items cast are dealt as cards (hand-items.ts): false
  // for a host too old to resolve them (src/lib/capabilities.ts
  // handItemCasts). Absent means they are.
  items?: boolean;
  // What the board says of the character's own square (PlayerMapView.self).
  board?: HandBoardFacts;
};

// The engine's own verdicts on the square a character stands on, sent by
// the board view for the viewer's own token (src/lib/battlemap/view.ts):
// take_action's refusal of a Hide there (hide-traits.ts hideRefusal), and
// the Silence it stands in, by who cast it ("" for nobody named;
// zone-rules.ts silenceAround). Absent off the map and from an older host,
// whose cards are dealt as before.
// `bright`: the square is in bright light, said as the refusal's opening
// (one-with-shadows.ts brightSquare), where a feature of dim light or darkness
// is refused (Steps of Night, One with Shadows, Shadow Step, Cloak of Shadows).
export type HandBoardFacts = { hide?: string; silence?: { by: string }; bright?: string };

// The board and the party as the gear cards read them: what lies on the
// ground near this character (the board view's drops), the mount they ride,
// how many allies could take something handed over, and who is dying.
export type HandGearContext = {
  drops?: Array<{ id: string; name: string; reach: boolean }>;
  mount?: string | null;
  allies?: number;
  dying?: Array<{ id: string; name: string }>;
};

// The fan's seats, End turn's included (src/lib/battlemap/hand-layout.ts).
export { HAND_FAN_CAP } from "@/lib/battlemap/hand-layout";


export function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

export function addFlat(expression: string, bonus: number): string {
  if (!bonus) return expression;
  return `${expression}${bonus > 0 ? "+" : "-"}${Math.abs(bonus)}`;
}

export function feet(range: string): string {
  const match = /^(\d+)\s*(feet|foot|ft)/i.exec(range.trim());
  if (match) return `${match[1]} ft`;
  return range.trim() ? range.trim().replace(/^./, (c) => c.toUpperCase()) : "";
}

export function primaryClass(sheet: CharacterSheet): string {
  return (sheet.classes[0]?.id ?? sheet.class).toLowerCase();
}

// ---- what stops a card ----

export type Gate = { reason: string; spent: boolean } | null;

// A reroll of a save the holder failed (Indomitable, Diamond Soul, Fanatical
// Focus): shut while no failed save of theirs is on record, as the engine
// refuses it then ("has no failed saving throw to reroll"). Out of a fight
// nothing is recorded, so the card is shut there too. SRD 5.1
// fighter, Indomitable: "you can reroll a saving throw that you fail."
export function failedSaveGate(name: string, turn: Pick<HandTurn, "failedSave">): Gate {
  return turn.failedSave === false ? { reason: `${name} rerolls a saving throw you have just failed, and there is none on record.`, spent: false } : null;
}

// The fight as canAct reads it, built from the public projection. The order
// is reduced to the one entry canAct looks at (the pointer's), and the
// surprise list is the server's own answer for this kind of act, so the
// verdict is the one the server will give.
export function actingEncounter(turn: HandTurn, kind: ActKind): ActingEncounter | null {
  const table = turn.table;
  if (!table) {
    // No projection (a test, an older server): the floor's word decides.
    if (turn.myTurn) return null;
    return {
      orderReady: true,
      round: 2,
      turnIndex: 0,
      surprisedIds: [],
      order: [{ kind: "npc", npcId: "", name: turn.currentName ?? "someone else", initiative: 0 }],
    };
  }
  const current: OrderEntry[] = table.acting
    ? [
        table.acting.id
          ? { kind: "pc", characterId: table.acting.id, userId: "", name: table.acting.name, initiative: 0 }
          : { kind: "npc", npcId: "", name: table.acting.name, initiative: 0 },
      ]
    : [];
  return {
    orderReady: table.orderReady,
    round: table.round,
    turnIndex: 0,
    order: current,
    surprisedIds: kind === "reaction" ? table.surprised.reacting : table.surprised.acting,
  };
}

// Whether this character may act at all right now, in the engine's words
// (src/lib/dm/can-act.ts): dead, at 0 HP, incapacitated, surprised, the
// order not rolled, or somebody else's turn. A reaction is asked as one, so
// it is open on anyone's turn.
export function standingGate(sheet: CharacterSheet, turn: HandTurn, kind: ActKind = "action"): Gate {
  const verdict = canAct({ sheet, encounter: actingEncounter(turn, kind), kind });
  return verdict.ok ? null : { reason: verdict.error, spent: false };
}

// A hand that is only waiting: the one thing in this character's way is
// that it is somebody else's turn, or that initiative is still being
// rolled. Nothing about the cards is wrong, so they are still worth reading
// (issue 96). `note` is the engine's sentence for it; `sentences` are every
// wording of it a card may carry (canAct names the act: "cannot attack yet",
// "cannot cast a spell yet"), which is how the hand tells a card held by the
// wait from one held by something of its own. Null on the character's own
// turn, and when something worse stops them first (down, stunned, surprised).
const WAITING: ReadonlySet<string> = new Set(["not_your_turn", "no_initiative"]);
const ACT_KINDS: ActKind[] = ["action", "attack", "bonus", "move", "free", "cast"];

export function waitingHand(sheet: CharacterSheet, turn: HandTurn): { note: string; sentences: Set<string> } | null {
  let note = "";
  const sentences = new Set<string>();
  for (const kind of ACT_KINDS) {
    const verdict = canAct({ sheet, encounter: actingEncounter(turn, kind), kind });
    if (verdict.ok) {
      continue;
    }
    if (!WAITING.has(verdict.reason)) {
      return null;
    }
    note ||= verdict.error;
    sentences.add(verdict.error);
  }
  return sentences.size ? { note, sentences } : null;
}

// The turn as the engine's own TurnBudget, so a cost is judged by the same
// spend functions pc_attack, take_action and the cast guard call, and a
// refusal reads in their words.
export function budgetOf(turn: HandTurn, sheet: Pick<CharacterSheet, "id">, allowed = 1): TurnBudget {
  return {
    ownerId: sheet.id,
    round: turn.table?.round ?? 1,
    actionUsed: turn.actionUsed,
    bonusUsed: turn.bonusUsed,
    reactionUsed: turn.reactionUsed,
    attacksMade: turn.attacksMade,
    attacksAllowed: Math.max(1, allowed),
    oncePerTurn: turn.marks ?? [],
    dashed: false,
    disengaged: false,
    ...(turn.extraActions ? { extraActions: turn.extraActions } : {}),
    ...(turn.grantedActions ? { grantedActions: turn.grantedActions } : {}),
    ...(turn.flurryStrikes ? { flurryStrikes: turn.flurryStrikes } : {}),
    ...(turn.castThisAction ? { castThisAction: true } : {}),
    ...(turn.lightMeleeAttack ? { lightMeleeAttack: true } : {}),
    ...(turn.oneHandMeleeAttack ? { oneHandMeleeAttack: true } : {}),
    ...(turn.interactionUsed ? { interaction: { what: "an object", weapons: 2 } } : {}),
  };
}

const spentGate = (result: SpendResult): Gate => (result.ok ? null : { reason: result.error, spent: true });

// `what` is the card's name as the engine would name the spend ("Dash",
// "Longsword"): Haste's extra action pays only for the ones it allows.
export function costGate(cost: HandCost, turn: HandTurn, sheet: CharacterSheet, what = "that"): Gate {
  if (cost === "reaction") {
    const blocked = conditionBlocksReactions(sheet.conditions);
    if (blocked) return { reason: `${sheet.name} is ${blocked} and cannot take a reaction.`, spent: false };
    return spentGate(spendAction(budgetOf(turn, sheet), "reaction", what, sheet.name));
  }
  if (cost === "action" || cost === "bonus") {
    return spentGate(spendAction(budgetOf(turn, sheet), cost, what, sheet.name));
  }
  return null;
}

// The Attack action stays open until every swing it grants is made, which
// is what lets a fighter play the same card twice. Asked of spendAttack
// itself: Action Surge's action, Haste's one weapon attack and Flurry of
// Blows' unarmed strikes count exactly as the engine counts them.
export function attackGate(
  turn: HandTurn,
  allowed: number,
  sheet: Pick<CharacterSheet, "id" | "name">,
  options: AttackSpendOptions = {},
): Gate {
  return spentGate(spendAttack(budgetOf(turn, sheet, allowed), sheet.name, options));
}

export function gated<T extends HandCard>(card: T, ...gates: Gate[]): T {
  const hit = gates.find((gate) => gate !== null) ?? null;
  return hit ? { ...card, disabled: hit.reason, spent: hit.spent } : card;
}

export type SlotPick = { level: number; left: number; max: number; pact: boolean };

// The lowest slot that can carry a spell of this level, pact slots included.
export function lowestSlot(sheet: CharacterSheet, spellLevel: number): SlotPick | null {
  const casting = sheet.spellcasting;
  if (!casting) return null;
  const picks: SlotPick[] = [];
  for (const [key, slot] of Object.entries(casting.slots)) {
    const level = Number(key);
    if (level >= spellLevel && slot.max - slot.used > 0) {
      picks.push({ level, left: slot.max - slot.used, max: slot.max, pact: false });
    }
  }
  if (casting.pact && casting.pact.level >= spellLevel && casting.pact.max - casting.pact.used > 0) {
    picks.push({ level: casting.pact.level, left: casting.pact.max - casting.pact.used, max: casting.pact.max, pact: true });
  }
  picks.sort((a, b) => a.level - b.level);
  return picks[0] ?? null;
}

export function slotLine(slot: SlotPick): string {
  return `${slot.pact ? "Pact" : "Slot"} ${slot.level} · ${slot.left}/${slot.max}`;
}


export const SAVE_LABEL: Record<string, string> = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };

// The once-a-turn mark pc_attack leaves when a granted strike rode its
// activation (pc-attack-spend.ts). Here rather than in hand-granted.ts so the
// board's aim (hand-play.ts) reads it without the granted cards, which reach
// the spell cards (hand-spells.ts), in the table display page's first load.
export function grantedRideMark(name: string): string {
  return `granted:${name.toLowerCase()}`;
}

// Swings the Attack action grants this character (1 + Extra Attack), which
// is what afterCommit needs to know when the action closes. Here rather than
// in hand.ts so the board's token menu (hand-hud.ts) asks it without pulling
// every card builder into the board's first load: the table display page
// loads the board and never deals a hand.
export function attacksAllowed(sheet: CharacterSheet): number {
  return 1 + combatRiders(sheet).extraAttacks;
}
