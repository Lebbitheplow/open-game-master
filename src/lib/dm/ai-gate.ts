// The model's own calls to the raw damage, healing and condition tools
// (docs/dnd-rules-audit-2026-10-09-extent.md, F17), held to the rules of
// src/lib/dm/ai-boundary.ts before they reach the engine:
//
//   - damage and healing are dice the server rolls now (`dice`), or a total
//     the model asked the server to roll this turn (request_roll) that has
//     paid for nothing yet;
//   - a condition that binds a creature lands only after the save the server
//     rolls (saveAbility and saveDc);
//   - a binding condition the engine keeps (a save, a duration, a spell, a
//     source decides when it ends) is not lifted by hand;
//   - an item granted or revealed says what it is when its name does not;
//   - an advantage claimed with its reason names where it comes from.
//
// Only the model's calls pass through here: those the AI's turn runs itself
// (resolveModelCall in src/lib/dm/turn.ts) and the rest through
// dispatchAdjudication. The engine's own paths call the handlers directly,
// and the console and the party lead keep their free hand.

import { splitParts } from "@/lib/dm/action-parts-logic";
import type { Campaign } from "@/lib/db/campaigns";
import { payOnTurn, type DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy } from "@/lib/db/encounters";
import { shownName } from "@/lib/dm/board-hidden";
import { getRoll, type StoredRoll } from "@/lib/db/rolls";
import { awayRefusal, canCrossAway } from "@/lib/dm/fight-away-logic";
import { sceneCallRefusal } from "@/lib/dm/party-split";
import { isValidExpression } from "@/lib/dice";
import { spellFactsFor } from "@/lib/content";
import { rollAgainst } from "@/lib/roll-labels";
import { rollCard, sourceDamage } from "@/lib/dm/roll-card";
import { harmSource, UNNAMED_HARM } from "@/lib/roll-sources";
import { rollCharacterSave } from "@/lib/dm/forced-save";
import { canonicalCondition } from "@/lib/dm/set-condition";
import { trapHoldOn } from "@/lib/dm/trap-escape";
import { instancesOf, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { AI_BIND_REFUSAL, AI_CLEAR_REFUSAL, AI_NUMBER_REFUSAL, bindsCreature, engineKept } from "@/lib/dm/ai-boundary";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError, ToolResult } from "@/lib/dm/tool-errors";
import { listedAgainst } from "@/lib/dm/roll-about";
import { heldSaveTraits } from "@/lib/srd/trait-rules";
import { unnamedRollKeys } from "@/lib/srd/roll-keys";
import { HEALING_POTIONS, hasItemTag, itemRow } from "@/lib/srd/item-tags";
import { listedItemTags } from "@/lib/schemas/item-tags";
import { sentItemTags } from "@/lib/dm/item-logic";
import { isTableGearName } from "@/lib/db/homebrew";
import { unrevealedLine } from "@/lib/dm/mutation-math";
import { enemyHoldsItem } from "@/lib/dm/gear-ground";
import { rollAbility, rollSkill } from "@/lib/roll-parts";

export type GateContext = {
  campaign: Campaign;
  turn: DmTurn;
  sheetsById: Map<string, CharacterSheet>;
};

// The call to run (its arguments, perhaps with the server's own roll in
// them), or the answer that stands in for it.
export type GateOutcome = { args: string } | { result: ToolResult };

const SAVE_ABILITIES = new Set(["str", "dex", "con", "int", "wis", "cha"]);

const NUMBER_TOOLS = new Set(["apply_damage", "heal", "damage_enemy", "split_damage", "damage_pet"]);

// A call that lists its parts is asked whole, before it is split: a part
// refused later would come after the others had landed and spent.
export function awayCall(name: string, args: Record<string, unknown>, ctx: Pick<GateContext, "campaign" | "sheetsById">): ToolError | null {
  const awayIds = canCrossAway(name, args) ? (getActiveEncounter(ctx.campaign.id)?.awayIds ?? []) : [];
  // Nor does it cross between the groups of a party that split up (issue
  // 951): a call names only who is in the scene.
  const error = (awayIds.length ? awayRefusal(name, args, awayIds.flatMap((id) => ctx.sheetsById.get(id) ?? [])) : null) ?? sceneCallRefusal(ctx.campaign, name, args, ctx.sheetsById);
  return error ? { error, retry: true } : null;
}

