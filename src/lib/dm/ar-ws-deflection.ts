// Arcane Deflection as the engine resolves it (wizard, War Magic 2): "A
// reaction after being hit or failing a save grants +2 AC or +4 on the save,
// at the cost of casting only cantrips on your next turn"
// (src/lib/srd/subclasses.json, wizard::Arcane Deflection).
//
// The +2 against a hit is the authored reaction's own (ac_vs_hit in
// src/lib/dm/authored-reactions.ts). This module holds what that row could
// not say: what every use leaves behind. Called by authoredReaction once the
// reaction is decided, paid and spent, so nothing here refuses.
//
//   - The price: a mark on the wizard to the end of their next turn, which
//     the cast door reads (src/lib/dm/ar-ws-deflection-mark.ts). A use on the
//     wizard's own turn (an opportunity attack turned aside) bars the rest of
//     that turn and all of the next, so an older mark is replaced, never kept.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { getSheetById } from "@/lib/db/sheets";
import { DEFLECTED } from "@/lib/dm/ar-ws-deflection-mark";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { reactionPatch } from "@/lib/dm/reaction-refund";
import type { Ctx } from "@/lib/dm/reaction-tools";

// The mark, laid with the reaction's own audit row so "Revert this turn"
// takes it back with the reaction.
function layPrice(ctx: Ctx, holder: CharacterSheet): string {
  const now = getSheetById(holder.id) ?? holder;
  const kept = now.conditions.filter((entry) => !isConditionNamed(entry, DEFLECTED));
  const meta = Object.fromEntries(Object.entries(now.conditionMeta ?? {}).filter(([name]) => !isConditionNamed(name, DEFLECTED)));
  const fighting = Boolean(ctx.encounter && ctx.encounter.status === "active");
  reactionPatch(
    ctx.campaign,
    ctx.turn.id,
    now.id,
    {
      conditions: [...kept, DEFLECTED],
      conditionMeta: { ...meta, [DEFLECTED]: fighting ? { untilTurnEndOf: now.id, source: "Arcane Deflection" } : { rounds: 1, source: "Arcane Deflection" } },
    },
    "Arcane Deflection: only cantrips until the end of their next turn",
  );
  return `${now.name} casts only cantrips until the end of their next turn.`;
}

// What a use of Arcane Deflection leaves behind, for the reaction's result.
export function deflectionAftermath(ctx: Ctx, holder: CharacterSheet): Record<string, unknown> {
  return { price: layPrice(ctx, holder) };
}
