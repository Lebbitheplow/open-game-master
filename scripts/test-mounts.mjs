// Mounts and vehicles: who can ride what, what it costs, and how fast a
// vessel actually moves.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  canCarry,
  checkMount,
  describeMount,
  DISMOUNT_SAVE_DC,
  dismountSave,
  riderKnockedProne,
  checkCreatureMount,
  independentMount,
  rideByRecord,
  mountSizeOf,
  MOUNTS,
  mountCost,
  mountProfile,
  mountedSpeed,
  VEHICLES,
  vehicleProfile,
  vehicleTravel,
} = await import("../src/lib/srd/mounts.ts");
const { SRD_CREATURES } = await import("../src/lib/srd/srd-creatures.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("a mount is found by its slug or its whole name", () => {
  assert.equal(mountProfile("warhorse").slug, "warhorse");
  assert.equal(mountProfile("Riding horse").slug, "riding-horse");
  assert.equal(mountProfile("griffon").speed, 80);
  assert.equal(mountProfile("wyvern"), null);
});

test("every listed mount has a speed and a size", () => {
  for (const mount of MOUNTS) {
    assert.ok(mount.speed > 0, `${mount.slug} needs a speed`);
    assert.ok(mount.size, `${mount.slug} needs a size`);
  }
});

test("every mount is its SRD 5.1 stat block: the mule and the elephant are there, and each speed, size and load is the block's", () => {
  // Carrying capacity: Strength x 15, doubled for a Large creature and
  // quadrupled for a Huge one; Beast of Burden counts the mule as Large.
  const factor = { Medium: 1, Large: 2, Huge: 4 };
  for (const slug of ["mule", "elephant"]) {
    assert.ok(mountProfile(slug), `no ${slug}`);
  }
  for (const mount of MOUNTS) {
    const block = SRD_CREATURES.find((creature) => creature.name.toLowerCase() === mount.name.toLowerCase());
    assert.ok(block, `${mount.name} has no SRD stat block`);
    assert.equal(mount.size, block.size.toLowerCase(), mount.name);
    // A flying mount is ridden in the air (the griffon's 80 feet).
    assert.equal(mount.speed, block.speeds.fly ?? block.speeds.walk, mount.name);
    const burden = block.traits.some((trait) => /^Beast of Burden:/.test(trait));
    assert.equal(mount.carry, block.abilities.str * 15 * (burden ? factor.Large : factor[block.size]), mount.name);
  }
  assert.deepEqual([mountProfile("mule").carry, mountProfile("elephant").carry], [420, 1320]);
});

test("PHB p.198: a mount must be one size larger than its rider", () => {
  assert.equal(canCarry("large", "medium"), true);
  assert.equal(canCarry("medium", "small"), true);
  assert.equal(canCarry("medium", "medium"), false);
  assert.equal(canCarry("small", "medium"), false);
});

test("a medium rider cannot take a pony, and is told which rule refused", () => {
  const refused = checkMount({ ref: "pony", riderSize: "medium" });
  assert.ok("error" in refused);
  assert.match(refused.error, /one size larger/);
});

test("a small rider can take a pony", () => {
  const ok = checkMount({ ref: "pony", riderSize: "small" });
  assert.equal(ok.ok, true);
  assert.equal(ok.state.speed, 40);
});

test("an unknown mount is refused with a way forward", () => {
  const refused = checkMount({ ref: "manticore", riderSize: "medium" });
  assert.ok("error" in refused);
  assert.match(refused.error, /an animal no list has is sent in customName/);
  assert.match(refused.error, /the mounts are Riding horse, Warhorse/);
});

test("a custom beast is taken on trust except for the size rule", () => {
  const ok = checkMount({
    ref: "",
    riderSize: "medium",
    custom: { name: "Ashen drake", speed: 70, controlled: true, size: "large" },
  });
  assert.equal(ok.state.name, "Ashen drake");
  assert.equal(ok.state.speed, 70);
  const refused = checkMount({
    ref: "",
    riderSize: "medium",
    custom: { name: "Riding cat", speed: 40, controlled: true, size: "medium" },
  });
  assert.ok("error" in refused);
});

