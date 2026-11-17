import type { AuditEntry } from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CharacterEvent } from "@/lib/db/character-events";
import type { ClockTurn } from "@/lib/db/clock-moves";
import type { TurnChangeView } from "@/lib/db/turn-changes";
import { quietTick } from "@/lib/sheet-audit-logic";
import { translate } from "@/lib/messages-logic";
import { COPPER_PER_GOLD, formatPrice } from "@/lib/srd/currency";
import { pluralOf } from "@/lib/messages-logic";

// What the event log lists and which turns it offers to revert. Pure, so a
// suite reads it without a browser (scripts/test-event-log-logic.mjs). The
// clock turns (src/lib/db/clock-moves.ts) come from the campaign snapshot
// and the clock_changed event; an older host sends none, and the log keeps
// its old rule. So do the other things a turn kept for its revert (issue
// 685, src/lib/db/turn-changes.ts), from the snapshot's turnChanges and the
// turn_changed event.

export type FeedItem =
  | { type: "audit"; seq: number; entry: AuditEntry }
  // A run of changes that only counted time down, from one turn.
  | { type: "ticks"; seq: number; turnId: string; entries: AuditEntry[] }
  | { type: "time"; seq: number; move: ClockTurn }
  // A prepared event that fired, a test die forced, a card resolved as
  // played: what else the turn's revert takes back.
  | { type: "change"; seq: number; change: TurnChangeView }
  | { type: "milestone"; seq: number; event: CharacterEvent };

// Rows the trail keeps for the engine's own reading, which change no sheet:
// the moment of a death (src/lib/dm/revival.ts), which a revival spell
// times its window from. The death itself is its death_state row. And a
// spirit medium's Anchor of the Living holding a dead ally's spirit
// (src/lib/dm/genre-b-mystery-anchor.ts), which the revival reads.
export const BOOKKEEPING_KINDS: ReadonlySet<string> = new Set(["death_moment", "spirit_anchor"]);

// Newest first: the sheet changes, the milestones and the time the turns
// moved on, with each run of one turn's quiet ticks (src/lib/
// sheet-audit-logic.ts) folded into one item: the turn's revert puts them
// back, but none is news.
export function buildFeed(
  auditLog: AuditEntry[],
  characterEvents: CharacterEvent[],
  clockTurns: ClockTurn[] = [],
  turnChanges: TurnChangeView[] = [],
): FeedItem[] {
  const items: FeedItem[] = [
    ...auditLog.filter((entry) => !BOOKKEEPING_KINDS.has(entry.kind)).map((entry) => ({ type: "audit" as const, seq: entry.seq, entry })),
    ...characterEvents.map((event) => ({ type: "milestone" as const, seq: event.seq, event })),
    ...clockTurns.map((move) => ({ type: "time" as const, seq: move.seq, move })),
    // A seed's run of dice says nothing of its own: it counts toward the
    // turn's revert without a row.
    ...turnChanges.filter((change) => change.line).map((change) => ({ type: "change" as const, seq: change.seq, change })),
  ].sort((a, b) => b.seq - a.seq);
  const feed: FeedItem[] = [];
  for (const item of items) {
    if (item.type !== "audit" || !quietTick(item.entry)) {
      feed.push(item);
      continue;
    }
    const turnId = item.entry.turnId ?? "";
    const last = feed.at(-1);
    if (last?.type === "ticks" && last.turnId === turnId) {
      last.entries.push(item.entry);
      continue;
    }
    feed.push({ type: "ticks", seq: item.seq, turnId, entries: [item.entry] });
  }
  return feed;
}

// The turn an item belongs to, if any.
export function turnOfItem(item: FeedItem): string | null {
  if (item.type === "audit") {
    return item.entry.turnId ?? null;
  }
  if (item.type === "ticks") {
    return item.turnId || null;
  }
  if (item.type === "change") {
    return item.change.turnId;
  }
  return item.type === "time" ? item.move.turnId : null;
}

// The turns the log offers "Revert this turn" for, with how many live sheet
// changes each would undo: two or more, as before; or any number (none
// included) when the turn moved the clock and the time is not back yet,
// since an undo of one change never moves the clock (issue #622); or when it
// kept something else for its revert (issue 685), which no undo of one sheet
// change takes back.
export function revertableTurns(auditLog: AuditEntry[], clockTurns: ClockTurn[] = [], turnChanges: TurnChangeView[] = []): Map<string, number> {
  const live = new Map<string, number>();
  for (const entry of auditLog) {
    if (entry.turnId && entry.undoable && !entry.revertedAt && entry.kind !== "undo") {
      live.set(entry.turnId, (live.get(entry.turnId) ?? 0) + 1);
    }
  }
  const timed = new Set([...clockTurns.map((move) => move.turnId), ...turnChanges.map((change) => change.turnId)]);
  const turns = new Map<string, number>();
  for (const [turnId, count] of live) {
    if (count >= 2 || timed.has(turnId)) {
      turns.set(turnId, count);
    }
  }
  for (const turnId of timed) {
    if (!turns.has(turnId)) {
      turns.set(turnId, 0);
    }
  }
  return turns;
}

