// Painted icons (public/assets/icons, catalogue in scripts/icon-set.mjs).
//
// An icon is addressed by what it is and what it is called, the same way the
// catalogue keys it: a spell or a class feature by its name, an item by its
// name, an option by its kind and name, a condition or an action by its id.
// The path is computed, not looked up in the full manifest; a small index of
// the painted slugs says which files exist, so a name with no painting
// (homebrew, a pack item beyond the SRD) is skipped for its family's icon,
// then for nothing, and never asked of the server (PAINTED below).
// Pure, so scripts/test-icons.mjs drives it.

import paintedIcons from "@/lib/painted-icons.json";

export type IconKind = "spell" | "item" | "feature" | "option" | "feat" | "condition" | "action" | "glyph" | "family";

// The catalogue's slug rule, kept identical to scripts/icon-set.mjs.
export function iconSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Counters the engine names apart from the class table's own wording, each
// lent the table's painting so the screen does not ask for a file that is
// not there (scripts/test-hand-look.mjs walks every Hand card against disk).
const ICON_ALIASES: Record<string, { kind: IconKind; slug: string }> = {
  "feature/action-surge": { kind: "feature", slug: "action-surge-1-use" },
  "feature/bardic-inspiration": { kind: "feature", slug: "bardic-inspiration-d6" },
  "feature/indomitable": { kind: "feature", slug: "indomitable-1-use" },
  "feature/lay-on-hands-hp-pool": { kind: "feature", slug: "lay-on-hands" },
  "feature/maneuver": { kind: "family", slug: "option-maneuver" },
  // The feats' counters (src/lib/srd/class-resources.ts) wear paintings
  // of their kin.
  "feature/luck-points": { kind: "feature", slug: "bend-luck" },
  "feature/inspiring-leader": { kind: "feature", slug: "combat-inspiration" },
  "feature/chefs-treats": { kind: "spell", slug: "heroes-feast" },
  // A feature's second spend wears the feature's own painting (issue 233).
  "feature/activate-cannon": { kind: "feature", slug: "eldritch-cannon" },
  "feature/move-spirit-totem": { kind: "feature", slug: "spirit-totem" },
  "feature/spreading-spores": { kind: "feature", slug: "halo-of-spores" },
  // The Beast Master's command card wears the painting of a hero and its beast.
  "feature/exceptional-training": { kind: "feature", slug: "bonded-beast" },
  // The Echo Knight's echo (src/lib/srd/authored-effects-data-b.ts) wears its
  // sibling Unleash Incarnation's painting, a sword and its spectral double:
  // the catalogue's own prompt for it read only the duration.
  "feature/manifest-echo": { kind: "feature", slug: "unleash-incarnation" },
  // The wave-2 cards with no painting of their own yet wear the closest kin's
  // (the catalogue's prompts for most of them carry the name alone): a burst
  // of speed, the mind's hand, the rage that grows the claws, a spirit asked,
  // a healing hand, a ki strike, a step through space, a bolt of light, and
  // wild magic's luck.
  "feature/feline-agility": { kind: "action", slug: "dash" },
  "feature/telekinetic-movement": { kind: "feature", slug: "telekinetic-adept" },
  "feature/guarded-mind": { kind: "feature", slug: "stillness-of-mind" },
  "feature/form-of-the-beast": { kind: "feature", slug: "rage" },
  "feature/question-a-spirit": { kind: "feature", slug: "consult-the-spirits" },
  "feature/flurry-of-healing": { kind: "feature", slug: "hand-of-healing" },
  "feature/deft-strike": { kind: "feature", slug: "ki-empowered-strikes" },
  "feature/psychic-teleportation": { kind: "feature", slug: "misty-wanderer" },
  "feature/wild-surge-teleport": { kind: "feature", slug: "misty-escape" },
  "feature/wild-surge-spirit": { kind: "feature", slug: "summon-wildfire-spirit" },
  "feature/wild-surge-bolt": { kind: "spell", slug: "guiding-bolt" },
  "feature/controlled-surge": { kind: "feature", slug: "bend-luck" },
  "feature/unstable-backlash": { kind: "feature", slug: "tides-of-chaos" },
  // The pick-lists issue #833 added wear the paintings of what they choose
  // for, not new art: a dragon for the sorcerer's ancestor, the ranger's and
  // the wizard's own features, the druid's circle.
  "family/option-dragon-ancestor": { kind: "spell", slug: "summon-draconic-spirit" },
  "family/option-arcane-shot": { kind: "feature", slug: "arcane-shot" },
  "family/option-favored-enemy": { kind: "feature", slug: "favored-enemy" },
  "family/option-favored-terrain": { kind: "feature", slug: "natural-explorer" },
  "family/option-land-circle": { kind: "feature", slug: "druid-circle" },
  "family/option-spell-mastery-1": { kind: "feature", slug: "spell-mastery" },
  "family/option-spell-mastery-2": { kind: "feature", slug: "spell-mastery" },
  "family/option-signature-spell": { kind: "feature", slug: "signature-spells" },
  // A Draconic sorcerer's three spends (issue #833): wings for the wings,
  // fear for the aura, warding against an element for the resistance.
  "feature/dragon-wings": { kind: "feature", slug: "wings-unfurled" },
  "feature/draconic-presence": { kind: "spell", slug: "fear" },
  "feature/elemental-affinity": { kind: "spell", slug: "protection-from-energy" },
  // A Scribe's Awakened Spellbook (its ritual use, authored-effects-w2-ar-ws.ts)
  // wears the painting of the same book's mind.
  "feature/awakened-spellbook": { kind: "feature", slug: "manifest-mind" },
  // Three sorcerer spends the fifth round of the arcane repair built wear
  // paintings of their kin, not new art: the moon's own glyph for the light a
  // Lunar sorcerer sheds (Lunar Boons' card is gone: the cast spends it), a
  // healing spell for the healing dice rolled again, a ward for the ward.
  "feature/lunar-empowerment": { kind: "feature", slug: "lunar-boons" },
  "feature/empowered-healing": { kind: "spell", slug: "cure-wounds" },
  "feature/bastion-of-law": { kind: "spell", slug: "warding-bond" },
  // The dead's whispers, the spirits' tales and a swashbuckler's charm wear
  // the paintings nearest them until they have their own.
  "feature/whispers-of-the-dead": { kind: "feature", slug: "grave-whispers" },
  "feature/tales-from-beyond": { kind: "feature", slug: "consult-the-spirits" },
  "feature/release-tale": { kind: "feature", slug: "consult-the-spirits" },
  "feature/panache": { kind: "spell", slug: "enthrall" },
  // A rune's invocation wears the rune's own painting (option/rune-*), and
  // the Storm Rune's prophetic state its rune's.
  "feature/cloud-rune": { kind: "option", slug: "rune-cloud-rune" },
  "feature/fire-rune": { kind: "option", slug: "rune-fire-rune" },
  "feature/frost-rune": { kind: "option", slug: "rune-frost-rune" },
  "feature/hill-rune": { kind: "option", slug: "rune-hill-rune" },
  "feature/stone-rune": { kind: "option", slug: "rune-stone-rune" },
  "feature/storm-rune": { kind: "option", slug: "rune-storm-rune" },
  "feature/prophetic-state": { kind: "option", slug: "rune-storm-rune" },
  // The door cards (src/lib/battlemap/hand-feature-doors.ts) and Alter
  // Memories wear their kin's paintings: the pact boon's own for the blade,
  // a caster's feat for War Caster, the psi warrior's mind for Telekinetic,
  // the spell that rewrites a memory.
  "feature/pact-of-the-blade": { kind: "option", slug: "pact-boon-pact-of-the-blade" },
  "feature/war-caster": { kind: "feat", slug: "battle-caster" },
  "feature/telekinetic": { kind: "feature", slug: "telekinetic-adept" },
  "feature/alter-memories": { kind: "spell", slug: "modify-memory" },
  // Controlled Chaos's pick of two surges wears its kin's: Tides of Chaos.
  "feature/controlled-chaos": { kind: "feature", slug: "tides-of-chaos" },
};