test("an independent mount is marked as one", () => {
  // SRD 5.1 Saddles: "An exotic saddle is required for riding any aquatic
  // or flying mount", so the griffon is ridden in one.
  assert.equal(checkMount({ ref: "griffon", riderSize: "medium", exoticSaddle: true }).state.controlled, false);
  assert.equal(checkMount({ ref: "griffon", riderSize: "medium" }).refused, "rules");
  assert.equal(checkMount({ ref: "warhorse", riderSize: "medium" }).state.controlled, true);
});

test("barding is the suit it is named for, with as much of the mount's Dexterity as the suit lets through", async () => {
  const { bardingSuit, bardingAc, carriedBarding } = await import("../src/lib/srd/barding.ts");
  // SRD 5.1: "Any type of armor shown on the Armor table can be purchased as barding."
  assert.equal(bardingSuit("Chain Mail Barding")?.name, "Chain Mail");
  assert.equal(bardingSuit("Barding (Plate)")?.name, "Plate");
  assert.equal(bardingSuit("Barding, Leather")?.name, "Leather");
  assert.equal(bardingSuit("Chain Mail"), null, "a suit for a person is no barding");
  assert.equal(bardingSuit("Barding"), null, "barding that names no suit has no numbers");
  assert.equal(bardingSuit("Shield Barding"), null, "a shield is not worn as barding");
  // A warhorse has Dexterity 12: all of it under leather, none under chain mail, at most +2 under scale.
  assert.equal(bardingAc(bardingSuit("Leather Barding"), 12), 12);
  assert.equal(bardingAc(bardingSuit("Chain Mail Barding"), 12), 16);
  assert.equal(bardingAc(bardingSuit("Scale Mail Barding"), 18), 16);
  assert.equal(bardingAc(bardingSuit("Chain Mail Barding"), 6), 16, "heavy barding passed a Dexterity penalty on");
  assert.deepEqual(
    carriedBarding([{ name: "Leather Barding" }, { name: "Rope" }, { name: "Chain Mail Barding" }], 12),
    { name: "Chain Mail Barding", ac: 16 },
    "the better of two bardings is the one worn",
  );
  assert.equal(carriedBarding([{ name: "Chain Mail" }], 12), null);
  // Issue #1038: barding is tack. Packed, it is cargo and protects nothing.
  assert.equal(carriedBarding([{ name: "Chain Mail Barding", equipped: false }], 12), null);
  assert.deepEqual(carriedBarding([{ name: "Chain Mail Barding", equipped: false }, { name: "Leather Barding" }], 12), { name: "Leather Barding", ac: 12 });
  const { isTack, onMount } = await import("../src/lib/srd/tack.ts");
  assert.equal(isTack({ name: "Barding (Plate)" }), true);
  assert.equal(isTack({ name: "Plate" }), false);
  assert.equal(onMount({ name: "Chain Mail Barding" }), true);
  // "Weighs twice as much": 110 lb of chain mail barding, on the mount and not on its rider.
  const { loadLines } = await import("../src/lib/srd/encumbrance.ts");
  const [on, packed] = loadLines([{ name: "Chain Mail Barding", qty: 1 }]).concat(loadLines([{ name: "Chain Mail Barding", qty: 1, equipped: false }]));
  assert.deepEqual([on.eachLb, on.totalLb, on.onMount], [110, 0, true]);
  assert.deepEqual([packed.eachLb, packed.totalLb, packed.onMount], [110, 110, undefined]);
});

test("a rider moves at the mount's speed, not their own", () => {
  const state = checkMount({ ref: "warhorse", riderSize: "medium" }).state;
  assert.equal(mountedSpeed(state, 30), 60);
  // A fast rider on a slow horse travels at the horse's pace.
  assert.equal(mountedSpeed(checkMount({ ref: "draft-horse", riderSize: "medium" }).state, 50), 40);
  assert.equal(mountedSpeed(null, 30), 30);
});

test("mounting costs half the rider's movement", () => {
  assert.equal(mountCost(30), 15);
  assert.equal(mountCost(25), 12);
  assert.equal(mountCost(0), 0);
});

test("being thrown calls for the save; choosing to get off does not", () => {
  assert.deepEqual(dismountSave("forced-move"), { dc: DISMOUNT_SAVE_DC, ability: "dex" });
  assert.deepEqual(dismountSave("rider-prone"), { dc: DISMOUNT_SAVE_DC, ability: "dex" });
  assert.equal(dismountSave("voluntary"), null);
});

