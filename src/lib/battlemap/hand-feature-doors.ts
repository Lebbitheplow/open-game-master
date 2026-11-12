// The Hand's cards for the doors the engine answers by a feature's name with
// no counter card to stand for them, so a player had to type the call:
//
//   - Pact of the Blade: create the pact weapon in a form picked on the card
//     (or the bonded weapon, which comes back as itself), and dismiss it
//     (src/lib/dm/mt-srd-warlock.ts pactOfTheBlade, use_resource variant).
//   - War Caster: the spell the opportunity attacks cast, or the weapon again
//     (ar-wbf-feat-warcaster.ts warCasterChoice), offering only the spells
//     its rule takes (ar-wbf-feat-warcaster-rule.ts).
//   - Telekinetic: the shove, at a foe or at an ally (ar-wbf-feat-doors.ts).
//   - Arcane Abeyance: the spell cast into a bead, which directCardCall sends
//     as use_spell_slot with storeIn (src/lib/dm/intent-logic.ts), so the cast
//     guard charges the slot as for any casting (ar-ws-abeyance.ts).
//   - Master Scrivener: the scroll written from the book, out of a fight
//     (ar-ws-scrivener.ts).
//   - Mantle of Inspiration's stride: the reaction move of a creature the
//     mantle just gave temporary hit points, to a square picked on the board
//     (ar-wbf-bard-mantle.ts mantleMove), dealt with the reactions
//     (hand-react.ts).
//
// Each card carries the gate its door refuses by, so none stands open for a
// call the engine would turn down. Pure; scripts/test-hand-feature-doors.mjs
// plays each one the way the Hand sends it.
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { costGate, gated, primaryClass, standingGate, type Gate, type HandCard, type HandTarget, type HandTurn } from "@/lib/battlemap/hand-core";
import type { HandArea } from "@/lib/battlemap/hand-area";
import { inFightOf } from "@/lib/battlemap/hand-counters";
import { spellNames } from "@/lib/battlemap/hand-spells";
import { opportunitySpellOf, opportunitySpellProblem } from "@/lib/dm/ar-wbf-feat-warcaster-rule";
import { TELEKINETIC_FEET, telekineticAbility } from "@/lib/dm/ar-wbf-feat-doors-logic";
import { computeSheetDerived } from "@/lib/srd";
import { BEAD_SLOT } from "@/lib/srd/ar-ws-conjured";
import { bookEntries } from "@/lib/srd/ar-ws-spellbook";
import { holdsFeat } from "@/lib/srd/feat-use";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import { holdsPactOfTheBlade } from "@/lib/srd/pact-weapon";
import { bundledSpellFacts } from "@/lib/srd/spell-facts";
import { spellMechFor } from "@/lib/srd/spell-mechanics";
import { bakedSpellMech } from "@/lib/content/baked-spells";
import { SRD_WEAPONS, SRD_WEAPON_WEIGHT_LB } from "@/lib/srd/weapons";

// The mark a Glamour bard's mantle leaves on each creature it chose, which
// the stride spends (ar-wbf-bard-mantle.ts markMantleStride).
export const MANTLE_STRIDE = "mantle's stride";

const PACT = "Pact of the Blade";
const SCRIVENER = "Master Scrivener";
const SCRIVENER_COUNTER = "sub_master_scrivener";
const ABEYANCE_COUNTER = "sub_arcane_abeyance";

// The counters whose card is dealt here rather than as the plain counter's
// (hand-spells.ts featureCards): that card sent the counter's id with no
// spell, which the bead's casting and the scroll's book both need.
export const DOOR_COUNTERS: readonly string[] = [ABEYANCE_COUNTER, SCRIVENER_COUNTER];
const MANTLE = "Mantle of Inspiration";

type Parts = Partial<HandCard> & Pick<HandCard, "id" | "name" | "cost" | "rules" | "intent">;

function door(sheet: CharacterSheet, parts: Parts): HandCard {
  return {
    type: "feature",
    range: "Self",
    dice: "",
    roll: "no roll",
    resource: "",
    condition: "",
    icon: { kind: "feature", key: parts.name, family: `class-${primaryClass(sheet)}` },
    target: "none" as HandTarget,
    toHit: null,
    damage: null,
    damageType: "",
    heals: false,
    save: null,
    melee: false,
    disabled: null,
    spent: false,
    compose: false,
    ...parts,
  };
}

