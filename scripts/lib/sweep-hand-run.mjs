// The Hand sweep's walk and its six properties (see FINDERS.md, package
// "hand"): every class and subclass, every state, every card.
//
// A ROW is one property asked of one card of one character in one state:
//   id = `${prop}|${subclass}@${level}|${state}|${card.id}${variant}`
// and its verdict is ok, a failure with what the engine did, or a skip with a
// written reason. scripts/lib/sweep-hand-known.mjs holds the rows that fail
// today; sweepSuite() runs those through gap() and every other through test().
//
// The properties:
//   P1  an ENABLED card played through its own intent is never refused and
//       never answered "try again" (and its intent parses);
//   P2  a card shut with a reason is refused by the engine when the same
//       call is forced;
//   P3  the to-hit bonus, the damage dice and the save DC on the card are the
//       ones the engine rolled;
//   P4  the cost pill is the part of the turn the engine spent;
//   P5  the range and target the card shows are the reach the engine holds
//       (a foe at 30 and at 100 feet, an ally at 30 and at 100 feet, the
//       holder's own "(you)" chip on an ally card, a foe that cannot be seen);
//   P6  the hit-odds preview carries the advantage the roll got;
//   P7  what the engine takes from this character has a card (a counter with
//       uses left, an authored spend).
import assert from "node:assert/strict";
import fs from "node:fs";
import { suite } from "./enforce-harness.mjs";
import { FOE_TYPES, STATES, everyBuild, flatOf, handRig, rangeFeet, sameTerms, termsOf } from "./sweep-hand.mjs";

const RANGE_STATES = { "foe-30ft": 30, "foe-100ft": 100 };

const refusedBy = (played) => {
  if (played.pre) return { how: "route", error: played.pre, retry: false };
  const failed = (played.calls ?? []).find((call) => !call.ok);
  return failed ? { how: failed.name, error: failed.error, retry: failed.retry, refused: failed.refused } : null;
};

const TYPE_WORDS = /\b(undead|beasts?|fiends?|fey|plants?|celestials?|elementals?|aberrations?|humanoids?)\b|Nothing .* affects is within/i;

const short = (text) => String(text ?? "").replace(/\s+/g, " ").slice(0, 220);

// Dice a card names beside its headline, which the engine may add when they
// apply: "Sneak Attack +10d6 once a turn", "+1d8 radiant".
function optionalDice(card) {
  const out = [];
  for (const match of `${card.rules ?? ""} ${card.description ?? ""}`.matchAll(/\+\s?(\d+)d(\d+)/g)) {
    out.push({ count: Number(match[1]), size: match[2] });
  }
  return out;
}

function damageAgrees(card, expression, extra = []) {
  const want = termsOf(card.damage);
  const got = termsOf(expression);
  if (sameTerms(want, got)) return true;
  if (want.flat !== got.flat) return false;
  const optional = [...optionalDice(card), ...extra];
  const sizes = new Set([...Object.keys(want.dice), ...Object.keys(got.dice)]);
  for (const size of sizes) {
    const over = (got.dice[size] ?? 0) - (want.dice[size] ?? 0);
    if (over === 0) continue;
    const counts = optional.filter((entry) => entry.size === size).map((entry) => entry.count);
    const sums = new Set([0]);
    for (const count of counts) for (const sum of [...sums]) sums.add(sum + count);
    if (!sums.has(over)) return false;
  }
  return true;
}

