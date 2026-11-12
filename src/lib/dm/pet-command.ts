// What a ranger's bond makes its creature do between attacks, and what a
// drake grown by Bond of Fang and Scale is (src/lib/dm/pet-build.ts builds
// the record; pet-tools.ts summons and commands it):
//
//   - The Dodge. "Without a command it takes the Dodge action" (Ranger's
//     Companion), "takes the Dodge action unless you command it with a bonus
//     action" (Drake Companion). The record carries "dodging" from the start
//     of its owner's turn (authored-turns.ts authoredTurnStart calls
//     petDodgeTurnStart) until a command takes it off (commandPet). Before
//     this nothing marked the uncommanded creature at all.
//   - The ride. Bond of Fang and Scale: the drake "can carry you as a mount";
//     mount_up takes the drake by its name (drakeMount). It refused it.
//   - The essence. "You have resistance to that damage type": the resistance
//     reads the feature's choice, "Bond of Fang and Scale (Fire)", which the
//     summoning now writes (essenceChoice). Before this only a builder pick
//     wrote it, so 10 fire on a ranger with a fire drake took 10.
//
// Maintainer ruling D2 (gap study wave 2): a pet has no token; it stands with
// its owner (src/lib/dm/pet-place.ts in the plumbing package), so nothing
// here measures from the creature.
import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { PET_DODGING } from "@/lib/dm/pet-build";
import type { MountSize, MountState } from "@/lib/srd/mounts";
import type { CharacterSheet, SheetPet } from "@/lib/schemas/sheet";
import { holdsFeature, isNamed } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";
import { toolError, type ToolError } from "@/lib/dm/tool-errors";
import { getActiveEncounter, type Encounter } from "@/lib/db/encounters";
import { spendAction, type TurnBudget } from "@/lib/dm/action-budget";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { canAct } from "@/lib/dm/can-act";
import { heldTurnRefusal } from "@/lib/dm/held-turn";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { spentSlotRefusal } from "@/lib/dm/cast-rules";

// The creatures that dodge when not commanded: a Beast Master's companion
// and a Drakewarden's drake (a familiar and a story pet act on their own).
const DODGERS: ReadonlyArray<SheetPet["kind"]> = ["beast_companion", "drake"];

// What a command lays in place of the Dodge (Exceptional Training's).
export const PET_COMMANDS: readonly string[] = ["dashing", "disengaging", "helping"];

const without = (conditions: string[] | undefined, name: string) => (conditions ?? []).filter((entry) => textKey(entry) !== textKey(name));

