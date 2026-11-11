// The steampunk classes' features built in wave 2's fifth round (WAVE2 D5:
// "The genre classes' text is the rule, played on the SRD 5.1 engine"), kept
// apart from authored-effects-genre-b.ts so the mystery and post-apocalyptic
// rounds, which run beside this one, never append to the same array. Rows are
// found by feature name with `classes` naming the class they belong to, as
// that file's are; their text is src/lib/classes/steampunk-features.json.
//
// Pure data; no database.
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

export const GENRE_B_STEAMPUNK_AUTHORED: GenreRow[] = [
  // "1/long rest, ignore being disarmed": what the gadgeteer let fall is in
  // their hand again and the disarmed mark is gone, at no cost of the turn;
  // refused, nothing spent, when they are not disarmed
  // (src/lib/dm/genre-b-steampunk-spends.ts rearm).
  {
    feature: "Backup Rig",
    classes: ["gadgeteer"],
    entry: { subclass: "genre", counter: "steampunk_backup_rig", spends: [{ name: "Backup Rig", pool: { id: "steampunk_backup_rig" }, action: "none", does: { kind: "steampunk", what: "rearm" } }] },
  },
];
