// The spend shapes the martial subclasses brought in wave 2 (fighter,
// barbarian, monk, rogue), resolved here so authored-spend-effects.ts keeps
// one line per kind. Each refuses before it writes, as every resolver does.

import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import { alliesJoin } from "@/lib/dm/allies-join";

export type MartialDoes = Extract<SpendDoes, { kind: "allies_join" }>;

export function martialSpend(ctx: SpendContext, does: MartialDoes): ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> } {
  switch (does.kind) {
    case "allies_join":
      return alliesJoin(ctx, does);
  }
}