test("a creature the table keeps as a sheet is a mount by the size rule, ridden as a controlled one, and its hit points stay on its sheet", () => {
  const warhorse = checkCreatureMount({ sheetId: "s1", name: "Warhorse", speed: 60, size: "Large", riderSize: "medium" });
  assert.equal(warhorse.ok, true);
  assert.deepEqual(warhorse.state, { ref: "sheet:s1", name: "Warhorse", speed: 60, controlled: true, size: "large", sheetId: "s1" });
  assert.equal(warhorse.state.hp, undefined);
  // A mastiff carries a halfling and not a human; a wolf carries neither a human nor anything when it is Tiny.
  assert.equal(checkCreatureMount({ sheetId: "s2", name: "Mastiff", speed: 40, size: "Medium", riderSize: "small" }).ok, true);
  assert.match(checkCreatureMount({ sheetId: "s2", name: "Mastiff", speed: 40, size: "Medium", riderSize: "medium" }).error, /one size larger/);
  assert.match(checkCreatureMount({ sheetId: "s3", name: "Owl", speed: 60, size: "Tiny", riderSize: "small" }).error, /one size larger/);
  assert.equal(mountSizeOf("Gargantuan"), "huge");
  assert.equal(mountSizeOf("tiny"), null);
});

// Issue 1036, rulings 1 and 4: controlled by default, independent only by
// the GM's word and only for a creature with a sheet.
test("a creature mount is independent only when the GM says so; a mount on record never is", () => {
  const led = checkCreatureMount({ sheetId: "s1", name: "Warhorse", speed: 60, size: "Large", riderSize: "medium" }).state;
  const free = checkCreatureMount({ sheetId: "s1", name: "Warhorse", speed: 60, size: "Large", riderSize: "medium", controlled: false }).state;
  assert.equal(independentMount(led), false);
  assert.equal(free.controlled, false);
  assert.equal(independentMount(free), true);
  assert.deepEqual(rideByRecord(free), { state: free }, "a creature's choice was overruled");
  assert.equal(independentMount(null), false);
  // The griffon's profile is not a trained mount, and a record has no block to take a turn with.
  const griffon = checkMount({ ref: "griffon", riderSize: "medium", exoticSaddle: true }).state;
  assert.equal(independentMount(griffon), false);
  const ridden = rideByRecord(griffon);
  assert.equal(ridden.state.controlled, true);
  assert.match(ridden.stays, /Griffon is ridden as a controlled mount.*stat block/);
  const warhorse = checkMount({ ref: "warhorse", riderSize: "medium" }).state;
  assert.deepEqual(rideByRecord(warhorse), { state: warhorse }, "a trained mount was given a reason for nothing");
  assert.match(describeMount(free), /independent \(keeps its own turn in the order/);
});

test("a rider owes the save for being laid prone, not for lying prone", () => {
  assert.equal(riderKnockedProne(false, true), true);
  assert.equal(riderKnockedProne(true, true), false);
  assert.equal(riderKnockedProne(true, false), false);
  assert.equal(riderKnockedProne(false, false), false);
  // The save already made for this prone is not asked again.
  assert.equal(riderKnockedProne(false, true, true), false);
});

test("a mount describes itself with what matters at the table", () => {
  const line = describeMount(checkMount({ ref: "warhorse", riderSize: "medium" }).state);
  assert.match(line, /Warhorse/);
  assert.match(line, /60 ft/);
  assert.match(line, /shares your initiative/);
});

test("a vehicle is findable, and every one has a crew and a capacity", () => {
  assert.equal(vehicleProfile("longship").crew, 40);
  assert.equal(vehicleProfile("Sailing ship").slug, "sailing-ship");
  assert.equal(vehicleProfile("submarine"), null);
  for (const vehicle of VEHICLES) {
    assert.ok(vehicle.mph > 0);
    assert.ok(vehicle.capacity > 0);
  }
});

test("a fully crewed vessel makes its speed", () => {
  const trip = vehicleTravel(vehicleProfile("longship"), 8, 40);
  assert.equal(trip.miles, 24);
  assert.match(trip.note, /fully crewed/);
});

test("undercrewed is slower, and says so rather than refusing", () => {
  const half = vehicleTravel(vehicleProfile("longship"), 8, 20);
  assert.equal(half.miles, 18);
  assert.match(half.note, /undercrewed/);
  const skeleton = vehicleTravel(vehicleProfile("longship"), 8, 5);
  assert.equal(skeleton.miles, 12);
});

console.log(`mounts: ${passed} tests passed`);
