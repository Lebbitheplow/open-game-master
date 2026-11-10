// Level 1 to 20 through the real level-up, for the builder sweep (package
// brief part 2).
//
// A character is filled at level 1 and seated at a table, given the
// experience for level 20, and then takes each level the way a player's
// agent does and the dialog's request does: GET /sheet/level-up says what the
// level opens (src/lib/srd/level-up-options.ts), and PATCH /sheet sends the
// picks back. The picks are read from the offer alone, first names first.
//
// What a row is held to:
//
//   ready      every level is offered as ready and the PATCH takes it
//   offered    no pick the offer lists is refused by the PATCH: where one is,
//              the walker drops it, takes the next and goes on, so one
//              refused option does not hide the levels after it, and the row
//              fails at the end naming each refused pick with the reason
//   owed       after each level the sheet owes nothing the level opened
//              (src/lib/srd/owed-choices.ts)
//   repeats    no skill, tool, language or expertise is held twice
//
// Import scripts/lib/enforce-world.mjs first.
import assert from "node:assert/strict";
import { openCreation, PORTRAIT } from "./enforce-creation.mjs";
import { doors, key, openSweepBuilder, repeats } from "./sweep-builder.mjs";

const src = (file) => import(new URL(`../../src/${file}`, import.meta.url).href);