// Whether a heal list's dice are all the server's to roll from the spell
// itself: a spell the content pack knows, and no entry sending dice of its
// own. Such a list passes the gate below whole, as each of its entries
// passed it; any other is split, so each entry's number is still held to the
// gate (turn.ts oneCastingCall).
export function healListRolledByServer(each: readonly Record<string, unknown>[]): boolean {
  const spell = typeof each[0]?.spell === "string" ? each[0].spell.trim() : "";
  return Boolean(spell) && Boolean(spellFactsFor(spell)) && each.every((entry) => entry.dice === undefined);
}

export function gateAiCall(name: string, rawArguments: string, ctx: GateContext): GateOutcome {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  } catch {
    return { args: rawArguments };
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { args: rawArguments };
  }
  // Reach does not cross the edge of a fight (issue 740), whoever sends it.
  const beyond = awayCall(name, args, ctx);
  if (beyond) {
    return { result: beyond };
  }
  // Dice sent to a damage or healing tool are rolled by the server whoever
  // sends them (the console's forms take dice too).
  if (ctx.turn.actor !== "ai") {
    return NUMBER_TOOLS.has(name) && typeof args.dice === "string" ? number(ctx, args, name === "heal" ? "healing" : "damage", targetOf(name, args)) : { args: rawArguments };
  }
  switch (name) {
    case "apply_damage":
      return number(ctx, args, "damage", String(args.characterId ?? ""));
    case "heal": {
      // A healing spell the server knows is rolled from its own dice.
      const spell = typeof args.spell === "string" ? args.spell.trim() : "";
      if (spell && spellFactsFor(spell)) {
        return { args: rawArguments };
      }
      return number(ctx, args, "healing", String(args.characterId ?? ""));
    }
    case "damage_enemy":
      // A fall is rolled by the server already.
      return args.fallFeet !== undefined ? { args: rawArguments } : number(ctx, args, "damage", String(args.enemyId ?? ""));
    case "split_damage":
      return number(ctx, args, "damage", "");
    // A pet's damage is rolled like any other, now that apply_damage takes a
    // pet beside a character and an enemy (issue #471): it used to take the
    // model's number as sent.
    case "damage_pet":
      return number(ctx, args, "damage", String(args.characterId ?? ""));
    case "set_condition":
      return bind(ctx, args);
    case "clear_condition":
      return lift(ctx, args, rawArguments);
    case "grant_item":
    case "reveal_item":
      return itemFacts(ctx, name, args, rawArguments);
    case "purchase":
      return args.action === "buy" ? itemFacts(ctx, name, args, rawArguments) : { args: rawArguments };
    // What an enemy lets fall reaches a sheet when it is picked up.
    case "handle_item":
      return args.enemyId && args.action === "drop" && !enemyHoldsItem(ctx.campaign.id, String(args.enemyId), String(args.item ?? ""))
        ? itemFacts(ctx, name, args, rawArguments)
        : { args: rawArguments };
    // Each of pc_attack's parts claims its own advantage.
    case "pc_attack":
      for (const part of splitParts(name, args, null)) {
        const claimed = claimSource(part.args, rawArguments);
        if ("result" in claimed) {
          return claimed;
        }
      }
      return { args: rawArguments };
    case "enemy_attack":
    case "request_roll":
      return claimSource(args, rawArguments);
    default:
      return { args: rawArguments };
  }
}

