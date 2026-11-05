// The creature picker on a summoning spell's card and on the sheet's
// summoning door (issue 685). A Conjure Animals card used to carry no
// creature, so the engine could not cast it: at a table a person runs it
// waited in the GM's "Waiting on you" list until the GM entered it again by
// hand, and an AI GM picked the beasts itself; a Find Steed or an Animate
// Dead had no card at all and was typed. The pick now comes from the
// server's own catalogue (the stat blocks the cast spawns,
// src/lib/srd/summon-spells.ts summonCatalogue, familiar-forms.ts), as the
// SRD 5.1 text gives it to the caster:
//
// - the creature, and how many where the spell lets its caster choose
//   (Conjure Animals' one, two, four or eight), sent as cast_buff's
//   `variant` and `count`;
// - the kind the creature is instead of its own (Find Steed's and Find
//   Familiar's celestial, fey or fiend), sent with the creature ("fey
//   Warhorse"), as the engine reads it;
// - each target's own form where the spell gives one per target (Animate
//   Dead's bones or corpse, Animate Objects' sizes), sent as `mix` and held
//   to the slot's budget.
//
// A spell with one creature and nothing else to choose (Unseen Servant)
// asks nothing.
//
// Pure: the Hand derives its cards from it (hand-spells.ts), the aim bar
// and the door show it (HandSummonPick.tsx, SummonDoor.tsx), and
// scripts/test-summon-picker.mjs holds it to the engine's own counts.
import type { SummonCatalogue } from "@/lib/srd/summon-spells";
import { lowestSlot, type HandCard, type HandChoice, type HandSummon, type SpellFact } from "@/lib/battlemap/hand-core";
import { casterStateProblem, componentProblem, focusProblem, materialPlan } from "@/lib/dm/cast-rules";
import { castingOf, completedCastingOf } from "@/lib/dm/long-casting-logic";
import { bundledSpellFacts } from "@/lib/srd/spell-facts";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { BoardControl } from "@/lib/addons/board-bridge";

