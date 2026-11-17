"use client";

import { SectionHead } from "@/components/ui/SectionHead";
import { ui } from "@/lib/ui";
import { ChipList, LineList, PairList } from "@/app/workshop/plugin/fields";
import type { SectionProps } from "@/app/workshop/plugin/types";
import { useT } from "@/lib/locale";

// The setting half of a pack: what the narrator is handed about the world
// beyond its names. Factions, places, hooks and a glossary go into the
// game-state block; name seeds are offered as clickable suggestions in the
// character builder. Pull from this workshop (in the panel header) fills
// these from the factions, lore, places, hook cards and cast already built
// here.

export function SettingSection({ draft, onDraft }: SectionProps) {
  const t = useT();
  return (
    <div className="space-y-4">
      <section className={ui.card + " p-4"}>
        <SectionHead title={t("Factions")} glyph="system-factions" className="mb-0" />
        <p className="mb-3 text-[11px] text-stone-500">{t("Who holds power and what they want. The workshop's factions land here when you pull from it, with where each is based and who belongs, as far as the line goes.")}</p>
        <PairList
          items={draft.factions}
          onChange={(factions) => onDraft({ ...draft, factions })}
          first={{ key: "name", label: t("Faction"), max: 60 }}
          second={{ key: "blurb", label: t("What they are about"), max: 200 }}
          addLabel={t("Add a faction")}
          empty={t("No factions yet.")}
        />
      </section>
      <section className={ui.card + " p-4"}>
        <SectionHead title={t("Places")} glyph="system-region" className="mb-0" />
        <p className="mb-3 text-[11px] text-stone-500">{t("The places a campaign can start in or travel to.")}</p>
        <PairList
          items={draft.locations}
          onChange={(locations) => onDraft({ ...draft, locations })}
          first={{ key: "name", label: t("Place", { context: "workshop.plugin.placeLabel" }), max: 60 }}
          second={{ key: "blurb", label: t("What it is like"), max: 200 }}
          addLabel={t("Add a place")}
          empty={t("No places yet.")}
        />
      </section>
      <section className={ui.card + " p-4"}>
        <SectionHead title={t("Hooks")} glyph="quest-active" className="mb-0" />
        <p className="mb-3 text-[11px] text-stone-500">{t("Adventure hooks, one line each. Storyboard hook cards land here when you pull.")}</p>
        <LineList
          items={draft.hooks}
          onChange={(hooks) => onDraft({ ...draft, hooks })}
          maxLength={240}
          addLabel={t("Add a hook")}
          placeholder="A tide-priest offers to pay for a relic nobody else will touch."
          empty={t("No hooks yet.")}
        />
      </section>
      <section className={ui.card + " p-4"}>
        <SectionHead title={t("Glossary")} glyph="tab-reference" className="mb-0" />
        <p className="mb-3 text-[11px] text-stone-500">{t("Words the world uses and what they mean, so the narrator uses them the same way you do.")}</p>
        <PairList
          items={draft.glossary}
          onChange={(glossary) => onDraft({ ...draft, glossary })}
          first={{ key: "term", label: t("Term"), max: 40 }}
          second={{ key: "meaning", label: t("Meaning"), max: 160 }}
          addLabel={t("Add a term")}
          empty={t("No glossary yet.")}
        />
      </section>
      <section className={ui.card + " p-4"}>
        <SectionHead title={t("Name seeds")} glyph="tab-characters" className="mb-0" />
        <p className="mb-3 text-[11px] text-stone-500">{t("Names offered as one-tap suggestions in the character builder. Six or more of each reads as a world with a sound of its own.")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="mb-1 block font-display text-[11px] tracking-[0.1em] text-amber-300/85">{t("People", { context: "workshop.plugin.people" })}</span>
            <ChipList
              items={draft.nameSeeds.people}
              onChange={(people) => onDraft({ ...draft, nameSeeds: { ...draft.nameSeeds, people } })}
              placeholder={t("A person's name")}
            />
          </div>
          <div>
            <span className="mb-1 block font-display text-[11px] tracking-[0.1em] text-amber-300/85">{t("Places")}</span>
            <ChipList
              items={draft.nameSeeds.places}
              onChange={(places) => onDraft({ ...draft, nameSeeds: { ...draft.nameSeeds, places } })}
              placeholder={t("A place name")}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
