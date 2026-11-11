// Arcane Abeyance (Chronurgy Magic 10): "Store a spell of 4th level or lower
// for an hour in a bead that anyone can break to cast it with your spell save
// DC and spell attack bonus; recharges on a short or long rest."
//
// Before this the counter was guidance: a use_resource call spent the use and
// nothing held the bead or the spell in it. Now the wizard casts the spell
// into the bead through the door a Ring of Spell Storing is filled through:
// use_spell_slot with the spell and storeIn "Arcane Abeyance"
// (storeInCharacterId for whoever is handed the bead). The one cast guard
// charges the casting (the slot, the components, the action), so a spell the
// wizard cannot cast, or one cast with a slot above 4th level, is refused with
// nothing spent; the spell has no effect now, the use of Arcane Abeyance is
// spent, and the bead is a row on the holder's pack
// (src/lib/dm/ar-ws-bead-store.ts) that any creature holding it casts from
// with use_item, as a ring's wearer does, with the wizard's numbers. The bead
// goes as its spell is cast, or when its hour runs out.
//
// The stored text sets no distance for handing the bead over and no limit on
// who may hold it, so none is asked.
//
// Called by src/lib/dm/spell-storing.ts storeSpell.

import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { spellFactsFor } from "@/lib/content";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { newestBead } from "@/lib/dm/ar-ws-bead-store";
import type { CastResult, CastStoring } from "@/lib/dm/cast-guard";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import type { ToolResult } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { BEAD_MINUTES, BEAD_SLOT } from "@/lib/srd/ar-ws-conjured";
import { holdsFeature } from "@/lib/srd/feature-names";

export const ABEYANCE_COUNTER = "sub_arcane_abeyance";

type Request = { spell: string; level?: number; storedBy?: string };

// `cast` is the cast guard with this caster's hooks already on it.
export function storeInBead(
  campaign: Campaign,
  turnId: string,
  caster: CharacterSheet,
  holder: CharacterSheet,
  request: Request,
  cast: (input: { spell: string; level?: number; dryRun?: boolean; storing: CastStoring }) => CastResult,
): ToolResult {
  const uses = caster.resources?.[ABEYANCE_COUNTER];
  if (!uses || !holdsFeature(caster, "Arcane Abeyance")) {
    return { error: `${caster.name} has no Arcane Abeyance to hold a spell in a bead (a Chronurgy wizard's feature of 10th level). Nothing was spent.`, refused: "rules" };
  }
  if (request.storedBy?.trim()) {
    return { error: `A bead holds the spell its own wizard casts into it, not one cast by ${request.storedBy.trim()}. Leave storedBy out. Nothing was spent.`, retry: true };
  }
  if (uses.max - uses.used < 1) {
    return { error: `${caster.name} has no use of Arcane Abeyance left (${uses.max - uses.used}/${uses.max}); it comes back after a short or long rest. Nothing was spent.`, refused: "limit" };
  }
  const facts = spellFactsFor(request.spell, spellAuthorsFor(campaign));
  const name = facts?.name ?? request.spell;
  if (facts?.level === 0) {
    return { error: `Arcane Abeyance stores a spell of 1st through 4th level, and ${name} is a cantrip. Nothing was spent.`, refused: "rules" };
  }
  // The guard asks whether it fits by the slot it will really use
  // (ar-ws-bead-store.ts beadStoreRefusal), and says every other no first.
  const asked = { spell: name, ...(request.level !== undefined ? { level: request.level } : {}), storing: { ring: BEAD_SLOT, holderId: holder.id } };
  const check = cast({ ...asked, dryRun: true });
  if ("error" in check) {
    return check;
  }
  const spent = cast(asked);
  if ("error" in spent) {
    return spent;
  }
  const now = getSheetById(caster.id) ?? caster;
  const state = now.resources[ABEYANCE_COUNTER] ?? uses;
  patchSheetAudited(campaign.id, caster.id, { resources: { ...now.resources, [ABEYANCE_COUNTER]: { ...state, used: state.used + 1 } } }, {
    kind: "use_resource",
    reason: `Arcane Abeyance: ${name} cast into a bead`,
    delta: { resource: "Arcane Abeyance", spent: 1 },
  });
  const left = `${state.max - state.used - 1}/${state.max}`;
  // A casting held across turns makes its bead when it is done.
  if (typeof spent.casting === "string") {
    return { ...spent, arcaneAbeyance: left, note: `${name} goes into a bead on ${holder.name} when this casting is complete.` };
  }
  const bead = newestBead(holder.id, name);
  return {
    ...spent,
    arcaneAbeyance: left,
    storedIn: bead?.name ?? "a bead",
    holder: holder.name,
    note: `${name} has no effect now: it waits in ${bead?.name ?? "a bead"} on ${holder.name} for ${BEAD_MINUTES} minutes. Whoever holds the bead breaks it with use_item (item "${bead?.name ?? "the bead"}") and then resolves ${name} with the spell's own tool: no slot, level ${spent.slotLevel ?? facts?.level ?? "?"}, ${caster.name}'s spell save DC and attack bonus.`,
  };
}
