// The walk of one row of the "spends" sweep (scripts/lib/sweep-spends.mjs):
// the stagings a spend may need before it is accepted, the doors it is
// played through, and how an accepted call is judged.
import { readChanges, signature, statesMechanic } from "./sweep-spends.mjs";

// ---- stagings ----

// What has happened at the table before the call. A staging is one step or
// several joined by " + " (what a gate asks for, then the trigger). The first
// two stage no trigger at all: a reaction accepted there reacts to nothing.
export const UNTRIGGERED = ["own turn, nothing staged", "a foe's turn, nothing staged"];
export const TRIGGERS = [
  "a hit on the holder",
  "a hit on the ally beside the holder",
  "a critical hit on the holder",
  "a fire hit on the holder",
  "a fire hit on the ally beside the holder",
  "a miss on the holder",
  "a hit that drops the holder to 0",
  "a hit that drops the ally to 0",
  "the holder failed a save",
  "the ally failed a save",
  "the holder hit a foe",
  "the holder missed a foe",
  "the holder killed a foe",
  // The triggers the engine records besides a hit (src/lib/dm/last-save.ts,
  // read through src/lib/srd/trigger-table.ts): once a reaction is held to
  // its record, these are what it answers.
  "the foe forced a save the holder failed",
  "the foe forced a save the holder made",
  "the foe tried to charm the holder",
  "the foe cast a spell at the holder",
  "the foe's spell hurt the holder through a save",
  "a hit with advantage on the holder",
  "the ally hit a foe",
  "a foe ended its turn beside the holder",
  "a foe's turn began beside the holder",
  "the holder used Action Surge",
];
// Not staged: a foe leaving the holder's reach (move_token resolves the
// opportunity attack itself and spends the reaction, so nothing is left open
// for a reaction to answer), a creature dying of something other than the
// holder's blow, and a save an enemy made.

// For a spend on the holder's own turn: as staged, then the states a spend may ask for.
// The last two come after "no fight", so a spend accepted earlier is still
// read where it was: they are for the uses that answer a kill or a step.
export const OWN_TURN = ["own turn, nothing staged", "the holder below half hit points", "the holder hit a foe", "the holder failed a save", "the holder failed a save + then the holder's turn", "the holder missed a foe", "no fight", "the holder killed a foe", "the holder used Step of the Wind"];

const lastStep = (key) => key.split(" + ").at(-1);
export const untriggered = (key) => UNTRIGGERED.includes(lastStep(key));

