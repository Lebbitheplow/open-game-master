// The Hand sweep's rig (scripts/test-enforce-sweep-hand-*.mjs): a table per
// character, the Hand dealt the way the page deals it, every card played the
// way the actions route and "Resolve as played" play it, and the whole
// database put back after each card.
//
// Import scripts/lib/enforce-world.mjs BEFORE this file.
//
//   const rig = await handRig();
//   const table = await rig.seat({ classId: "fighter", subclass: "Champion", level: 20 });
//   await rig.inState(table, "prone", async () => {
//     const deal = rig.deal(table);                       // cards, chips, turn
//     const played = await rig.play(table, deal, card);   // rolled back after
//   });
//
// What the page does and this does the same way:
//   - the turn is turnFromEncounter(activePublicEncounter()), never a ledger;
//   - the cards are withReactions(reactionCards(), deriveHand()) with the
//     spell facts the content search answers, the summon catalogue the
//     summons route answers, and the gear context the board view gives;
//   - a chip to aim at is handTargets() with the board view's edges;
//   - the intent is intentBody() parsed by messageIntentSchema;
//   - the route's own check is intentRefusal(), and the calls are
//     directCardCalls(directContextFor()) run through invokeEngine as a person.
//
// Every d20 the engine throws while a card is played shows the face the rig
// holds (15 by default: a hit on the dummies' AC 13 that is no critical, a
// failed save for a creature with +0 or +1); the other dice are seeded.
import crypto from "node:crypto";
import { keepThrownCards } from "./kept-rolls.mjs";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { openWorld, seedDice } from "./enforce-world.mjs";
import { combatKit, TRAINED } from "./enforce-combat.mjs";
import { layMap, PORTRAIT } from "./enforce-spells.mjs";
import { ABILITIES, KITS, ROWS, SPOTS } from "./sweep-hand-table.mjs";
import { handFacts } from "./sweep-hand-facts.mjs";

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../../src/lib/srd/${name}`, import.meta.url), "utf8"));

// ---- the d20 the rig holds ----

let heldD20 = 15;
const d20s = [];
const seededRandomInt = crypto.randomInt;
crypto.randomInt = function heldRandomInt(min, max, callback) {
  if (heldD20 !== null && min === 1 && max === 21 && typeof callback !== "function") {
    d20s.push(heldD20);
    return heldD20;
  }
  return seededRandomInt(min, max, callback);
};
syncBuiltinESMExports();
seedDice(1109);

export function holdD20(face) {
  heldD20 = face;
}

// ---- the tables walked ----

export const CLASS_FEATURES = read("class-features.json").classes;
export const AUTHORED_SUBCLASSES = read("subclasses.json").classes;

// Every class with every subclass it has: the SRD's own and the authored ones.
export function everyBuild(classId, levels = [20]) {
  const subclasses = [...(CLASS_FEATURES[classId]?.subclasses ?? []), ...(AUTHORED_SUBCLASSES[classId] ?? [])];
  return subclasses.flatMap((subclass) => levels.map((level) => ({ classId, subclass: subclass.name, level, key: `${subclass.name}@${level}` })));
}

export const CLASS_IDS = Object.keys(CLASS_FEATURES);

export async function handRig() {
  const src = (file) => import(new URL(`../../src/${file}`, import.meta.url).href);
  const { getDatabase } = await src("lib/db/core.ts");
  const encounters = await src("lib/db/encounters.ts");
  const maps = await src("lib/db/battle-maps.ts");
  const rolls = await src("lib/db/rolls.ts");
  const { activePublicEncounter } = await src("lib/db/encounter-view.ts");
  const { buildPlayerMapView } = await src("lib/battlemap/view.ts");
  const hand = await src("lib/battlemap/hand.ts");
  const handPlay = await src("lib/battlemap/hand-play.ts");
  const handReact = await src("lib/battlemap/hand-react.ts");
  const { turnFromEncounter } = await src("lib/battlemap/hand-table.ts");
  const { handTargets } = await src("app/campaigns/[campaignId]/handTargets.ts");
  const intentLogic = await src("lib/dm/intent-logic.ts");
  const { intentRefusal } = await src("lib/dm/intent-check.ts");
  const { directContextFor } = await src("lib/dm/direct-context.ts");
  const { invokeEngine } = await src("lib/dm/invoke.ts");
  const { tableAuthors } = await src("lib/db/homebrew.ts");
  const content = await src("lib/content/index.ts");
  const { bundledSpellFacts } = await src("lib/srd/spell-facts.ts");
  const { authoredSpellRow } = await src("lib/srd/spell-mechanics.ts");
  const { textKey } = await src("lib/language/text-logic.ts");
  const srd = await src("lib/srd/index.ts");
  const features = await src("lib/srd/features.ts");
  const { freshBudget } = await src("lib/dm/action-budget.ts");

  const db = () => getDatabase();

  // A column the engine adds the first time a roll is parked
  // (src/lib/db/dm-turns.ts ensureParkColumn) would be added inside a play
  // and rolled back with it, while the module remembers it as added. So the
  // columns are added here, before anything is rolled back, and every
  // rollback checks that no other schema change went with it.
  {
    const columns = db().prepare(`PRAGMA table_info(pending_rolls)`).all().map((column) => column.name);
    for (const column of ["parked_for", "thrown_json", "carry_json", "watch_json"]) {
      if (!columns.includes(column)) db().exec(`ALTER TABLE pending_rolls ADD COLUMN ${column} TEXT`);
    }
  }
  const schemaVersion = () => Number(db().pragma("schema_version", { simple: true }));

  // ---- a table for one character ----

  function castingFor(classId, subclass, level) {
    const slots = srd.spellSlotsFor(classId, level, subclass);
    if (!Object.keys(slots).length) return null;
    const kit = KITS[classId] ?? KITS.third;
    const top = Math.max(...Object.keys(slots).map(Number));
    const granted = features.subclassSpellsFor(classId, subclass, level);
    const levelOf = (name) => content.findSpellByName(name)?.level ?? bundledSpellFacts(name)?.level ?? authoredSpellRow(name)?.level ?? 1;
    const spells = [...new Set([...kit.spells, ...granted])].filter((name) => levelOf(name) <= top || classId === "warlock");
    return {
      ability: kit.ability,
      slots: Object.fromEntries(Object.entries(slots).map(([slot, max]) => [slot, { max, used: 0 }])),
      known: kit.known ? spells : [],
      prepared: kit.known ? [] : spells,
      cantrips: kit.cantrips,
      ...(kit.book ? { spellbook: spells } : {}),
    };
  }

  // `extra` is merged over the hero (a feat, a species, an item).
  async function seat({ classId, subclass, level = 20, key, extra = {} }) {
    const world = await openWorld({ campaign: { maxPlayers: 6 }, gameSettings: { ttsEnabled: false } });
    const kit = await combatKit(world);
    const spellcasting = castingFor(classId, subclass, level);
    const hero = world.addHero({
      name: "Hero",
      class: classId,
      subclass,
      level,
      abilities: ABILITIES,
      maxHp: 200,
      proficiencies: { ...TRAINED, saves: ["con"] },
      portrait: PORTRAIT,
      equipment: [
        { name: "Longsword", qty: 1, equipped: true },
        { name: "Dagger", qty: 2 },
        { name: "Shortbow", qty: 1 },
        { name: "Arrows", qty: 20 },
        { name: "Shield", qty: 1 },
        { name: "Potion of Healing", qty: 1 },
      ],
      ...(spellcasting ? { spellcasting } : {}),
      ...extra,
    });
    const ally = world.addHero({ name: "Ally", class: "fighter", subclass: "Champion", level: 5, abilities: ABILITIES, maxHp: 60, proficiencies: TRAINED, portrait: PORTRAIT, equipment: [{ name: "Mace", qty: 1, equipped: true }] });
    const mage = world.addHero({
      name: "Mage", class: "wizard", subclass: "School of Evocation", level: 5, abilities: ABILITIES, maxHp: 40, proficiencies: TRAINED, portrait: PORTRAIT,
      spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } }, known: [], prepared: ["Darkness", "Silence"], cantrips: ["Light"], spellbook: ["Darkness", "Silence"] },
    });
    const down = world.addHero({ name: "Fallen", class: "fighter", subclass: "Champion", level: 5, abilities: ABILITIES, maxHp: 60, proficiencies: TRAINED, portrait: PORTRAIT });
    await kit.fight(3, { heroFaces: { [hero.id]: 19 } });
    const foes = world.enemies().sort((a, b) => a.displayName.localeCompare(b.displayName));
    for (const foe of foes) kit.setEnemy(foe.id, { maxHp: 400, currentHp: 400 });
    const [near, mid, far] = foes;
    await layMap(world, ROWS, {
      [hero.id]: SPOTS.hero, [near.id]: SPOTS.near, [mid.id]: SPOTS.mid, [far.id]: SPOTS.far,
      [ally.id]: SPOTS.ally, [mage.id]: SPOTS.mage, [down.id]: SPOTS.down,
    });
    world.patch(ally.id, { currentHp: 20 });
    world.patch(down.id, { currentHp: 0, conditions: ["Unconscious"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
    world.patch(hero.id, { currentHp: 150 });
    kit.giveTurn(hero.id);
    world.diceLog();
    return { world, kit, classId, subclass, level, key: key ?? `${subclass}@${level}`, hero, ally, mage, down, near, mid, far, kitSpells: KITS[classId] ?? (spellcasting ? KITS.third : null) };
  }

  // ---- the database put back ----

  let depth = 0;
  async function rolledBack(run) {
    const name = `sweep_${(depth += 1)}`;
    const schema = depth === 1 ? schemaVersion() : null;
    const master = () => new Map(db().prepare(`SELECT name, sql FROM sqlite_master`).all().map((row) => [row.name, row.sql]));
    const before = schema !== null ? master() : null;
    db().prepare(`SAVEPOINT ${name}`).run();
    let changed = false;
    try {
      return await run();
    } finally {
      if (schema !== null && schemaVersion() !== schema) {
        const after = master();
        // Dropped and made again the same (a rebuilt index) is no change.
        changed = [
          ...[...after].filter(([key, sql]) => before.get(key) !== sql).map(([key, sql]) => `${key}: ${String(sql).slice(-160)}`),
          ...[...before.keys()].filter((key) => !after.has(key)).map((key) => `${key} dropped`),
        ].join(" | ");
      }
      db().prepare(`ROLLBACK TO ${name}`).run();
      db().prepare(`RELEASE ${name}`).run();
      depth -= 1;
      if (changed) {
        // eslint-disable-next-line no-unsafe-finally
        throw new Error(`the engine changed the database schema inside a play that was rolled back; make that change before the first rollback (handRig): ${changed}`);
      }
    }
  }

  // ---- the states ----

  function setBudget(table, patch) {
    const encounter = table.world.encounter();
    const sheet = table.world.sheet(table.hero.id);
    const base = freshBudget({ ownerId: sheet.id, round: encounter.round, attacksAllowed: hand.attacksAllowed(sheet) });
    encounters.saveEncounter({ ...encounter, turnBudget: { ...base, ...patch } });
  }

  function moveTo(table, refId, x, y) {
    const encounter = table.world.encounter();
    const map = maps.getBattleMapForEncounter(encounter.id);
    const token = maps.getTokenByRef(map.id, refId);
    maps.moveToken(token.id, x, y, 0);
  }

  async function mageCasts(table, spell) {
    const { world, kit, hero, mage } = table;
    kit.giveTurn(mage.id);
    const cast = await world.invoke("use_spell_slot", { characterId: mage.id, spell, level: 2, atX: SPOTS.hero.x, atY: SPOTS.hero.y });
    kit.giveTurn(hero.id);
    return cast.ok ? null : `the mage could not cast ${spell}: ${cast.error}`;
  }

  // A condition the way the console sets one, so what the engine keeps
  // beside the word (who holds a grapple) is there.
  async function condition(table, name, args = {}) {
    const set = await table.world.invoke("set_condition", { characterId: table.hero.id, condition: name, ...args });
    return set.ok ? null : `this character cannot be ${name}: ${set.error}`;
  }

  // Puts the table in a state. Returns a reason when the state is not one
  // this character can be in (raging with no Rage), which the suite counts
  // as a skip with that reason.
  async function enter(table, state) {
    const { world, kit, hero, near, mid, far, ally, mage, down } = table;
    const sheet = world.sheet(hero.id);
    switch (state) {
      case "fresh":
        return null;
      case "action-spent":
        setBudget(table, { actionUsed: true });
        return null;
      case "bonus-spent":
        setBudget(table, { bonusUsed: true });
        return null;
      case "reaction-spent": {
        setBudget(table, { reactionUsed: true });
        const encounter = world.encounter();
        encounters.saveEncounter({ ...encounter, reactionsUsed: [...new Set([...encounter.reactionsUsed, hero.id])] });
        return null;
      }
      case "zero-hp": {
        // Dropped by a blow, as the engine drops a character.
        world.patch(hero.id, { currentHp: 1, tempHp: 0 });
        await world.invoke("apply_damage", { characterId: hero.id, amount: 1, type: "slashing" });
        if (world.sheet(hero.id).currentHp > 0 || !world.sheet(hero.id).conditions.some((entry) => /unconscious/i.test(entry))) {
          world.patch(hero.id, { currentHp: 0, conditions: [...sheet.conditions, "Unconscious"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
        }
        kit.giveTurn(hero.id);
        return null;
      }
      case "stunned":
        return condition(table, "stunned", { rounds: 5 });
      case "prone":
        return condition(table, "prone");
      case "grappled":
        return condition(table, "grappled", { sourceEnemyId: near.id });
      case "blinded":
        return condition(table, "blinded", { rounds: 5 });
      case "darkness":
        return mageCasts(table, "Darkness");
      case "silenced":
        return mageCasts(table, "Silence");
      case "no-free-hand":
        world.patch(hero.id, { equipment: sheet.equipment.map((item) => (item.name === "Shield" ? { ...item, equipped: true } : item)) });
        return null;
      case "raging": {
        if (!sheet.resources.rage) return "this character has no Rage";
        const raged = await world.invoke("use_resource", { characterId: hero.id, resource: "rage" });
        if (!raged.ok) return `Rage was refused: ${raged.error}`;
        setBudget(table, {});
        return null;
      }
      case "concentrating": {
        const spell = table.kitSpells?.conc;
        if (!sheet.spellcasting || !spell) return "this character casts no spell to concentrate on";
        const cast = await world.invoke("cast_buff", { characterId: hero.id, spell, targetCharacterIds: [hero.id], targetEnemyId: undefined });
        if (!cast.ok || !world.sheet(hero.id).concentratingOn) {
          // A spell laid on a foe or a square instead (Hex, Web, Faerie Fire).
          world.patch(hero.id, { concentratingOn: spell, concentrationRounds: 10 });
        }
        setBudget(table, {});
        return null;
      }
      case "foe-30ft":
        moveTo(table, near.id, SPOTS.hero.x + 6, 3);
        moveTo(table, mid.id, SPOTS.hero.x + 6, 5);
        for (const [index, friend] of [ally, mage, down].entries()) moveTo(table, friend.id, SPOTS.hero.x - 6, 3 + index);
        return null;
      case "foe-100ft":
        moveTo(table, near.id, SPOTS.hero.x + 20, 3);
        moveTo(table, mid.id, SPOTS.hero.x + 20, 5);
        for (const [index, friend] of [ally, mage, down].entries()) moveTo(table, friend.id, SPOTS.hero.x - 20, 3 + index);
        return null;
      case "foe-invisible": {
        const set = await world.invoke("set_condition", { enemyId: near.id, condition: "invisible", rounds: 10 });
        if (!set.ok) throw new Error(`set_condition invisible was refused: ${set.error}`);
        return null;
      }
      case "hit-on-hero":
      case "hit-on-ally":
      case "failed-save": {
        // The foe's turn, and what it did has just landed.
        const encounter = world.encounter();
        const index = encounter.order.findIndex((entry) => entry.kind !== "pc");
        encounters.saveEncounter({ ...encounter, turnIndex: index, turnBudget: null });
        const done = state === "failed-save"
          ? await world.invoke("cast_at_player", { characterId: hero.id, saveAbility: "wis", dc: 30, damage: "2d6", damageType: "psychic", casterEnemyId: near.id })
          : await world.invoke("enemy_attack", { enemyId: near.id, targetCharacterId: state === "hit-on-hero" ? hero.id : ally.id });
        if (!done.ok) return `the foe's ${state === "failed-save" ? "spell" : "attack"} was refused: ${done.error}`;
        if (state !== "failed-save" && done.result.hit !== true) return `the foe's attack did not hit: ${JSON.stringify(done.result).slice(0, 160)}`;
        return null;
      }
      case "out-of-fight": {
        const ended = await world.invoke("end_encounter", { outcome: "truce" });
        return ended.ok ? null : `the fight would not end: ${ended.error}`;
      }
      default:
        throw new Error(`no state "${state}"`);
    }
  }

  // Runs `run` with the table in `state`, and puts everything back after.
  // `run` is given the reason the state does not apply, or null.
  function inState(table, state, run) {
    return rolledBack(async () => run(await enter(table, state)));
  }

  // ---- the Hand as the page deals it ----

  const { spellsFor, summonsFor } = await handFacts(src);

  function deal(table) {
    const { world, hero } = table;
    const sheet = world.sheet(hero.id);
    const sheets = world.sheets();
    const campaign = world.campaign();
    const encounter = activePublicEncounter(world.campaignId);
    const view = encounter ? buildPlayerMapView(world.campaignId, sheet.userId) : null;
    const turn = turnFromEncounter(encounter, sheet, { myTurn: true });
    const authors = tableAuthors(world.campaignId);
    const hits = encounter?.lastHits ?? [];
    const chips = encounter ? handTargets(encounter.enemies, sheets, sheet.id, view?.edges, encounter.sides, encounter, view?.sight) : handTargets([], sheets, sheet.id, undefined);
    const creatures = encounter ? handTargets(encounter.enemies, sheets, sheet.id, undefined, encounter.sides) : [];
    const unseen = view?.unseen ? new Set(view.unseen) : undefined;
    const reactions = handReact.reactionCards(sheet, turn, hits, sheets, "you", view?.feet, encounter?.lastSaves, view?.feet ? creatures : undefined, view?.feet && unseen ? unseen : undefined);
    const gear = {
      drops: view?.drops,
      mount: view?.mounts?.[sheet.id] ?? null,
      allies: sheets.filter((entry) => entry.id !== sheet.id).length,
      dying: sheets.filter((entry) => entry.currentHp <= 0 && !entry.deathSaves?.dead && !entry.deathSaves?.stable).map((entry) => ({ id: entry.id, name: entry.name })),
    };
    // The board's verdicts on the hero's own square, as the page hands them
    // to the Hand (Hand.tsx: PlayerMapView.self for the viewer's own token).
    const options = { spells: spellsFor(sheet), trackAmmo: campaign.gameSettings?.variantRules?.trackAmmo, gear, blasts: true, summons: summonsFor(sheet, authors), items: true, board: view?.self };
    const cards = handReact.withReactions(reactions, hand.deriveHand(sheet, turn, options));
    return { sheet, sheets, campaign, encounter, view, turn, hits, chips, cards, authors };
  }

  // ---- a card played ----

  function chipFor(table, deal, card, aimAt) {
    const byId = (id) => deal.chips.find((chip) => chip.id === id) ?? null;
    if (aimAt === "self") return byId(table.hero.id);
    if (aimAt) return byId(aimAt);
    // A redirect's creature is the player's pick among those beside them,
    // never the attacker (hand-react.ts reactionPicks).
    if (card.pickWithin) {
      return handReact.reactionPicks(card, deal.chips.filter((chip) => chip.id !== table.hero.id), deal.view?.feet)[0] ?? null;
    }
    if (card.answers || card.intent.card === "reaction") {
      const fixed = handReact.reactionAim(card, deal.hits, deal.sheet.id, deal.sheets);
      if (fixed) return fixed;
    }
    if (card.intent.card === "basic" && card.intent.action === "stabilize") return byId(table.down.id);
    switch (card.target) {
      case "enemy":
        return byId(table.near.id);
      case "ally":
        return byId(table.ally.id);
      case "self":
        return byId(table.hero.id);
      default:
        return null;
    }
  }

  function choicesFor(table, card, extra = {}) {
    const choices = { ...extra };
    if (card.asks === "trigger") choices.trigger = "the goblin moves toward me";
    if (card.area) {
      const encounter = table.world.encounter();
      const map = encounter ? maps.getBattleMapForEncounter(encounter.id) : null;
      const token = map ? maps.getTokenByRef(map.id, table.near.id) : null;
      if (token) {
        const at = { x: token.x, y: token.y };
        choices.area = card.area.pick === "point" ? { at } : card.area.pick === "wall" ? { at, toward: { x: at.x, y: at.y + 2 } } : { toward: at };
      }
    }
    return choices;
  }

  const budgetOf = (world, heroId) => {
    const encounter = world.encounter();
    const own = encounter?.turnBudget?.ownerId === heroId ? encounter.turnBudget : null;
    return {
      action: Boolean(own?.actionUsed),
      bonus: Boolean(own?.bonusUsed),
      reaction: Boolean(encounter?.reactionsUsed.includes(heroId)) || Boolean(own?.reactionUsed),
      attacks: own?.attacksMade ?? 0,
      extra: (own?.extraActions ?? 0) + (own?.grantedActions ?? 0),
      flurry: own?.flurryStrikes ?? 0,
      interaction: Boolean(own?.interaction),
    };
  };

  // Plays one card the way its own intent goes, and puts the database back.
  //   aimAt     a chip id, "self", or nothing for the card's usual aim
  //   riders    rider cards that ride an attack card
  //   choices   what the player picked on the raised card
  async function play(table, dealt, card, { aimAt, riders = [], choices: picked = {} } = {}) {
    const { world, hero } = table;
    const aim = chipFor(table, dealt, card, aimAt);
    const choices = choicesFor(table, card, picked);
    const out = { cardId: card.id, name: card.name, aim: aim ? { id: aim.id, kind: aim.kind, name: aim.name } : null, ready: true };
    if (card.compose) return { ...out, skip: "finished in the composer: the card posts no intent" };
    if ((card.target === "enemy" || card.target === "ally") && !aim) return { ...out, skip: "nothing to aim at in this state" };
    // A chip the card leaves off its aim bar (a sight-bound card and a foe the
    // board says the holder cannot see, hand-play.ts aimUnseen) is still
    // forced through the engine, which must refuse it as the card did.
    const withheld = aim ? handPlay.aimUnseen(card, aim) : null;
    if (withheld) out.withheld = withheld;
    if (!handPlay.handReady(card, withheld ? { ...aim, sight: undefined } : aim, choices)) return { ...out, ready: false, skip: "the card is not ready as staged (a pick it needs was not made)" };
    const body = handPlay.intentBody(card, aim, riders, choices);
    const parsed = intentLogic.messageIntentSchema.safeParse(body);
    if (!parsed.success) {
      return { ...out, parse: `${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message}`, body };
    }
    const intent = parsed.data;
    out.intent = intent;
    out.preview = handPlay.previewRows(card, aim, dealt.sheet.conditions, choices);
    return rolledBack(async () => {
      const campaign = world.campaign();
      const pre = intentRefusal(campaign, world.sheet(hero.id), intent);
      if (pre) return { ...out, pre };
      const calls = intentLogic.directCardCalls(intent, hero.id, directContextFor(world.campaignId, intent, tableAuthors(world.campaignId), hero.id));
      if (!calls) return { ...out, left: true };
      const before = budgetOf(world, hero.id);
      const sheetBefore = world.sheet(hero.id);
      const seen = new Set(rolls.listRecentRolls(world.campaignId, 60).map((roll) => roll.id));
      d20s.length = 0;
      const results = [];
      for (const call of calls) {
        // A check that waits on what the hero holds is kept as it lies.
        const answer = await keepThrownCards(world, await invokeEngine(world.campaign(), { kind: "human", userId: world.owner.id }, call));
        results.push({ name: call.name, args: call.args, ok: answer.ok, ...(answer.ok ? { result: answer.result } : { error: answer.error, retry: answer.retry === true, refused: answer.refused ?? null }) });
        if (!answer.ok || intentLogic.drawStopsCast(call.name, answer.result)) break;
      }
      const made = rolls.listRecentRolls(world.campaignId, 60).filter((roll) => !seen.has(roll.id)).reverse();
      const sheetAfter = world.sheet(hero.id);
      return {
        ...out,
        calls: results,
        before,
        after: budgetOf(world, hero.id),
        rolls: made.map((roll) => ({ kind: roll.kind, detail: roll.detail, expression: roll.expression, advantage: roll.advantage, dc: roll.dc, total: roll.total, success: roll.success, terms: roll.breakdown?.terms ?? [], natural: roll.breakdown?.natural, characterId: roll.characterId, attacker: roll.attacker })),
        d20s: d20s.length,
        resources: { before: sheetBefore.resources, after: sheetAfter.resources },
        slots: { before: sheetBefore.spellcasting?.slots ?? null, after: sheetAfter.spellcasting?.slots ?? null },
      };
    });
  }

  // The foes as creatures of another type, for the length of `run`.
  function withFoeType(table, type, run) {
    return rolledBack(async () => {
      for (const foe of [table.near, table.mid, table.far]) table.kit.setEnemy(foe.id, { stats: { type } });
      return run();
    });
  }

  return { seat, inState, rolledBack, deal, play, setBudget, moveTo, withFoeType, textKey, db, src };
}

export * from "./sweep-hand-read.mjs";
export * from "./sweep-hand-table.mjs";
