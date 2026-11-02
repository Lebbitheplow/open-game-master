"use client";

import { Loader2, Swords } from "lucide-react";
import { useEffect, useState } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { Sheet } from "@/components/ui/Sheet";
import { PanelError } from "@/app/campaigns/[campaignId]/PanelKit";
import { classWordsAfterLevel, speciesName } from "@/lib/characters/class-words";
import { cn } from "@/lib/cn";
import { readLoad, readWrite } from "@/lib/load-state";
import { navigateTo } from "@/lib/navigation";
import { ui } from "@/lib/ui";
import { TARGET_PARTY_LIMITS } from "@/lib/workshop/kind";
import { TEST_ALLY_LIMIT } from "@/lib/workshop/test-seats-logic";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";
import type { PreparedEncounter } from "@/app/workshop/encounters/types";

// Test fight (issue 553): who fights the prepared fight, then the table
// (src/lib/workshop/test-fight.ts). Each question has a default that needs
// no answer. The stand-ins are the party the workshop is built for, so one
// press tests what every budget in the workshop was measured against; the
// other answer is the author's own characters, when the question is how
// their party fares. Where an AI DM is set up it runs the fight unless the
// author would rather run it, as they run their own tables; where none is,
// the author runs it and the sheet only says so.
//
// Allies (issue 685): a fight written around an ally is tested with that
// ally. The companions the author keeps are offered beside either party,
// marked as allies, and only to an author who keeps any; none is picked
// unless the author picks one.

export type TestFightInfo = {
  ready: boolean;
  reason: string;
  // Set when the server's "Who may start campaigns and workshops" keeps this
  // person from starting one; an older host leaves it out.
  refused?: string;
  standIns: { size: number; level: number; classes: string[] };
  open: { id: string; title: string; createdAt: string } | null;
};

type Character = {
  id: string;
  name: string;
  role: "pc" | "companion";
  race: string;
  class: string;
  level: number;
};

type Who = "stand-ins" | "characters";

// "Level 4 Variant Human Fighter", in the words the library's cards use: the
// ids themselves ("variant_human", "srd-2024-goliath") read as code here.
function describe(character: Character): string {
  return `Level ${character.level} ${[speciesName(character), classWordsAfterLevel(character)].filter(Boolean).join(" ")}`;
}

function listed(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// Whether the party picked is the one a fight's set-up was saved with
// (src/lib/workshop/fight-setup-logic.ts samePartyAsSetup, for the sheet).
function sameAsSetup(party: NonNullable<PreparedEncounter["setupParty"]>, who: Who, picked: string[], allies: string[]): boolean {
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, index) => id === b[index]);
  if (!same(party.allyIds ?? [], allies)) return false;
  if (party.kind === "stand-ins") return who === "stand-ins";
  return who === "characters" && same(party.characterIds, picked);
}

const choiceCard =
  "flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-amber-400/40";

