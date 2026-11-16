import type { HomebrewKind } from "@/lib/schemas/homebrew";

// Where a saved Homebrew entry is offered, in the words the editor shows
// under it (workshop import audit F06). Saving used to leave the editor open
// with nothing said, and a subclass that "did not appear" was waiting for
// its class's subclass level, or was a player's own at someone else's table.
// The rule is src/lib/content/scope.ts: the author's own shelf in their
// library, and at a table the shelves of whoever runs it.

// The shape of a translator, as the pure sentence builders take it.
type T = (key: string, vars?: Record<string, string | number>) => string;

// The words are the dictionaries' (homebrew.where.*); the editor passes its
// translator. The archetype's parent sentence is assembled here from three
// keys so the level note stays inside the where clause.
export function homebrewAvailabilityT(t: T, kind: HomebrewKind, parent?: { name: string; subclassLevel: number | null }): string {
  const where =
    kind === "archetype"
      ? parent
        ? parent.subclassLevel
          ? t("under {name} in the character builder, from level {level}, the level that class picks a subclass, and at that level-up", { name: parent.name, level: parent.subclassLevel })
          : t("under {name} in the character builder", { name: parent.name })
        : t("under its class in the character builder")
      : t(WHERE_KEYS[kind] ?? "where the books' own are");
  return t("Offered {where}: for your own characters, and at every table you run as its owner, GM or assistant GM. At someone else's table it is offered once that table's owner or GM keeps a copy, from a Workshop bundle with your Homebrew in it.", { where });
}

const WHERE_KEYS: Partial<Record<HomebrewKind, string>> = {
  class: "in the character builder's class list",
  race: "as a species in the character builder",
  background: "as a background in the character builder",
  feat: "wherever a character takes a feat",
  spell: "in the spell lists of the classes it names",
  item: "in starting gear, shops and inventories",
  hazard: "to the traps, hazards and afflictions a GM sets at the table",
};

const WHERE: Partial<Record<HomebrewKind, string>> = {
  class: "in the character builder's class list",
  race: "as a species in the character builder",
  background: "as a background in the character builder",
  feat: "wherever a character takes a feat",
  spell: "in the spell lists of the classes it names",
  item: "in starting gear, shops and inventories",
  hazard: "to the traps, hazards and afflictions a GM sets at the table",
};

// English-pinned, for wherever the stored data quotes it back.
export function homebrewAvailability(kind: HomebrewKind, parent?: { name: string; subclassLevel: number | null }): string {
  const where =
    kind === "archetype"
      ? parent
        ? `under ${parent.name} in the character builder${parent.subclassLevel ? ` from level ${parent.subclassLevel}, the level that class picks a subclass, and at that level-up` : ""}`
        : "under its class in the character builder"
      : (WHERE[kind] ?? "where the books' own are");
  return `Offered ${where}: for your own characters, and at every table you run as its owner, GM or assistant GM. At someone else's table it is offered once that table's owner or GM keeps a copy, from a Workshop bundle with your Homebrew in it.`;
}
