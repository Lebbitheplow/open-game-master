"use client";

import { cn } from "@/lib/cn";
import { useT, useTp } from "@/lib/locale";
import { formatCount } from "@/lib/text-limits";

// A text box's limit, said before anything is sent (issue 207): the count
// against the limit, and once a draft runs over, by how much and that it
// will not send. The draft is never cut short; the writer shortens it.
//
// `from` keeps the count out of sight until the draft is that share of the
// limit, so the composer's desk stays quiet until it matters; the limit is
// still read to a screen reader through the box's aria-describedby. `idle`
// is what an empty box says instead of "0 / 2,000".
export function LengthNote({
  id,
  length,
  max,
  from = 0,
  idle,
  className,
}: {
  id: string;
  length: number;
  max: number;
  from?: number;
  idle?: string;
  className?: string;
}) {
  const t = useT();
  const tp = useTp();
  const over = length - max;
  if (over <= 0 && length < max * from) {
    return (
      <span id={id} className="sr-only">
        {t("Up to {max} characters.", { max: formatCount(max) })}
      </span>
    );
  }
  return (
    <p
      id={id}
      data-over={over > 0 ? "" : undefined}
      className={cn(
        "reveal flex flex-wrap items-baseline justify-end gap-x-2 text-[11px] leading-4 text-stone-500 transition-colors duration-150 data-[over]:text-red-400",
        className,
      )}
    >
      {length === 0 && idle ? (
        <span>{idle}</span>
      ) : (
        <span className="tabular-nums">
          {formatCount(length)} / {formatCount(max)}
        </span>
      )}
      <span aria-live="polite">
        {over > 0 ? (
          <span key="over" className="live-in font-medium">
            {tp("{over} over the limit: shorten it to send.", "{over} over the limit: shorten it to send.", { count: over, over: formatCount(over) })}
          </span>
        ) : null}
      </span>
    </p>
  );
}
