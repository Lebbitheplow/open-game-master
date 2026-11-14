// The lineage traits a player spends through use_resource that a counter row
// alone cannot carry (src/lib/srd/races.json, the lineages' own trait lines):
//
//   - Shell Defense (tortle): "withdraw for +4 AC and save advantage, at the
//     cost of movement and actions". An action withdraws: the condition
//     "shell defense" (src/lib/srd/authored-conditions-mt-species.ts) holds
//     the +4, advantage on Strength and Constitution saves, disadvantage on
//     Dexterity saves, speed 0, no reactions and no action, and the tortle
//     is prone. A bonus action (variant 'emerge') ends it.
//   - Shapechanger (changeling): "alter your appearance as an action, no
//     action economy cost to revert". The action lays "shapechanged";
//     variant 'revert' ends it at no cost.
//   - Feline Agility (tabaxi): "double your speed for a turn, refreshed by
//     not moving". On their own turn, no action: "feline agility" doubles
//     the speed until that turn ends, and the use comes back at the
//     end of a turn on which they moved 0 feet (mt-species-turns.ts).
//   - Celestial Revelation (aasimar): the form named, a bonus action, a
//     minute; Necrotic Shroud's saves as it comes down.
//   - Rabbit Hop (rabbitfolk): a bonus action leaps the rabbitfolk to the
//     square named, up to 5 feet times the proficiency bonus in a straight
//     line, drawing no opportunity attack and spending none of the turn's
//     movement, while their speed is above 0. With no square named (a Hand
//     card) the use is paid and the leap waits on move_token, as a feature's
//     teleport does (feature-teleport.ts).
//   - Tainted Blood (a mutated derro's Otherworldly Influence, read from its
//     pack text by species-prose-logic.ts): a reaction to piercing or
//     slashing damage just taken, once a short rest; the derro and each
//     creature within 5 feet take necrotic damage equal to its level.
//   - Grovel, Cower, and Beg (kobold): an action, once a short rest; the
//     kobold is "groveling" until the end of its next turn, and allies'
//     attacks on foes within 10 feet of it have advantage (attack-spatial.ts
//     grovelingAllyNear, read by pc-attack-situation.ts).
//   - Shifting (shifter) with a subtype picked: the subtype's own form
//     ("shifted (beasthide)"...), Beasthide's extra 1d6 temporary hit points
//     with it. A shifter with no subtype on the sheet takes the counter's
//     own form through the generic spend.
//
// Called from the use_resource arm of src/lib/dm/mutations.ts before the
// generic path; must not import mutations.ts.
import { holdsTinker, tinker } from "@/lib/dm/rock-gnome-tinker";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, patchEnemyConditions } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { priceTheAction, publishSheet } from "@/lib/dm/combat-features";
import { ownTurnOf } from "@/lib/dm/held-turn";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { getDmTurn } from "@/lib/db/dm-turns";
import { computeSheetDerived, speedFor } from "@/lib/srd";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { FELINE_AGILITY, FELINE_AGILITY_COUNTER, GROVEL_COUNTER, GROVELING, RADIANCE, SHAPECHANGED, SHELL_DEFENSE, SHIFT_FORMS, SHIFTED, SHROUD, WINGS } from "@/lib/srd/authored-conditions-mt-species";
import { rollOwnDice } from "@/lib/dm/character-roll";
import { freshLastHit, writeLastHit, type LastHit } from "@/lib/dm/last-hit";
import { canReactNow } from "@/lib/dm/chronal-shift";
import { markReactionUsed } from "@/lib/dm/turn-budget";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { getBattleMapForEncounter, getTokenByRef, listTokens, moveToken } from "@/lib/db/battle-maps";
import { footprintLookup, occupiedTiles } from "@/lib/battlemap/view";
import { planLongJump } from "@/lib/srd/jump";
import { conditionSpeed } from "@/lib/srd/condition-effects";
import { releaseGrapplesOutOfReach } from "@/lib/dm/grapple";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { creditFeatureTeleport } from "@/lib/dm/feature-teleport";

// `x`, `y`: the square a leap lands on (Rabbit Hop).
export type SpeciesSpendArgs = { variant?: string; x?: number; y?: number };

