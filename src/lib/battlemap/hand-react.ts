// The reactions a player may take right now against an attack the engine
// recorded (src/lib/dm/last-hit.ts, projected as PublicEncounter.lastHits):
// Shield, Uncanny Dodge, Deflect Missiles and Hellish Rebuke for the
// character just hit, Slow Fall after a fall, Cutting Words and Protection
// for an ally just hit, and the subclass reactions the authored layer
// resolves (src/lib/srd/authored-effects.ts). Absorb Elements is not offered:
// it is not an SRD 5.1 spell and use_reaction does not resolve it.
// use_reaction re-resolves the recorded
// attack and gives back what the rules give back; these cards only offer
// the choice while the engine would still accept it, and carry the engine's
// own refusals (can-act, the cast guard's rules, the reaction budget).
//
// Pure; scripts/test-hand-engine.mjs drives it.
import { zoneFeetKey } from "@/lib/battlemap/zone-feet";
import { casterStateProblem, componentProblem, focusProblem } from "@/lib/dm/cast-rules";
import { beforeFailedSave, deflectionCastProblem } from "@/lib/dm/ar-ws-deflection-mark";
import type { PublicLastHit, PublicSave } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { bundledSpellFacts } from "@/lib/srd/spell-facts";
import { gateHolds, heldAuthored, type AuthoredReaction } from "@/lib/srd/authored-effects";

type ReactionDoes = AuthoredReaction["does"];
import {
  costGate,
  gated,
  lowestSlot,
  slotLine,
  standingGate,
  type Gate,
  type HandCard,
  type HandTarget,
  type HandTurn,
} from "@/lib/battlemap/hand-core";
import { freeUseOf, namedSpellGlyph, spellNames } from "@/lib/battlemap/hand-spells";
import { spellTargetWords } from "@/lib/battlemap/spell-glyph-logic";
import { dealtByTrigger, triggerCards } from "@/lib/battlemap/hand-react-triggers";
import { wardCards } from "@/lib/battlemap/hand-ar-ws-ward";
import { mantleStrideCards } from "@/lib/battlemap/hand-feature-doors";
import { ringBarrierGate, ringCardName, ringSpells } from "@/lib/battlemap/hand-ring";
import { COMMANDED, wieldsMeleeOrShield } from "@/lib/dm/maneuver-rules";
import { HIT_ANSWER_COUNTERS, reachAtLevel, reactionTimingOf, timingOfDoes } from "@/lib/dm/reaction-kinds";
import { LUCK_POINTS, resourceDef } from "@/lib/srd/class-resources";
import type { ToolError } from "@/lib/dm/tool-errors";
import { findNamed, textKey } from "@/lib/language/text-logic";
import { vowedFoe } from "@/lib/srd/vow-of-enmity";
import { choiceIn, holdsFeature, isConditionNamed, isNamed } from "@/lib/srd/feature-names";

// A Battle Master maneuver's card wears its painting.
// The Hawk spirit's card: its creature is the player's pick (reactionAim).
const HAWK_CARD = "spirit-totem-hawk";
const MANEUVER_ICON = (name: string): HandCard["icon"] => ({ kind: "option", key: `Maneuver: ${name}`, family: "option-maneuver" });

function base(
  id: string,
  name: string,
  prompt: string,
  target: HandTarget,
  intent: HandCard["intent"],
  extra: Partial<HandCard> = {},
): HandCard {
  return {
    id: `reaction:${id}`,
    type: "ward",
    name,
    cost: "reaction",
    // A card aimed at someone else is not "Self": each names its reach, or none.
    range: target === "none" ? "Self" : "",
    dice: "",
    roll: "no roll",
    rules: "",
    resource: "",
    condition: "",
    icon: { kind: "feature", key: name, family: null },
    target,
    toHit: null,
    damage: null,
    damageType: "",
    heals: false,
    save: null,
    melee: false,
    disabled: null,
    spent: false,
    compose: false,
    intent,
    prompt,
    ...extra,
  };
}

function what(hit: PublicLastHit, whom: string): string {
  if (hit.source === "fall") return `${whom} fell for ${hit.damage}`;
  if (hit.source === "effect") return `${whom} took ${hit.damage}${hit.type ? ` ${hit.type}` : ""} damage`;
  // The hit named is the one Uncanny Dodge would halve; a multiattack's
  // other hits are counted, not added to its damage.
  const others = (hit.hits ?? 1) > 1 ? `, the heaviest of ${hit.hits} hits` : "";
  return `${hit.attacker}'s ${hit.attack} hit ${whom}${hit.damage ? ` for ${hit.damage}${hit.type ? ` ${hit.type}` : ""}` : ""}${others}`;
}

// Shield's prompt over every hit it covers: the first in full, the rest by
// who made them and what they dealt.
function whatAll(covered: PublicLastHit[], whom: string): string {
  const [first, ...rest] = covered;
  const then = rest.map((hit) => `${hit.attacker}'s ${hit.attack}${hit.damage ? ` for ${hit.damage}` : ""}`);
  return `${what(first, whom)}${then.length ? `, then ${then.join(" and ")}` : ""}`;
}

// What a reaction card carries of the hit it answers: the hit itself, for
// its aim (reactionAim), and its id, which the card sends as use_reaction's
// `hit` so the engine answers that hit and no other (issue 685).
function answering(hit: PublicLastHit): Partial<HandCard> {
  return { answers: { characterId: hit.characterId, ...(hit.id ? { hitId: hit.id } : {}), attackerId: hit.attackerId, attacker: hit.attacker } };
}

function aimedIntent<T extends HandCard["intent"]>(intent: T, hit: PublicLastHit): T {
  return hit.id && intent.card === "reaction" ? { ...intent, hit: hit.id } : intent;
}

