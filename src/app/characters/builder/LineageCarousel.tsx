"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Star } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { InfoButton, renderRules, type ContentRef } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import { textKey } from "@/lib/language/text-logic";
import { useLocale, useT } from "@/lib/locale";
import { speciesTraitName } from "@/lib/content/names";
import { ui } from "@/lib/ui";
import { lineageFits } from "./lineageFits";
import { AbilityText } from "./AbilityText";
import {
  asiChips,
  lineageChoices,
  parseTrait,
  slidePosition,
  srdRaceFor,
  swipeStep,
  traitLines,
  wrapIndex,
  type LineageEntry,
} from "./lineage";

// Everything the carousel shows for one lineage. `info` is exactly what the
// old picker's info button carried (the pack's blurb, else the bundled trait
// text, else the summary; plus the content-pack reference), so nothing that
// could be read before can no longer be read.
export type LineageSlide = LineageEntry & {
  speed: number;
  languages: string[];
  note: string;
  art: string;
  // Canonical SRD name behind a world pack's reskin.
  canonical?: string;
  // The book the lineage is from ("Tome of Heroes"); a fact in the dialog,
  // and on the card where the grid is not already grouped by book.
  source?: string;
  sourceOnCard?: string;
  packBlurb?: string;
  group: string | null;
  recommended: boolean;
  info: { text?: string | null; reference?: ContentRef };
};

const sectionLabel = "mb-1.5 block font-display text-[0.875rem] font-semibold uppercase tracking-[0.14em] text-amber-500/80";

