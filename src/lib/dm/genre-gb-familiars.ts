// The machinist's clockwork familiars, built on the genre companions' road
// (src/lib/dm/genre-a-summons.ts): allies on the board with their stat
// blocks, each acting on its maker's command right after them.
//   Clockwork Familiar (machinist 3) "A small brass automaton assists you:
//     it carries, fetches, and grants advantage on one check per rest". It
//     comes with the chapter at 3rd, since the Clockwork Savant's frame for
//     it arrives then (at 6th the frame sat idle three levels). The
//     free card builds it out of a fight (a Tiny construct, AC 13, HP 5 + the
//     machinist's level, no attack); its help is a second card, once a rest,
//     that leaves the Help for a check on the machinist (help-logic.ts), so
//     their next ability check has advantage.
//   Improved Familiar Frame (Clockwork Savant 3) "a sting (1d8 + INT
//     piercing, 30 ft) and HP equal to 3 x your level".
//   Twin Automata (Clockwork Savant 11) "Build a second familiar; both act on
//     your command".
//   The Great Work Walks (Clockwork Savant 15) "1/long rest, your familiars
//     merge into a brass juggernaut for 10 minutes (double HP, 2d10 + INT
//     slam, you may ride it)": the familiars leave the board and the
//     juggernaut stands for 100 rounds with twice one familiar's hit points;
//     afterwards the familiars are built again with the free card.
// INT and proficiency are the machinist's, as the drones' are the rigger's.
import { randomUUID } from "node:crypto";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { computeSheetDerived } from "@/lib/srd";
import type { SummonForm } from "@/lib/srd/summon-forms";
import { holdsFeature } from "@/lib/srd/trait-rules";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { summonRecord } from "@/lib/dm/summon-rules";
import { removeSummon, spawnSummons, summonsOf } from "@/lib/dm/summon-store";
import type { ToolError } from "@/lib/dm/tool-errors";
import { HELPED, HELP_FOR_A_CHECK } from "@/lib/dm/help-logic";

export type FamiliarWork = "familiar" | "familiar_help" | "juggernaut";

const FAMILIAR = "Clockwork Familiar";
const JUGGERNAUT = "The Great Work Walks";
const ABILITIES = { str: 8, dex: 14, con: 12, int: 6, wis: 10, cha: 3 };
const BASE = { type: "construct", cr: 0, speed: 30, abilities: ABILITIES, immune: "poison, psychic", conditionImmune: "charmed, exhaustion, frightened, poisoned" };

// The familiars the machinist's features build.
export function familiarForms(sheet: CharacterSheet, level: number): SummonForm[] {
  const derived = computeSheetDerived(sheet);
  const int = derived.abilityMods.int;
  const framed = holdsFeature(sheet, "Improved Familiar Frame");
  const one: SummonForm = {
    ...BASE,
    name: "Clockwork Familiar",
    size: "Tiny",
    ac: 13,
    hp: Math.max(1, framed ? 3 * level : 5 + level),
    attacks: framed ? [{ name: "Sting", toHit: derived.proficiencyBonus + int, damage: `1d8+${int}`, type: "piercing", range: 30 }] : [],
    traits: "A brass automaton that carries and fetches and acts on the machinist's command.",
  };
  return holdsFeature(sheet, "Twin Automata") ? [one, { ...one }] : [one];
}

export function juggernautForm(sheet: CharacterSheet, level: number): SummonForm {
  const derived = computeSheetDerived(sheet);
  const int = derived.abilityMods.int;
  return {
    ...BASE,
    abilities: { ...ABILITIES, str: 18, con: 16 },
    name: "Brass Juggernaut",
    size: "Large",
    ac: 13,
    hp: 2 * familiarForms(sheet, level)[0].hp,
    attacks: [{ name: "Slam", toHit: derived.proficiencyBonus + int, damage: `2d10+${int}`, type: "bludgeoning" }],
    traits: "The machinist's familiars merged for 10 minutes; the machinist may ride it. Acts on the machinist's command.",
  };
}

const inFight = (campaignId: string) => {
  const encounter = getActiveEncounter(campaignId);
  return Boolean(encounter && encounter.status === "active" && (encounter.kind ?? "fight") === "fight");
};

function spawn(campaign: Campaign, sheet: CharacterSheet, spell: string, forms: SummonForm[], rounds: number | null): CharacterSheet[] {
  const castId = randomUUID().slice(0, 8);
  return forms.flatMap((form) =>
    spawnSummons(campaign, sheet, { form, count: 1, record: summonRecord(form, { spell, casterId: sheet.id, casterName: sheet.name, concentration: false, castId }), rounds, slotLevel: null, initiative: "caster", overrides: { level: sheet.level } }),
  );
}

const listed = (made: CharacterSheet[]) => made.map((entry) => ({ characterId: entry.id, name: entry.name, hp: `${entry.currentHp}/${entry.maxHp}`, ac: entry.ac }));

export function familiarWork(
  campaign: Campaign,
  sheet: CharacterSheet,
  work: FamiliarWork,
  level: number,
): ToolError | { result: Record<string, unknown>; patch?: FullPatchSheetInput } {
  const standing = summonsOf(campaign.id, sheet.id, FAMILIAR);
  if (work === "familiar") {
    if (inFight(campaign.id)) {
      return { error: `${sheet.name}'s familiar is built outside a fight, not in the middle of one. Nothing was spent.`, refused: "rules" };
    }
    for (const old of [...standing, ...summonsOf(campaign.id, sheet.id, JUGGERNAUT)]) {
      removeSummon(campaign, old);
    }
    const made = spawn(campaign, sheet, FAMILIAR, familiarForms(sheet, level), null);
    return { result: { summoned: listed(made), note: `Allies on the board acting right after ${sheet.name}; each attacks with pc_attack under its own characterId.${standing.length ? " The old ones are gone." : ""}` } };
  }
  if (!standing.length) {
    return { error: `${sheet.name} has no clockwork familiar standing: build one first (Clockwork Familiar, out of a fight). Nothing was spent.`, refused: "rules" };
  }
  if (work === "familiar_help") {
    return {
      patch: { conditions: [...sheet.conditions.filter((entry) => entry.trim().toLowerCase() !== HELPED), HELPED], conditionMeta: { ...sheet.conditionMeta, [HELPED]: { source: HELP_FOR_A_CHECK } } },
      result: { applied: [`${sheet.name}'s familiar helps: advantage on their next ability check.`] },
    };
  }
  for (const old of standing) {
    removeSummon(campaign, old);
  }
  const made = spawn(campaign, sheet, JUGGERNAUT, [juggernautForm(sheet, level)], 100);
  return { result: { summoned: listed(made), note: `The familiars merge into a brass juggernaut for 10 minutes; ${sheet.name} may ride it. When it ends, build the familiars again with Clockwork Familiar.` } };
}
