import { LANGUAGE_FLAGS } from "@/lib/language/server-language";
import type { TableLanguage } from "@/lib/schemas/game-settings-options";
import { cn } from "@/lib/cn";

// Small flags drawn here rather than emoji: Windows shows a flag emoji as two
// letters, and the apps draw the same screens on every system. Each is the
// flag at 3:2, simplified where a full coat of arms would not read at 20px.
const FLAGS: Record<string, React.ReactNode> = {
  gb: (
    <>
      <rect width="30" height="20" fill="#012169" />
      <path d="M0 0L30 20M30 0L0 20" stroke="#fff" strokeWidth="4" />
      <path d="M0 0L30 20M30 0L0 20" stroke="#C8102E" strokeWidth="1.6" />
      <path d="M15 0V20M0 10H30" stroke="#fff" strokeWidth="6" />
      <path d="M15 0V20M0 10H30" stroke="#C8102E" strokeWidth="3.4" />
    </>
  ),
  dk: (
    <>
      <rect width="30" height="20" fill="#C8102E" />
      <path d="M11 0V20M0 10H30" stroke="#fff" strokeWidth="3" />
    </>
  ),
  fi: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <path d="M11 0V20M0 10H30" stroke="#002F6C" strokeWidth="4.5" />
    </>
  ),
  no: (
    <>
      <rect width="30" height="20" fill="#BA0C2F" />
      <path d="M11 0V20M0 10H30" stroke="#fff" strokeWidth="5" />
      <path d="M11 0V20M0 10H30" stroke="#00205B" strokeWidth="2.5" />
    </>
  ),
  se: (
    <>
      <rect width="30" height="20" fill="#006AA7" />
      <path d="M11 0V20M0 10H30" stroke="#FECC00" strokeWidth="3.5" />
    </>
  ),
  fr: vertical("#0055A4", "#fff", "#EF4135"),
  ie: vertical("#169B62", "#fff", "#FF883E"),
  it: vertical("#009246", "#fff", "#CE2B37"),
  de: horizontal("#000", "#DD0000", "#FFCE00"),
  hu: horizontal("#CE2939", "#fff", "#477050"),
  nl: horizontal("#AE1C28", "#fff", "#21468B"),
  ru: horizontal("#fff", "#0039A6", "#D52B1E"),
  id: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <rect width="30" height="10" fill="#CE1126" />
    </>
  ),
  es: (
    <>
      <rect width="30" height="20" fill="#AA151B" />
      <rect y="5" width="30" height="10" fill="#F1BF00" />
    </>
  ),
  pt: (
    <>
      <rect width="30" height="20" fill="#FF0000" />
      <rect width="12" height="20" fill="#006600" />
      <circle cx="12" cy="10" r="4" fill="#FFE000" stroke="#7a5c00" strokeWidth="0.6" />
      <circle cx="12" cy="10" r="2" fill="#fff" stroke="#C8102E" strokeWidth="0.8" />
    </>
  ),
};

function vertical(a: string, b: string, c: string) {
  return (
    <>
      <rect width="10" height="20" fill={a} />
      <rect x="10" width="10" height="20" fill={b} />
      <rect x="20" width="10" height="20" fill={c} />
    </>
  );
}

function horizontal(a: string, b: string, c: string) {
  return (
    <>
      <rect width="30" height="7" fill={a} />
      <rect y="6.67" width="30" height="6.67" fill={b} />
      <rect y="13.33" width="30" height="6.67" fill={c} />
    </>
  );
}

// Decorative: the language's name always stands beside it.
export function LanguageFlag({ language, className }: { language: TableLanguage; className?: string }) {
  return (
    <svg
      viewBox="0 0 30 20"
      aria-hidden="true"
      focusable="false"
      className={cn("h-3.5 w-[1.3125rem] shrink-0 rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,0.35)]", className)}
    >
      {FLAGS[LANGUAGE_FLAGS[language]]}
    </svg>
  );
}
