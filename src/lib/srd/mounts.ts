// Mounts and vehicles.
//
// Mounted combat is in the PHB (p.198) and ODM enforced none of it: a horse
// was a line of equipment, and "I ride him down" was pure DM assertion. This
// is the rules half of that, and it is deliberately the whole of the PHB rule
// and no more, because mounted combat is four paragraphs and inventing a
// fifth would be house rules with a straight face.
//
// Vehicles are here too but thinner, matching where the SRD leaves them: a
// speed, a capacity and a crew requirement. Nothing simulates a ship's
// helm.
//
// Pure by design: no imports beyond types, so scripts/test-mounts.mjs can load it.

import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

export type MountProfile = {
  slug: string;
  name: string;
  // Feet per round.
  speed: number;
  // Pounds it carries before it slows, which is the 5e carrying-capacity rule
  // applied to a beast: Strength x 15, doubled for a Large creature and
  // quadrupled for a Huge one; a mule's Beast of Burden counts it as Large.
  carry: number;
  // A controlled mount is one trained to bear a rider (PHB p.198): the rider
  // chooses its actions and it shares their initiative. An independent mount
  // keeps its own initiative and acts as it likes.
  controllable: boolean;
  // Size, which decides who can ride it: a mount must be at least one size
  // larger than its rider.
  size: MountSize;
  // A flying or aquatic mount, which "An exotic saddle is required for
  // riding" (SRD 5.1 Mounts and Vehicles, Saddles).
  exotic?: boolean;
  blurb: string;
};

export const MOUNT_SIZES = ["small", "medium", "large", "huge"] as const;
export type MountSize = (typeof MOUNT_SIZES)[number];

const SIZE_ORDER: Record<MountSize, number> = { small: 1, medium: 2, large: 3, huge: 4 };

// The SRD's riding animals, with the two flying mounts a table will ask for.
// Each speed is the stat block's walking speed (the griffon's its flying
// speed, 80 feet, as it is ridden in the air), held to the SRD creature
// table by scripts/test-mounts.mjs.
export const MOUNTS: MountProfile[] = [
  {
    slug: "riding-horse",
    name: "Riding horse",
    speed: 60,
    carry: 480,
    controllable: true,
    size: "large",
    blurb: "Fast on a road, useless in a dungeon.",
  },
  {
    slug: "warhorse",
    name: "Warhorse",
    speed: 60,
    carry: 540,
    controllable: true,
    size: "large",
    blurb: "Trained to fight; will not spook at blood.",
  },
  {
    slug: "pony",
    name: "Pony",
    speed: 40,
    carry: 225,
    controllable: true,
    size: "medium",
    blurb: "What a halfling or a gnome actually rides.",
  },
  {
    slug: "draft-horse",
    name: "Draft horse",
    speed: 40,
    carry: 540,
    controllable: true,
    size: "large",
    blurb: "Pulls a cart all day. Not for a charge.",
  },
  {
    slug: "camel",
    name: "Camel",
    speed: 50,
    carry: 480,
    controllable: true,
    size: "large",
    blurb: "Crosses a desert; hates everyone while doing it.",
  },
  {
    slug: "mastiff",
    name: "Mastiff",
    speed: 40,
    carry: 195,
    controllable: true,
    size: "medium",
    blurb: "A small rider's mount, and a tracker.",
  },
  {
    slug: "elk",
    name: "Elk",
    speed: 50,
    carry: 480,
    controllable: false,
    size: "large",
    blurb: "Ridden by those the wild allows. Keeps its own counsel.",
  },
  {
    slug: "mule",
    name: "Mule",
    speed: 40,
    carry: 420,
    controllable: true,
    size: "medium",
    blurb: "Sure-footed on a mountain path; carries like a horse.",
  },
  {
    slug: "elephant",
    name: "Elephant",
    speed: 40,
    carry: 1320,
    controllable: true,
    size: "huge",
    blurb: "Carries a howdah and a war band; tramples what stands in front.",
  },
  {
    slug: "griffon",
    name: "Griffon",
    speed: 80,
    carry: 540,
    controllable: false,
    size: "large",
    exotic: true,
    blurb: "Flies at 80 ft. Independent: it decides.",
  },
];

export function mountProfile(ref: string): MountProfile | null {
  const needle = ref.trim().toLowerCase();
  return (
    MOUNTS.find((mount) => mount.slug === needle) ??
    MOUNTS.find((mount) => textKey(mount.name) === textKey(ref)) ??
    null
  );
}

