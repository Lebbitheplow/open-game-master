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
  // A spectral flame the holder's kill left, and the ally standing in it
  // (Cauterizing Flames, src/lib/dm/cauterizing-flames.ts).
  "the ally entered a spectral flame",
  // The triggers the engine records besides a hit (src/lib/dm/last-save.ts,
  // read through src/lib/srd/trigger-table.ts): once a reaction is held to
  // its record, these are what it answers.
  "the foe forced a save the holder failed",
  "the foe forced a save the holder made",
  "the foe tried to charm the holder",
  "the foe cast a spell at the holder",
  "a foe teleported",
  "the foe's spell hurt the holder through a save",
  "a hit with advantage on the holder",
  "the ally hit a foe",
  "a foe ended its turn beside the holder",
  "a foe's turn began beside the holder",
  "the holder used Action Surge",
  // The records the plumbing package added (last-save.ts recordCast,
  // recordInspiredSuccess): a spell the holder cast at the ally, a save the
  // ally made good with the holder's Bardic Inspiration die.
  "the holder cast a spell at the ally",
  "the ally made a save with the holder's inspiration",
];
// Not staged: a foe leaving the holder's reach (move_token resolves the
// opportunity attack itself and spends the reaction, so nothing is left open
// for a reaction to answer), a creature dying of something other than the
// holder's blow, and a save an enemy made.

