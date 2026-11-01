// The creatures Summon a pet's Creature can name (the GM console, issue 685),
// as the engine accepts them by kind (src/lib/dm/pet-build.ts buildPet): a
// familiar's Find Familiar forms (Pact of the Chain's four with the pact), a
// Beast Master's beasts of CR 1/4 or lower no larger than Medium, the
// Drakewarden's drake, and a story pet named for one of this table's own
// monsters or an SRD creature. A story pet with no stat block is the
// engine's by design (its hit points and AC sent, and it cannot attack), so
// the pick keeps it behind "Not in the list"; every other kind is the list.
//
// Pure: the route builds the catalogue on the server (the SRD's blocks never
// reach the browser) and the console's field reads it here.

import { findNamed } from "@/lib/language/text-logic";

export type PetFormCatalogue = {
  familiar: Array<{ name: string; chainOnly?: boolean }>;
  companion: string[];
  drake: string[];
  // A story pet: this table's (and its workshop's) monsters, then the SRD's.
  table: string[];
  srd: string[];
};

export type PetFormOption = { value: string; label: string; group: string };

// The options for a pet of this kind, the ones the engine takes first: a
// familiar's forms, Pact of the Chain's apart.
export function petFormOptions(kind: string, catalogue: PetFormCatalogue | null): PetFormOption[] {
  if (!catalogue) return [];
  const each = (names: readonly string[], group: string) => names.map((name) => ({ value: name, label: name, group }));
  switch (kind) {
    case "familiar":
      return [
        ...each(catalogue.familiar.filter((form) => !form.chainOnly).map((form) => form.name), "Familiar forms"),
        ...each(catalogue.familiar.filter((form) => form.chainOnly).map((form) => form.name), "Pact of the Chain"),
      ];
    case "beast_companion":
      return each(catalogue.companion, "Beasts a companion can be");
    case "drake":
      return each(catalogue.drake, "Drakewarden");
    case "other":
      return [...each(catalogue.table, "This table's monsters"), ...each(catalogue.srd, "SRD creatures")];
    default:
      return [];
  }
}

// Only a story pet may be a creature the lists do not hold.
export function petFormTyped(kind: string): boolean {
  return kind === "other";
}

// The creature a form keeps when its pet's kind changes: the one picked while
// the new kind's list holds it, by whole name (a story pet typed "owl" is the
// familiar list's Owl), or anything for a story pet, which may be any; else
// none, so a familiar's owl never rides along as a drake.
export function petFormAfterKind(kind: string, form: string, catalogue: PetFormCatalogue | null): string {
  if (!form || petFormTyped(kind)) return form;
  return findNamed(petFormOptions(kind, catalogue), form, (option) => [option.value])?.value ?? "";
}
