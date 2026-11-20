"use client";

import { SectionHead } from "@/components/ui/SectionHead";
import { CONDITIONS } from "@/lib/bestiary/kit";
import { CREATURE_TYPES } from "@/lib/bestiary/creature-type";
import { CheckField, NumberField, SelectField, TextField, ToggleChips } from "@/app/workshop/homebrew/fields";
import { DAMAGE_TYPES } from "@/app/workshop/homebrew/types";
import { CONDITION_BLURBS, glossaryFor } from "@/lib/help/terms";
import { AdvancedBlock, AuraGroup, BuffGroup, HealGroup, PoolGroup, RidersGroup } from "@/app/workshop/homebrew/SpellMechMore";
import { ABILITY_OPTIONS, MechGroup, clean, list, num, sub, type Mech, type MechProps } from "@/app/workshop/homebrew/MechGroup";
import { useT, useTp } from "@/lib/locale";

// The engine's whole block for a spell (src/lib/srd/spell-mech-types.ts), as
// groups a DM opens when the spell needs them: who it reaches, what it rolls,
// the condition it lays, what a failed save does besides, a buff, healing,
// an aura, a hit point pool. A copy of a published spell arrives with its
// block filled from the book (catalog-mechanics.ts), so the groups it uses
// open themselves; anything the form has no field for is still kept, and
// the advanced box at the bottom edits the block as text.

const RESOLUTIONS = [
  { value: "", label: "Let the engine read the prose" },
  { value: "attack", label: "Spell attack roll" },
  { value: "save", label: "Target saves" },
  { value: "auto", label: "Hits without a roll" },
  { value: "heal", label: "Restores hit points" },
  { value: "buff", label: "Grants a condition to allies" },
  { value: "summon", label: "Conjures creatures" },
  { value: "utility", label: "Utility, narrated" },
] as const;

const TYPE_OPTIONS = [{ value: "", label: "from the prose" }, ...DAMAGE_TYPES.map((value) => ({ value, label: value }))];
const CREATURE_WORDS = CREATURE_TYPES.map((type) => type as string);

function ReachGroup({ mech, setMech }: MechProps) {
  const t = useT();
  const tp = useTp();
  const targets = sub(mech.targets);
  const has = Boolean(mech.attack || mech.targets || mech.area || mech.areaFeet || mech.repeat || mech.targetTypes || mech.immuneTypes || mech.immuneIfImmuneTo);
  const summary = [
    mech.attack ? t("{attack} spell attack", { attack: String(mech.attack) }) : "",
    mech.area ? t("area {feet}", { feet: num(mech.areaFeet) ? `${num(mech.areaFeet)} ft` : "" }) : "",
    targets.count ? tp("{count} target", "{count} targets", { count: num(targets.count) as number }) : "",
    mech.repeat ? t("again as {repeat}", { repeat: String(mech.repeat) }) : "",
  ].filter(Boolean).join(", ");
  return (
    <MechGroup title={t("Who it reaches")} summary={summary || t("one creature")} open={has}>
      {mech.resolution === "attack" ? (
        <SelectField label={t("Attack")} value={String(mech.attack ?? "")} options={[{ value: "", label: t("ranged") }, { value: "melee", label: t("melee (touch)") }, { value: "ranged", label: t("ranged") }]} onChange={(attack) => setMech({ attack: attack || undefined })} />
      ) : null}
      <NumberField label={t("Targets")} value={targets.count === undefined ? "" : num(targets.count)} min={1} max={100} onChange={(count) => setMech({ targets: count === "" ? undefined : clean({ ...targets, count }) })} hint={t("Empty is one, or all in an area.")} />
      <NumberField label={t("More per slot level")} value={targets.perSlotLevel === undefined ? "" : num(targets.perSlotLevel)} min={0} max={10} onChange={(perSlotLevel) => setMech({ targets: targets.count === undefined ? undefined : clean({ ...targets, perSlotLevel: perSlotLevel === "" ? undefined : perSlotLevel }) })} />
      <div className="flex items-end pb-1">
        <CheckField label={t("Fills an area")} checked={mech.area === true} onChange={(area) => setMech({ area: area || undefined })} />
      </div>
      <NumberField label={t("Area size (feet)")} value={mech.areaFeet === undefined ? "" : num(mech.areaFeet)} min={0} max={5280} step={5} onChange={(areaFeet) => setMech({ areaFeet: areaFeet === "" ? undefined : areaFeet })} hint={t("Radius, cube side, or cone/line length.")} />
      <SelectField
        label={t("Again while concentrating")}
        value={String(mech.repeat ?? "")}
        options={[{ value: "", label: t("no", { context: "workshop.homebrew.hazard.no" }) }, { value: "action", label: t("as an action") }, { value: "bonus", label: t("as a bonus action") }, { value: "free", label: t("on its own") }]}
        onChange={(repeat) => setMech({ repeat: repeat || undefined })}
      />
      <TextField label={t("Immune if immune to")} value={String(mech.immuneIfImmuneTo ?? "")} onChange={(value) => setMech({ immuneIfImmuneTo: value || undefined })} suggestions={CONDITIONS} maxLength={40} />
      <div className="col-span-2 sm:col-span-4">
        <span className="text-[11px] text-stone-400">{t("Only works on")}</span>
        <ToggleChips options={CREATURE_WORDS} selected={list(mech.targetTypes)} onChange={(next) => setMech({ targetTypes: next.length ? next : undefined })} />
      </div>
      <div className="col-span-2 sm:col-span-4">
        <span className="text-[11px] text-stone-400">{t("No effect on")}</span>
        <ToggleChips options={CREATURE_WORDS} selected={list(mech.immuneTypes)} onChange={(next) => setMech({ immuneTypes: next.length ? next : undefined })} />
      </div>
    </MechGroup>
  );
}

