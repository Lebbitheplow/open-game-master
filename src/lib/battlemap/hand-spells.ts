// Spell and class-feature cards for the Hand (docs/visual-overhaul-plan.md
// 5.2): what a prepared spell or a limited-use feature costs, rolls and
// spends, read from the same tables the cast and use_resource tools read.
import { BEST_EFFORT_NOTE, BEST_EFFORT_SHORT } from "@/lib/content/reading-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { bonusCastOf, castComponents, casterStateProblem, grantCastsFree, grantedCastOf, materialPlan, silenceRefusal, slotPlan, turnCharge } from "@/lib/dm/cast-rules";
import { healAdditions, healModifier } from "@/lib/dm/heal-bonus";
import { spellAttackLines, toHitWords } from "@/lib/battlemap/hand-attack-lines";
import { freeCastResourceId, isFreeCastResource } from "@/lib/srd/feat-spells";
import { innateSpellsFor, RACIAL_COUNTER_PREFIX } from "@/lib/srd/racial-grants";
import { grantUses } from "@/lib/srd/granted-casts";
import { computeSheetDerived, spellAttackFor, spellSaveDcFor } from "@/lib/srd";
import { counterSpendCards, pickLabel, playedAsSpendCard } from "@/lib/battlemap/hand-subclass";
import { authoredSpendFor, gateHolds } from "@/lib/srd/authored-effects";
import { nameChoice } from "@/lib/srd/feature-names";
import { affinityCastType } from "@/lib/srd/dragon-ancestor";
import { heldAtWill, resourceDef, resourceLevel, type ResourceDef } from "@/lib/srd/class-resources";
import { psionicOptions } from "@/lib/dm/option-costs";
import { ACTION_SURGED, WEAPON_HIT } from "@/lib/dm/action-budget";
import { AFTER_ROLL_COUNTERS } from "@/lib/dm/after-roll-logic";
import { BONUS_ATTACK_COUNTERS } from "@/lib/dm/feature-bonus-attacks";
import { HIT_ANSWER_COUNTERS } from "@/lib/dm/reaction-kinds";
import { reactionSpending, TRIGGERED_COUNTERS } from "@/lib/srd/trigger-table";
import { waitsForTrigger } from "@/lib/battlemap/hand-react-triggers";
import { isMeleeSpellAttack } from "@/lib/srd/melee-spell";
import { bundledSpellFacts, bundledSpellSchool, type CastingTime, type SpellRange } from "@/lib/srd/spell-facts";
import { aoeSpendFor } from "@/lib/srd/aoe-spend";
import { counterCost, counterGate, counterSaveDc } from "@/lib/srd/counter-rules";
import { inFightOf, polymorphChoice, wildShapeChoice } from "@/lib/battlemap/hand-counters";
import { counterCastsHeld } from "@/lib/srd/counter-casts";
import type { CombatRiders } from "@/lib/srd/feature-effects";
import { authoredSpellRow, castShares, parseSpellMech, spellMechFor, type SpellMech } from "@/lib/srd/spell-mechanics";
import { baseHealingDice, scaledSpellDice } from "@/lib/srd/spell-scaling";
import { mechSpellDamage } from "@/lib/srd/spell-dice";
import { bakedSpellMech } from "@/lib/content/baked-spells";
import { allSpellNames } from "@/lib/srd/spell-lists";
import { areaFor, blastAreaFor } from "@/lib/battlemap/hand-area";
import { summonPick } from "@/lib/battlemap/hand-summon";
import {
  SAVE_LABEL,
  addFlat,
  budgetOf,
  costGate,
  feet,
  gated,
  lowestSlot,
  primaryClass,
  slotLine,
  standingGate,
  type Gate,
  type HandCard,
  type HandChoice,
  type HandCardType,
  type HandCost,
  type HandOptions,
  type HandShares,
  type HandTarget,
  type HandTurn,
  type SpellFact,
} from "@/lib/battlemap/hand-core";
import { splitDamageExpression } from "@/lib/dm/aoe-parts";
import { spellDamageRiders, type SpellDamageRiders } from "@/lib/srd/spell-damage-riders";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { StoredSpell } from "@/lib/srd/spell-storing";
import { compareNames, textKey } from "@/lib/language/text-logic";
import { forPlayers } from "@/lib/language/player-text";

// ---- spells ----

export const ringCardName = (spell: string) => `Ring: ${spell}`;

