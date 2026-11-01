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
import { casterStateProblem, componentProblem, focusProblem } from "@/lib/dm/cast-rules";
import type { PublicLastHit } from "@/lib/db/encounter-view";
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
import { spellNames } from "@/lib/battlemap/hand-spells";
import { COMMANDED } from "@/lib/dm/maneuver-rules";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { holdsFeature, isNamed } from "@/lib/srd/feature-names";

// A Battle Master maneuver's card wears its painting.
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
    range: "Self",
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
  rules: string,
  target: HandTarget,
  hit: PublicLastHit,
  idTail = "",
): HandCard | null {
  if (!spellNames(sheet).some((name) => textKey(name) === textKey(spell))) return null;
  const facts = bundledSpellFacts(spell);
  const slot = lowestSlot(sheet, facts?.level ?? 1);
  const card = base(
    `${textKey(spell).replace(/\s+/g, "-")}${idTail}`,
    spell,
    prompt,
    target,
    aimedIntent({ card: "reaction", feature: spell, spell, slotLevel: slot?.level ?? null }, hit),
    { type: "spell", rules, resource: slot ? slotLine(slot) : "No slots", icon: { kind: "spell", key: spell, family: null }, ...answering(hit) },
  );
  const problem = (refusal: ToolError | null): Gate => (refusal ? { reason: refusal.error, spent: false } : null);
  return gated(
    card,
    standingGate(sheet, turn, "reaction"),
    problem(casterStateProblem(sheet)),
    problem(componentProblem(sheet, facts) ?? focusProblem(sheet, facts)),
    slot ? null : { reason: `${sheet.name} has no spell slot left for ${spell}.`, spent: true },
    costGate("reaction", turn, sheet, spell),
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
): HandCard[] {
  return heroes.flatMap(({ sheet, turn }) =>
    reactionCards(sheet, turn, hits, party, sheet.name).map((card) => ({
      ...card,
      id: `${card.id}@${sheet.id}`,
      actor: { id: sheet.id, name: sheet.name },
    })),
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
): HandCard[] {
  const cards: HandCard[] = [];
  const answered = (hit: PublicLastHit, name: string) =>
    hit.answered.some((entry) => textKey(entry) === textKey(name));
  // A hit among several on its character tags its cards' ids; one hit keeps
  // the ids it always had.
  const tail = (hit: PublicLastHit) =>
    hit.id && hits.filter((other) => other.characterId === hit.characterId).length > 1 ? `~${hit.id}` : "";
  const feature = (hit: PublicLastHit, name: string, prompt: string, rules: string, target: HandTarget = "none", icon?: HandCard["icon"]) => {
    if (answered(hit, name)) return;
    const card = base(
      `${textKey(name).replace(/\s+/g, "-")}:${hit.characterId}${tail(hit)}`,
      name,
      prompt,
      target,
      aimedIntent({ card: "reaction", feature: name }, hit),
      { rules, ...(icon ? { icon } : {}), ...answering(hit) },
    );
    cards.push(gated(card, standingGate(sheet, turn, "reaction"), costGate("reaction", turn, sheet, name)));
  };

  const mine = hits.filter((hit) => hit.characterId === sheet.id && hit.hit);
  const shieldable = mine.filter((hit) => hit.source === "attack" && !answered(hit, "Shield"));
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
  }
  for (const hit of mine) {
    const prompt = what(hit, self);
    if (hit.source === "attack") {
      if (holdsFeature(sheet, "uncanny dodge")) {
        feature(hit, "Uncanny Dodge", prompt, "Halve the damage of the attack that hit you.");
      }
      if (hit.ranged && holdsFeature(sheet, "deflect missiles")) {
        feature(hit, "Deflect Missiles", prompt, "Take 1d10 + DEX + monk level off a ranged weapon hit.");
      }
      if (hit.attackerId && !answered(hit, "Hellish Rebuke")) {
        const rebuke = spellReaction(sheet, turn, "Hellish Rebuke", prompt, `${hit.attacker} makes a DEX save against 2d10 fire.`, "enemy", hit, tail(hit));
        if (rebuke) cards.push(rebuke);
      }
    }
    if (hit.source === "fall" && holdsFeature(sheet, "slow fall")) {
      feature(hit, "Slow Fall", prompt, "Take five times your monk level off the fall.");
    }
    if (hit.source === "attack") {
      for (const held of subclassReactions(sheet, hit, "self")) {
        feature(hit, held.name, prompt, held.rules, held.target);
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
        feature(hit, "Parry", what(hit, self), "A superiority die plus your Dexterity modifier off the melee hit.", "none", MANEUVER_ICON("Parry"));
      }
    }
    if (knows("riposte")) {
      for (const missed of hits.filter((hit) => hit.characterId === sheet.id && !hit.hit && hit.source === "attack" && !hit.ranged && hit.attackerId)) {
        feature(missed, "Riposte", `${missed.attacker}'s ${missed.attack} missed ${self}`, "A melee attack back with your reaction, the die on its hit.", "enemy", MANEUVER_ICON("Riposte"));
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

  // An ally's hit: Cutting Words from a Lore bard, Protection from a
  // protector with a shield. The engine checks the reach and the holder.
  for (const hit of hits) {
    if (hit.characterId === sheet.id || !hit.hit || hit.source !== "attack") continue;
    const ally = party.find((entry) => entry.id === hit.characterId);
    if (!ally) continue;
    const prompt = what(hit, ally.name);
    if (holdsFeature(sheet, "cutting words") && (sheet.resources.bardic_inspiration?.max ?? 0) > (sheet.resources.bardic_inspiration?.used ?? 0)) {
      feature(hit, "Cutting Words", prompt, "Spend a Bardic Inspiration die off the roll or the damage.", "ally");
    }
    if (holdsFeature(sheet, "protection")) {
      feature(hit, "Protection", prompt, "Impose disadvantage on the attack: it is rolled again.", "ally");
    }
    for (const held of subclassReactions(sheet, hit, "ally")) {
      feature(hit, held.name, prompt, held.rules, "ally");
    }
  }
  return cards;
}

// The reaction cards the moment offers, then the hand without the cards they
// answer for: a prepared Shield sits in the hand as a spell card, and while
// the prompt offers Shield against the hit it is one choice, shown once.
export function withReactions(reactions: HandCard[], hand: HandCard[]): HandCard[] {
  if (!reactions.length) return hand;
  const offered = new Set(reactions.map((card) => textKey(card.name)));
  return [...reactions, ...hand.filter((card) => !(card.cost === "reaction" && offered.has(textKey(card.name))))];
}

// What a subclass reaction does, in a line for its card.
function reactionRules(does: ReactionDoes): string {
  switch (does.kind) {
    case "reduce":
      return does.amount === "half" ? "Halve the damage of the attack that hit." : "Take damage off the attack that hit.";
    case "ac_vs_hit":
      return "Raise the AC against the attack that hit: a swing it beats misses.";
    case "disadv_vs_hit":
      return "The attack that hit is rolled again at disadvantage.";
    case "resist_instance":
      return "Resistance to the damage of the attack that hit.";
    case "take_for_ally":
      return "Take the hit in your ally's place.";
    case "strike_back":
      return `Strike back: ${does.type} damage at the attacker.`;
    case "redirect":
      return "The hit lands on the creature beside you instead.";
    case "force_miss":
      return `The hit becomes a miss, for ${does.exhaustion} level${does.exhaustion === 1 ? "" : "s"} of exhaustion.`;
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
): Array<{ name: string; rules: string; target: HandTarget }> {
  const out: Array<{ name: string; rules: string; target: HandTarget }> = [];
  for (const held of heldAuthored(sheet)) {
    for (const reaction of held.entry.reactions ?? []) {
      if ((reaction.usedBy ?? "holder") !== "holder" || !gateHolds(reaction.gate, sheet, held)) continue;
      const pool = reaction.pool;
      if (pool && "id" in pool) {
        const state = sheet.resources[pool.id];
        if (!state || state.max - state.used < (pool.amount ?? 1)) continue;
      }
      const does = reaction.does;
      const typed = (types?: string[]) => !types?.length || types.includes(hit.type);
      const answers =
        whose === "self"
          ? (does.kind === "reduce" && does.who !== "ally" && typed(does.types)) ||
            does.kind === "ac_vs_hit" ||
            does.kind === "disadv_vs_hit" ||
            (does.kind === "resist_instance" && typed(does.types)) ||
            does.kind === "redirect" ||
            does.kind === "force_miss" ||
            (does.kind === "strike_back" && Boolean(hit.attackerId))
          : (does.kind === "reduce" && does.who !== "self" && typed(does.types)) ||
            does.kind === "take_for_ally" ||
            (does.kind === "resist_instance" && typed(does.types));
      if (!answers) continue;
      const rules = reactionRules(does);
      if (!rules) continue;
      out.push({ name: reaction.name, rules, target: does.kind === "strike_back" ? "enemy" : whose === "ally" ? "ally" : "none" });
    }
  }
  return out;
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
  // Commander's Strike's target is the player's pick.
  if (card.target === "enemy" && id === "reaction:commanders-strike") {
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
