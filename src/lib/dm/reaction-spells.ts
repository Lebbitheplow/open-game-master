// The reaction spells and the opportunity attack of use_reaction
// (src/lib/dm/reaction-tools.ts). A reaction spell is a cast through the one
// guard; Shield and Feather Fall then answer the attack or fall the engine
// kept (src/lib/dm/last-hit.ts), Hellish Rebuke resolves as cast_at_enemy
// does, and Absorb Elements resists the elemental hit it answers. An
// opportunity attack is the server's own on a battle map; off the map it is
// resolved here as one attack with the reaction.

import { warCasterOpportunity } from "@/lib/dm/ar-wbf-feat-warcaster";
import { warCasterPointer } from "@/lib/dm/ar-wbf-feat-warcaster-logic";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import type { Campaign } from "@/lib/db/campaigns";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { spellEngineName, spellFactsFor } from "@/lib/content";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { addSheetCondition } from "@/lib/dm/action-common";
import { acWithEffects } from "@/lib/dm/ac-effects";
import { handleCastAtEnemy } from "@/lib/dm/cast-tools";
import { removeConditions } from "@/lib/dm/condition-logic";
import { attackerFoeId, freshLastHit, hitIdOf, openHits, type LastHit, type SwingRecord } from "@/lib/dm/last-hit";
// For the reaction spells' slot spend; mutations never imports back.
import { applyDmMutation } from "@/lib/dm/mutations";
import { castingCost, checkCasting, wasteCasting, type Counter } from "@/lib/dm/casting-answered";
import { READIED } from "@/lib/dm/object-actions";
import { handlePcAttack } from "@/lib/dm/pc-attack";
import { allyOf, noFall, softenFall, spendReaction, type Ctx } from "@/lib/dm/reaction-tools";
import { settleHits } from "@/lib/dm/reaction-refund";
import type { ToolError, ToolResult } from "@/lib/dm/tool-errors";
import { swallowCoverError } from "@/lib/dm/swallow";
// The credits live in the database on the server (src/lib/db/item-cast-credits.ts).
import "@/lib/db/item-cast-credits";
import { takeItemCast } from "@/lib/srd/item-cast-credit";
import { spellHeldProblem } from "@/lib/dm/cast-rules";
import { findNamed, textKey } from "@/lib/language/text-logic";
import { openSaves } from "@/lib/dm/last-save";
import { gainPowerSurge } from "@/lib/dm/spell-damage-mark";

// ---- reaction spells ----

// Shield is cast as the hit lands: the cast guard asks the reaction gate with
// the spell's timing (src/lib/dm/reaction-kinds.ts), which judges a caster
// that hit dropped as they stood before it. Every reaction spell is cast
// here (the cast guard refuses one any other tool sends).
function castReactionSpell(ctx: Ctx, spell: string): Record<string, unknown> | ToolError {
  return applyDmMutation(
    ctx.campaign,
    ctx.turn.id,
    "use_spell_slot",
    JSON.stringify({
      characterId: ctx.sheet.id,
      spell,
      ...(ctx.args.level ? { level: ctx.args.level } : {}),
      via: "reaction",
      reason: `${spell} reaction`,
    }),
    ctx.sheets,
    ctx.sheetsById,
  ).result;
}

function spentLine(ctx: Ctx, cast: Record<string, unknown>): string {
  return `${ctx.sheet.name}'s reaction${
    typeof cast.slotLevel === "number" && !cast.fromItem ? ` and a level-${cast.slotLevel} slot are` : " is"
  } spent.`;
}

