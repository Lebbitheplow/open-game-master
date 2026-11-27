"use client";

import { Copy, EyeOff, Flag, Scale, Undo2, VenetianMask } from "lucide-react";
import { useId } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { SectionHead } from "@/components/ui/SectionHead";
import { PortraitMedallion } from "@/components/sheet/SheetParts";
import { useFaceChain } from "@/app/campaigns/[campaignId]/useFaceChain";
import { useFaceSize } from "@/app/campaigns/[campaignId]/useFaceSize";
import { cn } from "@/lib/cn";
import { contentName } from "@/lib/content/names";
import { playerFaces } from "@/lib/speaker-faces";
import {
  ADVENTURE_BEGINS_NOTE,
  JOIN_NOTE_PREFIX,
  LEAD_NOTE_PREFIX,
  RECAP_PREFIX,
  systemNoteWords,
  type CampaignMember,
} from "@/lib/campaign-types";
import { useLocale, useT } from "@/lib/locale";
import type { CampaignMessage } from "@/lib/db/messages";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { TranscriptSheet } from "@/app/campaigns/[campaignId]/departing";
import {
  MessageActions,
  toContextItems,
  type MessageAction,
} from "@/app/campaigns/[campaignId]/MessageActions";
import type { SystemGlyph } from "@/lib/system-glyphs";
import { PACT_REVEAL_PREFIX } from "@/lib/dm/pact-logic";
import { kitButtonClass } from "@/app/campaigns/[campaignId]/PanelKit";
import { CardReturnedNote } from "@/app/campaigns/[campaignId]/CardReturnedNote";
import { variantUrl } from "@/lib/image-variant-url";

// The transcript's smaller voices: the table's own notices and what the
// players say. The DM's passage, the hero of the screen, is MessageItem.tsx.

type T = (key: string, vars?: Record<string, string | number>) => string;

export function copyAction(t: T, message: CampaignMessage): MessageAction {
  return {
    id: "copy",
    name: t("Copy text"),
    label: t("Copy this message's text"),
    hint: t("Copy: put this message's words on the clipboard"),
    glyph: "ui-duplicate",
    icon: <Copy className="size-3.5" />,
    onSelect: () => {
      void navigator.clipboard?.writeText(message.content).catch(() => {});
    },
  };
}

// A player's objection to a narrated ruling (DisputeDialog.tsx): the
// steerer upholds or overrules it, or the table votes.
export function disputeAction(t: T, message: CampaignMessage, onDispute: (message: CampaignMessage) => void): MessageAction {
  return {
    id: "dispute",
    name: t("Dispute"),
    label: t("Dispute this ruling"),
    hint: t("Dispute: object to what the narrator ruled here; whoever steers the story settles it, or the table votes"),
    glyph: "system-rules",
    icon: <Scale className="size-3.5" />,
    onSelect: () => onDispute(message),
  };
}

export function reportAction(t: T, message: CampaignMessage, onReport: (message: CampaignMessage) => void, dm: boolean): MessageAction {
  return {
    id: "report",
    name: t("Report"),
    label: dm ? t("Report this passage") : t("Report this message"),
    hint: dm
      ? t("Report: flag this passage to the admins of this server")
      : t("Report: flag this message to the admins of this server, or block the player"),
    glyph: "system-rules",
    icon: <Flag className="size-3.5" />,
    tone: "danger",
    onSelect: () => onReport(message),
  };
}

// A notice that is not a halted turn: the lead's public direction as a card,
// a joiner, or a plain line with the painting its writer stored (a line
// written before the icon was stored draws the neutral bell).
//
// Begin's own note is DB-stored in English (ADVENTURE_BEGINS_NOTE and its
// human-DM variant, built in the campaign route); the constant and its
// comparison in the DM prompt must stay byte-identical, so the line is
// translated here, at display, only when the content is exactly the note.
const ADVENTURE_BEGINS_DM_LINE = `${ADVENTURE_BEGINS_NOTE} The Game Master opens the scene.`;

function translateDuration(t: T, raw: string): string {
  return raw.replace(/(?<!\p{L})(\d+)\s+(week|weeks|day|days|hour|hours|minute|minutes)(?!\p{L})/gu, (_, n, unit) => {
    const base = unit.replace(/s$/, "");
    return t(Number(n) === 1 ? `{n} ${base}` : `{n} ${base}s`, { n });
  });
}