// For a spend on the holder's own turn: as staged, then the states a spend may ask for.
// The last two come after "no fight", so a spend accepted earlier is still
// read where it was: they are for the uses that answer a kill or a step.
// "The holder smote a foe" is for what comes right after a Divine Smite
// (Inspiring Smite), after every staging an earlier spend was read at.
export const OWN_TURN = ["own turn, nothing staged", "the holder below half hit points", "the holder hit a foe", "the holder failed a save", "the holder failed a save + then the holder's turn", "the holder missed a foe", "no fight", "the holder killed a foe", "the holder used Step of the Wind", "the holder entered a rage", "the holder succeeded on a death save", "the holder stabilized the fallen ally with spare the dying", "the holder's echo was destroyed", "the holder smote a foe", "the ally entered a spectral flame", "the holder sneak attacked a foe", "the ally at 0 died", "the holder hit a foe with a chosen kensei weapon", "the holder struck unarmed, a chosen kensei weapon in hand", "the holder bought a Flurry of Blows", "the holder carries a soul trinket", "the holder sneak attacked a foe with a psychic blade", "the holder ran at a foe and hit it", "the holder frightened", "the holder clawed a foe while raging", "the holder shot a foe with a longbow", "the holder's wild surge is the teleport", "the holder's wild surge is the spirit", "the holder's wild surge is the bolt", "the holder's surge rolled twice", "a spell lies on the holder", "the holder holds a spirit tale", "no fight, tools in the holder's hands", "an item attuned to the holder", "no fight, the holder's choices unmade"];

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
  // The holder's own spend that lays a mark on a creature, laid on `enemyId`.
  const layMark = async (mark, enemyId) => {
    const sheet = world.sheet(holder);
    const lays = mark === "vow of enmity"
      ? { name: "Channel Divinity", variant: "Vow of Enmity" }
      : rig.authored.heldAuthored(sheet).flatMap((held) => held.entry.spends ?? []).find((spend) => {
          // A condition may be a ladder by level ("hexblade's curse (+2)", "(+3)"...).
          const names = spend.does.kind !== "buff" ? [] : Array.isArray(spend.does.condition) ? spend.does.condition.map(([, value]) => value) : [spend.does.condition];
          return spend.does.kind === "buff" && (spend.does.mark === mark || names.some((value) => value === mark || value.startsWith(`${mark} (`)));
        });
    const made = lays ? await world.invoke("use_resource", { characterId: holder, resource: lays.name, ...(lays.variant ? { variant: lays.variant } : {}), targetEnemyId: enemyId }) : null;
    if (!made?.ok) notes.add(`the mark "${mark}" could not be laid${made ? `: ${String(made.error).slice(0, 120)}` : " (no spend of theirs lays it)"}`);
    return made;
  };
  if (name.startsWith("mark: ")) {
    // The mark a reaction asks for on the creature it answers.
    await layMark(name.slice("mark: ".length), scene.near.id);
    refresh();
    return { ok: true };
  }
  if (name.startsWith("the creature under ") && name.endsWith(" died")) {
    // A death under the holder's mark (Master of Hexes answers it): the mark
    // laid on the second foe, brought beside the holder (and 5 feet from the
    // first), and that foe slain by the holder's own blow through pc_attack,
    // so the death is the engine's record, not a word in the call.
    const mark = name.slice("the creature under ".length, -" died".length);
    kit.place(scene.far.id, 6, 6);
    const made = await layMark(mark, scene.far.id);
    if (!made?.ok) return { ok: false, error: `the mark "${mark}" could not be laid` };
    refresh();
    kit.setEnemy(scene.far.id, { currentHp: 1 });
    world.dice(18, 5);
    const out = await world.invoke("pc_attack", { characterId: holder, targetEnemyId: scene.far.id, weapon: "Longsword" });
    if (!out.ok) return out;
    if ((world.enemies().find((enemy) => enemy.id === scene.far.id)?.currentHp ?? 0) > 0) return { ok: false, error: "the marked creature did not die" };
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
    // A spell's effect on the holder, for a use that ends one (Cleansing Touch).
    case "a spell lies on the holder": {
      const sheet = world.sheet(holder);
      world.patch(holder, { conditions: [...sheet.conditions, "blessed"], conditionMeta: { ...sheet.conditionMeta, blessed: { spell: "Bless", rounds: 10 } } });
      return { ok: true };
    }
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
    // The Right Tool for the Job asks for thieves' or artisan's tools in hand
    // and an hour out of a fight (src/lib/dm/mt-srd-artificer.ts).
    // A choice its rule changes only with a level (Storm Aura's environment,
    // src/lib/srd/level-up-changes.ts) is made in play only while unmade.
    case "no fight, the holder's choices unmade":
      world.patch(holder, { features: world.sheet(holder).features.map((feature) => ({ ...feature, name: feature.name.replace(/\s*\([^)]*\)\s*$/, "") })) });
      return world.invoke("end_encounter", { outcome: "truce" });
    // Soul of Artifice readies an attunement to end (src/lib/dm/soul-of-artifice.ts).
    case "an item attuned to the holder":
      world.patch(holder, { equipment: [...world.sheet(holder).equipment, { name: "Cloak of Protection", qty: 1, equipped: true, attuned: true }] });
      return { ok: true };
    case "no fight, tools in the holder's hands":
      world.patch(holder, { equipment: [...world.sheet(holder).equipment, { name: "Thieves' tools", qty: 1 }] });
      return world.invoke("end_encounter", { outcome: "truce" });
    // A College of Spirits bard's tale kept in mind (src/lib/dm/spirit-tales.ts),
    // which Release Tale plays.
    case "the holder holds a spirit tale":
      world.patch(holder, { conditions: [...world.sheet(holder).conditions, "spirit tale (1)"] });
      return { ok: true };
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
    // An arrow from a longbow in the near foe, which an Arcane Shot rides (and
    // the bow its two options with no attack roll are loosed from). The holder
    // is handed the bow; beside the foe it shoots at disadvantage, so both
    // d20s are laid. The turn is kept: its mark is what the spend asks for.
    case "the holder shot a foe with a longbow": {
      const sheet = world.sheet(holder);
      if (!sheet.equipment.some((item) => item.name === "Longbow")) {
        world.patch(holder, { equipment: [...sheet.equipment.map((item) => ({ ...item, equipped: false })), { name: "Longbow", qty: 1, equipped: true }, { name: "Arrows", qty: 20 }] });
      }
      world.dice(18, 18, 5);
      const out = await world.invoke("pc_attack", { characterId: holder, targetEnemyId: scene.near.id, weapon: "Longbow" });
      world.clearDice();
      return out;
    }
    // A run of two squares straight at the foe by the holder's own move, then
    // the hit: what rides a charge (Ferocious Charger) asks the turn for both.
    // The move is the player's own, through the board's route: the GM's
    // move_token walks a character only for a move their player declared.
    case "the holder ran at a foe and hit it": {
      kit.place(holder, 5, 3);
      const route = await world.route("campaigns/[campaignId]/battle-map/move");
      world.signIn({ id: world.sheet(holder).userId });
      const walked = await route.POST(
        new Request(`http://odm.test/api/campaigns/${world.campaignId}/battle-map/move`, { method: "POST", body: JSON.stringify({ x: 5, y: 5 }) }),
        { params: Promise.resolve({ campaignId: world.campaignId }) },
      );
      if (walked.status !== 200) return { ok: false, error: `the run was refused (${walked.status})` };
      return swing([18, 5]);
    }
    // A natural weapon's hit in the rage that grows it (Infectious Fury rides one).
    case "the holder clawed a foe while raging": {
      if (!world.sheet(holder).resources.rage) return { ok: false, error: "no rage to enter" };
      const raged = await world.invoke("use_resource", { characterId: holder, resource: "rage" });
      if (!raged.ok) return raged;
      world.dice(18, 5);
      return world.invoke("pc_attack", { characterId: holder, targetEnemyId: scene.near.id, weapon: "Claws" });
    }
    // A rage entered with the wild magic table's d8 forced (both dice, for a
    // holder of Controlled Surge, who then chooses it): the surge in force is
    // the effect whose bonus-action repeat is under test. The turn is given
    // back, the rage having taken its bonus action.
    case "the holder's wild surge is the teleport":
    case "the holder's wild surge is the spirit":
    case "the holder's wild surge is the bolt": {
      const effect = name.endsWith("teleport") ? 2 : name.endsWith("spirit") ? 3 : 8;
      if (!world.sheet(holder).resources.rage) return { ok: false, error: "no rage to enter" };
      world.dice(effect, effect, 2, 2, 2, 2);
      const raged = await world.invoke("use_resource", { characterId: holder, resource: "rage" });
      if (!raged.ok) return raged;
      if (world.sheet(holder).conditions.includes("wild surge pending")) {
        world.dice(2, 2, 2, 2);
        const chosen = await world.invoke("use_resource", { characterId: holder, resource: "Controlled Surge", variant: String(effect) });
        if (!chosen.ok) return chosen;
      }
      world.clearDice();
      refresh();
      return { ok: true };
    }
    // A Controlled Chaos surge's two rolls of the wild magic table, kept on
    // the sheet for the pick (src/lib/dm/ar-ws-wild-surge.ts).
    case "the holder's surge rolled twice": {
      const now = world.sheet(holder);
      world.patch(holder, { conditions: [...now.conditions.filter((entry) => entry !== "controlled chaos"), "controlled chaos"], conditionMeta: { ...now.conditionMeta, "controlled chaos": { faces: [1, 2] } } });
      refresh();
      return { ok: true };
    }
    // A condition a spend ends (Guarded Mind: charmed or frightened).
    case "the holder frightened": {
      const now = world.sheet(holder);
      world.patch(holder, { conditions: [...now.conditions.filter((entry) => entry !== "frightened"), "frightened"], conditionMeta: { ...now.conditionMeta, frightened: { rounds: 5 } } });
      return { ok: true };
    }
    case "the holder missed a foe":
      return swing([2]);
    case "the holder smote a foe":
      // A Divine Smite of a 1st-level slot rides the hit (2d8 radiant).
      if (!world.sheet(holder).spellcasting?.slots?.["1"]) return { ok: false, error: "no 1st-level slot to smite with" };
      world.dice(18, 5, 4, 4);
      return world.invoke("pc_attack", { characterId: holder, targetEnemyId: scene.near.id, weapon: "Longsword", smite: 1 });
    // A finesse blade at the second foe, brought beside the holder and the
    // hurt ally: the hit carries Sneak Attack, and the foe beside them (the
    // ladder's target) is the other creature within 30 feet, for what answers
    // a Sneak Attack on another creature (Wails from the Grave).
    // The ally at 0 dead an hour since, for a use that returns the dead to
    // life (Hand of Ultimate Mercy).
    case "the ally at 0 died":
      world.patch(scene.fallen.id, { deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
      return { ok: true };
    case "the holder sneak attacked a foe": {
      const held = world.sheet(holder);
      world.patch(holder, { equipment: [...(held.equipment ?? []), { name: "Dagger", qty: 1, equipped: true }] });
      kit.place(scene.far.id, 4, 6);
      world.dice(18, ...new Array(12).fill(3));
      return world.invoke("pc_attack", { characterId: holder, targetEnemyId: scene.far.id, weapon: "Dagger" });
    }
    case "the holder's spell hurt the foe": {
      // A wizard spell's damage through the real cast path (cast_at_enemy
      // marks the creature it hurt: src/lib/dm/spell-damage-mark.ts), for a
      // spend that rides it (Power Surge). The holder is given the spell
      // prepared and a slot to cast it with: what they prepared is the
      // setting, not the thing under test.
      const casting = world.sheet(holder).spellcasting;
      if (!casting) return { ok: false, error: "the holder casts no spells" };
      const slots = { ...casting.slots, 1: { max: Math.max(1, casting.slots?.[1]?.max ?? 0), used: 0 } };
      // The shield is lowered for the gestures and raised again after, so the
      // holder's AC is the scene's.
      const gear = world.sheet(holder).equipment;
      const shield = (equipped) => gear.map((item) => (item.name === "Shield" ? { ...item, equipped } : item));
      world.patch(holder, { equipment: shield(false), spellcasting: { ...casting, slots, prepared: [...new Set([...(casting.prepared ?? []), "Magic Missile"])], ...(casting.spellbook ? { spellbook: [...new Set([...casting.spellbook, "Magic Missile"])] } : {}) } });
      world.dice(1, 1, 1);
      const out = await world.invoke("cast_at_enemy", { characterId: holder, targetEnemyId: scene.near.id, spell: "Magic Missile" });
      world.patch(holder, { equipment: shield(true) });
      return out;
    }
    case "the holder cast a spell that opens the choice": {
      // A 1st-level transmutation spell through the real cast path, for a
      // choice that changes only when one is cast (Transmuter's Stone:
      // src/lib/dm/ar-ws-stone.ts). The spell and its slot are the setting.
      const casting = world.sheet(holder).spellcasting;
      if (!casting) return { ok: false, error: "the holder casts no spells" };
      const slots = { ...casting.slots, 1: { max: Math.max(1, casting.slots?.[1]?.max ?? 0), used: 0 } };
      // The shield is lowered for the spell's material and raised again after.
      const gear = world.sheet(holder).equipment;
      const shield = (equipped) => gear.map((item) => (item.name === "Shield" ? { ...item, equipped } : item));
      world.patch(holder, { equipment: shield(false), spellcasting: { ...casting, slots, prepared: [...new Set([...(casting.prepared ?? []), "Longstrider"])], ...(casting.spellbook ? { spellbook: [...new Set([...casting.spellbook, "Longstrider"])] } : {}) } });
      const out = await world.invoke("use_spell_slot", { characterId: holder, spell: "Longstrider" });
      world.patch(holder, { equipment: shield(true) });
      return out;
    }
    case "a spell in the holder's book": {
      // A 1st-level spell cast with an action, written in the book and
      // prepared, for a spend that copies one out of it (Master Scrivener).
      const casting = world.sheet(holder).spellcasting;
      if (!casting) return { ok: false, error: "the holder casts no spells" };
      world.patch(holder, { spellcasting: { ...casting, prepared: [...new Set([...(casting.prepared ?? []), "Magic Missile"])], ...(casting.spellbook ? { spellbook: [...new Set([...casting.spellbook, "Magic Missile"])] } : {}) } });
      return { ok: true };
    }
    case "the holder's spell healed them": {
      // A healing spell's dice through the real heal path (heal-spell.ts
      // notes the roll: src/lib/dm/ar-ws-empowered-healing.ts), for a spend
      // that rolls them again (Empowered Healing). The holder is hurt, and
      // given Cure Wounds and a slot: the setting, not the thing under test.
      // A 2 on the d8 is a die worth rolling again.
      const casting = world.sheet(holder).spellcasting;
      if (!casting) return { ok: false, error: "the holder casts no spells" };
      const slots = { ...casting.slots, 1: { max: Math.max(1, casting.slots?.[1]?.max ?? 0), used: 0 } };
      const gear = world.sheet(holder).equipment;
      const shield = (equipped) => gear.map((item) => (item.name === "Shield" ? { ...item, equipped } : item));
      world.patch(holder, { currentHp: Math.max(1, world.sheet(holder).currentHp - 20), equipment: shield(false), spellcasting: { ...casting, slots, prepared: [...new Set([...(casting.prepared ?? []), "Cure Wounds"])], known: [...new Set([...(casting.known ?? []), "Cure Wounds"])] } });
      world.dice(2);
      const out = await world.invoke("heal", { characterId: holder, casterId: holder, spell: "Cure Wounds" });
      world.patch(holder, { equipment: shield(true) });
      return out;
    }
    case "the holder killed a foe":
      kit.setEnemy(scene.near.id, { maxHp: 300, currentHp: 1 });
      return swing([18, 5]);
    case "the ally entered a spectral flame": {
      kit.setEnemy(scene.near.id, { maxHp: 300, currentHp: 1 });
      const out = await swing([18, 5]);
      const flames = world.sheet(holder).conditionMeta?.["spectral flames"]?.flames ?? [];
      if (!flames.length) return { ok: false, error: `no spectral flame was laid (${String(out.error ?? "").slice(0, 120)})` };
      kit.place(scene.ally.id, flames[0].x, flames[0].y);
      return out;
    }
    case "the foe forced a save the holder failed":
      return forced([1, 3, 3], { dc: 25, damage: "2d6", damageType: "psychic" });
    case "the foe forced a save the holder made":
      return forced([19], { dc: 5, condition: "frightened" });
    case "the foe tried to charm the holder":
      return forced([1], { dc: 25, condition: "charmed" });
    case "a foe teleported": {
      // A teleport on its stat block, made on its own turn (Magic-User's Nemesis).
      kit.setEnemy(scene.near.id, { stats: { spells: ["Misty Step"] } });
      rig.foesTurn(scene);
      const at = kit.token(scene.near.id);
      return world.invoke("move_token", { token: scene.near.id, x: at.x + 2, y: at.y + 2, teleport: true, spell: "Misty Step" });
    }
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
    // Way of the Kensei: the longsword the holder carries chosen as a kensei
    // weapon (the sheet's featChoices), then a hit with it (Deft Strike) or an
    // unarmed strike of the Attack action with it in hand (Agile Parry).
    case "the holder hit a foe with a chosen kensei weapon":
      world.patch(holder, { featChoices: { "Path of the Kensei": { weapons: ["Longsword", "Longbow"] } } });
      return swing([18, 5]);
    case "the holder struck unarmed, a chosen kensei weapon in hand":
      world.patch(holder, { featChoices: { "Path of the Kensei": { weapons: ["Longsword", "Longbow"] } } });
      world.dice(18, 3);
      return world.invoke("pc_attack", { characterId: holder, targetEnemyId: scene.near.id, weapon: "unarmed strike" });
    // The Attack action, then 1 ki for Flurry of Blows: its strikes are owed,
    // for what takes the place of one (Hand of Healing).
    case "the holder bought a Flurry of Blows": {
      if (!world.sheet(holder).resources.ki) return { ok: false, error: "no ki for Flurry of Blows" };
      const swung = await swing([18, 5]);
      if (!swung.ok) return swung;
      return world.invoke("use_resource", { characterId: holder, resource: "Ki", variant: "flurry of blows" });
    }
    // A Soulknife's own blade at the foe beside the holder, prone so the hit
    // carries Sneak Attack (Rend Mind answers it).
    case "the holder sneak attacked a foe with a psychic blade":
      kit.setEnemy(scene.near.id, { conditions: ["prone"] });
      world.dice(18, 18, ...new Array(14).fill(3));
      return world.invoke("pc_attack", { characterId: holder, targetEnemyId: scene.near.id, weapon: "psychic blade" });
    // A Phantom's soul trinket in hand, for what destroys one.
    case "the holder carries a soul trinket": {
      const held = world.sheet(holder);
      world.patch(holder, { conditions: [...held.conditions, "soul trinket"], conditionMeta: { ...held.conditionMeta, "soul trinket": { rounds: 14400 } } });
      return { ok: true };
    }
    case "the holder used Action Surge":
      if (!world.sheet(holder).resources.action_surge) return { ok: false, error: "no Action Surge to use" };
      return world.invoke("use_resource", { characterId: holder, resource: "action_surge" });
    case "the holder used Step of the Wind":
      if (!world.sheet(holder).resources.ki) return { ok: false, error: "no ki for Step of the Wind" };
      return world.invoke("take_action", { characterId: holder, action: "dash", bonus: true });
    case "the holder entered a rage":
      // Unlike "the holder raging", the turn is kept: its mark is the trigger
      // (action-budget.ts RAGE_ENTERED).
      if (!world.sheet(holder).resources.rage) return { ok: false, error: "no rage to enter" };
      return world.invoke("use_resource", { characterId: holder, resource: "rage" });
    case "the holder succeeded on a death save": {
      const { rollDeathSave } = await import(new URL("../../src/lib/dm/death.ts", import.meta.url).href);
      world.patch(holder, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
      world.dice(15);
      const line = rollDeathSave(world.campaign(), holder);
      return line && /success/.test(line) ? { ok: true } : { ok: false, error: `no successful death save: ${line}` };
    }
    case "the holder stabilized the fallen ally with spare the dying": {
      // The cantrip laid on the holder's sheet by hand when they lack it.
      const sheet = world.sheet(holder);
      const casting = sheet.spellcasting ?? { ability: "cha", slots: {}, prepared: [], known: [], cantrips: [] };
      if (!(casting.cantrips ?? []).includes("Spare the Dying")) {
        world.patch(holder, { spellcasting: { ...casting, cantrips: [...(casting.cantrips ?? []), "Spare the Dying"] } });
        notes.add("Spare the Dying was laid on the holder by hand");
      }
      const out = await world.invoke("stabilize", { characterId: scene.fallen.id, healerId: holder, method: "spell" });
      refresh();
      return out;
    }
    case "the holder's echo was destroyed": {
      // Manifest Echo, then the echo takes a hit meant for the ally (Shadow
      // Martyr) and is destroyed by it: a 19 beats AC 14 + the proficiency bonus.
      const manifest = await world.invoke("use_resource", { characterId: holder, resource: "Manifest Echo" });
      if (!manifest.ok) return manifest;
      refresh();
      const hit = await strike(scene.ally.id, [19, 4]);
      if (!hit.ok) return hit;
      return world.invoke("use_reaction", { characterId: holder, feature: "Shadow Martyr", targetCharacterId: scene.ally.id });
    }
    case "the holder cast a spell at the ally": {
      // Bless from a 1st-level slot, laid on the holder's sheet by hand when
      // they do not have it (the trigger is the casting, not the spell).
      const sheet = world.sheet(holder);
      const casting = sheet.spellcasting ?? { ability: "wis", slots: {}, prepared: [], known: [], cantrips: [] };
      const slots = { ...casting.slots, 1: { max: Math.max(1, casting.slots?.[1]?.max ?? 0), used: 0 } };
      if (!(casting.prepared ?? []).includes("Bless") || !casting.slots?.[1]) {
        world.patch(holder, { spellcasting: { ...casting, ability: casting.ability ?? "wis", slots, prepared: [...new Set([...(casting.prepared ?? []), "Bless"])] } });
        notes.add("Bless and a 1st-level slot were laid on the holder by hand");
      }
      const out = await world.invoke("cast_buff", { characterId: holder, spell: "Bless", targetCharacterIds: [scene.ally.id] });
      refresh();
      return out;
    }
    case "the ally made a save with the holder's inspiration": {
      if (!world.sheet(holder).resources.bardic_inspiration) return { ok: false, error: "no Bardic Inspiration to give" };
      const given = await world.invoke("use_resource", { characterId: holder, resource: "bardic_inspiration", targetCharacterId: scene.ally.id });
      if (!given.ok) return given;
      refresh();
      const die = world.sheet(scene.ally.id).conditions.map((entry) => /^bardic inspiration \(d(\d+)\)$/i.exec(entry)).find(Boolean);
      if (!die) return { ok: false, error: "the ally holds no Bardic Inspiration die" };
      const sides = Number(die[1]);
      const { computeSheetDerived } = await import(new URL("../../src/lib/srd/index.ts", import.meta.url).href);
      const mod = computeSheetDerived(world.sheet(scene.ally.id)).saves.wis;
      // A 10 falls short of the DC by the die's size; the die's top face makes
      // it. The ally rolls as a companion does, so the server adds the die
      // itself (forced-save.ts settleHeldDie) rather than waiting on a card.
      rig.foesTurn(scene);
      const { getDatabase } = await import(new URL("../../src/lib/db/core.ts", import.meta.url).href);
      const companion = (on) => getDatabase().prepare("UPDATE character_sheets SET is_companion = ? WHERE id = ?").run(on ? 1 : 0, scene.ally.id);
      companion(true);
      world.dice(10, sides);
      const out = await world.invoke("cast_at_player", { characterId: scene.ally.id, saveAbility: "wis", casterEnemyId: scene.near.id, dc: 10 + mod + sides, condition: "frightened" });
      companion(false);
      return out;
    }
    case "the holder's drake summoned":
      return world.invoke("summon_pet", { characterId: holder, kind: "drake", form: "drake", essence: "fire" });
    // A spend gated on a living companion (Exceptional Training's command:
    // src/lib/srd/authored-effects-types.ts Gate.pet).
    case "the holder's companion summoned":
      return world.invoke("summon_pet", { characterId: holder, kind: "beast_companion", form: "wolf" });
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
    // A door that names its options in its refusal ("needs a variant: a or
    // b") is asked again with the first of them, as a player would pick one.
    const asked = [...variants];
    for (const variant of asked) {
      for (const [label, target] of aims.map((index) => ladder[index])) {
        const made = call({ ...target, ...(variant !== undefined ? { variant } : {}) });
        const tried = await rig.attempt(scene, from.snapshot, made.name, made.args);
        const named = variant === undefined && !tried.ok ? /needs a variant: (.+?)(?: or |\. )/.exec(String(tried.error ?? ""))?.[1] : undefined;
        if (named && !asked.includes(named)) asked.push(named);
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

// The stop a hit opens before its damage is rolled, for the reactor's own
// player at the table: a reaction that turns the hit (the Cloud Rune,
// src/lib/dm/cloud-rune.ts) has no use_reaction after the damage, so its door
// is the stop's answer, invoked on the first creature it offers. The hit is
// struck as its staging strikes it, with the player subscribed; null when no
// stop opened for the reactor.
export const STOPPED = ["a hit on the holder", "a hit on the ally beside the holder"];
export async function stopDoor(rig, scene, reactorId, key) {
  const { world } = rig;
  const userId = world.sheet(reactorId)?.userId;
  if (!userId) return null;
  const { subscribe } = await import("../../src/lib/events.ts");
  const { listOpenPendingRolls } = await import("../../src/lib/db/dm-turns.ts");
  const { call } = await import("./enforce-campaign.mjs");
  const { settleQueue } = await import("./enforce-narrator.mjs");
  const watch = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/watch");
  rig.reader.restore(scene.snapshot);
  world.clearDice();
  const off = subscribe(world.campaignId, () => {}, userId);
  try {
    await step(rig, scene, key, new Set());
    world.clearDice();
    const stop = listOpenPendingRolls(world.campaignId).find((pending) => pending.parkedFor === "watch" && pending.characterId === reactorId);
    if (!stop) return null;
    world.signIn({ id: userId });
    const answered = await call(watch, "POST", { shift: true, ...((stop.watch?.choices?.length ?? 0) > 1 ? { choice: 0 } : {}) }, { campaignId: world.campaignId, pendingRollId: stop.id });
    await settleQueue(world.campaignId);
    const tried = { ok: answered.status === 200, kind: answered.status === 200 ? null : "refused", error: answered.status === 200 ? null : JSON.stringify(answered.json), changes: rig.reader.diff(scene.snapshot, rig.reader.snapshot()), result: answered.json };
    return { staging: `${key}, answered at its stop (${stop.watch?.power ?? "watch"})`, target: stop.watch?.choices?.[0]?.name ?? "no target", ok: tried.ok, kind: tried.kind, error: short(tried.error), sig: signature(scene, tried), read: readChanges(scene, tried.changes), result: tried.result };
  } finally {
    off();
    world.clearDice();
  }
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
  // A card that waits for a second creature (HandShares.min: Infectious
  // Fury's attack names the creature struck) goes with one, as the Hand
  // sends it only then (hand-play.ts handReady).
  const shares = (card.shares?.min ?? 0) > 1 && aim.targetId && scene.far
    ? { shares: [{ id: aim.targetId, name: aim.targetName, count: 1 }, { id: scene.far.id, name: scene.far.name, count: 1 }] }
    : {};
  return picks.map((pick) => ({ ...card.intent, ...aim, ...shares, ...pick }));
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
