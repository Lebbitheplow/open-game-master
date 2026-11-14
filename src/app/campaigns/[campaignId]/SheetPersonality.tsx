"use client";

import { useState } from "react";
import { SheetBlock } from "@/components/sheet/SheetParts";
import { PersonaLines, PersonalityFields } from "@/app/characters/builder/PersonalityFields";
import { EMPTY_PERSONA, personaOrNothing, personaSuggestionsFor } from "@/lib/backgrounds/persona-logic";
import type { CharacterSheet, Persona } from "@/lib/schemas/sheet";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";
import { KitButton } from "./PanelKit";

// The character's trait, ideal, bond and flaw on the sheet in play. The
// whole party reads them, as it reads the backstory; the owner changes them
// any time, the way the builder's Identity step first asked them (who the
// character is grows with the story). The GM reads them every turn
// (src/lib/dm/prompt.ts describeSheet).
export function SheetPersonality({ sheet, mine }: { sheet: CharacterSheet; mine: boolean }) {
  const [draft, setDraft] = useState<Persona | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // A host from before the field drops it while answering the save as done.
  const kept = hostOffers(useCapabilities(), "persona");
  const given = personaOrNothing(sheet.persona);
  if (!kept || (!mine && !given) || sheet.isCompanion) {
    return null;
  }
  if (!mine) {
    return (
      <SheetBlock className="mt-4" title="Personality">
        <PersonaLines persona={given} />
      </SheetBlock>
    );
  }

  async function save(next: Persona) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${sheet.campaignId}/sheet`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: sheet.id, persona: personaOrNothing(next) ?? EMPTY_PERSONA }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not save the personality.");
        return;
      }
      setDraft(null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetBlock className="mt-4" title="Personality">
      {draft === null ? (
        <div className="space-y-2">
          {given ? (
            <PersonaLines persona={given} />
          ) : (
            <p className="text-xs text-stone-400">
              A trait, an ideal, a bond and a flaw: four short lines the GM plays your hero by.
            </p>
          )}
          <KitButton onClick={() => setDraft(given ?? EMPTY_PERSONA)}>{given ? "Change personality" : "Add a personality"}</KitButton>
        </div>
      ) : (
        <div className="space-y-3">
          <PersonalityFields value={draft} onChange={setDraft} suggestions={personaSuggestionsFor({ id: sheet.background })} />
          <div className="flex flex-wrap justify-end gap-2">
            <KitButton onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </KitButton>
            <KitButton onClick={() => void save(draft)} disabled={saving} busy={saving} className="border-amber-500/50 text-amber-100">
              Save personality
            </KitButton>
          </div>
          {error ? (
            <p role="alert" className="text-xs text-red-300">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </SheetBlock>
  );
}
