// What the Hand's page fetches before it deals: the spell facts the content
// search answers (HandSpells.tsx useHandSpells) and the summon catalogue the
// summons route answers (GET /api/campaigns/[id]/summons), built here on the
// server side for the Hand sweep (scripts/lib/sweep-hand.mjs deal).
export async function handFacts(src) {
  const hand = await src("lib/battlemap/hand.ts");
  const content = await src("lib/content/index.ts");
  const { bundledSpellFacts } = await src("lib/srd/spell-facts.ts");
  const { authoredSpellRow } = await src("lib/srd/spell-mechanics.ts");
  const { textKey } = await src("lib/language/text-logic.ts");
  const summonSpells = await src("lib/srd/summon-spells.ts");
  const familiars = await src("lib/srd/familiar-forms.ts");
  const { hasPactOfTheChain } = await src("lib/dm/pet-build.ts");
  const { ritualProblem } = await src("lib/dm/cast-rules.ts");

  const factCache = new Map();
  function spellFact(name) {
    const key = textKey(name);
    if (factCache.has(key)) return factCache.get(key);
    let fact = null;
    const entry = content.findSpellByName(name);
    const text = (value) => (typeof value === "string" ? value : "");
    if (entry) {
      // The row's own facts, as HandSpells.tsx toFact sends them.
      fact = { level: entry.level, school: entry.school, castingTime: text(entry.data.casting_time), range: text(entry.data.range), desc: text(entry.data.desc), higherLevel: text(entry.data.higher_level), concentration: entry.concentration, facts: content.spellFactsFor(name) };
    } else {
      const bundled = bundledSpellFacts(name);
      const authored = authoredSpellRow(name);
      if (bundled || authored) {
        fact = {
          level: bundled?.level ?? authored?.level ?? 1,
          school: bundled?.school ?? authored?.school ?? "",
          castingTime: authored?.casting_time ?? (bundled?.castingTime === "bonus" ? "1 bonus action" : bundled?.castingTime === "reaction" ? "1 reaction" : "1 action"),
          range: authored?.range ?? (bundled?.range?.kind === "feet" ? `${bundled.range.feet} feet` : bundled?.range?.kind === "touch" ? "Touch" : "Self"),
          desc: authored?.desc ?? "",
          higherLevel: authored?.higher_level ?? "",
          concentration: bundled?.concentration ?? authored?.concentration ?? false,
        };
      }
    }
    factCache.set(key, fact);
    return fact;
  }

  function spellsFor(sheet) {
    const out = {};
    for (const name of hand.handSpellsToLookUp(sheet)) {
      const fact = spellFact(name);
      if (fact) out[textKey(name)] = fact;
    }
    return out;
  }

  // What GET /api/campaigns/[id]/summons answers for this caster.
  function summonsFor(sheet, authors) {
    const out = {};
    for (const name of hand.handSpellsToLookUp(sheet)) {
      const engine = content.spellEngineName(name, authors);
      const summoning = summonSpells.summonSpellFor(engine);
      const catalogue = summoning ? summonSpells.summonCatalogue(summoning) : familiars.isFindFamiliar(engine) ? familiars.familiarCatalogue() : null;
      if (!catalogue) continue;
      const facts = content.spellFactsFor(name, authors);
      const chain = hasPactOfTheChain(sheet);
      out[textKey(name)] = {
        ...catalogue,
        ...(typeof facts?.castingTime === "number" ? { long: true } : {}),
        forms: catalogue.forms.filter((form) => chain || !form.chainOnly),
        ...(facts?.ritual && !ritualProblem(sheet, name, facts) ? { ritual: true } : {}),
      };
    }
    return out;
  }

  return { spellsFor, summonsFor };
}