function Traits({ slide }: { slide: LineageSlide }) {
  const baseId = useId();
  const locale = useLocale();
  const t = useT();
  const lines = traitLines(slide);
  // The first trait with something to say arrives open, so the panel never
  // opens onto a wall of closed rows.
  const [openTrait, setOpenTrait] = useState<number | null>(() => {
    const first = lines.findIndex((line) => parseTrait(line, slide, t).body);
    return first === -1 ? null : first;
  });
  if (!lines.length) {
    return slide.info.text ? (
      <div className="space-y-2 font-serif text-base leading-normal text-stone-300">{renderRules(slide.info.text)}</div>
    ) : null;
  }
  return (
    <div className="flex flex-col gap-[5px]">
      {lines.map((line, index) => {
        const parsed = parseTrait(line, slide, t);
        // The trait's name reads in the reader's language where the official
        // maps carry it; the shorthand around it ("adv. vs poison", "60 ft")
        // is the app's own and stays as it was written.
        const head = speciesTraitName(slide.id, parsed.head, locale);
        const open = openTrait === index && Boolean(parsed.body);
        const bodyId = `${baseId}-trait-${index}`;
        const headEl = (
          <span className="flex w-full items-center gap-2.5 px-3 py-2">
            <span
              className="flex size-[1.5rem] shrink-0 items-center justify-center rounded-full border border-amber-500/40 bg-amber-950/50 font-mono text-[0.875rem] text-amber-300"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 font-display text-base font-semibold text-amber-200">{head}</span>
            {parsed.body ? <ChevronDown className="creator-chevron size-3.5 shrink-0 text-stone-500" aria-hidden="true" /> : null}
          </span>
        );
        // A trait with text has a toggle holding its name only, and its body
        // in a region below; one with nothing more to say is a plain row.
        return (
          <div
            key={`${index}-${line}`}
            className="creator-trait creator-trait-rise"
            data-open={open || undefined}
            style={{ "--i": Math.min(index, 8) } as CSSProperties}
          >
            {parsed.body ? (
              <button
                type="button"
                onClick={() => setOpenTrait(open ? null : index)}
                aria-expanded={open}
                aria-controls={bodyId}
                className="creator-trait-toggle"
              >
                {headEl}
              </button>
            ) : (
              headEl
            )}
            {open ? (
              <div id={bodyId} className="creator-trait-body pb-2.5 pl-[42px] pr-3 font-serif text-base leading-normal text-stone-300">
                {parsed.body}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// One lineage's write-up: its plate, bonuses and facts, the classes it suits,
// its tongues, what it leaves to choose and its traits. The carousel shows it
// for the lineage being browsed; the build math panel for the one chosen.
export function LineageDetails({ slide }: { slide: LineageSlide }) {
  const srd = srdRaceFor(slide.id);
  const t = useT();
  const choices = lineageChoices(slide, t);
  const lines = traitLines(slide);
  // A size word reads in the reader's language where the table knows it.
  const sizeWords = (size: string) => {
    const key = ({ small: "Small", medium: "Medium", large: "Large" } as Record<string, string>)[textKey(size)];
    return key ? t(key) : size;
  };
  const facts = [
    { key: t("Speed"), value: `${slide.speed} ft` },
    ...(srd?.size ? [{ key: t("Size"), value: sizeWords(srd.size) }] : []),
    { key: t("Traits"), value: String(lines.length) },
    ...(slide.source ? [{ key: t("Source"), value: slide.source }] : []),
  ];
  const fits = lineageFits(slide);
  return (
    <>
      <div className="flex w-full flex-row gap-3 sm:w-[172px] sm:flex-none sm:flex-col sm:gap-2.5">
        <span className="creator-plate rounded-[10px] border border-amber-500/30 shadow-glow-gold" data-detail="" role="img" aria-label={t("{name} portrait", { name: slide.name })}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={slide.art} alt="" draggable={false} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex flex-wrap gap-1">
            {asiChips(slide.asi).map((chip) => (
              <span key={chip.label} className="creator-chip" data-size="md">
                <AbilityText text={chip.ability} /> <span className="font-display text-[0.875rem] font-bold text-amber-100">{chip.bonus}</span>
              </span>
            ))}
          </div>
          <dl className="flex flex-col gap-[3px]">
            {facts.map((fact) => (
              <div key={fact.key} className="flex items-baseline justify-between gap-2 font-mono text-[0.875rem] text-stone-500">
                <dt>{fact.key}</dt>
                <dd className="text-stone-200">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-2.5">
        {/* The classes this lineage's bonuses suit (lineageFits.ts), so a
            player who picks the people first knows where it leads. */}
        {fits ? (
          <p className="text-xs leading-normal text-stone-300">
            <span className="font-display font-semibold uppercase tracking-[0.12em] text-amber-400/90">{t("Good fits ")}</span>
            {fits.kind === "any"
              ? t("Any class: its bonuses are yours to place.")
              : `${fits.names.join(", ")}.`}
          </p>
        ) : null}
        {slide.packBlurb ? (
          <p className="font-serif text-base italic leading-normal text-stone-300">{slide.packBlurb}</p>
        ) : null}
        <div className="rounded-[10px] border border-stone-700/60 bg-stone-950/60 px-3 py-2.5">
          <span className={sectionLabel}>{t("Tongues")}</span>
          <span className="font-serif text-base leading-normal text-stone-300">{slide.languages.join(", ")}</span>
        </div>
        {choices.length ? (
          <div className="rounded-[10px] border border-amber-500/30 bg-amber-950/20 px-3 py-2.5">
            <span className={sectionLabel}>{t("Leaves you to choose")}</span>
            <div className="flex flex-wrap gap-1">
              {choices.map((choice) => (
                <span key={choice} className="creator-chip" data-size="md">
                  {choice}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        <div>
          <span className={cn(sectionLabel, "flex items-center gap-1.5")}>
            {t("Lineage traits")}
            {/* The full write-up, as the old picker's info button gave it:
                the pack's own entry when one is installed. */}
            <InfoButton label={slide.name} text={slide.info.text} reference={slide.info.reference} />
          </span>
          <Traits slide={slide} />
        </div>
      </div>
    </>
  );
}

// The detail carousel over the lineage grid: walks the same ordered list the
// grid shows, wrapping at both ends, and names the neighbours so browsing is
// not blind. Choose picks the lineage and closes; nothing is chosen by
// looking.
export function LineageCarousel({
  slides,
  index,
  onIndexChange,
  chosenId,
  onChoose,
}: {
  slides: LineageSlide[];
  // Null while closed.
  index: number | null;
  onIndexChange: (index: number | null) => void;
  chosenId: string;
  onChoose: (id: string) => void;
}) {
  // Which way the last step went, so the incoming lineage slides in from
  // that side. Cleared on close: opening the dialog is not a step.
  const t = useT();
  const [dir, setDir] = useState<"next" | "prev" | null>(null);
  // Where a touch began, for a swipe between lineages on a phone.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const slide = index === null ? null : slides[index];
  const total = slides.length;
  const nextArt = index === null || total < 2 ? null : slides[wrapIndex(index, 1, total)].art;
  const prevArt = index === null || total < 3 ? null : slides[wrapIndex(index, -1, total)].art;
  // The plates either side are fetched while this one is read, so a step
  // lands on a painted slide rather than an empty frame.
  useEffect(() => {
    for (const src of [nextArt, prevArt]) {
      if (src) {
        const image = new Image();
        image.decoding = "async";
        image.src = src;
      }
    }
  }, [nextArt, prevArt]);
  if (!slide || index === null) {
    return null;
  }
  const step = (delta: number) => {
    setDir(delta > 0 ? "next" : "prev");
    onIndexChange(wrapIndex(index, delta, slides.length));
  };
  const close = () => {
    setDir(null);
    onIndexChange(null);
  };
  const prev = slides[wrapIndex(index, -1, slides.length)];
  const next = slides[wrapIndex(index, 1, slides.length)];
  const chosen = slide.id === chosenId;
  const navButton = cn(ui.btnSmall, "min-w-0 max-w-[38%] px-2 py-1 text-xs");

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : close())}
      title={
        <span className="flex min-w-0 flex-col">
          <span className="truncate uppercase tracking-[0.14em]">{slide.name}</span>
          {slide.canonical ? (
            <span className="font-mono text-[0.875rem] normal-case tracking-normal text-stone-500">
              {t("{name} in the rules", { name: slide.canonical })}
            </span>
          ) : null}
        </span>
      }
      width="w-[min(96vw,40rem)]"
    >
      <div
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") step(-1);
          if (event.key === "ArrowRight") step(1);
        }}
      >
        <div className="mb-3.5 flex items-center justify-between gap-2">
          <button type="button" onClick={() => step(-1)} className={navButton} aria-label={t("Previous: {name}", { name: prev.name })}>
            <ChevronLeft className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{prev.name}</span>
          </button>
          <span className="flex min-w-0 flex-col items-center gap-0.5 text-center">
            {/* The count is for the eye; a step says which lineage it reached
                ("Tiefling, 3 of 40, recommended") while focus stays on the
                button that paged. */}
            <span className="font-mono text-[0.875rem] text-stone-500" aria-hidden="true">
              {index + 1} / {slides.length}
            </span>
            <span className="sr-only" aria-live="polite" aria-atomic="true">
              {slidePosition(slide, index, slides.length, t)}
            </span>
            {slide.recommended ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-400/10 px-1.5 py-px font-display text-[0.875rem] font-bold uppercase tracking-[0.12em] text-amber-300">
                <Star className="size-2.5 fill-current" aria-hidden="true" />
                {t("Recommended")}
              </span>
            ) : null}
            {slide.group ? <span className="truncate font-mono text-[0.875rem] text-stone-500">{slide.group}</span> : null}
          </span>
          <button type="button" onClick={() => step(1)} className={navButton} aria-label={t("Next: {name}", { name: next.name })}>
            <span className="truncate">{next.name}</span>
            <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
          </button>
        </div>

        {/* Keyed by lineage so the accordion and the entrance start over on
            every step of the carousel. */}
        <div
          key={slide.id}
          className="creator-slide flex flex-wrap items-start gap-3.5"
          data-dir={dir ?? undefined}
          // A sideways swipe pages, as the arrows do; an upward drag still
          // scrolls the traits.
          onTouchStart={(event) => {
            const touch = event.touches[0];
            touchStart.current = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null;
          }}
          onTouchEnd={(event) => {
            const start = touchStart.current;
            const touch = event.changedTouches[0];
            touchStart.current = null;
            if (!start || !touch) {
              return;
            }
            const delta = swipeStep(touch.clientX - start.x, touch.clientY - start.y);
            if (delta) {
              step(delta);
            }
          }}
          onTouchCancel={() => {
            touchStart.current = null;
          }}
        >
          <LineageDetails slide={slide} />
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={close} className={ui.btnSecondary}>
            {t("Close", { context: "builder.lineage.close" })}
          </button>
          <button
            type="button"
            onClick={() => {
              onChoose(slide.id);
              close();
            }}
            className={ui.btnPrimary}
          >
            {chosen ? t("Keep {name}", { name: slide.name }) : t("Choose {name}", { name: slide.name })}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