// A reaction spell the sheet holds, gated as the cast guard gates it.
function spellReaction(
  sheet: CharacterSheet,
  turn: HandTurn,
  spell: string,
  prompt: string,
  rules: string | ((level: number) => string),
  target: HandTarget,
  hit: PublicLastHit,
  idTail = "",
): HandCard | null {
  if (!spellNames(sheet).some((name) => textKey(name) === textKey(spell))) return null;
  const facts = bundledSpellFacts(spell);
  // A race's free use (a tiefling's Infernal Legacy) answers without a slot
  // while it is left, at the level the trait casts it (issue #833): the card
  // once asked every tiefling fighter for a slot, and sent a tiefling
  // warlock's slot level so the cast spent the slot and kept the free use.
  const free = freeUseOf(sheet, spell, facts);
  const slot = free?.free ? null : lowestSlot(sheet, facts?.level ?? 1);
  const level = (free?.free ? free.castAt : slot?.level) ?? facts?.level ?? 1;
  const card = base(
    `${textKey(spell).replace(/\s+/g, "-")}${idTail}`,
    spell,
    prompt,
    target,
    aimedIntent({ card: "reaction", feature: spell, spell, slotLevel: slot?.level ?? null }, hit),
    { type: "spell", rules: typeof rules === "function" ? rules(level) : rules, resource: free?.free ? free.line : slot ? slotLine(slot) : "No slots", icon: { kind: "spell", key: spell, family: null }, ...spellFace(spell, target), ...(target !== "none" && facts?.range.kind === "feet" ? { range: reachLabel(facts.range.feet) } : {}), ...answering(hit) },
  );
  const problem = (refusal: ToolError | null): Gate => (refusal ? { reason: refusal.error, spent: false } : null);
  const fallen = droppedByThisHit(sheet, hit) && reactionTimingOf(spell) === "answers";
  return gated(
    card,
    fallen ? stoodGate(sheet, turn, hit) : standingGate(sheet, turn, "reaction"),
    problem(casterStateProblem(sheet)),
    // Arcane Deflection's price bars a reaction spell too (ar-ws-deflection-mark.ts).
    problem(deflectionCastProblem(sheet, spell, facts?.level)),
    problem(componentProblem(sheet, facts) ?? focusProblem(sheet, facts)),
    free?.free || slot ? null : { reason: free?.spent ?? `${sheet.name} has no spell slot left for ${spell}.`, spent: true },
    costGate("reaction", turn, fallen ? asTheyStood(sheet, hit) : sheet, spell),
  );
}

// A reaction spell card's glyph and the words beside it, as a spell card
// from the fan wears them (issue 845).
function spellFace(spell: string, target: HandTarget): Pick<HandCard, "glyph" | "targetWords"> {
  const words = spellTargetWords({ target });
  return { glyph: namedSpellGlyph(spell), ...(words ? { targetWords: words } : {}) };
}

// The same spell out of a Ring of Spell Storing the character holds it in: no slot
// and no components, so only the ring and the reaction itself can stop it. Beside
// the caster's own card of the spell when they have both: which pays is theirs to
// choose. The name is the one the fan's grey card goes by, which this replaces
// (withReactions).
function ringReactions(
  sheet: CharacterSheet,
  turn: HandTurn,
  spell: string,
  prompt: string,
  rules: string | ((level: number) => string),
  target: HandTarget,
  hit: PublicLastHit,
  idTail = "",
): HandCard[] {
  const fallen = droppedByThisHit(sheet, hit) && reactionTimingOf(spell) === "answers";
  const facts = bundledSpellFacts(spell);
  const slug = (name: string) => textKey(name).replace(/\s+/g, "-");
  return ringSpells(sheet)
    .filter(({ entry }) => findNamed([entry], spell, (held) => [held.spell]))
    .map(({ ring, ring: { name: item }, entry }) =>
      gated(
        base(
          `ring:${slug(item)}:${slug(spell)}${idTail}`,
          ringCardName(spell),
          prompt,
          target,
          aimedIntent({ card: "reaction", feature: spell, spell, slotLevel: entry.level, item }, hit),
          {
            type: "spell",
            rules: typeof rules === "function" ? rules(entry.level) : rules,
            resource: `Level ${entry.level}`,
            icon: { kind: "spell", key: spell, family: null },
            ...spellFace(spell, target),
            ...(target !== "none" && facts?.range.kind === "feet" ? { range: reachLabel(facts.range.feet) } : {}),
            ...answering(hit),
          },
        ),
        ringBarrierGate(sheet, ring),
        fallen ? stoodGate(sheet, turn, hit) : standingGate(sheet, turn, "reaction"),
        costGate("reaction", turn, fallen ? asTheyStood(sheet, hit) : sheet, spell),
      ),
    );
}

// The reactions the player's other characters may take now (a person playing
// several heroes, src/lib/player-characters.ts offTurnReactors, and the
// companions they play, companionReactors): the hit hero is seldom the one
// acting, and the Hand follows the one acting. Each card names its hero and
// carries them as its actor, and its id is the hero's own, so it never
// stands in for the acting hero's card of the same name.
export function offTurnReactionCards(
  heroes: Array<{ sheet: CharacterSheet; turn: HandTurn }>,
  hits: PublicLastHit[],
  party: Array<Pick<CharacterSheet, "id" | "name">>,
  saves: PublicSave[] = [],
): HandCard[] {
  return heroes.flatMap(({ sheet, turn }) =>
    reactionCards(sheet, turn, hits, party, sheet.name, undefined, saves).map((card) => ({
      ...card,
      id: `${card.id}@${sheet.id}`,
      actor: { id: sheet.id, name: sheet.name },
    })),
  );
}

// The reaction strips over the fan (HandReactPrompt), one per hit answered:
// the hero's own first, then each other hero's. A strip reads its first
// card's prompt, so two hits on one hero kept in one strip showed two like
// Uncanny Dodge chips under the first hit's words, and nothing said which
// chip answered which blow. Shield, which covers every hit after the one it
// answers, sits with that first hit, whose prompt names them all. Cards that
// name no hit (one hit open, or a host that keeps no ids) keep one strip per
// hero, as before.
export function reactionStrips(own: HandCard[], others: HandCard[]): HandCard[][] {
  const strips = new Map<string, HandCard[]>();
  for (const card of [...own, ...others]) {
    const key = `${card.actor?.id ?? ""}|${card.answers?.hitId ?? ""}`;
    strips.set(key, [...(strips.get(key) ?? []), card]);
  }
  return [...strips.values()];
}

