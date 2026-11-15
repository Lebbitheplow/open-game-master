import { rulebookPages } from "@/lib/rulebook/book";
import type { RulebookPage } from "@/lib/rulebook/types";
import { spellMechanicsFor } from "@/lib/content";
import { itemMechanicsOf } from "@/lib/workshop/catalog-mechanics";
import { PAGE_CATALOG_NAMES } from "@/lib/rulebook/catalog-rows";

// Every page of the bundled book, and where it goes in ODM
// (docs/workshop-rulebook-audit-pr169.md F18, F19): the workshop editor an
// entry is copied into and the catalog name it is found under, or the
// template it stands for, or the rules it is; and how the table runs it.
//
//   engine      the server applies it (rolls, conditions, areas, gates)
//   structured  prepared in a workshop tool whose fields the engines read
//   editable    prepared as words the DM reads and runs
//   reference   read in the book; nothing in ODM prepares or applies it
//
// A page whose title is not the catalog's name for it (a family of +1, +2
// and +3 items, an animated object, the deep gnome) says the name it is
// found under. A template or a guide (the Half-Dragon Template, Customizing
// NPCs) points at the transformation that applies it. Tested page by page
// (scripts/test-rulebook-crosswalk.mjs): no page without a destination.

export type PrepSupport = "engine" | "structured" | "editable" | "reference";
export type CrosswalkEditor = "spell" | "item" | "race" | "archetype" | "monster";

export type Crosswalk = {
  page: string;
  kind: RulebookPage["kind"];
  // The workshop editor a copy of it opens in, or null for rules.
  editor: CrosswalkEditor | null;
  // What the catalog calls it (the page title unless said otherwise).
  catalogName?: string;
  // A class page: the class its subclasses are written under.
  classId?: string;
  // A page that is a family or a guide rather than one entry.
  template?: string;
  // An item the engine runs: the engine fields it reads, in the order the
  // where line lists them (the French line re-labels them).
  runs?: string[];
  support: PrepSupport;
  // Where it is prepared and run, in a few words.
  where: string;
};

const CATALOG_NAMES = PAGE_CATALOG_NAMES;

const FAMILIES: Record<string, string> = {
  "ammunition-1-2-or-3": "a family of three items (+1, +2, +3): copy the one you want and set its bonus",
  "armor-1-2-or-3": "a family of three items (+1, +2, +3): copy it and set the armour bonus",
  "shield-1-2-or-3": "a family of three items (+1, +2, +3): copy it and set the shield's bonus",
};

const TEMPLATES: Record<string, Omit<Crosswalk, "page" | "kind">> = {
  "half-dragon-template": {
    editor: "monster",
    template: "half-dragon",
    support: "structured",
    where: "Bestiary: Build it out of the catalogue, Half-dragon template (senses, resistance, Draconic, its dragon half's breath)",
  },
  "customizing-npcs": {
    editor: "monster",
    template: "npc",
    support: "structured",
    where: "Bestiary: Build it out of the catalogue (ancestry and class chassis), and the Cast for who they are",
  },
};