export function speciesTraitSpend(
  campaign: Campaign,
  turnId: string,
  stale: CharacterSheet,
  resourceName: string,
  args: SpeciesSpendArgs,
): Record<string, unknown> | null {
  // A Hand card names its counter's id ("race_feline_agility"), a call the trait.
  const name = textKey(resourceName.replace(/_/g, " ")).replace(/^race /, "");
  const sheet = getSheetById(stale.id) ?? stale;
  if (name === "shell defense" && holdsFeature(sheet, "shell defense")) return shellDefense(campaign, sheet, args.variant);
  if (name === "shapechanger" && lineageShapechanger(sheet, args.variant)) return shapechanger(campaign, sheet, args.variant);
  if (name === "feline agility" && sheet.resources?.[FELINE_AGILITY_COUNTER]) return felineAgility(campaign, sheet);
  if (name === "celestial revelation" && sheet.resources?.[REVELATION_COUNTER]) return celestialRevelation(campaign, turnId, sheet, args.variant);
  // A rock gnome's clockwork devices (rock-gnome-tinker.ts).
  if (name === "tinker" && holdsTinker(sheet)) return tinker(campaign, sheet, args.variant);
  if (name === "tainted blood" && sheet.resources?.[TAINTED_BLOOD]) return taintedBlood(campaign, turnId, sheet);
  if (name === "rabbit hop" && sheet.resources?.[RABBIT_HOP]) return rabbitHop(campaign, sheet, args);
  if (/^grovel,? cower,? and beg$/.test(name) && sheet.resources?.[GROVEL_COUNTER]) return grovel(campaign, sheet);
  const form = shiftFormOf(sheet);
  if (name === "shifting" && form && sheet.resources?.[SHIFTING_COUNTER]) return shifting(campaign, sheet, form);
  return null;
}

const has = (sheet: CharacterSheet, condition: string) => sheet.conditions.some((entry) => textKey(entry) === textKey(condition));

// The sheet with a condition of its own laid or lifted, published.
function setOwn(campaign: Campaign, sheet: CharacterSheet, changes: Array<[string, Record<string, unknown> | null]>) {
  const fresh = getSheetById(sheet.id) ?? sheet;
  const named = new Set(changes.map(([condition]) => textKey(condition)));
  const kept = fresh.conditions.filter((entry) => !named.has(textKey(entry)));
  const meta = Object.fromEntries(Object.entries((fresh.conditionMeta ?? {}) as ConditionMetaMap).filter(([entry]) => !named.has(textKey(entry))));
  const laid = changes.filter(([, value]) => value !== null);
  patchSheet(fresh.id, {
    conditions: [...kept, ...laid.map(([condition]) => condition)],
    conditionMeta: { ...meta, ...Object.fromEntries(laid) } as CharacterSheet["conditionMeta"],
  });
  publishSheet(campaign, fresh.id);
}

// ---- Shell Defense ----

function shellDefense(campaign: Campaign, sheet: CharacterSheet, variant: string | undefined): ToolResult {
  const inside = has(sheet, SHELL_DEFENSE);
  const wanted = textKey(variant ?? "");
  if (wanted && wanted !== "withdraw" && wanted !== "emerge") {
    return { error: `Shell Defense takes variant 'withdraw' or 'emerge', or none to switch; "${variant}" is neither. Nothing was spent.`, retry: true };
  }
  const emerge = wanted ? wanted === "emerge" : inside;
  if (emerge && !inside) {
    return { error: `${sheet.name} is not withdrawn into their shell; there is nothing to emerge from.`, refused: "rules" };
  }
  if (!emerge && inside) {
    return { error: `${sheet.name} is already withdrawn into their shell; a bonus action (variant 'emerge') brings them out.`, refused: "rules" };
  }
  const encounter = getActiveEncounter(campaign.id);
  // Withdrawn, the one thing a tortle can do is emerge: the bonus action is
  // priced as if the shell were already open, or the shell's own "no action"
  // would refuse the way out of it.
  const pricing = emerge ? { ...sheet, conditions: sheet.conditions.filter((entry) => textKey(entry) !== textKey(SHELL_DEFENSE)) } : sheet;
  const price = priceTheAction(pricing, encounter, emerge ? "emerging from the shell" : "Shell Defense", emerge ? "bonus" : "action");
  if ("error" in price) {
    return toolError(price);
  }
  price.commit();
  if (emerge) {
    setOwn(campaign, sheet, [[SHELL_DEFENSE, null], ["prone", null]]);
    return { ok: true, resource: "Shell Defense", cost: "their bonus action", applied: `${sheet.name} emerges from their shell: the +4 to AC and the shell's limits end, and they are no longer prone.` };
  }
  setOwn(campaign, sheet, [[SHELL_DEFENSE, { source: sheet.id }], ["prone", { source: sheet.id }]]);
  return {
    ok: true,
    resource: "Shell Defense",
    cost: "their action",
    applied: `${sheet.name} withdraws into their shell: +4 to AC, advantage on Strength and Constitution saves, disadvantage on Dexterity saves; they are prone, their speed is 0, and they take no reactions and no action but a bonus action to emerge (use_resource Shell Defense, variant 'emerge').`,
  };
}

