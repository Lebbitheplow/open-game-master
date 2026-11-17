"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { InfoDialog } from "@/components/ui/InfoDialog";
import { glossaryTerm } from "@/lib/help";
import { useLocale } from "@/lib/locale";

// An inline rules word a new player can tap: "Armor Class", "Saving throws",
// "Concentration". Renders as the label with a dotted underline, so the page
// stays readable and the help is there when it is wanted.
//
// The label follows the reader's language: in French the glossary's official
// name wins (WotC's own French SRD 5.1 wording), over both the glossary's
// English term and the caller's inline children, which are English by
// convention. The tapped explanation follows too: the glossary's own French
// bodies when it has them, the English ones otherwise.
//
// An unknown id renders as plain text rather than throwing, so a typo
// degrades to the label it was already showing. scripts/test-help-coverage.mjs
// checks the ids this app actually uses exist.
export function GameTerm({
  id,
  children,
  className,
}: {
  id: string;
  // Defaults to the glossary's own name for the term.
  children?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const locale = useLocale();
  const entry = glossaryTerm(id);
  if (!entry) {
    return <>{children}</>;
  }
  const label = locale === "fr" && entry.fr ? entry.fr : (children ?? entry.term);
  const french = locale === "fr";
  const body = [
    french && entry.shortFr ? entry.shortFr : entry.short,
    french && entry.longFr ? entry.longFr : entry.long,
  ]
    .filter(Boolean)
    .join("\n\n");
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "cursor-help underline decoration-stone-600 decoration-dotted underline-offset-2 transition-colors hover:text-amber-200 hover:decoration-amber-500/60",
          className,
        )}
      >
        {label}
      </button>
      <InfoDialog open={open} onOpenChange={setOpen} title={typeof label === "string" ? label : entry.term} text={body} />
    </>
  );
}