// What each reaction spell a card can play answers: the moment, in words, and
// whether the server has one open. By the spell the table's copy runs as.
const TRIGGERS: Array<{ spell: string; when: (name: string) => string; open: (campaignId: string, sheetId: string, targetEnemyId?: string) => boolean }> = [
  { spell: "Shield", when: (name) => `${name} is hit by an attack`, open: (campaignId, sheetId) => shieldAnswers(campaignId, sheetId).length > 0 },
  { spell: "Feather Fall", when: (name) => `${name} falls`, open: (campaignId, sheetId) => Boolean(freshLastHit(campaignId, sheetId, (hit) => hit.source === "fall")) },
  { spell: "Absorb Elements", when: (name) => `${name} takes acid, cold, fire, lightning or thunder damage`, open: (campaignId, sheetId) => Boolean(freshLastHit(campaignId, sheetId, absorbable)) },
  {
    spell: "Hellish Rebuke",
    when: (name) => `a creature damages ${name}`,
    open: (campaignId, sheetId, targetEnemyId) => damagedBy(campaignId, sheetId, targetEnemyId) !== null,
  },
];

// The creature whose damage to the caster Hellish Rebuke answers ("in response
// to being damaged by a creature"): an open hit that dealt some, or a save it
// forced that dealt some (a spell's failed save leaves no hit record:
// src/lib/dm/last-save.ts noteSaveDamage). The one named, when the call names one.
function damagedBy(campaignId: string, sheetId: string, named?: string): string | null {
  const hit = freshLastHit(campaignId, sheetId, (record) => attackerFoeId(record) !== null && record.swings.some((swing) => swing.hit && swing.raw > 0) && (!named || record.attacker.id === named));
  if (hit) return attackerFoeId(hit);
  const save = openSaves(campaignId).filter((record) => record.characterId === sheetId && (record.damage?.amount ?? 0) > 0 && (!named || record.forcer.id === named)).at(-1);
  return save?.forcer.id ?? null;
}

// Whether what this reaction spell answers has happened, for a card about to draw
// it out of a ring (intent-check.ts). Null when it has. A spell whose trigger the
// server cannot see (Counterspell names the spell it answers, and the rest are the
// GM's call) is no card's to play: the player says so in words.
export function reactionTriggerProblem(campaign: Campaign, sheet: CharacterSheet, spellName: string, args: { targetEnemyId?: string }): ToolError | null {
  const trigger = findNamed(TRIGGERS, spellEngineName(spellName, spellAuthorsFor(campaign)), (row) => [row.spell]);
  if (!trigger) {
    return { error: `${spellName} is cast when its trigger comes, and no card can name that: say it in your own words when it does. Nothing was spent.`, refused: "rules" };
  }
  return trigger.open(campaign.id, sheet.id, args.targetEnemyId)
    ? null
    : { error: `${spellName} is cast when ${trigger.when(sheet.name)}, and the server has no such thing this turn. Nothing was spent.`, refused: "rules" };
}