// One step, on top of whatever the steps before it left.
async function step(rig, scene, name, notes) {
  const { world, kit } = rig;
  const holder = scene.holder.id;
  // A hit that lands by one: the holder and the ally have AC 12, the foe +4.
  const strike = async (targetId, faces) => {
    rig.foesTurn(scene);
    world.dice(...faces);
    return world.invoke("enemy_attack", { enemyId: scene.near.id, targetCharacterId: targetId });
  };
  const swing = async (faces) => {
    world.dice(...faces);
    return world.invoke("pc_attack", { characterId: holder, targetEnemyId: scene.near.id, weapon: "Longsword" });
  };
  const save = async (targetId) => {
    rig.foesTurn(scene);
    world.dice(1, 3, 3);
    return world.invoke("cast_at_player", { characterId: targetId, saveAbility: "wis", dc: 25, damage: "2d6", damageType: "psychic", source: "a glyph" });
  };
  // What a gate's step spent of the turn is given back: the gate is the
  // setting, not the thing under test.
  const refresh = () => {
    const encounter = world.encounter();
    if (encounter) rig.encounters.saveEncounter({ ...encounter, turnBudget: null, reactionsUsed: [] });
  };
  const fire = () => kit.setEnemy(scene.near.id, { stats: { attacks: [{ name: "Flame", toHit: 4, damage: "1d6+2", type: "fire" }] } });
  // A save the near foe forces on the holder (cast_at_player, the foe its caster).
  const forced = async (faces, args) => {
    rig.foesTurn(scene);
    world.dice(...faces);
    return world.invoke("cast_at_player", { characterId: holder, saveAbility: "wis", casterEnemyId: scene.near.id, ...args });
  };
  // A creature's turn ending, as the engine ends it when the pointer leaves it
  // (src/lib/dm/encounter-tools.ts advancePointer calls closeHitsAtTurnEnd).
  const endTurnOf = async (id) => {
    const { closeHitsAtTurnEnd } = await import(new URL("../../src/lib/dm/last-hit.ts", import.meta.url).href);
    const encounter = world.encounter();
    const entry = encounter.order.find((one) => (one.enemyId ?? one.characterId) === id);
    closeHitsAtTurnEnd(world.campaignId, encounter, entry);
  };
  if (name.startsWith("condition: ")) {
    // The condition a gate asks for, by the holder's own spend that lays it
    // when they have one, else laid by hand (said in the row's notes).
    const condition = name.slice("condition: ".length);
    const sheet = world.sheet(holder);
    const lays = rig.authored.heldAuthored(sheet).flatMap((held) => held.entry.spends ?? []).find((spend) => {
      const does = spend.does;
      return does.kind === "buff" && (does.target ?? "self") === "self" && (does.condition === condition || Object.values(does.variants ?? {}).includes(condition));
    });
    const counter = rig.resources.RESOURCE_DEFS.find((def) => sheet.resources[def.id] && (def.effect.kind === "buff" || def.effect.kind === "condition") && def.effect.condition === condition);
    const made = lays
      ? await world.invoke("use_resource", { characterId: holder, resource: lays.name, ...(lays.does.variants ? { variant: Object.entries(lays.does.variants).find(([, value]) => value === condition)?.[0] } : {}) })
      : counter ? await world.invoke("use_resource", { characterId: holder, resource: counter.id }) : null;
    if (!made?.ok || !world.sheet(holder).conditions.includes(condition)) {
      const now = world.sheet(holder);
      world.patch(holder, { conditions: [...now.conditions.filter((entry) => entry !== condition), condition], conditionMeta: { ...now.conditionMeta, [condition]: { rounds: 10 } } });
      notes.add(`"${condition}" was laid on the holder by hand${made ? ` (their own spend refused: ${String(made.error).slice(0, 120)})` : " (no spend of theirs lays it)"}`);
    }
    refresh();
    return { ok: true };
  }
  if (name.startsWith("mark: ")) {
    // The mark a reaction asks for on the creature it answers.
    const mark = name.slice("mark: ".length);
    const sheet = world.sheet(holder);
    const lays = mark === "vow of enmity"
      ? { name: "Channel Divinity", variant: "Vow of Enmity" }
      : rig.authored.heldAuthored(sheet).flatMap((held) => held.entry.spends ?? []).find((spend) => {
          // A condition may be a ladder by level ("hexblade's curse (+2)", "(+3)"...).
          const names = spend.does.kind !== "buff" ? [] : Array.isArray(spend.does.condition) ? spend.does.condition.map(([, value]) => value) : [spend.does.condition];
          return spend.does.kind === "buff" && (spend.does.mark === mark || names.some((value) => value === mark || value.startsWith(`${mark} (`)));
        });
    const made = lays ? await world.invoke("use_resource", { characterId: holder, resource: lays.name, ...(lays.variant ? { variant: lays.variant } : {}), targetEnemyId: scene.near.id }) : null;
    if (!made?.ok) notes.add(`the mark "${mark}" could not be laid${made ? `: ${String(made.error).slice(0, 120)}` : " (no spend of theirs lays it)"}`);
    refresh();
    return { ok: true };
  }
  if (name.startsWith("pool down: ")) {
    const id = name.slice("pool down: ".length);
    const sheet = world.sheet(holder);
    const state = sheet.resources[id];
    if (state) world.patch(holder, { resources: { ...sheet.resources, [id]: { ...state, used: Math.min(state.max, state.used + 1) } } });
    return { ok: true };
  }
  if (name.startsWith("the foe is ")) {
    kit.setEnemy(scene.near.id, { stats: { type: name.slice("the foe is ".length) } });
    return { ok: true };
  }
  switch (name) {
    case "own turn, nothing staged":
      return { ok: true };
    case "a foe's turn, nothing staged":
      rig.foesTurn(scene);
      return { ok: true };
    case "the holder below half hit points":
      world.patch(holder, { currentHp: 30 });
      return { ok: true };
    case "the holder raging": {
      if (!world.sheet(holder).resources.rage) return { ok: false, error: "no rage to enter" };
      const out = await world.invoke("use_resource", { characterId: holder, resource: "rage" });
      refresh();
      return out;
    }
    case "the ally inspired": {
      const out = await world.invoke("use_resource", { characterId: holder, resource: "bardic_inspiration", targetCharacterId: scene.ally.id });
      refresh();
      return out;
    }
    case "then the holder's turn":
      kit.giveTurn(holder);
      return { ok: true };
    case "no fight":
      return world.invoke("end_encounter", { outcome: "truce" });
    case "a hit on the holder":
      return strike(holder, [9, 4]);
    case "a critical hit on the holder":
      return strike(holder, [20, 4, 4]);
    case "a fire hit on the holder":
      fire();
      return strike(holder, [9, 4]);
    case "a fire hit on the ally beside the holder":
      fire();
      return strike(scene.ally.id, [9, 4]);
    case "a miss on the holder":
      // A second foe beside the holder, for a miss turned onto another creature.
      kit.place(scene.far.id, 6, 6);
      return strike(holder, [2]);
    case "a hit on the ally beside the holder":
      return strike(scene.ally.id, [9, 4]);
    case "a hit that drops the holder to 0":
      world.patch(holder, { currentHp: 3 });
      return strike(holder, [9, 4]);
    case "a hit that drops the ally to 0":
      world.patch(scene.ally.id, { currentHp: 3 });
      return strike(scene.ally.id, [9, 4]);
    case "the holder failed a save":
      return save(holder);
    case "the ally failed a save":
      return save(scene.ally.id);
    case "the holder hit a foe":
      return swing([18, 5]);
    case "the holder missed a foe":
      return swing([2]);
    case "the holder killed a foe":
      kit.setEnemy(scene.near.id, { maxHp: 300, currentHp: 1 });
      return swing([18, 5]);
    case "the foe forced a save the holder failed":
      return forced([1, 3, 3], { dc: 25, damage: "2d6", damageType: "psychic" });
    case "the foe forced a save the holder made":
      return forced([19], { dc: 5, condition: "frightened" });
    case "the foe tried to charm the holder":
      return forced([1], { dc: 25, condition: "charmed" });
    case "the foe cast a spell at the holder":
    case "the foe's spell hurt the holder through a save":
      // A spell on its stat block, so the cast is its own.
      kit.setEnemy(scene.near.id, { stats: { spells: ["Sacred Flame"] } });
      {
        const out = await forced([1, 3, 3], { saveAbility: "dex", dc: 25, damage: "1d8", damageType: "radiant", spell: "Sacred Flame" });
        // The cast's ledger written once more as any later save writes it, so
        // the call under test is not read as changing it.
        refresh();
        return out;
      }
    case "a hit with advantage on the holder": {
      // Prone beside the foe: its melee attack has advantage.
      const now = world.sheet(holder);
      world.patch(holder, { conditions: [...now.conditions.filter((entry) => entry !== "prone"), "prone"] });
      return strike(holder, [9, 2, 4]);
    }
    case "the ally hit a foe":
      kit.giveTurn(scene.ally.id);
      world.dice(18, 5);
      return world.invoke("pc_attack", { characterId: scene.ally.id, targetEnemyId: scene.near.id });
    case "a foe ended its turn beside the holder":
      rig.foesTurn(scene);
      await endTurnOf(scene.near.id);
      kit.giveTurn(scene.ally.id);
      return { ok: true };
    case "a foe's turn began beside the holder":
      kit.giveTurn(scene.ally.id);
      await endTurnOf(scene.ally.id);
      rig.foesTurn(scene);
      return { ok: true };
    case "the holder used Action Surge":
      if (!world.sheet(holder).resources.action_surge) return { ok: false, error: "no Action Surge to use" };
      return world.invoke("use_resource", { characterId: holder, resource: "action_surge" });
    case "the holder used Step of the Wind":
      if (!world.sheet(holder).resources.ki) return { ok: false, error: "no ki for Step of the Wind" };
      return world.invoke("take_action", { characterId: holder, action: "dash", bonus: true });
    case "the holder's drake summoned":
      return world.invoke("summon_pet", { characterId: holder, kind: "drake", form: "drake", essence: "fire" });
    default:
      throw new Error(`no staging step called "${name}"`);
  }
}