// PHB p.198: a mount must be at least one size larger than the rider.
export function canCarry(mount: MountSize, rider: MountSize): boolean {
  return SIZE_ORDER[mount] > SIZE_ORDER[rider];
}

export type MountState = {
  // The mount, as a slug or a free name the DM typed.
  ref: string;
  name: string;
  speed: number;
  // Controlled mounts share the rider's initiative; independent ones do not.
  // Only a creature with a sheet is ever independent (independentMount): a
  // mount that is a name on its rider has no block to take a turn with.
  controlled: boolean;
  size: MountSize;
  // The mount's own Armor Class and hit points, from its SRD stat block, so
  // an attack can be aimed at it instead of its rider (SRD 5.1, Controlling
  // a Mount). Absent on a beast the GM wrote with no numbers, and on a
  // mount taken before they were kept.
  ac?: number;
  hp?: number;
  maxHp?: number;
  // The rider made the DC 10 save to stay mounted for the prone they lie in
  // now (src/lib/dm/mount-thrown.ts): that prone asks no second save, from
  // the engine or a dismount sent for it, until they have stood up.
  keptSaddle?: boolean;
  // The creature sheet that is this mount: a steed its rider called up (Find
  // Steed's warhorse). Its Armor Class and hit points are that sheet's and
  // are not kept here, so a blow to the mount and a healing word to the
  // steed reach the same creature.
  sheetId?: string;
};

// A controlled mount "has only three action options: Dash, Disengage, and
// Dodge" (SRD 5.1, Controlling a Mount): one of them a turn, taken on the
// rider's turn beside the rider's own action.
export const MOUNT_ACTIONS = ["dash", "disengage", "dodge"] as const;
export type MountAction = (typeof MOUNT_ACTIONS)[number];

// An independent mount: a creature with its own sheet that "retains its
// place in the initiative order", where "bearing a rider puts no
// restrictions on the actions the mount can take, and it moves and acts as
// it wishes" (SRD 5.1, Controlling a Mount). It keeps its slot in the order
// and the GM plays its turn; the pair stands on the rider's token, which the
// mount's move carries (issue 1036, rulings 2 and 3).
export function independentMount(mount: MountState | null | undefined): mount is MountState & { sheetId: string } {
  return Boolean(mount && !mount.controlled && mount.sheetId);
}

// A mount that is only a name on its rider's record has no stat block to act
// with, so it is ridden as a controlled mount whatever was asked (issue 1036,
// ruling 1: "A named mount with no block stays controlled"). Returns the
// record as it is ridden and, when that changed it, the reason to say so.
export function rideByRecord(state: MountState): { state: MountState; stays?: string } {
  if (state.controlled || state.sheetId) {
    return { state };
  }
  return {
    state: { ...state, controlled: true },
    stays: `${state.name} is ridden as a controlled mount: it is a name on its rider's record with no creature of its own on the table, and only a creature with a stat block (one its rider called up, mounted by its own name with controlled false) keeps a turn of its own.`,
  };
}

// The rider's once-a-turn mark for the mount's action (action-budget.ts).
export function mountActionKey(action: MountAction): string {
  return `mount:${action}`;
}

// The action the mount took this turn, read from the rider's marks, or null.
export function mountActionTaken(oncePerTurn: readonly string[]): MountAction | null {
  return MOUNT_ACTIONS.find((action) => oncePerTurn.includes(mountActionKey(action))) ?? null;
}

// Whether the ride has already taken the mount's Dash: more squares moved
// than its speed gives once for each Dash the rider took (the rider's own).
export function mountDashRidden(movedTiles: number, mountTiles: number, riderDashes: number): boolean {
  return movedTiles > mountTiles * (1 + riderDashes);
}

// The mark on the rider while the mount dodges, until the rider's next
// turn: an attack aimed at the mount rolls at disadvantage.
export const MOUNT_DODGING = "mount dodging";

export type MountCheck = { ok: true; state: MountState } | ToolError;

