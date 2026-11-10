import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// The small caps label that heads a section: "Only you" in gold, "Lead only"
// in ember. A hairline runs out to the right, so it reads as a rule across
// the panel. It is lettering alone: boxed and lit it was a pill, and a
// screen of headed sections was a screen of pills.
//
//   <Ribbon tone="ember">Lead only</Ribbon>
export function Ribbon({
  tone = "gold",
  children,
  className,
}: {
  tone?: "gold" | "ember";
  children: ReactNode;
  className?: string;
}) {
  const ember = tone === "ember";
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "eyebrow inline-flex items-center text-[11px] leading-none",
          ember ? "text-ember-300" : "text-amber-300",
        )}
      >
        {children}
      </span>
      <span
        className={cn(
          "h-px flex-1 bg-gradient-to-r to-transparent",
          ember ? "from-ember-500/40" : "from-amber-400/30",
        )}
        aria-hidden="true"
      />
    </div>
  );
}