// The rules chapters, page by page.
const RULES: Record<string, { support: PrepSupport; where: string }> = {
  "racial-traits": { support: "structured", where: "Workshop: Species; the builder grants every trait it reads" },
  "beyond-1st-level": { support: "engine", where: "Level-up: hit points by the table's method, features, improvements" },
  multiclassing: { support: "engine", where: "Level-up, where the table allows multiclassing: prerequisites, proficiencies, slots" },
  alignment: { support: "editable", where: "Sheet and Cast fields; no rule reads it" },
  languages: { support: "structured", where: "Builder: languages from species, background and feats" },
  inspiration: { support: "engine", where: "The GM awards it (set_condition); a roll spends it for advantage" },
  backgrounds: { support: "structured", where: "Workshop: Backgrounds; the builder grants skills, tools, languages, kit and coin" },
  coinage: { support: "engine", where: "Purses: purchase, modify_gold" },
  "selling-treasure": { support: "engine", where: "purchase at the table's prices, at a shop or not" },
  armor: { support: "engine", where: "The armour engine (AC, Strength, Stealth, don and doff); Workshop: Items" },
  weapons: { support: "engine", where: "The attack engine (properties, ranges, finesse, versatile); Workshop: Items" },
  "adventuring-gear": { support: "structured", where: "Items with weights and prices; Workshop: Items" },
  tools: { support: "structured", where: "Builder: tool proficiencies; checks with them roll the proficiency" },
  "mounts-and-vehicles": { support: "engine", where: "Mounts: mount_up and mounted combat. Vehicles are narrated" },
  "trade-goods": { support: "engine", where: "Trade goods keep their full value when sold (trade-value.ts)" },
  expenses: { support: "engine", where: "set_lifestyle and downtime charge the costs" },
  feats: { support: "structured", where: "Workshop: Feats; Runs as for the feats the engines know" },
  "using-ability-scores": { support: "engine", where: "Checks, saves, contests, passive scores" },
  adventuring: { support: "engine", where: "Travel, rests, falling, suffocation, vision and light" },
  combat: { support: "engine", where: "The fight engine: initiative, actions, attacks, damage, death saves" },
  spellcasting: { support: "engine", where: "The cast guard: slots, components, concentration, rituals" },
  "spell-lists": { support: "engine", where: "Builder and level-up spell lists" },
  traps: { support: "structured", where: "Workshop: Hazards (traps), run by apply_hazard" },
  diseases: { support: "structured", where: "Workshop: Hazards (diseases), run by afflict" },
  madness: { support: "engine", where: "afflict: short-, long-term and indefinite madness from the tables" },
  objects: { support: "engine", where: "damage_object: AC by material, hit points by size, damage threshold" },
  poisons: { support: "structured", where: "Workshop: Hazards (poisons), run by afflict" },
  "magic-items": { support: "structured", where: "Workshop: Items (attunement, effects, riders, charges, spells)" },
  "sentient-magic-items": { support: "structured", where: "Workshop: Items (It is sentient); a conflict is the GM's Charisma contest" },
  artifacts: { support: "editable", where: "Workshop: Items for what it does; its destruction and properties are the GM's" },
  "monster-statistics": { support: "engine", where: "Bestiary editor, rated against the DMG table" },
  "nonplayer-characters": { support: "structured", where: "The Cast, with stat blocks from the bestiary" },
  conditions: { support: "engine", where: "The condition engine" },
  "gods-of-the-multiverse": { support: "reference", where: "Lore and WorldForge entries for a world's own gods" },
  "the-planes-of-existence": { support: "reference", where: "Lore; plane-crossing spells are narrated" },
  "legal-information": { support: "reference", where: "The licence the book is published under" },
};

// A spell the engine has a block for is rolled by the cast tools (its save,
// attack, damage, condition, area or summons); the rest are narrated.
function spellSupport(name: string): { support: PrepSupport; where: string } {
  return spellMechanicsFor({ spell: name })
    ? { support: "engine", where: "The cast tools roll it (save or attack, damage, condition, area); Workshop: Spells for a copy that runs the same" }
    : { support: "editable", where: "The cast guard spends the slot and checks the components; what it does is narrated. Workshop: Spells for a copy" };
}
// What the engine runs for an item: a weapon or suit, effects, riders,
// charges, check bonuses, spells. Attunement and weight alone are tracked,
// but what such an item does is the DM's.
const ENGINE_FIELDS = ["weapon", "armor", "weaponRiders", "armorRiders", "charges", "checks", "spells"];
function itemSupport(name: string): { support: PrepSupport; runs: string[]; where: string } {
  const gear = itemMechanicsOf({ name, source: "srd", kind: "magic_item", data: {} }) ?? {};
  const runs = ENGINE_FIELDS.filter((key) => gear[key] !== undefined);
  if (Array.isArray(gear.effects) && gear.effects.length) runs.unshift("effects");
  return runs.length
    ? { support: "engine", runs, where: `Workshop: Items; the engine runs its ${runs.join(", ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}` }
    : { support: "editable", runs, where: "Workshop: Items; attunement and weight are tracked, what it does is the GM's to run" };
}

// The mechanics lookups (spellMechanicsFor, itemMechanicsOf) read the
// English book's names; a localized page's title is the print's (« Boule de
// feu »). The derivation always runs on the English title; only the words
// the line is spoken in change.
let enTitles: Map<string, string> | null = null;
function enTitleOf(id: string): string | undefined {
  enTitles ??= new Map(rulebookPages("en").map((page) => [page.id, page.title]));
  return enTitles.get(id);
}

export function crosswalkFor(page: Pick<RulebookPage, "id" | "kind" | "title">, locale = "en"): Crosswalk {
  const french = locale.startsWith("fr");
  const walk = crosswalkEn(french ? { ...page, title: enTitleOf(page.id) ?? page.title } : page);
  if (!french) return walk;
  const fr = WHERE_FR[page.id];
  if (fr) return { ...walk, where: fr.where, ...(fr.template ? { template: fr.template } : {}) };
  switch (page.kind) {
    case "spell":
      return { ...walk, where: SPELL_WHERE_FR[walk.support === "engine" ? "engine" : "editable"] };
    case "item":
      return {
        ...walk,
        where:
          walk.support === "engine"
            ? ITEM_WHERE_FR.engine.replace("{fields}", (walk.runs ?? []).map((key) => FIELD_LABELS_FR[key] ?? key).join(", "))
            : ITEM_WHERE_FR.editable,
      };
    case "monster":
      return { ...walk, where: MONSTER_WHERE_FR };
    case "race":
      return { ...walk, where: RACE_WHERE_FR };
    case "class":
      return { ...walk, where: CLASS_WHERE_FR };
    default:
      return { ...walk, where: walk.where === "Read in the book" ? READ_WHERE_FR : walk.where };
  }
}