// The verdicts for one play of one card. Each is { prop, ok, msg } or
// { prop, skip }.
export function judge({ state, card, played, variant, heroId, riderCards = [] }) {
  const out = [];
  const enabled = !card.disabled;
  if (played.skip) return [{ prop: enabled ? "P1" : "P2", skip: played.skip }];
  if (played.parse) return [{ prop: "P1", ok: false, msg: `the card's own intent does not parse: ${played.parse}` }];
  const refusal = refusedBy(played);
  const accepted = !refusal && !played.left;
  const feet = RANGE_STATES[state];
  // An area laid on a square is held to the range like a creature aimed at;
  // one that starts at the caster (a cone, a line, a burst around them) is
  // pointed, not ranged.
  const pointed = card.area && card.area.pick !== "point" && card.area.pick !== "wall";
  const aimed = (card.target === "enemy" || card.target === "ally") && !pointed;
  const reach = rangeFeet(card.range);

  if (played.left) {
    out.push({ prop: enabled ? "P1" : "P2", skip: "the engine leaves this card to the GM: directCardCalls gives no call for it" });
    return out;
  }

  if (enabled && played.withheld) {
    // The card leaves this creature's chip off its aim bar (it cannot be
    // seen): the engine, forced, must refuse it too.
    out.push(accepted
      ? { prop: "P5", ok: false, msg: `the card withholds the chip ("${short(played.withheld)}"), and the engine takes it when forced (${played.calls.map((call) => call.name).join(", ")})` }
      : { prop: "P5", ok: true });
    return out;
  }
  if (enabled) {
    if (variant === ":self") {
      // The holder's own chip on an ally card.
      out.push(accepted
        ? { prop: "P5", ok: true }
        : { prop: "P5", ok: false, msg: `the card offers the holder's own "(you)" chip and the engine refuses it there (${refusal.how}): ${short(refusal.error)}` });
      return out;
    }
    if (feet && aimed && played.aim && played.aim.kind !== "self") {
      if (reach === null) {
        out.push({ prop: "P5", skip: `the card's range line ("${card.range}") names no distance to hold the engine to` });
      } else if (reach >= feet) {
        out.push(accepted
          ? { prop: "P5", ok: true }
          : { prop: "P5", ok: false, msg: `the card says ${card.range}, its ${played.aim.kind} stands ${feet} ft away, and the engine refuses (${refusal.how}): ${short(refusal.error)}` });
      } else {
        out.push(accepted
          ? { prop: "P5", ok: false, msg: `the card says ${card.range}, its ${played.aim.kind} stands ${feet} ft away, and the engine takes it (${played.calls.map((call) => call.name).join(", ")})` }
          : { prop: "P5", ok: true });
        if (!accepted) return out;
      }
    } else if (feet && pointed && refusal) {
      out.push({ prop: "P5", skip: "an area that starts at the caster, with nobody inside it at this distance" });
      return out;
    } else if (feet && !aimed && reach !== null && reach < feet && refusal) {
      // A feature around the holder with nobody inside its reach.
      out.push({ prop: "P5", ok: true });
      return out;
    } else if (state === "foe-invisible" && card.target === "enemy" && refusal) {
      out.push({ prop: "P5", ok: false, msg: `the card is open and offers the unseen foe's chip, and the engine refuses (${refusal.how}): ${short(refusal.error)}` });
      return out;
    } else {
      out.push(accepted
        ? { prop: "P1", ok: true }
        : { prop: "P1", ok: false, msg: `open in the Hand, ${refusal.retry ? 'answered "try again"' : "refused"} by ${refusal.how}: ${short(refusal.error)}` });
    }
  } else {
    if (variant) return out;
    // The engine may take a shut card by paying for it another way (a rogue's
    // Dash with the action spent goes on Cunning Action's bonus action): the
    // turn paid, so the rule held.
    const paid = accepted && played.before && ["action", "bonus", "reaction"].some((part) => part !== card.cost && !played.before[part] && played.after[part]);
    out.push(accepted && !paid
      ? { prop: "P2", ok: false, msg: `shut in the Hand ("${short(card.disabled)}"), taken by the engine when forced (${played.calls.map((call) => call.name).join(", ")})` }
      : { prop: "P2", ok: true });
    return out;
  }
  if (!accepted) return out;

  // P4: the cost pill against the turn's budget.
  if (state !== "out-of-fight" && played.before && !variant.startsWith(":rider")) {
    const { before, after } = played;
    const moved = {
      action: (!before.action && after.action) || after.attacks > before.attacks || after.extra < before.extra,
      bonus: (!before.bonus && after.bonus) || after.flurry < before.flurry,
      reaction: !before.reaction && after.reaction,
    };
    const spent = Object.entries(moved).filter(([, did]) => did).map(([name]) => name);
    const said = card.cost;
    let problem = null;
    if (said === "action" || said === "bonus" || said === "reaction") {
      if (!moved[said]) problem = `the card says ${said} and the engine spent ${spent.length ? spent.join(" and ") : "nothing of the turn"}`;
      else if (spent.length > 1 && !(said === "action" && card.intent.card === "attack")) problem = `the card says ${said} and the engine spent ${spent.join(" and ")}`;
    } else if (said === "free" && spent.length && !card.interaction) {
      problem = `the card says free and the engine spent ${spent.join(" and ")}`;
    }
    out.push(problem ? { prop: "P4", ok: false, msg: problem } : { prop: "P4", ok: true });
  }

  // P3 and P6: the dice. A roll that waits on its player (a choice after the
  // d20, the table's own dice) has not been made yet.
  if (/"_parked":true|"awaitingRoll":true/.test(JSON.stringify(played.calls))) {
    out.push({ prop: "P3", skip: "the roll is parked for the player's choice (the dice sweep's windows)" });
    return out;
  }
  const mine = (roll) => roll.characterId === heroId || roll.attacker?.id === heroId;
  const attackRoll = played.rolls.find((roll) => roll.kind === "attack" && mine(roll));
  const damageRoll = played.rolls.find((roll) => roll.kind === "damage" && mine(roll));
  if (card.toHit !== null && card.toHit !== undefined && !card.save) {
    if (!attackRoll) {
      out.push({ prop: "P3", ok: false, msg: `the card shows ${card.roll || card.toHit} and the engine threw no attack roll (rolls: ${played.rolls.map((roll) => `${roll.kind} ${roll.expression}`).join("; ") || "none"})` });
    } else {
      const flat = flatOf(attackRoll);
      const otherDice = attackRoll.terms.filter((term) => term.kind === "dice" && term.sides !== 20).map((term) => `${term.sign < 0 ? "-" : "+"}${term.count}d${term.sides}`);
      // The dice the card names beside its bonus (toHitDice, "+1d4" while
      // blessed) must be exactly the ones rolled: a card with none names none.
      out.push(flat === card.toHit && sameTerms(termsOf(otherDice.join("")), termsOf(card.toHitDice ?? ""))
        ? { prop: "P3", ok: true }
        : { prop: "P3", ok: false, msg: `to hit: the card shows ${card.toHit >= 0 ? "+" : ""}${card.toHit}, the engine rolled ${attackRoll.expression}` });
      const row = (played.preview ?? []).find((entry) => entry.key === "To hit");
      if (row && played.aim?.kind === "enemy") {
        const shown = / · (advantage|disadvantage)/.exec(row.value)?.[1] ?? "none";
        out.push(shown === attackRoll.advantage
          ? { prop: "P6", ok: true }
          : { prop: "P6", ok: false, msg: `the preview reads "${row.value}" (${shown}) and the roll was made with ${attackRoll.advantage} (${attackRoll.expression})` });
      }
    }
  }
  if (card.damage && !card.heals && card.intent.card !== "rider") {
    const riderDice = riderCards.flatMap((rider) => (rider.damage ? [...rider.damage.matchAll(/(\d+)d(\d+)/g)].map((match) => ({ count: Number(match[1]), size: match[2] })) : []));
    const damageRolls = played.rolls.filter((roll) => roll.kind === "damage" && mine(roll));
    const said = JSON.stringify(played.calls);
    if (damageRoll) {
      // A spell of two damage types rolls each; a flat bonus the engine adds
      // after the dice is in its answer, not in the roll (Empowered Evocation).
      const summed = damageRolls.map((roll) => roll.expression).join("+");
      const flatLeft = termsOf(card.damage).flat - termsOf(damageRoll.expression).flat;
      // Both forms: one roll with the bonus, or a two-type spell's two rolls
      // summed with it (Empowered Evocation on Ice Storm's hail and cold).
      const noted = flatLeft > 0 && new RegExp(`\\+${flatLeft}\\b`).test(said)
        && [damageRoll.expression, summed].some((rolled) => damageAgrees({ ...card, damage: `${rolled}+${flatLeft}` }, card.damage, riderDice));
      out.push(damageAgrees(card, damageRoll.expression, riderDice) || damageAgrees(card, summed, riderDice) || noted
        ? { prop: "P3", ok: true }
        : { prop: "P3", ok: false, msg: `damage: the card shows ${card.damage}, the engine rolled ${damageRolls.map((roll) => roll.expression).join(" and ")}` });
    } else if (!played.rolls.length && card.intent.card !== "attack" && !/pending|awaiting/i.test(said)) {
      out.push({ prop: "P3", ok: false, msg: `the card shows ${card.dice || card.damage} and the engine rolled nothing: ${short(said)}` });
    }
  }
  if (card.damage && card.heals) {
    const want = termsOf(card.damage);
    const matched = played.rolls.some((roll) => sameTerms(want, termsOf(roll.expression)));
    if (played.rolls.length) {
      out.push(matched
        ? { prop: "P3", ok: true }
        : { prop: "P3", ok: false, msg: `healing: the card shows ${card.damage}, the engine rolled ${played.rolls.map((roll) => roll.expression).join(" and ")}` });
    }
  }
  if (card.save?.dc) {
    const saves = played.rolls.filter((roll) => roll.kind === "saving_throw" && typeof roll.dc === "number" && !roll.characterId && !/concentration/i.test(roll.detail ?? ""));
    if (saves.length) {
      const off = saves.find((roll) => roll.dc !== card.save.dc);
      out.push(off
        ? { prop: "P3", ok: false, msg: `save: the card shows DC ${card.save.dc}, the engine asked DC ${off.dc} (${off.detail})` }
        : { prop: "P3", ok: true });
    }
  }
  return out;
}

