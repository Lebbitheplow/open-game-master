// The rows of the "spends" sweep and the suite that walks them
// (scripts/test-enforce-sweep-spends-*.mjs). scripts/lib/sweep-spends.mjs says
// what is walked; the codes a row can earn are listed in WHERE below.
//
//   SWEEP_SPENDS_DUMP=<dir>    writes <dir>/<suite>.json: every row, every door,
//                              every code with what was seen, for a person to read.
//   SWEEP_SPENDS_ONLY=<regex>  walks only the rows whose id matches.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { suite } from "./enforce-harness.mjs";
import { openSpendsRig, signature, statesMechanic } from "./sweep-spends.mjs";
import { FAMILIES, opensWithTrigger, statedRecharge, tableRows } from "./sweep-spends-rows.mjs";
import { staged, knock, replay, judge, cardIntents, playCard, untriggered, UNTRIGGERED, TRIGGERS, OWN_TURN, short } from "./sweep-spends-walk.mjs";
import { KNOWN, RULINGS, SKIP } from "./sweep-spends-known.mjs";

// ---- one row ----

const summary = (entry) => (entry ? { staging: entry.staging, variant: entry.variant, target: entry.target, ok: entry.ok, kind: entry.kind, error: entry.error, threw: entry.threw, sig: entry.sig, result: entry.result ? short(JSON.stringify(entry.result), 500) : undefined, call: entry.call } : null);
const wrote = (played) => played.read.counters.length || played.read.cost.length || played.read.effects.length;