// A challenge rating as the SRD prints it.
export function crText(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

const title = (word: string) => word.replace(/^./, (c) => c.toUpperCase());

// The pick at this slot: the creatures the spell can call there, each with
// its statistics as the option's note and the numbers it may come in, the
// kinds and the per-target budget where the spell has them; or null when
// there is nothing to choose. Listed under their challenge ratings when the
// spell calls by rating, in the spell's own order when it names its forms.
export function summonPick(catalogue: SummonCatalogue | undefined, slotLevel: number): { choice: HandChoice; summon: HandSummon } | null {
  if (!catalogue) return null;
  const slot = String(slotLevel);
  const forms = catalogue.forms.filter((form) => (form.counts[slot] ?? []).length > 0);
  const kinds = catalogue.kinds && catalogue.kinds.length > 1 ? catalogue.kinds : null;
  const budget = catalogue.perTarget?.budgets[slot];
  if (!forms.length || (forms.length < 2 && !kinds)) return null;
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
      forms: Object.fromEntries(forms.map((form) => [form.name, { counts: form.counts[slot], ...(byRating ? { group: `CR ${crText(form.cr)}` } : {}) }])),
      ...(kinds ? { kinds: kinds.map((kind) => ({ value: kind, label: title(kind) })) } : {}),
      ...(catalogue.perTarget && budget ? { mix: { budget, cost: catalogue.perTarget.cost } } : {}),
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

// The kind picked, else the engine's own first (Find Steed's celestial).
export function summonKind(card: Pick<HandCard, "summon">, picked?: string): string | null {
  const kinds = card.summon?.kinds;
  if (!kinds?.length) return null;
  return kinds.some((kind) => kind.value === picked) ? picked! : kinds[0].value;
}

// A per-target casting's forms with a number each, as cast_buff's mix: only
// forms the card offers, none above what the budget leaves. Empty when the
// player has given none.
export function summonMix(card: Pick<HandCard, "summon">, picked: Record<string, number> = {}): Array<{ variant: string; count: number }> {
  const summon = card.summon;
  if (!summon?.mix) return [];
  let left = summon.mix.budget;
  const out: Array<{ variant: string; count: number }> = [];
  for (const form of Object.keys(summon.forms)) {
    const cost = summon.mix.cost[form] ?? 1;
    const count = Math.min(Math.max(0, Math.floor(picked[form] ?? 0)), Math.floor(left / cost));
    if (count > 0) {
      out.push({ variant: form, count });
      left -= count * cost;
    }
  }
  return out;
}

// One press on a per-target form's stepper: one more while the budget has
// room for it, one fewer down to none.
export function stepMix(card: Pick<HandCard, "summon">, picked: Record<string, number>, form: string, delta: 1 | -1): Record<string, number> {
  const summon = card.summon;
  if (!summon?.mix || !summon.forms[form]) return picked;
  const used = summonMix(card, picked).reduce((sum, entry) => sum + entry.count * (summon.mix!.cost[entry.variant] ?? 1), 0);
  const cost = summon.mix.cost[form] ?? 1;
  const now = picked[form] ?? 0;
  const next = delta > 0 ? (used + cost <= summon.mix.budget ? now + 1 : now) : Math.max(0, now - 1);
  return { ...picked, [form]: next };
}

// What the budget has left, in its own units (objects for Animate Objects).
export function mixLeft(card: Pick<HandCard, "summon">, picked: Record<string, number> = {}): number {
  const summon = card.summon;
  if (!summon?.mix) return 0;
  return summon.mix.budget - summonMix(card, picked).reduce((sum, entry) => sum + entry.count * (summon.mix!.cost[entry.variant] ?? 1), 0);
}

export type SummonChoices = { form?: string | null; count?: number; kind?: string; mix?: Record<string, number> };

// The creature picked, or the only one when the spell calls one (its kind
// is the choice then).
function pickedForm(card: Pick<HandCard, "summon">, form: string | null | undefined): string | null {
  const forms = Object.keys(card.summon?.forms ?? {});
  return form && card.summon?.forms[form] ? form : forms.length === 1 ? forms[0] : null;
}

// Whether the pick is whole: a creature picked, or a per-target form given.
export function summonReady(card: Pick<HandCard, "summon">, choices: SummonChoices): boolean {
  if (!card.summon) return true;
  if (card.summon.mix) return summonMix(card, choices.mix).length > 0;
  return pickedForm(card, choices.form) !== null;
}

// The card's summon fields as the intent carries them (cast_buff's own
// argument names): the mix for a per-target spell, else the creature (with
// its kind) and its number.
export function summonIntent(card: Pick<HandCard, "summon">, choices: SummonChoices): { variant?: string; count?: number; mix?: Array<{ variant: string; count: number }> } {
  if (!card.summon) return {};
  if (card.summon.mix) {
    const mix = summonMix(card, choices.mix);
    return mix.length ? { mix } : {};
  }
  const form = pickedForm(card, choices.form);
  if (!form) return {};
  const kind = summonKind(card, choices.kind);
  const count = summonCount(card, form, choices.count);
  return { variant: kind ? `${kind} ${form}` : form, ...(count ? { count } : {}) };
}

// The pick in words: "Wolf, 8 of them", "Fey Warhorse", "2 Skeleton and
// 1 Zombie".
export function summonWords(card: Pick<HandCard, "summon">, choices: SummonChoices): string | null {
  const fields = summonIntent(card, choices);
  if (fields.mix) {
    const parts = fields.mix.map((entry) => `${entry.count} ${entry.variant}`);
    return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  }
  if (!fields.variant) return null;
  return summonPhrase(title(fields.variant), fields.count ?? null);
}

// The creature and its number in words: "Wolf, 8 of them", "Giant Elk".
export function summonPhrase(label: string, count: number | null): string {
  return count && count > 1 ? `${label}, ${count} of them` : label;
}

// The board view's own Hand panel (Hand.tsx nativePanel), over the bridge's
// offered controls (src/lib/addons/board-bridge.ts offeredBoardControl,
// which holds a reply to the options sent): the number of the creature
// picked ("hand-count"), when it may come in more than one number, and a
// per-target spell's forms as one more or one fewer each ("hand-mix",
// "Skeleton:+"), as the Hand's own stepper takes them.
export function summonBoardControls(card: Pick<HandCard, "summon">, choices: SummonChoices): BoardControl[] {
  const summon = card.summon;
  if (!summon) return [];
  if (summon.mix) {
    const left = mixLeft(card, choices.mix);
    const options = Object.keys(summon.forms).flatMap((form) => {
      const now = choices.mix?.[form] ?? 0;
      const cost = summon.mix!.cost[form] ?? 1;
      return [
        { value: `${form}:+`, label: `One more ${form} (${now})`, disabled: left >= cost ? null : "The slot's budget is spent." },
        { value: `${form}:-`, label: `One fewer ${form}`, disabled: now > 0 ? null : `No ${form} yet.` },
      ];
    });
    return [{ id: "hand-mix", label: `Each target's form (${left} left)`, disabled: null, options }];
  }
  const form = pickedForm(card, choices.form);
  const counts = form ? summon.forms[form].counts : [];
  if (counts.length < 2) return [];
  const chosen = summonCount(card, form, choices.count);
  return [{ id: "hand-count", label: "Number", value: String(chosen), disabled: null, options: counts.map((count) => ({ value: String(count), label: String(count), disabled: null })) }];
}

// A board control's reply as the pick it stands for: a number from
// "hand-count", a form's step from "hand-mix". The value was already held to
// the offer by offeredBoardControl.
export function readSummonControl(id: "hand-count" | "hand-mix", value: string): { count: number } | { form: string; delta: 1 | -1 } | null {
  if (id === "hand-count") {
    const count = Number.parseInt(value, 10);
    return Number.isInteger(count) && count > 0 ? { count } : null;
  }
  const at = value.lastIndexOf(":");
  const step = value.slice(at + 1);
  return at > 0 && (step === "+" || step === "-") ? { form: value.slice(0, at), delta: step === "+" ? 1 : -1 } : null;
}

// ---- the GM console's summon fields (catalog-combat.ts cast_buff) ----

// Whether the console shows a summon field for the spell its form names: the
// kind for a spell whose creature is made one (Find Steed), each target's
// form for a per-target spell (Animate Dead). Hidden fields send nothing.
export function consoleSummonShown(kind: string, catalogue: SummonCatalogue | null | undefined): boolean {
  if (kind === "summonKind") return Boolean(catalogue?.kinds && catalogue.kinds.length > 1);
  if (kind === "summonMix") return Boolean(catalogue?.perTarget);
  return true;
}

// The console's form value for each target's form, a list of rows, as the
// card's per-form numbers, and back.
export function mixRecord(rows: ReadonlyArray<{ variant: string; count: number }>): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.variant, row.count]));
}

