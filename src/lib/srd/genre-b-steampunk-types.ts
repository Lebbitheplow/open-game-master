// The spends only the steampunk classes make (WAVE2 D5), one shape of the
// authored layer's SpendDoes (src/lib/srd/authored-effects-types.ts, kind
// "steampunk") so a new one is a line here and a case in
// src/lib/dm/genre-b-steampunk-spends.ts, never another hunk in the shared
// union.
//
// Pure data; no database.
export type SteampunkSpend =
  // Backup Rig: "1/long rest, ignore being disarmed". What was knocked from
  // the holder's hand is in it again and the disarmed mark is gone.
  | { what: "rearm" }
  // The aeronaut's (src/lib/dm/genre-gb-aeronaut.ts): Grapnel Ace's trip or
  // disarm, Legend of the Skies' extra turn, Boarding Action's opening move.
  | { what: "grapnel"; mode: "trip" | "disarm" }
  | { what: "extra_turn" }
  | { what: "boarding" };
