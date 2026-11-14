// A feature that transforms one suit of armor for as long as its holder
// keeps it so (Black Flag's Mystic Metal: "If you spend 1 hour of
// uninterrupted focus in contact with a nonmagical suit of armor ... you can
// transmute that armor into a suit of mystic metal. The transformation lasts
// until you choose to end it or until you use this feature to transmute a
// different suit of armor."). The suit's equipment row carries the mark
// (`transmuted`, the feature's name), taken off any other row; what reads the
// suit (Juggernaut's gate, authored-effects.ts wearsTransmutedArmor) reads
// the mark, so a suit never transformed is not it.
//
// Called by authored-spend-effects.ts resolveSpendEffect (kind transmute_armor).

import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import { isWorn, matchArmor } from "@/lib/srd/armor";
import { textKey } from "@/lib/language/text-logic";

type Item = NonNullable<SpendContext["sheet"]["equipment"]>[number];

const isSuit = (item: Item) => {
  const category = item.gear?.armor?.category ?? matchArmor(item)?.category;
  return category === "light" || category === "medium" || category === "heavy";
};

// Magic armor is not "a nonmagical suit": a row the gear engine reads as
// magical (a +1 suit, an infused one).
const isMagical = (item: Item) => Boolean(item.infusion || item.gear?.magic || /\+\d/.test(item.name));

export function transmuteArmor(ctx: SpendContext, does: Extract<SpendDoes, { kind: "transmute_armor" }>): ToolError | { patch: FullPatchSheetInput; result: Record<string, unknown> } {
  const { sheet } = ctx;
  if (ctx.encounter && (ctx.encounter.kind ?? "fight") === "fight") {
    return { error: `${does.feature} takes an hour of uninterrupted focus, which no fight leaves room for. Nothing changed.`, refused: "rules" };
  }
  const items = sheet.equipment ?? [];
  const named = ctx.args.variant?.trim();
  const suits = items.map((item, at) => ({ item, at })).filter(({ item }) => isSuit(item));
  const pick = named
    ? // By its whole name: a part of one picked the first suit containing it.
      suits.find(({ item }) => textKey(item.name) === textKey(named))
    : suits.find(({ item }) => isWorn(item, items)) ?? (suits.length === 1 ? suits[0] : undefined);
  if (!pick) {
    return {
      error: named
        ? `${sheet.name} carries no suit of armor named "${named}" for ${does.feature}: pass variant with one of ${suits.map(({ item }) => item.name).join(", ") || "their suits (they carry none)"}. Nothing changed.`
        : `${does.feature} transmutes a suit of armor in contact with ${sheet.name}: they wear none, so pass variant with the suit's name${suits.length ? ` (${suits.map(({ item }) => item.name).join(", ")})` : ""}. Nothing changed.`,
      retry: true,
    };
  }
  if (isMagical(pick.item)) {
    return { error: `${does.feature} transmutes a nonmagical suit of armor, and ${pick.item.name} is magical. Nothing changed.`, refused: "rules" };
  }
  const wanted = textKey(does.feature);
  const equipment = items.map((item, at) => {
    if (at === pick.at) {
      return { ...item, transmuted: does.feature };
    }
    if (textKey(item.transmuted ?? "") !== wanted) {
      return item;
    }
    const rest = { ...item };
    delete rest.transmuted;
    return rest;
  });
  const moved = items.find((item, at) => at !== pick.at && textKey(item.transmuted ?? "") === wanted);
  return {
    patch: { equipment: equipment as FullPatchSheetInput["equipment"] },
    result: {
      transmuted: pick.item.name,
      applied: `${does.feature}: after an hour of focus, ${sheet.name}'s ${pick.item.name} is mystic metal${moved ? `, and their ${moved.name} is ordinary armor again` : ""}.`,
    },
  };
}