// `prepare(creation)` runs before the builder reads its options: a suite
// that needs the table's workshop to hold something writes it there.
export async function openLevelSweep({ prepare, ...options } = {}) {
  const creation = await openCreation(options);
  const { world, campaignId, player } = creation;
  if (prepare) await prepare(creation);
  const sb = await openSweepBuilder({ world, user: player, campaignId });
  const door = doors({ creation });
  const sheetRoute = creation.sheetRoute;
  const levelRoute = await world.route("campaigns/[campaignId]/sheet/level-up");
  const { owedChoices } = await src("lib/srd/owed-choices.ts");
  const { subclassGrants, grantsForHeldTraining } = await src("lib/srd/subclass-training.ts");
  const { subclassExtrasFor } = await src("lib/db/subclass-extras.ts");
  const { tableAuthors } = await src("lib/db/homebrew.ts");
  const { classListFor } = await src("lib/srd/multiclass.ts");
  const { withFeatChoice } = await src("lib/schemas/sheet.ts");
  const { SRD_SKILLS } = await src("lib/srd/index.ts");
  const { getDatabase } = await src("lib/db/core.ts");
  const campaigns = await src("lib/db/campaigns.ts");
  const { companionImprovements } = await src("lib/srd/companion-build.ts");
  const { abilityPriority } = await src("app/characters/builder/classAbilities.ts");
  const ALL_SKILLS = SRD_SKILLS.map((skill) => skill.id);
  const LANGUAGES = ["Dwarvish", "Elvish", "Giant", "Gnomish", "Goblin", "Halfling", "Orc", "Draconic", "Celestial", "Infernal", "Sylvan", "Undercommon", "Abyssal", "Primordial", "Deep Speech"];
  const TOOLS = ["smith's tools", "herbalism kit", "cook's utensils", "tinker's tools", "disguise kit", "lute", "flute", "dice set", "navigator's tools", "poisoner's kit"];

  async function request(mod, method, body, query = "") {
    world.signIn(player);
    const response = await mod[method](
      new Request(`http://test/api/campaigns/${campaignId}/sheet${query}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { params: Promise.resolve({ campaignId }) },
    );
    return { status: response.status, json: await response.json() };
  }

  const offer = (query = "") => request(levelRoute, "GET", undefined, query);
  const patch = (body) => request(sheetRoute, "PATCH", body);
  const sheet = () => creation.sheets.getSheetForUser(campaignId, player.id);

  // The stored row, whole, and back again: one option is tried and undone
  // without building the character anew.
  function snapshot() {
    const id = sheet().id;
    const row = getDatabase().prepare("SELECT * FROM character_sheets WHERE id = ?").get(id);
    return () => {
      const columns = Object.keys(row).filter((column) => column !== "id");
      getDatabase()
        .prepare(`UPDATE character_sheets SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`)
        .run(...columns.map((column) => row[column]), id);
    };
  }

  // Seat a character built by the fill (or a sheet given whole) and give it
  // the experience for every level.
  async function seat(start, { xp = 355000 } = {}) {
    campaigns.setCampaignStatus(campaignId, "lobby");
    const { fields } = await sb.fill(sb.fresh(start));
    const built = sb.derive(fields);
    assert.equal(built.blocker, null, `seat: the builder refuses the level ${start.level ?? 1} character: ${JSON.stringify(built.blocker)}`);
    const seated = await door.table(built);
    assert.ok(seated.ok, `seat: the table refused the level ${start.level ?? 1} character (${seated.status}): ${seated.error}`);
    campaigns.setCampaignStatus(campaignId, "active");
    world.patch(seated.sheet.id, { xp });
    return { fields, built, id: seated.sheet.id };
  }

  // A pick for every slot of one grant's spec, from its own lists.
  function trainingPicks(spec, held) {
    const picks = {};
    const take = (kind, count, from, holding) => {
      if (count <= 0) return;
      const list = from.filter((entry) => !holding.has(key(entry))).slice(0, count);
      if (list.length) picks[kind] = [...(picks[kind] ?? []), ...list];
      list.forEach((entry) => holding.add(key(entry)));
    };
    const anyKinds = spec.anyKinds ?? [];
    let any = spec.any ?? 0;
    const shared = (kind) => {
      if (any > 0 && anyKinds.includes(kind) && anyKinds[0] === kind) {
        const count = any;
        any = 0;
        return count;
      }
      return 0;
    };
    take("skills", spec.skills + shared("skills"), spec.skillsFrom.length ? spec.skillsFrom : ALL_SKILLS, held.skills);
    take("languages", spec.languages + shared("languages"), LANGUAGES, held.languages);
    take("tools", spec.tools + shared("tools"), spec.toolsFrom.length ? spec.toolsFrom : TOOLS, held.tools);
    take("weapons", spec.weapons + shared("weapons"), spec.weaponsFrom.length ? spec.weaponsFrom : ["Longsword", "Rapier", "Longbow"], held.weapons);
    take("expertise", spec.expertise, [...held.skills], new Set());
    return picks;
  }

  // The request for the next level, from the offer and nothing else.
  async function picksFor(current, choices, { subclass, dropped, asi = "points", classId }) {
    const body = {};
    const classes = classListFor(current);
    // The class taking the level: the first, or the one named (a class the
    // character does not hold yet starts at 0).
    const prime = classId ? (classes.find((entry) => key(entry.id) === key(classId)) ?? { id: classId, level: 0, subclass: "" }) : classes[0];
    if (classId) body.levelUpClass = classId;
    if (choices.levelUpSkill) body.levelUpSkill = choices.levelUpSkill.options[0];
    if (choices.subclass) {
      const wanted = subclass && choices.subclass.options.find((name) => key(name) === key(subclass));
      body.subclass = wanted ?? (subclass ? subclass : choices.subclass.options[0]);
    }
    if (choices.asiChoices && asi === "points") {
      // The improvements the builder's fill takes (quickBuild.ts), so a
      // character grown to a level and one made at it end on the same
      // scores and their counters can be set side by side.
      const klass = sb.classes.find((entry) => entry.id === prime.id);
      body.asiChoices = klass ? companionImprovements(current.abilities, abilityPriority(klass), choices.asiChoices.count) : [];
    }
    if (choices.expertise) {
      body.expertise = choices.expertise.options.slice(0, choices.expertise.count);
    }
    const taken = [];
    for (const slot of choices.featurePicks ?? []) {
      const open = slot.options.filter((option) => !dropped.has(option) && !taken.includes(option));
      taken.push(...open.slice(0, slot.count));
    }
    if (taken.length) {
      body.features = taken.map((name) => ({ name, source: "choice" }));
    }
    if (choices.training) {
      const subclassNow = body.subclass ?? prime.subclass ?? "";
      const grown = { ...prime, level: prime.level + 1, subclass: subclassNow };
      const after = classes.some((entry) => key(entry.id) === key(prime.id))
        ? classes.map((entry) => (key(entry.id) === key(prime.id) ? grown : entry))
        : [...classes, grown];
      const extras = subclassExtrasFor(tableAuthors(campaignId));
      const grants = grantsForHeldTraining(subclassGrants(after, extras, current.features), current.proficiencies);
      const held = {
        skills: new Set(current.proficiencies.skills.map(key)),
        languages: new Set(current.proficiencies.languages.map(key)),
        tools: new Set(current.proficiencies.tools.map(key)),
        weapons: new Set(current.proficiencies.weapons.map(key)),
      };
      let featChoices = {};
      for (const due of choices.training) {
        const grant = grants.find((entry) => key(entry.name) === key(due.name));
        assert.ok(grant, `the offer names training "${due.name}" (${due.picks}) that the sheet's grants do not hold`);
        featChoices = withFeatChoice(featChoices, due.name, trainingPicks(grant.spec, held));
      }
      body.featChoices = featChoices;
    }
    if (choices.spells && (choices.spells.newCantrips || choices.spells.newSpells)) {
      const pool = await sb.spellPool(choices.spells.list, choices.spells.maxSpellLevel);
      const casting = current.spellcasting;
      const heldSpells = new Set(
        [casting?.cantrips, casting?.known, casting?.prepared, casting?.spellbook, ...(casting?.casters ?? []).flatMap((entry) => [entry.cantrips, entry.known, entry.prepared, entry.spellbook])]
          .flat()
          .filter(Boolean)
          .map(key),
      );
      const kept = [...dropped].find((entry) => entry.startsWith("schools:"))?.slice("schools:".length).split(",").map(key);
      const free = pool.filter(
        (spell) => !heldSpells.has(key(spell.name)) && !dropped.has(spell.name) && (!kept || spell.level === 0 || kept.includes(key(spell.school))),
      );
      const cantrips = free.filter((spell) => spell.level === 0).slice(0, choices.spells.newCantrips);
      // One of the highest level, the spell a new level is for, and the rest
      // of 3rd level once the caster has it: a wizard who only ever wrote
      // the highest spell would hold one 3rd-level spell at 20 and owe a
      // Signature Spell with nothing to name.
      const leveled = free.filter((spell) => spell.level > 0).sort((a, b) => b.level - a.level);
      const rest = leveled.slice(1);
      const spells = [...leveled.slice(0, 1), ...rest.filter((spell) => spell.level === 3), ...rest.filter((spell) => spell.level !== 3)].slice(0, choices.spells.newSpells);
      const names = [...cantrips, ...spells].map((spell) => spell.name);
      if (names.length) body.levelUpSpells = names;
    }
    return body;
  }

  // Every name a refusal could be about, longest first.
  function blamed(error, body) {
    const text = key(error);
    const names = [
      ...(body.features ?? []).map((feature) => feature.name),
      ...(body.levelUpSpells ?? []),
    ].sort((a, b) => b.length - a.length);
    return (
      names.find((name) => text.includes(key(name))) ??
      names.find((name) => name.includes(": ") && text.includes(key(name.slice(name.indexOf(": ") + 2)))) ??
      names.find((name) => /\(([^)]+)\)$/.test(name) && text.includes(key(/\(([^)]+)\)$/.exec(name)[1]))) ??
      null
    );
  }

  // Take levels until `to`. Returns what the walk met; throws only when a
  // level cannot be taken at all.
  // `classId`: the class the levels go to (multiclassing); the first class
  // when left out.
  async function climb({ to = 20, subclass, asi, classId } = {}) {
    const asked = classId ? `class=${encodeURIComponent(classId)}` : "";
    const refused = [];
    const schoolRefusals = [];
    const owedAfter = [];
    const repeated = [];
    const offers = [];
    for (;;) {
      const current = sheet();
      if (current.level >= to) break;
      const next = current.level + 1;
      const dropped = new Set();
      let done = false;
      for (let attempt = 0; attempt < 60 && !done; attempt += 1) {
        let offered = await offer(asked ? `?${asked}` : "");
        assert.equal(offered.status, 200, `level ${next}: the offer answered ${offered.status}: ${JSON.stringify(offered.json).slice(0, 300)}`);
        assert.equal(offered.json.ready, true, `level ${next}: the offer says not ready: ${offered.json.notReady}`);
        // A level that owes a subclass is asked again with the one being
        // taken, as the tool's description tells an agent to: the picks the
        // subclass opens (its training, its maneuvers, its spells) are only
        // counted then.
        if (offered.json.choices.subclass) {
          const options = offered.json.choices.subclass.options;
          const wanted = (subclass && options.find((name) => key(name) === key(subclass))) || (subclass ? null : options[0]);
          assert.ok(wanted, `level ${next}: the offer's subclasses do not include ${subclass}: ${options.join(", ")}`);
          const weighed = await offer(`?${asked ? `${asked}&` : ""}subclass=${encodeURIComponent(wanted)}`);
          assert.equal(weighed.status, 200, `level ${next}: the offer for ${wanted} answered ${weighed.status}: ${JSON.stringify(weighed.json).slice(0, 300)}`);
          offered = weighed;
        }
        if (attempt === 0) offers.push({ level: next, choices: offered.json.choices, owedBefore: offered.json.owedFromEarlierLevels });
        const body = await picksFor(current, offered.json.choices, { subclass, dropped, asi, classId });
        const answer = await patch({ level: next, ...body });
        if (answer.status === 200) {
          done = true;
          break;
        }
        // A third caster's schools (SRD 5.1, Eldritch Knight and Arcane
        // Trickster): the offer names the wizard's list and no school, so
        // the first refusal is recorded once and the walk keeps to the two
        // schools the refusal names.
        const schools = /learns (\w+) and (\w+) spells/i.exec(answer.json.error ?? "");
        if (schools && body.levelUpSpells?.length && !dropped.has(`schools:${schools[1]},${schools[2]}`)) {
          dropped.add(`schools:${schools[1]},${schools[2]}`);
          schoolRefusals.push({ level: next, error: answer.json.error });
          continue;
        }
        const name = blamed(answer.json.error, body);
        assert.ok(name, `level ${next}: the level-up refused the offer's own picks (${answer.status}): ${answer.json.error} :: sent ${JSON.stringify(body).slice(0, 500)}`);
        refused.push({ level: next, pick: name, error: answer.json.error });
        dropped.add(name);
      }
      assert.ok(done, `level ${next}: no set of the offer's picks was taken`);
      const after = sheet();
      assert.equal(after.level, next, `level ${next}: the PATCH answered 200 and the sheet is level ${after.level}`);
      const owed = owedChoices(after, { extras: subclassExtrasFor(tableAuthors(campaignId)), campaignId });
      if (owed.length) owedAfter.push({ level: next, owed });
      for (const kind of ["skills", "tools", "languages", "expertise"]) {
        const twice = repeats(after.proficiencies?.[kind]);
        if (twice.length) repeated.push({ level: next, kind, twice });
      }
    }
    return { refused, schoolRefusals, owedAfter, repeated, offers, sheet: sheet() };
  }

  return { creation, world, campaignId, player, sb, door, seat, climb, offer, patch, sheet, snapshot, picksFor, PORTRAIT, close: () => world.close() };
}

