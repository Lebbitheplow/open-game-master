import type { SystemId } from "@/app/workshop/[workshopId]/systems";
import type { MessageKey } from "@/lib/messages-logic";

// What the workshop's Create chooser offers (audit finding WF-08). WorldForge
// pulls entries out of notes; it does not make playable things, and a World
// type called Monster or Item adds no stat block. So Create starts from what
// the author wants to end up with, says where it will live, and sends them
// to the tool that already makes it: its own editor, validation and store.
// It is a router, not another editor. Pure: the chooser
// (src/app/workshop/[workshopId]/CreateChooser.tsx) draws it, and
// scripts/test-create-chooser.mjs checks that every way in is answered.

// How a thing gets made. "extract" is WorldForge's Forge, which keeps only
// what the notes say; "draft" asks a model to write from a line. A world
// drafted from an idea (WorldForge's Outline view) is reviewed before
// anything is made, and its creatures and items go through the Bestiary's
// and Homebrew's own validators.
export type CreateWay = "blank" | "copy" | "upload" | "draft" | "extract";

// The words live in the dictionaries under `workshop.create.*`, the way the
// settings page's agent scopes do: this data keeps ids, and the chooser
// reads the labels with the translator it already holds, so a language
// switch rewords the chooser with the rest of the workshop.
export const WAY_KEYS: Record<CreateWay, MessageKey> = {
  blank: "Start blank",
  copy: "Copy one that exists",
  upload: "Bring in a picture",
  draft: "Draft with AI",
  extract: "Extract from notes",
};

export type CreateStep = {
  // The step's own id, the label and detail's place in the dictionaries
  // (`workshop.create.<choice>.<step>.label`).
  id: string;
  ways: CreateWay[];
  // A workshop tool (and WorldForge's view), asked to open its own editor
  // by the name its panel answers (src/lib/tours/prepare.ts); or a page
  // outside the workshop.
  system?: SystemId;
  view?: string;
  prepare?: string;
  href?: string;
  // The model the step cannot work without: off when the server has none.
  needs?: "story";
  // The model its "draft" way uses; the way is not offered without it.
  drafts?: "story" | "images";
};

export type CreateGroup = "world" | "playable" | "picture";

export const GROUP_KEYS: Record<CreateGroup, MessageKey> = {
  world: "For the world",
  playable: "For the table",
  picture: "Pictures",
};

export type CreateChoice = {
  id: string;
  group: CreateGroup;
  steps: CreateStep[];
};