export function TestFightSheet({
  workshopId,
  encounter,
  info,
  onClose,
}: {
  workshopId: string;
  // The fight to test; null keeps the sheet shut.
  encounter: PreparedEncounter | null;
  info: TestFightInfo | null;
  onClose: () => void;
}) {
  const [whoChoice, setWho] = useState<Who | null>(null);
  const [runner, setRunner] = useState<"ai" | "person">("ai");
  const [pickedChoice, setPicked] = useState<string[] | null>(null);
  const [alliesChoice, setAllies] = useState<string[] | null>(null);
  // An older host drops the allies unread and starts the test without them
  // (capabilities.ts testFightAllies), so it is offered none.
  const allyOffer = hostOffers(useCapabilities(), "testFightAllies");
  const [pregens, setPregens] = useState<Character[] | null>(null);
  const [library, setLibrary] = useState<Character[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = encounter !== null;
  const setupParty = encounter?.setup?.length ? (encounter.setupParty ?? null) : null;
  // Until the author answers, a fight with a saved set-up offers the party
  // it was saved with, so the moment is the same moment (issue 685), and
  // any other fight the stand-ins. Another answer is one press away, and
  // says below what it costs.
  const who: Who = whoChoice ?? (setupParty?.kind === "characters" ? "characters" : "stand-ins");
  const picked = pickedChoice ?? (setupParty?.kind === "characters" ? setupParty.characterIds : []);
  const allies = alliesChoice ?? setupParty?.allyIds ?? [];

  // The characters are read when the sheet opens, the roster first: the
  // pregens are the ones made for this workshop. Heroes and allies are told
  // apart by the role each is filed under.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([
      readLoad<{ pregens?: Character[] }>(fetch(`/api/workshops/${workshopId}/pregens`), "The roster"),
      readLoad<{ characters?: Character[] }>(fetch("/api/characters"), "Your characters"),
    ]).then(([roster, shelf]) => {
      if (cancelled) return;
      setLoadError(roster.error ?? shelf.error ?? "");
      setPregens(roster.payload?.pregens ?? []);
      setLibrary(shelf.payload?.characters ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [open, workshopId]);

  function close(next: boolean) {
    if (next) return;
    setError("");
    setBusy(false);
    // The next fight opened asks afresh, from its own default.
    setWho(null);
    setPicked(null);
    setAllies(null);
    onClose();
  }

  const toggled = (current: string[], id: string, on: boolean) =>
    on ? [...current.filter((entry) => entry !== id), id] : current.filter((entry) => entry !== id);
  function toggle(id: string, on: boolean) {
    setPicked(toggled(picked, id, on));
  }
  function toggleAlly(id: string, on: boolean) {
    setAllies(toggled(allies, id, on));
  }

  // Heroes fight in the party; companions (filed as allies the GM plays)
  // fight beside it, the workshop's own first.
  const hero = (character: Character) => character.role !== "companion";
  const pregenIds = new Set((pregens ?? []).map((character) => character.id));
  const heroPregens = (pregens ?? []).filter(hero);
  const others = (library ?? []).filter((character) => !pregenIds.has(character.id) && hero(character));
  const allyChoices = [...(pregens ?? []), ...(library ?? []).filter((character) => !pregenIds.has(character.id))].filter(
    (character) => !hero(character),
  );

  async function start() {
    if (!encounter) return;
    setBusy(true);
    setError("");
    const beside = allyOffer ? allies.filter((id) => allyChoices.some((character) => character.id === id)) : [];
    const allyPart = beside.length ? { allyIds: beside } : {};
    const sent = await readWrite<{ campaignId: string }>(
      fetch(`/api/workshops/${workshopId}/test-fight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: encounter.id,
          party: who === "stand-ins" ? { kind: "stand-ins", ...allyPart } : { kind: "characters", characterIds: picked, ...allyPart },
          runner: info?.ready ? runner : "person",
        }),
      }),
      "The test fight could not be set up.",
    );
    if (sent.error !== null) {
      setError(
        sent.unanswered
          ? `${sent.error} The table may have been made all the same: look under Encounters for the open test before starting another.`
          : sent.error,
      );
      setBusy(false);
      return;
    }
    navigateTo(`/campaigns/${sent.payload.campaignId}`);
  }

  const full = picked.length >= TARGET_PARTY_LIMITS.size.max;
  const alliesFull = allies.length >= TEST_ALLY_LIMIT;
  const standIns = info?.standIns;
  const canStart = Boolean(info) && !info?.refused && !busy && (who === "stand-ins" || picked.length > 0);

  // One character to tick, a card the whole of which is its label. An ally
  // wears the word, so the two lists never read as one.
  const pickCard = (character: Character, ally: boolean) => {
    const on = (ally ? allies : picked).includes(character.id);
    return (
      <li key={character.id}>
        <label
          className={cn(choiceCard, on ? "border-amber-500/50 bg-amber-500/10" : "border-stone-800 bg-stone-950/40")}
          {...(ally ? { "data-test-ally": character.id } : { "data-test-pick": character.id })}
        >
          <input
            type="checkbox"
            checked={on}
            disabled={!on && (ally ? alliesFull : full)}
            onChange={(event) => (ally ? toggleAlly : toggle)(character.id, event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-amber-500"
          />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-1.5 text-sm text-stone-100">
              {character.name}
              {ally ? (
                <span className="rounded-full border border-stone-600 px-1.5 text-[10px] uppercase tracking-[0.12em] text-amber-200">Ally</span>
              ) : null}
            </span>
            <span className="block text-xs text-stone-400">{describe(character)}</span>
          </span>
        </label>
      </li>
    );
  };
  const checkbox = (character: Character) => pickCard(character, false);

  // One answer of a question, as a card the whole of which is its label.
  const radio = (group: string, checked: boolean, onSelect: () => void, title: string, hint: string) => (
    <label className={cn(choiceCard, checked ? "border-amber-500/50 bg-amber-500/10" : "border-stone-800 bg-stone-950/40")}>
      <input type="radio" name={group} checked={checked} onChange={onSelect} className="mt-0.5 size-4 shrink-0 accent-amber-500" />
      <span className="min-w-0">
        <span className="block text-sm text-stone-100">{title}</span>
        <span className="block text-xs text-stone-400">{hint}</span>
      </span>
    </label>
  );
  const legend = "mb-1.5 font-display text-xs uppercase tracking-[0.14em] text-amber-200/90";

  return (
    <Sheet open={open} onOpenChange={close} title={encounter ? `Test ${encounter.name}` : "Test fight"} className="lg:w-[min(92vw,34rem)]">
      <div className="space-y-4" data-testid="test-fight-sheet">
        <p className="text-sm text-stone-300">
          Play this fight on a table only you can see, on its map and by its plan. You play the
          party, each hero on their own turn.
        </p>

        {encounter?.setup?.length ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-50" data-testid="test-fight-setup">
            <p className="font-display text-amber-200">It opens on its saved set-up.</p>
            <ul className="mt-1 space-y-0.5 text-stone-300">
              {encounter.setup.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {setupParty && !sameAsSetup(setupParty, who, picked, allies) ? (
              <p className="mt-1 text-amber-200/90">
                This is another party than the set-up was saved with: the foes and the order start as saved, the heroes fresh.
              </p>
            ) : null}
          </div>
        ) : null}

        <fieldset className="space-y-2">
          <legend className={legend}>Who fights it</legend>
          {radio(
            "test-fight-party",
            who === "stand-ins",
            () => setWho("stand-ins"),
            "The stand-in party",
            standIns
              ? `${standIns.size} ${standIns.size === 1 ? "hero" : "heroes"} at level ${standIns.level}, the party this workshop is built for: ${listed(standIns.classes)}. Built by the rules when the test starts.`
              : "The party this workshop is built for, built by the rules when the test starts.",
          )}
          {radio(
            "test-fight-party",
            who === "characters",
            () => setWho("characters"),
            "Characters you pick",
            "This workshop's pregens or anyone in your library, at their own levels. They fight as copies: nothing in the test reaches your library.",
          )}
        </fieldset>

        {who === "characters" ? (
          <div className="reveal space-y-3" aria-live="polite">
            {pregens === null || library === null ? (
              <p className="flex items-center gap-2 text-xs text-stone-400">
                <Loader2 className="size-3.5 animate-spin" /> Reading your characters...
              </p>
            ) : heroPregens.length + others.length === 0 ? (
              <p className="text-xs text-stone-400">
                You have no heroes to pick yet. Build one from the Party tool, or test with the stand-ins.
              </p>
            ) : (
              <>
                {heroPregens.length ? (
                  <section>
                    <h4 className="mb-1.5 text-xs text-stone-400">This workshop&apos;s pregens</h4>
                    <ul className="grid gap-1.5 sm:grid-cols-2">{heroPregens.map(checkbox)}</ul>
                  </section>
                ) : null}
                {others.length ? (
                  <section>
                    <h4 className="mb-1.5 text-xs text-stone-400">Your library</h4>
                    <ul className="grid gap-1.5 sm:grid-cols-2">{others.map(checkbox)}</ul>
                  </section>
                ) : null}
                <p className="text-xs text-stone-500">
                  {picked.length
                    ? `${picked.length} picked${full ? `, the most a test party holds` : ""}.`
                    : `Pick up to ${TARGET_PARTY_LIMITS.size.max}.`}
                </p>
              </>
            )}
            {loadError ? <PanelError>{loadError}</PanelError> : null}
          </div>
        ) : null}

        {/* Allies, beside either party: shown only to an author who keeps a
            companion, on a host that seats them (issue 685). */}
        {allyOffer && allyChoices.length ? (
          <fieldset className="reveal space-y-2" data-testid="test-fight-allies">
            <legend className={legend}>Allies beside them</legend>
            <p className="text-xs text-stone-400">
              Optional. Companions you keep fight beside the party as copies, at their own levels. Whoever runs
              the test plays them; to play one yourself, take command of them on their card in the Party panel.
            </p>
            <ul className="grid gap-1.5 sm:grid-cols-2">{allyChoices.map((character) => pickCard(character, true))}</ul>
            <p className="text-xs text-stone-500">
              {allies.length
                ? `${allies.length} beside the party${alliesFull ? ", the most a test seats" : ""}.`
                : `None unless you pick them, up to ${TEST_ALLY_LIMIT}.`}
            </p>
          </fieldset>
        ) : null}

        {/* Who runs it is a question only where an AI DM could; with none,
            the author does, and the note says so. */}
        {info?.refused ? (
          <p className="flex items-start gap-2 rounded-lg border border-stone-700/60 bg-stone-950/40 px-3 py-2 text-xs text-stone-300" data-testid="test-fight-refused">
            <GameIcon icon={{ kind: "glyph", key: "ui-ai" }} size="size-5" className="shrink-0" />
            {info.refused}
          </p>
        ) : info?.ready ? (
          <fieldset className="space-y-2">
            <legend className={legend}>Who runs it</legend>
            {radio(
              "test-fight-runner",
              runner === "ai",
              () => setRunner("ai"),
              "The AI GM",
              "It opens the fight and runs the enemies by their plan, as at a table the AI runs. You keep the GM console for set-ups and corrections.",
            )}
            {radio(
              "test-fight-runner",
              runner === "person",
              () => setRunner("person"),
              "You",
              "You run the enemies with their cards and the party with theirs, as a GM at a table you run. No AI is called.",
            )}
          </fieldset>
        ) : info ? (
          <p className="flex items-start gap-2 rounded-lg border border-stone-700/60 bg-stone-950/40 px-3 py-2 text-xs text-stone-300" data-testid="test-fight-not-ready">
            <GameIcon icon={{ kind: "glyph", key: "ui-ai" }} size="size-5" className="shrink-0" />
            {info.reason}
          </p>
        ) : null}
        {info?.open ? (
          <p className="text-xs text-stone-400">Starting this ends the test already open, {info.open.title}.</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={!canStart} aria-busy={busy} onClick={() => void start()} className={cn(ui.btnPrimary, "min-h-11")}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Swords className="size-4" />}
            {busy ? "Setting the table..." : "Start the test fight"}
          </button>
        </div>
        {error ? <PanelError>{error}</PanelError> : null}
      </div>
    </Sheet>
  );
}