const usesGate = (sheet: CharacterSheet, counter: string, name: string): Gate => {
  const state = sheet.resources[counter];
  return state && state.max - state.used < 1 ? { reason: `${name} has no use left (0/${state.max}). It comes back after a rest.`, spent: true } : null;
};

const usesLine = (sheet: CharacterSheet, counter: string) => {
  const state = sheet.resources[counter];
  return state ? `Uses ${state.max - state.used}/${state.max}` : "";
};

const spellLevel = (name: string) => bundledSpellFacts(name)?.level ?? null;

// ---- Pact of the Blade ----

// The rows the pact made or bonded (src/lib/srd/pact-weapon.ts reads the same
// marks): `conjured:<warlock>` for a weapon the action made, "bonded" or
// "stowed" for the magic weapon the ritual bound.
const conjuredBy = (sheet: CharacterSheet) => (item: EquipmentItem) => item.pact === `conjured:${sheet.id}`;

function pactCards(sheet: CharacterSheet, turn: HandTurn): HandCard[] {
  if (!holdsPactOfTheBlade(sheet)) return [];
  const conjured = sheet.equipment.find(conjuredBy(sheet)) ?? null;
  const bonded = sheet.equipment.find((item) => item.pact === "bonded" || item.pact === "stowed") ?? null;
  // A bonded weapon is the one the action brings back; any other is a form
  // of an SRD 5.1 melee weapon (the rows its Weapons table weighs), picked
  // on the card. The genre kits' blades (a Vibroknife, a Censer Mace) are not
  // the SRD's, and filled a fantasy warlock's card with them.
  const forms = SRD_WEAPONS.filter((weapon) => weapon.kind === "melee" && weapon.name in SRD_WEAPON_WEIGHT_LB);
  const current = conjured?.srdName ?? null;
  const create = door(sheet, {
    id: "feature:pact-of-the-blade",
    name: PACT,
    cost: "action",
    dice: bonded ? `Summon ${bonded.name}` : "A melee weapon",
    rules: bonded
      ? `${bonded.name}, your bonded pact weapon, appears in your empty hand.`
      : "A melee weapon of the form you choose appears in your empty hand. You are proficient with it, and it counts as magical.",
    intent: { card: "feature", resourceId: PACT },
    ...(bonded
      ? {}
      : {
          choice: {
            arg: "variant" as const,
            label: "Form",
            options: forms.map((weapon) => ({ value: weapon.name, label: weapon.name, note: weapon.damage })),
            fallback: current ?? "Longsword",
          },
        }),
  });
  const cards = [gated(create, standingGate(sheet, turn, "action"), costGate("action", turn, sheet, PACT))];
  // "if you dismiss the weapon (no action required)": open while one is out.
  if (conjured || bonded?.pact === "bonded") {
    cards.push(
      door(sheet, {
        id: "feature:pact-of-the-blade:dismiss",
        name: `${PACT} (dismiss)`,
        cost: "free",
        dice: `Dismiss ${conjured?.name ?? bonded?.name}`,
        rules: conjured ? `${conjured.name} vanishes.` : `${bonded?.name} goes into its extradimensional space until you create your pact weapon again.`,
        icon: { kind: "feature", key: PACT, family: `class-${primaryClass(sheet)}` },
        intent: { card: "feature", resourceId: PACT, variant: "dismiss" },
      }),
    );
  }
  return cards;
}

// ---- War Caster ----

// The spells this War Caster's opportunity attacks may cast: one action, one
// creature (the door's own rule), from what the sheet casts.
export function warCasterSpells(sheet: CharacterSheet): string[] {
  return spellNames(sheet).filter((name) => {
    const facts = bundledSpellFacts(name);
    return facts !== null && opportunitySpellProblem(facts.name, facts.castingTime, spellMechFor([facts.name]) ?? bakedSpellMech(facts.name)) === null;
  });
}