export function reactionSpell(ctx: Ctx, spellName: string): ToolResult {
  const { sheet, campaign } = ctx;
  // Which reaction it is: the published spell a table's workshop copy runs
  // as ("Iron Ward" running as Shield). The copy is cast under its own name.
  const name = textKey(spellEngineName(spellName, spellAuthorsFor(campaign)));
  // Whether they can cast it at all comes before what it answers: a caster
  // without the spell is told so, not sent to name its target first. A cast
  // an item just paid for (src/lib/srd/item-cast-credit.ts) needs no hold.
  const fromItem = takeItemCast(sheet.id, spellName, { dryRun: true });
  const unheld = fromItem ? null : spellHeldProblem(sheet, spellName, spellFactsFor(spellName, spellAuthorsFor(campaign)));
  if (unheld) {
    return { ...unheld, error: `${unheld.error} Nothing was spent.` };
  }

  // Hellish Rebuke answers the creature that damaged the caster with a DEX
  // save and fire, resolved as cast_at_enemy resolves it; the reaction is
  // spent here, as for every reaction spell.
  if (name === "hellish rebuke") {
    // The open hit that damaged them, by the creature named when one is.
    const named = ctx.args.targetEnemyId?.trim() || undefined;
    const attackerId = damagedBy(campaign.id, sheet.id, named);
    if (!attackerId) {
      return {
        error: `Hellish Rebuke is cast in response to being damaged by the creature, and the server has no damage to ${sheet.name} from it this turn. Nothing was spent.`,
        refused: "rules",
      };
    }
    const rebuke = handleCastAtEnemy(
      campaign,
      ctx.turn,
      JSON.stringify({
        characterId: sheet.id,
        targetEnemyId: attackerId,
        spell: spellName,
        saveAbility: "dex",
        halfOnSave: true,
        ...(ctx.args.level ? { level: ctx.args.level } : {}),
        reason: ctx.args.reason ?? "Hellish Rebuke",
      }),
      ctx.sheets,
      ctx.sheetsById,
      { asReaction: true },
    );
    if (typeof rebuke.error !== "string") {
      spendReaction(ctx);
    }
    return rebuke;
  }

  // Feather Fall saves a creature from a fall that has just landed.
  if (name === "feather fall") {
    const target = allyOf(ctx) ?? sheet;
    const record = freshLastHit(campaign.id, target.id, (hit) => hit.source === "fall");
    if (!record) {
      return noFall(target.name, "Feather Fall");
    }
    // Not across a swallower's wall (swallow.ts).
    const walled = swallowCoverError(sheet.id, target.id);
    if (walled) {
      return walled;
    }
    const cast = castReactionSpell(ctx, spellName);
    if ("error" in cast) {
      return cast;
    }
    spendReaction(ctx);
    const settled = softenFall(ctx, target, "feather fall", "all");
    return {
      ok: true,
      reaction: "Feather Fall",
      spent: spentLine(ctx, cast),
      applied: `${target.name} drifts down and lands on their feet: ${settled?.given ?? 0} hit points of falling damage come back. HP ${settled?.hp ?? ""}.`,
    };
  }

  // Shield answers a hit or Magic Missile; Absorb Elements an acid, cold,
  // fire, lightning or thunder hit. Without the trigger nothing is spent.
  if (name === "shield") {
    if (!shieldAnswers(campaign.id, sheet.id).length) {
      return {
        error: `Shield is cast when ${sheet.name} is hit by an attack (or targeted by Magic Missile), and the server has no hit on them this turn to answer. Nothing was spent.`,
        refused: "rules",
      };
    }
  }
  if (name === "absorb elements") {
    const record = freshLastHit(campaign.id, sheet.id, absorbable);
    if (!record) {
      return {
        error: `Absorb Elements is cast when ${sheet.name} takes acid, cold, fire, lightning or thunder damage, and the server has no such damage to them this turn to answer. Nothing was spent.`,
        refused: "rules",
      };
    }
  }
  // A reaction spell the server has no rule for still needs its trigger
  // named, and is said to be the spell's text.
  const known = ["counterspell", "shield", "absorb elements"];
  if (!known.includes(name) && !(ctx.args.reason ?? "").trim()) {
    return {
      error: `${spellName} is a reaction: name what triggered it in reason (the creature and what it did). The server has no rule of its own for it, so it is cast as the spell's text. Nothing was spent.`,
      retry: true,
    };
  }

  // Counterspell's own refusals come before its slot.
  let counter: Counter | null = null;
  if (name === "counterspell") {
    const checked = checkCasting({ encounter: ctx.encounter, sheet: ctx.sheet, targetEnemyId: ctx.args.targetEnemyId, spell: ctx.args.spell });
    if ("error" in checked) {
      return checked;
    }
    counter = checked;
  }
  const cast = castReactionSpell(ctx, spellName);
  if ("error" in cast) {
    return cast;
  }
  spendReaction(ctx);
  const spent = spentLine(ctx, cast);

  // Shield: +5 AC until the start of their next turn, against the
  // triggering attack too (SRD 5.1). Every swing the higher AC turns away
  // becomes a miss (a natural 20 still hits), in the hit it answers and in
  // every open hit on them after it: those attacks were made against the
  // shielded AC (issue 685). Later attacks meet it through "shielded".
  if (name === "shield") {
    const covered = shieldAnswers(campaign.id, sheet.id);
    addSheetCondition(campaign, sheet, "shielded", { untilTurnOf: sheet.id });
    // Every hit it covers is re-checked together, so a later blow that now
    // misses gives back all it did and an earlier one undone turns the later
    // ones back into hit point damage (reaction-refund.ts settleHits).
    // Each swing keeps the shielded AC it met, so a hit read again later (a
    // blow that now finds her standing, Cutting Words after it) is read
    // against it. A Magic Missile deals her nothing at all.
    const answers = covered.map((record) => ({
      record,
      corrected: record.swings.map((swing) =>
        record.source === "missile"
          ? { ...swing, hit: false, raw: 0 }
          : swing.hit && swing.natural !== 20 && swing.total < swing.vsAc + 5
            ? { ...swing, vsAc: swing.vsAc + 5, hit: false, raw: 0 }
            : { ...swing, vsAc: swing.vsAc + 5 },
      ),
    }));
    const settled = answers.length ? settleHits(campaign, ctx.turn.id, answers, "shield", ctx.sheets, ctx.sheetsById) : null;
    let answered = answers
      .map(({ record, corrected }) => {
        const turned = corrected.filter((swing, at) => record.swings[at].hit && !swing.hit).length;
        return record.source === "missile"
          ? ` ${record.attacker.name}'s ${record.attack} deals ${sheet.name} no damage.`
          : turned
            ? ` Against ${record.attacker.name}'s ${record.attack}, ${turned} hit${turned === 1 ? "" : "s"} now miss${turned === 1 ? "es" : ""}.`
            : ` ${record.attacker.name}'s ${record.attack} still hits the higher AC.`;
      })
      .join("");
    if (settled) {
      answered += ` ${settled.given} hit points come back. HP ${settled.hp}.${settled.notes.length ? ` ${settled.notes.join(" ")}` : ""}`;
    }
    const updated = getSheetById(sheet.id) ?? sheet;
    return {
      ok: true,
      reaction: "Shield",
      spent,
      applied: `Shield: +5 AC until the start of their next turn; their AC is now ${acWithEffects(campaign.id, updated)}. The server applied it.${answered}`,
    };
  }

  // Absorb Elements: resistance to the triggering type until the start of
  // their next turn (the triggering damage too), and the first melee hit on
  // their next turn deals 1d6 of it per slot level (condition-effects.ts
  // absorbed strike). The resistance meets every open hit of that type from
  // the trigger on, as Shield's +5 does (those blows landed after it in the
  // fight), and only that type's part of a blow of several (a bite's fire,
  // not its teeth): it once halved the trigger alone, and the whole of a
  // mixed blow or none of it. A character who resists the type already gains
  // nothing more, which the replay reads off their defenses.
  if (name === "absorb elements") {
    const trigger = freshLastHit(campaign.id, sheet.id, absorbable, "earliest")!;
    const type = absorbedType(trigger)!;
    const slot = typeof cast.slotLevel === "number" ? cast.slotLevel : 1;
    let applied = `Absorb Elements: resistance to ${type} until the start of ${sheet.name}'s next turn, and the first melee hit on their next turn deals ${slot}d6 ${type} more.`;
    const open = openHits(campaign.id, sheet.id);
    const from = open.findIndex((hit) => hitIdOf(hit) === hitIdOf(trigger));
    const answers = open
      .slice(Math.max(0, from))
      .filter((hit) => !hit.answered.includes("absorb elements") && hit.swings.some((swing) => dealsType(hit, swing, type)))
      .map((record) => ({
        record,
        corrected: record.swings.map((swing) => (dealsType(record, swing, type) ? { ...swing, resists: [...(swing.resists ?? []), type] } : swing)),
      }));
    if (answers.length) {
      const settled = settleHits(campaign, ctx.turn.id, answers, "absorb elements", ctx.sheets, ctx.sheetsById);
      applied += ` ${settled.given} hit points come back. HP ${settled.hp}.`;
    }
    const now = getSheetById(sheet.id) ?? sheet;
    addSheetCondition(campaign, now, `absorb elements (${type})`, { untilTurnOf: sheet.id }, "Absorb Elements");
    addSheetCondition(campaign, getSheetById(sheet.id) ?? now, `absorbed strike (${slot}d6 ${type})`, { untilTurnEndOf: sheet.id }, "Absorb Elements");
    return { ok: true, reaction: "Absorb Elements", spent, applied };
  }

  if (name === "counterspell" && counter) {
    return finishCounterspell(ctx, counter, cast, spent);
  }
  return {
    ok: true,
    reaction: spellName,
    spent,
    ...(cast.droppedConcentration ? { droppedConcentration: cast.droppedConcentration } : {}),
    note: `${spellName} is cast; its effect is the spell's text.`,
  };
}

