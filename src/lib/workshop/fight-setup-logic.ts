import { z } from "zod";
import { conditionMetaSchema, type ConditionMetaMap } from "@/lib/schemas/condition-meta";
import { describeDiceScript, diceScriptSchema, type DiceScript } from "@/lib/dice-script-logic";
import { textKey } from "@/lib/language/text-logic";
import { GENDERS } from "@/lib/gender";

// A prepared fight's set-up (issue 685): the moment a test of it was saved
// to start from, so the next test, a coding agent's bench or #570's scorer
// opens on that moment instead of playing up to it again.
//
// What it holds, and where each part applies:
//   - the foes, by their kind and number in the roster (the second goblin,
//     wherever the roster puts it): hit points, conditions, where they stand,
//     who is hidden. Wherever the fight is deployed, a live table included
//     ("a foe that starts bloodied"); never a die.
//   - the party, by seat (the order the test seated them): hit points,
//     conditions, death saves, spell slots, class resources, hit dice, where
//     they stand. On a test table only, and only when the test seats the
//     same party: a live table's heroes are its players'.
//   - the initiative order, as totals: on a test table only.
//   - the test table's own settings, and its dice script (the integrator
//     stores the script with the set-up; src/lib/dice-script-logic.ts).
//
// Combatants are named by roster slot and seat, never by id: every test is
// a new table, so every id is new. Ids inside condition meta (who cast the
// charm, whose concentration holds it) are kept as ref tokens and given the
// new table's ids when the set-up is laid (refToken, swapIds).
//
// Pure: the schema, the matching and the words, testable without a table.

export const SETUP_LIMITS = {
  foes: 64,
  seats: 16,
  board: 200,
  name: 60,
} as const;

const tileSchema = z
  .object({
    x: z.number().int().min(0).max(SETUP_LIMITS.board - 1),
    y: z.number().int().min(0).max(SETUP_LIMITS.board - 1),
  })
  .nullable();

const conditionsSchema = z.array(z.string().trim().min(1).max(40)).max(15);

const setupFoeSchema = z.object({
  slot: z.number().int().min(0).max(SETUP_LIMITS.foes - 1),
  // The roster row's creature and its number among that kind ("goblin x2,
  // wolf": goblin 0, goblin 1, wolf 0). Where the saved state lands
  // (foeSlot), so a roster edited after the save lays it on the same
  // creature, never on whatever took its slot number. Set-ups saved before
  // this carry neither.
  monster: z.string().trim().min(1).max(80).optional(),
  nth: z.number().int().min(0).max(SETUP_LIMITS.foes - 1).optional(),
  name: z.string().trim().min(1).max(SETUP_LIMITS.name),
  // Who the foe is (src/lib/actor-sex-logic.ts): a foe told no gender takes
  // a pick from its own row id, and a test's rows are new each time, so the
  // moment keeps the face and the 3D board's model it had. Set-ups saved
  // before this carry neither, and their foes take a pick as they arrive.
  gender: z.enum(GENDERS).optional(),
  race: z.string().trim().max(40).optional(),
  hp: z.number().int().min(0).max(5000),
  maxHp: z.number().int().min(1).max(5000),
  status: z.enum(["alive", "dead", "fled"]),
  conditions: conditionsSchema,
  conditionMeta: conditionMetaSchema,
  hidden: z.boolean(),
  at: tileSchema,
  initiative: z.number().int().min(-20).max(50).nullable(),
});
export type SetupFoe = z.infer<typeof setupFoeSchema>;