function warCasterCards(sheet: CharacterSheet, turn: HandTurn): HandCard[] {
  if (!holdsFeat(sheet, "War Caster")) return [];
  const spells = warCasterSpells(sheet);
  if (!spells.length) return [];
  const current = opportunitySpellOf(sheet);
  const card = door(sheet, {
    id: "feature:war-caster",
    name: "War Caster",
    cost: "free",
    dice: current ? `Opportunity: ${current}` : "Opportunity: weapon",
    rules: "Choose the spell your opportunity attacks cast: one action, one creature. It stays chosen until you choose again.",
    intent: { card: "feature", resourceId: "War Caster" },
    choice: {
      arg: "variant",
      label: "Opportunity attack",
      options: [{ value: "weapon", label: "Weapon" }, ...spells.map((name) => ({ value: name, label: name }))],
      fallback: current ?? "weapon",
    },
  });
  return [gated(card, standingGate(sheet, turn, "free"))];
}

// ---- Telekinetic ----

function telekineticCards(sheet: CharacterSheet, turn: HandTurn): HandCard[] {
  if (!holdsFeat(sheet, "Telekinetic")) return [];
  const derived = computeSheetDerived(sheet);
  const dc = 8 + derived.proficiencyBonus + derived.abilityMods[telekineticAbility(sheet)];
  const away = inFightOf(turn) === false ? { reason: "Telekinetic's shove moves a creature on the battle map of a fight.", spent: false } : null;
  const shove = (target: "enemy" | "ally"): HandCard =>
    gated(
      door(sheet, {
        id: `feature:telekinetic${target === "ally" ? ":ally" : ""}`,
        name: target === "ally" ? "Telekinetic (ally)" : "Telekinetic",
        cost: "bonus",
        range: `${TELEKINETIC_FEET} ft`,
        dice: target === "ally" ? "Shove 5 ft" : "STR save",
        roll: target === "ally" ? "no roll" : "no attack",
        rules: target === "ally"
          ? "A willing ally you can see is moved 5 feet straight away from you."
          : "A creature you can see makes a Strength save or is moved 5 feet straight away from you.",
        target,
        ...(target === "enemy" ? { save: { ability: "STR", dc } } : { othersOnly: true }),
        icon: { kind: "feature", key: "Telekinetic", family: null },
        intent: { card: "feature", resourceId: "Telekinetic" },
      }),
      standingGate(sheet, turn, "bonus"),
      costGate("bonus", turn, sheet, "Telekinetic"),
      away,
    );
  return [shove("enemy"), shove("ally")];
}

// ---- Arcane Abeyance and Master Scrivener ----

// The spells the bead may hold: "a spell of 4th level or lower", from the
// hand's own spell cards (hand-spells.ts), so a spell the cast guard would
// refuse now (silenced, no hand free, no slot) is not offered, and with none
// open the card says why the first one is shut.
function abeyanceCards(sheet: CharacterSheet, turn: HandTurn, spells: HandCard[]): HandCard[] {
  if (!sheet.resources[ABEYANCE_COUNTER] || !holdsFeature(sheet, "Arcane Abeyance")) return [];
  const spellOf = (card: HandCard) => (card.intent.card === "spell" ? card.intent.spell : "");
  const fits = spells.filter((card) => spellOf(card) && !card.fromItem && card.level !== undefined && card.level >= 1 && card.level <= 4);
  const names = [...new Set(fits.map(spellOf))];
  if (!names.length) return [];
  // The spells cast with an action first: the card is priced by the first
  // pick, which is what it sends when the player picks none.
  const costOf = (name: string) => fits.find((card) => spellOf(card) === name)?.cost ?? "action";
  const open = names.filter((name) => fits.some((card) => spellOf(card) === name && !card.disabled)).sort((a, b) => Number(costOf(a) !== "action") - Number(costOf(b) !== "action"));
  const shut = fits.find((card) => card.disabled);
  const cost = costOf(open[0] ?? names[0]);
  const card = door(sheet, {
    id: "feature:arcane-abeyance",
    name: "Arcane Abeyance",
    cost,
    dice: "A spell into a bead",
    rules: "Cast a spell of 4th level or lower into a bead. It has no effect now; whoever breaks the bead within the hour casts it with your numbers.",
    resource: usesLine(sheet, ABEYANCE_COUNTER),
    pool: ABEYANCE_COUNTER,
    intent: { card: "feature", resourceId: BEAD_SLOT },
    choice: { arg: "variant", label: "Spell", options: (open.length ? open : names).map((name) => ({ value: name, label: name, note: `level ${spellLevel(name)}` })) },
  });
  return [
    gated(
      card,
      usesGate(sheet, ABEYANCE_COUNTER, "Arcane Abeyance"),
      open.length ? null : { reason: shut?.disabled ?? `${sheet.name} can cast none of these spells now.`, spent: shut?.spent ?? false },
      standingGate(sheet, turn, cost === "bonus" ? "bonus" : cost === "reaction" ? "reaction" : "action"),
      costGate(cost, turn, sheet, "Arcane Abeyance"),
    ),
  ];
}