// ---- Shapechanger (changeling) ----

const SHAPE_VARIANTS = ["appearance", "revert"];
// The lineage's Shapechanger, never the Transmuter's of the same name
// (src/lib/srd/counter-casts.ts, a free Polymorph): the changeling's line,
// and for a changeling who is also that wizard, only when the call names an
// appearance or a revert.
function lineageShapechanger(sheet: CharacterSheet, variant: string | undefined): boolean {
  const line = sheet.features.some((feature) => /^shapechanger\s*\(alter your appearance/i.test(feature.name.trim()));
  return line && (!sheet.resources?.sub_shapechanger || SHAPE_VARIANTS.includes(textKey(variant ?? "")));
}

function shapechanger(campaign: Campaign, sheet: CharacterSheet, variant: string | undefined): ToolResult {
  const changed = has(sheet, SHAPECHANGED);
  const wanted = textKey(variant ?? "");
  if (wanted && !SHAPE_VARIANTS.includes(wanted)) {
    return { error: `Shapechanger takes variant 'appearance' (a new look, their action) or 'revert' (their own, at no cost); "${variant}" is neither. Nothing was spent.`, retry: true };
  }
  if (wanted === "revert") {
    if (!changed) {
      return { error: `${sheet.name} wears their own face; there is nothing to revert.`, refused: "rules" };
    }
    setOwn(campaign, sheet, [[SHAPECHANGED, null]]);
    return { ok: true, resource: "Shapechanger", cost: "nothing", applied: `${sheet.name} lets the borrowed look go and is themselves again.` };
  }
  const price = priceTheAction(sheet, getActiveEncounter(campaign.id), "Shapechanger", "action");
  if ("error" in price) {
    return toolError(price);
  }
  price.commit();
  setOwn(campaign, sheet, [[SHAPECHANGED, { source: sheet.id }]]);
  return {
    ok: true,
    resource: "Shapechanger",
    cost: "their action",
    applied: `${sheet.name} alters their appearance and voice (never their size, their gear or their numbers); it lasts until they change again or revert, which costs nothing (variant 'revert').`,
  };
}

// ---- Feline Agility ----

function felineAgility(campaign: Campaign, sheet: CharacterSheet): ToolResult {
  const state = sheet.resources[FELINE_AGILITY_COUNTER];
  const encounter = getActiveEncounter(campaign.id);
  const fight = encounter && (encounter.kind ?? "fight") === "fight" ? encounter : null;
  if (!fight) {
    return { error: `Feline Agility doubles ${sheet.name}'s speed for one turn of a fight, and no fight is running: out of one, narrate the burst of speed. Nothing was spent.`, refused: "rules" };
  }
  if (!ownTurnOf(fight, sheet.id)) {
    return { error: `Feline Agility is used when ${sheet.name} moves on their own turn, and it is not their turn. Nothing was spent.`, refused: "rules" };
  }
  if (state.used >= state.max) {
    return { error: `${sheet.name} has used Feline Agility and has moved on every turn since: it comes back at the end of a turn on which they move 0 feet. Nothing was spent.`, refused: "rules" };
  }
  const updated = patchSheet(sheet.id, { resources: { ...sheet.resources, [FELINE_AGILITY_COUNTER]: { max: state.max, used: state.used + 1 } } });
  // This turn's end takes it (turnBegun: the turn it ends with is running).
  setOwn(campaign, updated ?? sheet, [[FELINE_AGILITY, { source: sheet.id, untilTurnEndOf: sheet.id, turnBegun: true }]]);
  return {
    ok: true,
    resource: "Feline Agility",
    cost: "no action",
    left: `${state.max - state.used - 1}/${state.max}`,
    applied: `${sheet.name}'s speed is doubled until the end of this turn. The use comes back at the end of a turn on which they move 0 feet.`,
  };
}

// ---- Celestial Revelation ----

const REVELATION_COUNTER = "race_celestial_revelation";
const REVELATION_ROUNDS = 10;
const SHROUD_FEET = 10;
const FORMS: Array<{ condition: string; words: string[]; does: string }> = [
  { condition: WINGS, words: ["heavenly wings", "wings"], does: "spectral wings give a flying speed equal to their walking speed" },
  { condition: RADIANCE, words: ["inner radiance", "radiance"], does: "they shed bright light, and at the end of each of their turns every creature within 10 feet takes radiant damage equal to their proficiency bonus" },
  { condition: SHROUD, words: ["necrotic shroud", "shroud"], does: "their eyes turn to pools of darkness" },
];

// "Celestial Revelation (from 3rd level, a bonus action: Heavenly Wings,
// Inner Radiance or Necrotic Shroud for a minute, with extra damage equal to
// your proficiency bonus once a turn, 1/long rest)". The counter is held
// from 3rd level (its row's minLevel); the form is named, never defaulted;
// the once-a-turn damage rides the attack (src/lib/srd/mt-species-traits.ts
// lineageRiders) and the radiance burns at each turn's end
// (mt-species-turns.ts).
function celestialRevelation(campaign: Campaign, turnId: string, sheet: CharacterSheet, variant: string | undefined): ToolResult {
  const state = sheet.resources[REVELATION_COUNTER];
  const wanted = textKey((variant ?? "").replace(/^celestial revelation:\s*/i, ""));
  const form = FORMS.find((entry) => entry.words.includes(wanted));
  if (!form) {
    return { error: `Celestial Revelation takes one form: variant 'heavenly wings', 'inner radiance' or 'necrotic shroud'${variant ? `; "${variant}" is none of them` : ""}. Nothing was spent.`, retry: true };
  }
  if (state.used >= state.max) {
    return { error: `${sheet.name} has no use of Celestial Revelation left until a long rest. Nothing was spent.`, refused: "rules" };
  }
  const encounter = getActiveEncounter(campaign.id);
  const price = priceTheAction(sheet, encounter, "Celestial Revelation", "bonus");
  if ("error" in price) {
    return toolError(price);
  }
  price.commit();
  const updated = patchSheet(sheet.id, { resources: { ...sheet.resources, [REVELATION_COUNTER]: { max: state.max, used: state.used + 1 } } });
  setOwn(campaign, updated ?? sheet, [[WINGS, null], [RADIANCE, null], [SHROUD, null], [form.condition, { rounds: REVELATION_ROUNDS, source: sheet.id }]]);
  const derived = computeSheetDerived(sheet);
  const applied = [
    `${sheet.name} is transformed for a minute: ${form.does}. Once on each of their turns, one creature their attack hits takes ${derived.proficiencyBonus} extra ${form.condition === SHROUD ? "necrotic" : "radiant"} damage, which the attack adds itself.`,
  ];
  const result: Record<string, unknown> = { ok: true, resource: "Celestial Revelation", cost: "their bonus action", left: `${state.max - state.used - 1}/${state.max}`, refills: "on a long rest", applied };
  if (form.condition !== SHROUD || !encounter) {
    return result;
  }
  // Necrotic Shroud: each creature within 10 feet saves (Charisma, DC 8 +
  // proficiency bonus + Charisma modifier) or is frightened until the end
  // of the aasimar's next turn (condition-logic.ts untilTurnEndOf: begun as
  // that turn starts, taken as it ends).
  const dc = 8 + derived.proficiencyBonus + derived.abilityMods.cha;
  const turn = getDmTurn(turnId);
  const frightened: string[] = [];
  const held: string[] = [];
  for (const enemy of listEnemies(encounter.id)) {
    const apart = tilesBetween(encounter.id, sheet.id, enemy.id);
    if (enemy.status !== "alive" || (apart !== null && apart * 5 > SHROUD_FEET)) {
      continue;
    }
    const save = rollEnemySave(campaign.id, enemy, "cha", dc, { record: { ...(turn ? { turn } : {}), detail: `${enemy.displayName}: CHA save against Necrotic Shroud` } });
    if (save.success) {
      held.push(enemy.displayName);
      continue;
    }
    patchEnemyConditions(enemy.id, [...enemy.conditions.filter((entry) => textKey(entry) !== "frightened"), "frightened"], {
      ...(enemy.conditionMeta as ConditionMetaMap),
      frightened: { source: sheet.id, untilTurnEndOf: sheet.id },
    } as ConditionMetaMap);
    frightened.push(enemy.displayName);
  }
  publishEncounter(campaign.id);
  applied.push(
    frightened.length || held.length
      ? `Necrotic Shroud (Charisma save DC ${dc}): ${frightened.length ? `${frightened.join(", ")} failed and ${frightened.length === 1 ? "is" : "are"} frightened of ${sheet.name} until the end of their next turn` : "nobody failed"}${held.length ? `; ${held.join(", ")} made the save` : ""}.`
      : `Necrotic Shroud: no creature stands within ${SHROUD_FEET} feet, so nobody saves.`,
  );
  return { ...result, shroud: { dc, frightened, saved: held } };
}

// ---- Shifting, by subtype ----

const SHIFTING_COUNTER = "race_shifting";
const SHIFT_ROUNDS = 10;

// The subtype a shifter's sheet holds ("Beasthide (shifted: ...)"), or null.
export function shiftFormOf(sheet: CharacterSheet): (typeof SHIFT_FORMS)[number] | null {
  return SHIFT_FORMS.find((form) => holdsFeature(sheet, form.subtype)) ?? null;
}

// "Shifting (a bonus action for 1 minute of temporary hit points equal to
// your level plus your Constitution modifier, once a short rest)" (Eberron:
// Rising from the Last War), in the form the subtype gives.
function shifting(campaign: Campaign, sheet: CharacterSheet, form: (typeof SHIFT_FORMS)[number]): ToolResult {
  const state = sheet.resources[SHIFTING_COUNTER];
  if (state.used >= state.max) {
    return { error: `${sheet.name} has no use of Shifting left until a long rest. Nothing was spent.`, refused: "rules" };
  }
  if (sheet.conditions.some((entry) => isConditionNamed(entry, SHIFTED))) {
    return { error: `${sheet.name} is already shifted; the form lasts its minute. Nothing was spent.`, refused: "rules" };
  }
  const encounter = getActiveEncounter(campaign.id);
  const price = priceTheAction(sheet, encounter, "Shifting", "bonus");
  if ("error" in price) {
    return toolError(price);
  }
  price.commit();
  // The level plus the Constitution modifier, at least 1.
  const base = Math.max(1, sheet.level + computeSheetDerived(sheet).abilityMods.con);
  const extra = "extraTempHp" in form ? form.extraTempHp : null;
  const tempHp = extra ? Math.max(base, rollOwnDice(campaign, sheet, `${sheet.name}: Shifting (${form.subtype}) temporary hit points`, `${base}+${extra}`).total) : base;
  const updated = patchSheet(sheet.id, {
    resources: { ...sheet.resources, [SHIFTING_COUNTER]: { max: state.max, used: state.used + 1 } },
    ...(tempHp > sheet.tempHp ? { tempHp } : {}),
  });
  setOwn(campaign, updated ?? sheet, [[form.condition, { rounds: SHIFT_ROUNDS, source: sheet.id }]]);
  return {
    ok: true,
    resource: "Shifting",
    cost: "their bonus action",
    left: `${state.max - state.used - 1}/${state.max}`,
    refills: "on a long rest",
    applied: [`${sheet.name} shifts (${form.subtype}) for a minute${tempHp > sheet.tempHp ? `, with ${tempHp} temporary hit points` : `, keeping their ${sheet.tempHp} temporary hit points`}.`],
  };
}

// ---- Tainted Blood ----

const TAINTED_BLOOD = "race_tainted_blood";
const TAINTED_FEET = 5;
const TAINTED_ANSWER = "tainted blood";

function taintedBlood(campaign: Campaign, turnId: string, sheet: CharacterSheet): ToolResult {
  const state = sheet.resources[TAINTED_BLOOD];
  if (state.used >= state.max) {
    return { error: `${sheet.name} has no use of Tainted Blood left until a short or long rest. Nothing was spent.`, refused: "rules" };
  }
  // The wound it answers: piercing or slashing damage just taken, not yet answered by it.
  const cut = (record: LastHit) => !record.answered.includes(TAINTED_ANSWER) && /\b(piercing|slashing)\b/i.test(record.type ?? "");
  const wound = freshLastHit(campaign.id, sheet.id, cut);
  if (!wound) {
    return { error: `Tainted Blood answers piercing or slashing damage ${sheet.name} has just taken, and none has landed. Nothing was spent.`, refused: "rules" };
  }
  if (!canReactNow(campaign.id, sheet)) {
    return { error: `${sheet.name} has no reaction to spend on Tainted Blood now. Nothing was spent.`, refused: "rules" };
  }
  const encounter = getActiveEncounter(campaign.id);
  const turn = getDmTurn(turnId);
  patchSheet(sheet.id, { resources: { ...sheet.resources, [TAINTED_BLOOD]: { max: state.max, used: state.used + 1 } } });
  if (encounter) {
    markReactionUsed(encounter, sheet.id);
  }
  writeLastHit(campaign.id, { ...wound, answered: [...wound.answered, TAINTED_ANSWER] });
  const amount = Math.max(1, sheet.level);
  const near = (ref: string) => {
    if (!encounter) return false;
    const apart = tilesBetween(encounter.id, sheet.id, ref);
    return apart !== null && apart * 5 <= TAINTED_FEET;
  };
  const struck: string[] = [];
  const self = getSheetById(sheet.id) ?? sheet;
  applyPcDamage(campaign, turnId, self, { amount, type: "necrotic", reason: "Tainted Blood" });
  struck.push(sheet.name);
  const sheets = listSheets(campaign.id).map((stale) => getSheetById(stale.id) ?? stale);
  for (const other of sheets) {
    if (other.id !== sheet.id && !other.deathSaves?.dead && near(other.id)) {
      applyPcDamage(campaign, turnId, other, { amount, type: "necrotic", reason: `${sheet.name}'s Tainted Blood` });
      struck.push(other.name);
    }
  }
  if (encounter && turn) {
    const sheetsById = new Map(sheets.map((entry) => [entry.id, entry]));
    for (const enemy of listEnemies(encounter.id)) {
      if (enemy.status === "alive" && near(enemy.id)) {
        applyEnemyDamage(campaign, turn, encounter, enemy, amount, sheets, sheetsById, "necrotic");
        struck.push(enemy.displayName);
      }
    }
    publishEncounter(campaign.id);
  }
  publishSheet(campaign, sheet.id);
  return {
    ok: true,
    resource: "Tainted Blood",
    cost: "their reaction",
    left: `${state.max - state.used - 1}/${state.max}`,
    refills: "on a short or long rest",
    applied: [`${sheet.name}'s blood sprays from the wound: ${amount} necrotic damage to ${struck.join(", ")}.`],
  };
}

// ---- Rabbit Hop ----

const RABBIT_HOP = "race_rabbit_hop";

function rabbitHop(campaign: Campaign, sheet: CharacterSheet, args: SpeciesSpendArgs): ToolResult {
  const state = sheet.resources[RABBIT_HOP];
  if (state.used >= state.max) {
    return { error: `${sheet.name} has no use of Rabbit Hop left until a long rest. Nothing was spent.`, refused: "rules" };
  }
  const encounter = getActiveEncounter(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, sheet.id) : null;
  if (conditionSpeed(sheet.conditions, speedFor(sheet)) <= 0) {
    return { error: `${sheet.name}'s speed is 0, and Rabbit Hop needs a speed above 0. Nothing was spent.`, refused: "rules" };
  }
  const feet = 5 * computeSheetDerived(sheet).proficiencyBonus;
  if (!encounter || !map || !token || args.x === undefined || args.y === undefined) {
    const price = priceTheAction(sheet, encounter, "Rabbit Hop", "bonus");
    if ("error" in price) {
      return toolError(price);
    }
    price.commit();
    patchSheet(sheet.id, { resources: { ...sheet.resources, [RABBIT_HOP]: { max: state.max, used: state.used + 1 } } });
    creditFeatureTeleport(sheet.id, "Rabbit Hop", feet);
    publishSheet(campaign, sheet.id);
    return {
      ok: true,
      resource: "Rabbit Hop",
      cost: "their bonus action",
      left: `${state.max - state.used - 1}/${state.max}`,
      refills: "on a long rest",
      applied: [
        token
          ? `${sheet.name} leaps up to ${feet} feet, drawing no opportunity attacks: move their token with move_token, teleport true, spell "Rabbit Hop" and casterCharacterId ${sheet.id} (or spend it with x and y next time).`
          : `${sheet.name} leaps up to ${feet} feet; with no battle map, narrate where they land.`,
      ],
    };
  }
  const enemiesById = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  // A straight leap of `feet`, over the squares under it, as a jump goes
  // (src/lib/srd/jump.ts), with none of the turn's movement spent.
  const plan = planLongJump({
    terrain: map.terrain,
    width: map.width,
    height: map.height,
    occupied: occupiedTiles(map, listTokens(map.id), token, footprintLookup(enemiesById)),
    from: token,
    to: { x: args.x, y: args.y },
    strength: 0,
    extraFeet: feet,
    runningStart: true,
    budgetTiles: Number.MAX_SAFE_INTEGER,
    name: sheet.name,
  });
  if (!plan.ok) {
    return { error: `Rabbit Hop leaps up to ${feet} feet in a straight line: ${plan.error} Nothing was spent.`, retry: true };
  }
  const price = priceTheAction(sheet, encounter, "Rabbit Hop", "bonus");
  if ("error" in price) {
    return toolError(price);
  }
  price.commit();
  patchSheet(sheet.id, { resources: { ...sheet.resources, [RABBIT_HOP]: { max: state.max, used: state.used + 1 } } });
  // The leap draws no opportunity attack, and is not the turn's movement.
  moveToken(token.id, args.x, args.y, token.movedThisRound);
  releaseGrapplesOutOfReach(campaign);
  publishBattleMapUpdate(campaign.id);
  publishSheet(campaign, sheet.id);
  return {
    ok: true,
    resource: "Rabbit Hop",
    cost: "their bonus action",
    left: `${state.max - state.used - 1}/${state.max}`,
    refills: "on a long rest",
    applied: [`${sheet.name} leaps ${plan.feet} feet to (${args.x},${args.y}), drawing no opportunity attacks.`],
  };
}

// ---- Grovel, Cower, and Beg ----

function grovel(campaign: Campaign, sheet: CharacterSheet): ToolResult {
  const state = sheet.resources[GROVEL_COUNTER];
  if (state.used >= state.max) {
    return { error: `${sheet.name} has used Grovel, Cower, and Beg: it comes back on a short or long rest. Nothing was spent.`, refused: "rules" };
  }
  const encounter = getActiveEncounter(campaign.id);
  const fight = encounter && (encounter.kind ?? "fight") === "fight" ? encounter : null;
  const price = priceTheAction(sheet, fight, "Grovel, Cower, and Beg", "action");
  if ("error" in price) {
    return toolError(price);
  }
  price.commit();
  const updated = patchSheet(sheet.id, { resources: { ...sheet.resources, [GROVEL_COUNTER]: { max: state.max, used: state.used + 1 } } });
  if (fight) {
    // Begun as the kobold's next turn starts, taken as it ends (condition-logic.ts).
    setOwn(campaign, updated ?? sheet, [[GROVELING, { source: sheet.id, untilTurnEndOf: sheet.id }]]);
  } else {
    publishSheet(campaign, sheet.id);
  }
  return {
    ok: true,
    resource: "Grovel, Cower, and Beg",
    cost: "their action",
    left: `${state.max - state.used - 1}/${state.max}`,
    refills: "on a short or long rest",
    applied: [
      fight
        ? `${sheet.name} cowers and begs. Until the end of their next turn, allies' attack rolls against foes within 10 feet of ${sheet.name} that can see them have advantage (the server adds it).`
        : `${sheet.name} cowers and begs; with no fight running, narrate the distraction.`,
    ],
  };
}