const setupHeroSchema = z.object({
  seat: z.number().int().min(0).max(SETUP_LIMITS.seats - 1),
  name: z.string().trim().min(1).max(SETUP_LIMITS.name),
  at: tileSchema,
  initiative: z.number().int().min(-20).max(50).nullable(),
  currentHp: z.number().int().min(0).max(500),
  tempHp: z.number().int().min(0).max(200),
  conditions: conditionsSchema,
  conditionMeta: conditionMetaSchema,
  deathSaves: z
    .object({
      successes: z.number().int().min(0).max(3),
      failures: z.number().int().min(0).max(3),
      stable: z.boolean(),
      dead: z.boolean(),
    })
    .nullable(),
  exhaustion: z.number().int().min(0).max(6),
  concentratingOn: z.string().trim().max(80).nullable(),
  // What is spent, not the pools: a pool is the sheet's own, so a seat
  // whose sheet grew a slot since keeps it.
  slotsUsed: z.record(z.string().regex(/^[1-9]$/), z.number().int().min(0).max(10)),
  pactUsed: z.number().int().min(0).max(4).nullable(),
  resourcesUsed: z.record(z.string().max(40), z.number().int().min(0).max(200)),
  hitDiceSpent: z.number().int().min(0).max(20),
});
export type SetupHero = z.infer<typeof setupHeroSchema>;

// Who sat at the test: the stand-ins the workshop's target party builds, or
// characters from the author's library, in the order they were seated, and
// the allies seated beside them (seats after the heroes').
const allyIdsSchema = z.array(z.string().trim().min(1).max(80)).max(SETUP_LIMITS.seats).optional();
export const setupPartySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stand-ins"), size: z.number().int().min(1).max(8), level: z.number().int().min(1).max(20), allyIds: allyIdsSchema }),
  z.object({ kind: z.literal("characters"), characterIds: z.array(z.string().trim().min(1).max(80)).min(1).max(SETUP_LIMITS.seats), allyIds: allyIdsSchema }),
  // A set-up that left its author's workshop (a bundle, a copy into a
  // table): the party it was saved with stays behind (portableSetup), so no
  // test matches it and the heroes start fresh where it stood them.
  z.object({ kind: z.literal("elsewhere"), size: z.number().int().min(0).max(SETUP_LIMITS.seats) }),
]);
export type SetupParty = z.infer<typeof setupPartySchema>;

export const fightSetupSchema = z.object({
  version: z.literal(1),
  savedAt: z.string().max(40),
  party: setupPartySchema,
  foes: z.array(setupFoeSchema).max(SETUP_LIMITS.foes),
  heroes: z.array(setupHeroSchema).max(SETUP_LIMITS.seats),
  // The test table's own settings that differ from its workshop's and that
  // a test may change: allies at the table.
  settings: z.object({ companions: z.string().max(20).optional() }).default({}),
  // The test table's dice script (src/lib/dice-script-logic.ts), checked by
  // its own schema where it is used; null for none.
  dice: z.unknown().nullable().default(null),
});
export type FightSetup = z.infer<typeof fightSetupSchema>;

// A set-up's dice script, or null for none or one its schema refuses.
export function setupDice(setup: Pick<FightSetup, "dice">): DiceScript | null {
  const parsed = diceScriptSchema.safeParse(setup.dice);
  return parsed.success && (parsed.data.seed !== null || parsed.data.queue.length) ? parsed.data : null;
}

// A stored set-up, or null for none, an older shape or a damaged row: a
// fight with no usable set-up deploys as it always did.
export function parseFightSetup(raw: unknown): FightSetup | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  const parsed = fightSetupSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ---- ids inside condition meta ----

export type SetupRef = { kind: "slot"; slot: number } | { kind: "seat"; seat: number };

const REF_PREFIX = "@setup:";

export function refToken(ref: SetupRef): string {
  return ref.kind === "slot" ? `${REF_PREFIX}slot:${ref.slot}` : `${REF_PREFIX}seat:${ref.seat}`;
}

// Every string in `value` that is a key of `ids` becomes its mapped value;
// anything else is kept as it is. Saving maps the test table's ids to ref
// tokens; laying maps the tokens to the new table's ids. A token with no
// creature behind it at the new table (a slot the roster lost) is dropped
// with the field that held it, rather than left pointing at nobody.
export function swapIds<T>(value: T, ids: ReadonlyMap<string, string>): T {
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      if (ids.has(node)) {
        return ids.get(node);
      }
      return node.startsWith(REF_PREFIX) ? undefined : node;
    }
    if (Array.isArray(node)) {
      return node.map(walk).filter((entry) => entry !== undefined);
    }
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(node)) {
        const next = walk(entry);
        if (next !== undefined) {
          out[key] = next;
        }
      }
      return out;
    }
    return node;
  };
  return walk(value) as T;
}