function scrivenerCards(sheet: CharacterSheet, turn: HandTurn): HandCard[] {
  const spells = scrivenerSpells(sheet);
  if (!spells.length) return [];
  const card = door(sheet, {
    id: "feature:master-scrivener",
    name: SCRIVENER,
    cost: "free",
    dice: "A scroll from the book",
    rules: "Write a scroll of a 1st- or 2nd-level spell from your book. It is cast one level higher, and fades at your next long rest.",
    resource: usesLine(sheet, SCRIVENER_COUNTER),
    pool: SCRIVENER_COUNTER,
    intent: { card: "feature", resourceId: SCRIVENER },
    choice: { arg: "variant", label: "Spell", options: spells.map((name) => ({ value: name, label: name, note: `level ${spellLevel(name)}` })) },
  });
  return [
    gated(
      card,
      usesGate(sheet, SCRIVENER_COUNTER, SCRIVENER),
      inFightOf(turn) === true ? { reason: `${SCRIVENER}'s scroll is written after a long rest, out of a fight.`, spent: false } : null,
    ),
  ];
}

// "a 1st- or 2nd-level wizard spell from your book with a casting time of
// an action" (ar-ws-scrivener.ts refuses any other).
function scrivenerSpells(sheet: CharacterSheet): string[] {
  if (!sheet.resources[SCRIVENER_COUNTER] || !holdsFeature(sheet, SCRIVENER)) return [];
  return bookEntries(sheet.spellcasting).map((entry) => entry.spell).filter((name) => {
    const facts = bundledSpellFacts(name);
    return facts !== null && facts.level >= 1 && facts.level <= 2 && facts.castingTime === "action";
  });
}

// The cards above, for the holder's own hand (hand.ts deriveHand), which
// passes the spell cards it dealt.
export function featureDoorCards(sheet: CharacterSheet, turn: HandTurn, spells: HandCard[] = []): HandCard[] {
  return [...pactCards(sheet, turn), ...warCasterCards(sheet, turn), ...telekineticCards(sheet, turn), ...abeyanceCards(sheet, turn, spells), ...scrivenerCards(sheet, turn)];
}

// ---- Mantle of Inspiration's stride ----

// The square the stride goes to, picked on the board (hand-area.ts move).
const STRIDE: HandArea = { spell: MANTLE, slotLevel: null, pick: "point", shape: "sphere", tone: "radiant", summary: "Up to your speed, drawing no opportunity attacks.", move: true };

// Dealt with the reactions (hand-react.ts reactionCards) to a creature the
// mantle marked, on the bard's turn.
export function mantleStrideCards(sheet: CharacterSheet, turn: HandTurn): HandCard[] {
  if (!sheet.conditions.some((entry) => isConditionNamed(entry, MANTLE_STRIDE))) return [];
  const card = door(sheet, {
    id: "reaction:mantle-of-inspiration",
    name: `${MANTLE} (move)`,
    cost: "reaction",
    dice: "Move your speed",
    rules: "Your reaction: move up to your speed without provoking opportunity attacks.",
    prompt: "The mantle's light lets you move",
    icon: { kind: "feature", key: MANTLE, family: null },
    area: STRIDE,
    intent: { card: "reaction", feature: MANTLE },
  });
  return [gated(card, standingGate(sheet, turn, "reaction"), costGate("reaction", turn, sheet, MANTLE))];
}