// ---- what each change says ----
//
// One sentence per audit row, in plain words, from what the row stores.
// Every kind the server writes is named here (scripts/test-event-log-logic.mjs
// scans src for them and fails on one that is not): a lead deciding what to
// revert used to read raw ids such as "Corra Venn: death_state" (issue #622).
// Each reads what it can and says less, never "undefined", when a field is
// missing (an older row, another writer's shape).
//
// The sentences live in the dictionaries (table.log.*); like composerGate,
// the reading takes the translator from the component that draws it, so a
// language switch rewords the log with everything else.

type Delta = Record<string, unknown>;

// The translator a caller binds to its own locale (useT in a component).
type Say = (key: string, vars?: Record<string, string | number>) => string;

// English, for the callers that carry no translator (the test suite, an old
// reader): the same words the dictionaries hold.
const enT: Say = (key, vars) => translate("en", key, vars);

// A caller either hands (t, entry, name) t-first, or the older (entry, name)
// shape that reads English; both land on the same words.
function sayOf(t: Say | { kind: string; delta: Delta }, entry?: { kind: string; delta: Delta } | string, name?: string): [Say, { kind: string; delta: Delta }, string] {
  if (typeof t === "function") {
    return [t, entry as { kind: string; delta: Delta }, name ?? ""];
  }
  return [enT, t, (entry as string) ?? ""];
}

const word = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const amount = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const words = (value: unknown): string[] => (Array.isArray(value) ? value.map(word).filter((entry): entry is string => entry !== null) : []);
const times = (qty: number | null) => (qty !== null && qty > 1 ? ` x${qty}` : "");
const gold = (t: Say, copper: number) => t("{amount} gold", { amount: Math.round(copper) / 100 });

function deathState(t: Say, name: string, delta: Delta): string {
  const tp = pluralOf(t);
  const revived = word(delta.revived);
  if (revived) {
    return t("{name} is brought back by {by}", { name, by: revived });
  }
  const track = delta.deathSaves as { successes?: unknown; failures?: unknown; stable?: unknown; dead?: unknown } | null | undefined;
  if (!track || typeof track !== "object") {
    const hp = amount(delta.currentHp);
    if (hp !== null && hp > 0) {
      return t("{name} is back on their feet at {hp} HP", { name, hp });
    }
    return "deathSaves" in delta ? t("{name} is no longer dying", { name }) : t("{name}'s death saves change", { name });
  }
  if (track.dead === true) {
    return t("{name} dies", { name });
  }
  if (track.stable === true) {
    return t("{name} is stable", { name });
  }
  const successes = amount(track.successes) ?? 0;
  const failures = amount(track.failures) ?? 0;
  if (!successes && !failures) {
    return t("{name} is dying", { name });
  }
  return t("{name}'s death saves: {successes}, {failures}", {
    name,
    successes: tp("{count} success", "{count} successes", { count: successes }),
    failures: tp("{count} failure", "{count} failures", { count: failures }),
  });
}

// The sentence for a kind the server writes, or null for one it does not
// know (a row from an older or newer version). Public in both shapes: t-first
// (the components' own locale) or plain (entry, name), which reads English.
export function describeKnownEntry(
  t: Say | { kind: string; delta: Delta },
  entry?: { kind: string; delta: Delta } | string,
  name?: string,
): string | null {
  const [say, row, who] = sayOf(t, entry, name);
  return knownEntryText(say, row, who);
}