function DamageGroup({ mech, setMech }: MechProps) {
  const t = useT();
  const dice = sub(mech.dice);
  const darts = sub(mech.darts);
  const attacks = sub(mech.attacks);
  const has = Boolean(mech.damageType || mech.secondType || mech.dice || mech.darts || mech.attacks || mech.noDamage);
  const summary = mech.noDamage
    ? t("no damage")
    : [dice.base ? `${String(dice.base)}${dice.perSlotLevel ? ` +${String(dice.perSlotLevel)}/slot` : ""}` : t("dice from the prose"), String(mech.damageType ?? ""), mech.secondType ? t("and {type}", { type: String(mech.secondType) }) : ""].filter(Boolean).join(" ");
  return (
    <MechGroup title={t("What it rolls")} summary={summary} open={has}>
      <SelectField label={t("Damage type")} value={String(mech.damageType ?? "")} options={TYPE_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))} onChange={(damageType) => setMech({ damageType: damageType || undefined })} />
      <SelectField label={t("Second type")} value={String(mech.secondType ?? "")} options={[{ value: "", label: t("none", { context: "workshop.homebrew.hazard.none" }) }, ...DAMAGE_TYPES.map((value) => ({ value, label: value }))]} onChange={(secondType) => setMech({ secondType: secondType || undefined })} />
      <div className="col-span-2 flex items-end pb-1">
        <CheckField label={t("Deals no damage, whatever dice the text mentions")} checked={mech.noDamage === true} onChange={(noDamage) => setMech({ noDamage: noDamage || undefined })} />
      </div>
      <TextField label={t("Dice")} value={String(dice.base ?? "")} onChange={(base) => setMech({ dice: base ? clean({ ...dice, base, baseLevel: num(dice.baseLevel, num(mech.level, 1)) }) : undefined })} placeholder="8d6" maxLength={40} hint={t("Leave empty to read them from the description.")} />
      <TextField label={t("Per slot level above")} value={String(dice.perSlotLevel ?? "")} onChange={(perSlotLevel) => setMech({ dice: dice.base ? clean({ ...dice, perSlotLevel: perSlotLevel || undefined }) : undefined })} placeholder="1d6" maxLength={40} />
      <NumberField label={t("Darts")} value={darts.count === undefined ? "" : num(darts.count)} min={1} max={20} onChange={(count) => setMech({ darts: count === "" ? undefined : clean({ perSlotLevel: 1, each: "1d4+1", ...darts, count }) })} hint={t("Magic Missile: hits without a roll.")} />
      {darts.count !== undefined ? (
        <TextField label={t("Each dart")} value={String(darts.each ?? "")} onChange={(each) => setMech({ darts: clean({ ...darts, each }) })} maxLength={40} />
      ) : null}
      <NumberField label={t("Attack rolls")} value={attacks.count === undefined ? "" : num(attacks.count)} min={1} max={10} onChange={(count) => setMech({ attacks: count === "" ? undefined : clean({ ...attacks, count }) })} hint={t("Scorching Ray's rays, Eldritch Blast's beams.")} />
      {attacks.count !== undefined ? (
        <div className="flex items-end pb-1">
          <CheckField label={t("Grows with the caster's level")} checked={attacks.byCasterLevel === true} onChange={(byCasterLevel) => setMech({ attacks: clean({ ...attacks, byCasterLevel: byCasterLevel || undefined }) })} />
        </div>
      ) : null}
    </MechGroup>
  );
}

