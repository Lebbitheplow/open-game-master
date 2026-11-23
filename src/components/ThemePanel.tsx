"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { AppearancePicker } from "@/components/AppearancePicker";
import { returnFocus } from "@/components/ui/return-focus";
import { useT } from "@/lib/locale";
import { setThemePanelOpen, useThemePanel } from "@/lib/theme-mode";

// The theme picker as a panel beside the page, not a dialog over it: a pick
// restyles the page at once, and a centred dialog on a dimmed, blurred page
// hid the very thing it changed, so comparing two themes meant closing and
// reopening it. It is not modal: the page behind stays in view and scrolls,
// and only Escape or its own close button dismisses it. Mounted once in the
// root layout; the account menu and the lobby open it.
export function ThemePanel() {
  const t = useT();
  const { open } = useThemePanel();
  return (
    <RadixDialog.Root open={open} onOpenChange={setThemePanelOpen} modal={false}>
      <RadixDialog.Portal>
        <RadixDialog.Content
          {...returnFocus}
          className="theme-panel texture-noise"
          aria-describedby={undefined}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <div className="theme-panel-head">
            <RadixDialog.Title className="font-display text-lg tracking-wide text-amber-100">
              <span className="gold-title">{t("Theme")}</span>
            </RadixDialog.Title>
            <RadixDialog.Close
              aria-label={t("Close", { context: "action.close" })}
              className="pk-tap -m-1 flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-md p-2 text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-200"
            >
              <X className="size-4" />
            </RadixDialog.Close>
          </div>
          <AppearancePicker layout="panel" />
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