// The hits Shield answers: the one it is cast against (the hit its player
// named, else the earliest still open, whose +5 then covers the most), and
// every open hit on them after it. Empty when none hit them.
function shieldAnswers(campaignId: string, sheetId: string): LastHit[] {
  const fits = (hit: LastHit) => (hit.source === "attack" || hit.source === "missile") && !hit.answered.includes("shield") && hit.swings.some((swing) => swing.hit);
  const first = freshLastHit(campaignId, sheetId, fits, "earliest");
  if (!first) {
    return [];
  }
  const open = openHits(campaignId, sheetId);
  const from = open.findIndex((hit) => hitIdOf(hit) === hitIdOf(first));
  return open.slice(Math.max(0, from)).filter(fits);
}

function absorbable(record: LastHit): boolean {
  return Boolean(absorbedType(record)) && !record.answered.includes("absorb elements");
}

// The damage types a swing dealt: each part of a blow of several, else its
// own type (the record's when it names none).
function typesOf(record: LastHit, swing: SwingRecord): string[] {
  return swing.parts?.length ? swing.parts.map((part) => part.type.toLowerCase()) : (swing.type || record.type).toLowerCase().split("/");
}

// Whether a swing that landed dealt damage of this type.
function dealsType(record: LastHit, swing: SwingRecord, type: string): boolean {
  return swing.hit && swing.raw > 0 && typesOf(record, swing).includes(type);
}