// ---- the sheet's summoning door (SummonDoor.tsx) ----

// One summoning spell on the sheet as the door offers it. The Hand deals the
// spells cast in one action, in a fight; everything else was typed, and an
// AI GM or the GM's console picked the creature. Out of a fight the door
// casts it whole ("cast"), as a ritual too when the caster may. In a fight a
// spell of a minute or more is begun with the turn's action ("begin"), held
// across the caster's turns ("casting"), and finished with the creature
// picked once its rounds have run out ("finish"); one cast in an action is
// the Hand's there ("hand").
export type SummonDoorRow = {
  spell: string;
  level: number;
  state: "cast" | "begin" | "casting" | "finish" | "hand";
  // The slot it spends, or the one its casting was begun with.
  slotLevel: number | null;
  // It may be cast as a ritual now (out of a fight), or was begun as one.
  ritual: boolean;
  pick: { choice: HandChoice; summon: HandSummon } | null;
  // The only creature, when there is nothing to pick (Phantom Steed).
  only: string | null;
  roundsLeft?: number;
  // Why it cannot be cast now (no slot left), or null.
  disabled: string | null;
  // Why it cannot be cast at all now, as a ritual either: the cast guard's
  // own sentence (raging, no free hand, no pouch or focus, a costly material
  // neither carried nor affordable), or null.
  blocked: string | null;
};

