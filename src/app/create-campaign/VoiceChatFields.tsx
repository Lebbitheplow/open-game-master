"use client";

import { Select } from "@/components/ui/Select";
import type { GameSettings } from "@/lib/schemas/game-settings";
import { FieldLabel, ToggleCard } from "@/app/create-campaign/fields";
import { useT } from "@/lib/locale";

type VoiceSettings = GameSettings["voice"];

// Live voice for a multiplayer table: the master switch, then the turn
// floor and the proximity rules that only mean something once it is on.
// A solo table never mounts this block; there is nobody to talk to.
export function VoiceChatFields({
  value,
  onChange,
}: {
  value: VoiceSettings;
  onChange: (next: VoiceSettings) => void;
}) {
  const t = useT();
  const setRule = (rules: Partial<VoiceSettings["rules"]>) =>
    onChange({ ...value, rules: { ...value.rules, ...rules } });
  return (
    <div>
      <FieldLabel className="mb-1.5">{t("Voice chat", { context: "creator.voiceChat.label" })}</FieldLabel>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <ToggleCard
          active={value.enabled}
          onClick={() => onChange({ ...value, enabled: !value.enabled })}
          label={t("Voice chat", { context: "creator.voiceChat.label" })}
          hint={t("Talk live in the lobby and at the table")}
        />
        {value.enabled ? (
          <>
            <label className="block">
              <span className="mb-1 block text-xs text-stone-500">{t("Turn floor")}</span>
              <Select<VoiceSettings["turnEnforcement"]>
                value={value.turnEnforcement}
                onChange={(turnEnforcement) => onChange({ ...value, turnEnforcement })}
                label={t("Turn floor")}
                className="w-full"
                options={[
                  { value: "off", label: t("Turns: ignored") },
                  { value: "soft", label: t("Turns: shown") },
                  { value: "strict", label: t("Turns: enforced") },
                ]}
              />
            </label>
            <ToggleCard
              active={value.rules.proximity}
              onClick={() => setRule({ proximity: !value.rules.proximity })}
              label={t("Proximity")}
              hint={t("The battle map decides who hears whom")}
            />
            {value.rules.proximity ? (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs text-stone-500">{t("Hearing range")}</span>
                  <Select<string>
                    value={String(value.rules.hearingRangeFeet)}
                    onChange={(feet) => setRule({ hearingRangeFeet: Number(feet) })}
                    label={t("Hearing range")}
                    className="w-full"
                    options={[15, 30, 60, 120].map((feet) => ({ value: String(feet), label: t("{feet} ft", { feet }) }))}
                  />
                </label>
                <ToggleCard
                  active={value.rules.sayRange}
                  onClick={() => setRule({ sayRange: !value.rules.sayRange })}
                  label={t("Whisper and shout")}
                  hint={t("Speakers pick how far their words carry")}
                />
                <ToggleCard
                  active={value.rules.wallsAttenuate}
                  onClick={() => setRule({ wallsAttenuate: !value.rules.wallsAttenuate })}
                  label={t("Walls muffle")}
                  hint={t("A wall muffles a voice instead of cutting it")}
                />
              </>
            ) : null}
            <ToggleCard
              active={value.rules.downedGoDeaf}
              onClick={() => setRule({ downedGoDeaf: !value.rules.downedGoDeaf })}
              label={t("Downed go deaf")}
              hint={t("At 0 hit points a character stops hearing the table")}
            />
          </>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-stone-500">{t("The server has its own switch for live audio too; if the owner keeps it off, these settings wait until it is on. Transcription is turned on from the lobby's Game settings, where everyone at the table is told it is on.")}</p>
    </div>
  );
}
