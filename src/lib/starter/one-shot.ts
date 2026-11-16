import { createCampaign, getCampaignForUser, setDmOutline, type Campaign } from "@/lib/db/campaigns";
import { getClock, setClockInstant } from "@/lib/db/clock";
type Locale = "en" | "fr";
import { MINUTES_PER_DAY, MINUTES_PER_HOUR } from "@/lib/dm/calendar";

// The starter one-shot: a table that opens in ten minutes for people who
// have never played. One evening, level 1, a village, a crypt, a twist.
// The premise below is what the players read; the outline is the DM's
// secret spine, written into the campaign's DM outline so the story-arc
// planner keeps to it (src/lib/dm/arc.ts reads dmOutline). The heroes are
// src/lib/starter/pregens.ts, picked from the lobby.

// Six in the evening, the hour the premise opens on.
export const STARTER_HOUR = 18;

export const STARTER_ONE_SHOT = {
  id: "silent-bell",
  title: "The Silent Bell of Marrow's Crossing",
  tagline: "A one-evening adventure for newcomers, with ready-made heroes.",
  // What the players are told.
  description:
    "Marrow's Crossing is a river village of forty souls whose chapel bell has rung the hour for two hundred years. Three nights ago it stopped. The sexton has not been seen since, the ferry will not run after dark, and the village council will pay twenty gold a head to whoever finds out why. You arrive at dusk, as the fog comes off the water.",
  theme: "A fog-bound river village, a chapel on the hill, and the crypt beneath it",
  // The DM's secret spine. Short on purpose: a one-shot wants three beats
  // and a turn, not a saga.
  outline: [
    "ONE-SHOT, three beats, one evening. Keep scenes short, give the party a decision every few passages, and land the ending by the third beat. Level 1 throughout; no level-up.",
    "The truth: the sexton, Aldo Merrin, stole the chapel bell himself to pay a smuggler's debt. His brother-in-law Tam (the ferryman) helped him lower it into the flooded crypt under the chapel, meaning to sell it downriver. Aldo went back alone the next night to move it, disturbed the old dead, and was killed; he now walks the crypt as a ghoul. Tam is terrified, lying, and guilty.",
    "Beat 1, the village at dusk: the council's offer (Mother Hesk, sharp and tired), the empty sexton's cottage (a ledger with crossed-out debts and a smuggler's mark: a fish hook), Tam at the ferry who will not meet anyone's eye. A Persuasion or Insight success on Tam reveals the debt; a failure sends the party to the chapel with only the ledger. Reward curiosity, never block the path.",
    "Beat 2, the chapel and the crypt: the belfry's rope cut clean, drag marks to the crypt stair, the lower crypt knee-deep in black water. Threats, in order: a swarm of giant rats in the ossuary, a snare trap on the stair (DC 12 Perception to spot, 1d6 if sprung), then the ghoul that was Aldo in the bell chamber beside the bell. Four heroes at level 1 can take the ghoul; two or three should get the chance to lure it into the water or bar a door. Aldo still wears the sexton's key on a cord; the ghoul's paralysis is the danger to telegraph.",
    "Beat 3, the reckoning: the bell is found, the heroes decide what to say. If they expose Tam, the council banishes him and the ferry needs a new hand; if they cover for him, the bell rings again and the debt follows them downriver as a hook for another evening. Either way the bell is rung at dawn. Close with the sound carrying over the water, and ask each player what their hero does with twenty gold.",
    "Tone: Ravenloft-lite river gothic, fog and lamplight, no gore. NPC names: Mother Hesk (council), Tam Rill (ferryman), Aldo Merrin (sexton), Widow Pell (runs the inn, knows everyone's business, trades gossip for help with the stove).",
  ].join("\n\n"),
};

