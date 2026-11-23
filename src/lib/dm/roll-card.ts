// A die the engine rolls inside the rules, stored and published as a dice
// card like any other: the table sees every roll the server makes. Its own
// module, importing only the dice and the door a roll goes on record
// through, so the clock paths (a spell's tick at a turn's start or end,
// src/lib/dm/spell-aura.ts) can card their dice without the import cycles
// action-common.ts would bring.
//
// Each helper here puts its roll on record through the one door for that
// (src/lib/dm/roll-record.ts recordRoll): inside a GM call the card joins the
// call's own turn, so a caller that holds a copy of the turn, or none, no
// longer leaves its card out of the chronicle (issue #915).

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { RollAttacker, RollKind, RollSource } from "@/lib/db/rolls";
import { rollExpression, type RollOptions, type RollResult } from "@/lib/dice";
import type { RollTag } from "@/lib/dice-script-logic";
import { recordRoll } from "@/lib/dm/roll-record";
import { attackOn, rollAgainst, thrownOn, type Thrown } from "@/lib/roll-labels";
import type { RollParts } from "@/lib/roll-parts";
import { effectSource, gmSource } from "@/lib/roll-sources";

// `turn` is the DM turn the card belongs to, when the site holds one; inside
// a GM call the card joins the call's own turn whatever is handed in, and a roll
// outside one with no turn (the clock's) stands alone. `attacker`
// is who made an attack or damage roll, which always names one: a creature,
// or the source of a roll nobody at the table made (src/lib/roll-sources.ts).
// Null is for the other kinds of roll alone.
// A flat amount (Aura of Conquest's half a level) rolls no dice and gets no
// card.
export function rollCard(
  campaign: Pick<Campaign, "id">,
  turn: DmTurn | null,
  characterId: string | null,
  kind: "attack" | "damage",
  detail: string,
  expression: string,
  attacker: RollAttacker,
  options?: RollOptions,
  parts?: RollParts,
): RollResult;
export function rollCard(
  campaign: Pick<Campaign, "id">,
  turn: DmTurn | null,
  characterId: string | null,
  kind: Exclude<RollKind, "attack" | "damage">,
  detail: string,
  expression: string,
  attacker: RollAttacker | null,
  options?: RollOptions,
  parts?: RollParts,
): RollResult;
export function rollCard(
  campaign: Pick<Campaign, "id">,
  turn: DmTurn | null,
  characterId: string | null,
  kind: RollKind,
  detail: string,
  expression: string,
  attacker: RollAttacker | null,
  // How the dice are thrown (an Empowered Spell's rerolls: src/lib/dice.ts).
  options: RollOptions = {},
  // What the roll says of itself as fields (src/lib/roll-parts.ts).
  parts?: RollParts,
): RollResult {
  const outcome = rollExpression(expression, undefined, options);
  if (!outcome.terms.some((term) => term.kind === "dice")) {
    return outcome;
  }
  recordRoll({
    campaignId: campaign.id,
    characterId,
    requestedBy: "dm",
    // The signatures above hold an attack or damage roll to a named roller.
    ...(kind === "attack" || kind === "damage" ? { kind, attacker: attacker as RollAttacker } : { kind, attacker }),
    detail: detail.slice(0, 120),
    ...(parts ? { parts } : {}),
    result: outcome,
    turn,
    // Thrown here, on the server's dice.
    landing: null,
  });
  return outcome;
}

// Who a character is, as a roll's attacker.
export const sheetAttacker = (sheet: { id: string; name: string }): RollAttacker => ({ kind: "sheet", id: sheet.id, name: sheet.name });

// Who an enemy is, as a roll's attacker.
export const enemyAttacker = (enemy: { id: string; displayName: string }): RollAttacker => ({ kind: "enemy", id: enemy.id, name: enemy.displayName });

// Who rolled a roll card's own attack or damage dice, or the roll tools'
// free text: the character they were asked of, else the GM, whose roll then
// keeps the words the GM typed for it.
export const cardRoller = (sheet: { id: string; name: string } | null | undefined): RollAttacker => (sheet ? sheetAttacker(sheet) : gmSource());

// What a source's roll threw, with its dice.
type Dice = Thrown & { dice: string };

// The damage of a roll nobody at the table made (issue 915, ruling 2), on
// record. The source is the roller and goes in front of the card, so no site
// writes this roll's words: they are what was thrown and on whom
// (roll-labels.ts thrownOn), and never the source a second time.
// `characterId` is the character it lands on, when it lands on one.
export function sourceDamage(
  campaign: Pick<Campaign, "id">,
  turn: DmTurn | null,
  source: RollSource,
  on: { characterId?: string | null; names: string[] },
  thrown: Dice,
  options?: RollOptions,
): RollResult {
  return rollCard(campaign, turn, on.characterId ?? null, "damage", thrownOn(thrown, on.names), thrown.dice, source, options);
}

