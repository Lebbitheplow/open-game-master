"use client";

import { SectionHead } from "@/components/ui/SectionHead";
import {
  CheckField,
  NumberField,
  SelectField,
  TextField,
  ToggleChips,
} from "@/app/workshop/homebrew/fields";
import { CLASS_IDS, SPELL_SCHOOLS } from "@/app/workshop/homebrew/types";
import {
  CASTING_TIMES,
  SPELL_COMPONENTS,
  SPELL_DURATIONS,
  SPELL_RANGES,
} from "@/lib/workshop/pickers";
import { SPELL_SCHOOL_BLURBS, glossaryFor } from "@/lib/help/terms";
import { SpellMechFields } from "@/app/workshop/homebrew/SpellMechFields";
import type { Data } from "@/app/workshop/homebrew/draft";
import { effectiveSpellPreview } from "@/lib/workshop/spell-preview";
import { bundledSpellNames, materialCostFrom } from "@/lib/srd/spell-facts";
import { useT } from "@/lib/locale";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";

// The spell form. The description is the part the engine reads its damage
// out of, the same way it reads the SRD's, unless the block underneath says
// otherwise; the preview shows what the table will actually roll and which
// of the two it came from. The block is the part prose cannot state: how the
// spell resolves, which save, what condition or buff it applies.

const RUNS_AS_OPTIONS = bundledSpellNames().map((name) => ({ value: name, label: name }));