// The pets of one owner with a change applied to the one named, written and
// published once.
function writePets(campaign: Campaign, sheet: CharacterSheet, pets: SheetPet[]): void {
  const updated = patchSheet(sheet.id, { pets });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// The owner's turn is starting: a living companion or drake dodges again
// until it is commanded.
export function petDodgeTurnStart(campaign: Campaign, sheet: CharacterSheet): string[] {
  const fresh = getSheetById(sheet.id) ?? sheet;
  // Last turn's command (a dash, a help) is over with the new turn; a spell
  // it shares stays.
  const changed = fresh.pets.map((pet) => {
    if (!DODGERS.includes(pet.kind) || pet.hp <= 0) return pet;
    const kept = (pet.conditions ?? []).filter((entry) => !PET_COMMANDS.includes(textKey(entry)) && textKey(entry) !== PET_DODGING);
    const next = [PET_DODGING, ...kept];
    return next.join("|") === (pet.conditions ?? []).join("|") ? pet : { ...pet, conditions: next };
  });
  if (changed.some((pet, index) => pet !== fresh.pets[index])) {
    writePets(campaign, fresh, changed);
  }
  return [];
}

// A command takes the Dodge off for the rest of the turn; `doing` is what
// it was commanded to do instead (Exceptional Training's dash, disengage or
// help), kept on the record until the owner's next turn.
export function commandPet(campaign: Campaign, sheetId: string, petName: string, doing?: string): void {
  const fresh = getSheetById(sheetId);
  if (!fresh) return;
  const pets = fresh.pets.map((pet) =>
    pet.name === petName ? { ...pet, conditions: [...without(pet.conditions, PET_DODGING), ...(doing && !(pet.conditions ?? []).includes(doing) ? [doing] : [])] } : pet,
  );
  writePets(campaign, fresh, pets);
}

// The drake as a mount: named by its name or form, grown by Bond of Fang and
// Scale (7th level). Null when the call names no drake of this ranger.
export function drakeMount(sheet: CharacterSheet, ref: string): MountState | ToolError | null {
  const wanted = textKey(ref);
  const drake = wanted ? sheet.pets.find((pet) => pet.kind === "drake" && (textKey(pet.name) === wanted || textKey(pet.form) === wanted)) : undefined;
  if (!drake) {
    return null;
  }
  if (!holdsFeature(sheet, "Bond of Fang and Scale")) {
    return { error: `${drake.name} carries a rider from Bond of Fang and Scale (7th level), and ${sheet.name} has not reached it. Nothing was spent.`, refused: "rules" };
  }
  if (drake.hp <= 0) {
    return { error: `${drake.name} is down; it carries no one. Nothing was spent.`, refused: "rules" };
  }
  const size = (drake.size ?? "Medium").toLowerCase() as MountSize;
  return { ref: `pet:${textKey(drake.name)}`, name: drake.name, speed: drake.fly ?? drake.speed, controlled: true, size, ac: drake.ac, hp: drake.hp, maxHp: drake.maxHp };
}

// The features renamed so Bond of Fang and Scale names the essence the drake
// was summoned with ("Bond of Fang and Scale (Fire)"), or null when the sheet
// has no such feature or it already says so.
export function essenceChoice(sheet: Pick<CharacterSheet, "features">, essence: string): CharacterSheet["features"] | null {
  const named = `Bond of Fang and Scale (${essence.charAt(0).toUpperCase()}${essence.slice(1)})`;
  const index = sheet.features.findIndex((feature) => isNamed(feature.name, "Bond of Fang and Scale") || textKey(feature.name).startsWith(textKey("Bond of Fang and Scale (")));
  if (index < 0 || sheet.features[index].name === named) {
    return null;
  }
  return sheet.features.map((feature, at) => (at === index ? { ...feature, name: named } : feature));
}

// ---- the drake's summoning ----

// Drake Companion: "As an action, summon your drake ...; once per long
// rest, or by expending a spell slot of 1st level or higher." In a fight the
// summoning is the ranger's action on their own turn; the free summoning
// spends the feature's counter, and with it spent a slot the call names
// (`level`) pays instead. Checked before the drake is made, written by
// commit() once it is. Before this the drake came free, any number of times,
// and cost no action.
export function drakeSummonCost(
  sheet: CharacterSheet,
  level: number | undefined,
  encounter: Encounter | null,
): ToolError | { commit: () => string[] } {
  const budget = encounter && (encounter.kind ?? "fight") === "fight" ? budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions)) : null;
  let priced: TurnBudget | null = null;
  if (encounter && (encounter.kind ?? "fight") === "fight") {
    const allowed = canAct({ sheet, encounter, kind: "action" });
    if (!allowed.ok) {
      return { ...toolError(allowed), error: `${allowed.error} Summoning the drake is ${sheet.name}'s action on their turn. Nothing was spent.` };
    }
    const held = heldTurnRefusal(encounter, sheet);
    if (held) {
      return held;
    }
    if (budget) {
      const spent = spendAction(budget, "action", "summoning the drake", sheet.name);
      if (!spent.ok) {
        return toolError(spent);
      }
      priced = spent.budget;
    }
  }
  const state = sheet.resources?.[DRAKE_COUNTER];
  const freeLeft = Boolean(state && state.used < state.max);
  let pays: "use" | "slot" | "none" = state ? "use" : "none";
  // With the free summoning spent, the lowest slot the ranger has left pays
  // ("a spell slot of 1st level or higher": every level buys the same drake),
  // so neither the GM nor the model is asked which.
  if (level === undefined && state && !freeLeft) {
    for (let at = 1; at <= 9 && level === undefined; at += 1) {
      const slot = sheet.spellcasting?.slots?.[String(at)];
      if (slot && slot.used < slot.max) level = at;
    }
  }
  if (level !== undefined) {
    const slot = sheet.spellcasting?.slots?.[String(level)];
    if (level < 1 || !slot || slot.used >= slot.max) {
      return spentSlotRefusal(sheet.name, sheet.spellcasting, { level, lowest: 1, what: "summoning the drake", withPact: true });
    }
    pays = "slot";
  } else if (state && !freeLeft) {
    return { error: `${sheet.name}'s free summoning of the drake is spent until a long rest, and they have no spell slot of 1st level or higher left to buy another. Nothing was spent.`, refused: "rules" };
  }
  return {
    commit: () => {
      const lines: string[] = [];
      const fresh = getSheetById(sheet.id) ?? sheet;
      if (pays === "use" && state) {
        patchSheet(sheet.id, { resources: { ...fresh.resources, [DRAKE_COUNTER]: { max: state.max, used: state.used + 1 } } });
        lines.push(`The free summoning is spent until a long rest.`);
      } else if (pays === "slot" && fresh.spellcasting && level !== undefined) {
        const slot = fresh.spellcasting.slots[String(level)];
        patchSheet(sheet.id, { spellcasting: { ...fresh.spellcasting, slots: { ...fresh.spellcasting.slots, [String(level)]: { ...slot, used: slot.used + 1 } } } });
        lines.push(`A level ${level} spell slot is spent.`);
      }
      if (priced && encounter) {
        storeBudget(getActiveEncounter(encounter.campaignId) ?? encounter, priced);
        lines.push(`Summoning the drake used ${sheet.name}'s action.`);
      }
      return lines;
    },
  };
}

const DRAKE_COUNTER = "sub_drake_companion";

// ---- Share Spells ----

// Share Spells (Beast Master 15): "A spell you cast on yourself also affects
// your companion within 30 feet." The companion carries the spell's
// condition on its record beside its own state. The 30 feet always hold:
// the companion stands with the ranger (ruling D2, pet-place.ts). Before
// this the ranger's Longstrider left the companion as it was. Returns the
// line for the cast's result, or null when there is no companion to share.
export function shareSpell(campaign: Campaign, caster: CharacterSheet, condition: string): string | null {
  const fresh = getSheetById(caster.id) ?? caster;
  if (!holdsFeature(fresh, "Share Spells")) {
    return null;
  }
  const companion = fresh.pets.find((pet) => pet.kind === "beast_companion" && pet.hp > 0);
  if (!companion) {
    return null;
  }
  const kept = without(companion.conditions, condition);
  writePets(campaign, fresh, fresh.pets.map((pet) => (pet === companion ? { ...pet, conditions: [...kept, condition].slice(-8) } : pet)));
  return `Share Spells: ${companion.name} is ${condition} too.`;
}
