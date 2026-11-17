// The written guide to each workshop tool: what it is for and where what it
// makes lives, how a first session goes, how it is used at the table, and
// the things people miss. Those are the plan's three questions for anything
// made (M5 item 6, audit WF-22): where did it go, what can I do with it,
// how do I use it at the table. WorkshopHelpDialog renders it; the tour of
// each tool covers the same ground with a spotlight. Kept as data so the
// test can check every tool has a guide, and so the copy sits beside the
// tours it matches.

export interface ToolGuide {
  id: string;
  title: string;
  // The French guide, shown by WorkshopHelpDialog when the reader's locale
  // is fr and present, the English field otherwise. Our own translations,
  // not WotC text; the English fields stay the source of truth.
  titleFr?: string;
  // One line: what the tool is for.
  purpose: string;
  purposeFr?: string;
  // A first session, in order.
  steps: string[];
  stepsFr?: string[];
  // How what it makes is used once a campaign brings it in.
  atTable: string;
  atTableFr?: string;
  // The things people miss.
  tips: string[];
  tipsFr?: string[];
}

export const WORKSHOP_GUIDES: ToolGuide[] = [
  {
    id: "world",
    title: "WorldForge",
    titleFr: "WorldForge",
    purpose: "The world itself, after Smoebo's WorldForge: a wiki of typed entries that are this workshop's people, places, factions and lore, the links between them, a timeline, an atlas, secrets, and the names still to write.",
    purposeFr: "Le monde lui-même, à la façon du WorldForge de Smoebo : un wiki d’entrées typées qui sont les gens, lieux, factions et lore de cet atelier, les liens entre eux, une frise, un atlas, des secrets, et les noms restant à écrire.",
    steps: [
      "Start from Create: a person, a place, a monster, an item or a whole world. Draft a world from an idea drafts an outline you tick rows from; making a first entry by hand, or opening a WorldForge file, needs no model at all.",
      "Open an entry to write its article, fill its type's fields, and add the hidden truth players never read.",
      "Add links to other entries: pick the other entry, choose the words, and say whether it is common knowledge, a hidden truth or a false belief.",
      "Link an entry to what the table plays with: the stat block or item it is about, and for a place its battle maps and encounters. Add to a fight puts that exact monster into an encounter.",
      "With an image backend, Paint an entry's picture: the new picture waits for you to keep or turn down, and one that fails says why and can be retried.",
      "Add calendars and the world's history, maps in the Atlas, and the secrets and who keeps them.",
      "Ask the world a question, and read the passages each answer rests on.",
      "Save it back out as a WorldForge file, or share the whole workshop from Share as a bundle.",
    ],
    stepsFr: [
      "Pars de « Créer » : une personne, un lieu, un monstre, un objet ou un monde entier. « Bâtir un monde depuis une idée » ébauche un plan dont tu coches des lignes ; faire une première entrée à la main, ou ouvrir un fichier WorldForge, ne demande aucun modèle.",
      "Ouvre une entrée pour rédiger son article, remplir les champs de son type, et ajouter la vérité cachée que les joueurs ne lisent jamais.",
      "Ajoute des liens vers d’autres entrées : choisis l’autre entrée, choisis les mots, et dis si c’est de notoriété publique, une vérité cachée ou une croyance fausse.",
      "Lie une entrée à ce que la table fait jouer : le statblock ou l’objet dont elle parle, et pour un lieu ses cartes de combat et ses rencontres. « Ajouter à un combat » place ce monstre exact dans une rencontre.",
      "Avec un backend d’images, peins l’image d’une entrée : la nouvelle image attend que tu la gardes ou la refuses, et celle qui échoue dit pourquoi et peut être retentée.",
      "Ajoute des calendriers et l’histoire du monde, des cartes dans l’Atlas, et les secrets et leurs gardiens.",
      "Pose une question au monde, et lis les passages sur lesquels chaque réponse repose.",
      "Enregistre-le en fichier WorldForge, ou partage tout l’atelier depuis Partage comme un paquet.",
    ],
    atTable: "A campaign that brings the world in gets its own copy in its World tab, which only whoever runs the story sees. There, Reveal to the party turns a secret into lore the players read, and an Atlas map reaches the players' Map tab once you show it to the party.",
    atTableFr: "Une campagne qui importe le monde en reçoit sa propre copie dans son onglet Monde, que seul celui qui mène l’histoire voit. Là, « Révéler au groupe » transforme un secret en lore que les joueurs lisent, et une carte de l’Atlas atteint l’onglet Carte des joueurs une fois que tu la montres au groupe.",
    tips: [
      "Every entry is the same row the Cast, Region, Factions and Lore tools edit: change it in either place.",
      "Canon says what is settled. The AI GM is told a draft or an alternate telling as unsettled and leaves a retired entry out, and a lore entry that is not canon is kept from what players read until it is.",
      "Players never read a hidden truth. The AI GM is told the hidden truths of people, places and factions, their ties, and the secrets the party has not learned, and never to state them outright.",
      "Calendars date the world's history. A campaign keeps its own clock, and an event here schedules nothing at the table.",
      "Choose What people believe in the web to see the world as the players will hear it.",
      "Without a text model, Outline, Forge, Ask and Draft are not offered, and without an image backend Paint is not; everything else works the same. An admin adds them under Admin > Text model defaults and Admin > Image generation.",
    ],
    tipsFr: [
      "Chaque entrée est la même fiche que les outils Cast, Région, Factions et Lore éditent : change-la depuis l’un ou l’autre endroit.",
      "Le canon dit ce qui est établi. Le MJ IA reçoit une ébauche ou une variante comme non établie et laisse de côté une entrée retirée, et une entrée de lore qui n’est pas canon est tenue à l’écart de ce que les joueurs lisent jusqu’à ce qu’elle le devienne.",
      "Les joueurs ne lisent jamais une vérité cachée. Le MJ IA connaît les vérités cachées des personnes, des lieux et des factions, leurs liens, et les secrets que le groupe n’a pas appris, avec consigne de ne jamais les énoncer directement.",
      "Les calendriers datent l’histoire du monde. Une campagne garde sa propre horloge, et un événement ici ne planifie rien à la table.",
      "Choisis « What people believe » dans la Toile pour voir le monde tel que les joueurs l’entendront.",
      "Sans modèle de texte, « Plan », « Forge », « Demander » et « Ébaucher avec l’IA » ne sont pas proposés, et sans backend d’images « Peindre » ne l’est pas ; tout le reste marche pareil. Un admin les ajoute sous Admin > Valeurs du modèle de texte et Admin > Génération d’images.",
    ],
  },
  {
    id: "storyboard",
    title: "Storyboard",
    titleFr: "Storyboard",
    purpose: "The plan of the adventure as cards: scenes, fights, places, people and payoffs.",
    purposeFr: "Le plan de l’aventure en cartes : scènes, combats, lieux, personnes et dénouements.",
    steps: [
      "Pick a card kind and give it a title, then Add.",
      "Open a card to write it up and link it to an NPC, a map, a prepared fight or a place from the dropdowns.",
      "Use Leads to on a card to chain it to the cards that follow.",
      "Read What this board is missing and add the cards it suggests.",
      "Check What this becomes: it is what the board turns into when imported into a campaign.",
    ],
    stepsFr: [
      "Choisis un genre de carte et donne un titre, puis « Ajouter ».",
      "Ouvre une carte pour la rédiger et la lier à un PNJ, une carte, un combat préparé ou un lieu depuis les menus déroulants.",
      "Sers-toi de « Mène à » sur une carte pour la chaîner aux cartes qui suivent.",
      "Lis « Ce qui manque à ce plateau » et ajoute les cartes qu’il suggère.",
      "Vérifie « Ce que cela devient » : c’est ce en quoi le tableau se transforme une fois importé dans une campagne.",
    ],
    atTable: "A campaign that brings the board in gets its lore, quests, prepared fights, GM notes and story arc. A card that came from a WorldForge file says so, and opening that file again updates the card rather than adding another.",
    atTableFr: "Une campagne qui importe le tableau reçoit son lore, ses quêtes, ses combats préparés, ses notes de MJ et son arc d’histoire. Une carte venue d’un fichier WorldForge le dit, et rouvrir ce fichier met la carte à jour au lieu d’en ajouter une autre.",
    tips: [
      "Links are dropdowns over the other tools, so build the NPC or the map first and the card can point at it.",
      "The missing list is counted, never guessed by a model.",
    ],
    tipsFr: [
      "Les liens sont des menus déroulants qui puisent dans les autres outils : construis d’abord le PNJ ou la carte de combat, et la carte du storyboard pourra pointer vers lui.",
      "La liste des manques est comptée, jamais devinée par un modèle.",
    ],
  },
  {
    id: "party",
    title: "Party",
    titleFr: "Groupe",
    purpose: "The stand-in party the prep is measured against, and the pregens that travel with it.",
    purposeFr: "Le groupe fictif auquel la préparation est mesurée, et les pré-tirés qui voyagent avec lui.",
    steps: [
      "Set the size and level in the bar at the top of the workshop and Save.",
      "Pick a character from your library and Add it, or Build a new one.",
      "Or press Draft pregens: the AI GM proposes a hero for each seat of the party set above, and the builder's rules make each sheet at that party's level. Drafts are not offered to players until you tick them.",
      "Take one off with the cross; it stays in your library.",
    ],
    stepsFr: [
      "Règle la taille et le niveau dans la barre en haut de l’atelier et « Enregistrer ».",
      "Choisis un personnage de ta bibliothèque et ajoute-le, ou « En construire un nouveau ».",
      "Ou appuie sur « Ébaucher des pré-tirés avec le MJ IA » : le MJ IA propose un héros pour chaque siège du groupe fixé ci-dessus, et les règles du créateur de personnage font chaque fiche au niveau de ce groupe. Les ébauches ne sont pas proposées aux joueurs avant que tu les coches.",
      "Retire-en un avec la croix ; il reste dans ta bibliothèque.",
    ],
    atTable: "The pregens are sheets ready for anyone who sits down without a character.",
    atTableFr: "Les pré-tirés sont des fiches prêtes pour quiconque s’assoit sans personnage.",
    tips: [
      "A pregen whose level differs from the stand-in party is flagged on its card.",
      "Pregens ride along inside the bundle when you share the workshop.",
      "A drafted pregen is marked Drafted by the AI GM until you edit it. Without a text model, Draft pregens is off and says why.",
    ],
    tipsFr: [
      "Un pré-tiré dont le niveau diffère du groupe fictif est signalé sur sa carte.",
      "Les pré-tirés voyagent dans le paquet quand tu partages l’atelier.",
      "Un pré-tiré ébauché est marqué « Ébauché par le MJ IA » jusqu’à ce que tu l’édites. Sans modèle de texte, « Ébaucher des pré-tirés avec le MJ IA » est désactivé et dit pourquoi.",
    ],
  },
  {
    id: "maps",
    title: "Battle maps",
    titleFr: "Cartes de combat",
    purpose: "Rooms to fight in, drawn, rolled or imported, with lights, doors, labels and props.",
    purposeFr: "Des salles où se battre, dessinées, tirées ou importées, avec lumières, portes, étiquettes et éléments.",
    steps: [
      "Open New map, name it, and choose Roll one, Blank rock, Blank ground or Import .dd2vtt.",
      "Tap the map in the drawer to open the editor.",
      "Paint with the brush, line, outline, box and fill tools; undo is there when a stroke goes wrong.",
      "Place lights, doors, labels and props with their tools; a bystander prop offers the cast as a dropdown.",
      "Set the theme, ambient light, tags and notes, and the sound the map makes.",
      "Put it on the table when a campaign is running, or open it as a scene.",
    ],
    stepsFr: [
      "Ouvre « Nouvelle carte », nomme-la, et choisis « En tirer une », « Rocher vierge », « Terrain vierge » ou « Importer .dd2vtt ».",
      "Touche la carte dans le tiroir pour ouvrir l’éditeur.",
      "Peins avec les outils pinceau, ligne, contour, rectangle et remplissage ; l’annulation est là quand un trait tourne mal.",
      "Place lumières, portes, étiquettes et éléments avec leurs outils ; un élément passant propose le Cast en menu déroulant.",
      "Règle le thème, la lumière ambiante, les tags et les notes, et le son que fait la carte.",
      "Pose-la sur la table quand une campagne tourne, ou ouvre-la comme scène.",
    ],
    atTable: "A fight or a place that uses the map opens on it, with its walls, doors and light, and you can put it on the table yourself whenever a campaign is running.",
    atTableFr: "Un combat ou un lieu qui utilise la carte s’ouvre sur elle, avec ses murs, ses portes et sa lumière, et tu peux la poser sur la table toi-même dès qu’une campagne tourne.",
    tips: [
      "Nothing here touches a table until you put it there.",
      "A backdrop picture hangs behind the grid, so a hand-drawn map still gets the engine's lighting and doors.",
      "Tags you have used on other maps are offered as a dropdown beside the tag field.",
    ],
    tipsFr: [
      "Rien de ce qui est ici ne touche une table tant que tu ne l’y as pas mise.",
      "Une image de fond se suspend derrière la grille, pour qu’une carte dessinée à la main ait quand même l’éclairage et les portes du moteur.",
      "Les tags déjà utilisés sur d’autres cartes sont proposés en menu déroulant à côté du champ de tag.",
    ],
  },
  {
    id: "region",
    title: "Region",
    titleFr: "Région",
    purpose: "The overworld: the land, roads, rivers, borders, labels and the places on it.",
    purposeFr: "La carte du monde : le terrain, les routes, les rivières, les frontières, les étiquettes et les lieux posés dessus.",
    steps: [
      "Pick a mode (Add pin, Paint terrain, Draw a line, Write a label) and tap the map.",
      "Under Shape the region, describe the land in a sentence to set the dials, or Roll a world.",
      "Add places by name so NPCs, cards and fights can point at them.",
      "Use a picture instead of tiles, read in an Azgaar map, or save the region as a PNG.",
      "Or use a WorldForge Atlas map as the backdrop, from the Atlas, and place its pinned places here; each then moves with its pin.",
    ],
    stepsFr: [
      "Choisis un mode (« Ajouter un point », « Peindre le terrain », « Tracer une ligne », « Écrire une étiquette ») et touche la carte.",
      "Sous « Façonner la région », décris le terrain en une phrase pour régler les curseurs, ou « Roll a world ».",
      "Ajoute des lieux par nom, pour que PNJ, cartes et combats puissent pointer vers eux.",
      "Sers-toi d’une image au lieu des tuiles, lis une carte venue d’Azgaar, ou enregistre la région en PNG.",
      "Ou prends une carte de l’Atlas WorldForge comme fond, depuis l’Atlas, et place ici ses lieux épinglés ; chacun bouge alors avec son épingle.",
    ],
    atTable: "It is the overworld the party travels. Players see a place only once the party has discovered it.",
    atTableFr: "C’est la carte du monde que le groupe parcourt. Les joueurs ne voient un lieu qu’une fois que le groupe l’a découvert.",
    tips: [
      "Players see a place only once the party has discovered it.",
      "Regenerate rerolls the terrain; places keep their spots where the new ground allows.",
    ],
    tipsFr: [
      "Les joueurs ne voient un lieu qu’une fois que le groupe l’a découvert.",
      "« Régénérer » relance le terrain ; les lieux gardent leur emplacement là où le nouveau sol le permet.",
    ],
  },
  {
    id: "encounters",
    title: "Encounters",
    titleFr: "Rencontres",
    purpose: "Fights prepared in advance and budgeted against the stand-in party.",
    purposeFr: "Des combats préparés à l’avance et budgétés face au groupe fictif.",
    steps: [
      "Open How hard is this? to weigh a roster before saving it: pick monsters from the search, then Work it out.",
      "Press New encounter. Name it and pick monsters into the roster; edit the counts in the box below.",
      "Choose the map it opens on, then place each creature and the party's entrance on it.",
      "Write the plan: what the fight is worth, and what happens when.",
      "Prepare it. At the table the fight is one press of Deploy.",
      "Press Test fight to play it now on a table only you can see: pick the stand-in party or your own characters, and who runs the enemies, the AI GM or you. With no AI GM set up, you do.",
    ],
    stepsFr: [
      "Ouvre « Quelle difficulté ? » pour peser une liste avant de l’enregistrer : choisis des monstres dans la recherche, puis « Faire le calcul ».",
      "Appuie sur « Nouvelle rencontre ». Nomme-la et choisis des monstres dans la liste ; corrige les nombres dans la zone en dessous.",
      "Choisis la carte sur laquelle il s’ouvre, puis place chaque créature et l’entrée du groupe dessus.",
      "Écris le plan : ce que vaut le combat, et ce qui arrive, et quand.",
      "Prépare-le. À la table, le combat est une seule pression sur « Déployer ».",
      "Appuie sur « Combat d’essai » pour le jouer maintenant sur une table que toi seul vois : choisis le groupe fictif ou tes propres personnages, et qui mène les ennemis, le MJ IA ou toi. Sans MJ IA configuré, c’est toi.",
    ],
    atTable: "Deploy lays the fight down on its map with its plan. A hand-built monster in its roster is copied into the campaign that brings the fight in.",
    atTableFr: "« Déployer » pose le combat sur sa carte avec son plan. Un monstre façonné à la main dans sa liste est copié dans la campagne qui importe le combat.",
    tips: [
      "The difficulty pill is the same maths the engine enforces; every number in the workbench shows its parts.",
      "End a test from its table, or from Encounters; starting the next one ends it too. Nothing a test does reaches your characters.",
      "A monster the world does not know is flagged on the card rather than failing at the table.",
    ],
    tipsFr: [
      "La pastille de difficulté est le même calcul que celui que le moteur fait respecter ; chaque nombre dans l’établi montre ses composantes.",
      "Termine un test depuis sa table, ou depuis Rencontres ; commencer le suivant le termine aussi. Rien de ce que fait un test n’atteint tes personnages.",
      "Un monstre que le monde ne connaît pas est signalé sur la carte au lieu de faire échouer le combat à la table.",
    ],
  },
  {
    id: "cast",
    title: "Cast",
    titleFr: "Cast",
    purpose: "The people of the world, with personalities, goals and relationships.",
    purposeFr: "Les gens du monde, avec personnalités, buts et relations.",
    steps: [
      "Press Someone new. Give them a name, a role and an attitude to the party.",
      "Pick where they are found from the places the world has, or type a new one.",
      "Fill in who they are underneath, what they want, and how they feel about the others.",
      "Save them, then add a face: upload one or have one painted.",
    ],
    stepsFr: [
      "Appuie sur « Quelqu’un de nouveau ». Donne un nom, un rôle et une attitude envers le groupe.",
      "Choisis où on le trouve parmi les lieux du monde, ou écris-en un nouveau.",
      "Remplis en dessous qui il est, ce qu’il veut, et ce qu’il pense des autres.",
      "Enregistre-le, puis ajoute un visage : en envoie un ou en fais peindre un.",
    ],
    atTable: "The AI GM plays them by their personality and what they want, and a human GM finds them in the Cast.",
    atTableFr: "Le MJ IA les joue selon leur personnalité et ce qu’ils veulent, et un MJ humain les retrouve dans le Cast.",
    tips: [
      "Suggest fills a single field from a text model, when the server has one; an admin adds one under Admin > Text model defaults.",
      "Set aside hides someone without deleting them; the cast also fills itself in as the party meets people.",
    ],
    tipsFr: [
      "« Suggest » remplit un seul champ avec un modèle de texte, quand le serveur en a un ; un admin en ajoute un sous Admin > Valeurs du modèle de texte.",
      "La mise de côté cache quelqu’un sans le supprimer ; le Cast se remplit aussi tout seul au fil des rencontres du groupe.",
    ],
  },
  {
    id: "factions",
    title: "Factions",
    titleFr: "Factions",
    purpose: "The powers of the world: what the table knows of them, what they want, and where the party stands with each.",
    purposeFr: "Les puissances du monde : ce que la table sait d’elles, ce qu’elles veulent, et où en est le groupe avec chacune.",
    steps: [
      "Press Add one and name the faction.",
      "Write what the table knows of them, and what they want, which players never read.",
      "Pick their attitude and power, and add a picture and tags.",
      "Set where the party stands with the pips on its row.",
      "Edit it and open its World entry to write its members, seat and ties in WorldForge.",
    ],
    stepsFr: [
      "Appuie sur « Ajouter une faction » et nomme-la.",
      "Écris ce que la table sait d’elle, et ce qu’elle veut, que les joueurs ne lisent jamais.",
      "Choisis son attitude et sa puissance, et ajoute une image et des tags.",
      "Règle où en est le groupe avec les pastilles de sa ligne.",
      "Édite-la et ouvre sa « Fiche de Monde » pour écrire ses membres, son siège et ses liens dans WorldForge.",
    ],
    atTable: "The AI GM is told each faction, the party's standing with it and what it wants, and in a campaign a goal moves on in the background as chapters close.",
    atTableFr: "Le MJ IA connaît chaque faction, la position du groupe avec elle et ce qu’elle veut, et dans une campagne un but avance en arrière-plan à chaque chapitre clos.",
    tips: [
      "A faction is the same record as its WorldForge entry: change it in either place.",
      "A world pack's Pull from this workshop takes these factions, with where each is based and who belongs.",
    ],
    tipsFr: [
      "Une faction est la même fiche que son entrée WorldForge : change-la depuis l’un ou l’autre endroit.",
      "Le « Tirer de cet atelier » d’un pack de monde prend ces factions, avec où chacune est établie et qui en fait partie.",
    ],
  },
  {
    id: "bestiary",
    title: "Bestiary",
    titleFr: "Bestiaire",
    purpose: "Your own monsters as full stat blocks the engine can run.",
    purposeFr: "Tes propres monstres en statblocks complets que le moteur peut faire tourner.",
    steps: [
      "Open Build a monster. Name it and pick a challenge rating, or find a catalogue monster to start from.",
      "Open the block. Set abilities, attacks and traits; Saves from scores fills the saves for you.",
      "Use Build it out of the catalogue to take size, hit points, armour and attacks from an ancestry, class and gear.",
      "Add spells known from the catalogue search, languages from the dropdown, and where it is found.",
      "Save the block. The rating is derived and shows its working.",
      "Give it a World entry from its sheet to tie it to your setting; from that entry, Add to a fight puts it into an encounter.",
    ],
    stepsFr: [
      "Ouvre « Bâtir un monstre ». Nomme-le et choisis un degré de défi, ou trouve un monstre du catalogue comme point de départ.",
      "Ouvre le bloc. Règle caractéristiques, attaques et traits ; le bouton « Jets d’après les valeurs » remplit les jets de sauvegarde pour toi.",
      "Sers-toi de « Construis-le avec le catalogue » pour prendre taille, points de vie, armure et attaques d’une lignée, d’une classe et d’un équipement.",
      "Ajoute les sorts connus depuis la recherche du catalogue, les langues depuis le menu déroulant, et où on le trouve.",
      "Enregistre le bloc. Le degré est calculé et montre son raisonnement.",
      "Donne-lui une « Fiche de Monde » depuis sa fiche pour le lier à ton univers ; depuis cette fiche, « Ajouter à un combat » le place dans une rencontre.",
    ],
    atTable: "A monster made here answers to its name wherever a fight starts, and its stat block is the one the engine runs.",
    atTableFr: "Un monstre fait ici répond à son nom partout où un combat commence, et son statblock est celui que le moteur fait tourner.",
    tips: [
      "Monsters belong to your account, so they follow you into every workshop. Prep that uses one carries it: a campaign that brings that prep in gets its own copy in its Bestiary, and the workshop's bundle carries it to other servers.",
      "Put a round of casting into extra damage so the rating counts it.",
    ],
    tipsFr: [
      "Les monstres appartiennent à ton compte, donc ils te suivent dans chaque atelier. La préparation qui en utilise un l’emporte : une campagne qui importe cette préparation en reçoit sa propre copie dans son Bestiaire, et le paquet de l’atelier l’emporte vers d’autres serveurs.",
      "Ajoute un tour d’incantation en dégâts supplémentaires, pour que le degré le compte.",
    ],
  },
  {
    id: "homebrew",
    title: "Homebrew",
    titleFr: "Homebrew",
    purpose: "Items, spells, feats, backgrounds, species, classes, subclasses and hazards of your own.",
    purposeFr: "Des objets, sorts, dons, historiques, espèces, classes, sous-classes et dangers à toi.",
    steps: [
      "Pick the kind at the top, then press New.",
      "Start from something in the books: search the content pack and copy a row in.",
      "Change what you like. Skills, languages, conditions and damage types are dropdowns you can also type into.",
      "Read the findings under the description; an error blocks saving.",
      "Keep it. The character builder and the engine read it like the books' own; the editor then says where it is offered.",
      "Give an item a World entry from its editor, to tie it to your setting.",
    ],
    stepsFr: [
      "Choisis le genre en haut, puis appuie sur « Nouveau ».",
      "Pars de quelque chose des livres : cherche dans le pack de contenu et copie une ligne dedans.",
      "Change ce que tu veux. Compétences, langues, états et types de dégâts sont des menus déroulants dans lesquels tu peux aussi écrire.",
      "Lis les constats sous la description ; une erreur bloque l’enregistrement.",
      "Garde-le. Le créateur de personnage et le moteur le lisent comme ceux des livres ; l’éditeur dit ensuite où il est proposé.",
      "Donne à un objet une « Fiche de Monde » depuis son éditeur, pour le lier à ton univers.",
    ],
    atTable: "The character builder, shops and inventories offer it beside the books' own, for your own characters and at every table you run as its owner, GM or assistant GM; the engine reads it the same way. At someone else's table it counts once that table's owner or GM keeps a copy, from a Workshop bundle with your Homebrew in it. Bring in prep does not copy Homebrew: it is yours already.",
    atTableFr: "Le créateur de personnage, les boutiques et les inventaires le proposent à côté de ceux des livres, pour tes propres personnages et à chaque table que tu mènes comme propriétaire, MJ ou MJ assistant ; le moteur le lit de la même façon. À la table de quelqu’un d’autre, il compte une fois que le propriétaire ou le MJ de cette table en garde une copie, depuis un paquet d’atelier avec ton Homebrew dedans. « Apporter une préparation » ne copie pas le Homebrew : il est déjà à toi.",
    tips: [
      "An item a World entry links to is copied into a campaign that brings that world in, and the workshop's bundle can carry your whole shelf or only what the workshop uses.",
      "A class of your own is a class to every engine: the builder offers it under From Homebrew, and its subclasses are made under it here.",
      "A subclass is offered under its class from the level that class picks a subclass (level 3 for a fighter), and at that level-up.",
      "Rename freely: the characters, entries and tables that use the old name follow the new one.",
      "A spell's damage, save and damage type are read out of its description, the way the SRD's are.",
      "Everything is checked against the ruleset as you type.",
    ],
    tipsFr: [
      "Un objet vers lequel une fiche de Monde pointe est copié dans une campagne qui importe ce monde, et le paquet de l’atelier peut emporter toute ton étagère ou seulement ce que l’atelier utilise.",
      "Une classe à toi est une classe pour chaque moteur : le créateur la propose sous « Du Homebrew », et ses sous-classes se fabriquent sous elle ici.",
      "Une sous-classe est proposée sous sa classe à partir du niveau où cette classe choisit une sous-classe (niveau 3 pour un guerrier), et à cette montée de niveau.",
      "Renomme librement : les personnages, entrées et tables qui portent l’ancien nom suivent le nouveau.",
      "Les dégâts, le jet de sauvegarde et le type de dégâts d’un sort sont lus dans sa description, comme ceux du SRD.",
      "Tout est vérifié contre le jeu de règles pendant que tu écris.",
    ],
  },
  {
    id: "lore",
    title: "Lore",
    titleFr: "Lore",
    purpose: "The world bible: places, factions, history and secrets the narrator knows, and the handouts the players read.",
    purposeFr: "La bible du monde : lieux, factions, histoire et secrets que le narrateur connaît, et les documents que les joueurs lisent.",
    steps: [
      "Press New entry. Pick a category and a title.",
      "Write the entry in Markdown. Link another entry from the dropdown; the link lands at the cursor.",
      "Choose whether the table reads it or only you do.",
      "Attach a picture to make it a handout, add tags, and Add.",
      "Pin the entries the narrator should see every turn.",
    ],
    stepsFr: [
      "Appuie sur « Nouvelle fiche ». Choisis une catégorie et un titre.",
      "Écris l’entrée en Markdown. Lie une autre entrée depuis le menu déroulant ; le lien atterrit au curseur.",
      "Choisis si la table la lit ou si c’est toi seul.",
      "Joins une image pour en faire un document à montrer, ajoute des tags, et « Ajouter ».",
      "Épingle les entrées que le narrateur doit voir à chaque tour.",
    ],
    atTable: "Pinned entries reach the narrator every turn and the rest are found when relevant. Players read the entries that are theirs in the Story tab; one kept for the GM, or not canon yet in WorldForge, they do not.",
    atTableFr: "Les entrées épinglées atteignent le narrateur à chaque tour et les autres sont retrouvées quand c’est pertinent. Les joueurs lisent les entrées qui leur sont destinées dans l’onglet Histoire ; une gardée pour le MJ, ou pas encore canon dans WorldForge, ils ne la lisent pas.",
    tips: [
      "Unpinned entries are retrieved by relevance, so a long bible costs nothing until it is needed.",
      "Tags already in use are offered beside the tag field.",
    ],
    tipsFr: [
      "Les entrées non épinglées sont retrouvées par pertinence, donc une longue bible ne coûte rien tant qu’elle n’est pas nécessaire.",
      "Les tags déjà utilisés sont proposés à côté du champ de tag.",
    ],
  },
  {
    id: "tables",
    title: "Tables",
    titleFr: "Tables",
    purpose: "Random tables: rumours, treasure, weather, encounters, anything rolled.",
    purposeFr: "Des tables aléatoires : rumeurs, trésors, météo, rencontres, tout ce qui se lance.",
    steps: [
      "Press New table and name it.",
      "Write one row per line, with a range (1-3) or a weight (x3), or paste a table from a book.",
      "Use the picker under the box to add a row that is a thing: another table, a monster, an item, a person or a lore entry.",
      "Watch the coverage line for gaps and overlaps.",
      "Save table. Roll from the card; Draw without replacement makes it a deck.",
    ],
    stepsFr: [
      "Appuie sur « Nouvelle table » et nomme-la.",
      "Écris une rangée par ligne, avec une plage (1-3) ou un poids (x3), ou colle une table sortie d’un livre.",
      "Sers-toi du sélecteur sous la zone pour ajouter une rangée qui est une chose : une autre table, un monstre, un objet, une personne ou une entrée de lore.",
      "Surveille la ligne de couverture pour les trous et les chevauchements.",
      "« Sauvegarder la table ». Lance depuis la carte ; « Tirer sans remise » en fait un jeu de cartes.",
    ],
    atTable: "Roll it from the card during play: everyone sees the roll, and what the row says comes back to you alone.",
    atTableFr: "Lance-la depuis la carte pendant le jeu : tout le monde voit le lancer, et ce que dit la rangée ne revient qu’à toi.",
    tips: [
      "Rolling writes an ordinary roll everyone can see, but what the row says comes back to you alone.",
      "Look up a monster beside the tables is a catalogue stat block for reference.",
    ],
    tipsFr: [
      "Le lancer écrit un lancer ordinaire que tout le monde peut voir, mais ce que dit la rangée ne revient qu’à toi.",
      "« Chercher un monstre » à côté des tables est un statblock du catalogue, pour référence.",
    ],
  },
  {
    id: "rules",
    title: "Rules",
    titleFr: "Règles",
    purpose: "Variant rules the engine honours and house rules the narrator retrieves.",
    purposeFr: "Des règles variantes que le moteur respecte et des règles de maison que le narrateur retrouve.",
    steps: [
      "Toggle the variant rules and set the rest length.",
      "Write house rules grouped by heading, and Save rules.",
      "Switch a section off to silence it, or pin it to include it every turn.",
      "Save these rules as a ruleset to reuse in other campaigns and workshops.",
      "Apply a saved ruleset here; the preview says what changes first.",
    ],
    stepsFr: [
      "Bascule les règles variantes et règle la longueur des repos.",
      "Écris des règles de maison regroupées par titre, et « Enregistrer les règles ».",
      "Éteins une section pour la taire, ou épingle-la pour l’inclure à chaque tour.",
      "Enregistre ces règles comme un jeu de règles pour les réutiliser dans d’autres campagnes et ateliers.",
      "Applique ici un jeu de règles enregistré ; l’aperçu dit d’abord ce qui change.",
    ],
    atTable: "A campaign that brings the rules in plays by them: the engine honours the variants, and the narrator reads the house rules that apply.",
    atTableFr: "Une campagne qui importe les règles joue avec : le moteur respecte les variantes, et le narrateur lit les règles de maison qui s’appliquent.",
    tips: [
      "Applying a ruleset copies it; editing it later never reaches back.",
      "A ruleset carries rules, not Homebrew: your Homebrew already counts at every table you run.",
    ],
    tipsFr: [
      "Appliquer un jeu de règles le copie ; l’éditer plus tard ne remonte jamais en arrière.",
      "Un jeu de règles porte des règles, pas du Homebrew : ton Homebrew compte déjà à chaque table que tu mènes.",
    ],
  },
  {
    id: "plugin",
    title: "Plugin",
    titleFr: "Plugin",
    purpose: "A world pack of your own: the setting's names over the rules, its lore, and its pictures, as one file any server can install.",
    purposeFr: "Un pack de monde à toi : les noms de l’univers posés sur les règles, son lore et ses images, en un fichier que n’importe quel serveur peut installer.",
    steps: [
      "Run Guided setup: name the world, say what it is inspired by and who owns that, pick the base genre, and write the narrator's brief.",
      "Pull from this workshop to bring in the lore, places, hook cards and cast you already built.",
      "In People, Magic and gear, and Bestiary, pick the thing from the catalog and give it the world's name for it.",
      "In Pictures, upload a cover and a picture for any race, class, monster, place or faction; they are resized to fit on the way in.",
      "Open Publish. Fix what it lists, then Download the pack, or Install it here if you run this server.",
    ],
    stepsFr: [
      "Lance le « Réglage guidé » : nomme le monde, dis ce qui l’inspire et qui possède ça, choisis le genre de base, et écris le brief du narrateur.",
      "« Tirer de cet atelier » pour amener le lore, les lieux, les cartes d’accroche et le Cast déjà bâtis.",
      "Dans « People », « Magic & gear » et « Bestiary », choisis la chose dans le catalogue et donne-lui le nom que le monde lui donne.",
      "Dans « Pictures », envoie une couverture et une image pour chaque race, classe, monstre, lieu ou faction ; elles sont redimensionnées pour s’ajuster en arrivant.",
      "Ouvre « Publish ». Corrige ce qu’il liste, puis « Télécharger le pack », ou « Installer sur ce serveur » si tu le gères.",
    ],
    atTable: "A server that installs the pack offers it as a world when a campaign is created.",
    atTableFr: "Un serveur qui installe le pack le propose comme monde à la création d’une campagne.",
    tips: [
      "Publish lists what a pack leaves out, kind by kind: secrets and hidden truths, entries kept back, hand-built monsters, homebrew, encounters, battle maps and more. The workshop bundle carries all of it.",
      "A pack renames; it never changes a rule. Anything mechanical is a homebrew entry, not a pack.",
      "Fill in the rights holder for anything built on somebody else's setting; it turns the notice into a proper disclaimer.",
      "The draft travels inside the workshop bundle, so sharing the workshop shares the half-built pack too.",
    ],
    tipsFr: [
      "« Publish » liste ce qu’un pack laisse de côté, genre par genre : secrets et vérités cachées, entrées gardées en réserve, monstres façonnés à la main, homebrew, rencontres, cartes de combat et plus. Le paquet de l’atelier emporte tout ça.",
      "Un pack renomme ; il ne change jamais une règle. Tout ce qui est mécanique est une entrée de homebrew, pas un pack.",
      "Remplis le détenteur des droits pour tout ce qui est bâti sur l’univers de quelqu’un d’autre ; ça transforme la mention en vraie clause de non-affiliation.",
      "Le brouillon voyage dans le paquet de l’atelier, donc partager l’atelier partage aussi le pack à moitié fait.",
    ],
  },
  {
    id: "share",
    title: "Share",
    titleFr: "Partage",
    purpose: "The whole workshop as one file, or compiled into a draft world pack.",
    purposeFr: "Tout l’atelier en un fichier, ou compilé en brouillon de pack de monde.",
    steps: [
      "Name the bundle and say what it is in a line.",
      "Fill in the author and version; add the rights holder if it is built on somebody else's setting.",
      "Choose whether the bundle carries all of your homebrew shelf or only what this workshop uses.",
      "Download bundle, or Compile a world pack.",
    ],
    stepsFr: [
      "Nomme le paquet et dis ce qu’il est en une ligne.",
      "Remplis l’auteur et la version ; ajoute le détenteur des droits si c’est bâti sur l’univers de quelqu’un d’autre.",
      "Choisis si le paquet emporte toute ta réserve de homebrew ou seulement ce que cet atelier utilise.",
      "« Télécharger le paquet », ou « Compiler un pack de monde ».",
    ],
    atTable: "Another server imports the bundle as a workshop of its own, which its campaigns then bring in.",
    atTableFr: "Un autre serveur importe le paquet comme un atelier à part, que ses campagnes importent ensuite.",
    tips: [
      "Pictures travel with the bundle within the size caps; nothing from any campaign does.",
      "Hand-built monsters and homebrew travel in the bundle. Whoever imports it keeps their own entry of the same name, and a different one arrives beside theirs under the bundle's name, with the bundle's pregens, tables and shelves pointed at it.",
      "Only what this workshop uses follows everything it names: its tables, shelves and pregens, a subclass's later spells, a class's subclasses, an item's spells.",
      "Compile a world pack lists what a pack leaves out that the bundle carries.",
    ],
    tipsFr: [
      "Les images voyagent avec le paquet, dans les limites de taille ; rien de ce qui vient d’une campagne ne voyage.",
      "Les monstres façonnés à la main et le homebrew voyagent dans le paquet. Quiconque l’importe garde sa propre entrée du même nom, et une autre arrive à côté de la sienne sous le nom du paquet, avec les pré-tirés, tables et étagères du paquet pointant vers elle.",
      "Seul ce que cet atelier utilise suit tout ce qu’il nomme : ses tables, étagères et pré-tirés, les sorts plus tardifs d’une sous-classe, les sous-classes d’une classe, les sorts d’un objet.",
      "« Compiler un pack de monde » liste ce qu’un pack laisse de côté alors que le paquet l’emporte.",
    ],
  },
];

export function guideFor(id: string): ToolGuide | undefined {
  return WORKSHOP_GUIDES.find((guide) => guide.id === id);
}