// The cast guard's refusals the Hand's spell card carries (hand-spells.ts),
// asked of the door's casting too: without them Find Familiar's 10 gp of
// charcoal was found missing only once Cast or Cast as a ritual was pressed.
// The facts are the table's own where the sheet has fetched them, as the
// Hand's are (useHandSpells), the bundled ones until then.
function castBlocked(sheet: CharacterSheet, spell: string, inFight: boolean, slotLevel: number, fetched: SpellFact | undefined): string | null {
  const facts = fetched?.facts ?? bundledSpellFacts(spell);
  const material = materialPlan(sheet, facts, { inFight, slotLevel });
  return (casterStateProblem(sheet) ?? componentProblem(sheet, facts) ?? focusProblem(sheet, facts) ?? ("error" in material ? material : null))?.error ?? null;
}

export function summonDoorRows(
  sheet: CharacterSheet,
  names: readonly string[],
  catalogues: Record<string, SummonCatalogue>,
  inFight: boolean,
  spells: Record<string, SpellFact> = {},
): SummonDoorRow[] {
  const rows: SummonDoorRow[] = [];
  const held = castingOf(sheet);
  for (const spell of names) {
    const catalogue = catalogues[textKey(spell)];
    if (!catalogue?.forms.length) continue;
    const level = Math.min(...Object.keys(catalogue.forms[0].counts).map(Number));
    const only = catalogue.forms.length === 1 ? catalogue.forms[0].name : null;
    const base = { spell, level, only };
    if (inFight && !catalogue.long) {
      rows.push({ ...base, state: "hand", slotLevel: null, ritual: false, pick: null, disabled: null, blocked: null });
      continue;
    }
    if (inFight && held && textKey(held.spell) === textKey(spell)) {
      rows.push({ ...base, state: "casting", slotLevel: held.slotLevel, ritual: held.ritual, pick: null, roundsLeft: held.rounds, disabled: null, blocked: null });
      continue;
    }
    const done = inFight ? completedCastingOf(sheet, spell) : null;
    if (done) {
      rows.push({ ...base, state: "finish", slotLevel: done.slotLevel, ritual: done.ritual, pick: summonPick(catalogue, done.slotLevel ?? level), disabled: null, blocked: null });
      continue;
    }
    const slot = lowestSlot(sheet, level)?.level ?? null;
    const ritual = !inFight && Boolean(catalogue.ritual);
    rows.push({
      ...base,
      state: inFight ? "begin" : "cast",
      slotLevel: slot,
      ritual,
      pick: inFight ? null : summonPick(catalogue, slot ?? level),
      disabled: slot === null ? `No spell slot of level ${level} or higher is left${ritual ? "; it can still be cast as a ritual" : ""}.` : null,
      blocked: castBlocked(sheet, spell, inFight, slot ?? level, spells[textKey(spell)]),
    });
  }
  return rows.filter((row) => row.state !== "hand");
}

// What the door posts for a row: the sentence and the card (the summon's own
// fields under cast_buff's names). A ritual spends no slot; a casting begun
// in a fight names no creature yet; one finished names the only creature
// when there was nothing to pick, so the engine finishes it rather than
// beginning it again.
export function summonDoorPost(row: SummonDoorRow, choices: SummonChoices, asRitual = false): { content: string; intent: Record<string, unknown> } {
  const card = { summon: row.pick?.summon };
  const picked = row.state === "begin" ? {} : row.pick ? summonIntent(card, choices) : row.only ? { variant: row.only } : {};
  const words = row.pick ? summonWords(card, choices) : null;
  const ritual = asRitual || (row.state === "finish" && row.ritual);
  const slotLevel = ritual ? null : row.slotLevel;
  const slot = slotLevel ? ` using a level ${slotLevel} slot` : "";
  const named = words ? ` (${words})` : "";
  const content =
    row.state === "begin"
      ? `I begin casting ${row.spell}${slot}.`
      : row.state === "finish"
        ? `I finish casting ${row.spell}${named}.`
        : `I cast ${row.spell}${named}${asRitual ? " as a ritual" : slot}.`;
  return { content, intent: { card: "spell", spell: row.spell, slotLevel, ...picked, ...(ritual ? { ritual: true } : {}) } };
}