function ConditionGroup({ mech, setMech }: MechProps) {
  const t = useT();
  const tp = useTp();
  const condition = sub(mech.condition);
  const set = (patch: Mech) => setMech({ condition: condition.name || patch.name ? clean({ ...condition, ...patch }) : undefined });
  const escape = list(condition.escape);
  const summary = condition.name
    ? [String(condition.name), condition.rounds ? tp("{count} round", "{count} rounds", { count: num(condition.rounds) as number }) : "", condition.saveEnds ? t("save ends") : "", escape.length ? t("escape {list}", { list: escape.join("/").toUpperCase() }) : ""].filter(Boolean).join(", ")
    : t("none", { context: "workshop.homebrew.hazard.none" });
  return (
    <MechGroup title={t("The condition it lays")} summary={summary} open={Boolean(condition.name)}>
      <TextField label={t("Condition")} value={String(condition.name ?? "")} onChange={(name) => set({ name: name || undefined })} suggestions={CONDITIONS} maxLength={40} glossary={{ title: t("Conditions"), entries: glossaryFor(CONDITIONS, CONDITION_BLURBS) }} />
      <NumberField label={t("Rounds")} value={condition.rounds === undefined ? "" : num(condition.rounds)} min={1} max={144000} onChange={(rounds) => set({ rounds: rounds === "" ? undefined : rounds })} hint={t("10 is a minute.")} />
      <div className="col-span-2 flex flex-wrap items-end gap-3 pb-1">
        <CheckField label={t("Save again each turn")} checked={condition.saveEnds === true} onChange={(saveEnds) => set({ saveEnds: saveEnds || undefined })} />
        <CheckField label={t("Ends on damage")} checked={condition.endsOnDamage === true} onChange={(endsOnDamage) => set({ endsOnDamage: endsOnDamage || undefined })} />
        <CheckField label={t("No save at first")} checked={condition.noInitialSave === true} onChange={(noInitialSave) => set({ noInitialSave: noInitialSave || undefined })} />
      </div>
      <SelectField label={t("Save on damage")} value={String(condition.saveOnDamage ?? "")} options={[{ value: "", label: t("no", { context: "workshop.homebrew.hazard.no" }) }, { value: "normal", label: t("yes") }, { value: "advantage", label: t("with advantage") }]} onChange={(saveOnDamage) => set({ saveOnDamage: saveOnDamage || undefined })} />
      <SelectField label={t("Lasts until")} value={String(condition.endsWith ?? "")} options={[{ value: "", label: t("its rounds run out") }, { value: "target turn end", label: t("the end of its next turn") }, { value: "caster turn start", label: t("the caster's next turn") }]} onChange={(endsWith) => set({ endsWith: endsWith || undefined })} />
      <NumberField label={t("Only at this many HP or fewer")} value={condition.hpAtMost === undefined ? "" : num(condition.hpAtMost)} min={1} max={1000} onChange={(hpAtMost) => set({ hpAtMost: hpAtMost === "" ? undefined : hpAtMost })} hint={t("Power Word Stun: no save.")} />
      <NumberField label={t("Escape DC")} value={condition.escapeDc === undefined ? "" : num(condition.escapeDc)} min={1} max={30} onChange={(escapeDc) => set({ escapeDc: escapeDc === "" ? undefined : escapeDc })} hint={t("Empty is the caster's DC.")} />
      <div className="col-span-2">
        <span className="text-[11px] text-stone-400">{t("Breaks free with an action and a check of")}</span>
        <ToggleChips options={["str", "dex", "int"] as const} selected={escape} onChange={(next) => set({ escape: next.length ? next : undefined })} labels={{ str: "STR", dex: "DEX", int: "INT" }} />
      </div>
      <div className="col-span-2">
        <span className="text-[11px] text-stone-400">{t("Comes with")}</span>
        <ToggleChips options={CONDITIONS} selected={list(condition.also)} onChange={(next) => set({ also: next.length ? next : undefined })} />
      </div>
    </MechGroup>
  );
}