export const CREATE_CHOICES: CreateChoice[] = [
  {
    id: "outline",
    group: "world",
    steps: [
      {
        id: "draft",
        ways: ["draft"],
        system: "world",
        view: "outline",
        needs: "story",
        drafts: "story",
      },
      {
        id: "extract",
        ways: ["extract"],
        system: "world",
        view: "forge",
        needs: "story",
      },
      {
        id: "entry",
        ways: ["blank"],
        system: "world",
        view: "wiki",
        prepare: "open-world-entry",
      },
    ],
  },
  {
    id: "npc",
    group: "world",
    steps: [
      {
        id: "editor",
        ways: ["blank", "draft"],
        system: "cast",
        prepare: "open-npc-editor",
        drafts: "story",
      },
    ],
  },
  {
    id: "place",
    group: "world",
    steps: [
      {
        id: "name",
        ways: ["blank"],
        system: "world",
        view: "wiki",
        prepare: "open-world-entry:location",
      },
    ],
  },
  {
    id: "pc",
    group: "playable",
    steps: [
      {
        id: "build",
        ways: ["blank"],
        // A player character, so the builder does not ask (door.ts).
        href: "/characters/new?as=pc",
      },
      {
        id: "pregen",
        ways: ["copy", "blank"],
        system: "party",
      },
    ],
  },
  {
    id: "creature",
    group: "playable",
    steps: [
      {
        id: "build",
        ways: ["blank", "copy"],
        system: "bestiary",
        prepare: "open-monster-build",
      },
    ],
  },
  {
    id: "item",
    group: "playable",
    steps: [
      {
        id: "editor",
        ways: ["blank", "copy"],
        system: "homebrew",
        prepare: "open-homebrew-editor:item",
      },
    ],
  },
  {
    // The Market lives under Lore, below its entries; without this way in,
    // an author looking for shops found no tool for them (audit WA-10).
    id: "shop",
    group: "playable",
    steps: [
      {
        id: "open",
        ways: ["blank"],
        system: "lore",
        prepare: "open-shop-editor",
      },
    ],
  },
  {
    id: "spell",
    group: "playable",
    steps: [
      {
        id: "editor",
        ways: ["blank", "copy"],
        system: "homebrew",
        prepare: "open-homebrew-editor:spell",
      },
    ],
  },
  {
    id: "option",
    group: "playable",
    steps: [
      {
        id: "editor",
        ways: ["blank", "copy"],
        system: "homebrew",
        prepare: "open-homebrew-editor:feat",
      },
    ],
  },
  {
    id: "region",
    group: "playable",
    steps: [
      {
        id: "open",
        ways: ["blank"],
        system: "region",
      },
    ],
  },
  {
    id: "map",
    group: "playable",
    steps: [
      {
        id: "make",
        ways: ["blank", "upload"],
        system: "maps",
        prepare: "open-map-create",
      },
    ],
  },
  {
    id: "encounter",
    group: "playable",
    steps: [
      {
        id: "editor",
        ways: ["blank"],
        system: "encounters",
        prepare: "open-encounter-editor",
      },
    ],
  },
  {
    id: "table",
    group: "playable",
    steps: [
      {
        id: "editor",
        ways: ["blank", "draft"],
        system: "tables",
        prepare: "open-table-editor",
        drafts: "story",
      },
    ],
  },
  {
    id: "illustration",
    group: "picture",
    steps: [
      {
        id: "portrait",
        ways: ["upload", "draft"],
        system: "cast",
        drafts: "images",
      },
      {
        id: "atlas",
        ways: ["upload"],
        system: "world",
        view: "atlas",
      },
      {
        id: "backdrop",
        ways: ["upload"],
        system: "region",
      },
    ],
  },
];

// What a choice says: its name, what it is, and where it lands, in the hub's
// own words. Each reads the dictionary by the choice's id.
type Translator = (key: string, vars?: Record<string, string | number>) => string;

export function choiceLabel(t: Translator, id: string): string {
  return ({ "outline": t("World outline"), "npc": t("NPC"), "place": t("Place"), "pc": t("Player character"), "creature": t("Creature"), "item": t("Item"), "shop": t("Shop"), "spell": t("Spell"), "option": t("Character option"), "region": t("Region"), "map": t("Battle map"), "encounter": t("Encounter"), "table": t("Roll table"), "illustration": t("Illustration") } as Record<string, string>)[id] ?? String(id);
}

export function choiceBlurb(t: Translator, id: string): string {
  return ({ "outline": t("People, places, factions and lore as linked World entries."), "npc": t("Someone the party can meet, with a voice, wants and secrets."), "place": t("A town, a ruin or a room the party can go to."), "pc": t("A hero for a player, built under the class and level rules."), "creature": t("A monster with a stat block the table can fight."), "item": t("Something to carry, wield or sell, with real mechanics."), "shop": t("A merchant with a shelf, prices and a keeper the party can trade with."), "spell": t("A spell with its level, school, range and effect."), "option": t("A feat, background, species or subclass the builder can offer."), "region": t("The overworld map the party travels, with its places."), "map": t("A room to fight in, with its grid, walls and light."), "encounter": t("A fight of real monsters, budgeted against the party."), "table": t("Rumours, loot or wandering monsters to roll on."), "illustration": t("A picture belongs to what it shows: there is no shelf of loose pictures.") } as Record<string, string>)[id] ?? String(id);
}

// Where the result lives, in the words the hub uses.
export function choiceLands(t: Translator, id: string): string {
  return ({ "outline": t("WorldForge"), "npc": t("Cast, with a World entry of their own"), "place": t("Region's places, with a World entry"), "pc": t("Your character library, or this party as a pregen"), "creature": t("Bestiary"), "item": t("Homebrew"), "shop": t("Lore, in the Market below its entries"), "spell": t("Homebrew"), "option": t("Homebrew"), "region": t("Region"), "map": t("Battle maps"), "encounter": t("Encounters"), "table": t("Tables"), "illustration": t("On the record it shows") } as Record<string, string>)[id] ?? String(id);
}