// The elemental type a recorded hit dealt, for Absorb Elements: the first of
// acid, cold, fire, lightning or thunder among the swings that landed, a
// blow of several types part by part.
function absorbedType(record: LastHit | null): string | null {
  if (!record) {
    return null;
  }
  const types = record.swings.filter((swing) => swing.hit && swing.raw > 0).flatMap((swing) => typesOf(record, swing));
  return types.find((entry) => /^(acid|cold|fire|lightning|thunder)$/.test(entry)) ?? null;
}

// ---- Counterspell ----

// The ability Counterspell's check is made with: the spellcasting ability of
// the class it is cast from (SRD 5.1: sorcerer, warlock, wizard), the
// sheet's own when it is one of them.
const COUNTERSPELL_CLASSES: Record<string, string> = { sorcerer: "cha", warlock: "cha", wizard: "int" };
function counterspellAbility(sheet: Ctx["sheet"]): string {
  const primary = sheet.spellcasting?.ability ?? "int";
  const holders = [sheet.class, ...(sheet.classes ?? []).map((entry) => entry.id)]
    .map((id) => COUNTERSPELL_CLASSES[(id ?? "").toLowerCase()])
    .filter((ability): ability is string => Boolean(ability));
  return !holders.length || holders.includes(primary) ? primary : holders[0];
}

