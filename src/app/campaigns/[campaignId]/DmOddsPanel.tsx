"use client";

import { useMemo, useState } from "react";
import { ui } from "@/lib/ui";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Select } from "@/components/ui/Select";
import { DeskCard, FieldLabel } from "@/app/campaigns/[campaignId]/DmConsoleParts";
import { asPercent, forecastAttack, roundsToDrop } from "@/lib/srd/odds";
import { useT } from "@/lib/locale";

// The consequence preview: hit chance, expected damage, and how long a target
// lasts. Pure arithmetic from src/lib/srd/odds.ts, so it is instant, always
// available, and needs nothing from the server.

// The only two table rules that change what a crit is worth. Named here so
// the same shape threads down from the panel without dragging the whole
// GameSettings type through three components.
export type CritRules = { powerfulCritical: boolean; criticalDamageMods: boolean; supplies?: boolean };

type Roll = "none" | "advantage" | "disadvantage";
// The rolls' words by value; the keys live with the odds group.
const ROLL_KEYS = {
  none: "Straight",
  advantage: "Advantage",
  disadvantage: "Disadvantage",
} as const;

// Hit chance, expected damage, and how long a target lasts. Pure arithmetic
// from src/lib/srd/odds.ts, so it is instant and always available.
export function OddsCalculator({
  variantRules,
}: {
  // The table's optional crit rules. The forecast runs them through the
  // engine's own critDamageExpression, so what it predicts is what the
  // server would actually roll.
  variantRules: CritRules;
}) {
  const t = useT();
  const [attackBonus, setAttackBonus] = useState(5);
  const [ac, setAc] = useState(15);
  const [damage, setDamage] = useState("1d8+3");
  const [advantage, setAdvantage] = useState<Roll>("none");
  const [hitPoints, setHitPoints] = useState(30);
  const [attacksPerRound, setAttacksPerRound] = useState(1);
  const [extraCritDice, setExtraCritDice] = useState(0);

  const forecast = useMemo(
    () =>
      forecastAttack({
        attackBonus,
        ac,
        damage,
        advantage,
        extraCritDice,
        variantRules: {
          powerfulCritical: variantRules.powerfulCritical,
          multiplyNumeric: variantRules.criticalDamageMods,
        },
      }),
    [attackBonus, ac, damage, advantage, extraCritDice, variantRules],
  );
  const perRound = forecast.perAttack * Math.max(1, attacksPerRound);
  const rounds = roundsToDrop(hitPoints, perRound);

  return (
    <DeskCard glyph="tab-dice" title={t("What is this likely to do?")}>
      {/* Divs, not labels: a label would press the stepper's minus button
          whenever its caption was tapped. Each control carries its name. */}
      <div className="grid grid-cols-1 gap-x-2 gap-y-2.5 min-[24rem]:grid-cols-2">
        <div>
          <FieldLabel>{t("Attack bonus")}</FieldLabel>
          <NumberStepper value={attackBonus} onChange={setAttackBonus} label={t("Attack bonus")} size="sm" />
        </div>
        <div>
          <FieldLabel>{t("Target AC")}</FieldLabel>
          <NumberStepper value={ac} onChange={setAc} label={t("Target AC")} size="sm" />
        </div>
        <div>
          <FieldLabel>{t("Damage", { context: "dm.odds.damage" })}</FieldLabel>
          <input
            value={damage}
            onChange={(event) => setDamage(event.target.value)}
            placeholder="2d6+4"
            aria-label={t("Damage", { context: "dm.odds.damage" })}
            className={ui.input}
          />
        </div>
        <div>
          <FieldLabel>{t("Roll", { context: "dm.odds.roll" })}</FieldLabel>
          <Select value={advantage} onChange={setAdvantage} options={(Object.keys(ROLL_KEYS) as Roll[]).map((roll) => ({ value: roll, label: t(ROLL_KEYS[roll]) }))} label={t("Roll", { context: "dm.odds.roll" })} />
        </div>
        <div>
          <FieldLabel>{t("Target hit points")}</FieldLabel>
          <NumberStepper value={hitPoints} onChange={setHitPoints} label={t("Target hit points")} size="sm" />
        </div>
        <div>
          <FieldLabel>{t("Attacks per round")}</FieldLabel>
          <NumberStepper value={attacksPerRound} onChange={setAttacksPerRound} min={1} label={t("Attacks per round")} size="sm" />
        </div>
        <div title={t("Brutal Critical, Savage Attacks.")}>
          <FieldLabel>{t("Extra dice on a crit")}</FieldLabel>
          <NumberStepper value={extraCritDice} onChange={setExtraCritDice} min={0} max={4} label={t("Extra dice on a crit")} size="sm" />
        </div>
      </div>
      {forecast.exact ? null : (
        <p className="mt-2 text-xs text-amber-300/90">
          {t("That damage expression cannot be averaged, so only the odds below are real. The chance to hit never depended on it.")}
        </p>
      )}
      <dl className="mt-3 rounded-lg border border-amber-500/20 bg-stone-950/50 px-2.5 py-1.5 text-xs">
        <div className="dm-readout flex justify-between gap-3 py-0.5">
          <dt className="text-stone-400">{t("Chance to hit")}</dt>
          <dd className="text-right font-medium text-amber-100">
            {asPercent(forecast.odds.hit)}
            <span className="text-stone-500"> {t("({pct} crit)", { pct: asPercent(forecast.odds.crit) })}</span>
          </dd>
        </div>
        <div className="dm-readout flex justify-between gap-3 py-0.5">
          <dt className="text-stone-400">{t("Damage on a hit")}</dt>
          <dd className="text-right font-medium text-amber-100">
            {forecast.exact ? (
              <>
                {forecast.onHit.toFixed(1)}
                <span className="text-stone-500"> {t("({value} on a crit)", { value: forecast.onCrit.toFixed(1) })}</span>
              </>
            ) : (
              t("unknown")
            )}
          </dd>
        </div>
        <div className="dm-readout flex justify-between gap-3 py-0.5">
          <dt className="text-stone-400">{t("Average per round")}</dt>
          <dd className="text-right font-medium text-amber-100">{forecast.exact ? perRound.toFixed(1) : t("unknown")}</dd>
        </div>
        <div className="dm-readout flex justify-between gap-3 py-0.5">
          <dt className="text-stone-400">{t("Rounds to drop")}</dt>
          <dd className="text-right font-medium text-amber-100">
            {!forecast.exact ? t("unknown") : rounds === null ? t("never") : rounds}
          </dd>
        </div>
      </dl>
    </DeskCard>
  );
}
