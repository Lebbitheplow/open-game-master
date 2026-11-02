// What stands between a character and noticing something without looking
// for it: the pace they march at and the light they see by. Pure, so the
// numbers can be tested apart from the tool (src/lib/dm/check-tools.ts).
//
// SRD 5.1, Travel Pace: a fast pace is -5 to passive Wisdom (Perception).
// SRD 5.1, Vision and Light: dim light is lightly obscured, disadvantage on
// Wisdom (Perception) checks that rely on sight, and a passive check at
// disadvantage is -5; in darkness a creature without darkvision sees nothing,
// and darkvision turns darkness into dim light and dim light into bright.
import { isConditionNamed } from "../srd/feature-names.ts";

export type Light = "bright" | "dim" | "dark";

// The light under the open sky at an hour of the day: twilight either side
// of the night, darkness through it.
export function skyLight(hour: number): Light {
  const value = ((Math.floor(hour) % 24) + 24) % 24;
  if (value >= 21 || value < 5) {
    return "dark";
  }
  if (value < 7 || value >= 19) {
    return "dim";
  }
  return "bright";
}

// Where the party is, off the board, as far as light goes. SRD 5.1, Vision
// and Light: darkness outdoors at night, and "within the confines of an
// unlit dungeon or a subterranean vault" at any hour; a lived-in building is
// lit by its lamps and fires. Read from the scene the location tools store
// as the place's bed (src/lib/ambience/catalog.ts sceneIds), a fixed choice
// made the same way at every table, never from the words of its name: a
// scene that does not settle it (null) is not guessed at.
export type PlaceKind = "outdoors" | "indoors" | "underground";

export const PLACE_KIND_OF_SCENE: Readonly<Record<string, PlaceKind | null>> = {
  dungeon: "underground",
  cave: "underground",
  crypt: "underground",
  sewer: "underground",
  mine: "underground",
  temple: "indoors",
  tavern: "indoors",
  keep: "indoors",
  library: "indoors",
  forge: "indoors",
  ruins: "outdoors",
  forest: "outdoors",
  deep_forest: "outdoors",
  jungle: "outdoors",
  swamp: "outdoors",
  desert: "outdoors",
  mountain: "outdoors",
  tundra: "outdoors",
  plains: "outdoors",
  river: "outdoors",
  waterfall: "outdoors",
  coast: "outdoors",
  ship: "outdoors",
  town: "outdoors",
  city: "outdoors",
  market: "outdoors",
  camp: "outdoors",
  graveyard: "outdoors",
  // Lit or not by where they are: under the sea, a crowd in a hall or a
  // square, a wizard's laboratory or a rift in the open.
  underwater: null,
  crowd: null,
  arcane: null,
};

// The light off the board. A light the DM names wins; then the place: an
// unlit underground place is dark, a building is lit, the open sky follows
// the hour. With no location recorded the party is taken to be under the
// sky, as before; a place whose scene does not settle it gives no light
// shift at all (null), for the DM to name.
export function offBoardLight(input: {
  hour: number;
  named?: Light | null;
  place?: { scene: string | null; outdoors?: boolean | null } | null;
}): Light | null {
  if (input.named) {
    return input.named;
  }
  if (!input.place) {
    return skyLight(input.hour);
  }
  if (input.place.outdoors === true) {
    return skyLight(input.hour);
  }
  // A bed that is no scene (a sound picked for the place, "wind", "night")
  // has no row, and settles nothing.
  const kind = (input.place.scene ? PLACE_KIND_OF_SCENE[input.place.scene] : null) ?? (input.place.outdoors === false ? "indoors" : null);
  if (kind === "underground") {
    return "dark";
  }
  if (kind === "indoors") {
    return "bright";
  }
  if (kind === "outdoors") {
    return skyLight(input.hour);
  }
  return null;
}

// The light a character sees by: their own lit torch or lantern brightens
// what is near them, and darkvision lifts the light one step.
export function lightSeenBy(ambient: Light, carriesLight: boolean, darkvision: boolean): Light {
  let light = carriesLight ? "bright" : ambient;
  if (darkvision) {
    light = light === "dark" ? "dim" : "bright";
  }
  return light as Light;
}

// The shift to a passive Perception that relies on sight, with the reasons
// for the result.
// In darkness a creature that cannot see is effectively blinded, and a
// blinded creature fails any check that relies on sight (SRD 5.1,
// Conditions): `blind` says so, and the caller counts the character out.
// Dim light is `disadvantage`, not a flat -5: the caller merges it with the
// character's other disadvantages, since two of them are still one (SRD 5.1,
// Advantage and Disadvantage). The fast pace is a flat penalty and stacks.
// Something noticed by ear is not touched by the light.
export function sightPassiveShift(input: {
  pace?: "fast" | "normal" | "slow";
  light?: Light;
  byEar?: boolean;
}): { shift: number; blind: boolean; disadvantage: boolean; notes: string[] } {
  let shift = 0;
  const notes: string[] = [];
  if (input.pace === "fast") {
    shift -= 5;
    notes.push("fast pace: -5");
  }
  if (input.byEar) {
    return { shift, blind: false, disadvantage: false, notes };
  }
  if (input.light === "dim") {
    notes.push("dim light: disadvantage");
    return { shift, blind: false, disadvantage: true, notes };
  } else if (input.light === "dark") {
    notes.push("darkness: sees nothing");
    return { shift, blind: true, disadvantage: false, notes };
  }
  return { shift, blind: false, disadvantage: false, notes };
}

// Why a creature notices nothing at all, or null when it can try. An
// unconscious creature is unaware of its surroundings (SRD 5.1, Conditions),
// a creature at 0 hit points is unconscious, and the dead notice nothing.
// The reason, not a yes or no, so check_notice can say it: a hero killed by
// exhaustion on the road missed a DC 5 thing with no line saying why, and
// the note blamed a passive score that was never compared.
export function unawareReason(sheet: { currentHp: number; conditions: string[]; deathSaves?: { dead?: boolean } | null }): string | null {
  if (sheet.deathSaves?.dead) {
    return "dead: notices nothing";
  }
  if (sheet.conditions.some((condition) => isConditionNamed(condition, "asleep", "sleeping"))) {
    return "asleep: unaware of their surroundings";
  }
  if (sheet.conditions.some((condition) => isConditionNamed(condition, "unconscious"))) {
    return "unconscious: unaware of their surroundings";
  }
  if (sheet.currentHp <= 0) {
    return "at 0 hit points, unconscious: unaware of their surroundings";
  }
  return null;
}