// Mounting. The rules it enforces are the ones the PHB actually states, and
// the errors say which rule refused, because "you cannot do that" teaches a
// table nothing.
export function checkMount(input: {
  ref: string;
  riderSize?: MountSize;
  // The rider carries an exotic saddle (Saddle, Exotic).
  exoticSaddle?: boolean;
  // A DM writing their own beast: everything is taken on trust except the
  // size rule, which still applies.
  custom?: { name: string; speed: number; controlled: boolean; size: MountSize };
}): MountCheck {
  const riderSize = input.riderSize ?? "medium";
  if (input.custom) {
    const speed = Math.min(200, Math.max(0, Math.round(input.custom.speed)));
    if (!canCarry(input.custom.size, riderSize)) {
      return {
        error: `A mount has to be at least one size larger than its rider; a ${input.custom.size} mount cannot carry a ${riderSize} rider.`,
        refused: "rules",
      };
    }
    return {
      ok: true,
      state: {
        ref: input.custom.name.toLowerCase(),
        name: input.custom.name.slice(0, 60),
        speed,
        controlled: input.custom.controlled,
        size: input.custom.size,
      },
    };
  }
  const profile = mountProfile(input.ref);
  if (!profile) {
    return { error: `No mount called "${input.ref}"; the mounts are ${MOUNTS.map((mount) => mount.name).join(", ")}. A listed one is sent in mount by that name whatever the table calls it; an animal no list has is sent in customName with its speed and size.`, retry: true };
  }
  if (!canCarry(profile.size, riderSize)) {
    return {
      error: `A ${riderSize} rider cannot ride a ${profile.size} ${profile.name}; a mount has to be one size larger.`,
      refused: "rules",
    };
  }
  // SRD 5.1 Saddles: "An exotic saddle is required for riding any aquatic
  // or flying mount" (issue #570, EQP-24).
  if (profile.exotic && !input.exoticSaddle) {
    return {
      error: `A ${profile.name} is ridden only in an exotic saddle (SRD 5.1, Saddles), and the rider carries none. They get one (Saddle, Exotic) or ride another mount.`,
      refused: "rules",
    };
  }
  return {
    ok: true,
    state: {
      ref: profile.slug,
      name: profile.name,
      speed: profile.speed,
      controlled: profile.controllable,
      size: profile.size,
    },
  };
}

// A creature's printed size as a mount's, or null for one too small to carry
// anyone. Gargantuan carries as Huge does: the size rule asks only for one
// size larger than the rider.
export function mountSizeOf(size: string): MountSize | null {
  const key = textKey(size);
  if (key === "gargantuan") {
    return "huge";
  }
  return MOUNT_SIZES.find((entry) => entry === key) ?? null;
}

// Mounting a creature the table already keeps as a sheet (issue 986): "A
// willing creature that is at least one size larger than you and that has an
// appropriate anatomy can serve as a mount" (SRD 5.1, Mounted Combat). The
// size rule is checked; the anatomy is the GM's to judge. It does as its
// maker directs, so it is ridden as a controlled mount unless the GM says it
// acts as it wishes (`controlled: false`; issue 1036 ruling 4: controlled by
// default, the GM's call each time, no Intelligence threshold).
export function checkCreatureMount(input: { sheetId: string; name: string; speed: number; size: string; riderSize?: MountSize; controlled?: boolean }): MountCheck {
  const riderSize = input.riderSize ?? "medium";
  const size = mountSizeOf(input.size);
  if (!size || !canCarry(size, riderSize)) {
    return {
      error: `A mount has to be at least one size larger than its rider; ${input.name} is ${input.size.trim() || "too small"} and cannot carry a ${riderSize} rider.`,
      refused: "rules",
    };
  }
  return {
    ok: true,
    state: { ref: `sheet:${input.sheetId}`, name: input.name.slice(0, 60), speed: Math.min(200, Math.max(0, Math.round(input.speed))), controlled: input.controlled !== false, size, sheetId: input.sheetId },
  };
}

// While mounted, the rider moves at the mount's speed rather than their own
// (PHB p.198). Their own speed is not added; a fast rider on a slow horse
// travels at the horse's pace.
export function mountedSpeed(mount: MountState | null, riderSpeed: number): number {
  return mount ? mount.speed : riderSpeed;
}

// Being knocked off. PHB p.198: if an effect moves the mount against its
// will, or the rider is knocked prone, the rider must make a DC 10 Dexterity
// save or fall prone in a space within 5 feet of the mount. A save is not
// required when the rider dismounts deliberately, nor when the mount is
// knocked prone: "you can use your reaction to dismount it as it falls and
// land on your feet. Otherwise, you are dismounted and fall prone" (SRD 5.1,
// Mounting and Dismounting).
export const DISMOUNT_SAVE_DC = 10;

export type DismountCause = "forced-move" | "mount-prone" | "rider-prone" | "voluntary";