// What a granted or revealed item is, when its name alone does not tell the
// engines, which read an item by its row or its tags and never the words of
// its name (src/lib/srd/item-tags.ts): the row a thing no table knows by name
// is (srdName) or its tags, and the spell a scroll holds. Asked for rather
// than lost, as a roll's fields are (src/lib/srd/roll-keys.ts): a potion
// named in the table's language with neither would heal no one, a scroll
// with no spell would cast nothing.
function itemFacts(ctx: GateContext, name: string, args: Record<string, unknown>, rawArguments: string): GateOutcome {
  const described = String(args.item ?? "").trim();
  const itemName = (name === "reveal_item" && typeof args.revealedName === "string" && args.revealedName.trim()) || described;
  if (!itemName || args.unidentified === true) {
    return { args: rawArguments };
  }
  // A revealed item keeps the tags it was granted with.
  const equipment = name === "reveal_item" ? (ctx.sheetsById.get(String(args.characterId ?? ""))?.equipment ?? []) : [];
  const carried = equipment[unrevealedLine(equipment, described)];
  const srdName = typeof args.srdName === "string" && args.srdName.trim() ? args.srdName.trim() : undefined;
  const spell = typeof args.spell === "string" ? args.spell : undefined;
  const tags = sentItemTags({ name: itemName, srdName }, Array.isArray(args.tags) ? listedItemTags(args.tags) : undefined, spell) ?? carried?.tags;
  const item = { name: itemName, ...(srdName ? { srdName } : {}), ...(tags ? { tags } : {}) };
  // purchase takes no tags or spell, and handle_item no spell: what they
  // cannot say, grant_item does (and modify_gold pays for it).
  const grants = name === "grant_item" || name === "reveal_item";
  const viaGrant = name === "purchase" ? "grant_item and paid for with modify_gold" : "grant_item";
  if (!tags && !srdName && !itemRow(item) && !isTableGearName(ctx.campaign.id, itemName)) {
    const loot = name === "purchase" ? `; loot no list has is granted with ${viaGrant}, tags naming what it is` : ", or, for loot no list has, tags naming what it is (tags [] when none fits)";
    const scroll = grants ? "; a spell scroll names its spell in spell" : `; a spell scroll is granted with ${viaGrant}, its spell in spell`;
    return {
      result: {
        error: `${name}: send it again with srdName, the SRD or pack item "${itemName}" is by its English name${loot}${scroll}. No item the game knows has that name. Nothing changed yet.`,
        retry: true,
      },
    };
  }
  // A healing potion heals by its kind, which only its row says: no tag
  // names a tier.
  if (hasItemTag(item, "healing_potion") && !itemRow(item)?.potion) {
    return {
      result: {
        error: `${name}: send it again with srdName naming the potion's kind (${HEALING_POTIONS.join(", ")}): its kind sets what it heals. Nothing changed yet.`,
        retry: true,
      },
    };
  }
  if (hasItemTag(item, "scroll") && !spell?.trim()) {
    const how = grants ? "send it again with" : `grant it with ${viaGrant}, naming`;
    return {
      result: {
        error: `${name}: ${how} the spell "${itemName}" holds in spell, as the spell lists name it; a scroll the party cannot read yet is granted unidentified. Nothing changed yet.`,
        retry: true,
      },
    };
  }
  return { args: rawArguments };
}

// An advantage claimed with a reason but no advantageSource: asked whether
// the circumstance is one the server cannot see, rather than set aside, so a
// ruling is never lost to the field left out. A claim from a source the
// server decides, or with no reason, is set aside where it is read
// (pc-attack-options.ts claimedAdvantage).
function claimSource(args: Record<string, unknown>, rawArguments: string): GateOutcome {
  const reason = typeof args.advantageReason === "string" ? args.advantageReason.trim() : "";
  if ((args.advantage === "advantage" || args.advantage === "disadvantage") && reason && args.advantageSource === undefined) {
    return {
      result: {
        error: `The ${args.advantage} claimed for "${reason.slice(0, 80)}" names no advantageSource. Send advantageSource 'other' if it is a circumstance of the fiction the server cannot see, or leave the ${args.advantage} out: the server applies conditions, cover, light, range, Help, flanking, spells, Inspiration and features itself. Nothing was rolled.`,
        retry: true,
      },
    };
  }
  return { args: rawArguments };
}

function targetOf(name: string, args: Record<string, unknown>): string {
  return String((name === "damage_enemy" ? args.enemyId : name === "split_damage" ? "" : args.characterId) ?? "");
}

