"use client";

import { useEffect } from "react";

const RECHECK_AFTER_MS = 15_000;

// Ask the agent programs again when the page comes back into view: the admin
// went off to sign one in from a terminal, or to a table where a turn halted
// on an expired sign-in, and the card must not still say "Ready" (issue
// #713). Focus covers a desktop window that was only behind another one; the
// wait keeps a quick flick away from starting the programs again.
export function useRecheckOnReturn(recheck: () => void) {
  useEffect(() => {
    let last = Date.now();
    const back = () => {
      if (document.visibilityState === "visible" && Date.now() - last >= RECHECK_AFTER_MS) {
        last = Date.now();
        recheck();
      }
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [recheck]);
}
