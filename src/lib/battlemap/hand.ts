// The Hand: a player's combat options as cards, derived from the character
// sheet and the turn so far (docs/visual-overhaul-plan.md 5.2).
//
// Every number on a card comes from the same pure helpers the engine uses
// (weaponAttackProfile, combatRiders, spellSaveDcFor, the resource table), so
// a card never promises something pc_attack or the cast tools would refuse.
// Pure and database-free: scripts/test-hand.mjs drives every branch. What a
// card says once it is played lives next door in hand-play.ts.
import { racialNaturalWeapon } from "@/lib/srd/racial-weapons";
import { translate, type Locale } from "@/lib/messages-logic";

type T = (key: string, vars?: Record<string, string | number>) => string;
const enT: T = (key, vars) => translate("en", key, vars);
import { optionCards } from "@/lib/battlemap/hand-options";
import { maneuverDieFor, maneuverUse, type ManeuverUse } from "@/lib/dm/maneuver-rules";
import { weaponAttackProfile, weaponOf } from "@/lib/dm/attack-logic";
import { dualWields, handsRuling, heldFirst, offHandProblem } from "@/lib/dm/attack-rules";
import { shillelaghSwing } from "@/lib/dm/attack-features";
import { magicWeaponOfRow, type WeaponGear } from "@/lib/dm/gear-attack";
import { bonusRouteFor, kiLeft, usesLeft, type BonusRoute, type MoveAction } from "@/lib/dm/bonus-routes";
import { slowedSpeed } from "@/lib/dm/vitals-logic";
import { martialArtsApplies } from "@/lib/dm/pc-attack-options";
import { attackOptionsFor, bonusStrikeCards, fastHandsCards, kiCards } from "@/lib/battlemap/hand-class";
import { beastAttackIcon } from "@/lib/battlemap/attack-art";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { acBreakdownFor, computeSheetDerived } from "@/lib/srd";
import { ammoChoice } from "@/lib/battlemap/hand-ammo";
import { ammoKindForWeapon, findAmmo, type AmmoKind } from "@/lib/srd/ammunition";
import { attackDamageLine, attackReach, attackRollLine } from "@/lib/battlemap/hand-attack-lines";
import { grappleHandsProblem } from "@/lib/dm/cast-rules";
import type { AttackProfile } from "@/lib/dm/attack-logic";
import { longRangeTilesOf } from "@/lib/dm/attack-rules";
import { combatRiders, type CombatRiders } from "@/lib/srd/feature-effects";
import { matchWeapon, type SrdWeapon } from "@/lib/srd/weapons";

import {
  FRESH_TURN,
  attackGate,
  costGate,
  gated,
  handsRulingReason,
  lowestSlot,
  offHandProblemReason,
  signed,
  slotLine,
  standingGate,
  budgetOf,
  type BasicActionId,
  type Gate,
  type HandCard,
  type HandCost,
  type HandOptions,
  type HandTarget,
  type HandTurn,
} from "@/lib/battlemap/hand-core";
import { featureCards, spellCards, spellNames } from "@/lib/battlemap/hand-spells";
import { itemSpellCards, itemSpellNames } from "@/lib/battlemap/hand-items";
import { ringSpellCards, ringSpellNames } from "@/lib/battlemap/hand-ring";
import { intimidatingPresenceCards, subclassSpendCards } from "@/lib/battlemap/hand-subclass";
import { DOOR_COUNTERS, featureDoorCards } from "@/lib/battlemap/hand-feature-doors";
import { spellHoldOf } from "@/lib/battlemap/hand-escape";
import { slipFeatureOf, squeezeSlips } from "@/lib/dm/ar-ws-revelation";
import { gearCards, guessDrawNote, undrawnGate, wieldOf } from "@/lib/battlemap/hand-gear";
import { pluralOf } from "@/lib/messages-logic";
import { grantedAttackCards } from "@/lib/battlemap/hand-granted";
import { textKey } from "@/lib/language/text-logic";
import { magicItemRiders } from "@/lib/srd/magic-items";
import { autoLoaderOpen } from "@/lib/srd/genre-b-steampunk-attacks";

export * from "@/lib/battlemap/hand-core";

// ---- attacks ----

type Carried = { name: string; srd: SrdWeapon; qty: number; gear: WeaponGear | null };

// The ammunition words, keyed so the card's resource line reads in the
// table's language (AMMO_LABELS in src/lib/srd/ammunition.ts keeps the
// engine's own English labels for its own sentences).
const AMMO_KEY: Record<AmmoKind, string> = {
  arrows: "arrows",
  bolts: "bolts",
  bullets: "bullets",
  needles: "needles",
};


// Every carried row the engine would swing, resolved as resolveAttackWeapon
// resolves a named weapon: a homebrew block first, then a magic weapon's base
// item and riders (a Berserker Axe is a battleaxe with its +1 and its
// attunement judged), then the SRD table by name.
export function carriedWeapons(sheet: Pick<CharacterSheet, "equipment">): Carried[] {
  const seen = new Set<string>();
  const out: Carried[] = [];
  for (const item of sheet.equipment) {
    const own = weaponOf(item);
    const magic = magicWeaponOfRow(item);
    const srd = (magic.gear ? magic.srd : null) ?? own ?? matchWeapon(item);
    const key = textKey(item.name);
    if (!srd || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: item.name.trim(), srd, qty: item.qty, gear: magic.gear ?? null });
  }
  return out;
}