// The rolls an AI GM asked for on this turn that have paid for nothing yet,
// oldest first: the only rolls either gate below takes. The turn keeps both
// lists (src/lib/db/dm-turns.ts askedRollIds, paidRollIds). The door a roll
// goes on record through marks one as asked for only where a site says the
// GM's own request_roll made it (src/lib/dm/roll-record.ts), so the dice of
// every other call (a blow the engine landed, a hazard's, the dice a landing
// threw) are on neither list and pay for nothing here, with no stamp put on
// them afterwards. The gates used to take any roll on the turn that nothing
// had stamped, and a site whose dice went unstamped paid for a number the
// model made up (#1006, #1061).
function askedUnpaid(turn: DmTurn): StoredRoll[] {
  const paid = new Set(turn.paidRollIds);
  return turn.askedRollIds.flatMap((id) => (paid.has(id) ? [] : (getRoll(id) ?? [])));
}

// Damage or healing: dice the server rolls now, or (from the model) a total
// it asked the server to roll this turn that has paid for nothing yet.
function number(ctx: GateContext, args: Record<string, unknown>, what: "damage" | "healing", targetId: string): GateOutcome {
  const dice = typeof args.dice === "string" ? args.dice.replace(/\s+/g, "") : "";
  if (dice) {
    // Dice, not a number dressed as them: at least one die to roll.
    if (!isValidExpression(dice) || !/\d*d\d+/i.test(dice)) {
      return { result: { error: `"${dice}" is not dice the server can roll; send it like "2d6+3".`, retry: true } };
    }
    const sheet = ctx.sheetsById.get(targetId);
    const said = (value: unknown) => (typeof value === "string" ? value.trim() : "");
    // Whom it lands on, as the card says it: a pet by its own name, and a
    // creature by the name the table may read now (a hidden one stays so).
    const foe = sheet ? null : getEnemy(targetId);
    const whom = said(args.petName) || sheet?.name || (foe ? shownName(foe.encounterId, foe.id, foe.displayName) : "the target");
    // The model's own dice for harm with no creature behind it: the roll of
    // the spell it is, else of the words it gave for it, else the GM's own
    // dice. The hit's record is built from the same two arguments
    // (mutations.ts apply_damage). Whoever it lands on is its target.
    // Healing is no attack and no damage: it names no roller.
    const rolled =
      what === "damage"
        ? sourceDamage(ctx.campaign, ctx.turn, harmSource(said(args.spell), said(args.reason), UNNAMED_HARM), { characterId: sheet ? sheet.id : null, names: [whom] }, { dice, type: said(args.type) || undefined })
        : rollCard(ctx.campaign, ctx.turn, sheet ? sheet.id : null, "custom", rollAgainst(said(args.reason).slice(0, 60) || "Healing", whom), dice, null);
    // Dice the gate rolls are no roll the model asked for with request_roll:
    // the call let through below applies them, and the same total sent bare
    // afterwards finds nothing to pay for it.
    const { dice: _sent, ...rest } = args;
    void _sent;
    // SRD 5.1 gives damage no floor: dice a penalty brings to 0 or less deal
    // nothing, as every attack door and the GM's targeted roll leave it
    // (enemy-blow.ts applyBlow). The total was floored at 1, so a "1d4-2"
    // that rolled a 1 took a hit point. The damage tools take no 0, so
    // nothing is sent to them.
    if (what === "damage" && rolled.total <= 0) {
      return { result: { ok: true, damageApplied: 0, note: `The dice came to ${rolled.total}: no damage. Nothing was applied; narrate the blow doing no harm.` } };
    }
    return { args: JSON.stringify({ ...rest, amount: Math.max(1, rolled.total) }) };
  }
  const amount = Number(args.amount);
  if (!(amount >= 1) || ctx.turn.actor !== "ai") {
    return { args: JSON.stringify(args) };
  }
  const kinds = what === "damage" ? ["damage"] : ["damage", "custom"];
  // Paid, not landed: the call let through below is what lands it. The
  // payment is taken on the turn's stored row, so a roll another copy of
  // this turn has spent since this one was read pays for nothing here.
  const rolled = askedUnpaid(ctx.turn).find((roll) => kinds.includes(roll.kind) && roll.total === amount && payOnTurn(ctx.turn, roll.id));
  if (!rolled) {
    return { result: AI_NUMBER_REFUSAL(what) };
  }
  return { args: JSON.stringify(args) };
}

