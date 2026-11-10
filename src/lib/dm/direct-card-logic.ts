// The cards issue 685 brought to the engine's direct path (intent-logic.ts
// directCardCall), each by a tool that already takes it whole. At a table a
// person runs these were posted as a sentence and waited in the GM's
// "Waiting on you" list, where nobody resolved them unless the GM entered
// the card again by hand; an AI turn left them to the model, whose call for
// them is the same one.
//
// - A spell that makes creatures: cast_buff brings them in with their stat
//   blocks (summon-cast.ts), the creature named in `variant` and how many in
//   `count`, both picked on the card (src/lib/battlemap/hand-summon.ts).
// - A spell with nothing to roll (a utility spell): use_spell_slot spends the
//   slot and starts its concentration, which is all the engine does for it.
// - A lasting area laid on the battle map (Web, Moonbeam, Fog Cloud): laid
//   on its squares by the spell's tool, catching nobody, since it bites when
//   its zone row says (zones-spells.ts).
// - A weapon attack's riders that pc_attack takes under its own names:
//   Divine Smite's slot and one Battle Master maneuver.
//
// Pure, for scripts/test-direct-card.mjs.
import type { DirectCall, DirectContext, MessageIntent } from "@/lib/dm/intent-logic";
import { isNamed } from "@/lib/srd/feature-names";

const level = (intent: MessageIntent) => (intent.slotLevel ? { level: intent.slotLevel } : {});

// The squares a card laid its area on, under the tools' own names.
export function placementOf(intent: MessageIntent): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of ["atX", "atY", "towardX", "towardY"] as const) {
    if (intent[key] !== undefined) out[key] = intent[key];
  }
  return out;
}

type LastingPick = NonNullable<DirectContext["lasting"]>["pick"];

// Whether the card picked what its area needs on the board: a point for a
// burst or a cube, the first square of a wall, a way for a line from the
// caster, nothing for an area around the caster or off the board.
function lastingLaid(intent: MessageIntent, pick: LastingPick): boolean {
  switch (pick) {
    case "point":
    case "wall":
      return intent.atX !== undefined && intent.atY !== undefined;
    case "direction":
      return intent.towardX !== undefined && intent.towardY !== undefined;
    default:
      return true;
  }
}

// A spell that makes creatures, cast whole: the creature is the card's
// variant, or the only one the spell makes (Unseen Servant), and its number
// the card's count (the most the slot allows when it names none); a
// per-target spell's forms come as its mix (Animate Dead's skeletons and
// zombies). The Hand and the sheet's summoning door ask for them (issue
// 685); a card that names no creature (an older screen, an agent) stays with
// the GM, who picks it.
//
// A summoning of a minute or more in a fight is begun first (SRD 5.1,
// Longer Casting Times): a card with no creature begins it through
// use_spell_slot, which holds it across the caster's turns, and the card
// that finishes it names the creature, which cast_buff brings as the cast
// guard completes the casting.
export function summonCall(intent: MessageIntent, characterId: string, context: DirectContext): DirectCall | null {
  if (!intent.spell || !context.summon) {
    return null;
  }
  const mix = intent.mix?.length ? intent.mix : null;
  const ritual = intent.ritual ? { ritual: true } : {};
  if (context.long && context.inFight && !intent.variant && !mix) {
    return { name: "use_spell_slot", args: { characterId, spell: intent.spell, ...level(intent), ...ritual } };
  }
  if (context.summon === "choose" && !intent.variant && !mix) {
    return null;
  }
  return {
    name: "cast_buff",
    args: {
      characterId,
      spell: intent.spell,
      ...level(intent),
      ...(mix ? { mix } : intent.variant ? { variant: intent.variant } : {}),
      ...(!mix && intent.count ? { count: intent.count } : {}),
      ...ritual,
    },
  };
}

// A lasting area's card. Undefined for a buff that lays one (Spirit
// Guardians, Spiritual Weapon), which cast_buff casts on its target.
//
// A save spell's area (Web, Moonbeam, Cloudkill) is aoe_damage's with its
// squares and nobody named, which lays it: who it catches is decided as they
// enter it or start a turn there. One whose first saves come as it appears
// (Entangle, a Wall of Fire) is laid the same way on a board, where the
// engine catches whoever stands on its squares (area-casting.ts boardCatch);
// `catches` marks the rest (off the board, a wall that only shoves), which
// stay with the GM to name who stands in it. An
// area with nothing to roll (Fog Cloud, Spike Growth) is use_spell_slot's,
// which lays it too, or only spends the slot where there is no board.
export function lastingAreaCall(intent: MessageIntent, characterId: string, context: DirectContext): DirectCall | null | undefined {
  const lasting = context.lasting;
  const spell = intent.spell;
  if (!lasting || !spell || context.resolution === "buff") {
    return undefined;
  }
  if (lasting.catches || !lastingLaid(intent, lasting.pick)) {
    return null;
  }
  const placed = lasting.pick === "off" ? {} : placementOf(intent);
  switch (context.resolution) {
    case "save":
    case "auto":
      return context.inFight && lasting.pick !== "off"
        ? { name: "aoe_damage", args: { casterCharacterId: characterId, spell, ...level(intent), ...placed } }
        : null;
    case "utility":
    case null:
    case undefined:
      return context.dispel ? null : { name: "use_spell_slot", args: { characterId, spell, ...level(intent), ...placed } };
    default:
      return null;
  }
}

// A spell with nothing for the engine to roll or apply (a utility spell): the
// slot spent, its concentration begun, the effect told. Dispel Magic is the
// exception, which cast_buff resolves against a target the card does not
// carry.
export function utilityCall(intent: MessageIntent, characterId: string, context: DirectContext): DirectCall | null {
  return intent.spell && context.resolution === "utility" && !context.dispel
    ? { name: "use_spell_slot", args: { characterId, spell: intent.spell, ...level(intent) } }
    : null;
}

// A buff whose range is Self lands on its caster: a card that named nobody
// (an older screen, an agent) is the caster's own.
export function selfBuffCall(intent: MessageIntent, characterId: string, context: DirectContext): DirectCall | null {
  return intent.spell && context.selfOnly && !intent.targetId
    ? { name: "cast_buff", args: { characterId, spell: intent.spell, targetCharacterIds: [characterId], ...level(intent), ...(intent.variant ? { variant: intent.variant } : {}) } }
    : null;
}

// pc_attack's arguments for the riders attached to an attack card, or null
// when one is beyond it: a smite with no slot named (a card from an older
// screen), a maneuver not named ("Maneuver", the card dealt when the sheet
// lists none), or two maneuvers on one swing (SRD 5.1: one Superiority Die
// per attack). The Hand's rider cards are Divine Smite and the Battle
// Master's maneuvers (src/lib/battlemap/hand.ts).
export function riderArgs(intent: MessageIntent): Record<string, unknown> | null {
  const riders = intent.riders ?? [];
  const smite = riders.some((rider) => isNamed(rider, "Divine Smite"));
  const maneuvers = riders.filter((rider) => !isNamed(rider, "Divine Smite"));
  if ((smite && !intent.attack?.smite) || maneuvers.length > 1 || maneuvers.some((rider) => isNamed(rider, "Maneuver"))) {
    return null;
  }
  return {
    ...(smite ? { smite: intent.attack?.smite } : {}),
    ...(maneuvers.length ? { maneuver: maneuvers[0].trim() } : {}),
  };
}
