"use client";

import { useEffect, useMemo, useState } from "react";
import { handSpellsToLookUp, type SpellFact } from "@/lib/battlemap/hand";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { normalizeSpellMech } from "@/lib/homebrew/gear";
import { factsFromRow } from "@/lib/srd/spell-facts";
import { scopeQuery } from "@/lib/content-scope";
import { textKey } from "@/lib/language/text-logic";
import type { SummonCatalogue } from "@/lib/srd/summon-spells";
import type { PetFormCatalogue } from "@/lib/dm/pet-form-logic";

// What the content pack says about the spells on a sheet, for the Hand's
// spell cards: level, casting time, range and the prose the mechanics are
// parsed from. Read through the content search the level-up dialog already
// uses, once per spell per table per page; a table without the pack simply
// gets the authored rows hand.ts falls back to. The search is the table's
// (src/lib/content/scope.ts), so a spell its DM wrote is found for a
// player too, with its own block, casting facts and the spell it runs as.

type SpellResult = {
  name: string;
  level: number;
  school: string;
  concentration: boolean;
  ritual?: boolean;
  classes?: string[];
  aliases?: string[];
  source?: string;
  documentSlug?: string;
  data: Record<string, unknown>;
  // Played from mechanics the app read and nobody checked (issue #570).
  bestEffort?: boolean;
};

// null = looked up and not found, so it is not asked for again.
const cache = new Map<string, SpellFact | null>();

function toFact(entry: SpellResult): SpellFact {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const homebrew = entry.source === "homebrew";
  const mech = homebrew ? normalizeSpellMech(entry.data.mech) : null;
  const runsAs = homebrew ? text(entry.data.runsAs) : "";
  return {
    level: entry.level,
    school: entry.school,
    castingTime: text(entry.data.casting_time),
    range: text(entry.data.range),
    desc: text(entry.data.desc),
    higherLevel: text(entry.data.higher_level),
    concentration: entry.concentration,
    ...(entry.bestEffort ? { bestEffort: true } : {}),
    ...(mech ? { mech } : {}),
    ...(runsAs ? { runsAs } : {}),
    // The card reads the facts the cast guard reads: the row's own
    // (content spellFactsFor, spell-facts.ts). The bundled data knows no
    // workshop spell, and keeps only the checklist line of a pack spell
    // outside the SRD, with no components: the card of a Ray of Sickness
    // was open with both hands full, and the cast guard refused it.
    facts: factsFromRow({
      name: entry.name,
      level: entry.level,
      ritual: entry.ritual,
      concentration: entry.concentration,
      classes: entry.classes,
      aliases: entry.aliases,
      homebrew,
      data: entry.data,
    }),
  };
}

async function lookUp(name: string, campaignId: string | null): Promise<SpellFact | null> {
  const response = await fetch(`/api/content/spells?q=${encodeURIComponent(name)}&limit=8${scopeQuery(campaignId, "&")}`);
  if (!response.ok) return null;
  const body = (await response.json()) as { results?: SpellResult[] };
  const wanted = textKey(name);
  const exact = (body.results ?? []).filter(
    (entry) => textKey(entry.name) === wanted || (entry.aliases ?? []).some((alias) => textKey(alias) === wanted),
  );
  // The SRD's own wording is what the engine's parsers were written against.
  const best = exact.find((entry) => entry.documentSlug !== "a5e") ?? exact[0];
  return best ? toFact(best) : null;
}