// The card's range line in the reader's words, from the same reading
// attackReach makes (hand-attack-lines.ts): melee feet, a bow's span out to
// its long range, a thrown weapon's reach then its span. The shot data the
// preview reads rides on the card from attackReach itself.
function weaponRange(profile: AttackProfile, t: T = enT): string {
  const reachFt = profile.reachTiles * 5;
  if (!profile.ranged && !profile.thrown) return t("{feet} ft", { feet: reachFt });
  const normalFt = profile.rangeTiles * 5;
  const longFt = longRangeTilesOf(profile) * 5;
  const span = longFt > normalFt ? t("{range}/{long} ft", { range: normalFt, long: longFt }) : t("{feet} ft", { feet: normalFt });
  return profile.ranged ? span : t("{reach} ft / {span}", { reach: reachFt, span });
}

function attackCards(sheet: CharacterSheet, turn: HandTurn, riders: CombatRiders, options: HandOptions, t: T = enT): HandCard[] {
  const tp = pluralOf(t);
  const derived = computeSheetDerived(sheet);
  const profs = sheet.proficiencies.weapons;
  const allowed = Math.max(1 + riders.extraAttacks, turn.attacksAllowed ?? 0);
  const standing = standingGate(sheet, turn, "attack");
  // Martial Arts only with no armor and no shield (the engine's own gate).
  const martialArts = martialArtsApplies(sheet);
  // A shield on the arm keeps a versatile weapon in one hand, whatever is
  // asked, and a two-handed weapon out of use (handsRuling in
  // src/lib/dm/attack-rules.ts). The off-hand swing of two-weapon fighting
  // has a weapon in each hand, so it is one-handed as well.
  const shieldName = acBreakdownFor(sheet).shieldName;
  const cards: HandCard[] = [];
  const base = {
    type: "attack" as const,
    cost: "action" as const,
    roll: "",
    resource: "",
    condition: "",
    target: "enemy" as const,
    heals: false,
    save: null,
    disabled: null,
    spent: false,
    compose: false,
  };

  // A beast form swings with its statblock, not with the sheet's gear; a
  // form whose block has no attack (a frog) leaves no attack card at all.
  if (sheet.wildShape?.attacks) {
    for (const attack of sheet.wildShape.attacks) {
      const ranged = Boolean(attack.range) && !attack.thrown;
      cards.push(
        gated(
          {
            ...base,
            id: `attack:${textKey(attack.name)}`,
            name: attack.name,
            range: attack.range
              ? ranged
                ? t("{range}/{long} ft", { range: attack.range, long: attack.longRange ?? attack.range })
                : t("{reach} ft / {range}/{long} ft", { reach: attack.reach ?? 5, range: attack.range, long: attack.longRange ?? attack.range })
              : t("{feet} ft", { feet: attack.reach ?? 5 }),
            dice: `${attack.damage} ${attack.type}${(attack.riders ?? []).map((rider) => ` + ${rider.dice} ${rider.type}`).join("")}`.trim(),
            roll: t("{bonus} to hit", { bonus: signed(attack.toHit) }),
            rules: t("{form} form.", { form: sheet.wildShape.form }),
            icon: beastAttackIcon(sheet.wildShape.form, attack.name),
            toHit: attack.toHit,
            damage: attack.damage,
            damageType: attack.type,
            melee: !ranged,
            intent: { card: "attack", weapon: attack.name },
          },
          standing,
          // The form's Multiattack, as the server counts it (turn-budget.ts).
          attackGate(turn, Math.max(allowed, sheet.wildShape.attacksPerTurn ?? 1), sheet, {}, t),
        ),
      );
    }
    return cards;
  }

  const carried = carriedWeapons(sheet);
  const dualWielder = dualWields(sheet.feats, sheet.campaignId);
  const build = (name: string, srd: SrdWeapon | null, offHand: boolean, gear: WeaponGear | null = null, natural = false): HandCard => {
    const resolved = { displayName: name, srd, unarmed: srd === null, ...(gear ? { gear } : {}) };
    // Shillelagh, as pc_attack swings it: a club or quarterstaff deals a d8
    // with the spellcasting ability when that is better, and is no longer
    // versatile (shillelaghSwing in src/lib/dm/attack-features.ts).
    const shillelagh = shillelaghSwing(sheet, resolved, derived);
    const held = shillelagh?.resolved.srd ?? srd;
    const profile = weaponAttackProfile(
      shillelagh?.derived ?? derived,
      // A natural weapon is always proficient, as the engine swings it.
      natural ? [...profs, "simple", name.toLowerCase()] : profs,
      shillelagh?.resolved ?? resolved,
      // Bracers of Archery's longbow training and +2 damage, as pc_attack swings.
      { riders, offHand, martialArts, worn: magicItemRiders(sheet.equipment, sheet).weaponRiders },
    );
    // The damage and the roll as pc_attack makes them (hand-attack-lines.ts).
    const line = attackDamageLine({ sheet, turn, profile, riders, kind: "weapon" }, t);
    const rolled = attackRollLine(sheet, profile.toHit, options.board?.attackAura, profile);
    const damage = line.damage;
    const notes: string[] = [];
    // The off-hand card bears the same weapon's name as the main-hand one (a
    // pair of shortswords is one row of two), so it says what it is first: a
    // player with two blades equipped took it for a second copy and thought
    // two-weapon fighting was missing.
    if (offHand) {
      notes.push(
        t("Off-hand attack, your bonus action: the {name} in your other hand, after you take the Attack action with a {kind} weapon.", {
          name,
          kind: dualWielder ? t("one-handed melee") : t("light melee"),
        }),
      );
    }
    // Which weapon is out, on the card itself (held-default.ts): a player
    // could not tell, and asked for one they thought was drawn.
    const wield = natural ? undefined : wieldOf(sheet, name);
    if (wield === "stowed") notes.push(guessDrawNote(sheet, name) ?? t("Packed away: the attack draws it with your free object interaction."));
    if (!offHand && allowed > 1) notes.push(tp("Extra Attack: {count} swings on this action.", "Extra Attack: {count} swings on this action.", { count: allowed }));
    if (riders.sneakAttackDice > 0 && profile.sneakEligible) {
      notes.push(t("Sneak Attack +{dice}d6 once a turn when it applies.", { dice: riders.sneakAttackDice }));
    }
    notes.push(...line.notes, ...rolled.notes);
    // A melee weapon thrown past its reach makes a ranged attack, which
    // pc_attack rolls without Rage or a melee hit's riders (Improved Divine
    // Smite). The card showed the melee sum for a throw too.
    const thrown = profile.thrown && !profile.ranged && !offHand
      ? attackDamageLine({ sheet, turn, profile, riders, kind: "weapon", atRange: true }, t).damage
      : null;
    const thrownDamage = thrown && thrown !== damage ? thrown : null;
    if (thrownDamage) notes.push(`Thrown at range: ${thrownDamage}, without the melee bonuses.`);
    if (shillelagh) notes.push(`${shillelagh.note}.`);
    notes.push(...profile.riderNotes.map((note) => `${note}.`));
    if (!profile.proficient) notes.push(t("Not proficient."));
    // The bigger die is for a melee attack (SRD 5.1), so a weapon that can
    // also be thrown says where it counts.
    if (held?.properties?.includes("versatile") && !profile.twoHanded && !shieldName && !offHand) {
      notes.push(profile.thrown ? t("Versatile: say two hands in melee for the bigger die.") : t("Versatile: say two hands for the bigger die."));
    }
    const ammoKind = srd?.properties?.includes("ammunition") ? ammoKindForWeapon(srd.name) : null;
    const ammoPick = ammoKind && !offHand && options.magicAmmo !== false ? ammoChoice(sheet.equipment, srd?.name) : null;
    const ammo = ammoKind ? findAmmo(sheet.equipment, ammoKind) : null;
    const empty = ammoKind !== null && ammo === null;
    const ammoLabel = ammoKind ? t(AMMO_KEY[ammoKind]) : "";
    const card: HandCard = {
      ...base,
      id: `${offHand ? "offhand" : "attack"}:${textKey(name)}`,
      name: offHand ? t("Off-hand {name}", { name }) : name,
      cost: offHand ? "bonus" : "action",
      ...attackReach(profile),
      range: weaponRange(profile, t),
      dice: dmgWithType(damage, profile.damageType, t),
      roll: t("{bonus} to hit", { bonus: `${(rolled.toHit ?? 0) >= 0 ? "+" : ""}${rolled.toHit ?? 0}${rolled.toHitDice ?? ""}` }),
      rules: notes.slice(0, 2).join(" "),
      description: notes.join(" "),
      resource: ammoKind ? (ammo ? t("{ammo} {count}", { ammo: ammoLabel, count: ammo.count }) : t("No {ammo}", { ammo: ammoLabel })) : "",
      icon: natural
        ? beastAttackIcon("", name)
        : srd ? { kind: "item", key: srd.name, family: "item-weapon" } : { kind: "action", key: "unarmed-strike" },
      toHit: rolled.toHit,
      ...(rolled.toHitDice ? { toHitDice: rolled.toHitDice } : {}),
      ...(rolled.rollAdvantage ? { rollAdvantage: rolled.rollAdvantage } : {}),
      damage,
      ...(thrownDamage ? { thrownDamage } : {}),
      damageType: profile.damageType,
      melee: !profile.ranged,
      ...(wield ? { wield } : {}),
      intent: { card: "attack", weapon: name, ...(offHand ? { offHand: true } : {}) },
      ...(offHand ? {} : { options: attackOptionsFor(sheet, turn, profile, derived, { allowed }, t) }),
      // Magic ammunition the weapon can fire, picked per shot (hand-ammo.ts),
      // from a host that reads the pick (capabilities.ts magicAmmo).
      ...(ammoPick ? { choice: ammoPick } : {}),
    };
    const ammoGate: Gate =
      empty && options.trackAmmo ? { reason: t("Out of {ammo}.", { ammo: ammoLabel }), spent: true } : null;
    // A two-handed weapon is not swung at all with a shield on the arm, in
    // handsRuling's own words. A lance is left to the engine: the Hand does
    // not know whether its rider is mounted.
    const hands = held
      ? handsRuling({ who: sheet.name, weapon: name, properties: held.properties ?? [], lance: false, mounted: false, twoHandedAsked: false, shieldName })
      : null;
    const handsGate: Gate = hands && "error" in hands ? { reason: handsRulingReason(hands.error, name, sheet.name, shieldName, t), spent: false } : null;
    if (offHand) {
      // The engine's own rule (attack-rules.ts offHandProblem): the swing is
      // earned by the Attack action's weapon, not by any attack, so a rapier
      // swing leaves the card shut and a dagger swing opens it (issue 210).
      // A server too old to say what the action was made with leaves the
      // card to the first swing, as it always was.
      const legacy = turn.lightMeleeAttack === undefined && turn.attacksMade > 0;
      const rule = offHandProblem({
        who: sheet.name,
        profile,
        budget: turn.myTurn
          ? { ...budgetOf(turn, sheet, allowed), ...(legacy ? { lightMeleeAttack: true, oneHandMeleeAttack: true } : {}) }
          : null,
        inFight: true,
        equipment: sheet.equipment,
        feats: sheet.feats,
        campaignId: sheet.campaignId,
        shieldName,
      });
      const opened: Gate = rule
        ? { reason: offHandProblemReason(rule.error, name, sheet.name, shieldName, dualWielder, t), spent: false }
        : null;
      return gated(card, standing, costGate("bonus", turn, sheet, `an off-hand attack with ${name}`, t), opened, undrawnGate(sheet, turn, name, t));
    }
    // The Auto-Loader Harness's extra firearm attack keeps its card open
    // (src/lib/srd/genre-b-steampunk-attacks.ts, as pc_attack spends it).
    return gated(card, standing, handsGate, attackGate(turn, allowed + autoLoaderOpen(sheet, profile, turn.marks ?? []), sheet, { unarmed: srd === null }, t), ammoGate, undrawnGate(sheet, turn, name, t));
  };

  for (const weapon of carried) cards.push(build(weapon.name, weapon.srd, false, weapon.gear));
  // A lineage's bite or claws (src/lib/srd/racial-weapons.ts), proficient.
  for (const term of ["bite", "claws"]) {
    const natural = racialNaturalWeapon(sheet.features, term, sheet.feats);
    if (natural && !carried.some((weapon) => textKey(weapon.name) === textKey(natural.srd.name))) {
      cards.push(build(natural.srd.name, natural.srd, false, null, true));
    }
  }
  cards.push(build("Unarmed strike", null, false));
  // The bonus-action strikes a feature grants (Martial Arts, Frenzy).
  cards.push(...bonusStrikeCards(sheet, turn, riders, carried.map((weapon) => ({ name: weapon.name, srd: weapon.srd })), options.board?.attackAura, t));
  // The attacks a held condition grants (Spiritual Weapon's weapon).
  cards.push(...grantedAttackCards(sheet, turn, allowed, t));

  // Two-weapon fighting: two light melee weapons in hand buy a bonus swing,
  // and with Dual Wielder any two melee weapons held in one hand do.
  // The card names a weapon in hand before one in the pack (heldFirst).
  const paired = heldFirst(
    carried.filter(
      (weapon) =>
        weapon.srd.kind === "melee" &&
        (dualWielder ? !weapon.srd.properties?.includes("two-handed") : weapon.srd.properties?.includes("light")),
    ),
    sheet.equipment,
  );
  const pairedCount = paired.reduce((sum, weapon) => sum + weapon.qty, 0);
  if (pairedCount >= 2) {
    const second = paired.length > 1 ? paired[1] : paired[0];
    cards.push(build(second.name, second.srd, true, second.gear));
  }
  return cards;
}