export async function walkRow(rig, scene, row) {
  const codes = new Map();
  const notes = [];
  const doors = {};
  const add = (code, detail) => {
    if (!codes.has(code)) codes.set(code, short(detail, 700));
  };
  const holder = scene.holder.id;
  const reactor = row.reactor === "ally" ? scene.ally.id : holder;
  const keyed = (base) => [...row.prefix, base].join(" + ");
  const resourceCall = (resource) => (extra) => ({ name: "use_resource", args: { characterId: holder, resource, ...row.extra, ...extra } });
  const collect = (label, knocked) => {
    for (const entry of knocked.spentOnRefusal) {
      add("SPENT_ON_REFUSAL", `${label}, ${entry.staging}, ${entry.target}: refused ("${entry.error}") yet ${entry.sig}`);
    }
    if (knocked.threw) add("THROWS", `${label}, ${knocked.threw.staging}: ${knocked.threw.threw}`);
    // A gate no staging can open for this holder is the row's to say, not a broken staging.
    for (const failure of knocked.stagingFailures) notes.push(`not staged: ${failure}`);
  };
  const noteStaging = (entry) => {
    for (const note of scene.stagedNotes?.get(entry.staging) ?? []) notes.push(note);
  };

  // Two counters under one name: the name resolves to one of them.
  if (row.kind === "counter") {
    const byName = rig.resources.matchResource(row.def.displayName);
    const byId = rig.resources.matchResource(row.def.id);
    if (byId?.id !== row.def.id) add("NAME_TAKEN", `the id "${row.def.id}" resolves to ${byId?.id ?? "nothing"}`);
    else if (byName?.id !== row.def.id) add("NAME_TAKEN", `the name "${row.def.displayName}" resolves to ${byName?.id ?? "nothing"} (${byName?.displayName ?? ""}), so a call by name spends or refuses the other counter`);
  }
  // A spend whose pool the holder's sheet never carries.
  if (row.pool && !scene.holder.resources[row.pool.id] && !(row.pool.fallback && scene.holder.resources[row.pool.fallback]) && !rig.resources.resourceDef(row.pool.id)?.atWill) {
    add("POOL_MISSING", `${row.name} spends from "${row.pool.id}", and the holder (${scene.holder.class} ${scene.holder.subclass} ${scene.holder.level}) carries no such counter: ${Object.keys(scene.holder.resources).join(", ") || "none"}`);
  }

  const bases = row.reaction ? [...UNTRIGGERED, ...TRIGGERS] : [...OWN_TURN];
  const stagings = bases.map(keyed);

  // use_resource by each of its names; the first is the one the others are held to.
  let first = null;
  if (row.kind !== "reaction") {
    first = await knock(rig, scene, { stagings, variants: row.variants, call: resourceCall(row.doors[0]) });
    collect(`use_resource "${row.doors[0]}"`, first);
    doors[row.doors[0]] = summary(first.accepted ?? first.tries.at(-1));
    if (first.accepted) {
      noteStaging(first.accepted);
      const verdict = judge(row, first.accepted);
      if (verdict) add(verdict.code, `use_resource "${row.doors[0]}" (${first.accepted.staging}, ${first.accepted.target}): ${verdict.detail}`);
      if (row.reaction && untriggered(first.accepted.staging)) {
        add("TRIGGER_UNCHECKED", `use_resource "${row.doors[0]}" is accepted on ${first.accepted.staging}: ${first.accepted.sig}`);
      }
      // Refused the moment the save failed and taken only once the holder's turn came.
      if (first.accepted.staging.endsWith("then the holder's turn")) {
        const earlier = first.tries.find((entry) => entry.staging === first.accepted.staging.replace(" + then the holder's turn", "") && /turn, not/.test(entry.error ?? ""));
        if (earlier) add("OWN_TURN_ONLY", `on ${earlier.staging} it is refused ("${earlier.error}"), and it is accepted only once the holder's own turn has come: ${first.accepted.sig}`);
      }
      // Its text rides a hit, and it is taken after a miss and not after a hit.
      if (first.accepted.staging.endsWith("the holder missed a foe") && /\b(?:a hit lets|when you hit|after a hit|on a hit|you hit)\b/i.test(row.text)) {
        const afterHit = first.tries.filter((entry) => entry.staging.endsWith("the holder hit a foe")).map((entry) => entry.error);
        add("WRONG_TRIGGER", `accepted after the holder missed (${first.accepted.sig}) and refused after they hit: ${[...new Set(afterHit)].join(" | ")}`);
      }
    }
    for (const other of row.doors.slice(1)) {
      const call = resourceCall(other);
      let second;
      if (first.accepted) {
        second = await replay(rig, scene, first.accepted, call);
      } else {
        const knocked = await knock(rig, scene, { stagings, variants: row.variants, call });
        collect(`use_resource "${other}"`, knocked);
        second = knocked.accepted ?? knocked.tries.at(-1);
      }
      doors[other] = summary(second);
      const a = first.accepted ?? first.tries.at(-1);
      if (second && a && second.sig !== a.sig && (first.accepted || second.ok)) {
        // Twice more, so an order effect in memory is not read as a drift.
        const again = first.accepted ? await replay(rig, scene, first.accepted, resourceCall(row.doors[0])) : null;
        const other2 = first.accepted ? await replay(rig, scene, first.accepted, call) : second;
        if (!again || (again.sig === a.sig && other2.sig === second.sig)) {
          add("ID_NAME_DRIFT", `"${row.doors[0]}": ${a.ok ? a.sig : `${a.kind} ("${a.error}")`} BUT "${other}": ${second.ok ? second.sig : `${second.kind} ("${second.error}")`}`);
        } else {
          notes.push(`"${other}" differed once and not on replay`);
        }
      }
    }
    // A pool's option by the pool's name with the option as its variant.
    if (row.poolDoor && first.accepted && first.accepted.variant === undefined) {
      const from = scene.staged.get(first.accepted.staging);
      const sent = first.accepted.call.args;
      const args = { characterId: holder, resource: row.poolDoor, variant: row.name, ...(sent.targetEnemyId ? { targetEnemyId: sent.targetEnemyId } : {}), ...(sent.targetCharacterId ? { targetCharacterId: sent.targetCharacterId } : {}) };
      const tried = await rig.attempt(scene, from.snapshot, "use_resource", args);
      const sig = signature(scene, tried);
      doors[`${row.poolDoor} + variant`] = { ok: tried.ok, kind: tried.kind, error: short(tried.error), sig };
      if (sig !== first.accepted.sig) add("ID_NAME_DRIFT", `"${row.name}": ${first.accepted.sig} BUT "${row.poolDoor}" with variant "${row.name}": ${tried.ok ? sig : `${tried.kind} ("${short(tried.error)}")`}`);
    }
  }

  // The Hand, on the holder's turn, in the staging the spend was accepted in.
  const cardStaging = first?.accepted && !row.reaction ? first.accepted.staging : keyed("own turn, nothing staged");
  let cardAccepted = false;
  if (!cardStaging.endsWith("no fight")) {
    const from = await staged(rig, scene, cardStaging);
    doors.cards = [];
    if (from.snapshot) {
      rig.reader.restore(from.snapshot);
      const sheet = rig.world.sheet(holder);
      const cards = rig.deriveHand(sheet, rig.turnOf(sheet, true), {}).filter(row.cardMatch);
      if (!cards.length) notes.push(`no card on the holder's turn (${cardStaging})`);
      for (const card of cards.slice(0, 5)) {
        if (card.disabled) {
          doors.cards.push({ card: card.id, disabled: card.disabled });
          continue;
        }
        if (card.compose) {
          doors.cards.push({ card: card.id, compose: true });
          notes.push(`card ${card.id} is finished in the composer (an amount typed), so it posts no call of its own`);
          continue;
        }
        for (const intent of cardIntents(scene, card)) {
          const played = await playCard(rig, scene, from.snapshot, intent);
          doors.cards.push({ card: card.id, cost: card.cost, target: card.target, intent, leftToGm: played.leftToGm, ...(played.leftToGm ? {} : summary({ ...played, staging: cardStaging })) });
          if (played.leftToGm) {
            notes.push(`card ${card.id} makes no call of its own (left to the GM)`);
            continue;
          }
          if (played.threw) {
            add("THROWS", `card ${card.id}: ${played.threw}`);
          } else if (!played.ok) {
            if (wrote(played)) add("SPENT_ON_REFUSAL", `card ${card.id}: refused ("${played.error}") yet ${played.sig}`);
            if (played.kind === "retry") add("NEEDS_PICK", `card ${card.id} is open (target "${card.target}"${card.choice ? ", with a pick" : ", no pick"}), and its own call ${JSON.stringify(played.call.args).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>")} is sent back: "${played.error}"`);
            else notes.push(`card ${card.id} is open and the engine refuses it: ${played.error}`);
          } else {
            cardAccepted = true;
            const verdict = judge(row, played);
            if (verdict) add(verdict.code, `card ${card.id} (${cardStaging}): ${verdict.detail}`);
            if (untriggered(cardStaging) && (row.reaction || (opensWithTrigger(row.lead) && (row.typed || statesMechanic(row.text))))) {
              add("TRIGGER_AS_CARD", `card ${card.id} (cost ${card.cost}) is open on the holder's own turn with nothing staged, and its call is accepted: ${played.sig}`);
            }
            // The same call as the door by name (not another option of the pool) must do the same.
            const same = played.call.name === "use_resource" && row.doors.includes(played.call.args.resource) && (played.call.args.variant ?? undefined) === first?.accepted?.variant;
            if (same && first?.accepted && first.accepted.staging === cardStaging && Boolean(judge(row, first.accepted)) !== Boolean(verdict)) {
              add("CARD_DRIFT", `by name: ${first.accepted.sig} BUT card ${card.id}: ${played.sig}`);
            }
          }
        }
      }
    }
  }

  // use_reaction, after each trigger a table can stage.
  let reacted = false;
  if (row.reaction) {
    const useReaction = (extra) => ({ name: "use_reaction", args: { characterId: reactor, feature: row.name, ...row.extra, ...extra } });
    const accepted = [];
    const refusals = new Map();
    doors.reaction = {};
    for (const base of [...UNTRIGGERED, ...TRIGGERS]) {
      const key = keyed(base);
      const knocked = await knock(rig, scene, { stagings: [key], variants: row.variants, call: useReaction, aims: [0, 1, 2, 4] });
      collect(`use_reaction "${row.name}"`, knocked);
      if (knocked.accepted) {
        accepted.push(knocked.accepted);
        noteStaging(knocked.accepted);
        doors.reaction[base] = summary(knocked.accepted);
      } else {
        for (const entry of knocked.tries) refusals.set(entry.error, (refusals.get(entry.error) ?? 0) + 1);
        doors.reaction[base] = { ok: false, errors: [...new Set(knocked.tries.map((entry) => entry.error))] };
      }
    }
    reacted = accepted.length > 0;
    const loose = accepted.filter((entry) => untriggered(entry.staging));
    const answered = accepted.filter((entry) => !untriggered(entry.staging));
    if (loose.length) {
      add("TRIGGER_UNCHECKED", `use_reaction "${row.name}" is accepted on ${loose.map((entry) => entry.staging).join(" and on ")} (${loose[0].target}): ${loose[0].sig}`);
    }
    const judged = answered.length ? answered : loose;
    const verdicts = judged.map((entry) => judge(row, entry));
    if (judged.length && verdicts.every(Boolean)) {
      add(verdicts[0].code, `use_reaction "${row.name}" (${judged.map((entry) => entry.staging).join("; ")}): ${verdicts[0].detail}`);
    }
    notes.push(accepted.length
      ? `use_reaction accepted on: ${accepted.map((entry) => `${entry.staging} (${entry.target})`).join("; ")}`
      : `use_reaction refused on every staging: ${[...refusals.keys()].slice(0, 4).join(" | ")}`);
    // The reaction strip: the card the Hand deals when the trigger comes.
    const offered = [];
    for (const base of TRIGGERS) {
      const key = keyed(base);
      const from = await staged(rig, scene, key);
      if (!from.snapshot) continue;
      rig.reader.restore(from.snapshot);
      const sheet = rig.world.sheet(reactor);
      const hits = rig.activePublicEncounter(rig.world.campaignId)?.lastHits ?? [];
      const strip = rig.reactionCards(sheet, rig.turnOf(sheet, false), hits, rig.world.sheets(), "you").filter(row.cardMatch);
      for (const card of strip.slice(0, 2)) {
        if (card.disabled) continue;
        offered.push(base);
        const played = await playCard(rig, scene, from.snapshot, cardIntents(scene, card)[0], reactor);
        if (played.leftToGm) continue;
        if (played.threw) {
          add("THROWS", `reaction card ${card.id} on ${base}: ${played.threw}`);
        } else if (!played.ok) {
          if (wrote(played)) add("SPENT_ON_REFUSAL", `reaction card ${card.id} on ${base}: refused ("${played.error}") yet ${played.sig}`);
          notes.push(`reaction card ${card.id} is dealt on ${base} and refused: ${played.error}`);
        } else {
          reacted = true;
          const verdict = judge(row, played);
          if (verdict && !answered.some((entry) => !judge(row, entry))) add(verdict.code, `reaction card ${card.id} on ${base}: ${verdict.detail}`);
        }
      }
    }
    notes.push(offered.length ? `reaction card dealt on: ${[...new Set(offered)].join("; ")}` : "no reaction card on any staged trigger");
  }

  if (!first?.accepted && !cardAccepted && !reacted) {
    const said = first?.tries?.length ? [...new Set(first.tries.map((entry) => entry.error))].slice(0, 4).join(" | ") : notes.find((note) => note.startsWith("use_reaction refused")) ?? "";
    // A counter the engine spends on its own is refused by design.
    if (row.passive && !row.reaction) notes.push(`passive: refused as it should be (${short(said, 160)})`);
    else if (!codes.has("POOL_MISSING")) add("UNREACHED", `no door and no staging got it accepted: ${said}`);
    // What each gate's step did, for whoever reads why.
    for (const key of stagings) for (const note of scene.stagedNotes?.get(key) ?? []) notes.push(note);
  }

  // A counter comes back on the rest its row names.
  if (row.kind === "counter" && !row.def.atWill && !row.def.into) {
    const rests = await refills(rig, scene);
    const state = scene.holder.resources[row.def.id];
    const level = scene.holder.level;
    const recharge = row.def.rechargeFor ? row.def.rechargeFor(level) : row.def.recharge;
    if (state && state.max > 0 && state.max < 90 && !row.def.noRefill && !row.def.recovers) {
      if (rests.long.ok && rests.long.used[row.def.id] > 0) add("NO_REFILL", `spent to ${state.max}/${state.max}, a long rest leaves ${rests.long.used[row.def.id]} used`);
      if (rests.short.ok && (rests.short.used[row.def.id] === 0) !== (recharge === "short")) {
        add("SHORT_REST_MISMATCH", `its row says it comes back on a ${recharge} rest, and a short rest leaves ${rests.short.used[row.def.id]}/${state.max} used`);
      }
      if (!rests.long.ok || !rests.short.ok) notes.push(`rest refused: ${rests.short.error ?? ""} ${rests.long.error ?? ""}`);
    }
    const stated = statedRecharge(row.featureText);
    if (stated && !row.def.rechargeFor && stated !== row.def.recharge) {
      add("RECHARGE_TEXT_MISMATCH", `the feature text says a ${stated} rest and the counter's row says ${row.def.recharge}`);
    }
  }

  const build = row.build;
  return { id: row.id, kind: row.kind, name: row.name, build: `${build.classId}/${build.subclass ?? ""} ${build.level}${build.race ? ` ${build.race}` : ""}${build.feats?.length ? ` +${build.feats.join(",")}` : ""}${build.pick ? ` [${build.pick.feature}: ${build.pick.value}]` : ""}`, rule: row.rule, typed: row.typed, elsewhere: row.elsewhere, codes: Object.fromEntries(codes), notes: [...new Set(notes)], doors };
}

