// Translated French names for Open Game Master's own content and non-SRD 5.1
// entries (setting-pack classes, subraces, backgrounds, and traits), kept
// separate from the official French SRD 5.1 overlay in ./names-fr.ts.

export const TRANSLATED_SPECIES_NAMES_FR: Record<string, string> = {
  "dwarf-hill": "Nain (des collines)",
  "dwarf-mountain": "Nain (des montagnes)",
  "elf-dark": "Elfe (noir)",
  "elf-drow": "Elfe (drow)",
  "elf-high": "Elfe (haut)",
  "elf-wood": "Elfe (des bois)",
  "gnome-forest": "Gnome (des forêts)",
  "gnome-rock": "Gnome (des roches)",
  "halfling-lightfoot": "Halfelin (pied-léger)",
  "halfling-stout": "Halfelin (robuste)",
};

export const TRANSLATED_BACKGROUND_NAMES_FR: Record<string, string> = {
  "charlatan": "Charlatan",
  "criminal": "Criminel",
  "entertainer": "Artiste",
  "folk-hero": "Héros du peuple",
  "gladiator": "Gladiateur",
  "guild-artisan": "Artisan de guilde",
  "guild-merchant": "Marchand de guilde",
  "hermit": "Ermite",
  "knight": "Chevalier",
  "mercenary-recruit": "Recrue mercenaire",
  "noble": "Noble",
  "outlander": "Étranger",
  "pirate": "Pirate",
  "sage": "Érudit",
  "sailor": "Marin",
  "soldier": "Soldat",
  "spy": "Espion",
  "urchin": "Gamin des rues",
};

export const TRANSLATED_CLASS_NAMES_FR: Record<string, string> = {
  "artificer": "Artificier",
  "aberrant": "Aberrant",
  "channeler": "Canalisateur",
  "knight": "Chevalier",
  "road-warrior": "Guerrier de la route",
  "salvage-tech": "Techno-récupérateur",
  "scavenger": "Pilleur",
};

export const TRANSLATED_SPECIES_TRAIT_NAMES_FR: Record<string, string> = {
  "dwarf:dwarven-armor-training": "Formation aux armures naines",
  "mountain-dwarf:dwarven-armor-training": "Formation aux armures naines",
};

export const TRANSLATED_BACKGROUND_FEATURE_NAMES_FR: Record<string, string> = {
  "charlatan:false-identity": "Fausse identité",
  "criminal:criminal-contact": "Contact dans le milieu",
  "entertainer:by-popular-demand": "À la demande générale",
  "folk-hero:rustic-hospitality": "Hospitalité rustique",
  "gladiator:by-popular-demand": "À la demande générale",
  "guild-artisan:guild-membership": "Membre de guilde",
  "guild-merchant:guild-membership": "Membre de guilde",
  "hermit:discovery": "Découverte",
  "knight:retainers": "Domestiques",
  "mercenary-recruit:theoretical-experience": "Expérience théorique",
  "noble:position-of-privilege": "Position privilégiée",
  "outlander:wanderer": "Vagabond",
  "pirate:bad-reputation": "Mauvaise réputation",
  "sage:researcher": "Chercheur",
  "sailor:ships-passage": "Passage en mer",
  "soldier:military-rank": "Grade militaire",
  "spy:criminal-contact": "Contact dans le milieu",
  "urchin:city-secrets": "Secrets de la ville",
};

export const FR_TRANSLATED_NAMES_BY_TABLE: Record<string, Record<string, string>> = {
  species: TRANSLATED_SPECIES_NAMES_FR,
  backgrounds: TRANSLATED_BACKGROUND_NAMES_FR,
  classes: TRANSLATED_CLASS_NAMES_FR,
  speciesTraits: TRANSLATED_SPECIES_TRAIT_NAMES_FR,
  backgroundFeatures: TRANSLATED_BACKGROUND_FEATURE_NAMES_FR,
};