// ---- riders ----

// What a maneuver riding the swing asks beyond its die, on its card
// (src/lib/dm/maneuver-rules.ts). The maneuvers that are not part of a swing
// are dealt elsewhere: Parry and Riposte as reactions (hand-react.ts), Rally
// and Commander's Strike as bonus actions (hand-options.ts).
const SWING_RULES: Partial<Record<ManeuverUse, string>> = {
  swing: "A superiority die rides this attack.",
  feint: "Feint at a creature within 5 feet first, for your bonus action: advantage on this attack, and the die on its hit.",
  bonus_swing: "A thrown weapon, as your bonus action, the die on its hit.",
  grapple: "On a melee hit, grapple the target as your bonus action; the die goes on the Athletics check.",
  ally_move: "On a hit, an ally may move half its speed with its reaction, drawing no opportunity attack from the target.",
};

function riderCards(sheet: CharacterSheet, turn: HandTurn, riders: CombatRiders, t: T = enT): HandCard[] {
  const standing = standingGate(sheet, turn, "attack", t);
  const cards: HandCard[] = [];
  const base = {
    type: "rider" as const,
    cost: "rider" as const,
    range: t("Self", { context: "table.hand.range.self" }),
    roll: t("on a hit"),
    condition: "",
    target: "none" as const,
    toHit: null,
    heals: false,
    save: null,
    melee: true,
    disabled: null,
    spent: false,
    compose: false,
  };
  if (riders.canSmite && sheet.spellcasting) {
    const slot = lowestSlot(sheet, 1);
    // The engine's smite: 2d8 at a 1st level slot, one more per level, six at most.
    const dice = `${Math.min(6, 1 + (slot?.level ?? 1))}d8`;
    cards.push(
      gated(
        {
          ...base,
          id: "rider:divine smite",
          name: "Divine Smite",
          dice: `+${dice} radiant`,
          rules: t("Spend a slot as the blade lands. One more d8 against undead and fiends."),
          resource: slot ? slotLine(slot, t) : t("No slots"),
          icon: { kind: "feature", key: "Divine Smite", family: "class-paladin" },
          damage: dice,
          damageType: "radiant",
          intent: { card: "rider", rider: "Divine Smite", ...(slot ? { slotLevel: slot.level } : {}) },
        },
        standing,
        slot ? null : { reason: t("No spell slot left to smite with."), spent: true },
      ),
    );
  }
  const pool = sheet.resources.sub_superiority_dice;
  if (pool) {
    const die = `1${maneuverDieFor(sheet)}`;
    const picks = sheet.features
      .map((feature) => /^maneuver:\s*(.+)$/i.exec(feature.name)?.[1]?.trim())
      .filter((name): name is string => Boolean(name));
    const left = pool.max - pool.used;
    for (const name of picks.length ? picks : ["Maneuver"]) {
      const use = maneuverUse(name);
      const rules = picks.length ? SWING_RULES[use] : "Name the maneuver when you play it.";
      if (!rules) continue;
      // Feinting Attack and Quick Toss take the bonus action with the swing;
      // Grappling Strike's grapple needs it after.
      const bonus = use === "feint" || use === "bonus_swing" || use === "grapple";
      cards.push(
        gated(
          {
            ...base,
            id: `rider:${textKey(name)}`,
            name,
            dice: use === "grapple" ? t("+{die} Athletics", { die }) : `+${die}`,
            rules: t(rules),
            resource: t("Dice {left}/{max}", { left, max: pool.max }),
            icon: { kind: "feature", key: name, family: "class-fighter" },
            damage: use === "grapple" ? null : die,
            damageType: "",
            pool: "sub_superiority_dice",
            intent: { card: "rider", rider: name },
          },
          standing,
          left > 0 ? null : { reason: t("No superiority dice left until a rest."), spent: true },
          bonus ? costGate("bonus", turn, sheet, name, t) : null,
        ),
      );
    }
  }
  return cards;
}