// Walks one class. Returns { rows, seconds, builds }.
export async function walkClass(classId, { levels = [20], states = STATES, only = null, part = null } = {}) {
  // `part` is [which, of how many]: a class with many casters is walked in
  // several suites, each a slice of its subclasses in the tables' order.
  const all = everyBuild(classId, levels);
  const size = part ? Math.ceil(all.length / part[1]) : all.length;
  const builds = all
    .filter((build, index) => !part || Math.floor(index / size) === part[0])
    .filter((build) => !only || only.includes(build.subclass));
  return walkBuilds(classId, builds, { states });
}

// Walks a list of characters ({ classId, subclass, level, key, extra }) as
// one group. With `baseline` (a character of the same class without what
// the group adds: no feat, a plain human, no item), only the cards the
// baseline does not hold the same way are judged: what the feat, the species
// or the item dealt or changed.
export async function walkBuilds(group, builds, { states = STATES, baseline = null } = {}) {
  const rig = await handRig();
  const { heldAuthored, gateHolds } = await rig.src("lib/srd/authored-effects.ts");
  const { resourceDef } = await rig.src("lib/srd/class-resources.ts");
  const rows = [];
  const started = Date.now();
  const classId = group;
  const face = (card) => JSON.stringify({ ...card, id: undefined, intent: card.intent, answers: undefined, actor: undefined }).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "id");
  const plain = new Map();
  if (baseline) {
    const table = await rig.seat(baseline);
    for (const state of states) {
      await rig.inState(table, state, async (reason) => {
        if (reason) return;
        const dealt = rig.deal(table);
        plain.set(state, { cards: new Map(dealt.cards.map((card) => [card.id.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "hero"), face(card)])), resources: new Set(Object.keys(dealt.sheet.resources)) });
      });
    }
  }
  const added = (state, card) => {
    const before = plain.get(state);
    return !baseline || !before || before.cards.get(card.id.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "hero")) !== face(card);
  };
  for (const build of builds) {
    const table = await rig.seat(build);
    // A reaction card's id ends in the id of the character it answers for.
    const stable = (id) => id.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "hero");
    const push = (state, card, variant, verdict) =>
      rows.push({ id: `${verdict.prop}|${build.key}|${state}|${stable(card.id)}${variant}`, classId, build: build.key, state, card: stable(card.id), name: card.name, variant, ...verdict });
    for (const state of states) {
      await rig.inState(table, state, async (reason) => {
        if (reason) {
          rows.push({ id: `P1|${build.key}|${state}|*`, classId, build: build.key, state, card: "*", name: "*", variant: "", prop: "P1", skip: reason });
          return;
        }
        const dealt = rig.deal(table);
        const attackCard = dealt.cards.find((card) => card.intent.card === "attack" && !card.intent.offHand && !card.disabled && card.melee && card.cost === "action");
        for (const card of dealt.cards) {
          if (!added(state, card)) continue;
          if (card.intent.card === "rider") {
            // A rider goes with a swing: the first open melee attack card.
            if (!attackCard) {
              push(state, card, "", { prop: card.disabled ? "P2" : "P1", skip: "no open melee attack card for the rider to ride" });
              continue;
            }
            const played = await rig.play(table, dealt, attackCard, { riders: [card] });
            for (const verdict of judge({ state, card: { ...attackCard, id: card.id, disabled: card.disabled }, played, variant: ":rider", heroId: table.hero.id, riderCards: [card] })) {
              push(state, card, ":rider", verdict);
            }
            continue;
          }
          let played = await rig.play(table, dealt, card);
          // A refusal over what kind of creature stands there is the table's,
          // not the card's: the card is tried against each kind.
          const first = refusedBy(played);
          if (!card.disabled && first && TYPE_WORDS.test(first.error)) {
            for (const type of FOE_TYPES) {
              const again = await rig.withFoeType(table, type, async () => {
                const redealt = rig.deal(table);
                const same = redealt.cards.find((entry) => entry.id === card.id);
                return same && !same.disabled ? rig.play(table, redealt, same) : null;
              });
              if (again && !refusedBy(again) && !again.left && !again.skip) {
                played = again;
                break;
              }
            }
          }
          for (const verdict of judge({ state, card, played, variant: "", heroId: table.hero.id })) push(state, card, "", verdict);
          if (state !== "fresh" || card.disabled) continue;
          // Ready with its trigger said and the card's own first pick (an
          // attack): the engine is asked whether it would have taken it.
          if (card.id === "basic:ready" && played.left) {
            const taken = await rig.rolledBack(() => table.world.invoke("take_action", { characterId: table.hero.id, action: "ready", trigger: "the goblin moves toward me" }));
            push(state, card, ":left", taken.ok
              ? { prop: "P7", ok: false, msg: `take_action takes Ready with a trigger and nothing named (an attack), and the card's first pick, "An attack", is left to the GM: ${short(JSON.stringify(taken.result))}` }
              : { prop: "P7", ok: true });
          }
          // The holder's own chip on an ally card that does not leave it out.
          if (card.target === "ally" && !card.othersOnly && !(card.intent.card === "basic" && (card.intent.action === "stabilize" || card.intent.action === "help")) && card.intent.card !== "gear") {
            const self = await rig.play(table, dealt, card, { aimAt: "self" });
            for (const verdict of judge({ state, card, played: self, variant: ":self", heroId: table.hero.id })) push(state, card, ":self", verdict);
          }
          // Each option an attack card offers open.
          for (const option of card.options ?? []) {
            if (option.disabled) continue;
            const with_ = await rig.play(table, dealt, card, { choices: { options: [option.id] } });
            for (const verdict of judge({ state, card, played: with_, variant: `:opt:${option.id}`, heroId: table.hero.id })) {
              if (verdict.prop === "P4") continue;
              push(state, card, `:opt:${option.id}`, verdict);
            }
          }
        }
        if (state !== "fresh") return;
        // P7: what the engine takes from this character has a card.
        const sheet = dealt.sheet;
        const key = rig.textKey;
        const cardFor = (id, name) =>
          dealt.cards.some((card) =>
            card.pool === id ||
            (card.intent.card === "feature" && (card.intent.resourceId === id || key(card.intent.resourceId ?? "") === key(name))) ||
            (card.intent.card === "reaction" && key(card.intent.feature ?? "") === key(name)) ||
            (card.intent.card === "rider" && key(card.intent.rider ?? "") === key(name)) ||
            key(card.name) === key(name) || key(card.name).startsWith(`${key(name)} `) || key(card.name).startsWith(`${key(name)}:`) ||
            (card.options ?? []).some((option) => key(option.label) === key(name)) ||
            new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(card.resource ?? ""));
        const probe = async (resource) => {
          for (const args of [{}, { targetEnemyId: table.near.id }, { targetCharacterId: table.ally.id }]) {
            const taken = await rig.rolledBack(() => table.world.invoke("use_resource", { characterId: table.hero.id, resource, ...args }));
            if (taken.ok) return { args, result: taken.result };
          }
          return null;
        };
        for (const [id, pool] of Object.entries(sheet.resources)) {
          if (baseline && plain.get(state)?.resources.has(id)) continue;
          const def = resourceDef(id);
          const name = def?.displayName ?? id;
          const row = { id: `P7|${build.key}|fresh|resource:${id}`, classId, build: build.key, state, card: `resource:${id}`, name, variant: "", prop: "P7" };
          if (pool.max - pool.used <= 0) {
            rows.push({ ...row, skip: "no use left at level 20 as built" });
          } else if (cardFor(id, name)) {
            rows.push({ ...row, ok: true });
          } else {
            const taken = await probe(id);
            rows.push(taken
              ? { ...row, ok: false, msg: `use_resource takes "${id}" (${name}) with ${JSON.stringify(taken.args)} and the Hand deals no card for it: ${short(JSON.stringify(taken.result))}` }
              : { ...row, ok: true });
          }
        }
        for (const held of baseline ? [] : heldAuthored(sheet)) {
          for (const spend of held.entry.spends ?? []) {
            if (spend.fight === "out" || !gateHolds(spend.gate, sheet, held)) continue;
            const row = { id: `P7|${build.key}|fresh|spend:${spend.name}`, classId, build: build.key, state, card: `spend:${spend.name}`, name: spend.name, variant: "", prop: "P7" };
            if (cardFor(spend.pool?.id ?? "", spend.name)) {
              rows.push({ ...row, ok: true });
              continue;
            }
            const taken = spend.action === "reaction" ? null : await probe(spend.name);
            rows.push(taken
              ? { ...row, ok: false, msg: `use_resource takes the authored spend "${spend.name}" (${spend.action ?? "action"}) with ${JSON.stringify(taken.args)} and the Hand deals no card for it: ${short(JSON.stringify(taken.result))}` }
              : spend.action === "reaction" ? { ...row, skip: "a reaction: dealt when its trigger comes (the reactions suite)" } : { ...row, ok: true });
          }
        }
      });
    }
    table.world.close();
  }
  return { rows, seconds: Math.round((Date.now() - started) / 100) / 10, builds: builds.length };
}