export async function staged(rig, scene, key) {
  scene.staged ??= new Map();
  scene.stagedNotes ??= new Map();
  if (scene.staged.has(key)) return scene.staged.get(key);
  rig.reader.restore(scene.snapshot);
  rig.world.clearDice();
  const notes = new Set();
  let made = null;
  for (const name of key.split(" + ")) {
    const out = await step(rig, scene, name, notes);
    rig.world.clearDice();
    if (out?.ok === false) {
      made = { failed: `${name}: ${String(out.error ?? "refused")}` };
      break;
    }
  }
  rig.world.diceLog();
  made ??= { snapshot: rig.reader.snapshot() };
  scene.staged.set(key, made);
  scene.stagedNotes.set(key, [...notes]);
  return made;
}

// ---- doors ----

const targets = (scene) => [
  ["no target", {}],
  ["the foe beside them", { targetEnemyId: scene.near.id }],
  ["the hurt ally", { targetCharacterId: scene.ally.id }],
  ["the ally at 0", { targetCharacterId: scene.fallen.id }],
  ["the second foe", { targetEnemyId: scene.far.id }],
];

const short = (text, length = 220) => (text && text.length > length ? `${text.slice(0, length)}…` : text ?? "");

// A door tried down its ladder: each staging, each variant, each target,
// until one is accepted. Every refusal that wrote something is kept.
export async function knock(rig, scene, { stagings, variants = [undefined], call, aims = [0, 1, 2, 3] }) {
  const tries = [];
  const spentOnRefusal = [];
  const stagingFailures = [];
  const ladder = targets(scene);
  for (const key of stagings) {
    const from = await staged(rig, scene, key);
    if (!from.snapshot) {
      stagingFailures.push(`${key}: ${from.failed}`);
      continue;
    }
    for (const variant of variants) {
      for (const [label, target] of aims.map((index) => ladder[index])) {
        const made = call({ ...target, ...(variant !== undefined ? { variant } : {}) });
        const tried = await rig.attempt(scene, from.snapshot, made.name, made.args);
        const read = readChanges(scene, tried.changes);
        const entry = { staging: key, variant, target: label, ok: tried.ok, kind: tried.kind, error: short(tried.error), threw: tried.threw, sig: signature(scene, tried), read, result: tried.result, call: made };
        tries.push(entry);
        if (!tried.ok && !tried.threw && (read.counters.length || read.cost.length || read.effects.length)) {
          spentOnRefusal.push(entry);
        }
        if (tried.ok || tried.threw) {
          return { accepted: tried.ok ? entry : null, threw: tried.threw ? entry : null, tries, spentOnRefusal, stagingFailures };
        }
      }
    }
  }
  return { accepted: null, threw: null, tries, spentOnRefusal, stagingFailures };
}

