import type { Locale } from "@/lib/messages-logic";
import type { DmStatus } from "./useCampaignStream";

// 6+ variants per active DM status. The first entry in each pool is the
// original string (unchanged), so the current voice is preserved and simply
// joined by atmospheric and lightly comedic alternates. The English pool
// stays the source; DM_STATUS_PHRASES_FR below is its parallel, and
// dmStatusPhrase picks between the two by the interface's language. One
// line is chosen per status transition (see MessageList.tsx, the only
// consumer).
export const DM_STATUS_PHRASES: Record<Exclude<DmStatus, "idle">, string[]> = {
  thinking: [
    "The GM weighs the outcome…",
    "The GM consults the whims of fate…",
    "Somewhere, a d20 holds its breath…",
    "The GM strokes an imaginary beard…",
    "The GM ponders your fate…",
    "Buffering vibes…",
    "Rolling a Wisdom check to make good decisions…",
  ],
  rolling: [
    "The dice clatter across the table…",
    "The dice tumble into the dark…",
    "Bones are cast…",
    "Fate rattles in the cup…",
    "The dice go bouncing off the pizza box…",
    "Yeeting the dice…",
    "Praying to the RNG gods…",
  ],
  awaiting_rolls: [
    "The table waits on a roll…",
    "Grab your dice, the table waits…",
    "The GM taps the table, waiting on a roll…",
    "The party holds its breath for a roll…",
    "A roll hangs in the air…",
    "Someone find the d20 that rolled under the couch…",
  ],
  narrating: [
    "The next passage is forming…",
    "The story draws its next breath…",
    "The tale continues to unspool…",
    "Words gather at the edge of the page…",
    "The GM finds the next words…",
    "The scene shimmers into focus…",
  ],
  writing_chapter: [
    "The GM writes the chapter into the record…",
    "Ink meets parchment…",
    "The chronicle gains another page…",
    "The scribe dips the quill…",
    "The GM seals the chapter with wax…",
    "This tale is committed to the annals…",
  ],
  plotting_arc: [
    "The GM plots the road ahead…",
    "The GM unrolls a suspiciously large map…",
    "Threads of destiny are being tied…",
    "Storm clouds gather on the horizon…",
    "The GM adds another red string to the murder board…",
    "The GM plots something you'll regret…",
  ],
};

// The French pools, same shape and same register: playful, addressed to
// "tu", with the ellipsis and the d20 kept. The first entry of each pool
// mirrors the English original, for the same reason as above.
export const DM_STATUS_PHRASES_FR: Record<Exclude<DmStatus, "idle">, string[]> = {
  thinking: [
    "Le MJ pèse le pour et le contre…",
    "Le MJ consulte les caprices du destin…",
    "Quelque part, un d20 retient son souffle…",
    "Le MJ caresse une barbe imaginaire…",
    "Le MJ médite sur ton sort…",
    "Mise en mémoire tampon de l'ambiance…",
    "Jet de Sagesse pour prendre de bonnes décisions…",
  ],
  rolling: [
    "Les dés claquent sur la table…",
    "Les dés déculbutent dans le noir…",
    "Les os sont jetés…",
    "Le destin tinte dans le gobelet…",
    "Les dés rebondissent sur la boîte à pizza…",
    "Propulsion des dés…",
    "Prière aux dieux du hasard…",
  ],
  awaiting_rolls: [
    "La table attend de vrais dés…",
    "Attrape tes dés, la table attend…",
    "Le MJ tape du doigt, un jet est attendu…",
    "Le groupe retient son souffle pour un jet…",
    "Vrais dés exigés, sans pression…",
    "Que quelqu'un retrouve le d20 roulé sous le canapé…",
  ],
  narrating: [
    "Le prochain passage se forme…",
    "L'histoire reprend son souffle…",
    "Le récit continue de se dérouler…",
    "Les mots se rassemblent au bord de la page…",
    "Le MJ cherche les mots suivants…",
    "La scène scintille et se précise…",
  ],
  writing_chapter: [
    "Le MJ inscrit le chapitre au registre…",
    "L'encre rencontre le parchemin…",
    "La chronique gagne une page de plus…",
    "Le scribe trempe la plume…",
    "Le MJ scelle le chapitre avec de la cire…",
    "Ce récit rejoint les annales…",
  ],
  plotting_arc: [
    "Le MJ trace la route à venir…",
    "Le MJ déroule une carte suspectement immense…",
    "Les fils du destin se nouent…",
    "Des nuages d'orage s'amoncellent à l'horizon…",
    "Le MJ ajoute une ficelle rouge au tableau du détective…",
    "Le MJ ourdit quelque chose que tu regretteras…",
  ],
};

// FNV-1a plus a murmur-style finalizer. The avalanche matters: a weaker mix
// leaves the six-entry pools reachable only at half their entries.
function hashString(value: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

// One flavor line for the status, picked deterministically from the latest
// message id rather than with Math.random, so it stays put through the
// animate-pulse re-renders and survives hydration, while still varying from
// one turn to the next. Keyed on the id (not the message count, which the
// 200-message cap pins in long sessions) and salted with the status, so the
// beats within a single turn read differently too. The locale picks the
// pool, so a reader on a French interface reads the French line.
export function dmStatusPhrase(locale: Locale, status: DmStatus, turnKey: string): string {
  if (status === "idle") {
    return "";
  }
  const pool = (locale === "fr" ? DM_STATUS_PHRASES_FR : DM_STATUS_PHRASES)[status];
  return pool[hashString(turnKey + status) % pool.length];
}
