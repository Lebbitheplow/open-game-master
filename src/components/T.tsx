"use client";

import { useT } from "@/lib/locale";
import type { MessageKey } from "@/lib/messages-logic";

// One translated line as a node, for chrome inside a server component: the
// legal pages render PageShell's title, blurb and the section headings on
// the server, where no hook can run, so the words arrive through this client
// leaf instead. Body text stays English there; only the frame speaks.
export function T({ k, vars }: { k: MessageKey; vars?: Record<string, string | number> }) {
  const t = useT();
  return <>{t(k, vars)}</>;
}