// The same rung of the ladder through another door: what a second door is
// compared with.
export async function replay(rig, scene, entry, call) {
  const from = scene.staged.get(entry.staging);
  const target = Object.fromEntries(targets(scene))[entry.target];
  const made = call({ ...target, ...(entry.variant !== undefined ? { variant: entry.variant } : {}) });
  const tried = await rig.attempt(scene, from.snapshot, made.name, made.args);
  return { staging: entry.staging, ok: tried.ok, kind: tried.kind, error: short(tried.error), threw: tried.threw, sig: signature(scene, tried), read: readChanges(scene, tried.changes), result: tried.result, call: made };
}

// ---- reading an accepted call ----

// What every spend's result carries; anything else is the engine saying it
// did something.
const STANDARD = new Set(["ok", "resource", "spent", "left", "refills", "effect", "cost", "returns", "reaction", "note", "turnBegun", "hp"]);
// Said in the result and kept where the database does not show it: a
// teleport's credit lives in memory until the token is moved
// (src/lib/dm/feature-teleport.ts), and a spell moved to the bonus action is a
// mark among the turn's own (src/lib/dm/resource-turn.ts castMarkCharge).
const KEPT_ELSEWHERE = ["teleport", "next"];

// What an accepted call earns when nothing but the counter and the cost
// moved, or null when the spend did something (or its text promised nothing).
export function judge(row, entry) {
  if (!entry?.ok) return null;
  const { read, result } = entry;
  if (read.effects.length || read.rolls) return null;
  // A counter other than the row's own moving, or its own coming back, is the spend doing something.
  if (read.counters.some((change) => !(row.own ?? []).includes(change.path.split(".")[0]) || (typeof change.before === "number" && change.after < change.before))) return null;
  // A call that takes nothing and does nothing costs nobody anything.
  if (!read.counters.length && !read.cost.length) return null;
  if (KEPT_ELSEWHERE.some((key) => result?.[key])) return null;
  const said = Object.keys(result ?? {}).filter((key) => !STANDARD.has(key));
  const moved = `only ${[read.counters.length ? "the counter" : "", read.cost.length ? "the turn's cost" : ""].filter(Boolean).join(" and ") || "nothing"} moved`;
  if (result?.resolveWith) {
    return { code: "HANDS_BACK", detail: `${moved}: the result hands the numbers back for ${result.resolveWith} (${short(JSON.stringify(result), 220)}), and nothing is rolled or applied until someone makes that second call` };
  }
  if (row.typed) {
    return said.length
      ? { code: "REPORTED_ONLY", detail: `${moved}, though the result says ${said.map((key) => `${key}: ${short(String(typeof result[key] === "string" ? result[key] : JSON.stringify(result[key])), 140)}`).join("; ")}` }
      : { code: "DEAD", detail: `${moved} on a row the engine resolves (${row.typed})` };
  }
  if (!statesMechanic(row.text)) return null;
  return row.elsewhere?.length
    ? { code: "SPENT_FOR_NOTHING", detail: `${moved}; the effect is another path's (${row.elsewhere.slice(0, 3).join(", ")}), and this door takes the use without it` }
    : { code: "GUIDANCE_ONLY", detail: `${moved}; the text states a mechanic and the result is its guidance alone${said.length ? ` (${said.map((key) => `${key}: ${short(String(result[key]), 120)}`).join("; ")})` : ""}` };
}