// The conditions and their meta, with the meta's ids swapped; a condition
// whose meta lost its source keeps the condition and the rest of the meta.
export function swapMetaIds(meta: ConditionMetaMap, ids: ReadonlyMap<string, string>): ConditionMetaMap {
  const swapped = swapIds(meta, ids);
  const parsed = conditionMetaSchema.safeParse(swapped);
  return parsed.success ? parsed.data : {};
}

// ---- the foes, by kind ----

type RosterSlot = { slot: number; monster: string; label: string };

// Each roster slot's creature kind and its number among that kind.
export function slotKinds(roster: readonly RosterSlot[]): Array<{ slot: number; monster: string; nth: number }> {
  const seen = new Map<string, number>();
  return roster.map((entry) => {
    const kind = textKey(entry.monster);
    const nth = seen.get(kind) ?? 0;
    seen.set(kind, nth + 1);
    return { slot: entry.slot, monster: entry.monster, nth };
  });
}

// The slot of today's roster a saved foe's state lands on: the one of its
// kind and number, or null when the roster has none. Keyed by slot number
// alone, a set-up saved with Goblin 1 dead laid "dead" on the wolf an
// author then put first in the roster, and Goblin 1 came back fresh. A foe
// saved before set-ups carried its kind keeps its own slot only while the
// creature there still bears its saved name.
export function foeSlot(foe: Pick<SetupFoe, "slot" | "name" | "monster" | "nth">, roster: readonly RosterSlot[]): number | null {
  if (foe.monster !== undefined && foe.nth !== undefined) {
    const kind = textKey(foe.monster);
    return slotKinds(roster).find((entry) => textKey(entry.monster) === kind && entry.nth === foe.nth)?.slot ?? null;
  }
  const same = roster.find((entry) => entry.slot === foe.slot);
  return same && textKey(same.label) === textKey(foe.name) ? same.slot : null;
}

// A roster edited under a saved set-up: the foes still in it, by kind and
// number, are kept as they were saved, and the rest are dropped and named
// for the author. Kept rather than cleared because the set-up is the moment
// every test opens on (issue 685): adding a wolf to the fight should not
// throw away the goblin the author left dead, only the state of creatures
// the fight no longer has. `before` is the roster the set-up was laid
// against, for a set-up saved before foes carried their kind.
export function fitSetupToRoster(setup: FightSetup, before: readonly RosterSlot[], after: readonly RosterSlot[]): { setup: FightSetup; dropped: string[] } {
  const kinds = slotKinds(before);
  const kept: SetupFoe[] = [];
  const dropped: string[] = [];
  for (const saved of setup.foes) {
    const own = saved.monster === undefined ? kinds.find((entry) => entry.slot === saved.slot) : undefined;
    const foe = own && foeSlot(saved, before) !== null ? { ...saved, monster: own.monster, nth: own.nth } : saved;
    if (foeSlot(foe, after) === null) {
      dropped.push(saved.name);
    } else {
      kept.push(foe);
    }
  }
  return { setup: { ...setup, foes: kept }, dropped };
}

// ---- the party ----

// Whether a test's party is the one the set-up was saved with: then its
// heroes' state is theirs to take. Another party starts fresh and is told so.
export function samePartyAsSetup(setup: Pick<FightSetup, "party">, party: SetupParty): boolean {
  if (setup.party.kind === "elsewhere" || party.kind === "elsewhere") {
    return false;
  }
  if (setup.party.kind !== party.kind || !sameIds(setup.party.allyIds ?? [], party.allyIds ?? [])) {
    return false;
  }
  if (setup.party.kind === "stand-ins" && party.kind === "stand-ins") {
    return setup.party.size === party.size && setup.party.level === party.level;
  }
  if (setup.party.kind === "characters" && party.kind === "characters") {
    return sameIds(setup.party.characterIds, party.characterIds);
  }
  return false;
}

