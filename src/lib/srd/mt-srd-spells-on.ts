// The spells whose effects lie on a sheet, each with the conditions it laid
// there: what Cleansing Touch can end (SRD 5.1, paladin 14: "end one spell
// on yourself or on one willing creature that you touch"). The engine
// (dm/mt-srd-paladin.ts cleansingTouch) and the counter's gate, which the
// Hand's card reads (counter-rules.ts counterGate), ask the same list, so the
// card is shut exactly when the engine would find nothing to end.
//
// A condition a spell laid carries the spell's name in its meta; a spell the
// sheet concentrates on is on it too.
//
// Pure.

type SpellHolder = { conditions: string[]; conditionMeta?: unknown; concentratingOn?: string | null };

export function spellsOn(sheet: SpellHolder): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const meta = (sheet.conditionMeta ?? {}) as Record<string, unknown>;
  for (const name of sheet.conditions) {
    // One instance, with any further sources' under `others`
    // (dm/condition-logic.ts instancesOf).
    const held = meta[name] as { others?: unknown[] } | undefined;
    for (const entry of held ? [held, ...(held.others ?? [])] : []) {
      const spell = (entry as { spell?: unknown }).spell;
      if (typeof spell === "string" && spell) {
        out.set(spell, [...(out.get(spell) ?? []), name]);
      }
    }
  }
  if (sheet.concentratingOn && !out.has(sheet.concentratingOn)) {
    out.set(sheet.concentratingOn, []);
  }
  return out;
}