// ---- The same lines in French ----

// A reader whose locale is French reads these instead (the page route asks
// per Accept-Language). The screens are named as the app shows them in
// French (« Atelier », « Bestiaire », « Cast »), the engine and tool names
// stay the protocol's English (set_condition, apply_hazard, mount_up), as
// they do everywhere server text reaches the table. Kept beside the English
// lines above on purpose: when a where line changes up there, its line here
// changes with it.
const WHERE_FR: Record<string, { where: string; template?: string }> = {
  "racial-traits": { where: "Atelier : Races ; le créateur de personnage applique chaque trait qu'il lit" },
  "beyond-1st-level": { where: "Montée de niveau : points de vie selon la méthode de la table, capacités, améliorations" },
  multiclassing: { where: "Montée de niveau, quand la table autorise une seconde classe : conditions requises, maîtrises, emplacements" },
  alignment: { where: "Champs de la fiche et de la Distribution ; aucune règle ne le lit" },
  languages: { where: "Créateur : langues issues de la race, de l'historique et des dons" },
  inspiration: { where: "Attribuée par le MJ (set_condition) ; utilisable sur un jet pour obtenir l'avantage" },
  backgrounds: { where: "Atelier : Historiques ; le créateur accorde compétences, outils, langues, équipement et pièces" },
  coinage: { where: "Bourses : achat, modify_gold" },
  "selling-treasure": { where: "Achat et vente aux tarifs fixés par la table, en boutique ou ailleurs" },
  armor: { where: "Le moteur d'armures (CA, Force, Discrétion, enfiler et retirer) ; Atelier : Objets" },
  weapons: { where: "Le moteur d'attaques (propriétés, portées, finesse, arme polyvalente) ; Atelier : Objets" },
  "adventuring-gear": { where: "Équipement avec encombrement et coût ; Atelier : Objets" },
  tools: { where: "Créateur : maîtrise d'outils ; le bonus de maîtrise est appliqué aux jets associés" },
  "mounts-and-vehicles": { where: "Montures : mount_up et combat monté. Les véhicules sont narrés" },
  "trade-goods": { where: "Les marchandises gardent leur valeur entière à la vente (trade-value.ts)" },
  expenses: { where: "set_lifestyle et temps morts facturent les coûts" },
  feats: { where: "Atelier : Dons ; fonctionne de la même manière que les dons gérés par le moteur" },
  "using-ability-scores": { where: "Tests de caractéristique, sauvegardes, oppositions, scores passifs" },
  adventuring: { where: "Voyage, repos, chute, suffocation, vision et lumière" },
  combat: { where: "Le moteur de combat : initiative, actions, attaques, dégâts, jets de sauvegarde contre la mort" },
  spellcasting: { where: "Le contrôle d'incantation : emplacements, composantes, concentration, rituels" },
  "spell-lists": { where: "Listes de sorts du créateur et de la montée de niveau" },
  traps: { where: "Atelier : Dangers (pièges), appliqués par apply_hazard" },
  diseases: { where: "Atelier : Dangers (maladies), appliquées par afflict" },
  madness: { where: "afflict : folie de courte durée, de longue durée et indéfinie, d'après les tables" },
  objects: { where: "damage_object : CA selon la matière, points de vie selon la taille, seuil de dégâts" },
  poisons: { where: "Atelier : Dangers (poisons), appliqués par afflict" },
  "magic-items": { where: "Atelier : Objets (harmonisation, effets, propriétés additionnelles, charges, sorts)" },
  "sentient-magic-items": { where: "Atelier : Objets (Il est conscient) ; un conflit se règle à l'opposition de Charisme du MJ" },
  artifacts: { where: "Atelier : Objets pour ce qu'il fait ; sa destruction et ses propriétés relèvent du MJ" },
  "monster-statistics": { where: "Éditeur du Bestiaire, calibré d'après la table du Guide du Maître" },
  "nonplayer-characters": { where: "La Distribution, avec des blocs de stats issus du bestiaire" },
  conditions: { where: "Le moteur d'états" },
  "gods-of-the-multiverse": { where: "Entrées Lore et WorldForge pour les dieux propres à un monde" },
  "the-planes-of-existence": { where: "Lore ; les sorts de passage entre plans sont narrés" },
  "legal-information": { where: "La licence sous laquelle le livre est publié" },
  "half-dragon-template": { where: "Bestiaire : créer depuis le catalogue avec le modèle demi-dragon (sens, résistance, langue draconique et souffle hérité)" },
  "customizing-npcs": { where: "Bestiaire : créer depuis le catalogue (base d'ascendance et de classe) ; la Distribution pour leur identité" },
  "ammunition-1-2-or-3": {
    where: "Atelier : Objets ; l'harmonisation et le poids sont gérés, le fonctionnement est laissé à l'appréciation du MJ",
    template: "une famille de trois objets (+1, +2, +3) : dupliquer l'élément souhaité et ajuster son bonus",
  },
  "armor-1-2-or-3": {
    where: "Atelier : Objets ; l'harmonisation et le poids sont gérés, le fonctionnement est laissé à l'appréciation du MJ",
    template: "une famille de trois objets (+1, +2, +3) : dupliquer l'armure souhaitée et ajuster son bonus d'armure",
  },
  "shield-1-2-or-3": {
    where: "Atelier : Objets ; l'harmonisation et le poids sont gérés, le fonctionnement est laissé à l'appréciation du MJ",
    template: "une famille de trois objets (+1, +2, +3) : dupliquer le bouclier souhaité et ajuster son bonus de bouclier",
  },
};

