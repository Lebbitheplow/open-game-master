"use client";

import { PageSection } from "@/components/PageShell";
import { AppearancePicker } from "@/components/AppearancePicker";
import { Slider } from "@/components/ui/Slider";
import { ui } from "@/lib/ui";
import { UI_SCALE_MAX, UI_SCALE_MIN, useThemePrefs, writeUiScale } from "@/lib/theme-mode";

export function AppearanceSection() {
  const { scale } = useThemePrefs();
  return (
    <PageSection
      heading="Appearance"
      glyph="sense-darkvision"
      intro="Kept on this device. The board and its canvases draw at their own size whatever the scale."
    >
      <AppearancePicker />
      <div className="mt-4 text-xs text-stone-400">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span>Interface scale</span>
          <span className="flex items-center gap-2">
            <span className="tabular-nums text-stone-300">{Math.round(scale * 100)}%</span>
            {scale !== 1 ? (
              <button type="button" onClick={() => writeUiScale(1)} className={`${ui.btnSmall} reveal-pop px-2 py-1 text-[11px]`}>
                Reset
              </button>
            ) : null}
          </span>
        </div>
        <Slider
          label="Interface scale"
          min={UI_SCALE_MIN}
          max={UI_SCALE_MAX}
          step={0.05}
          value={scale}
          onChange={writeUiScale}
          bubble={(value) => `${Math.round(value * 100)}%`}
        />
      </div>
    </PageSection>
  );
}
