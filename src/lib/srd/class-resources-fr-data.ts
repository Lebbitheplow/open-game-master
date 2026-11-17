// The class resources' own words in French, at render time (the same shape
// the names map precedent uses: the stored data stays English (the engine
// parses the guidance's cost words and the DM's tools read it whole, see
// resource-tools.ts) and only what a player sees changes). English is the
// source and the fallback: a resource the map does not carry (the genre
// classes' counters, the authored subclass pools, the innate spell counters,
// hundreds of rows with no official French anywhere) reads as it always did.
//
// NAMES are the official FR SRD 5.1 print, each verified in the bundled
// srd-5.1-fr.json (Second souffle, Fougue, Conduit divin, Points de ki,
// Déluge de coups, Défense patiente, Porté par le vent, Inspiration
// bardique, Forme sauvage, Imposition des mains, Perception divine,
// Restauration magique, Ressourcement, Souffle, Inflexible, Contact
// purificateur, Coup de chance, Arcanum mystique (6e niveau), Acharnement,
// Rage implacable, Plénitude physique, Maître de l’occulte, Sorts de
// prédilection, Surcharge magique, Chance du ténébreux, Traversée des
// enfers, Nimbe sacré, Intervention divine, Inspiration). The exceptions:
// the feats the counters come from are not in the bundled FR book (it prints
// one feat, Empoigneur), so the Lucky feat's Luck Points, Inspiring Leader and
// the three feat-pour counters (Tome of Heroes / Level Up A5E) are plain
// word-for-word translations of their English labels, their rows marked
// below. No name is taken from another French book: the app's French is the
// SRD 5.1's own (src/lib/content/names-fr.ts).
//
// GUIDANCE keeps the third-person voice of the English lines (DM-model text
// that also displays to players), tool names verbatim (pc_attack,
// use_resource, aoe_damage, apply_damage, clear_condition, request_roll,
// use_spell_slot, cast_at_enemy, use_reaction, useInspiration,
// targetCharacterId, amount, variant and their quoted values), SRD terms as
// the French print spells them (action bonus, avantage, jet de sauvegarde,
// DD, repos court, repos long), curly apostrophes throughout, and sentences
// that split on ". " the same way the English ones do: the card's rules
// line takes the first sentence, so no abbreviation-with-period sits inside
// one.