// ---- the basics ----

const BASICS: Array<{ id: BasicActionId; name: string; rules: string; target: HandTarget; compose?: boolean; asks?: "trigger" }> = [
  { id: "dodge", name: "Dodge", rules: "Attacks against you roll at disadvantage until your next turn.", target: "none" },
  { id: "dash", name: "Dash", rules: "Double your movement this turn.", target: "none" },
  { id: "disengage", name: "Disengage", rules: "Your movement provokes no opportunity attacks this turn.", target: "none" },
  { id: "help", name: "Help", rules: "An ally gets advantage on their next attack against a creature you name within 5 ft of you, or on a check.", target: "ally" },
  { id: "hide", name: "Hide", rules: "A Stealth check to slip out of sight.", target: "none" },
  { id: "search", name: "Search", rules: "Perception or Investigation to find what is hidden.", target: "none" },
  { id: "escape", name: "Escape", rules: "Athletics or Acrobatics against the grappler's Athletics.", target: "none" },
  { id: "stand-up", name: "Stand up", rules: "Getting up costs half your speed.", target: "none" },
  { id: "ready", name: "Ready", rules: "Name a trigger and what you will do when it happens; your reaction does it then.", target: "none", asks: "trigger" },
  { id: "grapple", name: "Grapple", rules: "Athletics against their Athletics or Acrobatics. Takes the place of one attack.", target: "enemy" },
  { id: "shove", name: "Shove", rules: "Knock them prone or push them 5 ft. Takes the place of one attack.", target: "enemy" },
  { id: "use-object", name: "Use an object", rules: "Drink, pull, light, throw: say what.", target: "none", compose: true },
  { id: "end-turn", name: "End turn", rules: "Done with your action, movement and bonus action.", target: "none" },
];

