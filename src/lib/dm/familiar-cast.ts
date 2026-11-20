// Casting Find Familiar (SRD 5.1) through cast_buff: the familiar is the
// caster's pet (src/lib/dm/pet-tools.ts, summon_pet), and the casting is paid
// like any spell: the form is checked first, then the one cast guard spends
// the hour's casting (out of a fight, or as a ritual) and the 10 gp of
// charcoal, incense and herbs the fire consumes, then the pet is bound. A
// second casting re-shapes the same spirit (one familiar at a time).
//
// Imported by cast-buff.ts only; it reaches mutations.ts through the cast
// callback.

import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { spellFactsFor } from "@/lib/content";
import { ritualProblem } from "@/lib/dm/cast-rules";
import { buildPet, handleSummonPet } from "@/lib/dm/pet-tools";
import { recallFamiliar } from "@/lib/dm/pet-pocket";
import { resolveSheetRef, unknownSheetRef } from "@/lib/dm/rolls";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { familiarKindOf } from "@/lib/srd/familiar-forms";

export { isFindFamiliar } from "@/lib/srd/familiar-forms";

export function castFindFamiliar(
  campaign: Campaign,
  // `castAs`: the name it is cast under, a table's workshop copy's own.
  // `named`: summon_pet's own form, kind and name, instead of a variant.
  input: { caster: CharacterSheet; castAs?: string; variant?: string; named?: { form: string; kind?: string; name?: string }; level?: number; ritual?: boolean; reason?: string; sheets: CharacterSheet[]; sheetsById: Map<string, CharacterSheet> },
  cast: (args: Record<string, unknown>) => Record<string, unknown>,
): ToolResult {
  const { caster } = input;
  const castAs = input.castAs?.trim() || "Find Familiar";
  const { kind, form } = input.named ? { kind: input.named.kind, form: input.named.form } : familiarKindOf(input.variant ?? "");
  const built = buildPet(caster, { kind: "familiar", form });
  if ("error" in built) {
    return { ...built, error: `${built.error} Nothing was spent.` };
  }
  const spent = cast({
    characterId: caster.id,
    spell: castAs,
    ...(input.level ? { level: input.level } : {}),
    via: "buff",
    // Find Familiar is a ritual (SRD 5.1): cast as one it spends no slot.
    ...(input.ritual ? { ritual: true } : {}),
    reason: (input.reason ?? "").slice(0, 200),
  });
  if ("error" in spent) {
    return spent;
  }
  const bound = handleSummonPet(campaign, JSON.stringify({ characterId: caster.id, kind: "familiar", form, ...(kind ? { creatureType: kind } : {}), ...(input.named?.name ? { name: input.named.name } : {}) }), input.sheets, input.sheetsById);
  if ("error" in bound) {
    return bound;
  }
  return {
    ...bound,
    spell: castAs,
    ...(spent.slot ? { slot: spent.slot } : {}),
    ...(spent.cost ? { cost: spent.cost } : {}),
    ...(spent.material ? { material: spent.material } : {}),
    note: "The familiar is bound to the caster as a pet (summon_pet's rules): it acts on its own, cannot attack, and vanishes at 0 hit points. Narrate exactly this.",
  };
}

const familiarCallSchema = z.object({
  characterId: z.string(),
  kind: z.literal("familiar"),
  form: z.string().trim().min(1).max(60),
  name: z.string().trim().max(60).optional(),
  creatureType: z.enum(["celestial", "fey", "fiend"]).optional(),
  reason: z.string().optional(),
});

// summon_pet with kind familiar is Find Familiar cast, as cast_buff casts it:
// it bound the familiar for nothing, beside the door that charged the hour
// and the 10 gp of incense (SRD 5.1, Find Familiar: "1st-level conjuration
// (ritual)", "M (10 gp worth of charcoal, incense, and herbs that must be
// consumed by fire in a brass brazier)"). As a ritual when the caster may
// cast it as one (a wizard, Pact of the Chain: cast-rules.ts ritualProblem),
// which spends no slot; with a 1st-level slot otherwise. Null for any other
// kind of pet, whose summon_pet binds it as before.
export function summonFamiliar(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  cast: (args: Record<string, unknown>) => Record<string, unknown>,
): ToolResult | null {
  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments || "{}");
  } catch {
    return null;
  }
  const parsed = familiarCallSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const args = parsed.data;
  const stale = resolveSheetRef(args.characterId, sheets, sheetsById);
  const caster = stale ? (getSheetById(stale.id) ?? stale) : null;
  if (!caster) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  // A familiar waiting in its pocket dimension comes back for an action,
  // with no casting (pet-pocket.ts).
  const back = recallFamiliar(campaign, caster, args.form);
  if (back) {
    return back;
  }
  const castAs = "Find Familiar";
  const ritual = !ritualProblem(caster, castAs, spellFactsFor(castAs, spellAuthorsFor(campaign)));
  return castFindFamiliar(
    campaign,
    { caster, castAs, named: { form: args.form, kind: args.creatureType, name: args.name }, ritual, ...(ritual ? {} : { level: 1 }), reason: args.reason, sheets, sheetsById },
    cast,
  );
}