// What a character made at a level and one grown to it must share, whatever
// each picked on the way: the class's own features, its counters, its spell
// slots, its hit dice and the training the class gives outright.
export function twinDifferences(grown, made) {
  const out = [];
  const names = (sheet) => new Set(sheet.features.filter((feature) => feature.source === "class").map((feature) => key(feature.name)));
  const [a, b] = [names(grown), names(made)];
  const onlyGrown = [...a].filter((name) => !b.has(name));
  const onlyMade = [...b].filter((name) => !a.has(name));
  if (onlyGrown.length) out.push(`class features only on the grown sheet: ${onlyGrown.join(", ")}`);
  if (onlyMade.length) out.push(`class features only on the made sheet: ${onlyMade.join(", ")}`);
  // A counter a pick brings (an invocation's once-a-day spell) is the
  // player's own choice, as the pick is; the class's counters are compared.
  const PICKED = /^(invocation|maneuver|metamagic|infusion|discipline|rune)_/;
  const counters = (sheet) =>
    Object.fromEntries(Object.entries(sheet.resources ?? {}).filter(([id]) => !PICKED.test(id)).map(([id, value]) => [id, value.max]));
  const [ca, cb] = [counters(grown), counters(made)];
  for (const id of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
    if (ca[id] !== cb[id]) out.push(`counter ${id}: grown ${ca[id]}, made ${cb[id]}`);
  }
  const slots = (sheet) => JSON.stringify(Object.fromEntries(Object.entries(sheet.spellcasting?.slots ?? {}).map(([level, slot]) => [level, slot.max])));
  if (slots(grown) !== slots(made)) out.push(`spell slots: grown ${slots(grown)}, made ${slots(made)}`);
  const pact = (sheet) => JSON.stringify(sheet.spellcasting?.pactSlots ?? sheet.spellcasting?.pact ?? null);
  if (pact(grown) !== pact(made)) out.push(`pact slots: grown ${pact(grown)}, made ${pact(made)}`);
  if (JSON.stringify({ ...grown.hitDice, spent: 0 }) !== JSON.stringify({ ...made.hitDice, spent: 0 })) {
    out.push(`hit dice: grown ${JSON.stringify(grown.hitDice)}, made ${JSON.stringify(made.hitDice)}`);
  }
  // Weapons by category only: which single weapons a Kensei or a
  // Bladesinger trained in is each player's own pick.
  for (const kind of ["saves", "armor", "weapons"]) {
    const [ga, ma] = [grown, made].map(
      (sheet) => new Set((sheet.proficiencies?.[kind] ?? []).map(key).filter((entry) => kind !== "weapons" || entry === "simple" || entry === "martial")),
    );
    const lost = [...ma].filter((entry) => !ga.has(entry));
    const extra = [...ga].filter((entry) => !ma.has(entry));
    if (lost.length) out.push(`${kind} only on the made sheet: ${lost.join(", ")}`);
    if (extra.length) out.push(`${kind} only on the grown sheet: ${extra.join(", ")}`);
  }
  return out;
}

// The walk's findings as one assertion, most serious first.
export function assertClean(walk, label) {
  const said = (list) => list.join(" | ");
  const owed = walk.owedAfter.map((entry) => `L${entry.level}: ${entry.owed.join("; ")}`);
  assert.ok(!owed.length, `${label}: picks were left owed after a level that took every pick its offer listed: ${said(owed)}`);
  const twice = walk.repeated.map((entry) => `L${entry.level} ${entry.kind}: ${entry.twice.join(", ")}`);
  assert.ok(!twice.length, `${label}: a proficiency is held twice: ${said(twice)}`);
}

// The offer against the PATCH, apart from the rest: a row that fails here
// for a known reason must not hide what the walk found otherwise.
export function assertOffered(walk, label) {
  const refused = walk.refused.map((entry) => `L${entry.level} ${entry.pick}: ${entry.error}`);
  assert.ok(!refused.length, `${label}: the offer listed picks the level-up refused: ${refused.join(" | ")}`);
}