export function SpellFields({
  data,
  onChange,
  workshopClasses = [],
}: {
  data: Data;
  onChange: (next: Data) => void;
  // The author's own classes (homebrew kind "class"): a spell tagged with one
  // is on that class's list (issue #833, src/lib/classes/class-spell-list.ts).
  workshopClasses?: Array<{ id: string; name: string }>;
}) {
  const t = useT();
  const set = (patch: Data) => onChange({ ...data, ...patch });
  // An older host never reads a spell's workshop class (src/lib/capabilities.ts
  // customSpellLists), so it is offered only where it counts; one already
  // tagged stays shown so it can be taken off.
  const tagged = Array.isArray(data.classes) ? (data.classes as string[]) : [];
  const offersOwn = hostOffers(useCapabilities(), "customSpellLists");
  const ownClasses = workshopClasses.filter((klass) => offersOwn || tagged.includes(klass.id));
  const preview = effectiveSpellPreview(data);
  const hasMaterial = /\bM\b/.test(String(data.components ?? "").split("(")[0].toUpperCase());
  const cost = typeof data.materialCostGp === "number" ? data.materialCostGp : null;

  return (
    <div className="space-y-3">
      <SectionHead title={t("The casting")} glyph="rest-spell-slot" className="mb-1" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <NumberField
          label={t("Level")}
          value={typeof data.level === "number" ? data.level : 1}
          min={0}
          max={9}
          onChange={(level) => set({ level: level === "" ? 0 : level })}
          hint={t("0 is a cantrip.")}
        />
        <SelectField
          label={t("School")}
          value={String(data.school ?? "evocation")}
          options={SPELL_SCHOOLS.map((value) => ({ value, label: value }))}
          onChange={(school) => set({ school })}
          glossary={{ title: t("Schools of magic"), entries: glossaryFor(SPELL_SCHOOLS, SPELL_SCHOOL_BLURBS) }}
        />
        <TextField
          label={t("Casting time")}
          value={String(data.casting_time ?? "")}
          onChange={(casting_time) => set({ casting_time })}
          maxLength={60}
          suggestions={CASTING_TIMES}
          hint={t("How long it takes to cast. Most spells take one action.")}
        />
        <TextField
          label={t("Range")}
          value={String(data.range ?? "")}
          onChange={(range) => set({ range })}
          maxLength={60}
          suggestions={SPELL_RANGES}
          hint={t("How far away the target can be. Self means the caster only.")}
        />
        <TextField
          label={t("Components")}
          value={String(data.components ?? "")}
          onChange={(components) => set({ components })}
          maxLength={120}
          suggestions={SPELL_COMPONENTS}
          hint={t("V spoken words, S a free hand, M a material (name it after M in brackets).")}
        />
        <TextField
          label={t("Duration")}
          value={String(data.duration ?? "")}
          onChange={(duration) => set({ duration })}
          maxLength={60}
          suggestions={SPELL_DURATIONS}
          hint={t("How long the effect lasts. Concentration spells end when the caster loses focus.")}
        />
        <div className="col-span-2 flex flex-wrap items-end gap-3">
          <CheckField label={t("Concentration")} checked={data.concentration === true} onChange={(concentration) => set({ concentration })} />
          <CheckField label={t("Ritual")} checked={data.ritual === true} onChange={(ritual) => set({ ritual })} />
        </div>
      </div>

      {hasMaterial ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <TextField
            label={t("Material", { context: "workshop.homebrew.spell.material" })}
            className="col-span-2"
            value={String(data.material ?? "")}
            onChange={(material) => {
              // A price in the words fills the price, as the books print it.
              const stated = materialCostFrom(material);
              set({
                material: material || undefined,
                ...(stated.costGp && cost === null ? { materialCostGp: stated.costGp, materialConsumed: stated.consumed || undefined } : {}),
              });
            }}
            maxLength={300}
            placeholder="diamonds worth 300 gp, which the spell consumes"
            hint={t("What the caster must hold. A component pouch or a focus stands in for one with no price.")}
          />
          <NumberField
            label={t("Costs (gp)")}
            value={cost ?? ""}
            min={0}
            max={1_000_000}
            onChange={(value) => set({ materialCostGp: value === "" || value === 0 ? undefined : value, ...(value === "" || value === 0 ? { materialConsumed: undefined } : {}) })}
            hint={t("A priced material must be carried or paid for: the cast guard refuses the spell without it.")}
          />
          <div className="flex items-end pb-1">
            <CheckField
              label={t("The spell consumes it")}
              checked={data.materialConsumed === true}
              onChange={(materialConsumed) => set({ materialConsumed: materialConsumed && cost ? true : undefined })}
            />
          </div>
        </div>
      ) : null}

      <TextField
        label={t("Runs as")}
        value={String(data.runsAs ?? "")}
        onChange={(runsAs) => set({ runsAs: runsAs.trim() || undefined })}
        maxLength={80}
        suggestions={RUNS_AS_OPTIONS}
        hint={t("A published spell whose area, summons, reaction or transformation the engines lay for this one under its own name (a renamed Web still webs the board). A copy starts with the spell it was copied from.")}
      />

      <div className="space-y-1">
        <SectionHead title={t("Classes that can learn it")} glyph="tab-characters" className="mb-1" />
        <ToggleChips
          options={[...CLASS_IDS, ...ownClasses.map((klass) => klass.id)]}
          selected={tagged}
          onChange={(classes) => set({ classes })}
          labels={Object.fromEntries([
            ...CLASS_IDS.map((id) => [id, id.charAt(0).toUpperCase() + id.slice(1)]),
            ...ownClasses.map((klass) => [klass.id, klass.name]),
          ])}
        />
        {ownClasses.length ? (
          <p className="text-[11px] text-stone-500">{t("Ticking one of your own classes puts the spell on its list, whichever list that class casts from.")}</p>
        ) : null}
      </div>

      <TextField
        label={t("At higher levels")}
        value={String(data.higher_level ?? "")}
        onChange={(higher_level) => set({ higher_level })}
        placeholder="The damage increases by 1d6 for each slot level above 1st."
        maxLength={2000}
        hint={t("The engine scales the dice from this sentence when a spell is upcast.")}
      />

      <div className="panel space-y-1 rounded-lg px-3 py-2 text-xs text-stone-400">
        <p>
          <span className="font-display tracking-wide text-amber-200/70">{t("What the table resolves: ")}</span>{" "}
          {preview.line}.
          {preview.line.startsWith("no dice") ? ` ${t("Write it as \"takes 3d6 fire damage\", or give the block below its dice.")}` : ""}
        </p>
        {preview.conflicts.map((conflict) => (
          <p key={conflict} className="text-amber-300">{conflict}</p>
        ))}
      </div>

      <SpellMechFields data={data} onChange={onChange} />
    </div>
  );
}