// The moves a feature lets a character make as the bonus action, by the
// engine's own reading of the sheet (bonus-routes.ts, which take_action asks).
const BONUS_MOVES: MoveAction[] = ["dash", "disengage", "hide", "dodge"];

// The damage types a swing names, keyed to the reader's word (the same
// words the FR book prints: Tranchants, Perforants, Contondants).
const DTYPE_KEY: Record<string, string> = {
  acid: "acid",
  bludgeoning: "bludgeoning",
  cold: "cold",
  fire: "fire",
  force: "force",
  lightning: "lightning",
  necrotic: "necrotic",
  piercing: "piercing",
  poison: "poison",
  psychic: "psychic",
  radiant: "radiant",
  slashing: "slashing",
  thunder: "thunder",
  healing: "healing",
};

export function dmgWithType(damage: string, type: string, t: T): string {
  if (!type) return damage.trim();
  const key = DTYPE_KEY[type.trim().toLowerCase()];
  return key ? `${damage} ${t(key)}` : `${damage} ${type}`.trim();
}

const BASIC_RULE_KEY: Record<BasicActionId, string> = {
  dodge: "Attacks against you roll at disadvantage until your next turn.",
  dash: "Double your movement this turn.",
  disengage: "Your movement provokes no opportunity attacks this turn.",
  help: "An ally gets advantage on their next attack against the creature you name, or on a check.",
  hide: "A Stealth check to slip out of sight.",
  search: "Perception or Investigation to find what is hidden.",
  escape: "Athletics or Acrobatics against the grappler's Athletics.",
  "stand-up": "Getting up costs half your speed.",
  ready: "Name a trigger and what you will do when it happens; your reaction does it then.",
  grapple: "Athletics against their Athletics or Acrobatics. Takes the place of one attack.",
  shove: "Knock them prone or push them 5 ft. Takes the place of one attack.",
  "use-object": "Drink, pull, light, throw: say what.",
  "end-turn": "Done with your action, movement and bonus action.",
  stabilize: "An action: a DC 10 Medicine check, or a healer's kit with no roll, and they stop dying.",
  dismount: "Off {mount}: half your speed.",
  mount: "Onto {mount}: half your speed.",
  wake: "An action: shake an ally within 5 ft out of Sleep or Hypnotic Pattern. They wake still prone.",
};

