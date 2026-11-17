// Which of the three ways to a hero to recommend (HeroRoutes.tsx). The
// library card's line is built from the dictionaries (table.hero.*), so the
// reading takes the translator from the component that draws it, the way
// home/types.ts's agoLabel does. Pure otherwise, for
// scripts/test-hero-routes.mjs.

export type HeroRoute = "ready" | "library" | "build";

export type HeroRouteAdvice = {
  // The route marked on the screen.
  suggested: HeroRoute;
  // Whether ready-made heroes exist on this server at all.
  ready: boolean;
  // Whether the library holds a hero this seat may bring.
  library: boolean;
  // The ready-made list opens by itself (an empty library).
  openReady: boolean;
  // The library card's line, naming what it holds.
  libraryLine: string;
};

export function heroRouteAdvice(
  t: (key: string, vars?: Record<string, string | number>) => string,
  { library, pregens }: { library: string[]; pregens: number },
): HeroRouteAdvice {
  const ready = pregens > 0;
  const has = library.length > 0;
  const named =
    library.length === 1
      ? library[0]
      : library.length === 2
        ? t("{first} and {second}", { first: library[0], second: library[1] })
        : t("{first}, {second} and {count} more", { first: library[0], second: library[1], count: library.length - 2 });
  return {
    // A player with heroes of their own most likely wants one of them; one
    // with none is quickest at the table with a ready-made one.
    suggested: has ? "library" : ready ? "ready" : "build",
    ready,
    library: has,
    openReady: !has && ready,
    libraryLine: has
      ? t("{named}, adapted to this table's level. Joining leaves your library copy as it is.", { named })
      : t("Nothing saved yet. Heroes you make or take here are kept for your next table."),
  };
}