// The same, for a site that has thrown the dice itself (an area's, with its
// own rules for them; a creature's fall).
export function sourceDamageThrown(
  campaign: Pick<Campaign, "id">,
  turn: DmTurn | null,
  source: RollSource,
  on: { characterId?: string | null; names: string[] },
  thrown: Dice,
  result: RollResult,
): void {
  recordRoll({
    campaignId: campaign.id,
    characterId: on.characterId ?? null,
    requestedBy: "dm",
    kind: "damage",
    detail: thrownOn(thrown, on.names),
    result,
    attacker: source,
    turn,
    // Thrown by its site, on the server's dice.
    landing: null,
  });
}

// A source's attack roll (a trap's dart) against one target's armour.
export function sourceAttack(
  campaign: Pick<Campaign, "id">,
  turn: DmTurn | null,
  source: RollSource,
  on: { characterId?: string | null; name: string },
  ac: number,
  expression: string,
): RollResult {
  return rollCard(campaign, turn, on.characterId ?? null, "attack", attackOn(on.name, ac), expression, source);
}

// The damage of a spell or effect cast at one target. A creature's cast says
// its spell ("Shaman · Damage (Sacred Flame vs Aria)"). A source's says what
// it throws, as every source's roll does, with the spell in front of the
// dice ("a glyph on the door · Damage (Burning Hands, 3d6 fire on Aria)")
// unless the spell is the source itself. That is decided by what the source
// is, never by reading its words: a source the GM named in words that say
// the spell too has it said twice, as the GM wrote it.
export function castDamage(
  campaign: Pick<Campaign, "id">,
  turn: DmTurn | null,
  by: RollAttacker,
  spell: string | null | undefined,
  on: { characterId?: string | null; name: string },
  thrown: Dice,
): RollResult {
  if (by.kind !== "hazard") {
    return rollCard(campaign, turn, on.characterId ?? null, "damage", rollAgainst(spell || "Effect", on.name), thrown.dice, by);
  }
  const note = spell && by.hazard !== "effect" ? spell : undefined;
  return sourceDamage(campaign, turn, by, { characterId: on.characterId, names: [on.name] }, { ...thrown, note });
}

// Later damage of a spell or feature (a curse's rider, a second burn),
// rolled when whoever cast it may have left the table. While the character's
// sheet is there it is their roll, worded as its site words it; a creature
// that cast it (`foe`) rolls it the same way. With neither left, the spell
// is the source, and the card says what it throws.
export function castersDamage(
  campaign: Pick<Campaign, "id">,
  turn: DmTurn | null,
  caster: { id: string; name: string } | null | undefined,
  detail: string,
  spell: string,
  target: string,
  thrown: Dice,
  foe?: { id: string; displayName: string } | null,
): RollResult {
  if (caster) {
    return rollCard(campaign, turn, caster.id, "damage", detail, thrown.dice, sheetAttacker(caster));
  }
  if (foe) {
    return rollCard(campaign, turn, null, "damage", detail, thrown.dice, enemyAttacker(foe));
  }
  return sourceDamage(campaign, turn, effectSource(spell), { names: [target] }, thrown);
}

// A roll the players are not shown (an enemy's initiative, its stealth, a
// recharge, an NPC's private choice): stored for the DM alone and kept on the
// turn, exactly as an enemy's saving throw is (src/lib/dm/forced-save.ts).
export function dmRoll(
  campaignId: string,
  turn: DmTurn | null,
  kind: Exclude<RollKind, "attack" | "damage">,
  detail: string,
  expression: string,
  // Who rolls it and what, for a test table's dice script
  // (src/lib/dice-script-logic.ts).
  purpose?: RollTag,
) {
  const outcome = rollExpression(expression, undefined, { purpose });
  recordRoll({
    campaignId,
    characterId: null,
    requestedBy: "dm",
    kind,
    detail: detail.slice(0, 200),
    result: outcome,
    visibility: "dm",
    turn,
    landing: null,
    // Read on the turn's cards by the seats that may; no seat is sent it.
    send: false,
  });
  return outcome;
}

// A roll that is a storyteller secret (issue 503: a recruiter's Persuasion,
// a pact member's Deception, a player's secret action): stored "secret", so
// only the storyteller and the player whose character it is for ever read
// it (src/lib/dm/viewer.ts rollAccessFor), never the lead of an AI table,
// who reads every "dm" roll. `characterId` is the player character it
// belongs to, when it is one's own: that player is sent it as it is made.
export function secretRoll(
  campaignId: string,
  turn: DmTurn | null,
  characterId: string | null,
  kind: Exclude<RollKind, "attack" | "damage">,
  detail: string,
  expression: string,
  dc: number | null = null,
  // What the roll says of itself as fields (src/lib/roll-parts.ts).
  parts?: RollParts,
) {
  const outcome = rollExpression(expression);
  const roll = recordRoll({
    campaignId,
    characterId,
    requestedBy: "dm",
    kind,
    detail: detail.slice(0, 200),
    ...(parts ? { parts } : {}),
    result: outcome,
    dc,
    visibility: "secret",
    turn,
    // Handed no turn, it joins none, a GM call's own included: the turn's
    // cards are named in the message every seat is sent.
    home: turn ? "turn" : "apart",
    landing: null,
    // Only the player whose character it is for is sent it.
    send: Boolean(characterId),
  });
  return { ...outcome, rollId: roll.id };
}
