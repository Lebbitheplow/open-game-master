// The clause ledger's probes for what a lineage's trait lines do at the
// table, the lineages after the SRD nine (aasimar to orc): each trait of
// src/lib/srd/races.json run through a hero the sheet door made of that
// lineage, by the tools a table uses. The SRD lineages' traits are in
// scripts/test-enforce-sweep-clauses-species-traits.mjs.
//
// scripts/clauses/species.json names each probe, "species.<id>.<trait>".
import fs from "node:fs";
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";
import { castsByNature, plain, same, walkTo } from "./lib/sweep-clauses-species-rig.mjs";

const rig = await clauseRig();
const RACES = JSON.parse(fs.readFileSync(new URL("../src/lib/srd/races.json", import.meta.url), "utf8")).races;
const holds = (row, trait) => row.traits.some((line) => line.toLowerCase().startsWith(trait));

const P = {};
for (const row of RACES) {
  const of = (build = {}) => ({ class: "fighter", level: 5, race: row.id, equipment: [], ...build });
  const probe = (name, fn) => {
    P[`species.${row.id}.${name}`] = fn;
  };

  if (row.innateSpells && /genasi|firbolg/.test(row.id)) {
    // Firbolg Magic's two spells come back on a short rest, each on its own.
    probe("innate", () => castsByNature(rig, row, { rest: row.id === "firbolg" ? "short" : "long" }));
  }

  if (holds(row, "healing hands")) {
    probe("healing-hands", async () => {
      const t = await rig.table();
      const who = t.hero(of());
      const friend = t.hero(plain());
      await t.fight([who, friend]);
      t.patch(friend, { currentHp: 10 });
      // Proficiency +3 at 5th level: three d4s.
      const first = await t.use(who, "Healing Hands", { targetCharacterId: friend.id }, [2, 3, 4]);
      const healed = t.sheet(friend).currentHp - 10;
      const again = await t.use(who, "Healing Hands", { targetCharacterId: friend.id }, [2, 3, 4]);
      same([first.ok, healed, t.budget()?.actionUsed, t.used(who, "race_healing_hands"), again.ok], [true, 9, true, 1, false], `${row.name}: Healing Hands on a friend, then again (${first.error ?? ""})`);
    });
  }
  if (holds(row, "tinker")) {
    // An hour and 10 gp a device, three working at a time, each stopping 24
    // hours after it was made or repaired; dismantled, its 10 gp come back.
    probe("tinker", async () => {
      const { advanceClock, getClock } = await import("../src/lib/db/clock.ts");
      const t = await rig.table();
      const who = t.hero(of({ equipment: [{ name: "Tinker's Tools", qty: 1 }] }));
      t.patch(who, { gold: 100, copper: 0 });
      const now = () => getClock(t.world.campaignId).instant;
      const devices = () => t.sheet(who).equipment.filter((item) => typeof item.madeAt === "number").map((item) => item.name);
      const start = now();
      const made = [];
      for (const device of ["Clockwork Toy", "Music Box", "Fire Starter"]) made.push((await t.use(who, "Tinker", { variant: device })).ok);
      const fourth = await t.use(who, "Tinker", { variant: "Clockwork Toy" });
      same([made, fourth.ok, devices().length, t.sheet(who).gold, now() - start], [[true, true, true], false, 3, 70, 180], `${row.name}: three devices made, the fourth refused (${fourth.error ?? ""})`);
      advanceClock(t.world.campaignId, 24, "hours");
      const after = await t.use(who, "Tinker", { variant: "Clockwork Toy" });
      const repaired = await t.use(who, "Tinker", { variant: "repair music box" });
      const third = await t.use(who, "Tinker", { variant: "Fire Starter" });
      const over = await t.use(who, "Tinker", { variant: "repair fire starter" });
      same([after.ok, repaired.ok, third.ok, over.ok, devices().length], [true, true, true, false, 5], `${row.name}: the three stopped after 24 hours, so three more work, the fourth repair refused (${over.error ?? ""})`);
      const gold = t.sheet(who).gold;
      const taken = await t.use(who, "Tinker", { variant: "dismantle clockwork toy" });
      same([taken.ok, t.sheet(who).gold - gold, devices().length], [true, 10, 4], `${row.name}: a device dismantled gives its 10 gp back`);
    });
  }
  if (holds(row, "celestial revelation")) {
    probe("revelation", async () => {
      const { flyingSpeedOf } = await import("../src/lib/battlemap/types.ts");
      const flyingSpeedFor = (sheet) => flyingSpeedOf({ features: sheet.features, conditions: sheet.conditions, walkingFeet: sheet.speed });
      const t = await rig.table();
      const young = t.hero(of({ level: 2 }));
      const who = t.hero(of({ equipment: [{ name: "Longsword", equipped: true }], abilities: { cha: 14 } }));
      const [foe, far] = await t.fight([who], { foes: 2 });
      const grounded = flyingSpeedFor(t.sheet(who));
      const bare = await t.use(who, "Celestial Revelation");
      const shroud = await t.use(who, "Celestial Revelation", { variant: "necrotic shroud" }, [2, 2]);
      // The hit adds the proficiency bonus (3) once a turn: 1d8+3+3, then 1d8+3.
      const first = await t.swing(who, foe, [15, 4], { weapon: "Longsword" });
      const second = await t.swing(who, foe, [15, 4], { weapon: "Longsword" });
      const again = await t.use(who, "Celestial Revelation", { variant: "heavenly wings" });
      same(
        {
          atSecondLevel: t.max(young, "race_celestial_revelation"), grounded, bare: bare.ok, shroud: shroud.ok, bonusUsed: t.budget()?.bonusUsed,
          held: t.has(who, "celestial revelation: necrotic shroud"), near: t.foeHas(foe, "frightened"), far: t.foeHas(far, "frightened"),
          damage: [first.damage?.total, second.damage?.total], again: again.ok,
        },
        { atSecondLevel: null, grounded: null, bare: false, shroud: true, bonusUsed: true, held: true, near: true, far: false, damage: [10, 7], again: false },
        `${row.name}: the revelation before 3rd level, unnamed, as a shroud (saves, the once-a-turn damage), then a second with none left (${shroud.error ?? ""})`,
      );
      await otherForms();
    });
    const otherForms = async () => {
      const { flyingSpeedOf } = await import("../src/lib/battlemap/types.ts");
      const flyingSpeedFor = (sheet) => flyingSpeedOf({ features: sheet.features, conditions: sheet.conditions, walkingFeet: sheet.speed });
      const t = await rig.table();
      const winged = t.hero(of());
      await t.fight([winged]);
      const wings = await t.use(winged, "Celestial Revelation", { variant: "heavenly wings" });
      const aloft = flyingSpeedFor(t.sheet(winged));
      await t.kit.endFight();
      const bright = t.hero(of());
      const [foe, far] = await t.fight([bright], { foes: 2, hp: 100 });
      const radiance = await t.use(bright, "Celestial Revelation", { variant: "inner radiance" });
      await t.endTurn(bright);
      same(
        [wings.ok, aloft, radiance.ok, 100 - t.enemy(foe).currentHp, 100 - t.enemy(far).currentHp],
        [true, 30, true, 3, 0],
        `${row.name}: Heavenly Wings' flying speed, and Inner Radiance's burn at the end of the turn on the foe beside them and the one 60 feet off (${wings.error ?? radiance.error ?? ""})`,
      );
    };
  }
  if (holds(row, "stone's endurance")) {
    probe("stones-endurance", async () => {
      const t = await rig.table();
      const who = t.hero(of());
      const [foe] = await t.fight([who]);
      t.foesTurn(foe);
      await t.strike(foe, who);
      const hurt = t.sheet(who).currentHp;
      // 1d12 (5) + Constitution (+2) off a blow of 6.
      const out = await t.invoke("use_reaction", { characterId: who.id, feature: "Stone's Endurance" }, [5]);
      const again = await t.invoke("use_reaction", { characterId: who.id, feature: "Stone's Endurance" }, [5]);
      same([80 - hurt, out.ok, t.sheet(who).currentHp, t.used(who, "race_stones_endurance"), again.ok], [6, true, 80, 1, false], `${row.name}: a blow of 6 answered with Stone's Endurance, then a second answer (${out.error ?? ""})`);
    });
  }
  if (holds(row, "powerful build")) {
    probe("powerful-build", async () => {
      const { liftLimits } = await import("../src/lib/dm/load-rules.ts");
      const t = await rig.table();
      const who = t.hero(of({ abilities: { str: 16 } }));
      const other = t.hero(plain({ abilities: { str: 16 } }));
      // Strength times 15 and 30 for a human; twice that for one size larger.
      const [mine, theirs] = [t.sheet(who).abilities.str, t.sheet(other).abilities.str];
      same([liftLimits(t.sheet(who)), liftLimits(t.sheet(other))], [{ capacityLb: mine * 30, liftLb: mine * 60 }, { capacityLb: theirs * 15, liftLb: theirs * 30 }], `${row.name}: carrying capacity and push, drag or lift, beside a human's`);
    });
  }
  if (holds(row, "mountain born")) {
    probe("mountain-born", async () => {
      const t = await rig.table();
      const who = t.hero(of());
      const other = t.hero(plain());
      const cold = await t.invoke("apply_hazard", { type: "extreme_cold", hours: 3, characterIds: [who.id, other.id] }, [2, 2, 2]);
      same([cold.ok, t.sheet(who).exhaustion ?? 0, t.sheet(other).exhaustion ?? 0], [true, 0, 3], `${row.name}: three hours of extreme cold, beside a human who fails each save (${cold.error ?? ""})`);
    });
  }
  if (holds(row, "hidden step")) {
    probe("hidden-step", async () => {
      const t = await rig.table();
      const who = t.hero(of());
      await t.fight([who]);
      const out = await t.use(who, "Hidden Step");
      const seen = [out.ok, t.has(who, "invisible"), t.budget()?.bonusUsed, t.used(who, "race_hidden_step")];
      t.freshTurn();
      const again = await t.use(who, "Hidden Step");
      await t.kit.endFight();
      await t.rest("short");
      same([seen, again.ok, t.used(who, "race_hidden_step")], [[true, true, true, 1], false, 0], `${row.name}: Hidden Step, a second with none left, and the use after a short rest (${out.error ?? ""})`);
    });
  }
  if (holds(row, "feline agility")) {
    probe("feline-agility", async () => {
      const t = await rig.table();
      const who = t.hero(of());
      await t.fight([who]);
      t.kit.openField();
      t.kit.place(who.id, 2, 10);
      const far = await walkTo(t, who, 13, 10);
      const used = await t.use(who, "Feline Agility");
      const swift = await walkTo(t, who, 13, 10);
      const spent = [t.budget()?.actionUsed ?? false, t.budget()?.bonusUsed ?? false, t.used(who, "race_feline_agility")];
      // The next turn they move, so it stays spent; the one after they stand still.
      await t.endTurn(who);
      const afterRun = t.used(who, "race_feline_agility");
      t.kit.handOnEnemies();
      const moved = await walkTo(t, who, 12, 10);
      const early = await t.use(who, "Feline Agility");
      await t.endTurn(who);
      const still = t.used(who, "race_feline_agility");
      t.kit.handOnEnemies();
      await t.endTurn(who);
      same(
        [far.status >= 400, used.ok, swift.status, spent, afterRun, moved.status, early.ok, still, t.used(who, "race_feline_agility")],
        [true, true, 200, [false, false, 1], 1, 200, false, 1, 0],
        `${row.name}: 55 feet at speed 30, then with Feline Agility; the use after a turn of moving and after a turn of standing still (${used.error ?? ""}${moved.body?.error ?? ""})`,
      );
    });
  }
  const speedsOf = async (t) => {
    const { moveTraitsFrom } = await import("../src/lib/battlemap/types.ts");
    const mine = moveTraitsFrom(t.sheet(t.hero(of())).features);
    const others = moveTraitsFrom(t.sheet(t.hero(plain())).features);
    const want = { swims: /swim speed/i.test(row.traits.join(" ")), climbs: /climb speed/i.test(row.traits.join(" ")) };
    same([{ swims: mine.swims, climbs: mine.climbs }, { swims: others.swims, climbs: others.climbs }], [want, { swims: false, climbs: false }], `${row.name}: water and walls at normal cost on the board, beside a human`);
  };
  if (row.traits.some((line) => /^\d+ ft (swim|climb) speed$/i.test(line))) {
    probe("speeds", async () => speedsOf(await rig.table()));
  }
  const natural = row.traits.map((line) => /^(.+?)\s*\((?:[^()]*?,\s*)?(\d+d\d+)\s+([a-z]+)\s+unarmed strike\)/i.exec(line)).find(Boolean);
  if (natural) {
    probe("natural-weapon", async () => {
      const t = await rig.table();
      const who = t.hero(of());
      const [foe] = await t.fight([who]);
      const name = natural[1].replace(/^[a-z]+'s\s+/i, "").toLowerCase();
      const swing = await t.swing(who, foe, [15, 2], { weapon: name });
      same([swing.ok, swing.damage?.expression.startsWith(natural[2]), swing.result.damageType ?? natural[3]], [true, true, natural[3]], `${row.name}: a strike with the ${name}: ${swing.error ?? swing.damage?.expression}`);
      // "Cat's Claws (20 ft climb speed, ...)": the same line gives the climb.
      if (/climb speed/i.test(natural[0])) await speedsOf(t);
    });
  }
  if (holds(row, "expert forgery")) {
    probe("forgery", async () => {
      const t = await rig.table();
      const who = t.hero(of());
      const copy = await t.roll(who, { kind: "ability_check", ability: "dex", about: "forgery" }, [10, 4]);
      const other = await t.roll(who, { kind: "ability_check", ability: "dex" }, [10, 4]);
      same([copy.ok, copy.faces.length, other.faces.length], [true, 2, 1], `${row.name}: d20s on a check to copy a seal, and on a plain Dexterity check (${copy.error ?? ""})`);
    });
  }
  if (holds(row, "natural armor")) {
    probe("natural-armor", async () => {
      const t = await rig.table();
      const dex = /\+ DEX/.test(row.traits.find((line) => line.startsWith("Natural Armor")));
      const base = Number(/AC (\d+)/.exec(row.traits.find((line) => line.startsWith("Natural Armor")))[1]);
      const bare = t.hero(of());
      const shield = t.hero(of({ equipment: [{ name: "Shield", equipped: true }] }));
      const leather = t.hero(of({ equipment: [{ name: "Leather", equipped: true }] }));
      const plate = t.hero(of({ equipment: [{ name: "Plate", equipped: true }] }));
      // Dexterity 14 (+2), and the lineage's own increase to it if any.
      const mod = Math.floor((t.sheet(bare).abilities.dex - 10) / 2);
      const own = base + (dex ? mod : 0);
      same([t.ac(bare), t.ac(shield), t.ac(leather), t.ac(plate)], [own, own + 2, own, 18], `${row.name}: armor class bare, behind a shield, in leather (the hide is better) and in plate (the plate is)`);
    });
  }
  if (holds(row, "shell defense")) {
    probe("shell-defense", async () => {
      const t = await rig.table();
      const who = t.hero(of());
      await t.fight([who]);
      const before = t.ac(who);
      const out = await t.use(who, "Shell Defense");
      const inside = { ok: out.ok, action: t.budget()?.actionUsed, ac: t.ac(who) - before, prone: t.has(who, "prone"), speed: t.derived(who).speed ?? null };
      const saves = {};
      for (const ability of ["str", "con", "dex", "wis"]) {
        saves[ability] = (await t.roll(who, { kind: "saving_throw", ability, dc: 10 }, [15, 3])).faces.length;
      }
      const walk = await walkTo(t, who, 5, 7);
      t.freshTurn();
      const strike = await t.act(who, "dodge");
      const emerge = await t.use(who, "Shell Defense", { variant: "emerge" });
      same(
        [inside.ok, inside.action, inside.ac, inside.prone, saves, walk.status >= 400, strike.ok, emerge.ok, t.budget()?.bonusUsed, t.ac(who) - before, t.has(who, "prone")],
        [true, true, 4, true, { str: 2, con: 2, dex: 2, wis: 1 }, true, false, true, true, 0, false],
        `${row.name}: withdrawn (the action, +4 AC, prone, the saves, no walk, no action), then out with a bonus action (${out.error ?? emerge.error ?? ""})`,
      );
    });
  }
  if (holds(row, "hold breath") || holds(row, "unending breath") || holds(row, "amphibious")) {
    probe("breath", async () => {
      const t = await rig.table();
      const who = t.hero(of());
      const other = t.hero(plain());
      const air = async (type, rounds) => (await t.invoke("apply_hazard", { type, roundsWithoutAir: rounds, characterIds: [who.id, other.id] })).result?.results ?? [];
      const held = (await air("suffocation", 0)).map((entry) => entry.holdBreathMinutes ?? entry.immune);
      const minutes = /up to 1 hour/.test(row.traits.join(" ")) ? 60 : /up to 15 minutes/.test(row.traits.join(" ")) ? 15 : null;
      if (minutes) {
        // Constitution 14 and the lineage's increase: a human holds 1 + 2 or 3 minutes.
        same([held[0], held[1] < 5], [minutes, true], `${row.name}: minutes the breath holds, beside a human's ${held[1]}`);
        return;
      }
      const drowned = await air("drowning", 20);
      const hp = [t.sheet(who).currentHp > 0, t.sheet(other).currentHp > 0];
      t.patch(other, { currentHp: 80, conditions: [], deathSaves: null });
      const smothered = holds(row, "amphibious") ? (await air("suffocation", 20), t.sheet(who).currentHp > 0) : true;
      same([typeof held[0], drowned[0]?.dropped, hp, smothered], [holds(row, "amphibious") ? "number" : "string", false, [true, false], !holds(row, "amphibious")], `${row.name}: twenty rounds under water beside a human, and (for one who only breathes water) twenty with no air at all`);
    });
  }
  if (holds(row, "earth walk")) {
    probe("earth-walk", async () => {
      const { getDatabase } = await import("../src/lib/db/core.ts");
      const t = await rig.table();
      const who = t.hero(of());
      const other = t.hero(plain());
      const cost = async (mover, theme) => {
        await t.fight([mover]);
        // Rubble from (3,10) to (6,10), walked end to end.
        const walls = [];
        for (let x = 0; x < 20; x += 1) walls.push([x, 9, "#"], [x, 11, "#"]);
        t.kit.openField([...walls, [3, 10, ","], [4, 10, ","], [5, 10, ","], [6, 10, ","]]);
        getDatabase().prepare("UPDATE battle_maps SET theme = ? WHERE id = ?").run(theme, t.kit.map().id);
        t.kit.place(mover.id, 2, 10);
        t.kit.place(mover.id === who.id ? other.id : who.id, 18, 2);
        const walk = await walkTo(t, mover, 6, 10);
        return walk.status === 200 ? t.kit.token(mover.id).movedThisRound : walk.status;
      };
      same([await cost(who, "cave"), await cost(other, "cave"), await cost(who, "forest")], [4, 400, 400], `${row.name}: four squares of a cave's rubble (20 feet), a human on the same (40 feet, past their 30), and a forest's undergrowth (the same 40)`);
    });
  }
  if (holds(row, "shapechanger")) {
    probe("shapechanger", async () => {
      const t = await rig.table();
      const who = t.hero(of());
      await t.fight([who]);
      const changed = await t.use(who, "Shapechanger");
      const mid = [changed.ok, t.budget()?.actionUsed, t.has(who, "shapechanged")];
      const again = await t.use(who, "Shapechanger");
      const back = await t.use(who, "Shapechanger", { variant: "revert" });
      same([mid, again.ok, back.ok, t.has(who, "shapechanged"), t.budget()?.bonusUsed], [[true, true, true], false, true, false, false], `${row.name}: a new face (the action), a second with the action gone, and their own back at no cost (${changed.error ?? back.error ?? ""})`);
    });
  }
  if (holds(row, "integrated protection")) {
    probe("integrated-protection", async () => {
      const t = await rig.table();
      const bare = t.hero(of());
      const mailed = t.hero(of({ equipment: [{ name: "Chain Mail", equipped: true }] }));
      const mod = Math.floor((t.sheet(bare).abilities.dex - 10) / 2);
      same([t.ac(bare), t.ac(mailed)], [10 + mod + 1, 16 + 1], `${row.name}: armor class bare and in chain mail, each one higher`);
    });
  }
  if (holds(row, "sentry's rest")) {
    probe("sentrys-rest", async () => {
      const t = await rig.table();
      const who = t.hero(of());
      const human = t.hero(plain());
      for (const sheet of [who, human]) t.patch(sheet, { concentratingOn: "Hex" });
      const rest = await t.rest("long");
      same([rest.ok, t.sheet(who).concentratingOn ?? null, t.sheet(human).concentratingOn ?? null], [true, "Hex", null], `${row.name}: the spell held through a night's rest, by the sentry and by a human who slept (${rest.error ?? ""})`);
    });
  }
  if (holds(row, "fury of the small")) {
    probe("fury", async () => {
      const t = await rig.table();
      const who = t.hero(of({ equipment: [{ name: "Shortsword", equipped: true }] }));
      const [foe] = await t.fight([who], { foes: 1, hp: 100 });
      const early = await t.use(who, "Fury of the Small", { targetEnemyId: foe.id });
      await t.swing(who, foe, [15, 2], { weapon: "Shortsword" });
      const hp = t.enemy(foe).currentHp;
      const out = await t.use(who, "Fury of the Small", { targetEnemyId: foe.id });
      const dealt = hp - t.enemy(foe).currentHp;
      await t.kit.endFight();
      await t.rest("short");
      await t.fight([who], { foes: 1, hp: 100, foe: { size: "Small" } });
      const [small] = t.world.enemies();
      await t.swing(who, small, [15, 2], { weapon: "Shortsword" });
      const level = await t.use(who, "Fury of the Small", { targetEnemyId: small.id });
      same([early.ok, out.ok, dealt, level.ok], [false, true, 5, false], `${row.name}: before a hit, after one on a Medium creature (the level, 5), and on a creature its own size (${out.error ?? ""})`);
    });
  }
  if (holds(row, "nimble escape")) {
    probe("nimble-escape", async () => {
      const t = await rig.table();
      const who = t.hero(of());
      await t.fight([who]);
      const away = await t.act(who, "disengage", { bonus: true });
      const spent = [away.ok, t.budget()?.bonusUsed, t.budget()?.actionUsed];
      t.freshTurn();
      const dash = await t.act(who, "dash", { bonus: true });
      same([spent, dash.ok], [[true, true, false], false], `${row.name}: Disengage as a bonus action, and a Dash asked the same way (${away.error ?? ""})`);
    });
  }
  if (holds(row, "long-limbed")) {
    probe("long-limbed", async () => {
      const t = await rig.table();
      const who = t.hero(of({ equipment: [{ name: "Longsword", equipped: true }] }));
      const other = t.hero(plain({ equipment: [{ name: "Longsword", equipped: true }] }));
      const reach = async (mover) => {
        const [foe] = await t.fight([mover]);
        t.kit.place(foe.id, 7, 5);
        return (await t.swing(mover, foe, [15, 4], { weapon: "Longsword" })).ok;
      };
      same([await reach(who), await reach(other)], [true, false], `${row.name}: a longsword at a creature 10 feet away on their own turn, and a human's`);
    });
  }
  if (holds(row, "surprise attack")) {
    probe("surprise-attack", async () => {
      const { saveEncounter } = await import("../src/lib/db/encounters.ts");
      const t = await rig.table();
      const who = t.hero(of({ equipment: [{ name: "Longsword", equipped: true }] }));
      const [foe] = await t.fight([who], { hp: 200 });
      const d6s = (swing) => swing.damage?.breakdown.terms.filter((term) => term.sides === 6).reduce((sum, term) => sum + term.dice.length, 0) ?? null;
      saveEncounter({ ...t.world.encounter(), round: 1, surprisedIds: [foe.id] });
      const first = await t.swing(who, foe, [15, 4, 3, 3], { weapon: "Longsword" });
      const second = await t.swing(who, foe, [15, 4, 3, 3], { weapon: "Longsword" });
      saveEncounter({ ...t.world.encounter(), round: 2, turnBudget: null });
      const later = await t.swing(who, foe, [15, 4, 3, 3], { weapon: "Longsword" });
      same([first.ok, d6s(first), d6s(second), d6s(later)], [true, 2, 0, 0], `${row.name}: d6s on a hit against a surprised creature in the first round, on a second hit of that turn, and in the second round (${first.error ?? ""})`);
    });
  }
  if (holds(row, "hungry jaws")) {
    probe("hungry-jaws", async () => {
      const t = await rig.table();
      const who = t.hero(of());
      const [foe] = await t.fight([who]);
      const con = Math.floor((t.sheet(who).abilities.con - 10) / 2);
      const jaws = await t.swing(who, foe, [15, 4], { weapon: "bite", bonusAttack: "feature" });
      const seen = [jaws.ok, t.sheet(who).tempHp, t.used(who, "race_hungry_jaws"), t.budget()?.bonusUsed];
      t.freshTurn();
      const again = await t.swing(who, foe, [15, 4], { weapon: "bite", bonusAttack: "feature" });
      same([seen, again.ok], [[true, con, 1, true], false], `${row.name}: the bonus-action bite's temporary hit points, and a second with no use left (${jaws.error ?? ""})`);
    });
  }
  if (holds(row, "aggressive")) {
    probe("aggressive", async () => {
      const t = await rig.table();
      const who = t.hero(of());
      const other = t.hero(plain());
      const [foe] = await t.fight([who, other]);
      t.kit.openField();
      t.kit.place(who.id, 10, 10);
      t.kit.place(foe.id, 17, 10);
      t.kit.place(other.id, 2, 2);
      const rush = await t.act(who, "dash", { bonus: true });
      const spent = [rush.ok, t.budget()?.bonusUsed, t.budget()?.actionUsed];
      // 30 feet of their own go anywhere; the rest only toward the foe.
      const back = await walkTo(t, who, 2, 10);
      const toward = await walkTo(t, who, 16, 10);
      await t.fight([other, who]);
      const plainDash = await t.act(other, "dash", { bonus: true });
      same([spent, back.status >= 400, toward.status, plainDash.ok], [[true, true, false], true, 200, false], `${row.name}: the Dash as a bonus action, 40 feet away from the only foe, 30 toward it, and a human asking the same (${rush.error ?? ""})`);
    });
  }
}

// The probes above by name, for the ledger's probe check (it finds a probe
// by its name in this file); the run holds the table to the list.
const NAMES = [
  "species.aasimar.healing-hands", "species.aasimar.revelation",
  "species.goliath.stones-endurance", "species.goliath.powerful-build", "species.goliath.mountain-born",
  "species.firbolg.innate", "species.firbolg.hidden-step", "species.firbolg.powerful-build",
  "species.tabaxi.feline-agility", "species.tabaxi.natural-weapon", "species.kenku.forgery",
  "species.tortle.natural-armor", "species.tortle.shell-defense", "species.tortle.breath", "species.tortle.natural-weapon",
  "species.fire_genasi.innate", "species.water_genasi.innate", "species.water_genasi.breath", "species.water_genasi.speeds",
  "species.air_genasi.innate", "species.air_genasi.breath", "species.earth_genasi.innate", "species.earth_genasi.earth-walk",
  "species.changeling.shapechanger", "species.warforged.integrated-protection", "species.warforged.sentrys-rest",
  "species.goblin.fury", "species.goblin.nimble-escape",
  "species.bugbear.long-limbed", "species.bugbear.powerful-build", "species.bugbear.surprise-attack",
  "species.lizardfolk.natural-armor", "species.lizardfolk.natural-weapon", "species.lizardfolk.breath", "species.lizardfolk.speeds", "species.lizardfolk.hungry-jaws",
  "species.orc.aggressive", "species.orc.powerful-build",
  "species.rock_gnome.tinker",
];
assert.deepEqual(Object.keys(P).sort(), [...NAMES].sort(), "the table makes other probes than NAMES lists: a row of races.json was added or changed");

await runOrSurvey("scripts/test-enforce-sweep-clauses-species-traits-more.mjs", P);