// A set-up as it leaves its author's workshop, in a bundle or a copy into
// another table (where anyone with prep authority reads it, a party lead at
// an AI-run table among them): without the author's library characters'
// ids and names. The foes, the dice and where the seats stood travel; the
// party becomes one from elsewhere, which no test seats again, so the
// importer's heroes start fresh where the set-up stood them, as a set-up
// naming characters the importer does not own already did. Stand-ins with
// no allies are no one's characters and travel whole.
export function portableSetup(setup: FightSetup): FightSetup {
  const party = setup.party;
  if (party.kind === "elsewhere" || (party.kind === "stand-ins" && !party.allyIds?.length)) {
    return setup;
  }
  return {
    ...setup,
    party: { kind: "elsewhere", size: setup.heroes.length },
    heroes: setup.heroes.map((hero) => ({ ...hero, name: `Seat ${hero.seat + 1}` })),
  };
}

// The same people in the same seats.
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

// ---- in words ----

function listed(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function hurtWords(foe: SetupFoe): string | null {
  const parts: string[] = [];
  if (foe.status !== "alive") {
    return `${foe.name} ${foe.status === "dead" ? "down" : "gone"}`;
  }
  if (foe.hp < foe.maxHp) {
    parts.push(`${foe.hp} of ${foe.maxHp} HP`);
  }
  if (foe.conditions.length) {
    parts.push(foe.conditions.join(", "));
  }
  if (foe.hidden) {
    parts.push("hidden");
  }
  return parts.length ? `${foe.name} (${parts.join("; ")})` : null;
}

function heroWords(hero: SetupHero): string | null {
  const parts: string[] = [];
  if (hero.deathSaves && !hero.deathSaves.stable && !hero.deathSaves.dead && hero.currentHp === 0) {
    parts.push("dying");
  } else if (hero.currentHp === 0) {
    parts.push("at 0 HP");
  }
  if (hero.conditions.length) {
    parts.push(hero.conditions.join(", "));
  }
  const spent = Object.values(hero.slotsUsed).reduce((sum, used) => sum + used, 0) + (hero.pactUsed ?? 0);
  if (spent) {
    parts.push(`${spent} slot${spent === 1 ? "" : "s"} spent`);
  }
  return parts.length ? `${hero.name} (${parts.join("; ")})` : null;
}

// The lines the Workshop shows under a fight with a set-up, and the table
// note a test opened from one posts. Plain words, the changed things only.
export function describeFightSetup(setup: FightSetup): string[] {
  const lines: string[] = [];
  const party =
    setup.party.kind === "stand-ins"
      ? `the stand-in party (${setup.party.size} at level ${setup.party.level})`
      : setup.party.kind === "elsewhere"
        ? "a party that sat at another table; a test here seats its own, fresh"
        : `${setup.party.characterIds.length} character${setup.party.characterIds.length === 1 ? "" : "s"} from your library`;
  lines.push(`Saved ${setup.savedAt.slice(0, 10)} from a test with ${party}.`);
  const foes = setup.foes.map(hurtWords).filter((entry): entry is string => Boolean(entry));
  lines.push(foes.length ? `Foes: ${listed(foes)}.` : "Foes: as the roster makes them, where the test left them.");
  // Another table's party is nobody's here: its wounds and its order are not
  // what a test here starts with.
  const ours = setup.party.kind !== "elsewhere";
  const heroes = ours ? setup.heroes.map(heroWords).filter((entry): entry is string => Boolean(entry)) : [];
  if (heroes.length) {
    lines.push(`Party: ${listed(heroes)}.`);
  }
  const order = [...(ours ? setup.heroes : []).map((hero) => ({ name: hero.name, initiative: hero.initiative })), ...setup.foes.filter((foe) => foe.status === "alive").map((foe) => ({ name: foe.name, initiative: foe.initiative }))]
    .filter((entry): entry is { name: string; initiative: number } => entry.initiative !== null)
    .sort((a, b) => b.initiative - a.initiative);
  if (order.length) {
    lines.push(`Initiative: ${order.map((entry) => `${entry.name} ${entry.initiative}`).join(", ")}.`);
  }
  const dice = setupDice(setup);
  if (dice) {
    lines.push(`Dice: ${describeDiceScript(dice)}`);
  }
  return lines;
}
