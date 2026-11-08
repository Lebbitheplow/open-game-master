import type { EnemyStats } from "@/lib/bestiary/statblock";
import { compareNames } from "@/lib/language/text-logic";
import { matchKey, type EquivalentAsk } from "@/lib/pdf-import/ai-logic";
import type { Draft, DraftRecord } from "@/lib/pdf-import/draft-logic";
import { conversionNote, srdStats } from "@/lib/pdf-import/equivalents";
import type { BookSystem } from "@/lib/pdf-import/foreign-statblock-logic";
import { GUESS_FLOOR, guessCreatures, matchOptions, optionDetail, type GuessSubject, type MatchAsk, type MatchTarget } from "@/lib/pdf-import/match-logic";
import type { PrintedMonster } from "@/lib/pdf-import/statblock-text-logic";
import { creatureCandidates, matchCreature, srdAvailable, srdCreatures } from "@/lib/pdf-import/srd-match";
import type { SrdCandidate } from "@/lib/pdf-import/srd-names-logic";

// The creatures of a book no name settles, put to the GM in the review:
// another system's creature the SRD has no name for, a name that only ends
// in an SRD one, and a name in a fight or on a person with no stat block of
// the book's. Each comes with its closest SRD 5.1 creatures (the model's
// pick first when one read the book, else the closest guess), and whatever
// is chosen is laid over the draft by applyMatches, which the review's
// choices call again. Names the SRD has outright are settled here with no
// question.

type Picker = (asks: EquivalentAsk[]) => Promise<Map<string, string>>;

type Pending = { ask: MatchAsk; subject: GuessSubject };

// Another system's stat line prints no size (its reader writes Medium for
// want of one), so a foreign creature's size is left out of the guess.
function subjectOf(record: DraftRecord, foreign: boolean): GuessSubject {
  const printed = record.data.printed as PrintedMonster | undefined;
  const stats = record.data.bookStats as EnemyStats | null | undefined;
  return {
    name: record.name,
    type: printed?.type ?? "",
    size: foreign ? "" : (printed?.size ?? ""),
    cr: typeof stats?.cr === "number" ? stats.cr : null,
    text: String(record.data.text ?? "").slice(0, 2_000),
  };
}

function aboutOf(subject: GuessSubject, where: string): string {
  const body = optionDetail({ name: subject.name, type: subject.type, size: subject.size, cr: subject.cr });
  return [body, where].filter(Boolean).join(" · ");
}