export function stepLabel(t: Translator, choiceId: string, stepId: string): string {
  return ({ "outline.draft": t("Draft a world from an idea"), "outline.extract": t("Extract from your notes"), "outline.entry": t("Start with one entry"), "npc.editor": t("Open the NPC editor"), "place.name": t("Name a new place"), "pc.build": t("Build a character"), "pc.pregen": t("A pregen for this party"), "creature.build": t("Build a monster"), "item.editor": t("Open the item editor"), "shop.open": t("Open a shop"), "spell.editor": t("Open the spell editor"), "option.editor": t("Open the option editor"), "region.open": t("Open the Region"), "map.make": t("Make a battle map"), "encounter.editor": t("Open the encounter editor"), "table.editor": t("Open the table editor"), "illustration.portrait": t("An NPC's portrait"), "illustration.atlas": t("A map of the world"), "illustration.backdrop": t("The Region's backdrop") } as Record<string, string>)[`${choiceId}.${stepId}`] ?? stepId;
}

export function stepDetail(t: Translator, choiceId: string, stepId: string): string {
  return ({ "outline.draft": t("Write a line or two. A model drafts an outline of people, places, factions and lore, with a few creatures and items, each counted. You tick what to make; creatures and items are built and checked by the Bestiary and Homebrew."), "outline.extract": t("Paste notes and WorldForge lists who and what they name. You keep the ones you want; it does not invent what the notes leave out."), "outline.entry": t("A new World entry of any type, in the wiki."), "npc.editor": t("A new person in the Cast. Generate in the editor drafts one from a line."), "place.name": t("A place in the wiki, which the Region map can then pin."), "pc.build": t("The character builder. It saves to your library."), "pc.pregen": t("The Party tool: put one of your library's characters on this workshop's roster, or build a new one for it."), "creature.build": t("Name it and pick a starting CR, or start from a rulebook monster. From its stat block, give it a World entry; from that entry, add it to a fight."), "item.editor": t("A new item on your Homebrew shelf, or a copy of a rulebook one. Shops and inventories can offer it."), "shop.open": t("Name the shop, where it stands and who keeps it, then stock its shelf from the content pack or line by line."), "spell.editor": t("A new spell on your Homebrew shelf, or a copy of a rulebook one."), "option.editor": t("Starts on feats; the editor's kind picker has backgrounds, species and subclasses."), "region.open": t("Roll the terrain, place locations, and lay art behind it."), "map.make": t("Roll one, start blank, or bring in a drawing."), "encounter.editor": t("Pick monsters from your Bestiary or the rulebook, and a map to fight on."), "table.editor": t("Write the rows, or have them drafted from a line."), "illustration.portrait": t("Open the person in the Cast, then Add a face."), "illustration.atlas": t("An Atlas map in WorldForge: a picture with places pinned on it."), "illustration.backdrop": t("The art laid behind the Region map.") } as Record<string, string>)[`${choiceId}.${stepId}`] ?? "";
}

// The ways a step offers on this server: drafting only where its model is.
export function offeredWays(step: CreateStep, models: { story: boolean; images: boolean }): CreateWay[] {
  return step.ways.filter((way) => way !== "draft" || !step.drafts || models[step.drafts]);
}

// A step the server cannot do at all: every way it has needs a missing model.
export function stepUnavailable(step: CreateStep, models: { story: boolean; images: boolean }): boolean {
  return (step.needs !== undefined && !models[step.needs]) || offeredWays(step, models).length === 0;
}

// Why a way is missing, and how to get it: what a server without AI still
// offers, and where an admin switches drafting on. Keys, read with the
// translator (`workshop.create.needs.*`).
export const ENABLE_DRAFT_KEYS: Record<"story" | "images", MessageKey> = {
  story: "a text model, which an admin adds under Admin > Text model defaults",
  images: "an image backend, which an admin adds under Admin > Image generation",
};

// The models a choice would draft with that this server lacks: one line
// each in the chooser, so a missing "Draft with AI" is explained, not just
// absent.
export function missingModels(choice: CreateChoice, models: { story: boolean; images: boolean }): Array<"story" | "images"> {
  const wanted = new Set(choice.steps.flatMap((step) => [step.needs, step.drafts]).filter((model): model is "story" | "images" => model !== undefined));
  return [...wanted].filter((model) => !models[model]);
}