// ---- the suite ----

// A known row's key is `${prop}|${character}|${states}|${card}`: the
// character may be "*" (every character of the suite that holds the card),
// and the states "*" or a list ("fresh,prone,grappled"). The entry naming
// the row's own character wins over one that leaves it open.
function knownIndex(known) {
  const index = new Map();
  for (const key of Object.keys(known)) {
    const [prop, build, states, ...rest] = key.split("|");
    const at = `${prop}|${rest.join("|")}`;
    const list = index.get(at) ?? [];
    list.push({ key, build, states: states === "*" ? null : new Set(states.split(",")) });
    index.set(at, list);
  }
  return (row) => {
    const [prop, build, state, ...rest] = row.id.split("|");
    const list = (index.get(`${prop}|${rest.join("|")}`) ?? []).filter((entry) => (entry.build === build || entry.build === "*") && (!entry.states || entry.states.has(state)));
    return (list.find((entry) => entry.build === build) ?? list[0])?.key ?? null;
  };
}

// Runs one suite: its known rows (KNOWN[name]) through gap(), every other
// through test(). With SWEEP_HAND_DUMP set, every row is appended to that
// file as a JSON line (the triage's input).
export async function sweepSuite(name, classId, known, options = {}) {
  const { test, gap, finish } = suite(name);
  if (process.env.SWEEP_HAND_ONLY) options = { ...options, only: process.env.SWEEP_HAND_ONLY.split("|") };
  if (process.env.SWEEP_HAND_STATES) options = { ...options, states: process.env.SWEEP_HAND_STATES.split("|") };
  if (process.env.SWEEP_HAND_LEVELS) options = { ...options, levels: process.env.SWEEP_HAND_LEVELS.split("|").map(Number) };
  const { rows, seconds, builds } = options.builds
    ? await walkBuilds(classId, options.builds, options)
    : await walkClass(classId, options);
  for (const row of rows) row.suite = name;
  if (process.env.SWEEP_HAND_DUMP) {
    fs.appendFileSync(process.env.SWEEP_HAND_DUMP, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  }
  const skipped = rows.filter((row) => row.skip);
  const judged = rows.filter((row) => !row.skip);
  const byKnown = new Map(Object.keys(known).map((key) => [key, []]));
  const loose = [];
  const knownFor = knownIndex(known);
  for (const row of judged) {
    const key = knownFor(row);
    if (key) byKnown.get(key).push(row);
    else loose.push(row);
  }
  for (const [key, matched] of byKnown) {
    const meta = known[key];
    await gap(`${name}:${key}`, { rule: meta.rule, where: meta.where, severity: meta.severity, note: meta.note }, () => {
      const failing = matched.filter((row) => !row.ok);
      if (!matched.length) throw new Error(`no row matches the known gap ${key}: the card or the state is gone, so drop the entry`);
      assert.equal(failing.length, 0, `${failing.length} of ${matched.length} rows fail, first ${failing[0]?.id}: ${failing[0]?.msg}`);
    });
  }
  // Every other row, one test each for a failure and one for all that hold.
  for (const row of loose.filter((entry) => !entry.ok)) {
    await test(row.id, () => assert.fail(`${row.name}: ${row.msg}`));
  }
  await test(`${classId}: ${loose.filter((row) => row.ok).length} rows hold`, () => {});
  const reasons = {};
  for (const row of skipped) reasons[row.skip] = (reasons[row.skip] ?? 0) + 1;
  console.log(`${name}: ${builds} characters, ${rows.length} rows in ${seconds}s; ${judged.length} judged, ${skipped.length} skipped`);
  for (const [reason, count] of Object.entries(reasons)) console.log(`  SKIP ${count}: ${reason}`);
  finish();
}