export function iconPath(kind: IconKind, key: string): string {
  const slug = iconSlug(key);
  const alias = ICON_ALIASES[`${kind}/${slug}`];
  return alias ? `/assets/icons/${alias.kind}/${alias.slug}.webp` : `/assets/icons/${kind}/${slug}.webp`;
}

// Families: spell-<school>, item-<kind>, class-<classId>, option-<kind>, damage-<type>.
export function familyIconPath(family: string): string {
  return iconPath("family", family);
}

export type IconRef = { kind: IconKind; key: string; family?: string | null };

// The slugs each kind has a painting for (written by scripts/generate-icons.mjs
// beside the manifest; scripts/test-hand-look.mjs holds it to the folders).
// A path is still computed, never looked up, but a name with no painting is
// no longer asked for: a level-up page of pack spells used to fire a hundred
// requests for files that are not there. Glyphs are named in code only and
// are not listed.
const PAINTED: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(paintedIcons as Record<string, string[]>).map(([kind, slugs]) => [kind, new Set(slugs)]),
);

// Whether the file an icon path names is one the catalogue painted.
export function isPainted(src: string): boolean {
  const match = /^\/assets\/icons\/([a-z]+)\/([^/]+)\.webp$/.exec(src);
  if (!match) return true;
  const set = PAINTED[match[1]];
  return set ? set.has(match[2]) : true;
}

// The paths to try, in order: only the paintings that exist.
export function iconCandidates(ref: IconRef): string[] {
  const paths = [iconPath(ref.kind, ref.key)];
  if (ref.family) paths.push(familyIconPath(ref.family));
  return paths.filter(isPainted);
}