async function refills(rig, scene) {
  if (scene.refills) return scene.refills;
  const { world } = rig;
  const holder = scene.holder.id;
  rig.reader.restore(scene.snapshot);
  await world.invoke("end_encounter", { outcome: "truce" });
  const spendAll = () => {
    const sheet = world.sheet(holder);
    world.patch(holder, { resources: Object.fromEntries(Object.entries(sheet.resources).map(([id, state]) => [id, { ...state, used: state.max }])) });
  };
  const used = () => Object.fromEntries(Object.entries(world.sheet(holder).resources).map(([id, state]) => [id, state.used]));
  spendAll();
  const brief = await world.invoke("take_rest", { kind: "short" });
  const afterShort = used();
  spendAll();
  const long = await world.invoke("take_rest", { kind: "long" });
  scene.refills = { short: { ok: brief.ok, error: brief.error, used: afterShort }, long: { ok: long.ok, error: long.error, used: used() } };
  return scene.refills;
}

// ---- the suite ----

// Every code, and the file that would have to change for it to go.
export const WHERE = {
  DEAD: "the resolver of the row's own effect (src/lib/dm/resource-tools.ts computeUseResource, src/lib/dm/authored-spend-effects.ts resolveSpendEffect, src/lib/dm/authored-reactions.ts)",
  GUIDANCE_ONLY: "src/lib/dm/resource-tools.ts computeUseResource (the narrative arm) and the row's fx in src/lib/srd/authored-resources.json or src/lib/classes/resources.json",
  SPENT_FOR_NOTHING: "src/lib/dm/mutations.ts use_resource (a plain spend of a counter another path resolves is accepted)",
  HANDS_BACK: "src/lib/dm/resource-tools.ts computeUseResource (the enemy_save and aoe arms) and src/lib/dm/authored-spend-effects.ts (aoe_report); src/lib/dm/intent-logic.ts directCardCall for the card",
  REPORTED_ONLY: "the resolver that reports the effect and writes nothing (src/lib/dm/authored-spend-effects.ts, src/lib/dm/authored-reactions.ts)",
  SPENT_ON_REFUSAL: "the handler that refused after writing (src/lib/dm/mutations.ts use_resource, src/lib/dm/reaction-tools.ts useReaction)",
  ID_NAME_DRIFT: "src/lib/dm/mutations.ts use_resource and src/lib/dm/authored-spends.ts authoredFeatureSpend (the name lookup)",
  NAME_TAKEN: "src/lib/srd/class-resources.ts matchResource and the two rows that share the name",
  CARD_DRIFT: "src/lib/battlemap/hand-spells.ts featureCards and src/lib/dm/intent-logic.ts directCardCall",
  NEEDS_PICK: "the card's choice and target (src/lib/battlemap/hand-spells.ts featureCards, hand-subclass.ts spendCards, hand-options.ts)",
  TRIGGER_AS_CARD: "src/lib/battlemap/hand-spells.ts featureCards (dealt on the holder's turn) and src/lib/dm/resource-turn.ts prepareResourceCharge (no trigger asked)",
  TRIGGER_UNCHECKED: "src/lib/dm/reaction-tools.ts useReaction, src/lib/dm/authored-reactions.ts and src/lib/dm/resource-turn.ts prepareResourceCharge (a reaction with no open trigger)",
  OWN_TURN_ONLY: "src/lib/dm/feature-spends.ts spend (a cost of \"none\" still asks canAct for the holder's own turn) and src/lib/dm/can-act.ts",
  WRONG_TRIGGER: "src/lib/dm/authored-spend-more.ts swarmPush (the once-a-turn key the damage rider already holds after a hit) and src/lib/dm/pc-attack rider",
  POOL_MISSING: "the counter's match terms (src/lib/srd/authored-resources.json) against the feature names the class tables grant (src/lib/srd/class-resources.ts populateResources)",
  ORPHAN: "the counter's match terms (src/lib/srd/authored-resources.json, src/lib/srd/class-resources.ts) against the feature names the class tables grant",
  UNREACHED: "the row's own gate, or the sweep's stagings (scripts/lib/sweep-spends-walk.mjs)",
  THROWS: "the handler named in the stack",
  NO_REFILL: "src/lib/srd/resource-refills.ts refillResources",
  SHORT_REST_MISMATCH: "src/lib/srd/resource-refills.ts refillResources",
  RECHARGE_TEXT_MISMATCH: "the counter's row (recharge) in src/lib/srd/authored-resources.json or src/lib/classes/resources.json",
};

