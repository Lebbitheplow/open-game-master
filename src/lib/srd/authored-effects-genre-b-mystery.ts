// The mystery classes' features the fifth pass built (WAVE2 D5: "The genre
// classes' text is the rule, played on the SRD 5.1 engine"), as rows of the
// authored layer beside src/lib/srd/authored-effects-genre-b.ts's: the text is
// src/lib/classes/mystery-features.json's, each row is found by feature name
// and held to its class so a name another class shares never runs as this one.
//
// A row here is read by the authored engines (passive effects, spends on the
// feature's own counter, reactions). What a feature does that no authored
// shape says lives in src/lib/dm/genre-b-mystery-*.ts, named beside its row.
//
// Pure data; no database.
import type { AuthoredEntry, ReactionDoes, SpendAction, SpendDoes } from "@/lib/srd/authored-effects-types";
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

const row = (feature: string, classes: string[], entry: Omit<AuthoredEntry, "subclass">): GenreRow => ({
  feature,
  classes,
  entry: { subclass: "genre", ...entry },
});

function spend(feature: string, classes: string[], counter: string, action: SpendAction | undefined, does: SpendDoes): GenreRow {
  return { feature, classes, entry: { subclass: "genre", counter, spends: [{ name: feature, pool: { id: counter }, ...(action ? { action } : {}), does }] } };
}

function react(feature: string, classes: string[], counter: string, does: ReactionDoes): GenreRow {
  return { feature, classes, entry: { subclass: "genre", counter, reactions: [{ name: feature, pool: { id: counter }, does }] } };
}

export const GENRE_B_MYSTERY_AUTHORED: GenreRow[] = [
  // ---- enforcer ----
  // "Advantage against being moved, knocked prone, or grappled": the saves an
  // enemy's blow forces against being knocked prone or grappled
  // (src/lib/dm/enemy-hit.ts resolveOnHit names them); the escape from a
  // grapple is src/lib/srd/genre-b-combat.ts genreEscapeAdvantage, and "your
  // grapples escape at disadvantage" genreGripDisadvantage. No enemy rider or
  // area the engine rolls pushes a character on a save of its own, so being
  // moved has no roll to give advantage on.
  row("Immovable", ["enforcer"], { effects: [{ kind: "save_adv", against: ["prone", "grappled"] }] }),
];

// Kept for the rows the later features add.
export const mysteryRows = { spend, react };