// The same evening in French (the official French SRD's terms): a table
// created by a French-reading creator keeps its whole premise, spine
// included, in the language the table plays in. English tables are unchanged.
export const STARTER_ONE_SHOT_FR = {
  title: "La cloche silencieuse de Gué-Marais",
  tagline: "Une aventure d’un soir pour débutants, avec des héros prêts à jouer.",
  description:
    "Gué-Marais est un village riverain de quarante âmes dont la cloche de la chapelle sonne les heures depuis deux cents ans. Il y a trois nuits, elle s’est tue. Le sonneur n’a plus donné signe de vie, le bac ne traverse plus après la nuit tombée, et le conseil du village paiera vingt pièces d’or à quiconque découvrira pourquoi. Vous arrivez au crépuscule, tandis que la brume monte de l’eau.",
  theme: "Un village au bord de la rivière noyé de brume, une chapelle sur la colline, et la crypte en dessous",
  outline: [
    "ONE-SHOT : trois temps, un soir. Garde les scènes courtes, offre une décision au groupe tous les deux ou trois passages, et conclus au troisième temps. Niveau 1 du début à la fin ; pas de montée de niveau.",
    "La vérité : le sonneur, Aldo Merrin, a lui-même volé la cloche de la chapelle pour payer une dette de contrebande. Son beau-frère Tam (le passeur) l’a aidé à la descendre dans la crypte inondée sous la chapelle, pour la vendre plus loin au fil de l’eau. Aldo est revenu seul la nuit suivante pour la déplacer, a dérangé les morts anciens, et y a laissé sa vie ; il hante à présent la crypte en goule. Tam, lui, est terrifié, menteur et coupable.",
    "Temps 1, le village au crépuscule : l’offre du conseil (mère Hesk, acérée et épuisée), la maisonnette vide du sonneur (un registre de dettes raturées et une marque de contrebandier : un hameçon), Tam au bac qui ne regarde personne dans les yeux. Un succès de Persuasion ou de Discernement sur Tam révèle la dette ; un échec envoie le groupe à la chapelle avec seulement le registre. Récompense la curiosité, ne bouche jamais le chemin.",
    "Temps 2, la chapelle et la crypte : la corde du beffroi tranchée net, des traînées de dragage jusqu’à l’escalier de la crypte, la crypte basse avec de l’eau noire jusqu’aux genoux. Les menaces, dans l’ordre : une nuée de rats géants dans l’ossuaire, un lacet dans l’escalier (DD 12 de Perception pour le repérer, 1d6 s’il se déclenche), puis la goule qu’était Aldo dans la chambre de la cloche, auprès de la cloche. Quatre héros de niveau 1 viennent à bout de la goule ; à deux ou trois, il faut pouvoir jouer de la ruse : l’attirer dans l’eau ou barricader une porte. Aldo porte toujours la clé du sonneur au bout d’un cordon ; la paralysie de la goule est le danger à annoncer.",
    "Temps 3, le règlement : la cloche est retrouvée, les héros décident de ce qu’ils diront. S’ils dénoncent Tam, le conseil le bannit et le bac cherche une nouvelle main ; s’ils le couvrent, la cloche sonnera de nouveau et la dette les suivra au fil de l’eau, en appât pour un autre soir. Dans tous les cas, la cloche sonne à l’aube. Conclus sur le son qui porte au-dessus de l’eau, et demande à chaque joueuse et joueur ce que son héros fait des vingt pièces d’or.",
    "Ton : gothique fluvial à la Ravenloft, brume et lumières de lampe, rien de gore. PNJ : mère Hesk (conseil), Tam Rill (passeur), Aldo Merrin (sonneur), veuve Pell (tient l’auberge, sait tout de la vie de chacun, troque des ragots contre un coup de main à la cuisine).",
  ].join("\n\n"),
};

// The seed the creator reads: the request’s language, English by default,
// so an English table’s stored premise and spine stay English.
export function starterSeedFor(locale: Locale) {
  return locale === "fr" ? { ...STARTER_ONE_SHOT, ...STARTER_ONE_SHOT_FR } : STARTER_ONE_SHOT;
}

// narration: whether the server can read aloud (narrationAvailable in
// src/lib/capabilities.ts); unsaid, the table's switch starts on.
export function createStarterCampaign(userId: string, options: { solo: boolean; narration?: boolean; locale?: Locale }): Campaign {
  const seed = starterSeedFor(options.locale ?? "en");
  const campaign = createCampaign(userId, {
    title: seed.title,
    description: seed.description,
    theme: seed.theme,
    maxPlayers: options.solo ? 1 : 5,
    startingLevel: 1,
    difficulty: "normal",
    gameSettings: {
      dmMode: "ai",
      genre: "high_fantasy",
      campaignLength: "short",
      ttsEnabled: options.narration ?? true,
      // The outline is written below, before anyone presses Begin, so the
      // setup pass stands aside (src/lib/dm/setup.ts runs only for a table
      // with no outline yet) and the arc planner builds from the outline.
      // The setting stays at its default; it has nothing to do here.
      aiStorySetup: true,
    },
  });
  setDmOutline(campaign.id, seed.outline);
  // "You arrive at dusk": the clock says so too. A new campaign's clock opens
  // at eight in the morning, and the DM narrates the hour the clock shows, so
  // the premise and the opening scene disagreed until a model thought to
  // pass the day itself. Only the hour moves: the day and the calendar stay
  // the ones the campaign opened with.
  const opened = getClock(campaign.id).instant;
  setClockInstant(campaign.id, opened - (opened % MINUTES_PER_DAY) + STARTER_HOUR * MINUTES_PER_HOUR);
  // Read back as the owner sees it, so the starter route reports the same
  // role POST /api/campaigns does.
  return getCampaignForUser(campaign.id, userId) ?? campaign;
}
