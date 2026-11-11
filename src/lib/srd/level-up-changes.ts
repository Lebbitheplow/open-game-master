// The choices a level-up may change, beside the picks it adds. Two rules ask
// for it: a choice made once and "changed when you gain a level" in its
// class (Storm Aura's environment: an authored choose spend with changeAt
// "level"), and an invocation replaced "when you gain a level" (Eldritch
// Adept, any level; a warlock's own, a warlock level). The level-up dialog
// offers them (levelUpChangeOffers) and buildLevelUp applies what it was sent
// (applyLevelUpChanges); a change outside a level-up is refused at the spend.

import { heldAuthored, type AuthoredSheet } from "@/lib/srd/authored-effects";
import { holdsFeat } from "@/lib/srd/feat-effects";
import { chosenOptions, optionFeatureName, optionReqProblem, optionsOfKind } from "@/lib/srd/options";
import { textKey } from "@/lib/language/text-logic";

export type LevelUpChange = { from: string; to: string };

// `shown`: each name as the dialog prints it ("Sea" for "Storm Aura (Sea)").
export type ChangeOffer =
  // One held choice and the names it may become ("Storm Aura (Sea)").
  | { kind: "choice"; label: string; from: string; options: string[]; shown: Record<string, string> }
  // Any one of `froms` for one of `options`, or of `optionsFor[from]` where
  // what may replace a name depends on it (a sorcerer origin's spell, by its
  // level: src/lib/dm/ar-ws-origin-swap.ts). `note` says the rule.
  | { kind: "replace"; label: string; froms: string[]; options: string[]; optionsFor?: Record<string, string[]>; note?: string; shown: Record<string, string> };

type Facts = { classLevel: (classId: string) => number; cantrips: readonly string[] };
type ChangeSheet = AuthoredSheet & { features: Array<{ name: string; source?: string; classId?: string; level?: number }>; feats?: string[] };

const INVOCATION = "invocation" as const;

export function levelUpChangeOffers(sheet: ChangeSheet, classId: string, facts: Facts): ChangeOffer[] {
  const offers: ChangeOffer[] = [];
  for (const held of heldAuthored(sheet)) {
    if (textKey(held.classId) !== textKey(classId)) continue;
    for (const spend of held.entry.spends ?? []) {
      const does = spend.does;
      if (does.kind !== "choose" || does.changeAt !== "level" || !held.choice) continue;
      const others = does.options.filter((option) => textKey(option) !== textKey(held.choice ?? ""));
      const named = (option: string) => `${held.feature} (${option})`;
      // The held choice is read as a key ("desert"): it is shown as its option
      // is written ("Desert"), beside the others it may become.
      const kept = does.options.find((option) => textKey(option) === textKey(held.choice ?? "")) ?? held.choice;
      offers.push({
        kind: "choice",
        label: held.feature,
        from: held.name,
        options: others.map(named),
        shown: Object.fromEntries([[held.name, kept], ...others.map((option) => [named(option), option])]),
      });
    }
  }
  const invocations = chosenOptions(sheet.features, INVOCATION);
  if (invocations.length && (holdsFeat(sheet, "Eldritch Adept") || textKey(classId) === "warlock")) {
    const held = new Set(invocations.map(textKey));
    const open = optionsOfKind(INVOCATION).filter((option) => !held.has(textKey(option.n)) && !optionReqProblem(option, { ...facts, features: sheet.features }));
    const names = [...invocations, ...open.map((option) => option.n)];
    offers.push({
      kind: "replace",
      label: "Eldritch Invocation",
      froms: invocations.map((name) => optionFeatureName(INVOCATION, name)),
      options: open.map((option) => optionFeatureName(INVOCATION, option.n)),
      shown: Object.fromEntries(names.map((name) => [optionFeatureName(INVOCATION, name), name])),
    });
  }
  return offers;
}

// The sheet's features with the changes made, or why one is refused.
export function applyLevelUpChanges<F extends { name: string }>(
  sheet: Omit<ChangeSheet, "features"> & { name?: string; features: F[] },
  classId: string,
  changes: readonly LevelUpChange[],
  facts: Facts,
): { features: F[] } | { error: string } {
  const offers = levelUpChangeOffers(sheet as unknown as ChangeSheet, classId, facts);
  let features: F[] = sheet.features;
  const used = new Set<ChangeOffer>();
  for (const change of changes) {
    const offer = offers.find((entry) =>
      !used.has(entry) &&
      (entry.kind === "choice" ? textKey(entry.from) === textKey(change.from) : entry.froms.some((from) => textKey(from) === textKey(change.from))) &&
      entry.options.some((option) => textKey(option) === textKey(change.to)),
    );
    if (!offer) {
      return { error: `${sheet.name ?? "This character"} cannot change ${change.from} to ${change.to} with this level: a choice changes only at a level its rule names, to an option it offers.` };
    }
    used.add(offer);
    const to = offer.options.find((option) => textKey(option) === textKey(change.to))!;
    features = features.map((feature) => (textKey(feature.name) === textKey(change.from) ? { ...feature, name: to } : feature));
  }
  return { features };
}