function knownEntryText(t: Say, entry: { kind: string; delta: Delta }, name: string): string | null {
  const tp = pluralOf(t);
  const delta = entry.delta ?? {};
  const item = word(delta.name) ?? word(delta.item) ?? t("an item");
  const qty = amount(delta.qty);
  switch (entry.kind) {
    case "apply_damage": {
      // Wild Shape: the blow landed on the beast form, not the druid.
      const form = word(delta.form);
      if (form) {
        const carryover = amount(delta.carryover) ?? 0;
        if (delta.reverted) {
          return carryover > 0 ? t("{name}'s {form} form breaks, {carryover} damage carrying through", { name, form, carryover }) : t("{name}'s {form} form breaks", { name, form });
        }
        const beastHp = amount(delta.beastHp);
        return beastHp !== null
          ? t("{name}'s {form} form takes {amount} damage ({hp} beast HP)", { name, form, amount: amount(delta.amount) ?? t("some"), hp: beastHp })
          : t("{name}'s {form} form takes {amount} damage", { name, form, amount: amount(delta.amount) ?? t("some") });
      }
      if (delta.relentlessEndurance) return t("{name} holds on at 1 HP (Relentless Endurance)", { name });
      if (delta.undyingSentinel) return t("{name} holds on at 1 HP (Undying Sentinel)", { name });
      if (delta.strengthOfTheGrave) return t("{name} holds on at 1 HP (Strength of the Grave)", { name });
      if (delta.blazingRevival) return t("{name} rises again as their wildfire spirit falls (Blazing Revival)", { name });
      if (delta.relentlessRage) return t("{name} holds on at 1 HP (Relentless Rage)", { name });
      if (delta.deathWard) return t("{name} holds on at 1 HP (Death Ward)", { name });
      const type = word(delta.type);
      const hp = amount(delta.currentHp);
      const dmg = amount(delta.amount);
      const line = dmg !== null ? t("{name} takes {amount} damage", { name, amount: dmg }) : t("{name} takes some damage", { name });
      return `${line}${type ? t(" ({type})", { type }) : ""}${hp !== null ? t(" ({hp} HP)", { hp }) : ""}`;
    }
    case "heal": {
      const form = word(delta.form);
      const healed = amount(delta.amount);
      if (form) {
        const beastHp = amount(delta.beastHp);
        const taken = healed ?? t("some");
        return beastHp !== null ? t("{name}'s {form} form heals {amount} ({hp} beast HP)", { name, form, amount: taken, hp: beastHp }) : t("{name}'s {form} form heals {amount}", { name, form, amount: taken });
      }
      const hp = amount(delta.newHp);
      return healed !== null ? `${t("{name} heals {amount}", { name, amount: healed })}${hp !== null ? t(" ({hp} HP)", { hp }) : ""}` : t("{name} is healed", { name });
    }
    case "grant_temp_hp": {
      const temp = amount(delta.tempHp);
      return temp !== null ? t("{name} gains {temp} temporary HP", { name, temp }) : t("{name} gains temporary HP", { name });
    }
    // An effect's move of the hit point maximum (Aid, a drain), with the hit
    // points it carried along (src/lib/db/active-effects.ts).
    case "set_effect": {
      const max = amount(delta.maxHp);
      const hp = amount(delta.currentHp);
      return max !== null ? `${name}'s hit point maximum is now ${max}${hp !== null ? ` (${hp} HP)` : ""}` : `${name}'s hit point maximum changes`;
    }
    case "award_xp": {
      const xp = amount(delta.amount);
      const total = amount(delta.newXp);
      return xp !== null ? `${t("{name} gains {xp} XP", { name, xp })}${total !== null ? t(" ({total} total)", { total }) : ""}` : t("{name} gains XP", { name });
    }
    case "modify_gold": {
      const change = amount(delta.delta);
      const copper = amount(delta.copper);
      const purse = amount(delta.purseCopper);
      const held = purse !== null ? formatPrice(purse) : amount(delta.gold) !== null ? `${amount(delta.gold)} gp` : null;
      const after = held ? t(" ({purse})", { purse: held }) : "";
      // Five silver spent was "gains 0 gold": the whole-gold figure rounds a
      // part of a gold piece away, and the copper it came from is recorded.
      if (copper !== null && copper % COPPER_PER_GOLD !== 0) {
        return copper >= 0
          ? t("{name} gains {amount}{after}", { name, amount: formatPrice(Math.abs(copper)), after })
          : t("{name} loses {amount}{after}", { name, amount: formatPrice(Math.abs(copper)), after });
      }
      if (change === null) return t("{name}'s purse changes", { name });
      return `${change >= 0 ? t("{name} gains {amount} gold", { name, amount: Math.abs(change) }) : t("{name} loses {amount} gold", { name, amount: Math.abs(change) })}${after}`;
    }
    case "grant_item":
      return t("{name} receives {item}{times}", { name, item, times: times(qty) });
    case "remove_item":
      return t("{name} loses {item}{times}", { name, item, times: times(amount(delta.removed)) });
    case "reveal_item": {
      const from = word(delta.from);
      const to = word(delta.to);
      return from && to ? t("{name}'s {from} turns out to be {to}", { name, from, to }) : t("{name} learns what an item they carry is", { name });
    }
    // A pact's gift or its price (src/lib/dm/pact-fire.ts).
    case "item": {
      const added = word(delta.added);
      const removed = word(delta.removed);
      return added ? t("{name} receives {item}{times}", { name, item: added, times: "" }) : removed ? t("{name} gives up {item}", { name, item: removed }) : t("{name}'s pack changes", { name });
    }
    case "trade": {
      const partner = word(delta.with);
      return partner ? t("{name} trades with {partner}", { name, partner }) : t("{name} trades", { name });
    }
    case "purchase": {
      const selling = delta.action === "sell";
      const count = qty ?? 1;
      const eachCp = amount(delta.priceCp);
      const eachGold = amount(delta.price);
      const price = eachCp !== null ? t(" for {price}", { price: gold(t, eachCp * count) }) : eachGold !== null ? t(" for {price}", { price: t("{amount} gold", { amount: eachGold * count }) }) : "";
      return selling ? t("{name} sells {item}{times}{price}", { name, item, times: times(qty), price }) : t("{name} buys {item}{times}{price}", { name, item, times: times(qty), price });
    }
    case "gear": {
      if (typeof delta.equipped !== "boolean") return t("{name} changes what they wear", { name });
      return delta.equipped ? t("{name} puts on {item}", { name, item }) : t("{name} takes off {item}", { name, item });
    }
    // Pact of the Blade (src/lib/dm/mt-srd-warlock.ts): the weapon made,
    // bonded, sent away, or its bond broken.
    case "pact_weapon": {
      const created = word(delta.created);
      const bonded = word(delta.bonded);
      const unbonded = word(delta.unbonded);
      if (created) return `${name} creates a pact weapon: ${created}`;
      if (bonded) return `${name} bonds with ${bonded} as a pact weapon`;
      if (unbonded) return `${name} breaks the pact bond with ${unbonded}`;
      return `${name} dismisses ${word(delta.dismissed) ?? "the pact weapon"}`;
    }
    // Pact of the Tome: a new book, the old one gone with it.
    case "book_of_shadows":
      return delta.replaced === true ? `${name} makes a new Book of Shadows, and the old one is gone` : `${name} makes a Book of Shadows`;
    case "hand_item": {
      const to = word(delta.to);
      const from = word(delta.from);
      return to
        ? t("{name} hands {item}{times} to {to}", { name, item, times: times(qty), to })
        : from
          ? t("{name} receives {item}{times} from {from}", { name, item, times: times(qty), from })
          : t("{name} hands over {item}", { name, item });
    }
    case "drop_item":
      return t("{name} drops {item}{times}", { name, item, times: times(amount(delta.dropped)) });
    // A net thrown, now on the ground (src/lib/dm/gear-ground.ts throwToGround).
    case "throw_item":
      return t("{name} throws {item}", { name, item });
    case "pick_up_item":
      return t("{name} picks up {item}{times}", { name, item, times: times(amount(delta.taken)) });
    case "use_item": {
      const used = word(delta.item);
      return used ? t("{name} uses {item}", { name, item: used }) : t("{name} spends charges from an item", { name });
    }
    case "dawn_recharge":
      return t("{name}'s items regain charges at dawn", { name });
    case "set_condition": {
      if (delta.inspiration) return t("{name} gains Inspiration", { name });
      // A swallowed creature's running count toward its swallower's
      // regurgitation save (src/lib/dm/swallow.ts noteBlowFromInside).
      const inside = amount(delta.hurtInside);
      if (inside !== null)
        return t("{name} has dealt {who} {amount} damage from inside this turn", { name, who: word(delta.swallower) ?? t("what swallowed them"), amount: inside });
      const condition = word(delta.condition);
      return condition ? t("{name} is {condition}", { name, condition }) : t("{name} gains a condition", { name });
    }
    case "clear_condition": {
      const level = amount(delta.level);
      if (word(delta.condition) === "exhaustion" && level !== null) {
        return t("{name}'s exhaustion falls to level {level}", { name, level });
      }
      const ended = word(delta.condition) ?? (words(delta.ended).join(" or ") || null);
      return ended ? t("{name} is no longer {ended}", { name, ended }) : t("{name} is rid of a condition", { name });
    }
    case "exhaustion": {
      const level = amount(delta.exhaustion);
      return level !== null ? t("{name} is at exhaustion level {level}", { name, level }) : t("{name}'s exhaustion changes", { name });
    }
    // What passing time did on its own (issue #622): written down so a turn's
    // revert can put it back with the hours.
    case "wild_shape":
      return t("{name} returns to their own form", { name });
    // The once-a-turn mark of Spirit Projection's Form of Dread heal
    // (spirit-projection.ts), written apart from the heal itself.
    case "spirit_projection":
      return `${name} draws on Form of Dread for this turn`;
    case "condition_clock": {
      const ended = words(delta.ended);
      return ended.length ? t("{name} is no longer {ended}", { name, ended: ended.join(" or ") }) : t("Time runs on {name}'s conditions", { name });
    }
    case "concentration_clock":
      return t("Time runs on {name}'s {spell}", { name, spell: word(delta.spell) ?? t("spell") });
    case "concentration": {
      const spell = word(delta.concentratingOn);
      return spell ? t("{name} concentrates on {spell}", { name, spell }) : t("{name} stops concentrating", { name });
    }
    case "supplies": {
      const level = amount(delta.exhaustion);
      return level !== null ? t("{name} goes short of food or water (exhaustion {level})", { name, level }) : t("{name} eats and drinks from the pack", { name });
    }
    case "training": {
      const subject = word(delta.subject);
      return subject ? t("{name} learns {subject}", { name, subject }) : t("{name} finishes their training", { name });
    }
    case "use_spell_slot": {
      const level = amount(delta.level);
      return level !== null ? t("{name} expends a level {level} spell slot", { name, level }) : t("{name} expends a spell slot", { name });
    }
    // What a reaction itself did to the sheet (reaction-refund.ts reactionPatch).
    case "reaction": {
      const what = word(delta.reaction);
      return what ? `${name}: ${what}` : `${name} takes a reaction`;
    }
    case "use_resource": {
      const resource = word(delta.resource) ?? t("a feature");
      const from = word(delta.from);
      if (from) return t("{name} receives {item}{times} from {from}", { name, item: resource, times: "", from });
      const spent = amount(delta.spent) ?? 1;
      return spent > 1 ? tp("{name} spends {count} use of {resource}", "{name} spends {count} uses of {resource}", { name, count: spent, resource }) : t("{name} spends {resource}", { name, resource });
    }
    case "learn_spell": {
      const spell = word(delta.spell) ?? t("a spell");
      return delta.action === "remove" ? t("{name} loses the spell {spell}", { name, spell }) : t("{name} learns the spell {spell}", { name, spell });
    }
    case "divine_intervention":
      return t("{name}'s deity intervenes", { name });
    // The dying engine (src/lib/dm/death.ts), a revival spell (heal-spell.ts).
    case "death_state":
      return deathState(t, name, delta);
    case "death_moment":
      return t("The moment {name} died is written down", { name });
    case "spirit_anchor":
      return `${name}'s spirit is held by Anchor of the Living`;
    case "stabilize": {
      const healer = word(delta.healer);
      const woke = amount(delta.currentHp) === 1;
      return `${healer ? t("{healer} stabilizes {name}", { healer, name }) : t("{name} is stabilized", { name })}${woke ? t(", who regains 1 HP") : ""}`;
    }
    case "rest_long":
      return t("{name} finishes a long rest", { name });
    case "rest_short":
      return delta.hitDice ? t("{name} spends hit dice on a short rest", { name }) : t("{name} recovers on a short rest", { name });
    case "attune":
      return t("{name} attunes to an item over a rest", { name });
    case "update_sheet": {
      const changed = Object.keys(delta);
      return t("The GM rewrites {name}'s sheet{fields}", { name, fields: changed.length ? t(" ({fields})", { fields: changed.join(", ") }) : "" });
    }
    case "undo":
      return t("Party lead undid a change to {name}", { name });
    case "lead_edit": {
      const changed = Object.keys(delta).filter((key) => key !== "reason");
      return t("Party lead corrected {name}{fields}", { name, fields: changed.length ? t(" ({fields})", { fields: changed.join(", ") }) : "" });
    }
    case "player_adjust": {
      const changed = Object.keys(delta);
      return t("{name}'s player adjusted their counters{fields}", { name, fields: changed.length ? t(" ({fields})", { fields: changed.join(", ") }) : "" });
    }
    default:
      return null;
  }
}

// The row as the event log reads it: a kind no version of this server knows
// still reads as words. Same two shapes as describeKnownEntry.
export function describeAuditEntry(
  t: Say | { kind: string; delta: Delta },
  entry?: { kind: string; delta: Delta } | string,
  name?: string,
): string {
  const [say, row, who] = sayOf(t, entry, name);
  return knownEntryText(say, row, who) ?? `${who}: ${row.kind.replace(/_/g, " ")}`;
}