// A reaction sent for a hero and not yet resolved holds that hero's reaction
// cards, the strip's chips with the fan's (issue 685). At a table a person
// runs a card or a typed reaction waits for the GM, and nothing in the
// engine's count moves until then: Shield's chip stayed live after it was
// played, and another hero's card or words could be sent twice. The session
// keeps who was sent for (SessionView.tsx) until the encounter's reactions,
// round or turn move; then the engine's own count decides.
export function holdSentReactions(cards: HandCard[], sent: readonly string[], selfId: string): HandCard[] {
  if (!sent.length) return cards;
  return cards.map((card) =>
    card.cost === "reaction" && !card.disabled && sent.includes(card.actor?.id ?? selfId)
      ? { ...card, disabled: `Sent. Waiting for the GM to resolve ${card.actor ? `${card.actor.name}'s reaction` : "your reaction"}.`, spent: false }
      : card,
  );
}

// Every reaction card the moment offers, the character's own hits first.
// `self` is how the prompt names the character hit: "you" in their own hand.
// With several hits open on one character (two enemies in one pass, issue
// 685) each card answers one of them, named in its prompt; Shield is offered
// once, against the earliest, since its +5 covers every hit after it too.
export function reactionCards(
  sheet: CharacterSheet,
  turn: HandTurn,
  hits: PublicLastHit[],
  party: Array<Pick<CharacterSheet, "id" | "name">>,
  self = "you",
  // How far each creature stands from the character, in feet, when the
  // board says (PlayerMapView.feet). A reaction with a reach is dealt only
  // for a hit inside it: an ally beyond Glorious Defense's 10 feet got a
  // card the engine refused. Absent, every card is dealt and the engine
  // judges the reach.
  feet?: Record<string, number>,
  // The Intelligence, Wisdom and Charisma saves made this turn against a
  // creature (PublicEncounter.lastSaves), which Vigilant Rebuke answers.
  saves: PublicSave[] = [],
  // The creatures the Hand offers to aim at, friend or foe, for a redirect's
  // card to know whether one stands beside the character (reactionPicks).
  foes?: Array<{ id: string }>,
  // Who on the board the character has no line of sight to (PlayerMapView.unseen):
  // a reaction whose text needs its creature seen is not dealt for them.
  unseen?: Unseen,
): HandCard[] {
  // A creature the board does not show this character at all (fog, out of
  // sight) is as unseen as one behind a wall; with no board, nothing is.
  if (unseen && feet) {
    const walled = unseen;
    unseen = { has: (id: string) => walled.has(id) || !(id in feet) };
  }
  const cards: HandCard[] = [];
  // By this holder, or by anyone on a key that names no holder (an older
  // record, or a host that sends names only).
  const answered = (hit: PublicLastHit, name: string) =>
    (hit.answeredBy ?? hit.answered).some((entry) => textKey(entry) === textKey(name) || entry === `${textKey(name)}@${sheet.id}`);
  // A hit among several on its character tags its cards' ids; one hit keeps
  // the ids it always had.
  const tail = (hit: PublicLastHit) =>
    hit.id && hits.filter((other) => other.characterId === hit.characterId).length > 1 ? `~${hit.id}` : "";
  // `fallen`: the card answers the hit itself, so a holder that hit dropped
  // is asked as they stood before it. Left out, the engine's table says, by the
  // card's name (reaction-kinds.ts). `gate`: a refusal of the card's own.
  const feature = (
    hit: PublicLastHit,
    name: string,
    prompt: string,
    rules: string,
    target: HandTarget = "none",
    more: { icon?: HandCard["icon"]; fallen?: boolean; gate?: Gate; range?: string; pickWithin?: number; choice?: HandCard["choice"] } = {},
  ) => {
    if (answered(hit, name)) return;
    const card = base(
      `${textKey(name).replace(/\s+/g, "-")}:${hit.characterId}${tail(hit)}`,
      name,
      prompt,
      target,
      aimedIntent({ card: "reaction", feature: name }, hit),
      { rules, ...(more.icon ? { icon: more.icon } : {}), ...(more.range ? { range: more.range } : {}), ...(more.pickWithin ? { pickWithin: more.pickWithin } : {}), ...(more.choice ? { choice: more.choice } : {}), ...answering(hit) },
    );
    const fallen = more.fallen ?? (droppedByThisHit(sheet, hit) && reactionTimingOf(name) === "answers");
    cards.push(
      gated(
        card,
        fallen ? stoodGate(sheet, turn, hit) : standingGate(sheet, turn, "reaction"),
        more.gate ?? null,
        costGate("reaction", turn, fallen ? asTheyStood(sheet, hit) : sheet, name),
      ),
    );
  };
  const counterLeft = (id: string) => {
    const state = sheet.resources[id];
    return Boolean(state) && state.max > state.used;
  };
  const rulesOf = (guidance: string) => guidance.split(". ")[0].replace(/\.?$/, ".");

  const mine = hits.filter((hit) => hit.characterId === sheet.id && hit.hit);
  // Shield answers an attack, and a Magic Missile aimed at them.
  const shieldable = mine.filter((hit) => (hit.source === "attack" || hit.source === "missile") && !answered(hit, "Shield"));
  if (shieldable.length) {
    const shield = spellReaction(
      sheet,
      turn,
      "Shield",
      whatAll(shieldable, self),
      shieldable.length > 1
        ? "+5 AC against these attacks: every swing the +5 beats misses."
        : "+5 AC against the attack that hit: a swing the +5 beats misses.",
      "none",
      shieldable[0],
    );
    if (shield) cards.push(shield);
    cards.push(
      ...ringReactions(
        sheet,
        turn,
        "Shield",
        whatAll(shieldable, self),
        shieldable.length > 1
          ? "+5 AC against these attacks: every swing the +5 beats misses."
          : "+5 AC against the attack that hit: a swing the +5 beats misses.",
        "none",
        shieldable[0],
      ),
    );
  }
  for (const hit of mine) {
    const prompt = what(hit, self);
    if (hit.source === "attack") {
      if (holdsFeature(sheet, "uncanny dodge") && !hidden(unseen, hit.attackerId)) {
        feature(hit, "Uncanny Dodge", prompt, "Halve the damage of the attack that hit you.");
      }
      if (hit.ranged && holdsFeature(sheet, "deflect missiles")) {
        feature(hit, "Deflect Missiles", prompt, "Take 1d10 + DEX + monk level off a ranged weapon hit.");
      }
      // Lucky (src/lib/dm/feat-reactions.ts lucky): a luck point and no
      // reaction, so the card stays open once the reaction is spent.
      if (counterLeft(LUCK_POINTS) && !answered(hit, "Lucky")) {
        cards.push({
          ...base(`lucky:${hit.characterId}${tail(hit)}`, "Lucky", prompt, "none", aimedIntent({ card: "reaction", feature: "Lucky" }, hit), {
            rules: "Spend a luck point: the attacker's d20 is rolled again and the lower one counts.",
            ...answering(hit),
          }),
          cost: "free",
        });
      }
      if (hit.attackerId && !answered(hit, "Hellish Rebuke")) {
        const rebuke = spellReaction(sheet, turn, "Hellish Rebuke", prompt, (level) => `${hit.attacker} makes a DEX save against ${level + 1}d10 fire.`, "enemy", hit, tail(hit));
        if (rebuke) cards.push(rebuke);
        cards.push(...ringReactions(sheet, turn, "Hellish Rebuke", prompt, (level) => `${hit.attacker} makes a DEX save against ${level + 1}d10 fire.`, "enemy", hit, tail(hit)));
      }
    }
    if (hit.source === "fall" && holdsFeature(sheet, "slow fall")) {
      feature(hit, "Slow Fall", prompt, "Take five times your monk level off the fall.");
    }
    if (hit.source === "fall" && !answered(hit, "Feather Fall")) {
      // The caster's own Feather Fall too: its card in the Hand waits for this.
      const fall = spellReaction(sheet, turn, "Feather Fall", prompt, "You drift down and land on your feet: the fall deals you nothing.", "none", hit, tail(hit));
      if (fall) cards.push(fall);
      cards.push(...ringReactions(sheet, turn, "Feather Fall", prompt, "You drift down and land on your feet: the fall deals you nothing.", "none", hit, tail(hit)));
    }
    if (hit.source === "attack") {
      for (const held of subclassReactions(sheet, hit, "self", feet, unseen)) {
        // A redirect needs someone else beside the holder to take the blow. With
        // no foes or distances given, it is open and the engine judges.
        const beside = !held.pickWithin || !foes || !feet || pickableFoes(foes, held.pickWithin, { characterId: hit.characterId, attackerId: hit.attackerId, attacker: hit.attacker }, feet).length > 0;
        feature(hit, held.name, prompt, held.rules, held.target, {
          fallen: held.fallen && sheet.currentHp <= 0,
          range: held.range,
          pickWithin: held.pickWithin,
          ...(held.choice ? { choice: held.choice } : {}),
          gate: beside ? null : { reason: `No other creature stands within ${held.pickWithin} feet of ${sheet.name} to take the hit.`, spent: false },
        });
      }
    }
  }

  // Soul of Vengeance answers the vowed creature's attack, hit or miss, whoever
  // it was aimed at.
  const vowed = vowedFoe(sheet);
  if (vowed && holdsFeature(sheet, "soul of vengeance")) {
    for (const hit of hits.filter((entry) => entry.source === "attack" && entry.attackerId === vowed && inReach(feet, entry.attackerId, SOUL_OF_VENGEANCE_FT))) {
      feature(hit, "Soul of Vengeance", `${hit.attacker} attacked under your vow`, "A melee attack back at the creature under your vow.", "enemy", { range: reachLabel(SOUL_OF_VENGEANCE_FT) });
    }
  }

  // Vigilant Rebuke: a success by the character or one within its reach,
  // and the creature that forced the save takes the damage.
  for (const held of saveAnswers(sheet)) {
    for (const save of saves.filter(madeMentalSave)) {
      const saver = save.characterId === sheet.id ? self : party.find((entry) => entry.id === save.characterId)?.name;
      if (!saver || (save.characterId !== sheet.id && !inReach(feet, save.characterId, held.rangeFt))) continue;
      const id = `${textKey(held.name).replace(/\s+/g, "-")}:${save.id}`;
      const card = base(id, held.name, `${save.characterId === sheet.id && self === "you" ? "You" : saver} made the ${save.ability.toUpperCase()} save ${save.forcer} forced`, "enemy", { card: "reaction", feature: held.name }, {
        rules: held.rules,
        range: reachLabel(held.rangeFt),
        answers: { characterId: save.characterId, attackerId: save.forcerId, attacker: save.forcer },
      });
      cards.push(gated(card, standingGate(sheet, turn, "reaction"), costGate("reaction", turn, sheet, held.name)));
    }
  }

  for (const counter of HIT_ANSWER_COUNTERS) {
    const def = resourceDef(counter.id);
    if (!def || !counterLeft(counter.id)) continue;
    if (counter.whileHolding && !sheet.conditions.some((entry) => textKey(entry) === counter.whileHolding)) continue;
    if (counter.atZero && sheet.currentHp > 0) continue;
    const dropped = sheet.currentHp <= 0;
    if (dropped && sheet.deathSaves?.dead) continue;
    // Warding Maneuver's melee weapon or shield, as the engine asks it.
    const gate: Gate = counter.armed && !wieldsMeleeOrShield(sheet)
      ? { reason: `${def.displayName} needs ${sheet.name} wielding a melee weapon or a shield.`, spent: false }
      : null;
    for (const hit of mine) {
      if (counter.attackOnly && hit.source !== "attack") continue;
      // Taken as the hit that drops them lands: one that found them down
      // already is not it (reaction-counters.ts droppedByFreshHit).
      if (counter.atZero && hit.stood && !hit.stood.up) continue;
      feature(hit, def.displayName, what(hit, self), rulesOf(def.guidance), "none", { fallen: dropped && (counter.atZero || counter.answersDrop), gate });
    }
    if (counter.ally) {
      for (const hit of hits) {
        const ally = party.find((entry) => entry.id === hit.characterId);
        if (ally && ally.id !== sheet.id && hit.hit && hit.source === "attack" && inReach(feet, hit.characterId, counter.rangeFt) && !hidden(unseen, hit.characterId)) {
          feature(hit, def.displayName, what(hit, ally.name), rulesOf(def.guidance), "ally", { gate, range: reachLabel(counter.rangeFt) });
        }
      }
    }
  }

  // The Battle Master's reactions (src/lib/dm/maneuver-reactions.ts): Parry
  // against a melee hit, Riposte against a melee miss, each a die.
  const knows = (name: string) => sheet.features.some((entry) => /^maneuver:/i.test(entry.name) && isNamed(entry.name, name));
  const dice = sheet.resources.sub_superiority_dice;
  if (dice && dice.max > dice.used) {
    for (const hit of mine) {
      if (hit.source === "attack" && !hit.ranged && knows("parry")) {
        feature(hit, "Parry", what(hit, self), "A superiority die plus your Dexterity modifier off the melee hit.", "none", { icon: MANEUVER_ICON("Parry") });
      }
    }
    if (knows("riposte")) {
      for (const missed of hits.filter((hit) => hit.characterId === sheet.id && !hit.hit && hit.source === "attack" && !hit.ranged && hit.attackerId)) {
        feature(missed, "Riposte", `${missed.attacker}'s ${missed.attack} missed ${self}`, "A melee attack back with your reaction, the die on its hit.", "enemy", { icon: MANEUVER_ICON("Riposte"), range: "Melee" });
      }
    }
  }
  // A Battle Master directed this character to strike (Commander's Strike).
  if (sheet.conditions.some((entry) => entry.trim().toLowerCase() === COMMANDED)) {
    const card = base("commanders-strike", "Commander's Strike", "Directed to strike", "enemy", { card: "reaction", feature: "Commander's Strike" }, {
      rules: "One weapon attack now with your reaction, the superiority die on its hit.",
      icon: MANEUVER_ICON("Commander's Strike"),
    });
    cards.push(gated(card, standingGate(sheet, turn, "reaction"), costGate("reaction", turn, sheet, "Commander's Strike")));
  }

  // The Hawk spirit stands (Circle of the Shepherd, Spirit Totem): "when a
  // creature makes an attack roll against a target in the aura, a reaction
  // gives it advantage". It answers no hit, so the card is out while the hawk
  // is, on any turn: the druid picks the creature about to be attacked, and
  // the engine gives the edge to the attacker whose turn it is
  // (src/lib/dm/spirit-totem-hawk.ts), judging the aura itself.
  if (sheet.conditions.some((entry) => textKey(choiceIn(entry, "spirit totem") ?? "") === "hawk")) {
    const card = base(HAWK_CARD, "Spirit Totem (Hawk)", "The Hawk spirit watches its aura", "enemy", { card: "reaction", feature: "Spirit Totem (Hawk)" }, {
      rules: "Your reaction gives advantage to the attack roll about to be made against the creature you pick, if it stands in the spirit's aura.",
      range: "30 ft aura",
      icon: { kind: "feature", key: "Spirit Totem", family: null },
    });
    cards.push(gated(card, standingGate(sheet, turn, "reaction"), costGate("reaction", turn, sheet, "Spirit Totem (Hawk)")));
  }

  // An ally's hit: Cutting Words from a Lore bard, Protection from a
  // protector with a shield. The engine checks the reach and the holder.
  for (const hit of hits) {
    const ally = party.find((entry) => entry.id === hit.characterId);
    if (!ally) continue;
    const prompt = what(hit, ally.name);
    for (const held of allyReactions(sheet, hit, feet, unseen)) {
      feature(hit, held.name, prompt, held.rules, "ally", { range: held.range });
    }
  }
  // Hellish Rebuke after a creature's spell damaged them through a save: no hit
  // record holds it, the save does (src/lib/dm/last-save.ts noteSaveDamage).
  for (const save of saves.filter((entry) => (entry.kind ?? "save") === "save" && entry.characterId === sheet.id && (entry.damage?.amount ?? 0) > 0 && entry.forcerId)) {
    const hurt: PublicLastHit = { characterId: sheet.id, attacker: save.forcer, attackerId: save.forcerId, attack: save.spell ?? "spell", type: save.damage?.type ?? "", ranged: true, source: "attack", hit: true, hits: 1, damage: save.damage?.amount ?? 0, answered: save.answered ?? [] };
    if (cards.some((entry) => entry.name === "Hellish Rebuke" && entry.answers?.attackerId === save.forcerId)) continue;
    const prompt = `${save.forcer}'s ${save.spell ?? "spell"} hurt ${self} for ${hurt.damage}${hurt.type ? ` ${hurt.type}` : ""}`;
    const rebuke = spellReaction(sheet, turn, "Hellish Rebuke", prompt, (level) => `${save.forcer} makes a DEX save against ${level + 1}d10 fire.`, "enemy", hurt, `~${save.id}`);
    if (rebuke) cards.push(rebuke);
  }
  // A reaction that may instead add to a save just failed (Arcane Deflection's
  // +4: src/lib/dm/ar-ws-deflection.ts), dealt for each failed save a creature
  // forced on them this turn, from the records the engine keeps.
  for (const held of heldAuthored(sheet)) {
    for (const reaction of held.entry.reactions ?? []) {
      const does = reaction.does;
      if (does.kind !== "ac_vs_hit" || does.orSave === undefined || (reaction.usedBy ?? "holder") !== "holder" || !gateHolds(reaction.gate, sheet, held)) continue;
      const key = `${textKey(reaction.name)}@${sheet.id}`;
      for (const save of saves.filter((entry) => (entry.kind ?? "save") === "save" && entry.characterId === sheet.id && entry.success === false && !(entry.answered ?? []).includes(key))) {
        const card = base(
          `${textKey(reaction.name).replace(/\s+/g, "-")}:save~${save.id}`,
          reaction.name,
          `${self} failed a save${save.forcer ? ` against ${save.forcer}` : ""}`,
          "none",
          { card: "reaction", feature: reaction.name, variant: "save" },
          { rules: `+${does.orSave} on the save just failed.${does.cantripsOnly ? " Only cantrips until the end of your next turn." : ""}` },
        );
        // Judged as they stood before the failure, as the engine judges it.
        const stood = beforeFailedSave(sheet, save.ability, save.dc);
        cards.push(gated(card, standingGate(stood, turn, "reaction"), costGate("reaction", turn, stood, reaction.name)));
      }
    }
  }
  // The reactions and triggered uses whose trigger is not a hit: a death, a
  // turn's end, a save forced, damage, a cast (hand-react-triggers.ts).
  cards.push(...triggerCards(sheet, turn, hits, saves, (id, reach) => inReach(feet, id, reach), unseen));
  // A ward of Bastion of Law the character carries, spent off an open blow (hand-ar-ws-ward.ts).
  cards.push(...wardCards(sheet, turn, hits));
  // The move a Glamour bard's mantle lends (hand-feature-doors.ts).
  cards.push(...mantleStrideCards(sheet, turn));
  return cards;
}

// A save made against a creature on Intelligence, Wisdom or Charisma, the one
// Vigilant Rebuke answers. The view sends failures and other triggers too.
function madeMentalSave(save: PublicSave): boolean {
  return (save.kind ?? "save") === "save" && save.success !== false && ["int", "wis", "cha"].includes(save.ability);
}

// A card answered as the holder stood when the hit landed, as the engine asks
// it (src/lib/dm/reaction-gate.ts reactingSheet): open to one that very hit
// dropped, and shut to one stunned or down before it. An older host sends no
// standing, and the card is open as before.
function droppedByThisHit(sheet: CharacterSheet, hit: PublicLastHit): boolean {
  return hit.characterId === sheet.id && sheet.currentHp <= 0;
}

// The conditions that switch reactions off (slowed) are read as they stood
// too, as the engine reads them (reaction-gate.ts reactionRefusal).
function asTheyStood(sheet: CharacterSheet, hit: PublicLastHit): CharacterSheet {
  return hit.stood ? { ...sheet, conditions: hit.stood.conditions } : sheet;
}

function stoodGate(sheet: CharacterSheet, turn: HandTurn, hit: PublicLastHit): Gate {
  if (!hit.stood) return null;
  if (!hit.stood.up) return standingGate(sheet, turn, "reaction");
  return standingGate({ ...sheet, currentHp: Math.max(1, sheet.currentHp), conditions: hit.stood.conditions, deathSaves: null }, turn, "reaction");
}


// The reactions the character holds that answer a hit on an ally: Cutting
// Words with a die left, Protection, and the subclass reactions for an ally.
// The cards above offer these, and the actions route takes words typed as a
// reaction for an ally's hit only when one of them covers it.
export function allyReactions(sheet: CharacterSheet, hit: PublicLastHit, feet?: Record<string, number>, unseen?: Unseen): Array<{ name: string; rules: string; range: string }> {
  if (hit.characterId === sheet.id || !hit.hit || hit.source !== "attack") return [];
  // Cutting Words and Protection: "a creature (that) you can see" attacks.
  const attackerSeen = !hidden(unseen, hit.attackerId);
  const bardic = sheet.resources.bardic_inspiration;
  return [
    ...(holdsFeature(sheet, "cutting words") && attackerSeen && (bardic?.max ?? 0) > (bardic?.used ?? 0)
      ? [{ name: "Cutting Words", rules: "Spend a Bardic Inspiration die off the roll or the damage.", range: reachLabel(60) }]
      : []),
    // Protection: "a target other than you that is within 5 feet of you".
    ...(holdsFeature(sheet, "protection") && attackerSeen && inReach(feet, hit.characterId, 5) ? [{ name: "Protection", rules: "Impose disadvantage on the attack: it is rolled again.", range: reachLabel(5) }] : []),
    ...subclassReactions(sheet, hit, "ally", feet, unseen).map((held) => ({ name: held.name, rules: held.rules, range: held.range })),
  ];
}

// The reaction cards the moment offers, then the hand without the cards they
// answer for: a prepared Shield sits in the hand as a spell card, and while
// the prompt offers Shield against the hit it is one choice, shown once.
export function withReactions(reactions: HandCard[], hand: HandCard[]): HandCard[] {
  if (!reactions.length) return hand;
  const offered = new Set(reactions.map((card) => textKey(card.name)));
  return [...reactions, ...hand.filter((card) => !(card.cost === "reaction" && offered.has(textKey(card.name))))];
}

// Misdirection's creature stands this near the holder (redirect-target.ts).
const REDIRECT_FT = 5;

// Soul of Vengeance's melee attack (authored-effects-data2.ts): the vowed
// creature within this reach.
const SOUL_OF_VENGEANCE_FT = 5;

// The creatures the character has no line of sight to on the board.
type Unseen = { has(id: string): boolean };

// Whether the board says the character cannot see the creature `id`.
function hidden(unseen: Unseen | undefined, id: string | null | undefined): boolean {
  return Boolean(id && unseen?.has(id));
}

// Whether the creature `id` stands within `reach` feet, as far as the board
// says: with no distance known, the engine judges it.
function inReach(feet: Record<string, number> | undefined, id: string | null | undefined, reach: number | undefined): boolean {
  const apart = id ? feet?.[id] : undefined;
  return apart === undefined || reach === undefined || apart <= reach;
}

// A reach that grows with the holder's level (Aura of the Guardian's 10
// feet, then 30), as the engine reads it (reaction-kinds.ts reachAtLevel).
// A reach as a card prints it; no reach on record prints none.
function reachLabel(feet: number | undefined): string {
  return feet === undefined ? "" : `${feet} ft`;
}

function reachAt(range: number | Array<[number, number]> | undefined, level: number): number | undefined {
  return range === undefined ? undefined : reachAtLevel(range, level);
}

// The reactions the character holds that answer a save (Vigilant Rebuke),
// with their reach and their line.
function saveAnswers(sheet: CharacterSheet): Array<{ name: string; rangeFt: number | undefined; rules: string }> {
  const out: Array<{ name: string; rangeFt: number | undefined; rules: string }> = [];
  for (const held of heldAuthored(sheet)) {
    for (const reaction of held.entry.reactions ?? []) {
      const does = reaction.does;
      if (does.kind !== "strike_back" || !does.afterSave || (reaction.usedBy ?? "holder") !== "holder" || !gateHolds(reaction.gate, sheet, held)) continue;
      out.push({ name: reaction.name, rangeFt: does.rangeFt, rules: `Strike back: ${does.type} damage at the creature that forced the save.` });
    }
  }
  return out;
}

// What a subclass reaction does, in a line for its card.
function reactionRules(does: ReactionDoes, hit: PublicLastHit): string {
  switch (does.kind) {
    case "uncrit":
      return hit.crit ? `The critical ${hit.crit.attack} (${hit.crit.damage}) becomes a normal hit.` : "";
    case "reduce":
      return does.amount === "half" ? "Halve the damage of the attack that hit." : "Take damage off the attack that hit.";
    case "ac_vs_hit":
      return does.strikeOnMiss
        ? "Raise the AC against the attack that hit: a swing it beats misses, and you attack the attacker."
        : `Raise the AC against the attack that hit: a swing it beats misses.${does.cantripsOnly ? " Only cantrips until the end of your next turn." : ""}`;
    case "disadv_vs_hit":
      return "The attack that hit is rolled again at disadvantage.";
    case "reroll_hit":
      return "The attacker rolls the d20 again and must use the new roll.";
    case "resist_instance":
      return "Resistance to the damage of the attack that hit.";
    case "take_for_ally":
      return "Take the hit in your ally's place.";
    case "echo_hit":
      return `The same damage back at the attacker as ${does.type}, halved on a save.`;
    case "strike_back":
      return `Strike back: ${does.type}${does.orType ? ` or ${does.orType}` : ""} damage at the attacker.`;
    case "redirect":
      return does.save
        ? "The attacker saves or turns the attack onto the creature closest to it."
        : "The attack turns onto a creature beside you that gives you cover.";
    case "force_miss":
      return does.exhaustion
        ? `The hit becomes a miss, for ${does.exhaustion} level${does.exhaustion === 1 ? "" : "s"} of exhaustion.`
        : "The hit becomes a miss.";
    case "echo_takes_hit":
      return "Your echo takes the attack: the hit becomes a miss.";
    case "chance_miss":
      return `Roll ${does.die}: on ${does.min} or higher the attack misses.`;
    default:
      return "";
  }
}

// The subclass reactions the character holds that answer this hit, on
// themselves ("self") or on an ally ("ally"), with their gate and their pool
// asked as use_reaction asks them.
function subclassReactions(
  sheet: CharacterSheet,
  hit: PublicLastHit,
  whose: "self" | "ally",
  feet?: Record<string, number>,
  unseen?: Unseen,
): Array<{ name: string; rules: string; target: HandTarget; range: string; fallen?: boolean; pickWithin?: number; choice?: HandCard["choice"] }> {
  const out: Array<{ name: string; rules: string; target: HandTarget; range: string; fallen?: boolean; pickWithin?: number; choice?: HandCard["choice"] }> = [];
  for (const held of heldAuthored(sheet)) {
    for (const reaction of held.entry.reactions ?? []) {
      if ((reaction.usedBy ?? "holder") !== "holder" || !gateHolds(reaction.gate, sheet, held)) continue;
      // One whose trigger is not this hit is dealt when its own comes
      // (hand-react-triggers.ts): Halo of Spores answers a creature starting its
      // turn near, and its card on a hit was refused.
      if (dealtByTrigger(reaction.name, reaction.gate?.condition)) continue;
      // "A creature you can see", as the engine asks it (authored-reactions.ts).
      if ((reaction.sees === "target" || reaction.sees === "both") && whose === "ally" && hidden(unseen, hit.characterId)) continue;
      if ((reaction.sees === "attacker" || reaction.sees === "both") && hidden(unseen, hit.attackerId)) continue;
      const pool = reaction.pool;
      if (pool && "id" in pool) {
        const state = sheet.resources[pool.id];
        if (!state || state.max - state.used < (pool.amount ?? 1)) continue;
      }
      const does = reaction.does;
      const typed = (types?: string[]) => !types?.length || types.includes(hit.type);
      if (does.kind === "resist_instance" && does.bond && !(sheet.pets ?? []).some((pet) => pet.kind === does.bond && pet.hp > 0)) continue;
      const answers =
        whose === "self"
          ? (does.kind === "reduce" && does.who !== "ally" && typed(does.types)) ||
            does.kind === "ac_vs_hit" ||
            does.kind === "disadv_vs_hit" ||
            (does.kind === "resist_instance" && typed(does.types)) ||
            // The Cloud Rune (`within`) is asked at the hit before its damage
            // (cloud-rune.ts), never as a card after it.
            (does.kind === "redirect" && !does.within) ||
            does.kind === "force_miss" ||
            does.kind === "uncrit" ||
            (does.kind === "reroll_hit" && Boolean(does.roller)) ||
            (does.kind === "chance_miss" && (!does.vsMark || markedBy(sheet, does.vsMark, hit.attackerId))) ||
            (does.kind === "strike_back" && !does.afterSave && Boolean(hit.attackerId) && !(does.melee && hit.ranged))
          : (does.kind === "reduce" && does.who !== "self" && typed(does.types)) ||
            does.kind === "take_for_ally" ||
            does.kind === "uncrit" ||
            does.kind === "reroll_hit" ||
            (does.kind === "ac_vs_hit" && Boolean(does.rangeFt)) ||
            (does.kind === "echo_hit" && Boolean(hit.attackerId)) ||
            (does.kind === "disadv_vs_hit" && (Boolean(does.anyAlly) || (Boolean(does.allyWith) && holdsFeature(sheet, does.allyWith!)))) ||
            does.kind === "echo_takes_hit" ||
            (does.kind === "resist_instance" && !does.bond && typed(does.types));
      if (!answers) continue;
      // A reach measured from the holder's own area on the board (Guardian
      // Coil's 10 feet from the tentacle): the creature hurt, the holder too.
      if (does.kind === "reduce" && does.nearZone && !inReach(feet, zoneFeetKey(does.nearZone.spell, hit.characterId), does.nearZone.feet)) continue;
      // Within its reach: the ally it covers, or for Rebuke the Violent the
      // attacker ("an attacker within 30 feet of you"). Chronal Shift's reach
      // is to the attacker whoever it hit, the holder too.
      const reach = "rangeFt" in does ? reachAt(does.rangeFt as number | Array<[number, number]> | undefined, held.level) : undefined;
      const toRoller = does.kind === "reroll_hit" && Boolean(does.roller);
      if (whose === "ally" || toRoller) {
        if (!inReach(feet, does.kind === "echo_hit" || toRoller ? hit.attackerId : hit.characterId, reach)) continue;
      }
      // A strike back with a reach reaches the attacker, as the engine measures it
      // (authored-reactions.ts strike_back): a card for one 25 feet off was refused.
      if (does.kind === "strike_back" && !inReach(feet, hit.attackerId, reach)) continue;
      // Instinctive Charm sways an attacker within its 30 feet.
      const charm = does.kind === "redirect" && Boolean(does.save);
      if (charm && !inReach(feet, hit.attackerId, reach)) continue;
      const rules = reactionRules(does, hit);
      if (!rules) continue;
      // Misdirection's player picks the creature giving cover; Instinctive
      // Charm's attacker turns on the creature closest to it, which the
      // engine finds on the board (redirect-target.ts), so its card asks
      // for nobody.
      const misdirects = does.kind === "redirect" && !charm;
      const target: HandTarget = does.kind === "strike_back" || misdirects ? "enemy" : whose === "ally" ? "ally" : "none";
      // A redirect lands on a creature beside the holder (use_reaction's 5 feet),
      // Instinctive Charm reaches the attacker, a melee strike back has no
      // reach of its own on record, and Shadow Martyr's only bar is seeing
      // the ally and the attacker.
      const range =
        misdirects
          ? reachLabel(REDIRECT_FT)
          : charm
            ? reachLabel(reach)
          : target === "none" && !toRoller
            ? "Self"
            : does.kind === "strike_back" && does.melee && reach === undefined
              ? "Melee"
              : does.kind === "echo_takes_hit"
                ? "Sight"
                : reachLabel(reach);
      out.push({
        name: reaction.name,
        rules,
        target,
        range,
        // Asked by what it does to the hit, as the engine asks it (reaction-tools.ts).
        fallen: timingOfDoes(does) === "answers",
        ...(misdirects ? { pickWithin: REDIRECT_FT } : {}),
        // Glorious Defense: the miss "lets you attack", so the card asks. The
        // attack comes first, as most paladins take it (ruling R6).
        ...(does.kind === "ac_vs_hit" && does.strikeOnMiss
          ? { choice: { arg: "variant", label: "On a miss", options: [{ value: "attack", label: "Attack the attacker" }, { value: "no attack", label: "No attack" }] } }
          : {}),
      });
    }
  }
  return out;
}

// Whether the holder's mark (Armor of Hexes' Hexblade's Curse) names this
// attacker, as use_reaction asks it (authored-reactions.ts chance_miss).
function markedBy(sheet: CharacterSheet, mark: string, attackerId: string | null | undefined): boolean {
  const held = sheet.conditions.find((entry) => isConditionNamed(entry, mark));
  const quarry = held ? (sheet.conditionMeta as Record<string, { quarry?: string } | undefined> | undefined)?.[held]?.quarry : undefined;
  return Boolean(quarry && quarry === attackerId);
}

// The creatures a card's player may pick from: for a redirect those beside the
// holder other than the attacker, friend or foe. One the board gives no distance
// for is offered, and the engine judges it, as inReach does; so does whether it
// stands between the attacker and the holder, which the Hand cannot see.
export function reactionPicks<T extends { id: string }>(card: HandCard, foes: T[], feet?: Record<string, number>): T[] {
  return card.pickWithin === undefined ? foes : pickableFoes(foes, card.pickWithin, card.answers, feet);
}

// Neither the attacker nor the holder, whose own hit a redirect answers (the
// holder of another hero's card is a chip like any ally's).
function pickableFoes<T extends { id: string }>(foes: T[], within: number, hit: HandCard["answers"], feet?: Record<string, number>): T[] {
  return foes.filter((foe) => foe.id !== hit?.attackerId && foe.id !== hit?.characterId && !((feet?.[foe.id] ?? 0) > within));
}

// The ally or attacker a reaction card is aimed at, fixed by the hit it
// answers rather than picked.
export function reactionAim(
  card: HandCard,
  hits: PublicLastHit[],
  sheetId: string,
  party: Array<Pick<CharacterSheet, "id" | "name">>,
): { id: string; name: string; kind: "enemy" | "ally" } | null {
  // The card's own id, without the hero another character's card names
  // (offTurnReactionCards); that hero is `sheetId` here.
  const id = card.id.split("@")[0];
  if (card.pickWithin !== undefined) {
    return null;
  }
  // Commander's Strike's target is the player's pick, and so is the creature a
  // reaction with two aims is spent on (Cauterizing Flames answers no hit, so an
  // open hit's attacker would be the wrong creature).
  if ((card.target === "enemy" && (id === "reaction:commanders-strike" || id === `reaction:${HAWK_CARD}`)) || (card.intent?.card === "reaction" && card.intent.variant)) {
    return null;
  }
  if (card.target === "enemy") {
    // The attacker of the hit it answers: with two enemies' hits open, the
    // first hit's attacker was the aim of every card (issue 685).
    if (card.answers) {
      return card.answers.attackerId ? { id: card.answers.attackerId, name: card.answers.attacker, kind: "enemy" } : null;
    }
    const mine = hits.find((hit) => hit.characterId === sheetId && hit.attackerId);
    return mine?.attackerId ? { id: mine.attackerId, name: mine.attacker, kind: "enemy" } : null;
  }
  if (card.target === "ally") {
    const allyId = card.answers?.characterId ?? id.split(":").pop() ?? "";
    const ally = party.find((entry) => entry.id === allyId);
    return ally ? { id: ally.id, name: ally.name, kind: "ally" } : null;
  }
  return null;
}