// The basics' own words, keyed so a French reader's cards read like the
// tutorial that promises them (SRD 5.1 FR print: Esquiver, Foncer,
// Se désengager, Empoigner, Bousculer).
const BASIC_NAME_KEYS: Record<BasicActionId, string> = {
  dodge: "Dodge",
  dash: "Dash",
  disengage: "Disengage",
  help: "Help",
  hide: "Hide",
  search: "Search",
  escape: "Escape",
  "stand-up": "Stand up",
  ready: "Ready",
  grapple: "Grapple",
  shove: "Shove",
  "use-object": "Use an object",
  "end-turn": "End turn",
  stabilize: "Stabilize",
  dismount: "Dismount",
  mount: "Mount",
  wake: "Wake",
};

function basicCards(sheet: CharacterSheet, turn: HandTurn, riders: CombatRiders, board: HandOptions["board"], t: T = enT): HandCard[] {
  const tp = pluralOf(t);
  const derived = computeSheetDerived(sheet);
  const allowed = Math.max(1 + riders.extraAttacks, turn.attacksAllowed ?? 0);
  // The engine's own refusals of a basic action on the rules (take_action's
  // words): a grapple with both hands full (cast-rules.ts
  // grappleHandsProblem), a Hide a watcher sees clearly (the board view's
  // verdict, hide-traits.ts hideRefusal). Both cards were open and refused.
  const grappleHands = grappleHandsProblem(sheet);
  const ruled = (id: BasicActionId): Gate =>
    id === "grapple" && grappleHands
      ? { reason: grappleHands.error, spent: false }
      : id === "hide" && board?.hide
        ? { reason: board.hide, spent: false }
        : null;
  const grappled = sheet.conditions.some((entry) => entry.trim().toLowerCase() === "grappled");
  const prone = sheet.conditions.some((entry) => entry.trim().toLowerCase() === "prone");
  // A spell's hold (Web, Maze, Irresistible Dance): take_action escape breaks
  // it when no grapple does (src/lib/dm/spell-escape.ts).
  const hold = grappled ? null : spellHoldOf(sheet);
  const cards: HandCard[] = [];
  const athletics = derived.skills.athletics ?? derived.abilityMods.str;
  const make = (basic: (typeof BASICS)[number], route: BonusRoute | null): HandCard => {
    const contest = basic.id === "grapple" || basic.id === "shove";
    const cost: HandCost = basic.id === "end-turn" || basic.id === "stand-up" ? "free" : route ? "bonus" : "action";
    const escape = basic.id === "escape";
    const ki = route?.ki ? kiLeft(sheet) : null;
    return {
      id: route ? `basic:${basic.id}:bonus` : `basic:${basic.id}`,
      type: "basic",
      name: route
        ? t("{feature}: {name}", { feature: route.feature, name: t(BASIC_NAME_KEYS[basic.id]) })
        : t(BASIC_NAME_KEYS[basic.id]),
      cost,
      // Help aims at the ally, who may stand anywhere (SRD 5.1 gives helping
      // with a task no range); its 5 feet are the foe's, named in its words.
      range: contest ? t("5 ft") : basic.id === "help" ? "" : t("Self", { context: "table.hand.range.self" }),
      dice: contest || escape
        ? t("Athletics {mod}", { mod: signed(athletics) })
        : basic.id === "hide"
          ? t("Stealth {mod}", { mod: signed(derived.skills.stealth ?? derived.abilityMods.dex) })
          : basic.id === "search"
            ? t("Perception {mod}", { mod: signed(derived.skills.perception ?? derived.abilityMods.wis) })
            : "",
      roll: contest || escape
        ? t("contested check")
        : basic.id === "hide" || basic.id === "search"
          ? t("skill check")
          : t("no roll", { context: "table.hand.roll.none" }),
      rules: route
        ? t("{rules} {feature}: a bonus action{tail}.", {
            rules: t(BASIC_RULE_KEY[basic.id]),
            feature: route.feature,
            tail: route.ki ? tp(" for {count} ki", " for {count} ki", { count: route.ki }) : route.counter ? t(" and one use") : "",
          })
        : t(BASIC_RULE_KEY[basic.id]),
      resource: route?.ki && sheet.resources.ki
        ? `Ki ${ki ?? 0}/${sheet.resources.ki.max}`
        : route?.counter
          ? `${route.feature} ${usesLeft(sheet, route.counter) ?? 0}/${sheet.resources[route.counter].max}`
          : "",
      condition:
        basic.id === "dodge"
          ? t("Dodging")
          : basic.id === "grapple"
            ? t("Grappled")
            : basic.id === "shove"
              ? t("Prone")
              : basic.id === "ready"
                ? t("Readied", { context: "table.hand.cond.readied" })
                : "",
      icon: { kind: "action", key: basic.id },
      target: basic.target,
      toHit: null,
      damage: null,
      damageType: "",
      heals: false,
      save: null,
      melee: contest,
      disabled: null,
      spent: false,
      compose: Boolean(basic.compose),
      ...(basic.asks ? { asks: basic.asks } : {}),
      // Step of the Wind and Patient Defense spend ki; a counted route its uses.
      ...(route?.ki ? { pool: "ki" } : route?.counter ? { pool: route.counter } : {}),
      intent: { card: "basic", action: basic.id, ...(route ? { bonus: true } : {}) },
    };
  };
  for (const basic of BASICS) {
    // Revelation in Flesh's or Freedom of Movement's slip out of a grapple
    // or a nonmagical restraint, as take_action escape answers it
    // (src/lib/dm/ar-ws-squeeze.ts): 5 feet of movement, so the card costs
    // no action and rolls nothing.
    if (basic.id === "escape" && squeezeSlips(sheet)) {
      const slip: HandCard = { ...make(basic, null), cost: "free", dice: "", roll: "no roll", condition: "", rules: `${slipFeatureOf(sheet)?.name ?? "Your slip"}: you slip free for 5 feet of movement. No action, no roll.` };
      cards.push(gated(slip, standingGate(sheet, turn, "move")));
      continue;
    }
    // Escape is only there to take while something holds you.
    if (basic.id === "escape" && !grappled && !hold) continue;
    // Standing up is only there to take while lying prone.
    if (basic.id === "stand-up" && !prone) continue;
    const plain = make(basic, null);
    const card: HandCard =
      basic.id === "escape" && hold
        ? {
            ...plain,
            name: t("Escape: {spell}", { spell: hold.spell }),
            rules: hold.rules,
            dice: hold.dice,
            roll: hold.roll,
            condition: "",
          }
        : plain;
    if (basic.id === "stand-up") {
      // Movement, not an action (SRD 5.1, Being Prone): no standing at speed
      // 0, whether a condition or exhaustion stops them.
      const still: Gate =
        slowedSpeed(sheet) === 0
          ? { reason: t("Your speed is 0, so you cannot stand up."), spent: false }
          : null;
      cards.push(gated(card, standingGate(sheet, turn, "move", t), still));
      continue;
    }
    if (basic.id === "end-turn") {
      // Ending the turn is always open to whoever holds it, down or not.
      cards.push(turn.myTurn ? card : gated(card, standingGate(sheet, turn, "free", t)));
      continue;
    }
    const contest = basic.id === "grapple" || basic.id === "shove";
    const still: Gate =
      basic.id === "dash" && slowedSpeed(sheet) === 0
        ? { reason: t("Your speed is 0, so a Dash goes nowhere."), spent: false }
        : null;
    cards.push(
      gated(
        card,
        standingGate(sheet, turn, contest ? "attack" : "action", t),
        contest
          ? attackGate(turn, allowed, sheet, { hasteOk: false }, t)
          : costGate("action", turn, sheet, t(BASIC_NAME_KEYS[basic.id]), t),
        still,
        ruled(basic.id),
      ),
    );
    // The same move as the bonus action, where a feature allows it: Cunning
    // Action before the action as well as after it, Step of the Wind and
    // Patient Defense for a point of ki.
    const route = (BONUS_MOVES as string[]).includes(basic.id) ? bonusRouteFor(sheet, basic.id as MoveAction) : null;
    if (route) {
      const kiGate: Gate =
        route.ki > 0 && (kiLeft(sheet) ?? 0) < route.ki
          ? { reason: t("{name} has no ki point left for {feature}. It comes back after a rest.", { name: sheet.name, feature: route.feature }), spent: true }
          : null;
      const usesGate: Gate =
        route.counter && !usesLeft(sheet, route.counter)
          ? { reason: t("{name} has no use of {feature} left. It comes back after a rest.", { name: sheet.name, feature: route.feature }), spent: true }
          : null;
      cards.push(
        gated(make(basic, route), standingGate(sheet, turn, "bonus", t), costGate("bonus", turn, sheet, `${route.feature} (${basic.name})`, t), kiGate, usesGate, still, ruled(basic.id)),
      );
    }
  }
  return cards;
}

