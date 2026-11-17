"use client";

import { PageSection } from "@/components/PageShell";
import { DictationShortcutField } from "@/components/DictationShortcutField";
import { useT } from "@/lib/locale";

// The hold-to-dictate key (issue 291), on this device like Appearance: the
// apps also offer it under Audio and dice in their own Settings.
export function DictationShortcutSection() {
  const t = useT();
  return (
    <PageSection
      heading={t("Dictation key")}
      glyph="ui-voice"
      intro={t("Kept on this device. A key you hold to speak into the table's message box instead of holding the mic. Nothing is sent until you press Send.")}
    >
      <DictationShortcutField />
    </PageSection>
  );
}
