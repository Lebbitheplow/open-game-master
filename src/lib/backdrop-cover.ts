import { useEffect } from "react";

// Whether a screen that paints over the whole window is up, so the layout's
// living backdrop (src/app/TopoBackground.tsx) can rest behind it.
//
// The contour canvas redraws twenty times a second on every page. Behind a
// table, a lobby or the table view none of it shows (shot with the canvas
// painted solid, not one pixel of it comes through, day or night, phone or
// desktop), and it was drawn all the same for as long as the table stayed
// open: a second frame loop under the board's own. A screen that covers the
// window says so here while it is mounted; one that lets the backdrop show
// (the home, the library, the workshop) says nothing and nothing changes
// for it. If a screen that says so here is ever restyled to let the
// backdrop through, drop its call: the backdrop would stand still under it.

let covering = 0;
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) {
    listener();
  }
}

// Called by a screen for as long as it covers the window (`active` lets a
// page with a loading or an error state, which do not cover it, hold off).
export function useCoversBackdrop(active = true) {
  useEffect(() => {
    if (!active) {
      return;
    }
    covering += 1;
    changed();
    return () => {
      covering -= 1;
      changed();
    };
  }, [active]);
}

export function backdropCovered(): boolean {
  return covering > 0;
}

export function onBackdropCover(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