export function dismountSave(cause: DismountCause): { dc: number; ability: "dex" } | null {
  return cause === "voluntary" || cause === "mount-prone" ? null : { dc: DISMOUNT_SAVE_DC, ability: "dex" };
}

// "If you're knocked prone while mounted, you must make the same saving
// throw" (SRD 5.1, Mounting and Dismounting). The save is owed for being laid
// prone, once: a rider prone before an engine call and prone after it was
// not knocked prone by it (a table set down that way), and one who already
// made the save for this prone (keptSaddle) owes nothing, however many
// settles look at the same call (a person's hand-on plays the backstop's
// enemies inside its own call, and both settle).
export function riderKnockedProne(wasProne: boolean, isProne: boolean, keptSaddle = false): boolean {
  return isProne && !wasProne && !keptSaddle;
}

// PHB p.198: mounting or dismounting costs half the rider's movement.
export function mountCost(riderSpeed: number): number {
  return Math.floor(Math.max(0, riderSpeed) / 2);
}

// ---- vehicles ----

export type VehicleProfile = {
  slug: string;
  name: string;
  // Miles per hour on the surface it belongs to.
  mph: number;
  // Pounds of cargo.
  capacity: number;
  // How many hands it needs to move at all.
  crew: number;
  passengers: number;
  blurb: string;
};

export const VEHICLES: VehicleProfile[] = [
  { slug: "cart", name: "Cart", mph: 2, capacity: 200, crew: 1, passengers: 2, blurb: "One draft animal, one bad axle." },
  { slug: "wagon", name: "Wagon", mph: 2, capacity: 2000, crew: 1, passengers: 8, blurb: "The party's baggage train." },
  { slug: "carriage", name: "Carriage", mph: 2, capacity: 600, crew: 1, passengers: 4, blurb: "For arriving somewhere respectable." },
  { slug: "rowboat", name: "Rowboat", mph: 1.5, capacity: 300, crew: 1, passengers: 3, blurb: "Crosses a river. Slowly." },
  { slug: "keelboat", name: "Keelboat", mph: 1, capacity: 4000, crew: 1, passengers: 6, blurb: "River and coastal trade." },
  { slug: "longship", name: "Longship", mph: 3, capacity: 10000, crew: 40, passengers: 150, blurb: "Oars and a sail; beaches anywhere." },
  { slug: "sailing-ship", name: "Sailing ship", mph: 2, capacity: 100000, crew: 20, passengers: 20, blurb: "Open water and a hold worth raiding." },
  { slug: "galley", name: "Galley", mph: 4, capacity: 150000, crew: 80, passengers: 40, blurb: "Fast, hungry for rowers." },
  { slug: "airship", name: "Airship", mph: 8, capacity: 8000, crew: 10, passengers: 20, blurb: "Where the setting allows one." },
];

export function vehicleProfile(ref: string): VehicleProfile | null {
  const needle = ref.trim().toLowerCase();
  return (
    VEHICLES.find((vehicle) => vehicle.slug === needle) ??
    VEHICLES.find((vehicle) => textKey(vehicle.name) === textKey(ref)) ??
    null
  );
}

// How far a vehicle gets in a stretch of travel, and whether it can move at
// all. Undercrewed is not a refusal: a longship with ten rowers still moves,
// just badly, and telling the table that is more useful than stopping them.
export function vehicleTravel(
  vehicle: VehicleProfile,
  hours: number,
  crewAboard: number,
): { miles: number; note: string } {
  const ratio = vehicle.crew > 0 ? Math.min(1, crewAboard / vehicle.crew) : 1;
  // Below half crew a vessel is barely under way; the halving is ODM's own
  // simplification of a rule the SRD does not print, and is called out as
  // such rather than passed off as 5e.
  const factor = ratio >= 1 ? 1 : ratio >= 0.5 ? 0.75 : 0.5;
  const miles = Math.round(vehicle.mph * Math.max(0, hours) * factor * 10) / 10;
  const note =
    factor === 1
      ? `${vehicle.name}: ${vehicle.mph} mph, fully crewed.`
      : `${vehicle.name} is undercrewed (${crewAboard} of ${vehicle.crew}); it makes ${Math.round(factor * 100)}% of its speed.`;
  return { miles, note };
}

export function describeMount(state: MountState): string {
  return `${state.name}, speed ${state.speed} ft.${state.controlled ? ", controlled (shares your initiative)" : ", independent (keeps its own turn in the order and acts as it wishes)"}`;
}
