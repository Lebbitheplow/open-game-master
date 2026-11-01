// The creature picker on a summoning spell's card (issue 685). A Conjure
// Animals card used to carry no creature, so the engine could not cast it:
// at a table a person runs it waited in the GM's "Waiting on you" list until
// the GM entered it again by hand, and an AI GM picked the beasts itself.
// The card now asks which creature, from the server's own catalogue (the
// stat blocks summonPlan spawns, src/lib/srd/summon-spells.ts
// summonCatalogue), and how many where the spell lets its caster choose
// (Conjure Animals' one, two, four or eight), and sends them as cast_buff's
// `variant` and `count`. A spell that calls one creature at the card's slot
// (Unseen Servant, Arcane Hand) asks nothing.
//
// Pure: the Hand derives its cards from it (hand-spells.ts), the aim bar
// shows it (HandSummonPick.tsx), and scripts/test-summon-picker.mjs holds it
// to the engine's own counts.
import type { SummonCatalogue } from "@/lib/srd/summon-spells";
import type { HandCard, HandChoice, HandSummon } from "@/lib/battlemap/hand-core";

// A challenge rating as the SRD prints it.
export function crText(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

// The card's pick at this slot: the creatures it can call there, each with
// its statistics as the option's note and the numbers it may come in, or
// null when there is only one (nothing to ask). Listed under their challenge
// ratings when the spell calls by rating, in the spell's own order when it
// names its forms (Giant Insect).
export function summonPick(catalogue: SummonCatalogue | undefined, slotLevel: number): { choice: HandChoice; summon: HandSummon } | null {
  if (!catalogue) return null;
  const forms = catalogue.forms.filter((form) => (form.counts[String(slotLevel)] ?? []).length > 0);
  if (forms.length < 2) return null;
  const byRating = catalogue.calls === "rating";
  return {
    choice: {
      arg: "variant",
      label: "Creature",
      options: forms.map((form) => ({ value: form.name, label: form.name, note: `CR ${crText(form.cr)} ${form.type}, AC ${form.ac}, ${form.hp} hit points` })),
      // Nothing is chosen for the player: the card waits for a pick.
      fallback: "",
    },
    summon: {
      forms: Object.fromEntries(
        forms.map((form) => [form.name, { counts: form.counts[String(slotLevel)], ...(byRating ? { group: `CR ${crText(form.cr)}` } : {}) }]),
      ),
    },
  };
}

// How many a summoning card brings of the creature picked: the number the
// player chose when that creature may come in it, else the most.
export function summonCount(card: Pick<HandCard, "summon">, form: string | null | undefined, picked?: number): number | null {
  const counts = form ? card.summon?.forms[form]?.counts : undefined;
  if (!counts?.length) return null;
  return picked !== undefined && counts.includes(picked) ? picked : counts[counts.length - 1];
}

// The creature and its number in words: "Wolf, 8 of them", "Giant Elk".
export function summonPhrase(label: string, count: number | null): string {
  return count && count > 1 ? `${label}, ${count} of them` : label;
}