export async function settleNames(draft: Draft, pick: Picker | null): Promise<void> {
  const catalog = srdAvailable() ? srdCreatures() : [];
  const own = new Map(draft.records.filter((record) => record.kind === "monster").map((record) => [matchKey(record.name), record]));
  // A person read with their own stat block names it by its record's key
  // ("monster:captain-varek"): that is the book's own creature, never a
  // name to match.
  const ownKeys = new Set(draft.records.filter((record) => record.kind === "monster").map((record) => record.key));
  const pending = new Map<string, Pending>();
  const certain = new Map<string, string>();
  const ask = (name: string, subject: GuessSubject, about: string, pages: number[], own: boolean, nameHit: string | null) => {
    const key = matchKey(name);
    const found = pending.get(key);
    if (found) {
      found.ask.pages = [...new Set([...found.ask.pages, ...pages])].sort((a, b) => a - b);
      return found.ask;
    }
    const made: MatchAsk = { key: `c:${key}`, name, about, pages, own, options: [], suggested: nameHit, how: nameHit ? "name" : "none", current: null, confirmed: false, targets: [] };
    pending.set(key, { ask: made, subject });
    return made;
  };

  if (catalog.length) {
    // The book's own creatures no SRD name settled (another system's).
    for (const record of draft.records) {
      if (record.kind !== "monster" || !record.data.wasConverted) continue;
      const subject = subjectOf(record, (draft.system ?? "5e") !== "5e");
      const made = ask(record.name, subject, aboutOf(subject, "the book's own stat block"), record.pages, Boolean(record.data.bookStats), (record.data.nameHit as string | undefined) ?? null);
      made.targets.push({ record: record.key });
    }
    // Names in fights and on people that no stat block of the book's has.
    const named = (name: string, target: MatchTarget, where: string, pages: number[]) => {
      const key = matchKey(name);
      if (!key || own.has(key) || ownKeys.has(name) || certain.has(key)) return;
      const hit = matchCreature(name);
      if (hit && hit.via !== "within") {
        certain.set(key, hit.entry.name);
        return;
      }
      const subject: GuessSubject = { name, type: "", size: "", cr: null, text: "" };
      ask(name, subject, where, pages, false, hit?.entry.name ?? null).targets.push(target);
    };
    for (const record of draft.records) {
      if (record.kind === "encounter") {
        for (const creature of (record.data.creatures as Array<{ name: string }> | undefined) ?? []) named(creature.name, { record: record.key, creature: creature.name }, `in the fight "${record.name}"`, record.pages);
      }
      if (record.kind === "npc" && typeof record.data.statBlock === "string" && record.data.statBlock) {
        record.data.bookStatBlock ??= record.data.statBlock;
        named(String(record.data.bookStatBlock), { record: record.key, statBlock: true }, `${record.name}'s stat block`, record.pages);
      }
    }
  }

  // The SRD's own names, swapped in with no question.
  for (const record of draft.records) {
    if (record.kind === "encounter") {
      record.data.creatures = ((record.data.creatures as Array<{ name: string; count: number; asked?: string }> | undefined) ?? []).map((creature) => {
        const srd = certain.get(matchKey(creature.name));
        return srd && matchKey(srd) !== matchKey(creature.name) ? { ...creature, name: srd, asked: creature.name } : creature;
      });
    }
    if (record.kind === "npc" && typeof record.data.bookStatBlock === "string") {
      const srd = certain.get(matchKey(record.data.bookStatBlock));
      if (srd) record.data.statBlock = srd;
    }
  }

  // With a model, its pick for each one no name suggests, from the SRD
  // creatures near its challenge.
  const unnamed = [...pending.values()].filter(({ ask }) => !ask.suggested);
  if (pick && unnamed.length) {
    const asks: EquivalentAsk[] = unnamed.map(({ ask, subject }) => {
      // Of known power: the SRD creatures near its challenge. Of unknown
      // power (a name in a fight): the closest by name and kind, so the
      // list stays short enough for a small model's window.
      const near = subject.cr === null && !subject.type ? guessCreatures(subject, srdCreatures(), 30).map((guess) => guess.candidate as SrdCandidate) : creatureCandidates(subject.cr, subject.type, 30);
      const printed = subject.text.split("\n").slice(1).join(" ").replace(/\s+/g, " ").slice(0, 220);
      return {
        name: ask.name,
        hint: `${ask.about || "a creature"}${printed ? `; the book prints: ${printed}` : ""}`,
        candidates: near.map((candidate) => candidate.name),
        details: near.map((candidate) => optionDetail(candidate)),
      };
    });
    const picked = await pick(asks).catch(() => new Map<string, string>());
    for (const { ask } of unnamed) {
      const srd = picked.get(ask.name);
      if (srd && asks.find((entry) => entry.name === ask.name)?.candidates.includes(srd)) {
        ask.suggested = srd;
        ask.how = "model";
      }
    }
  }

  // The closest guesses, for every one: the options its row offers, and
  // the suggestion where nothing else gave one.
  for (const { ask, subject } of pending.values()) {
    const guesses = guessCreatures(subject, catalog);
    if (!ask.suggested && guesses[0] && guesses[0].score >= GUESS_FLOOR) {
      ask.suggested = guesses[0].candidate.name;
      ask.how = "guess";
    }
    ask.options = matchOptions(ask.suggested, guesses, catalog);
    ask.current = ask.suggested;
  }
  draft.matches = [...pending.values()].map(({ ask }) => ask).sort((a, b) => (a.pages[0] ?? 0) - (b.pages[0] ?? 0) || compareNames(a.name, b.name));
  applyMatches(draft);
}