function translateCalendarClause(t: T, raw: string): string {
  const DAYS = ["Firstday", "Seconday", "Midweek", "Fourthday", "Fifthday", "Restday", "Midday"];
  const MONTHS = [
    "Deepwinter", "Frostmoon", "Thaw", "Greening", "Bloom", "Seedfall",
    "Highsun", "Longlight", "Firstharvest", "Goldfall", "Leafturn", "Yearsend",
    "First Month", "Second Month", "Third Month", "Fourth Month", "Fifth Month", "Sixth Month",
    "Seventh Month", "Eighth Month", "Ninth Month", "Tenth Month", "Eleventh Month", "Twelfth Month",
  ];
  const PARTS = ["deep night", "before dawn", "morning", "midday", "afternoon", "evening", "night"];
  const SEASONS = ["winter", "spring", "summer", "autumn"];
  let out = raw;
  out = out.replace(/It is now ([^.\n]*\b(?:year \d+|Day \d+)\b[^.\n]*)\./g, (_: string, rest: string) => {
    let dateStr = rest;
    for (const d of DAYS) dateStr = dateStr.replace(new RegExp(`(?<!\\p{L})${d}(?!\\p{L})`, "gu"), t(d));
    for (const m of MONTHS) dateStr = dateStr.replace(new RegExp(`(?<!\\p{L})${m}(?!\\p{L})`, "gu"), t(m));
    dateStr = dateStr.replace(/(?<!\p{L})year (\d+)(?!\p{L})/gu, (_: string, y: string) => t("year {n}", { n: y }));
    dateStr = dateStr.replace(/(?<!\p{L})Day (\d+)(?!\p{L})/gu, (_: string, d: string) => t("Day {n}", { n: d }));
    for (const p of PARTS) dateStr = dateStr.replace(new RegExp(`, ${p}(?=,|$)`, "g"), `, ${t(p)}`);
    for (const s of SEASONS) dateStr = dateStr.replace(new RegExp(`, ${s}(?=,|$)`, "g"), `, ${t(s)}`);
    return t("It is now {date}.", { date: dateStr });
  });
  return out;
}

function translateMountDesc(t: T, desc: string): string {
  return desc
    .replace(/(?<!\p{L})speed (\d+) ft\./gu, (_, feet) => t("speed {feet} ft.", { feet }))
    .replace(/(?<!\p{L})controlled \(shares your initiative\)/gu, () => t("controlled (shares your initiative)"))
    .replace(/(?<!\p{L})independent \(acts on its own turn\)/gu, () => t("independent (acts on its own turn)"));
}

// "Bram, Mira and Tovin" (party-split-logic.ts joinNames): the last "and" is
// the language's own.
function namesList(t: T, names: string): string {
  return names.replace(/ and (?=(?:(?! and ).)*$)/, () => t(" and "));
}

// A death save's running count, "1 success, 2 failures" (death.ts tally).
function translateTally(t: T, tally: string): string {
  const m = /^(\d+) success(?:es)?, (\d+) failures?$/.exec(tally);
  if (!m) return tally;
  const won = m[1] === "1" ? t("{n} success", { n: m[1] }) : t("{n} successes", { n: m[1] });
  const lost = m[2] === "1" ? t("{n} failure", { n: m[2] }) : t("{n} failures", { n: m[2] });
  return `${won}, ${lost}`;
}

function translateConditionWord(t: T, word: string): string {
  const MAP: Record<string, string> = {
    incapacitated: "incapacitated",
    stunned: "stunned",
    paralyzed: "paralyzed",
    unconscious: "unconscious",
    petrified: "petrified",
    held: "held",
    charmed: "charmed",
    calmed: "calmed",
  };
  return MAP[word] ? t(MAP[word]) : word;
}

