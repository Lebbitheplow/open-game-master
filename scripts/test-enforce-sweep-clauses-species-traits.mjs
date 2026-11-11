// The clause ledger's probes for what a lineage's trait lines do at the
// table, the nine SRD lineages and their subraces: each trait of
// src/lib/srd/races.json run through a hero the sheet door made of that
// lineage (so the trait reaches the engine from the row, not from a feature
// a test wrote), by the tools a table uses. The later lineages' traits are in
// scripts/test-enforce-sweep-clauses-species-traits-more.mjs.
//
// scripts/clauses/species.json names each probe, "species.<id>.<trait>".
import fs from "node:fs";
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";
import { castsByNature, plain, same, walkTo } from "./lib/sweep-clauses-species-rig.mjs";

const rig = await clauseRig();
const RACES = JSON.parse(fs.readFileSync(new URL("../src/lib/srd/races.json", import.meta.url), "utf8")).races;
const rowOf = (id) => RACES.find((row) => row.id === id);
const holds = (row, trait) => row.traits.some((line) => line.toLowerCase().includes(trait));
const pb = (level) => 2 + Math.floor((level - 1) / 4);

const P = {};
for (const row of RACES) {
  const of = (build = {}) => ({ class: "fighter", level: 5, race: row.id, equipment: [], ...build });

  // SRD 5.1, Stonecunning: "Whenever you make an Intelligence (History) check
  // related to the origin of stonework, you are considered proficient in the
  // History skill and add double your proficiency bonus to the check".
  if (holds(row, "stonecunning")) {
    P[`species.${row.id}.stonecunning`] = async () => {
      const t = await rig.table();
      const who = t.hero(of());
      const stone = await t.roll(who, { kind: "skill_check", skill: "history", about: "stonework" }, [10]);
      const court = await t.roll(who, { kind: "skill_check", skill: "history" }, [10]);
      same([stone.ok, court.ok], [true, true], stone.error ?? court.error);
      assert.equal(stone.total - court.total, 2 * pb(5), `${row.name}: History on stonework over a plain History check`);
    };
  }

  // SRD 5.1, Fey Ancestry: "magic can't put you to sleep". The elves' line
  // says so in its brackets; the half-elf's is the bare name.
  const putToSleep = async () => {
    const t = await rig.table();
    const who = t.hero(of());
    const slept = await t.condition(who, "unconscious", { rounds: 3, magical: true, reason: "a sleep spell" });
    const clubbed = await t.condition(who, "unconscious", { rounds: 3, reason: "a blow to the head" });
    same([slept.ok, clubbed.ok, t.has(who, "unconscious")], [false, true, true], `${row.name}: put to sleep by magic, then knocked out by none`);
  };
  if (holds(row, "immune to magical sleep")) {
    P[`species.${row.id}.sleep`] = putToSleep;
  }
  // The half-elf's line is the bare name: both halves of Fey Ancestry
  // ("advantage on saving throws against being charmed, and magic can't put
  // you to sleep").
  if (row.traits.includes("Fey Ancestry")) {
    P[`species.${row.id}.fey`] = async () => {
      await putToSleep();
      const t = await rig.table();
      const who = t.hero(of());
      const charm = await t.roll(who, { kind: "saving_throw", ability: "wis", dc: 10, against: "charmed" }, [15, 3]);
      const other = await t.roll(who, { kind: "saving_throw", ability: "wis", dc: 10 }, [15, 3]);
      same([charm.faces.length, other.faces.length], [2, 1], `${row.name}: d20s on a save against a charm, and on a plain save`);
    };
  }

  // SRD 5.1, Trance: "Elves don't need to sleep. Instead, they meditate
  // deeply, remaining semiconscious, for 4 hours a day." A long rest puts
  // the sleepers under, and asleep nobody concentrates; the elf never
  // sleeps, so the spell they hold is still held in the morning.
  if (holds(row, "trance")) {
    P[`species.${row.id}.trance`] = async () => {
      const t = await rig.table();
      const elf = t.hero(of());
      const human = t.hero(plain());
      for (const who of [elf, human]) t.patch(who, { concentratingOn: "Hex" });
      const rest = await t.rest("long");
      assert.equal(rest.ok, true, rest.error);
      same([t.sheet(elf).concentratingOn ?? null, t.sheet(human).concentratingOn ?? null], ["Hex", null], `${row.name}: the spell held through a night's rest, by the elf and by a human who slept`);
    };
  }

  // The spells a lineage casts by nature (the row's innateSpells, named by
  // its trait line): the cantrip at will from 1st level, each levelled spell
  // once a long rest from the level its row names, with no slot.
  if (row.innateSpells && !/genasi|firbolg/.test(row.id)) {
    P[`species.${row.id}.innate`] = () => castsByNature(rig, row);
  }

  if (holds(row, "sunlight sensitivity")) {
    P[`species.${row.id}.sunlight`] = async () => {
      const { getDatabase } = await import("../src/lib/db/core.ts");
      const { getClock, setClock } = await import("../src/lib/db/clock.ts");
      const { breakDown } = await import("../src/lib/dm/calendar.ts");
      const t = await rig.table();
      const who = t.hero(of({ equipment: [{ name: "Longsword", equipped: true }] }));
      const [foe] = await t.fight([who]);
      const noon = (outdoors) => {
        getDatabase().prepare("UPDATE battle_maps SET outdoors = ?, ambient = 'bright' WHERE id = ?").run(outdoors ? 1 : 0, t.kit.map().id);
        const clock = getClock(t.world.campaignId);
        let instant = clock.instant;
        while (breakDown(clock.calendar, instant).hour !== 12) instant += 60;
        setClock(t.world.campaignId, { ...clock, instant, weather: null });
      };
      const d20s = async () => {
        t.kit.freshTurn();
        const swing = await t.swing(who, foe, [15, 3, 4], { weapon: "Longsword" });
        const look = await t.roll(who, { kind: "skill_check", skill: "perception" }, [5, 15]);
        return [swing.toHit?.breakdown.terms.find((term) => term.sides === 20)?.dice.length, look.faces.length];
      };
      noon(true);
      const sunlit = await d20s();
      noon(false);
      const indoors = await d20s();
      same([sunlit, indoors], [[2, 2], [1, 1]], `${row.name}: d20s on an attack and on Perception, in direct sunlight and under a roof`);
    };
  }

  // SRD 5.1, Halfling Nimbleness: "You can move through the space of any
  // creature that is of a size larger than yours."
  if (holds(row, "halfling nimbleness")) {
    P[`species.${row.id}.nimbleness`] = async () => {
      const t = await rig.table();
      const who = t.hero(of());
      const tall = t.hero(plain());
      const through = async (mover) => {
        const [foe] = await t.fight([mover]);
        const walls = [];
        for (let x = 0; x < 20; x += 1) walls.push([x, 1, "#"], [x, 3, "#"]);
        t.kit.openField(walls);
        t.kit.place(mover.id, 2, 2);
        t.kit.place(mover.id === who.id ? tall.id : who.id, 18, 10);
        t.kit.setEnemy(foe.id, { stats: { size: "Medium" } });
        t.kit.place(foe.id, 4, 2);
        return (await walkTo(t, mover, 5, 2)).status;
      };
      const nimble = await through(who);
      const blocked = await through(tall);
      same([nimble, blocked >= 400], [200, true], `${row.name}: through a Medium hostile's space, and a human at the same door`);
    };
  }

  // Lightfoot: "You can attempt to hide even when you are obscured only by a
  // creature that is at least one size larger than you."
  if (holds(row, "naturally stealthy")) {
    P[`species.${row.id}.stealthy`] = async () => {
      const t = await rig.table();
      const who = t.hero(of({ class: "rogue", level: 3 }));
      const wall = t.hero(plain());
      const [foe] = await t.fight([who, wall]);
      t.kit.place(foe.id, 2, 2);
      t.kit.place(who.id, 6, 2);
      t.kit.place(wall.id, 12, 12);
      const open = await t.act(who, "hide", {}, [12]);
      t.kit.place(wall.id, 4, 2);
      t.kit.freshTurn();
      const screened = await t.act(who, "hide", {}, [12]);
      same([open.ok, screened.ok], [false, true], `${row.name}: hiding in plain sight, then behind a Medium friend (${screened.error ?? ""})`);
    };
  }

  // SRD 5.1, Gnome Cunning: "advantage on all Intelligence, Wisdom, and
  // Charisma saving throws against magic."
  if (holds(row, "gnome cunning")) {
    P[`species.${row.id}.cunning`] = async () => {
      const t = await rig.table();
      const who = t.hero(of());
      const faces = {};
      for (const ability of ["int", "wis", "cha", "dex"]) {
        faces[ability] = (await t.roll(who, { kind: "saving_throw", ability, dc: 10, magical: true }, [15, 3])).faces.length;
      }
      faces.mundane = (await t.roll(who, { kind: "saving_throw", ability: "wis", dc: 10, magical: false }, [15, 3])).faces.length;
      same(faces, { int: 2, wis: 2, cha: 2, dex: 1, mundane: 1 }, `${row.name}: d20s on a save against magic by ability, and on a Wisdom save against none`);
    };
  }
  if (holds(row, "artificer's lore")) {
    P[`species.${row.id}.lore`] = async () => {
      const t = await rig.table();
      const who = t.hero(of());
      const wand = await t.roll(who, { kind: "skill_check", skill: "history", about: "devices" }, [10]);
      const king = await t.roll(who, { kind: "skill_check", skill: "history" }, [10]);
      assert.equal(wand.total - king.total, 2 * pb(5), `${row.name}: History on a magic item over a plain History check`);
    };
  }
  if (holds(row, "stone camouflage")) {
    P[`species.${row.id}.camouflage`] = async () => {
      const t = await rig.table();
      const who = t.hero(of());
      const rocks = await t.roll(who, { kind: "skill_check", skill: "stealth", about: "rocky_terrain" }, [10, 4]);
      const street = await t.roll(who, { kind: "skill_check", skill: "stealth" }, [10, 4]);
      same([rocks.faces.length, street.faces.length], [2, 1], `${row.name}: d20s on Stealth among rocks, and in a street`);
    };
  }

  // SRD 5.1, Relentless Endurance: "When you are reduced to 0 hit points but
  // not killed outright, you can drop to 1 hit point instead. You can't use
  // this feature again until you finish a long rest."
  if (holds(row, "relentless endurance")) {
    P[`species.${row.id}.relentless`] = async () => {
      const t = await rig.table();
      const who = t.hero(of());
      t.patch(who, { currentHp: 5 });
      await t.damage(who, 9);
      const held = [t.sheet(who).currentHp, t.used(who, "relentless_endurance")];
      await t.damage(who, 9);
      same([held, t.sheet(who).currentHp], [[1, 1], 0], `${row.name}: dropped once (hit points, uses spent), then again`);
    };
  }
  // SRD 5.1, Savage Attacks: "When you score a critical hit with a melee
  // weapon attack, you can roll one of the weapon's damage dice one
  // additional time and add it to the extra damage of the critical hit."
  if (holds(row, "savage attacks")) {
    P[`species.${row.id}.savage`] = async () => {
      const t = await rig.table();
      const who = t.hero(of({ equipment: [{ name: "Greataxe", equipped: true }] }));
      const [foe] = await t.fight([who]);
      const d12s = (swing) => swing.damage?.breakdown.terms.filter((term) => term.sides === 12).reduce((sum, term) => sum + term.dice.length, 0);
      const crit = await t.swing(who, foe, [20, 2, 3, 4], { weapon: "Greataxe" });
      const hit = await t.swing(who, foe, [15, 2], { weapon: "Greataxe" });
      same([d12s(crit), d12s(hit)], [3, 1], `${row.name}: d12s on a greataxe's critical hit, and on a plain hit`);
    };
  }
}

// The probes above by name, for the ledger's probe check (it finds a probe
// by its name in this file); the run holds the table to the list.
const NAMES = [
  "species.hill_dwarf.stonecunning", "species.mountain_dwarf.stonecunning",
  "species.high_elf.sleep", "species.wood_elf.sleep", "species.drow.sleep", "species.half_elf.fey",
  "species.high_elf.trance", "species.wood_elf.trance", "species.drow.trance",
  "species.drow.innate", "species.forest_gnome.innate", "species.tiefling.innate", "species.aasimar.innate", "species.drow.sunlight",
  "species.lightfoot_halfling.nimbleness", "species.stout_halfling.nimbleness", "species.lightfoot_halfling.stealthy",
  "species.rock_gnome.cunning", "species.forest_gnome.cunning", "species.deep_gnome.cunning", "species.rock_gnome.lore", "species.deep_gnome.camouflage",
  "species.half_orc.relentless", "species.half_orc.savage",
];
assert.deepEqual(Object.keys(P).sort(), [...NAMES].sort(), "the table makes other probes than NAMES lists: a row of races.json was added or changed");
assert.ok(rowOf("human"), "races.json lost the human");

await runOrSurvey("scripts/test-enforce-sweep-clauses-species-traits.mjs", P);
