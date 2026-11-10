// The row generators of the fill sweep, shared by the suites that run with
// the content pack and the one that runs without it.
const src = (file) => import(new URL(`../../src/${file}`, import.meta.url).href);

// The classes every setting plays and a new player meets first, for rows
// that are about a species or a background and need some class.
const MARTIAL = ["fighter", "barbarian", "rogue", "monk", "ranger", "paladin"];
const CASTERS = ["wizard", "cleric", "bard", "druid", "sorcerer", "warlock"];

export async function subclassRows(rows, sweep, { prefix = "fill", part = null } = {}) {
  let index = 0;
  for (const klass of sweep.library.classes) {
    const pickLevel = sweep.subclassLevelFor(klass.id);
    if (pickLevel === null) continue;
    for (const subclass of await sweep.library.subclassesOf(klass.id)) {
      index += 1;
      // Split in two suites by turn, so each stays inside its time.
      if (part !== null && index % 2 !== part) continue;
      for (const level of [pickLevel, 20]) {
        await rows.row(`${prefix}:subclass:${klass.id}/${subclass.name}@${level}`, async () => {
          await sweep.fillAndSave({ level, classId: klass.id, subclass: subclass.name });
        });
      }
    }
  }
}

export async function speciesRows(rows, sweep, { prefix = "fill" } = {}) {
  const { takesDraconicAncestry, DRACONIC_ANCESTRIES } = await src("lib/srd/racial-grants.ts").then(
    async (grants) => ({
      takesDraconicAncestry: grants.takesDraconicAncestry ?? (await src("lib/srd/dragon-ancestor.ts")).takesDraconicAncestry,
      DRACONIC_ANCESTRIES: grants.DRACONIC_ANCESTRIES ?? (await src("lib/srd/dragon-ancestor.ts")).DRACONIC_ANCESTRIES,
    }),
  );
  const classIds = new Set(sweep.library.classes.map((klass) => klass.id));
  const pick = (list, index) => list.filter((id) => classIds.has(id))[index % list.filter((id) => classIds.has(id)).length];
  let index = 0;
  for (const race of sweep.library.races) {
    index += 1;
    const martial = pick(MARTIAL, index);
    const caster = pick(CASTERS, index);
    await rows.row(`${prefix}:species:${race.id}/${martial}@1`, async () => {
      await sweep.fillAndSave({ level: 1, classId: martial, raceId: race.id });
    });
    // A caster at 5: the species' own spells and cantrips beside a class's.
    await rows.row(`${prefix}:species:${race.id}/${caster}@5`, async () => {
      await sweep.fillAndSave({ level: 5, classId: caster, raceId: race.id });
    });
    // Each option the species leaves to the player, taken in turn.
    for (const option of race.variants?.options ?? []) {
      await rows.row(`${prefix}:species:${race.id}/variant=${option.id}`, async () => {
        await sweep.fillAndSave({ level: 1, classId: caster, raceId: race.id, racialVariant: option.id });
      });
    }
    for (const tool of race.toolChoice?.from ?? []) {
      await rows.row(`${prefix}:species:${race.id}/tool=${tool}`, async () => {
        await sweep.fillAndSave({ level: 1, classId: martial, raceId: race.id, racialTool: tool });
      });
    }
    // A species that picks skills of its own shares the pool with every
    // class's list: each class in turn, where a short list (a cleric's five)
    // can be used up before the class picks.
    if (race.skillChoice) {
      for (const classId of [...MARTIAL, ...CASTERS].filter((id) => classIds.has(id) && id !== martial)) {
        await rows.row(`${prefix}:species:${race.id}/${classId}@1`, async () => {
          await sweep.fillAndSave({ level: 1, classId, raceId: race.id }, { table: false });
        });
      }
    }
    if (takesDraconicAncestry?.(race.id)) {
      for (const ancestry of DRACONIC_ANCESTRIES) {
        await rows.row(`${prefix}:species:${race.id}/ancestry=${ancestry.id}`, async () => {
          await sweep.fillAndSave({ level: 1, classId: "sorcerer", subclass: "Draconic Bloodline", raceId: race.id, racialAncestry: ancestry.id }, { table: false });
        });
      }
    }
  }
}

export async function backgroundRows(rows, sweep, { prefix = "fill" } = {}) {
  const classIds = new Set(sweep.library.classes.map((klass) => klass.id));
  const all = [...MARTIAL, ...CASTERS].filter((id) => classIds.has(id));
  let index = 0;
  for (const background of sweep.library.backgrounds) {
    index += 1;
    const classId = all[index % all.length];
    await rows.row(`${prefix}:background:${background.id}/${classId}@1`, async () => {
      await sweep.fillAndSave({ level: 1, classId, backgroundId: background.id });
    });
    // The class whose skill list overlaps the background's most is where a
    // repeated grant shows: a rogue or a bard, who pick four and three.
    if (classId !== "rogue") {
      await rows.row(`${prefix}:background:${background.id}/rogue@1`, async () => {
        await sweep.fillAndSave({ level: 1, classId: "rogue", backgroundId: background.id });
      });
    }
    // Each skill the background's picker offers (BackgroundPanel.tsx leaves
    // out the ones the background gives outright).
    for (const skill of (background.skillChoice?.from ?? []).filter((entry) => !background.skills.includes(entry))) {
      await rows.row(`${prefix}:background:${background.id}/skill=${skill}`, async () => {
        await sweep.fillAndSave({ level: 1, classId, backgroundId: background.id, backgroundSkills: [skill] }, { table: false });
      });
    }
  }
}
