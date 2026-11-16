import type { TourStep } from "./logic.ts";

// The WorldForge tool's tour (src/app/workshop/world), between the rail and
// help steps every workshop tour shares (src/lib/tours/workshop.ts). Steps
// past the wiki switch the panel's view first: the panel answers the
// "world-view-<view>" prepare names, and those steps are lazy so a target
// that appears a beat later is still found.
//
// Each step says what the author ends up with and where it goes, not only
// what the control is (plan M5 item 6, audit WF-22). The AI views' steps
// say what they need, because on a server with no text model their view is
// not there and the card stands on its own.

export const WORLD_TOUR_STEPS: TourStep[] = [
  {
    id: "create",
    title: "Start from what you want",
    titleFr: "Partir de ce que tu veux obtenir",
    body: "Create asks what you want to end up with (a person, a place, a monster, an item, a fight, a map or a whole world) and opens the tool that makes it, so a monster gets a stat block the table can fight and an item rules the sheet can use. Each can be made by hand or copied from one that exists; Draft with AI is offered where the server has a text model.",
    bodyFr: "Créer demande ce que tu veux obtenir (une personne, un lieu, un monstre, un objet, un combat, une carte ou un monde entier) et ouvre l’outil qui le fabrique : un monstre reçoit ainsi un statblock que la table peut affronter, et un objet des règles que la fiche peut utiliser. Chacun se fait à la main ou se copie depuis un existant ; « Ébaucher avec l’IA » est proposé là où le serveur a un modèle de texte.",
    anchors: ["workshop-create"],
  },
  {
    id: "import",
    title: "A world from WorldForge",
    titleFr: "Un monde venu de WorldForge",
    body: "Open a WorldForge export and it joins this world: characters, places, factions, every other entry, their links, calendars, events, secrets and maps. Opening the same file again updates what is here rather than doubling it. A file that would not come in whole says what each scene would lose before anything is written.",
    bodyFr: "Ouvre un export WorldForge et il rejoint ce monde : personnages, lieux, factions, chaque autre entrée, leurs liens, calendriers, événements, secrets et cartes. Rouvrir le même fichier met à jour ce qui est là au lieu de le doubler. Un fichier qui n’arriverait pas en entier dit ce que chaque scène perdrait avant que quoi que ce soit soit écrit.",
    anchors: ["world-import"],
  },
  {
    id: "wiki",
    title: "Every entry is a record the table uses",
    titleFr: "Chaque entrée est une fiche que la table utilise",
    body: "A person here is in the Cast, a place in the Region's places, a faction in Factions and the rest in Lore, so a change in either tool shows in both. Open an entry to write it and link it to others, and to what the table plays with: a stat block or an item it is about, and for a place its battle maps and encounters. Add to a fight puts that exact monster into an encounter.",
    bodyFr: "Une personne ici se retrouve dans le Cast, un lieu dans les lieux de Région, une faction dans Factions et le reste dans Lore : un changement dans l’un des deux outils se voit dans l’autre. Ouvre une entrée pour la rédiger, la lier aux autres, et la lier à ce que la table fait jouer : le statblock ou l’objet dont elle parle, et pour un lieu ses cartes de combat et ses rencontres. « Ajouter à un combat » place ce monstre exact dans une rencontre.",
    anchors: ["world-new-entry"],
    prepare: "world-view-wiki",
    lazy: true,
  },
  {
    id: "outline",
    title: "Draft a world from an idea",
    titleFr: "Bâtir un monde depuis une idée",
    body: "Write a line or two and a model drafts an outline: people, places, factions and lore, and a few creatures and items, each counted. Nothing is made until you tick rows. Creatures are built and checked in the Bestiary and items in Homebrew, each with a World entry linked to it, and a row that fails says why and can be retried on its own. Needs a text model, which an admin adds under Admin > Text model defaults.",
    bodyFr: "Écris une ligne ou deux et un modèle ébauche un plan : des personnes, des lieux, des factions et du lore, plus quelques créatures et objets, chacun compté. Rien n’est créé avant que tu coches des lignes. Les créatures sont construites et vérifiées dans le Bestiaire et les objets dans le Homebrew, chacun avec une fiche de Monde liée, et une ligne qui échoue dit pourquoi et peut être retentée toute seule. Demande un modèle de texte, qu’un admin ajoute sous Admin > Valeurs du modèle de texte.",
    anchors: ["world-outline"],
    prepare: "world-view-outline",
    lazy: true,
  },
  {
    id: "forge",
    title: "Extract from your notes",
    titleFr: "Extraire de tes notes",
    body: "Paste notes you already have and the model lists what they name and how those things stand with each other; it never invents what the notes leave out. Nothing is written until you tick what to keep, a name the world already has is never rewritten, and the report after names anything not added, and why. Needs a text model, as Outline does.",
    bodyFr: "Colle des notes que tu as déjà et le modèle liste ce qu’elles nomment et comment ces choses se tiennent entre elles ; il n’invente jamais ce que les notes laissent de côté. Rien n’est écrit avant que tu coches ce qu’il faut garder, un nom que le monde a déjà n’est jamais réécrit, et le rapport d’après nomme ce qui n’a pas été ajouté, et pourquoi. Demande un modèle de texte, comme « Bâtir un monde depuis une idée ».",
    anchors: ["world-forge"],
    prepare: "world-view-forge",
    lazy: true,
  },
  {
    id: "ask",
    title: "Ask the world",
    titleFr: "Demander au monde",
    body: "A question answered from this world only, hidden truths included. Each answer lists the passages it rests on, with where each one is and whether it is settled canon; an answer that cites nothing says to check it first. Needs a text model, as Outline does.",
    bodyFr: "Une question répondue depuis ce monde seul, vérités cachées comprises. Chaque réponse liste les passages sur lesquels elle repose, avec leur emplacement et le fait qu’ils soient du canon établi ou non ; une réponse qui ne cite rien demande qu’on la vérifie d’abord. Demande un modèle de texte, comme « Bâtir un monde depuis une idée ».",
    anchors: ["world-ask"],
    prepare: "world-view-ask",
    lazy: true,
  },
  {
    id: "web",
    title: "The web",
    titleFr: "La toile",
    body: "Every link drawn as a web, a family tree read off the family words, and a chain of command read off the chain words. Switch to what people believe to see the world as the players will hear it.",
    bodyFr: "Chaque lien dessiné en toile, un arbre de famille lu depuis les mots de parenté, et une chaîne de commandement lue depuis les mots de subordination. Bascule sur « What people believe » pour voir le monde tel que les joueurs l’entendront.",
    anchors: ["world-web"],
    prepare: "world-view-web",
    lazy: true,
  },
  {
    id: "timeline",
    title: "The world's history",
    titleFr: "L’histoire du monde",
    body: "Calendars are reckonings with an offset, so a year in one reads in all of them. Events run in order, grouped by era, and anyone named outside their own lifetime is flagged. This dates the world's past: a campaign keeps its own clock, and an event here schedules nothing at the table.",
    bodyFr: "Les calendriers sont des computs avec un décalage, donc une année dans l’un se lit dans tous. Les événements défilent dans l’ordre, regroupés par ère, et quiconque est nommé en dehors de sa propre vie est signalé. Ceci date le passé du monde : une campagne garde sa propre horloge, et un événement ici ne planifie rien à la table.",
    anchors: ["world-new-event"],
    prepare: "world-view-timeline",
    lazy: true,
  },
  {
    id: "atlas",
    title: "The atlas",
    titleFr: "L’atlas",
    body: "Maps with a pin on each place that matters, maps inside maps, and regions drawn as shapes. Use a map as the Region backdrop, then place its pinned places on the playable Region; each then moves with its pin. Every change is reviewed before it is made, and a deleted map can be undone straight after. Players see a map only once you show it to the party, and then only its shown pins and regions.",
    bodyFr: "Des cartes avec une épingle sur chaque lieu qui compte, des cartes dans les cartes, et des régions dessinées comme des formes. Utilise une carte comme fond de la Région, puis place ses lieux épinglés sur la Région jouable ; chacun bouge alors avec son épingle. Chaque changement est relu avant d’être fait, et une carte supprimée se remet d’un coup juste après. Les joueurs ne voient une carte qu’une fois que tu la montres au groupe, et alors seulement ses épingles et régions montrées.",
    anchors: ["world-atlas"],
    prepare: "world-view-atlas",
    lazy: true,
  },
  {
    id: "secrets",
    title: "Secrets",
    titleFr: "Les secrets",
    body: "What the secret is, whom it is about and who keeps it. The AI GM is told the ones the party has not learned, so a keeper can let one slip. In a campaign's World tab, Reveal to the party writes it into the players' lore as they learn it and marks it learned.",
    bodyFr: "Ce qu’est le secret, qui le concerne et qui le garde. Le MJ IA connaît ceux que le groupe n’a pas appris, pour qu’un gardien puisse en laisser échapper un. Dans l’onglet Monde d’une campagne, « Révéler au groupe » l’écrit dans le lore des joueurs au fil de leurs découvertes et le marque comme appris.",
    anchors: ["world-new-secret"],
    prepare: "world-view-secrets",
    lazy: true,
  },
  {
    id: "stubs",
    title: "Still to write",
    titleFr: "Reste à écrire",
    body: "Reads the whole world for names nothing answers to yet. Keep one as a stub, write it as an entry, or dismiss it for good.",
    bodyFr: "Lit le monde entier à la recherche de noms auxquels rien ne répond encore. Garde l’un comme amorce, écris-le comme entrée, ou écarte-le pour de bon.",
    anchors: ["world-scan"],
    prepare: "world-view-stubs",
    lazy: true,
  },
  {
    id: "types",
    title: "Types and fields",
    titleFr: "Types et champs",
    body: "Make the types your world needs and the fields each keeps: text, a number, a pick from a list, or a year. A year can mark a birth or a death; any field can be yours alone.",
    bodyFr: "Crée les types que ton monde demande et les champs que chacun garde : du texte, un nombre, un choix dans une liste, ou une année. Une année peut marquer une naissance ou une mort ; n’importe quel champ peut n’être que pour toi.",
    anchors: ["world-new-type"],
    prepare: "world-view-types",
    lazy: true,
  },
  {
    id: "export",
    title: "Back to WorldForge",
    titleFr: "Retour vers WorldForge",
    body: "Saves this world as a WorldForge file, pictures and all. When the storyboard holds more than a file can carry (a card's kind, its routes, its fight), it first lists what each card would lose and offers a workshop bundle, which carries all of it.",
    bodyFr: "Enregistre ce monde en fichier WorldForge, images comprises. Quand le storyboard tient plus qu’un fichier ne peut porter (le genre d’une carte, ses routes, son combat), il liste d’abord ce que chaque carte perdrait et propose un paquet d’atelier, qui porte tout.",
    anchors: ["world-export"],
  },
];