export function SpellMechFields({ data, onChange }: { data: Mech; onChange: (next: Mech) => void }) {
  const t = useT();
  const mech = sub(data.mech);
  const setMech = (patch: Mech) => {
    const next = { ...mech, ...patch };
    for (const key of Object.keys(next)) {
      if (next[key] === undefined) delete next[key];
    }
    onChange({ ...data, mech: next.resolution ? next : undefined });
  };
  const resolution = String(mech.resolution ?? "");
  const props = { mech: { ...mech, level: data.level }, setMech };
  return (
    <div className="panel space-y-2 rounded-xl p-3">
      <SectionHead title={t("What the engine does with it")} glyph="cue-arcane" className="mb-1" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SelectField label={t("How it resolves")} value={resolution} options={RESOLUTIONS.map((option) => ({ ...option, label: t(option.label) }))} onChange={(next) => setMech({ resolution: next || undefined })} hint={t("Set this and the cast tools trust it over the prose.")} className="col-span-2" />
        {resolution === "save" ? (
          <>
            <SelectField label={t("Save", { context: "workshop.bestiary.attack.save" })} value={String(mech.save ?? "")} options={ABILITY_OPTIONS} onChange={(save) => setMech({ save: save || undefined })} />
            <div className="flex items-end pb-1">
              <CheckField label={t("Half on a success")} checked={mech.halfOnSave === true} onChange={(halfOnSave) => setMech({ halfOnSave: halfOnSave || undefined })} />
            </div>
          </>
        ) : null}
      </div>
      {resolution ? (
        <div className="reveal space-y-2">
          <ReachGroup {...props} />
          {["attack", "save", "auto"].includes(resolution) ? <DamageGroup {...props} /> : null}
          {["attack", "save", "auto", "utility"].includes(resolution) ? <ConditionGroup {...props} /> : null}
          {resolution === "save" ? <RidersGroup {...props} /> : null}
          {resolution === "buff" ? <BuffGroup {...props} /> : null}
          {["heal", "utility", "buff"].includes(resolution) ? <HealGroup {...props} /> : null}
          {["save", "utility", "buff"].includes(resolution) ? <AuraGroup {...props} /> : null}
          {["save", "utility"].includes(resolution) ? <PoolGroup {...props} /> : null}
          <TextField label={t("Note for the GM")} value={String(mech.note ?? "")} onChange={(note) => setMech({ note: note || undefined })} placeholder="Up to three targets." maxLength={400} />
          <AdvancedBlock mech={mech} onChange={(next) => onChange({ ...data, mech: next })} />
        </div>
      ) : null}
    </div>
  );
}