// ---- the Hand ----

// The intent a card posts once the player has aimed it and made its pick.
export function cardIntents(scene, card) {
  const aim =
    card.target === "enemy"
      ? { targetId: scene.near.id, targetKind: "enemy", targetName: scene.near.name }
      : card.target === "ally"
        ? { targetId: scene.ally.id, targetKind: "ally", targetName: scene.ally.name }
        : card.target === "self"
          ? { targetId: scene.holder.id, targetKind: "self" }
          : {};
  const picks = card.choice?.options?.length ? card.choice.options.slice(0, 3).map((option) => ({ [card.choice.arg]: option.value })) : [{}];
  return picks.map((pick) => ({ ...card.intent, ...aim, ...pick }));
}

// One card played the way the Hand sends it: its own call.
export async function playCard(rig, scene, from, intent, actorId = scene.holder.id) {
  const calls = rig.directCardCalls(intent, actorId, { inFight: true });
  if (!calls?.length) return { leftToGm: true };
  // A feature or a reaction card is one call.
  const tried = await rig.attempt(scene, from, calls[0].name, calls[0].args);
  return { ok: tried.ok, kind: tried.kind, error: short(tried.error), threw: tried.threw, sig: signature(scene, tried), read: readChanges(scene, tried.changes), result: tried.result, call: calls[0] };
}

export { short };
