import { textKey } from "@/lib/language/text-logic";
import { rulebookPage } from "@/lib/rulebook/book";
import { rulebookPageIdFor } from "@/lib/rulebook/catalog-rows";

// French descriptions for SRD 5.1 equipment, adventuring gear, tools, and
// mounts (used on the server when /api/content/items answers in French).
// Magic items fall through to the official French SRD 5.1 rulebook pages
// in src/lib/rulebook/srd-5.1-fr.json.

const GEAR_DESC_FR: Record<string, string> = {
  "abacus": "Un boulier utilisé pour effectuer des calculs rapidement.",
  "acid vial": "Au prix d’une action, tu peux projeter le contenu de cette fiole sur une créature située à 1,50 m (5 pi) ou moins, ou lancer la fiole jusqu’à 6 m (20 pi) pour qu’elle se brise à l’impact. Dans les deux cas, fais une attaque à distance contre une créature ou un objet, en considérant l’acide comme une arme improvisée. En cas de réussite, la cible subit 2d6 dégâts d’acide.",
  "alchemist s fire flask": "Ce fluide collant et adhésif s’enflamme au contact de l’air. Au prix d’une action, tu peux lancer cette flasque jusqu’à 6 m (20 pi) ; elle se brise à l’impact. Fais une attaque à distance contre une créature ou un objet, en considérant le feu grégeois comme une arme improvisée. En cas de réussite, la cible subit 1d4 dégâts de feu au début de chacun de ses tours. Une créature peut mettre fin à ces dégâts en utilisant son action pour réussir un test de Dextérité DD 10 afin d’éteindre les flammes.",
  "antitoxin vial": "Une créature qui boit cette fiole de liquide obtient l’avantage aux jets de sauvegarde contre le poison pendant 1 heure. Elle ne confère aucun avantage aux morts-vivants ni aux créatures artificielles.",
  "arcane focus": "Un focaliseur arcanique est un objet spécial (orbe, cristal, baguette, bâton en bois, sceptre ou objet similaire) conçu pour canaliser l’énergie des sorts profanes. Un ensorceleur, un magicien ou un occultiste peut l’utiliser comme focaliseur d’incantation.",
  "backpack": "Un sac à dos en cuir pouvant contenir jusqu’à 30 litres (1 pied cube) ou 30 lb d’équipement. Tu peux aussi attacher des objets à l’extérieur, comme un sac de couchage ou une corde enroulée.",
  "ball bearings bag of 1000": "Au prix d’une action, tu peux répandre ces petites billes métalliques hors de leur bourse pour couvrir une surface carrée de 3 m (10 pi) de côté. Une créature qui traverse cette zone doit réussir un jet de sauvegarde de Dextérité DD 10 ou tomber à terre. Une créature qui se déplace dans la zone à la moitié de sa vitesse n’a pas besoin de faire ce jet de sauvegarde.",
  "barrel": "Un tonneau en bois cerclé de fer pouvant contenir jusqu’à 150 litres de liquide ou 4 pieds cubes de solides.",
  "basket": "Un panier tressé pouvant contenir jusqu’à 2 pieds cubes ou 40 lb d’équipement.",
  "bedroll": "Un sac de couchage simple offrant un peu de chaleur et de confort pour dormir en plein air.",
  "bell": "Une petite clochette qui tinte clairement lorsqu’on la secoue.",
  "blanket": "Une couverture épaisse en laine pour se protéger du froid.",
  "block and tackle": "Un jeu de poulies avec un câble passé dedans et un crochet pour l’attacher à un objet. Un palan te permet de hisser jusqu’à quatre fois le poids que tu peux normalement soulever.",
  "book": "Un livre peut contenir de la poésie, des récits historiques, des informations relatives à un domaine précis de savoir, des diagrammes et notes sur des engins gnomes, ou tout ce qui peut être représenté par du texte ou des illustrations.",
  "bottle glass": "Une bouteille en verre solide dotée d’un bouchon, pouvant contenir jusqu’à 0,75 litre de liquide.",
  "bucket": "Un seau en bois ou en métal pouvant contenir jusqu’à 11 litres de liquide ou un demi-pied cube de solides.",
  "caltrops bag of 20": "Au prix d’une action, tu peux répandre un sac de chausse-trappes sur une case carrée de 1,50 m (5 pi) de côté. Toute créature qui entre dans la zone doit réussir un jet de sauvegarde de Dextérité DD 15 ou arrêter son déplacement ce tour-ci et subir 1 dégât perforant. Subir ces dégâts réduit sa vitesse de marche de 3 m (10 pi) jusqu’à ce qu’elle récupère au moins 1 point de vie. Une créature qui se déplace dans la zone à la moitié de sa vitesse n’a pas besoin de faire ce jet.",
  "candle": "Pendant 1 heure, une bougie diffuse une lumière vive dans un rayon de 1,50 m (5 pi) et une lumière faible sur 1,50 m (5 pi) supplémentaires.",
  "case crossbow bolt": "Cet étui en bois peut contenir jusqu’à vingt carreaux d’arbalète.",
  "case map or scroll": "Cet étui cylindrique en cuir peut contenir jusqu’à dix feuilles de papier roulées ou cinq feuilles de parchemin roulées.",
  "chain 10 feet": "Une chaîne a une CA de 10 et 10 points de vie. Elle peut être brisée par un test de Force DD 20 réussi.",
  "chalk 1 piece": "Un morceau de craie permettant de tracer des marques sur la pierre, le bois ou le métal.",
  "chest": "Un coffre en bois renforcé de fer pouvant contenir jusqu’à 12 pieds cubes ou 300 lb d’équipement.",
  "climber s kit": "Un matériel d’escalade comprend des pitons spéciaux, des pointes de bottes, des gants et un harnais. Tu peux utiliser ce matériel au prix d’une action pour t’ancrer ; tant que tu es ancré, tu ne peux pas tomber de plus de 7,50 m (25 pi) depuis le point d’ancrage, et tu ne peux pas grimper à plus de 7,50 m (25 pi) de ce point sans défaire l’ancrage.",
  "clothes common": "Des vêtements simples et robustes portés au quotidien par les gens ordinaires.",
  "clothes costume": "Une tenue de scène ou de déguisement colorée, adaptée aux représentations ou aux mascarades.",
  "clothes fine": "Des vêtements raffinés taillés dans de beaux tissus, dignes des nobles et des riches marchands.",
  "clothes traveler s": "Des vêtements solides, des bottes et une cape conçus pour résister aux longs voyages et aux intempéries.",
  "component pouch": "Une sacoche en cuir étanche fixée à la ceinture, dotée de compartiments pour contenir toutes les composantes matérielles et autres objets spéciaux dont tu as besoin pour lancer tes sorts, à l’exception des composantes ayant un coût spécifique.",
  "crowbar": "Utiliser un pied de biche confère l’avantage aux tests de Force où l’effet de levier peut s’appliquer.",
  "druidic focus": "Un focaliseur druidique peut être un brin de gui ou de houx, une baguette ou un sceptre taillé dans du bois d’if ou un autre bois spécial, un bâton tiré entier d’un arbre vivant, ou un objet totémique incorporant plumes, fourrure, os et dents d’animaux sacrés. Un druide peut l’utiliser comme focaliseur d’incantation.",
  "fishing tackle": "Ce matériel comprend une canne à pêche en bois, une ligne en soie, des flotteurs en liège, des hameçons en acier, des plombs, des leurres en velours et des filets à mailles fines.",
  "flask": "Une flasque ou une chope pouvant contenir jusqu’à 0,5 litre de liquide.",
  "grappling hook": "Un grappin en fer à accrocher au bout d’une corde pour escalader ou saisir un rebord à distance.",
  "hammer": "Un marteau ordinaire servant à enfoncer des clous ou des pitons.",
  "hammer sledge": "Une lourde masse à deux mains pour briser la pierre ou enfoncer des pieux.",
  "healer s kit": "Ce nécessaire est une pochette en cuir contenant des bandages, des onguents et des attelles. La trousse permet 10 utilisations. Au prix d’une action, tu peux dépenser une utilisation pour stabiliser une créature à 0 point de vie sans avoir besoin de faire un test de Sagesse (Médecine).",
  "holy symbol": "Un symbole sacré est la représentation d’un dieu ou d’un panthéon. Il peut s’agir d’une amulette portant le symbole d’une divinité, du même symbole gravé ou incrusté comme emblème sur un bouclier, ou d’une minuscule boîte renfermant un fragment de relique sacrée. Un clerc ou un paladin peut l’utiliser comme focaliseur d’incantation.",
  "holy water flask": "Au prix d’une action, tu peux asperger d’eau bénite une créature située à 1,50 m (5 pi) ou moins, ou lancer la flasque jusqu’à 6 m (20 pi) pour qu’elle se brise à l’impact. Dans les deux cas, fais une attaque à distance contre une créature cible, en considérant l’eau bénite comme une arme improvisée. Si la cible est un fiélon ou un mort-vivant, elle subit 2d6 dégâts radiants.",
  "hourglass": "Un sablier mesurant l’écoulement du temps avec précision.",
  "hunting trap": "Lorsque tu utilises ton action pour le tendre, ce piège forme un anneau à mâchoires en dents de scie qui se referme lorsqu’une créature marche sur la plaque de pression centrale. Le piège est fixé par une lourde chaîne à un objet immobile. Une créature qui marche sur la plaque doit réussir un jet de sauvegarde de Dextérité DD 13 ou subir 1d4 dégâts perforants et voir son déplacement s’arrêter. Tant qu’elle reste prise, son déplacement est limité par la longueur de la chaîne (1 m / 3 pi). Une créature peut utiliser son action pour faire un test de Force DD 13 et se libérer ou libérer une autre créature à portée ; chaque échec inflige 1 dégât perforant.",
  "ink 1 ounce bottle": "Une petite bouteille contenant environ 30 cl d’encre noire pour écrire.",
  "ink pen": "Une plume taillée pour écrire avec de l’encre sur du papier ou du parchemin.",
  "jug": "Une cruche ou un pichet pouvant contenir jusqu’à 4 litres de liquide.",
  "ladder 10 foot": "Une échelle en bois droite de 3 m (10 pi) de haut.",
  "lamp": "Une lampe diffuse une lumière vive dans un rayon de 4,50 m (15 pi) et une lumière faible sur 9 m (30 pi) supplémentaires. Une fois allumée, elle brûle pendant 6 heures avec une flasque d’huile (0,5 litre).",
  "lantern bullseye": "Une lanterne sourde diffuse une lumière vive dans un cône de 18 m (60 pi) et une lumière faible sur 18 m (60 pi) supplémentaires. Une fois allumée, elle brûle pendant 6 heures avec une flasque d’huile.",
  "lantern hooded": "Une lanterne à capote diffuse une lumière vive dans un rayon de 9 m (30 pi) et une lumière faible sur 9 m (30 pi) supplémentaires. Une fois allumée, elle brûle pendant 6 heures avec une flasque d’huile. Au prix d’une action, tu peux baisser la capote pour réduire la lumière à une lumière faible dans un rayon de 1,50 m (5 pi).",
  "lock": "Une clé est fournie avec le cadenas. Sans la clé, une créature qui maîtrise les outils de voleur peut crocheter ce cadenas avec un test de Dextérité DD 15 réussi. Ton MJ peut décider que de meilleurs cadenas existent à des prix plus élevés.",
  "magnifying glass": "Cette lentille permet d’observer de près de petits objets. Elle est aussi utile pour remplacer le briquet afin d’allumer un feu. Allumer un feu avec une loupe nécessite une lumière aussi vive que celle du soleil, de l’amadou et environ 5 minutes. Une loupe confère l’avantage aux tests de caractéristique effectués pour estimer ou inspecter un objet petit ou très détaillé.",
  "manacles": "Ces entraves métalliques peuvent retenir une créature de taille Petite ou Moyenne. S’en échapper nécessite un test de Dextérité DD 20 réussi. Les briser nécessite un test de Force DD 20 réussi. Chaque paire de menottes est fournie avec une clé. Sans la clé, une créature maîtrisant les outils de voleur peut crocheter la serrure avec un test de Dextérité DD 15 réussi. Les menottes ont 15 points de vie.",
  "mess kit": "Cette boîte en fer-blanc contient une tasse et des couverts simples. La boîte se ferme hermétiquement, et un côté sert de poêle tandis que l’autre s’utilise comme assiette ou bol peu profond.",
  "mirror steel": "Un petit miroir en acier poli, pratique pour regarder autour d’un angle sans se découvrir.",
  "oil flask": "L’huile est vendue en flasque d’argile de 0,5 litre. Au prix d’une action, tu peux asperger une créature à 1,50 m (5 pi) ou moins ou lancer la flasque jusqu’à 6 m (20 pi). Fais une attaque à distance contre la cible ; en cas de réussite, elle est couverte d’huile. Si la cible subit des dégâts de feu avant que l’huile ne sèche (1 minute), elle subit 5 dégâts de feu supplémentaires. Tu peux aussi verser une flasque d’huile sur une case de 1,50 m (5 pi) de côté ; allumée, elle brûle pendant 2 rounds et inflige 5 dégâts de feu à toute créature qui entre dans la zone ou y termine son tour.",
  "paper one sheet": "Une feuille de papier fin pour écrire ou dessiner.",
  "parchment one sheet": "Une feuille de parchemin robuste en peau préparée.",
  "perfume vial": "Un petit flacon d’huile parfumée.",
  "pick miner s": "Une pioche robuste conçue pour fendre la roche et creuser.",
  "piton": "Un piton en fer à planter dans la pierre pour fixer une corde d’escalade.",
  "poison basic vial": "Tu peux utiliser le poison de cette fiole pour enduire une arme tranchante ou perforante ou jusqu’à trois munitions. Appliquer le poison prend une action. Une créature touchée par l’arme ou la munition empoisonnée doit faire un jet de sauvegarde de Constitution DD 10 ou subir 1d4 dégâts de poison. Une fois appliqué, le poison conserve son efficacité pendant 1 minute avant de sécher.",
  "pole 10 foot": "Une perche en bois de 3 m (10 pi) de long, utile pour sonder le sol devant soi.",
  "pot iron": "Une marmite en fer pouvant contenir jusqu’à 4 litres.",
  "potion of healing": "Un personnage qui boit le liquide rouge et magique de cette fiole récupère 2d4 + 2 points de vie. Boire ou administrer une potion prend une action.",
  "pouch": "Une bourse en tissu ou en cuir pouvant contenir jusqu’à 20 billes de fronde ou 50 dards de sarbacane, ou d’autres petits objets.",
  "quiver": "Un carquois peut contenir jusqu’à 20 flèches.",
  "ram portable": "Tu peux utiliser un bélier portable pour enfoncer des portes. Ce faisant, tu gagnes un bonus de +4 au test de Force. Un autre personnage peut t’aider à manier le bélier, ce qui te confère l’avantage au test.",
  "rations 1 day": "Les rations se composent d’aliments secs adaptés aux longs voyages, comme de la viande séchée, des fruits secs, des biscuits de mer et des noix.",
  "robes": "Une robe ample portée par les érudits, les mages ou les membres du clergé.",
  "rope hempen 50 feet": "Une corde en chanvre de 15 m (50 pi) a 2 points de vie et peut être rompue par un test de Force DD 17 réussi.",
  "rope silk 50 feet": "Une corde en soie de 15 m (50 pi) a 2 points de vie et peut être rompue par un test de Force DD 17 réussi.",
  "sack": "Un sac en toile pouvant contenir jusqu’à 1 pied cube ou 30 lb d’équipement.",
  "scale merchant s": "Une balance comprend un petit fléau, des plateaux et un assortiment de poids jusqu’à 2 livres. Elle te permet de mesurer le poids exact de petits objets, comme des métaux précieux ou des marchandises, afin d’en déterminer la valeur.",
  "sealing wax": "Un bâton de cire colorée utilisé pour cacheter des lettres ou des documents.",
  "shovel": "Une pelle solide pour creuser la terre ou déblayer des décombres.",
  "signal whistle": "Un petit sifflet produisant un son perçant audible à bonne distance.",
  "signet ring": "Une bague ornée d’un sceau personnel permettant de marquer la cire à cacheter.",
  "soap": "Un pain de savon pour se laver.",
  "spellbook": "Indispensable aux magiciens, un grimoire est un tome relié de cuir contenant 100 feuilles de vélin vierges prêtes à recevoir des sorts.",
  "spikes iron 10": "Dix pointes en fer pouvant servir à caler une porte ou à ancrer une corde.",
  "spyglass": "Les objets observés à travers une longue-vue sont grossis au double de leur taille.",
  "tent two person": "Un abri en toile simple et portable, prévu pour abriter deux personnes.",
  "tinderbox": "Ce petit récipient contient du silex, un briquet en acier et de l’amadou (généralement du tissu sec imbibé d’huile) servant à allumer un feu. L’utiliser pour allumer une torche — ou tout autre matériau inflammable exposé — prend une action. Allumer tout autre feu prend 1 minute.",
  "torch": "Une torche brûle pendant 1 heure et diffuse une lumière vive dans un rayon de 6 m (20 pi) et une lumière faible sur 6 m (20 pi) supplémentaires. Si tu fais une attaque de corps à corps avec une torche allumée et que tu touches, elle inflige 1 dégât de feu.",
  "vial": "Une petite fiole en verre bouchée pouvant contenir jusqu’à 12 cl de liquide.",
  "waterskin": "Une outre en cuir pouvant contenir jusqu’à 2 litres (4 pintes) de liquide une fois pleine.",
  "whetstone": "Une pierre à aiguiser pour entretenir le tranchant des lames.",
  "alchemist s supplies": "Ce matériel permet de produire des substances alchimiques comme l’acide ou le feu grégeois, ainsi que d’identifier des potions ou des produits chimiques.",
  "brewer s supplies": "Tout le nécessaire pour brasser de la bière, du cidre ou d’autres boissons fermentées.",
  "calligrapher s supplies": "Des encres, des plumes et du papier fin pour calligraphier des textes ou détecter les faux.",
  "carpenter s tools": "Des outils de menuiserie et de charpente pour travailler le bois et bâtir des abris ou des structures.",
  "cartographer s tools": "Des plumes, de l’encre, du parchemin, une règle et un compas pour dresser des cartes précises.",
  "cobbler s tools": "Des outils pour fabriquer et réparer des bottes et des chaussures.",
  "cook s utensils": "Des marmites, des couteaux et des ustensiles pour préparer des repas même en voyage.",
  "disguise kit": "Cette pochette de cosmétiques, teintures capillaires et petits accessoires permet de créer des déguisements qui modifient ton apparence physique. La maîtrise de ce matériel te permet d’ajouter ton bonus de maîtrise aux tests de caractéristique effectués pour créer un déguisement visuel.",
  "forgery kit": "Cette petite boîte contient divers papiers et parchemins, plumes et encres, sceaux et cire à cacheter, feuilles d’or et d’argent et petits outils pour imiter des écritures et des cachets. La maîtrise de ce matériel permet d’ajouter ton bonus de maîtrise aux tests visant à réaliser une contrefaçon physique d’un document.",
  "glassblower s tools": "Des cannes à souffler et des pinces pour façonner le verre fondu.",
  "herbalism kit": "Ce matériel comprend divers instruments (pinces, mortier et pilon, sachets et fioles) utilisés par les herboristes pour préparer des remèdes et des potions. La maîtrise de ce matériel permet d’ajouter ton bonus de maîtrise aux tests visant à identifier ou appliquer des herbes. Elle est également requise pour fabriquer des antitoxines et des potions de guérison.",
  "jeweler s tools": "Des outils de précision pour tailler les gemmes et façonner les métaux précieux.",
  "leatherworker s tools": "Des alênes, des couteaux et des aiguilles pour travailler le cuir et réparer les armures légères.",
  "mason s tools": "Des marteaux, des ciseaux et une truelle pour tailler la pierre et monter des murs.",
  "navigator s tools": "Cet ensemble d’instruments sert à la navigation en mer. La maîtrise des instruments de navigateur permet de tracer la route d’un navire et d’éviter de se perdre en mer.",
  "painter s supplies": "Des pinceaux, des pigments et des toiles pour peindre et esquisser.",
  "poisoner s kit": "Un matériel d’empoisonneur comprend des fioles, des produits chimiques et d’autres équipements nécessaires à la préparation de poisons. La maîtrise de ce matériel permet d’ajouter ton bonus de maîtrise aux tests effectués pour fabriquer ou utiliser des poisons.",
  "potter s tools": "Des outils pour façonner l’argile et réaliser des récipients en céramique.",
  "smith s tools": "Des marteaux, des pinces et des limes pour forger et réparer le métal, les armes et les armures.",
  "thieves tools": "Cet ensemble d’outils comprend une petite lime, un jeu de crochets, un petit miroir monté sur une poignée métallique, une paire de ciseaux à lames fines et une paire de pinces. La maîtrise de ces outils permet d’ajouter ton bonus de maîtrise aux tests de caractéristique effectués pour désamorcer des pièges ou crocheter des serrures.",
  "tinker s tools": "Des outils fins pour réparer les mécanismes, les serrures et les petits objets métalliques.",
  "weaver s tools": "Des navettes, des aiguilles et du fil pour tisser et réparer des étoffes.",
  "woodcarver s tools": "Des gouges et des ciseaux pour sculpter le bois.",
  "burglar s pack": "Comprend un sac à dos, un sac de 1 000 billes, 3 m de ficelle, une cloche, 5 bougies, un pied de biche, un marteau, 10 pitons, une lanterne à capote, 2 flasques d’huile, 5 jours de rations, une boîte à amadou et une outre, plus 15 m de corde en chanvre attachés sur le côté.",
  "diplomat s pack": "Comprend un coffre, 2 étuis à cartes ou à parchemins, des vêtements de qualité, une bouteille d’encre, un porte-plume, une lampe, 2 flasques d’huile, 5 feuilles de papier, un flacon de parfum, de la cire à cacheter et du savon.",
  "dungeoneer s pack": "Comprend un sac à dos, un pied de biche, un marteau, 10 pitons, 10 torches, une boîte à amadou, 10 jours de rations et une outre, plus 15 m de corde en chanvre attachés sur le côté.",
  "entertainer s pack": "Comprend un sac à dos, un sac de couchage, 2 costumes, 5 bougies, 5 jours de rations, une outre et des accessoires de déguisement.",
  "explorer s pack": "Comprend un sac à dos, un sac de couchage, une gamelle, une boîte à amadou, 10 torches, 10 jours de rations et une outre, plus 15 m de corde en chanvre attachés sur le côté.",
  "priest s pack": "Comprend un sac à dos, une couverture, 10 bougies, une boîte à amadou, un tronc à offrandes, 2 blocs d’encens, un encensoir, des habits liturgiques, 2 jours de rations et une outre.",
  "scholar s pack": "Comprend un sac à dos, un livre de savoir, une bouteille d’encre, un porte-plume, 10 feuilles de parchemin, un petit sac de sable et un petit couteau.",
  "arrows 20": "Vingt flèches pour arc court ou arc long.",
  "blowgun needles 50": "Cinquante dards pour sarbacane.",
  "crossbow bolts 20": "Vingt carreaux pour arbalète.",
  "sling bullets 20": "Vingt billes de plomb pour fronde.",
};

function stripLeadingMeta(md: string): string {
  const idx = md.indexOf("\n\n");
  return idx === -1 ? md : md.slice(idx + 2).trim();
}

export function frenchItemDescription(name: string): string | null {
  const pageId = rulebookPageIdFor("item", name);
  if (pageId) {
    const fr = rulebookPage(pageId, "fr");
    if (fr?.page.md) {
      return stripLeadingMeta(fr.page.md);
    }
  }
  const key = textKey(name.replace(/['‘’ʼ´]/g, ""));
  return GEAR_DESC_FR[key] ?? null;
}

export function localizeItemEntryFr<T extends { name: string; source?: string; data?: unknown }>(entry: T): T {
  if (entry.source === "homebrew" || !entry.data || typeof entry.data !== "object") {
    return entry;
  }
  const desc = frenchItemDescription(entry.name);
  if (!desc) {
    return entry;
  }
  return {
    ...entry,
    data: { ...(entry.data as Record<string, unknown>), desc },
  };
}