export function translateSystemNote(t: T, raw: string): string {
  if (raw === "The fight is over.") return t("The fight is over.");
  if (raw === "Every character is down and none can rise on their own.") {
    return t("Every character is down and none can rise on their own.");
  }
  let m = /^Chapter (\d+)(?:, "([^"]+)",)? comes to a close\.(.*)$/.exec(raw);
  if (m) {
    const head = m[2]
      ? t("Chapter {n}, \"{title}\", comes to a close.", { n: m[1], title: m[2] })
      : t("Chapter {n} comes to a close.", { n: m[1] });
    return `${head}${m[3]}`;
  }
  m = /^Act ([IVXLCDM\d]+)(?:, "([^"]+)",)? comes to a close\.(.*)$/.exec(raw);
  if (m) {
    const head = m[2]
      ? t("Act {n}, \"{title}\", comes to a close.", { n: m[1], title: m[2] })
      : t("Act {n} comes to a close.", { n: m[1] });
    return `${head}${m[3]}`;
  }
  m = /^Act ([IVXLCDM\d]+)(?:, "([^"]+)",)? begins\.(.*)$/.exec(raw);
  if (m) {
    const head = m[2]
      ? t("Act {n}, \"{title}\", begins.", { n: m[1], title: m[2] })
      : t("Act {n} begins.", { n: m[1] });
    return `${head}${m[3]}`;
  }
  m = /^([^.\n]+?) mounts up: (.+)\.$/.exec(raw);
  if (m) {
    return t("{name} mounts up: {mount}.", { name: m[1], mount: translateMountDesc(t, m[2]) });
  }
  // A party that split up (src/lib/dm/party-split-logic.ts tableLine).
  m = /^The party is together again at (.+)\.$/.exec(raw);
  if (m) {
    return t("The party is together again at {place}.", { place: m[1] });
  }
  m = /^Meanwhile, at (.+): (.+)\.$/.exec(raw);
  if (m) {
    return t("Meanwhile, at {place}: {names}.", { place: m[1], names: namesList(t, m[2]) });
  }
  // English keeps the sentence the server wrote; another language gets the
  // same facts in a form that needs no verb agreed with the names.
  m = /^The party splits up: (.+) (?:goes|go) to (.+), and (.+) (?:stays|stay)(?: at (.+)| behind)\.$/.exec(raw);
  if (m) {
    const said = m[4]
      ? t("The party splits up. To {place}: {went}. Staying at {from}: {stayed}.", { went: namesList(t, m[1]), place: m[2], stayed: namesList(t, m[3]), from: m[4] })
      : t("The party splits up. To {place}: {went}. Staying behind: {stayed}.", { went: namesList(t, m[1]), place: m[2], stayed: namesList(t, m[3]) });
    return said.startsWith("The party splits up. To ") ? raw : said;
  }
  m = /^(.+) (?:joins|join) the others at (.+)\.$/.exec(raw);
  if (m) {
    const said = t("Joining the others at {place}: {names}.", { names: namesList(t, m[1]), place: m[2] });
    return said.startsWith("Joining the others at ") ? raw : said;
  }
  // A rider who comes off a mount, a character's (mount-thrown.ts,
  // mount-tools.ts) or an enemy's (enemy-rider-falls.ts), whole lines.
  m = /^(.+) is knocked out of the saddle; (.+) stays\.$/.exec(raw);
  if (m) {
    return t("{rider} is knocked out of the saddle; {mount} stays.", { rider: m[1], mount: m[2] });
  }
  m = /^(.+) is knocked prone and falls from (.+)\.$/.exec(raw);
  if (m) {
    return t("{rider} is knocked prone and falls from {mount}.", { rider: m[1], mount: m[2] });
  }
  m = /^(.+) is thrown from (.+)\.$/.exec(raw);
  if (m) {
    return t("{rider} is thrown from {mount}.", { rider: m[1], mount: m[2] });
  }
  m = /^(.+) goes down; (.+) jumps clear and lands on (its|their) feet\.$/.exec(raw);
  if (m) {
    return m[3] === "its"
      ? t("{mount} goes down; {rider} jumps clear and lands on its feet.", { mount: m[1], rider: m[2] })
      : t("{mount} goes down; {rider} jumps clear and lands on their feet.", { mount: m[1], rider: m[2] });
  }
  m = /^(.+) goes down and (.+) falls with it\.$/.exec(raw);
  if (m) {
    return t("{mount} goes down and {rider} falls with it.", { mount: m[1], rider: m[2] });
  }
  let out = raw;
  out = out.replace(/^The party takes a short rest \(([^)]+)\)/, (_, dur) =>
    t("The party takes a short rest ({duration})", { duration: translateDuration(t, dur) }),
  );
  out = out.replace(/^Inside the genie's vessel, the party takes a short rest \(([^)]+)\)/, (_, dur) =>
    t("Inside the genie's vessel, the party takes a short rest ({duration})", { duration: translateDuration(t, dur) }),
  );
  out = out.replace(/^The party takes a long rest \(([^)]+)\)/, (_, dur) =>
    t("The party takes a long rest ({duration})", { duration: translateDuration(t, dur) }),
  );
  out = out.replace(/ No benefit from it for ([^.\n]+)\./g, (_, who) =>
    ` ${t("No benefit from it for {who}.", { who })}`,
  );
  // pass_time writes "1 hour passes" and "10 minutes pass" (world-tools.ts
  // passVerb), with the reason after a colon or none: the verb is kept as
  // written, so English reads the server's own line.
  out = out.replace(/^(\d+ (?:week|weeks|day|days|hour|hours|minute|minutes)) (passes|pass)([:.]) /, (_, dur, verb, stop) => {
    const duration = translateDuration(t, dur);
    const said = stop === ":"
      ? verb === "passes" ? t("{duration} passes:", { duration }) : t("{duration} pass:", { duration })
      : verb === "passes" ? t("{duration} passes.", { duration }) : t("{duration} pass.", { duration });
    return `${said} `;
  });
  out = out.replace(/It is now ([^']+)'s turn \(round (\d+)\)\./g, (_, ch, r) =>
    t("It is now {character}'s turn (round {n}).", { character: ch, n: r }),
  );
  out = out.replace(/It is now ([^']+)'s turn again\./g, (_, ch) =>
    t("It is {character}'s turn again.", { character: ch }),
  );
  out = out.replace(/It is ([^']+)'s turn again\./g, (_, ch) =>
    t("It is {character}'s turn again.", { character: ch }),
  );
  out = out.replace(/It is now ([^']+)'s turn\./g, (_, ch) =>
    t("It is now {character}'s turn.", { character: ch }),
  );
  out = translateCalendarClause(t, out);
  out = out.replace(/([^.\n]+?) ends their turn\./g, (_, ch) =>
    t("{character} ends their turn.", { character: ch.trim() }),
  );
  out = out.replace(/([\p{Lu}][^.\n]+?) (acts|act) before ([^.\n]+)\./gu, (_, enemy, verb, ch) =>
    verb === "acts"
      ? t("{enemy} acts before {character}.", { enemy, character: ch })
      : t("{enemies} act before {character}.", { enemies: enemy, character: ch }),
  );
  out = out.replace(/Every character has fallen: the fight is lost\./g, () =>
    t("Every character has fallen: the fight is lost."),
  );
  out = out.replace(/The party lead skipped ([^']+)'s turn\./g, (_, ch) =>
    t("The party lead skipped {character}'s turn.", { character: ch }),
  );
  out = out.replace(/Skipped enemy turns resolve automatically:/g, () =>
    t("Skipped enemy turns resolve automatically:"),
  );
  // Death saves (src/lib/dm/death.ts)
  out = out.replace(
    /([^.\s\n][^.\n]*?) death save: rolled (\d+), (natural 20|success|failure)(?: \(([^)]+)\))?\./g,
    (_, name, total, result, tally) => {
      const resultFr = t(result);
      return tally
        ? t("{name} death save: rolled {total}, {result} ({tally}).", { name: name.trim(), total, result: resultFr, tally: translateTally(t, tally) })
        : t("{name} death save: rolled {total}, {result}.", { name: name.trim(), total, result: resultFr });
    },
  );
  out = out.replace(/([^.\s\n][^.\n]*?) rolls a natural 20 on their death save and regains 1 HP!/g, (_, name) =>
    t("{name} rolls a natural 20 on their death save and regains 1 HP!", { name: name.trim() }),
  );
  out = out.replace(
    /([^.\s\n][^.\n]*?) succeeds their third death save and is stable \(unconscious at 0 HP\)\. They regain 1 hit point in (\d+) hours?\./g,
    (_, name, hours) =>
      Number(hours) === 1
        ? t("{name} succeeds their third death save and is stable (unconscious at 0 HP). They regain 1 hit point in {hours} hour.", { name: name.trim(), hours })
        : t("{name} succeeds their third death save and is stable (unconscious at 0 HP). They regain 1 hit point in {hours} hours.", { name: name.trim(), hours }),
  );
  out = out.replace(
    /([^.\s\n][^.\n]*?) succeeds their third death save and is stable at 0 HP, still raging on their feet\./g,
    (_, name) => t("{name} succeeds their third death save and is stable at 0 HP, still raging on their feet.", { name: name.trim() }),
  );
  out = out.replace(
    /([^.\s\n][^.\n]*?) fails their third death save\. Rage Beyond Death holds the death off: they die when the rage ends, if they are still at 0 hit points then\./g,
    (_, name) => t("{name} fails their third death save. Rage Beyond Death holds the death off: they die when the rage ends, if they are still at 0 hit points then.", { name: name.trim() }),
  );
  out = out.replace(/([^.\s\n][^.\n]*?) fails their final death save and dies\./g, (_, name) =>
    t("{name} fails their final death save and dies.", { name: name.trim() }),
  );
  out = out.replace(/([^.\s\n][^.\n]*?)'s rage ends: their turn passed with no attack made and no damage taken\./g, (_, name) =>
    t("{name}'s rage ends: their turn passed with no attack made and no damage taken.", { name: name.trim() }),
  );
  out = out.replace(/([^.\s\n][^.\n]*?) comes round with (\d+) hit points?\./g, (_, name, hp) =>
    Number(hp) === 1
      ? t("{name} comes round with {hp} hit point.", { name: name.trim(), hp })
      : t("{name} comes round with {hp} hit points.", { name: name.trim(), hp }),
  );
  // Stand-still & skipped enemy lines (src/lib/dm/turn-lines-logic.ts)
  out = out.replace(/([^.\s\n][^.\n]*?) is ([^.\n]+?) and loses (its|their) turn\./g, (_, name, by, pron) =>
    pron === "their"
      ? t("{name} is {by} and loses their turn.", { name: name.trim(), by: translateConditionWord(t, by.trim()) })
      : t("{name} is {by} and loses its turn.", { name: name.trim(), by: translateConditionWord(t, by.trim()) }),
  );
  out = out.replace(/([^.\s\n][^.\n]*?) is caught by surprise and does nothing this round\./g, (_, name) =>
    t("{name} is caught by surprise and does nothing this round.", { name: name.trim() }),
  );
  out = out.replace(/([^.\s\n][^.\n]*?) has no one left to fight\./g, (_, name) =>
    t("{name} has no one left to fight.", { name: name.trim() }),
  );
  out = out.replace(/([^.\s\n][^.\n]*?) closes in on ([^.\n]+?) but cannot reach them this turn\./g, (_, name, target) =>
    t("{name} closes in on {target} but cannot reach them this turn.", { name: name.trim(), target }),
  );
  out = out.replace(/([^.\s\n][^.\n]*?) cannot reach ([^.\n]+?) this turn\./g, (_, name, target) =>
    t("{name} cannot reach {target} this turn.", { name: name.trim(), target }),
  );
  out = out.replace(/([^.\s\n][^.\n]*?) moves for a shot at ([^.\n]+?) but is still out of range\./g, (_, name, target) =>
    t("{name} moves for a shot at {target} but is still out of range.", { name: name.trim(), target }),
  );
  out = out.replace(/([^.\s\n][^.\n]*?) cannot get ([^.\n]+?) within range this turn\./g, (_, name, target) =>
    t("{name} cannot get {target} within range this turn.", { name: name.trim(), target }),
  );
  out = out.replace(/([^.\s\n][^.\n]*?) moves but still has no clear line to ([^.\n]+)\./g, (_, name, target) =>
    t("{name} moves but still has no clear line to {target}.", { name: name.trim(), target }),
  );
  out = out.replace(/([^.\s\n][^.\n]*?) has no clear line to ([^.\n]+?) this turn\./g, (_, name, target) =>
    t("{name} has no clear line to {target} this turn.", { name: name.trim(), target }),
  );
  out = out.replace(/([^.\s\n][^.\n]*?) is too frightened to close in on ([^.\n]+)\./g, (_, name, target) =>
    t("{name} is too frightened to close in on {target}.", { name: name.trim(), target }),
  );
  out = out.replace(/([^.\s\n][^.\n]*?) does not close in while ([^.\n]+?) holds a readied action\./g, (_, name, holder) =>
    t("{name} does not close in while {holder} holds a readied action.", { name: name.trim(), holder }),
  );
  out = out.replace(/([^.\s\n][^.\n]*?) is ([^.\n]+?) and makes no attack\./g, (_, name, by) =>
    t("{name} is {by} and makes no attack.", { name: name.trim(), by: translateConditionWord(t, by.trim()) }),
  );
  out = out.replace(/([^.\s\n][^.\n]*?) finds no one it can attack this turn\./g, (_, name) =>
    t("{name} finds no one it can attack this turn.", { name: name.trim() }),
  );
  out = out.replace(/([^.\s\n][^.\n]*?)'s turn has not come yet\./g, (_, name) =>
    t("{name}'s turn has not come yet.", { name: name.trim() }),
  );
  out = out.replace(/([^.\s\n][^.\n]*?) does not attack this turn\./g, (_, name) =>
    t("{name} does not attack this turn.", { name: name.trim() }),
  );
  out = out.replace(
    /([^:;]+) attacks ([^:]+?) with ([^(:]+) \(([^)]+) vs AC (\d+): (HIT|CRIT|MISS)(?: for ([^)]+(?:\([^)]*\))?))?\)\./g,
    (_, enemy, target, weapon, roll, ac, outcome, dmg) => {
      const outcomeFr =
        outcome === "HIT" ? t("HIT") : outcome === "CRIT" ? t("CRIT") : t("MISS");
      return dmg
        ? t("{enemy} attacks {target} with {weapon} ({roll} vs AC {ac}: {outcome} for {dmg}).", {
            enemy: enemy.trim(),
            target: target.trim(),
            weapon: weapon.trim(),
            roll,
            ac,
            outcome: outcomeFr,
            dmg,
          })
        : t("{enemy} attacks {target} with {weapon} ({roll} vs AC {ac}: {outcome}).", {
            enemy: enemy.trim(),
            target: target.trim(),
            weapon: weapon.trim(),
            roll,
            ac,
            outcome: outcomeFr,
          });
    },
  );
  out = out.replace(/ ([^.\n!]+) falls!/g, (_, target) => ` ${t("{target} falls!", { target })}`);
  out = out.replace(/^Combat begins\. Initiative order: /, () => `${t("Combat begins. Initiative order:")} `);
  return out;
}

// Translates engine-bound English sentences emitted by `composeSentence` at
// display time so the campaign chat log renders in the user's locale without
// changing the stored English action prose that the DM engine parses.
function translatePlayerAction(t: T, locale: "en" | "fr" | "es", raw: string): string {
  if (locale === "en") return raw;
  const trimmed = raw.trim();
  if (trimmed === "I end my turn.") return t("I end my turn.");
  if (trimmed === "I stand up.") return t("I stand up.");
  if (trimmed === "I dismount.") return t("I dismount.");
  // The Mount card's line (hand-play.ts composeSentence).
  if (trimmed === "I mount up.") return t("I mount up.");
  const steed = /^I mount (.+)\.$/.exec(trimmed);
  if (steed) return t("I mount {steed}.", { steed: steed[1] });
  if (trimmed === "I take the Search action.") return t("I take the Search action.");
  if (trimmed === "I try to escape the grapple.") return t("I try to escape the grapple.");
  let m = /^I attack (.+?) with (an unarmed strike|my .+?)( as a bonus action \(([^)]+)\))?\.(.*)$/.exec(trimmed);
  if (m) {
    const who = m[1] === "the nearest enemy" ? t("the nearest enemy") : m[1] === "myself" ? t("myself") : m[1];
    const weapon = m[2] === "an unarmed strike" ? t("an unarmed strike") : contentName("items", m[2].slice(3), locale);
    const lead = m[4]
      ? t("I attack {who} with {weapon} as a bonus action ({feature}).", { who, weapon, feature: t(m[4]) })
      : t("I attack {who} with {weapon}.", { who, weapon });
    const tail = m[5] ? translateActionTail(t, locale, m[5]) : "";
    return `${lead}${tail}`;
  }
  m = /^I make my off-hand attack(?: against (.+?))? with (an unarmed strike|my .+?) as a bonus action\.(.*)$/.exec(trimmed);
  if (m) {
    const weapon = m[2] === "an unarmed strike" ? t("an unarmed strike") : contentName("items", m[2].slice(3), locale);
    const lead = m[1]
      ? t("I make my off-hand attack against {who} with {weapon} as a bonus action.", { who: m[1], weapon })
      : t("I make my off-hand attack with {weapon} as a bonus action.", { weapon });
    const tail = m[3] ? translateActionTail(t, locale, m[3]) : "";
    return `${lead}${tail}`;
  }
  m = /^I (draw|stow|drop|strap on|take off) my (.+)\.$/.exec(trimmed);
  if (m) {
    const item = contentName("items", m[2], locale);
    if (m[1] === "draw") return t("I draw my {item}.", { item });
    if (m[1] === "stow") return t("I stow my {item}.", { item });
    if (m[1] === "drop") return t("I drop my {item}.", { item });
    if (m[1] === "strap on") return t("I strap on my {item}.", { item });
    return t("I take off my {item}.", { item });
  }
  m = /^I pick up the (.+)\.$/.exec(trimmed);
  if (m) return t("I pick up the {item}.", { item: contentName("items", m[1], locale) });
  m = /^I (Dash|Disengage|Hide|take the Dodge action)( as a bonus action \(([^)]+)\))?( and step away)?\.$/.exec(trimmed);
  if (m) {
    const bonus = m[3] ? ` ${t("as a bonus action ({route})", { route: t(m[3]) })}` : "";
    if (m[1] === "Dash") return t("I Dash{bonus}.", { bonus });
    if (m[1] === "Disengage") return t("I Disengage{bonus} and step away.", { bonus });
    if (m[1] === "Hide") return t("I Hide{bonus}.", { bonus });
    return t("I take the Dodge action{bonus}.", { bonus });
  }
  m = /^I try to (grapple|shove|stabilize) (.+)\.$/.exec(trimmed);
  if (m) {
    const who = m[2] === "the nearest enemy" ? t("the nearest enemy") : m[2] === "my dying ally" ? t("my dying ally") : m[2];
    if (m[1] === "grapple") return t("I try to grapple {who}.", { who });
    if (m[1] === "shove") return t("I shove {who}.", { who });
    return t("I try to stabilize {who}.", { who });
  }
  m = /^I take the Help action for (.+)\.$/.exec(trimmed);
  if (m) return t("I take the Help action for {who}.", { who: m[1] === "my ally" ? t("my ally") : m[1] });
  m = /^I shake (.+) awake\.$/.exec(trimmed);
  if (m) return t("I shake {who} awake.", { who: m[1] === "my ally" ? t("my ally") : m[1] });
  return raw;
}

function translateActionTail(t: T, locale: "en" | "fr" | "es", tail: string): string {
  const CLAUSES = [
    "I attack recklessly.",
    "If it hits, I use Stunning Strike.",
    "I strike to knock them out, not to kill.",
    "I spend my Inspiration on it.",
    "If it misses, I use Stroke of Luck.",
    "If it hits, I use Hurl Through Hell.",
    "I trade its advantage for Rapid Strike.",
    "If it hits, Open Hand Technique knocks them prone.",
    "If it hits, Open Hand Technique pushes them away.",
    "If it hits, Open Hand Technique takes their reactions.",
    "If it hits, I use Divine Smite.",
  ];
  let out = tail;
  for (const clause of CLAUSES) {
    out = out.replace(clause, t(clause));
  }
  out = out.replace(/If it hits, I use Divine Smite with a level (\d+) slot\./g, (_, lvl) =>
    t("If it hits, I use Divine Smite with a level {level} slot.", { level: lvl }),
  );
  out = out.replace(/I use (.+?) on this attack\./g, (_, rider) =>
    t("I use {rider} on this attack.", { rider: contentName("classFeatures", rider, locale) }),
  );
  return out;
}

export function SystemMessage({ content, glyph }: { content: string; glyph?: SystemGlyph }) {
  const t = useT();
  if (content.startsWith(LEAD_NOTE_PREFIX)) {
    return (
      <div data-tone="ember" className="panel session-banner-card rounded-xl border-ember-500/40">
        <SectionHead title={t("Party lead")} glyph="tab-lead" level="h4" className="mb-1" />
        <p className="text-sm text-amber-100/90">{content.slice(LEAD_NOTE_PREFIX.length)}</p>
      </div>
    );
  }
  // A pact or a secret action come out (issue 503): the server's word, drawn
  // as a card that unmasks itself (motion-app.css .pact-reveal).
  if (content.startsWith(PACT_REVEAL_PREFIX)) {
    return (
      <div className="pact-reveal panel rounded-xl border-violet-500/45 px-3 py-2" data-pact-reveal="">
        <p className="eyebrow flex items-center gap-1.5 text-[10px] text-violet-300">
          <VenetianMask className="size-3.5" aria-hidden="true" />
          {t("Revealed")}
        </p>
        <p className="mt-0.5 text-sm leading-snug text-violet-50">{content.slice(PACT_REVEAL_PREFIX.length)}</p>
      </div>
    );
  }
  // The "Previously" that opens a session reads as part of the story, at
  // narration weight under its own heading, not as a faint system line
  // (issue 668).
  if (content.startsWith(RECAP_PREFIX)) {
    return (
      <section aria-label={t("Previously")} className="panel session-banner-card session-recap rounded-xl">
        <SectionHead title={t("Previously")} glyph="cue-bell" level="h4" className="mb-1" />
        <p className="session-recap-text">{content.slice(RECAP_PREFIX.length)}</p>
      </section>
    );
  }
  const join = content.startsWith(JOIN_NOTE_PREFIX);
  // The markers the DM reads (a joiner, a settled offer) come off. Begin's
  // note reads in the interface's language instead of its stored English.
  const text =
    content === ADVENTURE_BEGINS_NOTE
      ? t("The party is assembled and the adventure begins.")
      : content === ADVENTURE_BEGINS_DM_LINE
        ? t("The party is assembled and the adventure begins. The Game Master opens the scene.")
        : translateSystemNote(t, systemNoteWords(content));
  return (
    <p className="session-sysline">
      <GameIcon icon={{ kind: "glyph", key: join ? "system-party" : (glyph ?? "cue-bell") }} size="size-6" />
      <span className="min-w-0">{text}</span>
    </p>
  );
}

// "<shop> is open", the line a shop opening where the party stands writes
// (src/lib/dm/shop-tools.ts announceShop), with the way to its shelf: the
// prices live in the Market, never in the narration. Every seat sees it.
export function ShopOpenLine({ content, onBrowse }: { content: string; onBrowse?: () => void }) {
  const lineId = useId();
  const t = useT();
  return (
    <p className="session-sysline">
      <GameIcon icon={{ kind: "glyph", key: "cue-coin" }} size="size-6" />
      <span id={lineId} className="min-w-0">{content}</span>
      {onBrowse ? (
        <button type="button" onClick={onBrowse} aria-describedby={lineId} data-browse-wares="" className={kitButtonClass("small", "shrink-0 not-italic text-amber-100")}>
          <GameIcon icon={{ kind: "glyph", key: "tab-market" }} size="size-5" />
          {t("Browse wares")}
        </button>
      ) : null}
    </p>
  );
}

export function BlockedMessage() {
  const t = useT();
  return (
    <p className="ml-auto flex max-w-[92%] items-center justify-end gap-1.5 text-right text-xs italic text-stone-600 sm:max-w-2xl">
      <EyeOff className="size-3.5 shrink-0" />
      {t("A message from a player you blocked")}
    </p>
  );
}

export function PlayerMessage({
  message,
  mine,
  sheets,
  sheetsById,
  membersById,
  onReport,
  onTakeBack,
}: {
  message: CampaignMessage;
  mine: boolean;
  sheets: CharacterSheet[];
  sheetsById: ReadonlyMap<string, TranscriptSheet>;
  membersById: Map<string, CampaignMember>;
  onReport?: (message: CampaignMessage) => void;
  // Take back and rewrite: offered on the newest move, to the lead.
  onTakeBack?: (message: CampaignMessage) => void;
}) {
  // Older messages predate characterId, so fall back to the author's
  // sheet in this campaign before giving up on a character identity. A line
  // that names its character never borrows the author's: a card the player
  // played for a companion who has since left read as the player's own
  // (0.31.1 playtest).
  // A message without a character to its name still has its actions and its
  // speaker line: "Player" is the stand-in, read in the interface's language.
  const t = useT();
  const locale = useLocale();
  const fallbackName = t("Player");
  const sheet: TranscriptSheet | undefined = message.characterId
    ? sheetsById.get(message.characterId)
    : message.userId
      ? sheets.find((candidate) => candidate.userId === message.userId)
      : undefined;
  // Character portrait first, then the player's own avatar, then a stand-in
  // (playerFaces); one that fails to load gives way to the next.
  const [portraitUrl, onFaceError] = useFaceChain(
    playerFaces({ sheet, avatarUrl: message.userId ? membersById.get(message.userId)?.avatar?.url : undefined, userId: message.userId }),
  );
  const actions: MessageAction[] = [copyAction(t, message)];
  if (onReport && !mine && message.userId) {
    actions.push(reportAction(t, message, onReport, false));
  }
  if (onTakeBack) {
    actions.push({
      id: "take-back",
      name: t("Take back"),
      label: t("Take back this move and rewrite it"),
      hint: t("Take back: remove this move and the GM's answer to it, and get its words back to correct"),
      glyph: "tab-log",
      icon: <Undo2 className="size-3.5" />,
      onSelect: () => onTakeBack(message),
    });
  }
  // The face beside a line is at most seven rem across: the small copy the
  // server keeps of a portrait (src/lib/image-variant-url.ts), not the
  // painting. A table's chronicle fetched every speaker's full portrait,
  // megabytes each, the moment it opened.
  // eslint-disable-next-line @next/next/no-img-element
  const face = portraitUrl ? <img src={variantUrl(portraitUrl, 256)} alt="" onError={onFaceError} /> : null;
  const ooc = message.content.startsWith("(ooc)");
  const body = ooc ? message.content : translatePlayerAction(t, locale, message.content);
  // The portrait as tall as the name and bubble beside it (useFaceSize).
  const [faceStyle, textColumn] = useFaceSize<HTMLDivElement>();
  return (
    <ContextMenu
      items={toContextItems(actions)}
      label={sheet?.name ?? fallbackName}
      className="session-player group ml-auto max-w-[92%] animate-fade-up sm:max-w-2xl"
    >
      {face ? (
        sheet ? (
          <PortraitMedallion classId={sheet.class} className="session-medallion" style={faceStyle}>
            {face}
          </PortraitMedallion>
        ) : (
          <div className="sheet-medallion session-medallion" style={faceStyle}>
            <div className="sheet-medallion-face">{face}</div>
          </div>
        )
      ) : null}
      <div ref={textColumn} className="min-w-0">
        <p className="mb-1 flex items-center justify-end gap-1.5 text-right">
          <MessageActions actions={actions} menuLabel={t("{name}: message actions", { name: sheet?.name ?? fallbackName })} quiet />
          <span className="session-speaker truncate">{sheet?.name ?? fallbackName}</span>
        </p>
        <div className={cn("session-bubble", ooc && "session-bubble-ooc")}>
          <p className="whitespace-pre-wrap text-pretty">{body}</p>
        </div>
        {message.cardReturned ? <CardReturnedNote message={message} mine={mine} name={sheet?.name ?? t("the player")} /> : null}
      </div>
    </ContextMenu>
  );
}