// Each ask's current choice laid over what it changes; called once the
// asks are made and again with every choice the review sends. Each record
// keeps the book's own version, so any choice can be taken back.
export function applyMatches(draft: Draft): void {
  const records = new Map(draft.records.map((record) => [record.key, record]));
  const system = (draft.system ?? "5e") as BookSystem;
  for (const ask of draft.matches ?? []) {
    for (const target of ask.targets) {
      const record = records.get(target.record);
      if (!record) continue;
      if (record.kind === "monster") playMonster(record, ask.current, system);
      else if (target.creature) {
        const wanted = matchKey(target.creature);
        record.data.creatures = ((record.data.creatures as Array<{ name: string; count: number; asked?: string }> | undefined) ?? []).map((creature) => {
          if (matchKey(creature.asked ?? creature.name) !== wanted) return creature;
          const book = creature.asked ?? creature.name;
          const rest = { ...creature };
          delete rest.asked;
          return ask.current ? { ...rest, name: ask.current, asked: book } : { ...rest, name: book };
        });
      } else if (target.statBlock) {
        record.data.statBlock = ask.current ?? record.data.bookStatBlock;
      }
    }
  }
  notes(draft);
}

function playMonster(record: DraftRecord, choice: string | null, system: BookSystem): void {
  const book = (record.data.bookStats as EnemyStats | null | undefined) ?? null;
  const srd = choice ? srdStats(choice) : null;
  if (srd) {
    const same = matchKey(srd.baseName) === matchKey(record.name);
    record.data.srd = srd.baseName;
    record.data.srdDiffers = !same;
    record.data.stats = same ? null : srd.stats;
    record.data.asSrd = !same;
    record.data.converted = false;
    record.data.matchCheck = [same ? `The SRD 5.1 ${srd.baseName}.` : `Plays as the SRD 5.1 ${srd.baseName}, under the book's name.`];
    return;
  }
  delete record.data.srd;
  record.data.srdDiffers = false;
  record.data.asSrd = false;
  record.data.stats = book;
  record.data.converted = Boolean(record.data.wasConverted);
  record.data.matchCheck = [conversionNote(system, Boolean(book))];
}

// What a fight's creatures and a person's stat block came to, said on the
// record: which play as an SRD creature, and which have nothing to fight
// with yet.
function notes(draft: Draft): void {
  const monsters = draft.records.filter((record) => record.kind === "monster");
  const own = new Set([...monsters.map((record) => matchKey(record.name)), ...monsters.map((record) => matchKey(record.key))]);
  const known = (name: string) => own.has(matchKey(name)) || Boolean(srdAvailable() && matchCreature(name) && matchCreature(name)!.via !== "within");
  for (const record of draft.records) {
    if (record.kind === "encounter") {
      const creatures = (record.data.creatures as Array<{ name: string; asked?: string }> | undefined) ?? [];
      const lines: string[] = [];
      const lost = creatures.filter((creature) => !creature.asked && !known(creature.name)).map((creature) => creature.name);
      if (lost.length) lines.push(`No stat block or SRD 5.1 creature was found for ${lost.join(", ")}; pick one in the fight editor.`);
      const swapped = creatures.filter((creature) => creature.asked);
      if (swapped.length) lines.push(`Fights as SRD 5.1 creatures: ${swapped.map((creature) => `${creature.asked} as ${creature.name}`).join(", ")}.`);
      record.data.matchCheck = lines;
    }
    if (record.kind === "npc" && typeof record.data.bookStatBlock === "string") {
      const book = record.data.bookStatBlock;
      const now = String(record.data.statBlock ?? "");
      record.data.matchCheck =
        matchKey(now) !== matchKey(book)
          ? [`Fights as the SRD 5.1 ${now} (the book says "${book}").`]
          : known(book)
            ? []
            : [`No stat block or SRD 5.1 creature was found for "${book}"; give them one in the Cast.`];
    }
  }
}