export function spellNames(sheet: CharacterSheet): string[] {
  const casting = sheet.spellcasting;
  // The spells the race and its chosen option give (issue #833): a
  // tiefling fighter's hellish rebuke, a Topaz ancestry's misty step. They
  // sit on no class list, and a character with no Spellcasting casts them
  // too.
  const racial = innateSpellsFor(sheet.race, sheet.level, undefined, { features: sheet.features }).map((spell) => spell.name);
  const all = [
    ...(casting ? allSpellNames(casting) : []),
    ...(casting?.casters ?? []).flatMap((caster) => allSpellNames(caster)),
    ...racial,
    // A subclass counter's free spell (Star Map's guiding bolt), on no list.
    ...counterCastsHeld(sheet.features).map((entry) => entry.spell),
  ];
  const seen = new Set<string>();
  return all.filter((name) => {
    const key = textKey(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// The bundled facts in the words a pack's row uses, so a table without the
// pack deals the same card the pack would (and the cast guard, which reads
// these facts, would accept).
function castingText(time: CastingTime): string {
  if (typeof time === "number") return `${time} minute${time === 1 ? "" : "s"}`;
  return time === "bonus" ? "1 bonus action" : time === "reaction" ? "1 reaction" : "1 action";
}

function rangeText(range: SpellRange): string {
  if (range.kind === "feet") return `${range.feet} feet`;
  if (range.kind === "self") return "Self";
  return range.kind === "unknown" ? "" : range.kind.replace(/^./, (c) => c.toUpperCase());
}

export function factFor(name: string, options: HandOptions): SpellFact | null {
  const fetched = options.spells?.[textKey(name)];
  if (fetched) return fetched;
  // No pack: the authored rows' prose, and the bundled facts' casting time,
  // range and concentration. Every spell used to read as one action here,
  // so Shield and Counterspell were dealt as actions and Misty Step's cost
  // rested on the cast guard alone.
  const row = authoredSpellRow(name);
  const facts = bundledSpellFacts(name);
  if (!row && !facts) return null;
  return {
    level: facts?.level ?? row?.level ?? 0,
    school: "",
    castingTime: facts ? castingText(facts.castingTime) : "1 action",
    range: facts ? rangeText(facts.range) : "",
    desc: row?.desc ?? "",
    higherLevel: row?.higher_level ?? "",
    concentration: facts?.concentration ?? Boolean(row?.concentration),
  };
}

const title = (word: string) => word.replace(/^./, (c) => c.toUpperCase());

// Bestow Curse's nine curses, in the words a player picks from.
const CURSE_LABELS: Record<string, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
  attacks: "Its attacks on you",
  will: "Its will",
  necrotic: "Necrotic wounds",
};

// The one pick a spell's row asks the caster to make, as the engine names it
// (src/lib/srd/spell-mech-types.ts): a condition's variants (Blindness/
// Deafness, Eyebite, Bestow Curse), a word's choices (Command), Heat Metal
// on worn armor, the condition a restoration ends, a buff's form
// (Enlarge/Reduce). The value is what cast_at_enemy's `condition` or
// cast_buff's `variant` reads (src/lib/dm/spell-riders.ts chosenCondition).
export function spellChoice(mech: SpellMech): HandChoice | undefined {
  const condition = mech.condition;
  if (condition?.variants && condition.variants.length > 1) {
    return {
      arg: "condition",
      label: "Choose",
      options: condition.variants.map((variant) => {
        const inner = /\(([^)]+)\)$/.exec(variant)?.[1];
        return inner
          ? { value: inner, label: CURSE_LABELS[inner] ?? title(inner) }
          : { value: variant, label: title(variant) };
      }),
    };
  }
  if (condition?.choices && Object.keys(condition.choices).length) {
    return {
      arg: "condition",
      label: "The word",
      options: Object.entries(condition.choices).map(([word, adds]) => ({ value: word, label: title(word), note: adds.join(", ") })),
    };
  }
  if (mech.riders?.gripSave) {
    return {
      arg: "condition",
      label: "The metal",
      options: [
        { value: "", label: "A held object" },
        { value: "armor", label: "Worn armor" },
      ],
      fallback: "",
    };
  }
  if (mech.cures && !mech.cures.all && mech.cures.conditions.length > 1) {
    return {
      arg: "variant",
      label: "Ends",
      options: mech.cures.conditions.map((entry) => ({ value: entry, label: entry === "cursed" ? "A curse" : title(entry) })),
    };
  }
  if (mech.buff?.variants && mech.buff.variants.length > 1) {
    return { arg: "variant", label: "Choose", options: mech.buff.variants.map((variant) => ({ value: variant, label: title(variant) })) };
  }
  return undefined;
}

export function castingCost(castingTime: string): HandCost | null {
  const text = castingTime.toLowerCase();
  if (text.includes("bonus")) return "bonus";
  if (text.includes("reaction")) return "reaction";
  // Minutes and hours do not fit in a turn, so the spell stays off the hand.
  return /^1 action\b/.test(text.trim()) || text.trim() === "" ? "action" : null;
}

// How many darts, rays, beams or creatures one casting holds at this slot
// and caster level, when more than one (castShares, the count the cast
// tools hold the casting to).
function spellShares(mech: SpellMech, spellLevel: number, slotLevel: number | null, casterLevel: number): HandShares | null {
  if (!mech.darts && !mech.attacks && !mech.targets) return null;
  const count = castShares(mech, { spellLevel, slotLevel, casterLevel });
  if (count < 2) return null;
  if (mech.darts) return { count, unit: "dart", stack: true };
  if (mech.attacks) return { count, unit: mech.attacks.byCasterLevel ? "beam" : "ray", stack: true };
  return { count, unit: "creature", stack: false };
}

// A spell cast out of a Ring of Spell Storing (hand-ring.ts): its own level and
// numbers, and the ring's gates in place of the caster's. `holds`: played now it
// only begins a casting held across turns, so it aims at nothing yet. `free`: that
// casting is done, and this card resolves it. `item`: any other item's card
// (hand-items.ts), which says what it spends, and costs what use_item charges
// whatever the spell's casting time.
export type StoredCard = {
  ring: string;
  entry: Pick<StoredSpell, "spell" | "level" | "saveDc" | "attackBonus" | "abilityMod">;
  holds: boolean;
  free: boolean;
  gates: Gate[];
  item?: { id: string; name: string; cost: HandCost; resource: string; note: string };
  fromItem: NonNullable<HandCard["fromItem"]>;
};

// The dice a card shows, with what they deal. A spell of two damage types
// (Ice Storm: 2d8 bludgeoning and 4d6 cold) names each beside its own dice,
// split as the engine splits them (aoe-parts.ts): the whole sum used to read
// as its first type, so Ice Storm's card never said cold. Dice the engine
// would not split (a flat bonus on the end) name both types after the sum.
// The caster's own additions sit beside the type they deal (Elemental
// Affinity's Charisma beside Ice Storm's cold), as the cast tools land them.
type CardBonus = Pick<SpellDamageRiders, "flat" | "flatSecond" | "dice" | "diceSecond">;
function typedDice(dice: string, mech: SpellMech, bonus?: CardBonus | null): string {
  const plus = (part: string, extra: string[], flat: number) => addFlat([part, ...extra].join("+"), flat);
  if (!mech.damageType) return dice;
  const parts = mech.secondType ? splitDamageExpression(dice, mech.secondType) : null;
  if (!parts) {
    const all = plus(dice, [...(bonus?.dice ?? []), ...(bonus?.diceSecond ?? [])], (bonus?.flat ?? 0) + (bonus?.flatSecond ?? 0));
    return mech.secondType ? `${all} ${mech.damageType} and ${mech.secondType}` : `${all} ${mech.damageType}`;
  }
  const [firstDice, secondDice] = parts;
  return `${plus(firstDice, bonus?.dice ?? [], bonus?.flat ?? 0)} ${mech.damageType} + ${plus(secondDice, bonus?.diceSecond ?? [], bonus?.flatSecond ?? 0)} ${mech.secondType}`;
}

export function spellCard(sheet: CharacterSheet, turn: HandTurn, riders: CombatRiders, name: string, fact: SpellFact, options: HandOptions = {}, stored?: StoredCard): HandCard | null {
  const blasts = options.blasts !== false;
  const cost = stored?.item?.cost ?? castingCost(fact.castingTime) ?? (stored ? "action" : null);
  if (!cost) return null;
  // The mechanics row the engine reads; the prose is parsed only for what the
  // card shows when no row exists (its target, its save). With no pack there
  // is no prose, and the engine reads the answers baked from the SRD rows, so
  // the card does too (Shocking Grasp stays a melee spell attack).
  // A workshop spell's own block first, then the published row of the name
  // or of the spell it runs as: the order the cast tools read them in.
  const engine = fact.runsAs ?? name;
  const row = fact.mech ?? spellMechFor([name, ...(fact.runsAs ? [fact.runsAs] : [])]);
  const mech: SpellMech =
    row ??
    (fact.desc ? parseSpellMech({ desc: fact.desc, higherLevel: fact.higherLevel }) : bakedSpellMech(name)) ??
    { resolution: "utility" };
  // Witch Bolt's beam while it holds: the card is its strike, with no slot and
  // no roll. Aimed anywhere else it is a new casting (src/lib/dm/intent-logic.ts).
  // A ring's card of that spell is always a new casting.
  const beam = !stored && mech.repeatDice && sheet.concentratingOn && textKey(sheet.concentratingOn) === textKey(name) ? mech.repeatDice : null;
  // A spell the race gives, or a feat's free cast, is cast without a slot
  // while a use is left, as the cast guard spends it (issue #833): the card
  // shows those uses rather than a slot it would not spend. A ring's spell
  // spends neither.
  const free = stored || beam || fact.level === 0 ? null : freeUseOf(sheet, name, fact.facts ?? bundledSpellFacts(name));
  const slot = !stored && fact.level > 0 && !beam && !free?.free ? lowestSlot(sheet, fact.level) : null;
  const slotLevel = stored?.entry.level ?? slot?.level;
  // The level the dice are rolled at: the ring's, the slot's, or the free
  // cast's own (Infernal Legacy's hellish rebuke at 2nd, 3d10).
  const castLevel = slotLevel ?? (free?.free ? free.castAt : undefined);
  const derived = computeSheetDerived(sheet);
  const scaled = scaledSpellDice({
    spellLevel: fact.level,
    desc: fact.desc,
    higherLevel: fact.higherLevel,
    casterLevel: sheet.level,
    slotLevel: castLevel,
  });
  // The dice the engine rolls (spellDamageFor reads the same rule): Web,
  // Entangle and Hypnotic Pattern deal none whatever their prose mentions.
  const rolled = mechSpellDamage({
    spell: name,
    mech: row,
    spellLevel: fact.level,
    casterLevel: sheet.level,
    slotLevel: castLevel,
    desc: fact.desc,
    higherLevel: fact.higherLevel,
  });
  let damage: string | null = beam ?? (mech.resolution === "heal" || mech.resolution === "buff" ? null : rolled?.dice ?? null);
  let heals = false;
  if (mech.resolution === "heal") {
    // upcastDamage reads a healing step too, so a higher slot heals more.
    const healing = scaled?.dice ?? baseHealingDice(fact.desc);
    heals = true;
    // The modifier and what the caster's features add, as the heal tool
    // rolls them (heal-bonus.ts): an item's spell heals with the modifier its
    // own DC implies, a ring's with its first caster's.
    const added = healAdditions(sheet, castLevel ?? fact.level, derived.abilityMods);
    const modifier = healModifier({
      dc: stored ? stored.entry.saveDc ?? null : spellSaveDcFor(sheet, name),
      proficiencyBonus: derived.proficiencyBonus,
      noModifier: mech.healNoModifier,
      abilityMod: stored && !stored.item ? stored.entry.abilityMod ?? 0 : undefined,
    });
    damage = healing ? addFlat([healing, ...added.dice].join("+"), modifier + added.flat) : null;
  }
  // Agonizing Blast and its kin ride one named cantrip.
  const rider = riders.cantripAbilityRiders.find((entry) => textKey(entry.spell) === textKey(name));
  if (rider && damage) {
    damage = addFlat(damage, derived.abilityMods[rider.ability as keyof typeof derived.abilityMods] ?? 0);
  }
  const toHit = mech.resolution === "attack" && !beam ? (stored ? stored.entry.attackBonus ?? null : spellAttackFor(sheet, name)) : null;
  // The engine's own facts (casting time, components, material cost, range)
  // for the engine's own gates below.
  const facts = fact.facts ?? bundledSpellFacts(name);
  const dc = mech.resolution === "save" && mech.save ? (stored ? stored.entry.saveDc ?? null : spellSaveDcFor(sheet, name)) : null;
  const save = dc !== null && mech.save ? { ability: SAVE_LABEL[mech.save] ?? mech.save.toUpperCase(), dc } : null;
  const type: HandCardType =
    mech.resolution === "heal" ? "mend" : mech.resolution === "buff" ? "ward" : mech.condition ? "control" : "spell";
  const target: HandTarget =
    mech.resolution === "heal"
      ? "ally"
      : mech.resolution === "buff"
        ? mech.buff?.target === "self" ? "self" : "ally"
        : mech.resolution === "attack" || mech.resolution === "save" || mech.resolution === "auto"
          ? "enemy"
          : "none";
  // Empowered Evocation, Elemental Affinity, a subclass die: what the cast
  // tools add to the spell's damage (spell-damage-riders.ts), so the card says
  // what lands. It said only the spell's own dice.
  const bonus = damage && !heals && !beam && mech.damageType
    ? spellDamageRiders(sheet, { school: fact.school || bundledSpellSchool(name), damageType: mech.damageType, secondType: mech.secondType, level: fact.level, classes: facts?.classes?.map((entry) => textKey(entry)) })
    : null;
  const typed = damage ? typedDice(damage, mech, bonus) : "";
  if (damage && bonus) {
    damage = addFlat([damage, ...bonus.dice, ...bonus.diceSecond].join("+"), bonus.flat + bonus.flatSecond);
  }
  // A spell attack carries what pc_attack adds to any attack its caster
  // makes (hand-attack-lines.ts): Bless's die on the roll, Hex's on the hit.
  const struck = toHit !== null ? spellAttackLines(sheet, toHit, isMeleeSpellAttack(engine, facts?.range.kind)) : null;
  if (struck?.onHit && damage) damage = `${damage}${struck.onHit}`;
  const dice = heals
    ? damage ? `heals ${damage}` : "heals"
    : save
      ? typed ? `${typed}, ${save.ability} save` : `${save.ability} save DC ${save.dc}`
      : (typed && struck?.onHit ? `${typed} ${struck.onHit.replace(/^\+/, "+ ")}` : typed) ||
        (mech.buff
          ? // A buff with an aura that hurts (Spirit Guardians) names the
            // engine's dice beside it; the card itself aims at no enemy.
            `${mech.buff.condition}${mech.resolution === "buff" && rolled ? `, ${typedDice(rolled.dice, mech)}` : ""}`
          : "");
  const roll =
    struck ? toHitWords(struck) : save ? (typed ? `DC ${save.dc}${mech.halfOnSave ? ", half on a save" : ""}` : "no attack") : "no roll";
  const notes: string[] = [...(struck?.notes ?? [])];
  if (beam) {
    notes.push("Beam connected: free at its target. Others: new casting, beam ends.");
  }
  if (fact.concentration && sheet.concentratingOn && textKey(sheet.concentratingOn) !== textKey(name)) {
    notes.push(`Ends your concentration on ${sheet.concentratingOn}.`);
  }
  // A note the model reads too: its tool directions are not the player's
  // (src/lib/language/player-text.ts).
  const note = mech.note ? forPlayers(mech.note) : "";
  if (note) notes.push(note);
  if (slot && slot.level > fact.level) notes.push(`Cast with a level ${slot.level} slot.`);
  if (free?.free && free.note) notes.push(free.note);
  // Mechanics the app read from the spell's text that nobody checked
  // (issue #570): the card's details say so.
  if (fact.bestEffort) notes.push(BEST_EFFORT_SHORT);
  // Every refusal below is the cast guard's own (src/lib/dm/cast-rules.ts),
  // asked of the same sheet: raging, a beast form without Beast Spells,
  // untrained armor, a verbal component while silenced, no free hand, a
  // costly material neither carried nor affordable, no slot, and the
  // bonus-action spell rule.
  const problem = (refusal: ToolError | null, spent = false): Gate => (refusal ? { reason: refusal.error, spent } : null);
  const components = castComponents(sheet, facts, grantedCastOf(sheet, name, facts), undefined);
  const material = materialPlan(sheet, facts, { inFight: true, slotLevel: slotLevel ?? fact.level });
  const slotRefusal =
    !stored && fact.level > 0 && !slot && !free?.free
      ? free?.spent
        ? { error: free.spent }
        : slotPlan(sheet, name, facts, fact.level)
      : null;
  const charge = turnCharge({
    who: sheet.name,
    // Not a casting: charged as cast-repeat.ts charges it.
    facts: beam && facts ? { ...facts, level: 0 } : facts,
    spell: name,
    slotLevel: slotLevel ?? null,
    inFight: true,
    budget: turn.myTurn ? budgetOf(turn, sheet) : null,
    reactionSpent: turn.reactionUsed,
    // Mantle of Majesty, Elder Champion (the school is the pack's, so
    // Embodiment of the Law is the engine's to decide).
    bonusCast: bonusCastOf(sheet, facts, null),
  });
  const chargeGate: Gate = "error" in charge ? { reason: charge.error, spent: charge.error.includes("already used") } : null;
  const melee = mech.resolution === "attack" && isMeleeSpellAttack(engine, facts?.range.kind);
  if (melee) notes.unshift("Melee spell attack: a creature beside you.");
  if (stored) {
    notes.unshift(stored.item?.note ?? (stored.holds ? `Out of ${stored.ring}, with no slot. It takes turns to cast: this begins it and holds your action each turn.` : `Out of ${stored.ring}, with no slot.`));
  }
  // A feature that moves the spell to the bonus action shows it there.
  const shownCost: HandCost = stored?.free ? "free" : !stored && !("error" in charge) && charge.kind === "budget" && charge.cost === "bonus action" ? "bonus" : cost;
  const fromRing = stored ? { item: stored.ring } : {};
  const card: HandCard = {
    id: stored?.item?.id ?? (stored ? `spell:ring:${textKey(stored.ring)}:${textKey(name)}` : `spell:${textKey(name)}`),
    type,
    name: stored?.item?.name ?? (stored ? ringCardName(name) : name),
    cost: shownCost,
    range: feet(fact.range),
    dice,
    roll,
    rules: notes.slice(0, 2).join(" "),
    description: [fact.desc, fact.higherLevel ? `At higher levels: ${fact.higherLevel}` : "", ...notes.map((note) => (note === BEST_EFFORT_SHORT ? BEST_EFFORT_NOTE : note))].filter(Boolean).join("\n\n"),
    resource: beam ? "No slot" : (stored?.item?.resource ?? (stored ? `Level ${stored.entry.level}` : fact.level === 0 ? "Cantrip" : free?.free ? free.line : slot ? slotLine(slot) : `Level ${fact.level} · no slots`)),
    ...(stored ? { fromItem: stored.fromItem } : {}),
    condition: beam ? "" : mech.condition?.name ?? (fact.concentration ? "Concentration" : ""),
    icon: { kind: "spell", key: name, family: fact.school ? `spell-${fact.school.toLowerCase()}` : null },
    target,
    toHit: struck ? struck.toHit : toHit,
    ...(struck?.toHitDice ? { toHitDice: struck.toHitDice } : {}),
    ...(struck?.rollAdvantage ? { rollAdvantage: struck.rollAdvantage } : {}),
    damage,
    damageType: heals ? "healing" : mech.damageType ?? "",
    ...(!heals && mech.damageType && mech.secondType ? { secondType: mech.secondType } : {}),
    heals,
    save,
    // A touch spell is a melee spell attack with touch reach (the engine's
    // isMeleeSpellAttack): it previews and aims like a swing.
    melee,
    ...(melee ? { range: "Touch" } : {}),
    disabled: null,
    spent: false,
    compose: false,
    level: fact.level,
    ...(fact.concentration ? { concentration: true } : {}),
    // A reaction spell (Shield, Hellish Rebuke) is played as a reaction:
    // use_reaction resolves it, off the caster's turn too.
    intent:
      cost === "reaction"
        ? { card: "reaction", feature: name, spell: name, slotLevel: slotLevel ?? null, ...fromRing }
        : { card: "spell", spell: name, slotLevel: slotLevel ?? null, ...fromRing },
  };
  // The beam asks only what its cost does: no slot, components or material.
  if (beam) {
    return gated(card, standingGate(sheet, turn), chargeGate);
  }
  // Nothing to pick for a reaction, or for a casting that is only begun.
  const plain = cost === "reaction" || stored?.holds === true;
  if (stored?.holds) card.target = "none";
  const choice = plain ? undefined : spellChoice(mech);
  if (choice) card.choice = choice;
  // Polymorph's beast, which cast_buff and cast_at_enemy read from variant
  // (enemy-polymorph.ts): the card sent none and was sent back every time.
  if (!plain && textKey(fact.runsAs ?? name) === "polymorph") card.choice = polymorphChoice();
  // A summoning spell that calls more than one creature from this slot asks
  // which, and how many where the spell lets its caster choose (issue 685).
  const summoning = plain ? null : summonPick(options.summons?.[textKey(name)], slotLevel ?? fact.level);
  if (summoning) {
    card.choice = summoning.choice;
    card.summon = summoning.summon;
  }
  // Web, Moonbeam, a wall: the square it is laid on is picked on the board.
  // So is an instant blast's (Fireball, Burning Hands), whose squares the
  // engine then catches everyone on (issue 570); a blast around the caster
  // needs no pick and aims at nobody.
  const zone = plain ? null : areaFor({ spell: name, runsAs: fact.runsAs }, slotLevel ?? (fact.level || null));
  // Its printed area decides, not the parsed row's flag, which a line "100
  // feet long" or a "10-foot-radius sphere" can slip past (Lightning Bolt,
  // Shatter).
  const blast =
    plain || zone || !blasts || (mech.resolution !== "save" && mech.resolution !== "auto")
      ? null
      : blastAreaFor({ spell: name, runsAs: fact.runsAs }, { desc: fact.desc, range: fact.range }, slotLevel ?? (fact.level || null), mech.damageType ?? "");
  const area = zone ?? blast;
  if (area) card.area = area;
  if (blast?.pick === "none") card.target = "none";
  // Magic Missile's darts, Scorching Ray's rays, Eldritch Blast's beams, the
  // creatures Bless or an upcast Hold Person takes: how they are shared out
  // is asked in the Hand, not left to the model (issue 570).
  const shared = plain || area ? null : spellShares(mech, fact.level, slotLevel ?? null, sheet.level);
  if (shared) card.shares = shared;
  // No components, no slot and no room in the turn's spell rule: the ring asks
  // what use_item asks (src/lib/dm/spell-storing.ts).
  // An item with no numbers of its own casts with its user's, and a fighter has
  // none: the spell's tool would refuse it after the item had paid.
  const noNumbers = stored?.item && ((save === null && mech.resolution === "save" && mech.save) || (toHit === null && mech.resolution === "attack"));
  // A reaction spell is cast when its trigger comes, and the reaction strip
  // deals it then (hand-react.ts), in this card's place (withReactions): open
  // here it was refused in every state, out of a fight too. A ring's own gates
  // already say so (hand-ring.ts waitsForTrigger).
  const waits: Gate = cost === "reaction" ? waitsForTrigger(name, false) : null;
  if (stored) return gated(card, ...stored.gates, noNumbers ? { reason: `${stored.ring} casts ${name} with its user's own spell numbers, and ${sheet.name} has none.`, spent: false } : null);
  return gated(
    card,
    standingGate(sheet, turn, cost === "reaction" ? "reaction" : "cast"),
    problem(casterStateProblem(sheet)),
    // The components as this caster makes them (an Archdruid's druid spells
    // need neither voice nor hands), and the Silence the board says they
    // stand in, as the cast guard asks them (cast-rules.ts castComponents).
    problem(components.problem ?? (options.board?.silence && components.facts?.verbal ? silenceRefusal(sheet.name, options.board.silence.by || null, components.facts.name) : null)),
    // A reaction spell needs a reaction to spend (slowed takes it away).
    cost === "reaction" ? costGate("reaction", turn, sheet, name) : null,
    "error" in material ? { reason: material.error, spent: false } : null,
    slotRefusal && "error" in slotRefusal ? { reason: slotRefusal.error, spent: true } : null,
    chargeGate,
    // Last: what else would shut it says more (slowed, no slot).
    waits,
  );
}

// The free use a spell has this turn: a race's grant (its counter, or at
// will) or a feat's free cast, while one is left, with the level it is cast
// at; `spent` says why a grant no slot can cast is out of uses. The Hand's
// spell cards and its reaction cards (hand-react.ts) both read it, as the
// cast guard spends it.
export type FreeUse = { free: boolean; line: string; note?: string; spent?: string; castAt?: number };
export function freeUseOf(sheet: CharacterSheet, name: string, facts: ReturnType<typeof bundledSpellFacts>): FreeUse | null {
  const grant = grantedCastOf(sheet, name, facts);
  if (grant?.slot === "free") {
    if (grantCastsFree(sheet, grant, facts, undefined)) {
      // A counter the sheet does not carry yet reads at the grant's own
      // size, never as at will (granted-casts.ts grantUses).
      const uses = grantUses(sheet.resources, grant);
      const castAt = grant.castAt ?? facts?.level;
      return uses
        ? { free: true, castAt, line: `Free ${uses.left}/${uses.max}`, note: `No slot: ${uses.left} of ${uses.max} free uses left until a ${grant.rest ?? "long"} rest.` }
        : { free: true, castAt, line: "Free · at will" };
    }
    return grant.slotsToo
      ? { free: false, line: "" }
      : { free: false, line: "", spent: `${name} is spent until a ${grant.rest ?? "long"} rest.` };
  }
  const id = freeCastResourceId(facts?.name ?? name);
  const state = sheet.resources?.[id];
  return state && state.used < state.max
    ? { free: true, castAt: facts?.level, line: `Free ${state.max - state.used}/${state.max}`, note: `No slot: ${state.max - state.used} of ${state.max} free uses left until a long rest.` }
    : null;
}

export function spellCards(sheet: CharacterSheet, turn: HandTurn, riders: CombatRiders, options: HandOptions): HandCard[] {
  const rows: Array<{ level: number; card: HandCard }> = [];
  const names = spellNames(sheet);
  // A beam held from a scroll or an item, its spell on no list of theirs.
  const held = sheet.concentratingOn;
  if (held && spellMechFor([held])?.repeatDice && !names.some((name) => textKey(name) === textKey(held))) {
    names.push(held);
  }
  for (const name of names) {
    const fact = factFor(name, options);
    if (!fact) continue;
    const card = spellCard(sheet, turn, riders, name, fact, options);
    if (card) rows.push({ level: fact.level, card });
  }
  // Attacks first inside a level, so the cantrip that hurts leads the hand.
  const weight = (card: HandCard) => (card.target === "enemy" ? 0 : card.heals ? 1 : 2);
  rows.sort((a, b) => a.level - b.level || weight(a.card) - weight(b.card) || compareNames(a.card.name, b.card.name));
  return rows.map((row) => row.card);
}

// ---- class features and resources ----

// What the feature costs to use: the counter's own ResourceDef.action, the
// field use_resource charges from (src/lib/srd/counter-rules.ts counterCost),
// so the pill cannot say one cost while the engine charges another. Read out
// of the guidance's words here, the card said action for about forty counters
// the engine charged nothing for. The staples below are the pools whose card
// stands for a use priced by what it buys.
const FEATURE_COST: Record<string, HandCost> = {
  rage: "bonus",
  second_wind: "bonus",
  bardic_inspiration: "bonus",
  action_surge: "free",
  ki: "free",
  sorcery_points: "free",
};

// A rule's sentence as a shut card's reason.
const gateOf = (reason: string | null) => (reason ? { reason, spent: false } : null);

function featureCost(def: ResourceDef, sheet: CharacterSheet): HandCost {
  const named = FEATURE_COST[def.id];
  if (named) return named;
  const action = counterCost(def, sheet);
  return !action || action === "none" ? "free" : action;
}

export function featureCards(sheet: CharacterSheet, turn: HandTurn): HandCard[] {
  const derived = computeSheetDerived(sheet);
  const cards: HandCard[] = [];
  // An at-will feature (One with Shadows) has no counter on the sheet: its
  // card comes from the feature held, and reads no uses.
  for (const [id, state] of [...Object.entries(sheet.resources), ...heldAtWill(sheet)]) {
    const def = resourceDef(id);
    // A spell's free uses (a race's, a feat's free cast) ride the spell's
    // own card, which spends them (spellCard).
    if (id.startsWith(RACIAL_COUNTER_PREFIX) || isFreeCastResource(id)) continue;
    // Superiority dice ride attacks (riderCards); recoveries belong to a rest.
    // Ki is spent through its techniques, each a card of its own (hand-class.ts
    // Flurry of Blows, and the bonus-action moves in hand.ts).
    // A feat's pour-in (Inner Resilience's ki) lives under the class counter's id, never its own card.
    // Channel Divinity and Psionic Energy are one card per option, each at its
    // own cost (hand-options.ts).
    if (!def || def.passive || def.into || id === "sub_superiority_dice" || id === "ki" || def.effect.kind === "recover_slots") continue;
    if (id === "channel_divinity" || (id === "sub_psionic_energy" && psionicOptions(sheet).length)) continue;
    // Spent by the bonus attack itself (hand-class.ts bonusStrikeCards).
    if (BONUS_ATTACK_COUNTERS.includes(id)) continue;
    // Spent on the card a missed roll waits on (after-roll-logic.ts).
    if (AFTER_ROLL_COUNTERS.includes(id)) continue;
    // A spend the server resolves is its own card, dealt here in its
    // counter's place (hand-subclass.ts counterSpendCards).
    if (playedAsSpendCard(sheet, def.displayName)) {
      cards.push(...counterSpendCards(sheet, turn, def.displayName));
      continue;
    }
    // A spend of the counter's own name whose option is not chosen (an
    // Infiltrator's Defensive Field, held by every Armorer): no card, as
    // use_resource refuses it.
    const gatedSpend = authoredSpendFor(sheet, def.displayName);
    if (gatedSpend && !gateHolds(gatedSpend.spend.gate, sheet, gatedSpend.held)) continue;
    // Dealt when the hit that calls for it comes (hand-react.ts), when its
    // trigger does (hand-react-triggers.ts), or as the authored reaction that
    // spends it: never on the holder's turn with nothing to answer.
    if (HIT_ANSWER_COUNTERS.some((counter) => counter.id === id && !counter.anyDamage)) continue;
    if (TRIGGERED_COUNTERS.includes(id) || reactionSpending(id)) continue;
    const level = resourceLevel(def, sheet);
    const effect = def.effect;
    const left = state.max - state.used;
    const cost = featureCost(def, sheet);
    let type: HandCardType = "feature";
    let dice = "";
    let damage: string | null = null;
    let target: HandTarget = "none";
    let heals = false;
    let save: HandCard["save"] = null;
    let compose = false;
    let condition = "";
    let damageType = "";
    if (effect.kind === "heal_self" || effect.kind === "heal_target") {
      damage = effect.dice(level, derived.abilityMods);
      dice = `heals ${damage}`;
      type = "mend";
      heals = true;
      target = effect.kind === "heal_self" ? "self" : "ally";
    } else if (effect.kind === "heal_pool" || effect.kind === "heal_dice_pool") {
      dice = effect.kind === "heal_pool" ? `heals up to ${left}` : `heals ${effect.die} a die`;
      type = "mend";
      heals = true;
      target = "ally";
      // How much of the pool to spend is the player's call, so they finish the line.
      compose = true;
    } else if (effect.kind === "temp_hp") {
      damage = effect.dice(level, derived.abilityMods);
      dice = `${damage} temp hp`;
      type = "ward";
      target = "self";
    } else if (effect.kind === "condition" || effect.kind === "buff") {
      // A feature with variants names none on its face: the player picks.
      const variants = effect.kind === "buff" && Boolean(effect.variants?.length);
      dice = variants ? "" : effect.condition;
      condition = variants ? "" : effect.condition;
      type = "ward";
      target = effect.kind === "buff" && effect.target === "ally" ? "ally" : "self";
    } else if (effect.kind === "inspire") {
      dice = `+1${effect.die(level)} to a roll`;
      type = "ward";
      target = "ally";
    } else if (effect.kind === "aoe") {
      // A dragonborn's breath takes its ancestry's save and damage type; the
      // DC is the one the spend rolls against (aoe-spend.ts).
      const spend = aoeSpendFor(def, sheet, level, derived)!;
      damage = spend.dice;
      damageType = spend.damageType ?? effect.typeFromVariant?.[0] ?? "";
      save = { ability: SAVE_LABEL[spend.saveAbility] ?? spend.saveAbility, dc: spend.dc };
      dice = `${damage}${damageType ? ` ${damageType}` : ""}, ${save.ability} save`;
      type = "spell";
      target = "enemy";
    } else if (effect.kind === "enemy_save") {
      damage = effect.dice ? effect.dice(level, derived.abilityMods) : null;
      damageType = effect.type ?? "";
      save = { ability: SAVE_LABEL[effect.save] ?? effect.save, dc: counterSaveDc(effect.dcAbility, derived, Math.max(...Object.values(derived.abilityMods))) };
      dice = damage ? `${damage}${damageType ? ` ${damageType}` : ""}, ${save.ability} save` : `${save.ability} save`;
      condition = effect.condition ?? "";
      type = condition ? "control" : "spell";
      target = "enemy";
    } else if (effect.kind === "teleport") {
      dice = `${effect.feet} ft`;
    } else if (effect.kind === "hit_damage") {
      // Fury of the Small: onto the creature the hit landed on.
      damage = effect.dice(level, derived.abilityMods);
      dice = `+${damage}`;
      target = "enemy";
    }
    const card: HandCard = {
      id: `feature:${id}`,
      type,
      name: def.displayName,
      cost,
      // The reach the spend holds a save to (counter-saves.ts), printed so
      // the card says how near a creature must be.
      range: (effect.kind === "aoe" || effect.kind === "enemy_save") && effect.rangeFt ? `${effect.rangeFt} ft` : target === "self" || target === "none" ? "Self" : "",
      dice,
      roll: save ? "no attack" : "no roll",
      rules: def.guidance.split(". ")[0].replace(/\.?$/, "."),
      description: def.guidance,
      resource: def.atWill ? "" : `Uses ${left}/${state.max}`,
      condition,
      icon: { kind: "feature", key: def.displayName, family: `class-${primaryClass(sheet)}` },
      target,
      toHit: null,
      damage,
      damageType: heals ? "healing" : damageType,
      heals,
      // The DC the spend rolls against, from the same rule (counter-rules.ts).
      save,
      melee: false,
      disabled: null,
      spent: false,
      compose,
      pool: id,
      // The engine refuses these without a variant, so a card with none sent the
      // GM a sentence that named no choice while its face showed the first one.
      ...(effect.kind === "buff" && effect.variants?.length
        ? {
            choice: {
              arg: "variant",
              label: "Choose",
              options: effect.variants.map((value) => ({ value, label: pickLabel(nameChoice(value) ?? value) })),
            },
          }
        : {}),
      // A damage type the holder picks (Drake's Breath), and the beast a Wild
      // Shape becomes, sent as use_resource reads them.
      ...((effect.kind === "aoe" || effect.kind === "enemy_save") && effect.typeFromVariant?.length
        ? { choice: { arg: "variant" as const, label: "Type", options: effect.typeFromVariant.map((value) => ({ value, label: pickLabel(value) })) } }
        : {}),
      ...(effect.kind === "wild_shape" && !sheet.wildShape ? { choice: wildShapeChoice(sheet) } : {}),
      // "one creature other than yourself" (Bardic Inspiration): no "(you)" chip.
      ...(effect.kind === "inspire" && effect.othersOnly ? { othersOnly: true } : {}),
      intent:
        cost === "reaction"
          ? { card: "reaction", feature: def.displayName }
          : { card: "feature", resourceId: id },
    };
    cards.push(
      gated(
        card,
        standingGate(sheet, turn, cost === "reaction" ? "reaction" : cost === "bonus" ? "bonus" : cost === "free" ? "free" : "action"),
        left > 0 ? null : { reason: `${def.displayName} is spent until a ${def.recharge} rest.`, spent: true },
        // SRD 5.1 fighter, Action Surge: "only once on the same turn".
        id === "action_surge" && (turn.marks ?? []).includes(ACTION_SURGED)
          ? { reason: "Action Surge is used once a turn; the other use waits for a later turn.", spent: true }
          : null,
        costGate(cost, turn, sheet, def.displayName),
        // What the counter's own row asks first (counter-rules.ts): Rage while
        // raging, Unearthly Recovery above half, a minute's work in a fight.
        gateOf(counterGate(def, sheet, inFightOf(turn))),
        // A counter that rides a weapon hit waits for one this turn.
        effect.kind === "hit_damage" && turn.myTurn && !(turn.marks ?? []).some((mark) => mark.startsWith(WEAPON_HIT))
          ? { reason: `${def.displayName} rides a weapon hit: land one this turn first.`, spent: false }
          : null,
        // SRD 5.1: Elemental Affinity's resistance comes with a spell of the
        // dragon's damage type, as it is cast (src/lib/dm/affinity-cast.ts).
        id === "elemental_affinity" && !affinityCastType(sheet)
          ? { reason: "Elemental Affinity's resistance comes with a spell of your dragon's damage type: cast one first.", spent: false }
          : null,
      ),
    );
  }
  return cards;
}