// The counters that work only in dim light or darkness (Steps of Night, One
// with Shadows), shut while the board says the square is bright, as
// use_resource refuses them there (one-with-shadows.ts shadowLightProblem).
const DARK_BOUND = new Set(["sub_steps_of_night", "one_with_shadows"]);
function darkBound(card: HandCard, board: HandOptions["board"]): HandCard {
  return board?.bright && card.pool && DARK_BOUND.has(card.pool) && !card.disabled
    ? { ...card, disabled: `${board.bright}; ${card.name} works only in dim light or darkness.`, spent: false }
    : card;
}

// ---- the hand ----

// Attacks, the riders that ride them, spells by level, class features, then
// the basics every character has, so a level 1 commoner still holds a hand.
// `locale` rides beside `t` for the data prose a builder does not key (the
// feature resources' names and guidance, class-resources-fr.ts).
export function deriveHand(sheet: CharacterSheet, turn: HandTurn = FRESH_TURN, options: HandOptions = {}, t: T = enT, locale: Locale = "en"): HandCard[] {
  const riders = combatRiders(sheet);
  const spells = spellCards(sheet, turn, riders, options, t);
  // Arcane Abeyance's and Master Scrivener's counters are the door cards'
  // (hand-feature-doors.ts), which name the spell their engines need.
  const features = featureCards(sheet, turn, t, locale).filter((card) => !card.pool || !DOOR_COUNTERS.includes(card.pool)).map((card) => darkBound(card, options.board));
  // By name, and by the spend a card plays (Arcane Jolt's two cards are one spend, and so are Cauterizing Flames' two reactions).
  const taken = new Set(features.flatMap((card) => [textKey(card.name), ...(card.intent.card === "reaction" ? [textKey(card.intent.feature)] : []), ...(card.intent.card === "feature" && card.intent.resourceId ? [textKey(card.intent.resourceId)] : [])]));
  return [
    ...attackCards(sheet, turn, riders, options, t),
    ...riderCards(sheet, turn, riders, t),
    ...spells,
    ...ringSpellCards(sheet, turn, riders, options),
    ...(options.items === false ? [] : itemSpellCards(sheet, turn, riders, options, t)),
    ...features,
    ...optionCards(sheet, turn, t),
    ...intimidatingPresenceCards(sheet, turn, t),
    ...subclassSpendCards(sheet, turn, taken, options.board, t),
    ...featureDoorCards(sheet, turn, spells),
    ...kiCards(sheet, turn, t),
    ...basicCards(sheet, turn, riders, options.board, t).map((card) => (card.id === "basic:ready" ? withReadySpells(card, spells, t) : card)),
    ...gearCards(sheet, turn, options.gear, options.board?.walled, t),
    ...fastHandsCards(sheet, turn, t),
  ];
}