const SPELL_WHERE_FR: Record<"engine" | "editable", string> = {
  engine: "Les outils d'incantation gèrent ses jets (sauvegarde ou attaque, dégâts, état, zone) ; Atelier : Sorts pour en créer une copie identique",
  editable: "Le contrôle d'incantation dépense l'emplacement et vérifie les composantes ; l'effet est narré. Atelier : Sorts pour en créer une copie",
};

const ITEM_WHERE_FR: Record<"engine" | "editable", string> = {
  engine: "Atelier : Objets ; le moteur gère ses paramètres ({fields})",
  editable: "Atelier : Objets ; l'harmonisation et le poids sont gérés, le fonctionnement est laissé à l'appréciation du MJ",
};

const MONSTER_WHERE_FR = "Le moteur de combat gère sa fiche de profil ; le Bestiaire permet de la dupliquer intégralement, texte officiel inclus";
const RACE_WHERE_FR = "Le créateur accorde ses traits ; Atelier : Races pour en créer une copie ou une variante";
const CLASS_WHERE_FR =
  "La classe est fournie avec l'application, gérée par la création et la montée de niveau ; Atelier : Sous-classes pour de nouvelles voies (la création de classe de base n'est pas prise en charge)";
const READ_WHERE_FR = "À lire dans le livre";

// The engine fields a magic item runs, as the French line names them.
const FIELD_LABELS_FR: Record<string, string> = {
  weapon: "statistiques d'arme",
  armor: "statistiques d'armure",
  effects: "effets",
  weaponRiders: "effets additionnels d'arme",
  armorRiders: "effets additionnels d'armure",
  charges: "charges",
  checks: "tests de caractéristique",
  spells: "sorts",
};

// The English lines, the book's own.
function crosswalkEn(page: Pick<RulebookPage, "id" | "kind" | "title">): Crosswalk {
  const base = { page: page.id, kind: page.kind };
  const catalogName = CATALOG_NAMES[page.id];
  if (TEMPLATES[page.id]) {
    return { ...base, ...TEMPLATES[page.id] };
  }
  switch (page.kind) {
    case "spell":
      return { ...base, editor: "spell", ...spellSupport(page.title) };
    case "item": {
      const name = catalogName ?? page.title;
      return {
        ...base,
        editor: "item",
        ...(catalogName ? { catalogName } : {}),
        ...(FAMILIES[page.id] ? { template: FAMILIES[page.id] } : {}),
        ...itemSupport(name),
      };
    }
    case "monster":
      return { ...base, editor: "monster", ...(catalogName ? { catalogName } : {}), support: "engine", where: "The fight engine runs its block; the Bestiary copies it whole, printed text included" };
    case "race":
      return { ...base, editor: "race", support: "structured", where: "The builder grants its traits; Workshop: Species for a copy or a new one" };
    case "class":
      return {
        ...base,
        editor: "archetype",
        classId: page.id,
        support: "engine",
        where: "The class is the bundled one the builder and level-up run; Workshop: Subclasses for new paths (a new base class is not something the workshop makes)",
      };
    case "rules":
    default: {
      const rule = RULES[page.id];
      return { ...base, editor: null, support: rule?.support ?? "reference", where: rule?.where ?? "Read in the book" };
    }
  }
}

let cached: Map<string, Crosswalk> | null = null;

export function crosswalkAll(): Crosswalk[] {
  cached ??= new Map(rulebookPages().map((page) => [page.id, crosswalkEn(page)]));
  return [...cached.values()];
}

export function crosswalkById(id: string): Crosswalk | null {
  if (!cached) crosswalkAll();
  return cached?.get(id) ?? null;
}

// The rules pages the matrix covers by hand, for the test that no rules
// page goes without a row.
export function ruleRowIds(): string[] {
  return Object.keys(RULES);
}
