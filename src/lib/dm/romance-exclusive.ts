import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { companionNpcFor } from "@/lib/db/companion-npcs";
import { listRecentMessages } from "@/lib/db/messages";
import { getNpcByName } from "@/lib/db/npcs";
import { listRelationships, type Relationship } from "@/lib/db/relationships";
import { listSheets } from "@/lib/db/sheets";
import { openToMore } from "@/lib/attraction";
import { heroFell } from "@/lib/characters/fallen-logic";
import { landBeat, type Landing } from "@/lib/dm/beat-landing";
import { friendshipTier, TIER_LABEL } from "@/lib/dm/relationship-logic";
import { openLedger, resolveSubject } from "@/lib/dm/relationship-subject";
import {
  exclusiveLine,
  exclusiveProblem,
  partnersWhoMind,
  spokenFor,
  unfaithfulSeverity,
  type Lover,
  type RomanceParties,
} from "@/lib/dm/romance-exclusive-logic";
import { containsPhrase, textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Romance is exclusive by default (issue 642), the rim: who is spoken for
// at this table, read from the bonds and from each person's "Drawn to"
// (open to more than one partner), and the partner's reaction to a romantic
// move toward someone else. The rules are romance-exclusive-logic.ts.
//
// romance_advance (a player's step and an NPC's first move, AI and console
// alike) asks exclusiveBetween before it takes a step, the advance roll asks
// it before it offers anyone a moment, and relationship_beat lands
// landPartnerReactions after a romantic beat. The claims reader's flirt
// (issue 641) stands on unfaithfulMove and landPartnerReactions too.

// A bond that makes two people partners at this table: declared, not over,
// and not held by a hero who has fallen (issue 657: the dead court nobody).
function binding(relationship: Relationship, fallen: ReadonlySet<string>): boolean {
  return spokenFor(relationship) && !fallen.has(relationship.characterId);
}

// Whether someone is open to more than one partner: a player character's or
// a companion's own sheet first, else the row behind the companion or the
// NPC, as who they are drawn to is read (src/lib/db/companion-npcs.ts).
export function personOpen(campaignId: string, name: string, sheets: readonly CharacterSheet[]): boolean {
  const sheet = sheets.find((candidate) => textKey(candidate.name) === textKey(name));
  if (sheet) {
    return openToMore(sheet.attraction) || (sheet.isCompanion && openToMore(companionNpcFor(sheet)?.attraction));
  }
  return openToMore(getNpcByName(campaignId, name)?.attraction);
}

type Read = { relationships?: readonly Relationship[]; sheets?: readonly CharacterSheet[] };

function tableRead(campaignId: string, read: Read) {
  const sheets = read.sheets ?? listSheets(campaignId);
  const fallen = new Set(sheets.filter(heroFell).map((sheet) => sheet.id));
  const bonds = (read.relationships ?? listRelationships(campaignId)).filter((relationship) => binding(relationship, fallen));
  return { sheets, bonds };
}

// Who is in a romance between this character and this subject, and who each
// is already spoken for with. Null when the character is not at the table.
export function romanceParties(campaignId: string, characterId: string, subjectName: string, read: Read = {}): RomanceParties | null {
  const { sheets, bonds } = tableRead(campaignId, read);
  const character = sheets.find((sheet) => sheet.id === characterId);
  if (!character) {
    return null;
  }
  const subject = textKey(subjectName);
  const lover = (name: string): Lover => ({ name, open: personOpen(campaignId, name, sheets) });
  return {
    a: { name: character.name, open: openToMore(character.attraction) },
    b: lover(subjectName),
    aPartners: bonds.filter((bond) => bond.characterId === characterId && textKey(bond.subjectName) !== subject).map((bond) => lover(bond.subjectName)),
    bPartners: bonds
      .filter((bond) => textKey(bond.subjectName) === subject && bond.characterId !== characterId)
      .map((bond) => lover(sheets.find((sheet) => sheet.id === bond.characterId)?.name ?? bond.characterName)),
  };
}

// Why a romance between them may not start or go further, or null.
export function exclusiveBetween(campaignId: string, characterId: string, subjectName: string, read: Read = {}): string | null {
  const parties = romanceParties(campaignId, characterId, subjectName, read);
  return parties ? exclusiveProblem(parties) : null;
}

// ---- a romantic move toward someone else ----

export type MindingPartner = {
  name: string;
  relationship: Relationship;
  // In the scene to see it: a companion travelling with the party, or
  // someone named among the witnesses or in what the table was just told.
  present: boolean;
};

export type MoveContext = {
  // Who the GM says saw it (relationship_beat's witnesses).
  witnesses?: readonly string[];
  // The text of the moment: the narration the table was just told, the
  // players' lines since, and this reply so far.
  narration?: string;
  sheets?: readonly CharacterSheet[];
};

// The seam for the claims reader (issue 641): would a romantic move by this
// character toward `towardName` be unfaithful, and which partners would mind
// it. A partner minds unless both of them are open; the person it is aimed
// at is never their own partner here.
export function unfaithfulMove(campaign: Campaign, sheet: CharacterSheet, towardName: string, context: MoveContext = {}): { unfaithful: boolean; mind: MindingPartner[] } {
  const { sheets, bonds } = tableRead(campaign.id, { sheets: context.sheets });
  const toward = resolveSubject(campaign, towardName, [...sheets]);
  const towardKey = textKey("error" in toward ? towardName : toward.name);
  const partners = bonds.filter((bond) => bond.characterId === sheet.id && textKey(bond.subjectName) !== towardKey);
  const mover: Lover = { name: sheet.name, open: openToMore(sheet.attraction) };
  const minding = partnersWhoMind(
    mover,
    partners.map((bond) => ({ name: bond.subjectName, open: personOpen(campaign.id, bond.subjectName, sheets), bond })),
  );
  const witnesses = new Set((context.witnesses ?? []).map((name) => textKey(name)));
  const narration = context.narration ?? "";
  const mind = minding.map(({ name, bond }) => {
    const travelling = bond.status === "active" && sheets.some((entry) => entry.isCompanion && textKey(entry.name) === textKey(name));
    const present = travelling || witnesses.has(textKey(name)) || (Boolean(narration.trim()) && containsPhrase(narration, name));
    return { name, relationship: bond, present };
  });
  return { unfaithful: mind.length > 0, mind };
}

// What the table was just told and said: the last narration, every line
// since, and this reply so far. A partner named in it is in the scene.
export function momentText(campaignId: string, turn: Pick<DmTurn, "narrationParts">): string {
  const recent = listRecentMessages(campaignId, 8);
  const lastNarration = recent.map((message) => message.authorType).lastIndexOf("dm");
  const since = lastNarration === -1 ? recent : recent.slice(lastNarration);
  return [...since.map((message) => message.content), ...turn.narrationParts].join("\n");
}

// The deed a partner who saw it judges (issue 642): each partner who would
// mind and was there takes "unfaithful", weighed as any deed is, by who they
// are and what they hold to (beat-landing.ts landBeat), heavier once they
// are partners than while courting. Returns the landings and the GM's lines.
export function landPartnerReactions(
  campaign: Campaign,
  sheet: CharacterSheet,
  towardName: string,
  context: MoveContext = {},
): { landings: Landing[]; notes: string[] } {
  const sheets = [...(context.sheets ?? listSheets(campaign.id))];
  const { mind } = unfaithfulMove(campaign, sheet, towardName, { ...context, sheets });
  const landings: Landing[] = [];
  const notes: string[] = [];
  for (const partner of mind) {
    if (!partner.present) {
      notes.push(`${sheet.name} is with ${partner.name}, who did not see it.`);
      continue;
    }
    const subject = resolveSubject(campaign, partner.name, sheets);
    if ("error" in subject) {
      continue;
    }
    const ledger = openLedger(campaign, sheet, subject);
    const landed = landBeat(campaign, sheet, subject, ledger, "unfaithful", null, `${sheet.name} flirted with ${towardName}`, {
      severity: unfaithfulSeverity(ledger.romance),
      faction: "",
      demand: "",
    });
    landings.push(landed);
    notes.push(
      `${partner.name} saw ${sheet.name} flirt with ${towardName}, and it hurts: ${partner.name} now stands ${TIER_LABEL[friendshipTier(landed.updated.approval)]} toward ${sheet.name}. Play their reaction.`,
    );
  }
  return { landings, notes };
}

// The result's half of it, for the GM: each partner it cost.
export function partnerResult(landings: readonly Landing[]): { partners?: Array<{ subject: string; approvalChange: number; standing: string }> } {
  return landings.length
    ? { partners: landings.map((landing) => ({ subject: landing.subject.name, approvalChange: landing.delta, standing: friendshipTier(landing.updated.approval) })) }
    : {};
}

// GAME STATE's line while anyone at the table is spoken for (issue 642):
// who is exclusive, and who is open along with their partner. Nothing while
// nobody is, so most tables never pay for it.
export function exclusiveLinesForPrompt(campaignId: string): string[] {
  const { sheets, bonds } = tableRead(campaignId, {});
  const exclusive: Array<{ character: string; partner: string }> = [];
  const open: Array<{ character: string; partner: string }> = [];
  for (const bond of bonds) {
    const character = sheets.find((sheet) => sheet.id === bond.characterId);
    if (!character || character.isCompanion) {
      continue;
    }
    const pair = { character: character.name, partner: bond.subjectName };
    (openToMore(character.attraction) && personOpen(campaignId, bond.subjectName, sheets) ? open : exclusive).push(pair);
  }
  const line = exclusiveLine(exclusive.slice(0, 6), open.slice(0, 6));
  return line ? [line] : [];
}