// A binding condition on a character: their save first, the condition only
// on a failure (it then ends on the same save at the end of their turns, or
// when the rounds sent run out).
function bind(ctx: GateContext, args: Record<string, unknown>): GateOutcome {
  const wanted = canonicalCondition(String(args.condition ?? ""));
  const sheet = ctx.sheetsById.get(String(args.characterId ?? ""));
  if (!sheet || !bindsCreature(wanted)) {
    return { args: JSON.stringify(args) };
  }
  const ability = String(args.saveAbility ?? "").slice(0, 3).toLowerCase();
  const dc = Number(args.saveDc);
  if (!SAVE_ABILITIES.has(ability) || !(dc >= 1)) {
    return { result: AI_BIND_REFUSAL(sheet.name, wanted) };
  }
  // Whether the binding is magic, when a trait of theirs answers it (Gnome
  // Cunning): asked for rather than guessed (src/lib/dm/roll-about.ts).
  const against = listedAgainst(wanted);
  const gaps = unnamedRollKeys({ roll: "save", ability, against, magical: args.magical === undefined ? undefined : args.magical === true }, heldSaveTraits(sheet));
  if (gaps.some((gap) => gap.field === "magical")) {
    return { result: { error: `${sheet.name} holds a trait that answers a save against magic. Name magical: true or false, as the fiction is, and send the call again. Nothing changed.`, retry: true } };
  }
  const save = rollCharacterSave(ctx.campaign, ctx.turn, sheet, ability as SaveAbility, dc, `${ability.toUpperCase()} save against being ${wanted}`, { against, ...(args.magical === true ? { magical: true } : {}) });
  if (save.success) {
    return {
      result: { ok: true, name: sheet.name, saved: true, note: `${sheet.name} makes the ${ability.toUpperCase()} save (${save.total} vs DC ${dc}): no ${wanted}.` },
    };
  }
  return { args: JSON.stringify(args) };
}

// The model does not lift a binding condition the engine keeps.
function lift(ctx: GateContext, args: Record<string, unknown>, rawArguments: string): GateOutcome {
  const sheet = ctx.sheetsById.get(String(args.characterId ?? ""));
  const wanted = canonicalCondition(String(args.condition ?? ""));
  if (!sheet || !bindsCreature(wanted)) {
    return { args: rawArguments };
  }
  const held = sheet.conditions.find((entry) => canonicalCondition(entry) === wanted);
  const kept = held && instancesOf((sheet.conditionMeta as ConditionMetaMap)[held]).some(engineKept);
  if (kept && escapeRolled(ctx, sheet, wanted)) {
    return { args: rawArguments };
  }
  return kept ? { result: AI_CLEAR_REFUSAL(sheet.name, wanted) } : { args: rawArguments };
}

// A trap's hold (a falling net) the server has already seen broken: the
// model asked for a check of the character's this turn that the trap's
// escape takes (Strength or Athletics for a net), it reached the DC, and it
// has paid for nothing yet. The model that rolls the check and then lifts
// the condition is doing what the trap's rule says, as take_action escape
// does in one call. A check another tool rolled is not one it asked for.
function escapeRolled(ctx: GateContext, sheet: CharacterSheet, condition: string): boolean {
  const hold = trapHoldOn(ctx.campaign, sheet);
  if (!hold || canonicalCondition(hold.condition) !== condition) {
    return false;
  }
  // What the trap's escape takes, read off the check's fields
  // (src/lib/roll-parts.ts), never off its words.
  const fits = (check: StoredRoll) => (hold.ability === "str" ? rollSkill(check, ["athletics"]) || rollAbility(check, ["str"]) : rollSkill(check, ["acrobatics"]) || rollAbility(check, ["dex"]));
  const roll = askedUnpaid(ctx.turn).find(
    (entry) =>
      entry.characterId === sheet.id &&
      (entry.kind === "skill_check" || entry.kind === "ability_check") &&
      fits(entry) &&
      entry.total >= hold.dc &&
      payOnTurn(ctx.turn, entry.id),
  );
  return Boolean(roll);
}