export function useHandSpells(sheet: CharacterSheet | null): Record<string, SpellFact> {
  const names = useMemo(() => (sheet ? handSpellsToLookUp(sheet) : []), [sheet]);
  const wanted = names.map(textKey).join("|");
  // Cached per table: two tables may each have a spell of the same name.
  const campaignId = sheet?.campaignId ?? null;
  const scope = campaignId ?? "library";
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const missing = wanted.split("|").filter((key) => key && !cache.has(`${scope}|${key}`));
    if (!missing.length) return;
    let live = true;
    void Promise.all(
      missing.map(async (key) => {
        try {
          cache.set(`${scope}|${key}`, await lookUp(key, campaignId));
        } catch {
          // Offline or refused: left out of the cache so a later turn retries.
        }
      }),
    ).then(() => {
      if (live) setVersion((current) => current + 1);
    });
    return () => {
      live = false;
    };
  }, [wanted, scope, campaignId]);

  return useMemo(() => {
    const out: Record<string, SpellFact> = {};
    for (const key of wanted.split("|")) {
      const fact = cache.get(`${scope}|${key}`);
      if (fact) out[key] = fact;
    }
    return out;
    // `version` is the cache's change signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, scope, version]);
}

// The creatures each summoning spell on the sheet can call (issue 685), for
// its card's creature picker (src/lib/battlemap/hand-summon.ts): asked of
// the table's server (GET /api/campaigns/[id]/summons), which answers from
// the stat blocks the cast spawns, a workshop copy as the spell it runs as.
// The answer is the character's own (Pact of the Chain's familiar forms,
// whether they may cast it as a ritual). Once per spell per character per
// page; nothing is asked where the host has no picker (`enabled`), and a
// spell that makes no creatures is remembered as such. Keyed by textKey of
// the spell's name as the sheet holds it.
const summonCache = new Map<string, SummonCatalogue | null>();
const SUMMON_BATCH = 60;

export function useHandSummons(sheet: CharacterSheet | null, enabled: boolean): Record<string, SummonCatalogue> {
  const campaignId = sheet?.campaignId ?? null;
  const characterId = sheet?.id ?? "";
  const names = useMemo(() => (sheet && enabled ? handSpellsToLookUp(sheet) : []), [sheet, enabled]);
  const wanted = names.join("\n");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!campaignId) return;
    const missing = wanted.split("\n").filter((name) => name && !summonCache.has(`${characterId}|${textKey(name)}`));
    if (!missing.length) return;
    let live = true;
    const batches: string[][] = [];
    for (let at = 0; at < missing.length; at += SUMMON_BATCH) batches.push(missing.slice(at, at + SUMMON_BATCH));
    void Promise.all(
      batches.map(async (batch) => {
        try {
          const query = [...batch.map((name) => `spell=${encodeURIComponent(name)}`), `characterId=${encodeURIComponent(characterId)}`].join("&");
          const response = await fetch(`/api/campaigns/${campaignId}/summons?${query}`);
          if (!response.ok) return;
          const body = (await response.json()) as { summons?: Record<string, SummonCatalogue> };
          for (const name of batch) summonCache.set(`${characterId}|${textKey(name)}`, body.summons?.[name] ?? null);
        } catch {
          // Offline or refused: left out of the cache so a later turn retries.
        }
      }),
    ).then(() => {
      if (live) setVersion((current) => current + 1);
    });
    return () => {
      live = false;
    };
  }, [wanted, campaignId, characterId]);

  return useMemo(() => {
    const out: Record<string, SummonCatalogue> = {};
    for (const name of wanted.split("\n")) {
      const found = campaignId ? summonCache.get(`${characterId}|${textKey(name)}`) : null;
      if (found) out[textKey(name)] = found;
    }
    return out;
    // `version` is the cache's change signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, campaignId, characterId, version]);
}

// One spell's summoning catalogue, for the GM console's summon fields
// (DmActionForm.tsx): the spell the form names, as the caster the form names
// would cast it. Shares the cache above; null until it is known, or when the
// spell makes no creatures.
export function useSummonCatalogue(campaignId: string, spell: string, characterId: string, enabled: boolean): SummonCatalogue | null {
  const name = spell.trim();
  const key = `${characterId}|${textKey(name)}`;
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled || !name || summonCache.has(key)) return;
    let live = true;
    const query = [`spell=${encodeURIComponent(name)}`, ...(characterId ? [`characterId=${encodeURIComponent(characterId)}`] : [])].join("&");
    void fetch(`/api/campaigns/${campaignId}/summons?${query}`)
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { summons?: Record<string, SummonCatalogue> };
        summonCache.set(key, body.summons?.[name] ?? null);
        if (live) setVersion((current) => current + 1);
      })
      .catch(() => {
        // Offline or refused: asked again when the spell or caster changes.
      });
    return () => {
      live = false;
    };
  }, [campaignId, name, characterId, key, enabled]);
  return enabled && name ? (summonCache.get(key) ?? null) : null;
}

// Summon a pet's creatures for the GM console (src/lib/dm/pet-form-logic.ts),
// as the pet's owner may have them (Pact of the Chain's familiar forms only
// with the pact), once per owner per page: the table's own monsters change
// in the workshop rarely within a session, and a fresh page reads them again.
const petForms = new Map<string, PetFormCatalogue | null>();

export function usePetForms(campaignId: string, ownerId: string, enabled: boolean): PetFormCatalogue | null {
  const key = `${campaignId}|${ownerId}`;
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled || petForms.has(key)) return;
    let live = true;
    void fetch(`/api/campaigns/${campaignId}/dm/pet-forms${ownerId ? `?characterId=${encodeURIComponent(ownerId)}` : ""}`)
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { catalogue?: PetFormCatalogue };
        petForms.set(key, body.catalogue ?? null);
        if (live) setVersion((current) => current + 1);
      })
      .catch(() => {
        // Offline: asked again when the form opens next.
      });
    return () => {
      live = false;
    };
  }, [campaignId, ownerId, key, enabled]);
  return enabled ? (petForms.get(key) ?? null) : null;
}