// Ready commits to one action (SRD 5.1; src/lib/dm/readied-kinds.ts): an
// attack unless the player picks another. The "@" picks are take_action's
// `readied` (hand-play.ts sends them as readyAction); a spell by its name is
// take_action's `spell`: the engine casts it now, slot and concentration,
// and releases it with the reaction when the trigger comes. The spells
// offered are the hand's own one-action spell cards the cast guard would
// take now.
const READY_PICKS: Array<{ value: string; labelKey: string }> = [
  { value: "", labelKey: "An attack" },
  { value: "@move", labelKey: "A move" },
  { value: "@help", labelKey: "Help" },
  { value: "@hide", labelKey: "Hide" },
  { value: "@search", labelKey: "Search" },
  { value: "@use_object", labelKey: "Use an object" },
  { value: "@item", labelKey: "Use an item" },
  { value: "@grapple", labelKey: "Grapple" },
  { value: "@shove", labelKey: "Shove" },
];

function withReadySpells(card: HandCard, spells: HandCard[], t: T = enT): HandCard {
  const ready = spells.filter(
    (spell) => spell.intent.card === "spell" && spell.cost === "action" && !spell.disabled,
  );
  const levels: Record<string, number> = {};
  const options: NonNullable<HandCard["choice"]>["options"] = READY_PICKS.map((pick) => ({ value: pick.value, label: t(pick.labelKey) }));
  for (const spell of ready) {
    if (spell.intent.card !== "spell") continue;
    options.push({ value: spell.name, label: spell.name, note: spell.resource });
    if (spell.intent.slotLevel) levels[spell.name] = spell.intent.slotLevel;
  }
  return { ...card, choice: { arg: "readySpell", label: t("Ready", { context: "table.hand.basic.ready" }), options, fallback: "", levels } };
}

// The spells the component has to look up before the hand is complete.
export function spellsToLookUp(sheet: CharacterSheet): string[] {
  return spellNames(sheet);
}

// The same, and what its items cast, for the cards alone: the summoning door lists
// what the sheet casts from its own slots.
export function handSpellsToLookUp(sheet: CharacterSheet): string[] {
  return [...spellNames(sheet), ...ringSpellNames(sheet), ...itemSpellNames(sheet)];
}

// Nine in the fan, the rest behind the "more" spine; a player's own
// arrangement of the fan is hand-layout.ts (issue 231).
export { splitHand } from "@/lib/battlemap/hand-layout";

export { attacksAllowed } from "@/lib/battlemap/hand-core";