const buildKey = (build) => JSON.stringify([build.classId, build.subclass ?? "", build.level, build.race ?? "", build.feats ?? [], build.pick ?? null]);

export async function runSweep(family) {
  const name = `test-enforce-sweep-spends-${family}`;
  const { test, gap, finish } = suite(name);
  const started = Date.now();
  const rig = await openSpendsRig();
  const only = process.env.SWEEP_SPENDS_ONLY ? new RegExp(process.env.SWEEP_SPENDS_ONLY) : null;
  const rows = (await tableRows(rig)).filter(FAMILIES[family]).filter((row) => !only || only.test(row.id));
  const walked = [];
  const skipped = [];
  const groups = new Map();
  for (const row of rows) {
    if (SKIP[row.id]) {
      skipped.push(row.id);
      continue;
    }
    // A counter nothing grants has no holder to build: that is its finding.
    if (!row.build) {
      const named = rig.authored.authoredRows().filter((entry) => entry.entry.counter === row.def.id || (entry.entry.spends ?? []).some((spend) => spend.pool?.id === row.def.id) || (entry.entry.reactions ?? []).some((reaction) => reaction.pool?.id === row.def.id));
      walked.push({
        row,
        result: {
          id: row.id, kind: row.kind, name: row.name, build: "none", rule: row.rule, typed: row.typed, doors: {}, notes: [],
          codes: { ORPHAN: `no class or subclass at any level, no species and no feat holds a feature named ${row.def.match.map((term) => `"${term}"`).join(" or ")}, so no sheet ever carries this counter${named.length ? `; ${named.map((entry) => entry.key).join(", ")} spends from it` : ""}` },
        },
      });
      continue;
    }
    const key = buildKey(row.build);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const group of groups.values()) {
    let scene;
    try {
      scene = await rig.stage(group[0].build);
    } catch (error) {
      for (const row of group) {
        await test(`${row.id}: a holder is built and a fight staged`, () => {
          throw error;
        });
      }
      continue;
    }
    for (const row of group) {
      try {
        walked.push({ row, result: await walkRow(rig, scene, row) });
      } catch (error) {
        await test(`${row.id}: the walk runs`, () => {
          throw error;
        });
      }
    }
  }

  let rulings = 0;
  for (const { row, result } of walked) {
    const known = KNOWN[row.id] ?? {};
    const ruled = RULINGS[row.id] ?? {};
    const seen = Object.keys(result.codes);
    for (const code of new Set([...seen, ...Object.keys(known), ...Object.keys(ruled)])) {
      const detail = result.codes[code];
      if (ruled[code]) {
        rulings += 1;
        await test(`${row.id}: ${code} is still what the written ruling describes`, () => assert.ok(detail, `the ruling (${ruled[code]}) covers a ${code} this row no longer shows: take its line out of RULINGS`));
      } else if (known[code]) {
        await gap(`${row.id}#${code}`, { rule: row.rule, where: WHERE[code] ?? "see the note", severity: known[code].severity, note: known[code].note ?? code }, () => {
          assert.ok(!detail, `${code}: ${detail}`);
        });
      } else {
        await test(`${row.id}: ${code}`, () => assert.fail(`${code} with no line in KNOWN (scripts/lib/sweep-spends-known.mjs): ${detail}`));
      }
    }
    if (!seen.length && !Object.keys(known).length) await test(row.id, () => {});
  }

  if (process.env.SWEEP_SPENDS_DUMP) {
    fs.mkdirSync(process.env.SWEEP_SPENDS_DUMP, { recursive: true });
    fs.writeFileSync(path.join(process.env.SWEEP_SPENDS_DUMP, `${name}.json`), JSON.stringify(walked.map(({ result }) => result), null, 1));
  }
  if (process.env.SWEEP_SPENDS_TIMES) console.log(`times: ${JSON.stringify(rig.times)}`);
  console.log(`${name}: ${walked.length} rows walked in ${groups.size} fights, ${skipped.length} skipped with a written reason, ${rulings} codes under a written ruling, ${Math.round((Date.now() - started) / 1000)} s`);
  rig.close();
  finish();
}

export { assert, FAMILIES, KNOWN, RULINGS, SKIP, tableRows };