// A spell of the slot's level or lower fails; a higher one fails on an
// ability check with the caster's spellcasting ability, DC 10 + its level.
// A countered spell is spent all the same: the creature's slot or use goes,
// and so does the action, bonus action, reaction or legendary cantrip it was
// cast with, so the engine refuses the cast that would have followed.
function finishCounterspell(
  ctx: Ctx,
  counter: Counter,
  cast: Record<string, unknown>,
  spent: string,
): Record<string, unknown> {
  const slot = typeof cast.slotLevel === "number" ? cast.slotLevel : 3;
  let countered = counter.level <= slot;
  let check: string | undefined;
  if (!countered) {
    const dc = 10 + counter.level;
    const ability = counterspellAbility(ctx.sheet);
    const rolled = rollCharacterCheck(ctx.campaign, ctx.sheet, { ability: ability as "int", spell: "Counterspell" }, `${ctx.sheet.name}: Counterspell against ${counter.spell}`);
    if (rolled.rollId) {
      ctx.turn.rollIds.push(rolled.rollId);
    }
    countered = !rolled.autoFailed && rolled.total >= dc;
    check = `${ability.toUpperCase()} check ${rolled.total} against DC ${dc}`;
  }
  if (countered) {
    wasteCasting(ctx.campaign.id, counter);
  }
  const surge = countered ? gainPowerSurge(ctx.campaign.id, ctx.sheet.id) : null;
  const paid = castingCost(counter);
  return {
    ok: true,
    reaction: "Counterspell",
    spent,
    ...(check ? { check } : {}),
    ...(surge ? { powerSurge: surge } : {}),
    countered,
    applied: countered
      ? `${counter.enemy.displayName}'s ${counter.spell} fails: the ${counter.level ? `level-${counter.level} slot` : "casting"} and ${paid} are spent, and the server will refuse the cast. Do not resolve the spell.`
      : `${counter.enemy.displayName}'s ${counter.spell} goes ahead; resolve it as it is cast.`,
  };
}

// ---- opportunity attacks ----

export function opportunity(ctx: Ctx): ToolResult {
  const { campaign, encounter, sheet, args } = ctx;
  if (!encounter) {
    return { error: "Opportunity attacks happen in a fight; there is no active encounter.", refused: "rules" };
  }
  if (getBattleMapForEncounter(encounter.id)) {
    return {
      error: `On the battle map the server rolls opportunity attacks itself the moment an enemy leaves ${sheet.name}'s reach (and reports them on the move). Nothing was spent; do not call pc_attack for one either.${warCasterPointer(sheet)}`,
      retry: true,
    };
  }
  if (!args.targetEnemyId) {
    return {
      error: "Off the battle map, an opportunity attack needs the enemy leaving the character's reach: pass its targetEnemyId. Nothing was spent.",
      retry: true,
    };
  }
  // War Caster: the spell they named, cast in the attack's place
  // (src/lib/dm/ar-wbf-feat-warcaster.ts).
  const foe = resolveTargetFoe(campaign.id, encounter, args.targetEnemyId);
  const cast = foe ? warCasterOpportunity({ campaign, encounter, sheet, enemy: foe, at: null, reactionKey: sheet.id, turn: ctx.turn }) : null;
  if (cast) {
    return { ...cast.result, reaction: "Opportunity attack", warCaster: cast.note };
  }
  // One melee attack with the reaction, through pc_attack's own rules. The
  // readied mark is what lets the off-turn attack through; the attack
  // spends it and the reaction.
  addSheetCondition(campaign, sheet, READIED, { untilTurnOf: sheet.id }, "opportunity attack");
  const result = handlePcAttack(
    campaign,
    ctx.turn,
    JSON.stringify({ characterId: sheet.id, targetEnemyId: args.targetEnemyId }),
    ctx.sheets,
    ctx.sheetsById,
    new Set(),
    null,
  );
  const after = getSheetById(sheet.id);
  if (after?.conditions.some((entry) => entry.toLowerCase() === READIED)) {
    const cleared = removeConditions(after.conditions, after.conditionMeta, [READIED]);
    patchSheet(after.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  }
  return "error" in result ? result : { ...result, reaction: "Opportunity attack" };
}

