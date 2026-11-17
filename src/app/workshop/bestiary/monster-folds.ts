import type { MonsterDraft } from "@/lib/bestiary/monster-draft";
import { damageWords } from "@/lib/dm/damage-logic";
import { translate, type Locale } from "@/lib/messages-logic";

// The monster editor's folded groups (MonsterEditor.tsx): the block's core
// numbers and attacks lead, and the specialist parts sit closed beneath a
// line that says what each holds, so nothing set is hidden unseen. Pure,
// for scripts/test-monster-folds.mjs — the default translator keeps those
// English outputs byte-identical (seat-preview.ts's idiom).

type T = (key: string, vars?: Record<string, string | number>) => string;
const enT: T = (key, vars) => translate("en", key, vars);

export type MonsterFold = "actions" | "spellcasting" | "regeneration" | "senses";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// The sight words the French SRD's own stat blocks print (« Sens » lines:
// vision dans le noir, vision aveugle, perception des vibrations, vision
// lucide). The stored keys stay English; only the line reads the reader's
// language. Feet stay feet: they are the engine's own unit here.
const SENSE_WORDS_FR: Record<string, string> = {
  darkvision: "vision dans le noir",
  blindsight: "vision aveugle",
  tremorsense: "perception des vibrations",
  truesight: "vision lucide",
};

function senseWord(sense: string, locale: Locale): string {
  if (locale !== "fr") {
    return sense;
  }
  return SENSE_WORDS_FR[sense] ?? sense;
}

export function monsterFoldSummary(fold: MonsterFold, draft: MonsterDraft, t: T = enT, locale: Locale = "en"): string {
  const stats = draft.stats;
  switch (fold) {
    case "actions": {
      const parts = [
        stats.routines?.length ? t("a Multiattack routine") : "",
        stats.specials?.length
          ? plural(stats.specials.length, t("special"), t("specials"))
          : "",
        stats.traits?.length
          ? plural(stats.traits.length, t("trait line"), t("trait lines"))
          : "",
      ].filter(Boolean);
      return parts.length ? parts.join(" · ") : t("None yet: Multiattack, a breath weapon and other specials go here");
    }
    case "spellcasting": {
      const casting = stats.spellcasting;
      const spells = casting?.spells.length ?? stats.spells?.length ?? 0;
      if (!casting && !spells) return t("None: this creature casts no spells");
      return [
        spells ? plural(spells, t("spell"), t("spells")) : "",
        casting?.dc ? t("save DC {dc}", { dc: casting.dc }) : "",
        casting?.attack !== undefined ? t("+{attack} to hit", { attack: casting.attack }) : "",
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "regeneration": {
      const regen = stats.regeneration;
      if (!regen) return t("None", { context: "workshop.bestiary.folds.regenNone" });
      return t("Regains {amount} hit points a turn{stoppedBy}", {
        amount: regen.amount,
        stoppedBy: regen.stoppedBy.length
          ? t(", stopped by {list}", { list: regen.stoppedBy.map((entry) => damageWords(entry, locale)).join(t(" or ")) })
          : "",
      });
    }
    case "senses": {
      const senses = stats.senses ?? {};
      const sight = (["darkvision", "blindsight", "tremorsense", "truesight"] as const)
        .filter((sense) => senses[sense])
        .map((sense) => `${senseWord(sense, locale)} ${senses[sense]} ft`);
      const skills = Object.keys(stats.skills ?? {}).length;
      const parts = [
        skills ? plural(skills, t("skill"), t("skills")) : "",
        ...sight,
        stats.languages ? stats.languages : "",
      ].filter(Boolean);
      return parts.length ? parts.join(" · ") : t("None set", { context: "workshop.bestiary.folds.sensesNone" });
    }
  }
}
