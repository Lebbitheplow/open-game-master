// The post-apocalyptic classes' features built in the fifth pass of wave 2
// (WAVE2 D5: "The genre classes' text is the rule, played on the SRD 5.1
// engine"), as rows of the authored layer the way
// src/lib/srd/authored-effects-genre-b.ts holds the earlier passes'. Their text
// is src/lib/classes/post-apocalyptic-features.json; each row names its class
// so a same-named feature of another class never runs as this one. Registered
// in GENRE_AUTHORED (src/lib/srd/authored-effects-genre.ts) with one line.
//
// Pure data; no database.
import type { AuthoredEntry, SpendAction, SpendDoes } from "@/lib/srd/authored-effects-types";
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

const row = (feature: string, classes: string[], entry: Omit<AuthoredEntry, "subclass">): GenreRow => ({
  feature,
  classes,
  entry: { subclass: "genre", ...entry },
});

function spend(feature: string, classes: string[], counter: string, action: SpendAction | undefined, does: SpendDoes): GenreRow {
  return { feature, classes, entry: { subclass: "genre", counter, spends: [{ name: feature, pool: { id: counter }, ...(action ? { action } : {}), does }] } };
}

export const GENRE_B_PA_AUTHORED: GenreRow[] = [
  // ---- the packmaster's beasts (src/lib/dm/genre-b-post-apocalyptic-beast.ts) ----
  // "A loyal wasteland beast fights beside you (AC 13 + your proficiency, HP 5
  // x level, attack 1d8 + WIS, obeys your commands)": the call that brings it
  // to the board; War Beast and Twin Bond change what is bonded.
  row("Bonded Beast", ["packmaster"], { spends: [{ name: "Bonded Beast", action: "none", does: { kind: "pack", call: "bonded" } }] }),
  // "1/long rest, summon 1d4 local beasts (wolf stats) to aid you for 10 minutes."
  spend("Call the Wild", ["packmaster"], "post_apocalyptic_call_the_wild", "action", { kind: "pack", call: "wild" }),
  // "1/long rest, your beast grows monstrous for 1 minute: double HP, +10 ft
  // speed, attacks deal +2d8 and frighten (WIS save)."
  spend("Legend of the Pack", ["packmaster"], "post_apocalyptic_legend_of_the_pack", undefined, { kind: "pack", call: "legend" }),
];