export const RESOURCE_FR: Record<string, { name: string; guidance: string }> = {
  rage: {
    name: "Rage",
    guidance:
      "Une action bonus. La rage dure jusqu’à 1 minute : résistance aux dégâts contondants, perforants et tranchants, dégâts supplémentaires aux attaques en mêlée basées sur la Force, et avantage aux tests et jets de sauvegarde de Force (rien de tout cela en armure lourde). Le serveur applique tout ; la rage s’interrompt plus tôt si le personnage y met fin, tombe inconscient, ou termine un tour sans avoir attaqué ni subi de dégâts depuis le précédent.",
  },
  ki: {
    name: "Points de ki",
    guidance:
      "Le ki alimente le Déluge de coups (une paire de frappes à mains nues en action bonus : résolvez chacune avec pc_attack), la Défense patiente (Esquiver) et Porté par le vent (Foncer ou Se désengager, saut doublé).",
  },
  sorcery_points: {
    name: "Points de sorcellerie",
    guidance:
      "Les points de sorcellerie achètent la Métamagie sur un sort en train d’être lancé (dépensez-les avec amount), ou se convertissent en emplacements de sort et inversement : appelez use_resource avec variant 'create slot' (coûte 2/3/5/6/7 points pour les niveaux 1 à 5) ou 'convert slot' (l’emplacement rendu en points égaux à son niveau), le niveau de l’emplacement dans amount, et le serveur déplace les points et les emplacements. Chacune des deux conversions est une action bonus à son tour dans un combat. Les emplacements créés disparaissent au repos long. Sort accéléré : appelez use_resource avec variant 'Quickened Spell' avant l’incantation ; le serveur dépense 2 points et le prochain sort d’une action de ce tour prend l’action bonus. Le sort lui-même passe toujours par use_spell_slot ou cast_at_enemy, normalement.",
  },
  // No official French: the feat is not printed in the bundled FR SRD, so
  // its words are translated as they read (Chanceux, Points de chance).
  luck_points: {
    name: "Points de chance",
    guidance:
      "Chanceux (ou Fortuné de Level Up) : trois points de chance par repos long. Un point dépensé sur son propre jet d’attaque, test de caractéristique ou jet de sauvegarde lance un d20 de plus et garde le meilleur (pc_attack luck: true, request_roll luck: true ; le serveur dépense le point), ou sur une attaque lancée contre lui (use_reaction 'lucky' après le coup : le d20 de l’attaquant est relancé et le plus bas conservé ; aucune réaction n’est dépensée).",
  },
  // No official French: a Tome of Heroes feat-pour (direct translation).
  ki_inner_resilience: {
    name: "Points de ki (Résilience intérieure)",
    guidance:
      "Résilience intérieure (Tome of Heroes) : 3 points de ki pour la Défense patiente ou Porté par le vent, 3 autres au propre du moine ; de retour après un repos court.",
  },
  // No official French: a Level Up A5E feat-pour (direct translation).
  superiority_dice_martial_adept: {
    name: "Dés de supériorité (Adepte martial)",
    guidance:
      "Adepte martial : un dé de supériorité (un d6) pour les deux manœuvres que le don a enseignées, un de plus au propre du Maître de guerre ; de retour après un repos court.",
  },
  // No official French: a Level Up A5E feat-pour (direct translation).
  sorcery_points_metamagic_adept: {
    name: "Points de sorcellerie (Adepte en métamagie)",
    guidance:
      "Adepte en métamagie : 2 points de sorcellerie pour les deux options de Métamagie que le don a enseignées, en plus du propre de l’ensorceleur ; de retour après un repos long.",
  },
  // No official French: a feat not printed in the bundled FR SRD, its name
  // translated as it reads.
  inspiring_leader: {
    name: "Leader inspirant",
    guidance:
      "Leader inspirant (ou Orateur rallieur de Level Up) : dix minutes de paroles de ralliement donnent à jusqu’à six créatures alliées dans un rayon de 9 mètres qui peuvent l’entendre et le comprendre des points de vie temporaires égaux au niveau de l’orateur plus son modificateur de Charisme ; une utilisation par créature (targetCharacterId), et une créature ne peut en profiter à nouveau avant d’avoir terminé un repos.",
  },
  second_wind: {
    name: "Second souffle",
    guidance:
      "Une action bonus qui restaure au guerrier 1d10 + son niveau de guerrier points de vie.",
  },
  action_surge: {
    name: "Fougue",
    guidance:
      "Une action supplémentaire ce tour-ci, en plus de l’action normale. Résolvez l’action supplémentaire par son propre appel d’outil (un second pc_attack, un lancer de sort, un Foncer).",
  },
  channel_divinity: {
    name: "Conduit divin",
    guidance:
      "Une puissance divine canalisée dans un effet d’archétype. Dans un combat, nommez l’option dans variant : chacune coûte ce que son propre texte dit (le plus souvent une action ; Vœu d’inimitié, Défi du champion, Retourner la situation, Émissaire de la paix, Athlète hors pair et Inspiration inspirante une action bonus ; Bénédiction du dieu de la guerre et Réprimande aux violents une réaction ; Frappe guidée, Colère destructrice et Toucher de la mort rien de plus que le jet qu’elles accompagnent ; la Bénédiction de l’artisan est un rituel d’une heure). Le serveur les résout lui-même : 'turn undead' (chaque mort-vivant dans un rayon de 9 mètres effectue un jet de sauvegarde de SAG contre le DD du sort ; un échec le repousse pendant une minute, et à partir du niveau 5 du clerc un mort-vivant de FP égal ou inférieur à celui de Destruction des morts-vivants est détruit au lieu de cela), 'sacred weapon' (Serment de Dévotion : +CHA aux jets d’attaque avec une arme pendant une minute), 'preserve life' (Domaine de la Vie : soigne jusqu’à 5 × le niveau du clerc, répartis entre les targetCharacterIds, sans dépasser la moitié du maximum de chacun). N’appliquez jamais repoussé ou effrayé à la main : le jet de sauvegarde en décide.",
  },
  bardic_inspiration: {
    name: "Inspiration bardique",
    guidance:
      "La cible garde le dé d’inspiration jusqu’à 10 minutes et l’ajoute à un test de caractéristique, un jet d’attaque ou un jet de sauvegarde. Le serveur la lui remet et la dépense automatiquement sur son prochain jet. À partir du barde 5 (Source d’inspiration), les utilisations reviennent aussi au repos court.",
  },
  wild_shape: {
    name: "Forme sauvage",
    guidance:
      "Le druide revêt la forme d’une bête : ses points de vie, sa CA et ses attaques naturelles, en gardant son propre esprit. Les dégâts au-delà de ceux de la forme retombent sur ses propres points de vie quand la forme prend fin.",
  },
  lay_on_hands: {
    name: "Imposition des mains (réserve de PV)",
    guidance:
      "Un toucher qui restaure des points de vie directement depuis la réserve du paladin : le montant dépensé est le montant soigné. Dépensez-en 5 à la place pour guérir une maladie ou neutraliser un poison.",
  },
  divine_sense: {
    name: "Perception divine",
    guidance:
      "Jusqu’à la fin de son prochain tour, le paladin connaît l’emplacement de tout céleste, fiélon ou mort-vivant dans un rayon de 18 mètres qui ne se trouve pas à l’abri total, et de tout sol consacré ou profané.",
  },
  relentless_endurance: {
    name: "Acharnement",
    guidance:
      "Ceci ne se dépense pas par choix : le serveur laisse le personnage à 1 point de vie au lieu de 0 la prochaine fois que des dégâts l’abattraient, et consomme l’utilisation lui-même.",
  },
  arcane_recovery: {
    name: "Restauration magique",
    guidance:
      "Une fois par jour, au cours d’un repos court, le magicien récupère des emplacements de sort dépensés pour un total de la moitié de son niveau (arrondi vers le haut), aucun d’eux n’étant de niveau 6 ou supérieur.",
  },
  natural_recovery: {
    name: "Ressourcement",
    guidance:
      "Une fois par jour, au cours d’un repos court, le druide récupère des emplacements de sort dépensés pour un total de la moitié de son niveau de druide (arrondi vers le haut), aucun d’eux n’étant de niveau 6 ou supérieur.",
  },
  breath_weapon: {
    name: "Souffle",
    guidance:
      "Un cône ou une ligne du type de dégâts du souffle. Résolvez-le avec aoe_damage en utilisant les dés, la sauvegarde, le DD et le type de dégâts que cet appel rapporte (l’ascendance, ou l’option d’espèce choisie par le joueur, fixent le type et la sauvegarde).",
  },
  indomitable: {
    name: "Inflexible",
    guidance:
      "Le guerrier relance le jet de sauvegarde qu’il vient de rater et doit utiliser le nouveau jet. Le serveur le relance ; en cas de réussite, la condition que ce jet lui avait imposée prend fin.",
  },
  cleansing_touch: {
    name: "Contact purificateur",
    guidance:
      "Une action qui met fin à un sort pesant sur le paladin ou sur une créature consentante qu’il touche. Délibérez ce que le sort a laissé avec clear_condition.",
  },
  stroke_of_luck: {
    name: "Coup de chance",
    guidance:
      "Une attaque qui a raté une cible à portée touche au lieu de cela, ou un test de caractéristique raté est considéré comme un 20 sur le d20.",
  },
  inspiration: {
    name: "Inspiration",
    guidance:
      "L’inspiration se dépense sur un jet, pas avec use_resource : passez useInspiration à request_roll pour avoir l’avantage sur ce test, cette sauvegarde ou cette attaque.",
  },
  relentless_rage: {
    name: "Rage implacable",
    guidance:
      "Ne se dépense pas par choix : pendant la rage, des dégâts qui les font tomber à 0 (sans les tuer sur le coup) imposent un jet de sauvegarde de CON, DD 10 plus 5 par utilisation depuis leur dernier repos, et une réussite les laisse à 1 point de vie. Le serveur lance le jet.",
  },
  wholeness_of_body: {
    name: "Plénitude physique",
    guidance:
      "Une action : le moine récupère des points de vie égaux à trois fois son niveau de moine.",
  },
  eldritch_master: {
    name: "Maître de l’occulte",
    guidance:
      "Une minute passée à implorer le protecteur : chaque emplacement de Magie de pacte dépensé revient. Le serveur les remplit à nouveau.",
  },
  signature_spell_1: {
    name: "Sorts de prédilection (premier)",
    guidance:
      "Le premier sort désigné par Sorts de prédilection, lancé au niveau 3 sans emplacement ; le serveur dépense l’utilisation quand le sort est lancé.",
  },
  signature_spell_2: {
    name: "Sorts de prédilection (second)",
    guidance:
      "Le second sort désigné par Sorts de prédilection, lancé au niveau 3 sans emplacement ; le serveur dépense l’utilisation quand le sort est lancé.",
  },
  overchannel: {
    name: "Surcharge magique",
    guidance:
      "Passez overchannel à cast_at_enemy ou aoe_damage : le sort inflige ses dégâts maximum ; après la première utilisation de chaque repos long, le magicien subit 2d12 dégâts nécrotiques par niveau du sort (1d12 de plus par niveau à chaque utilisation suivante), que le serveur lance.",
  },
  dark_ones_own_luck: {
    name: "Chance du ténébreux",
    guidance:
      "L’occultiste ajoute un d10 à un test de caractéristique ou à un jet de sauvegarde. Le serveur garde le dé sur lui et l’ajoute à son prochain test ou jet de sauvegarde.",
  },
  hurl_through_hell: {
    name: "Traversée des enfers",
    guidance:
      "Après un coup, la créature disparaît dans les plans inférieurs jusqu’à la fin du prochain tour de l’occultiste et, à moins que ce ne soit un fiélon, subit 10d10 dégâts psychiques en réapparaissant. Résolvez les dégâts avec apply_damage sur la créature (type psychic) ; aucune sauvegarde n’est permise.",
  },
  holy_nimbus: {
    name: "Nimbe sacré",
    guidance:
      "Une action : une lumière vive dans un rayon de 9 mètres pendant une minute. Chaque ennemi qui y débute son tour subit 10 dégâts radiants (le serveur les applique), et le paladin a l’avantage aux jets de sauvegarde contre les sorts lancés par des fiélons ou des morts-vivants.",
  },
  divine_intervention: {
    name: "Intervention divine",
    guidance:
      "Une action : le serveur lance des dés pourcentage ; au niveau du clerc ou en dessous (toujours au niveau 20), la divinité intervient, et l’aptitude devient alors inutilisable pendant 7 jours. En cas d’échec, elle revient au repos long.",
  },
};

// The four Mystic Arcanum counters share the one rule, the spell level aside
// (class-resources.ts builds them in a loop too); the name is the FR print's
// own (« Arcanum mystique (6e niveau) », the Occultiste's table).
for (const spellLevel of [6, 7, 8, 9]) {
  RESOURCE_FR[`mystic_arcanum_${spellLevel}`] = {
    name: `Arcanum mystique (${spellLevel}e niveau)`,
    guidance: `L’unique arcanum mystique de niveau ${spellLevel} de l’occultiste se lance une fois sans emplacement de sort, et de nouveau seulement après un repos long. Résolvez le sort avec son propre outil.`,
  };
}
