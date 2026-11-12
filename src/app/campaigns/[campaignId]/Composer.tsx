"use client";

import { Eye, EyeOff, Hand, Loader2, Send } from "lucide-react";
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import { Switch } from "@/components/ui/Switch";
import { MODE_GLYPHS } from "@/app/campaigns/[campaignId]/sessionGlyphs";
import { useLingeringEncounter } from "@/app/campaigns/[campaignId]/useLingeringEncounter";
import { Tooltip } from "@/components/ui/Tooltip";
import { FloorBanners } from "@/app/campaigns/[campaignId]/FloorBanners";
import { SideNotice } from "@/app/campaigns/[campaignId]/SideBadge";
import { TableWaitBanner } from "@/app/campaigns/[campaignId]/TableWaitBanner";
import { Hand as CombatHand } from "@/app/campaigns/[campaignId]/Hand";
import { MonsterHand } from "@/app/campaigns/[campaignId]/MonsterHand";
import { commandedCharacters, companionReactors, gmTurnCompanion, gmTurnDominated } from "@/lib/player-characters";
import { ReactAsPicker } from "@/app/campaigns/[campaignId]/ReactAsPicker";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";
import { NewAdventurerBanner } from "@/app/campaigns/[campaignId]/NewAdventurerBanner";
import {
  DirectorArmedBanner,
  DirectorPresets,
} from "@/app/campaigns/[campaignId]/DirectorPanel";
import { AfterRollCard } from "@/app/campaigns/[campaignId]/AfterRollCard";
import { WatchCard, WatchToggle } from "@/app/campaigns/[campaignId]/WatchCard";
import { foretoldLeft } from "@/lib/dm/foretold-logic";
import { balanceLeft, holdsBeforeRoll, omenLeft, TABLE_WATCH } from "@/lib/dm/before-roll-logic";
import { holdsFeature } from "@/lib/srd/feature-names";
import { PendingRollCard } from "@/app/campaigns/[campaignId]/PendingRollCard";
import { DmStatusLine } from "@/app/campaigns/[campaignId]/DmStatusLine";
import { PushToTalk } from "@/app/campaigns/[campaignId]/PushToTalk";
import { StoryNudge } from "@/app/campaigns/[campaignId]/StoryNudge";
import { SpeakerPicker } from "@/app/campaigns/[campaignId]/SpeakerPicker";
import type { CastMember } from "@/lib/dm/cast";
import type { Speaker } from "@/lib/dm/speech";
import type { BeatCadence } from "@/lib/dm/beat-cadence";
import type { TargetEdge } from "@/lib/battlemap/view-tactics";
import type { PlayerMapView } from "@/lib/battlemap/view-types";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";

import type { InputKind } from "@/lib/campaign-types";
import { LengthNote } from "@/components/ui/LengthNote";
import { composerLimit, textLength } from "@/lib/text-limits";
import { NameMenu, useNameMenu } from "@/app/campaigns/[campaignId]/NameMenu";
import { nameChoices } from "@/app/campaigns/[campaignId]/name-menu-logic";

export type { InputKind };

const KIND_TIPS: Record<InputKind, string> = {
  do: "Act in the world. The GM narrates what happens.",
  say: "Speak in character. Sent as dialogue in quotes.",
  ooc: "Table talk. The GM does not respond, and it works even when the floor is locked.",
  lead: "Party lead only. Send the GM an authoritative story direction.",
  narrate: "Game Master only. Write the passage the table reads.",
};

// The action composer at the bottom of the game chat: pending-roll cards,
// floor banners, the join notice, kind pills and the input row.
//
// Asking the DM a question is NOT a mode here. It lives entirely in the Ask
// strip just above this composer (AskPanel.tsx), which has its own box. An
// "Ask" pill in this row would be the same feature offered twice, inches
// apart, which is exactly what it used to be.
function ComposerInner({
  campaignId,
  sheets,
  meUserId,
  activeSheetId,
  steersStory,
  isDm,
  aiRunsFoes = false,
  aiTurns = false,

  kind,
  onKindChange,
  input,
  setInput,
  sending,
  error,
  inputBlocked,
  placeholder,
  dmStatus,
  dmJob,
  pendingRolls,
  members,
  floor,
  tableWait,
  spotlighted,
  heldSpotlightNames,
  encounter,
  onReleaseFloor,
  joinBanner,
  notice,
  leadPrivate,
  onLeadPrivateChange,
  speaker = null,
  onSpeakerChange,
  cast = [],
  places = [],
  onXCard,
  composerRef,
  trackAmmo,
  multiCharacter,
  romanceCue = true,
  edges,
  feet,
  unseen,
  drops,
  mounts,
  board,
  sight,
  genre,
  handSlot,
  highlight = false,
  directorArm,
  storyCadence,
  onCaptureStory,
  onSnoozeStory,
  onSubmit,
  speakingAs,
  reactionsSent,
  onReactionSent,
}: {
  campaignId: string;
  sheets: CampaignState["sheets"];
  meUserId: string;
  activeSheetId?: string;
  steersStory: boolean;

  // The DM seat: narrates instead of acting, and never runs a character.
  isDm: boolean;
  // A table the AI GM runs with a person in the steering seat, live or a
  // test (src/lib/workshop/test-seats-logic.ts aiRunsFoes): the enemies and
  // the allies nobody commands are the AI's, so the seat gets no monsters'
  // Hand and no ally's, and Direct asks the AI for a move as the lead's does.
  aiRunsFoes?: boolean;
  // The AI GM plays the turns (src/lib/dm/viewer.ts narratorIsAi): the only
  // turns a watch for Portent stops (src/lib/dm/foresight.ts).
  aiTurns?: boolean;
  kind: InputKind;
  onKindChange: (kind: InputKind) => void;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  sending: boolean;
  error: string;
  inputBlocked: boolean;
  placeholder: string;
  dmStatus: CampaignState["dmStatus"];
  dmJob: CampaignState["dmJob"];
  pendingRolls: CampaignState["pendingRolls"];
  // For the pending cards: who holds their own rolls (shake to roll).
  members: CampaignState["members"];
  floor: Parameters<typeof FloorBanners>[0]["floor"];
  tableWait?: CampaignState["tableWait"];
  spotlighted: CampaignState["sheets"];
  heldSpotlightNames: string[];
  encounter: CampaignState["encounter"];
  onReleaseFloor: () => Promise<void>;
  joinBanner: { text: string; onWriteIntro: () => void; onDismiss: () => void } | null;
  // One more banner in the stack, owned by the caller (narration that was
  // not read aloud). Memoized there, so this component's memo still holds.
  notice?: ReactNode;
  leadPrivate: boolean;
  onLeadPrivateChange: (leadPrivate: boolean) => void;
  // The DM seat's speaker (docs/vtt-parity-implementation-plan.md 8.1).
  speaker?: Speaker | null;
  onSpeakerChange?: (speaker: Speaker | null) => void;
  cast?: CastMember[];
  // The places on the map, for the @ menu's names (issue 650).
  places?: CampaignState["locations"];
  // The X-card (docs/vtt-parity-implementation-plan.md 9.1): always
  // there when the table uses it, one press, no confirmation.
  onXCard?: () => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  // The table's fielding rule, for the reactions of a player's other heroes.
  multiCharacter?: "off" | "one_active" | "all_active";
  // The ammunition variant rule, for the Hand's ranged cards.
  trackAmmo?: boolean;
  // The Director's Romance cue is offered (issue 501).
  romanceCue?: boolean;
  // The board's cover and flanking from this character to each enemy, for
  // the Hand's hit preview (src/lib/battlemap/view-tactics.ts).
  edges?: Record<string, TargetEdge>;
  // How far each creature on the board stands from this character, for the
  // reactions with a reach (PlayerMapView.feet).
  feet?: Record<string, number>;
  // Who on the board this character has no line of sight to (PlayerMapView.unseen).
  unseen?: string[];
  // What lies on the board and who rides what, for the Hand's gear cards.
  drops?: PlayerMapView["drops"];
  mounts?: PlayerMapView["mounts"];
  // The engine's verdicts on this character's own square (PlayerMapView.self).
  board?: PlayerMapView["self"];
  sight?: PlayerMapView["sight"];
  genre?: string | null;
  // Where the Hand is drawn instead of its row in the desk: the slot on the
  // staged board's lower edge (SessionView.tsx), so in a fight the cards lie
  // on the map and the desk is the message box alone.
  handSlot?: HTMLElement | null;
  // A gold pulse on the frame: the board says it is this player's turn.
  highlight?: boolean;
  directorArm: CampaignState["directorArm"];
  // How overdue the DM's story capture is. Always "quiet" for anyone but the
  // DM, so this renders nothing at a player's table.
  storyCadence: BeatCadence;
  onCaptureStory: () => void;
  onSnoozeStory: () => void;
  onSubmit: (event: FormEvent) => void;
  // Speaking as, for a reaction typed in the box (ReactAsPicker).
  speakingAs?: ComponentProps<typeof ReactAsPicker>;
  // The heroes a reaction was sent for that the GM has not resolved, and the
  // call that adds one (the Hand holds their reaction cards meanwhile).
  reactionsSent?: readonly string[];
  onReactionSent?: (characterId: string) => void;
}) {
  // The Hand outlives the fight by one beat so its fold-away can play.
  const hand = useLingeringEncounter(encounter);
  // A DM who plays characters too (a test fight a person runs, issue 553):
  // on one of theirs the party's Hand and its Do and Say, on every other turn
  // the monsters'. At any other table the DM holds no character, so this is
  // never true there.
  const current = hand.encounter?.orderReady ? hand.encounter.order[hand.encounter.turnIndex] : undefined;
  // An older host refuses a companion's cards from the GM seat as another
  // character's turn (capabilities.ts gmCompanionTurns): there its turn
  // keeps the monsters' hand and Skip turn.
  const capabilities = useCapabilities();
  // Not at a table the AI runs: an ally nobody commands is the AI's there.
  const gmCompanions = isDm && hostOffers(capabilities, "gmCompanionTurns") && !aiRunsFoes;
  // A hero the other side dominates is the GM's to play card by card too, on
  // a host whose actions route takes those cards from the GM seat.
  const gmDominated = gmCompanions && hostOffers(capabilities, "gmDominatedTurns");
  const heroUp =
    isDm &&
    !hand.encounter?.enemyTurns &&
    current?.kind === "pc" &&
    (sheets.some((sheet) => sheet.id === current.id && sheet.userId === meUserId && !sheet.isCompanion) ||
      // An ally the author took command of at a test fight follows them in
      // fights (companion-command.ts): its turn is theirs, as a hero's is.
      commandedCharacters(sheets, meUserId).some((sheet) => sheet.id === current.id) ||
      // A companion nobody commands is the GM's to play at a table a person
      // runs: its turn has its own Hand, as a hero's has.
      (gmCompanions && Boolean(gmTurnCompanion(sheets, current.id))) ||
      // So is a player's hero the other side dominates (issue 685 audit).
      (gmDominated && Boolean(gmTurnDominated(sheets, current.id, hand.encounter?.sides))));
  const partyHand = !isDm || heroUp;
  // On every other turn in the GM seat, the reactions the GM's own heroes
  // may take (a test fight a person runs): a hit hero answers under the
  // monsters' hand.
  const ownsHeroes = isDm && sheets.some((sheet) => sheet.userId === meUserId && !sheet.isCompanion);
  // The watch button, for the character who holds a Portent number, or
  // Cosmic Omen or Restore Balance on a host that stops for them
  // (beforeRollWatch), or a Chronal Shift on a host that stops for it
  // (chronalWatch), or Flash of Genius or Favored by the Gods on one that
  // stops for a save (saveWatch).
  const beforeWatch = hostOffers(capabilities, "beforeRollWatch");
  const watchingSheet = sheets.find(
    (sheet) =>
      sheet.userId === meUserId &&
      !sheet.isCompanion &&
      (foretoldLeft(sheet).length > 0 ||
        ((omenLeft(sheet) !== null || balanceLeft(sheet)) && beforeWatch) ||
        (holdsFeature(sheet, "chronal shift") && hostOffers(capabilities, "chronalWatch")) ||
        ((holdsFeature(sheet, "flash of genius") || holdsFeature(sheet, "favored by the gods")) && hostOffers(capabilities, "saveWatch"))),
  );
  // Out of a fight, only a before-the-roll feature is watched for: an ally's
  // check or save is held at the stop (foresight-before.ts).
  const tableWatchSheet = !encounter && beforeWatch ? sheets.find((sheet) => sheet.userId === meUserId && !sheet.isCompanion && holdsBeforeRoll(sheet)) : undefined;
  // And the companions nobody commands, whose reactions the seat plays at a
  // table a person runs as it plays their turns (issue 685).
  const answersForCompanions = gmCompanions && hostOffers(capabilities, "companionReactions") && companionReactors(sheets, meUserId, undefined, true).length > 0;
  // The box speaks for whoever's turn it is: the hero's coming up (or the
  // table opening on it) turns it to Do, and the turn passing on turns Do or
  // Say back to Narrate, so text typed after the turn moved is never sent in
  // the wrong voice.
  const heroWasUp = useRef(false);
  useEffect(() => {
    if (heroWasUp.current === heroUp) return;
    heroWasUp.current = heroUp;
    if (heroUp) onKindChange("do");
    else if (kind === "do" || kind === "say") onKindChange("narrate");
  }, [heroUp, kind, onKindChange]);
  // Each mode's limit, counted as its route counts it. The count shows once
  // a draft nears it, and a draft over it is held here, marked, rather than
  // refused after the send or cut short on the server (issue 207).
  const noteId = useId();
  const maxChars = composerLimit(kind, leadPrivate);
  const length = textLength(input);
  const tooLong = length > maxChars;
  // Typing @ offers the table's names (issue 650): the party, the people
  // the story has introduced, the places on the map. In Narrate and Direct
  // the box is the story's voice, and a seat holding the whole cast is
  // offered everyone, the not yet introduced marked (name-menu-logic.ts).
  const wellRef = useRef<HTMLDivElement>(null);
  // The Hand is drawn into one element of its own for as long as the table
  // is open, and that element is moved between the desk's row and the slot
  // on the staged board. Drawn straight into whichever was current, a change
  // of layout (the board staged or not, an addon's session, a short window)
  // would unmount the Hand and take its aim, its open group and its focus
  // with it (table-layout holds it to the same node).
  const handRowRef = useRef<HTMLDivElement>(null);
  // Made with the component, not in an effect: a portal draws nothing where
  // it stands, so the server's markup and the first client render agree.
  const [handHost] = useState<HTMLDivElement | null>(() => {
    if (typeof document === "undefined") return null;
    const host = document.createElement("div");
    host.className = "session-hand-host";
    return host;
  });
  useEffect(() => () => handHost?.remove(), [handHost]);
  useLayoutEffect(() => {
    const home = handSlot ?? handRowRef.current;
    if (handHost && home && handHost.parentElement !== home) home.appendChild(handHost);
  }, [handHost, handSlot]);
  const storyVoice = kind === "narrate" || kind === "lead";
  const choices = useMemo(() => nameChoices({ sheets, cast, places, storyVoice }), [sheets, cast, places, storyVoice]);
  const names = useNameMenu({ text: input, setText: setInput, field: composerRef, choices });
  return (
    <form onSubmit={onSubmit} className="glass session-desk cine-desk border-t border-stone-700/40 px-3 pb-3 pt-2.5">
      <div className="session-desk-body mx-auto max-w-3xl sm:px-3">
        <div className="session-compose-notices">
        {encounter && watchingSheet && aiTurns && hostOffers(capabilities, "portentWatch") ? (
          <WatchToggle campaignId={campaignId} sheet={watchingSheet} encounterId={encounter.id} />
        ) : !encounter && tableWatchSheet && aiTurns ? (
          // Out of a fight the same toggle, for a before-the-roll feature on an ally's check or save (issue #908).
          <WatchToggle campaignId={campaignId} sheet={tableWatchSheet} encounterId={TABLE_WATCH} />
        ) : null}
        {pendingRolls.map((pending) => pending.parkedFor === "watch" ? (
          <WatchCard
            key={pending.id}
            campaignId={campaignId}
            pending={pending}
            sheets={sheets}
            meUserId={meUserId}
            steersStory={steersStory}
          />
        ) : pending.thrown && hostOffers(capabilities, "afterRollChoice") ? (
          <AfterRollCard
            key={pending.id}
            campaignId={campaignId}
            pending={pending}
            sheets={sheets}
            meUserId={meUserId}
            steersStory={steersStory}
          />
        ) : (
          <PendingRollCard
            // Inspiration rewrites the parked roll's dice: the card starts
            // over with the new faces (and files in again).
            key={`${pending.id}:${pending.expression}`}
            campaignId={campaignId}
            pending={pending}
            sheets={sheets}
            members={members}
            meUserId={meUserId}
            steersStory={steersStory}
            beforeRoll={hostOffers(capabilities, "beforeRollWatch")}
            reactionsUsed={encounter?.reactionsUsed ?? []}
          />
        ))}
        <FloorBanners
          campaignId={campaignId}
          floor={floor}
          spotlighted={spotlighted}
          heldSpotlightNames={heldSpotlightNames}
          encounter={encounter}
          steersStory={steersStory}
          meUserId={meUserId}
          onRelease={onReleaseFloor}
        />
        <SideNotice encounter={encounter ?? null} sheets={sheets} meUserId={meUserId} />
        {floor.mode === "open" && dmStatus === "idle" ? (
          <TableWaitBanner
            campaignId={campaignId}
            wait={tableWait ?? null}
            meUserId={meUserId}
            steersStory={steersStory}
            onGoOn={onReleaseFloor}
          />
        ) : null}
        <DirectorArmedBanner campaignId={campaignId} steersStory={steersStory} armed={directorArm} />
        <StoryNudge
          cadence={storyCadence}
          onCapture={onCaptureStory}
          onSnooze={onSnoozeStory}
        />
        {notice}
        {joinBanner ? (
          <NewAdventurerBanner
            campaignId={campaignId}
            text={joinBanner.text}
            onWriteIntro={joinBanner.onWriteIntro}
            onDismiss={joinBanner.onDismiss}
          />
        ) : null}
        </div>
        <div className="session-compose-hand" ref={handRowRef}>
        {((hands: ReactNode) => (handHost ? createPortal(hands, handHost) : null))(<>
        {/* The Hand (docs/visual-overhaul-plan.md 5.2): a player's combat options
            as cards, only while a fight is on. It adds to everything below and
            takes nothing away: the pills, the box, the mic and the send button
            work exactly as they do without it. */}
        {/* The DM's hand (issue #108): the monsters' attacks and abilities
            as the same cards, played through the console's invoke route.
            None at a table the AI runs, live or a test: the enemies are its
            to play, and the route refuses their cards from the steering seat
            (issue 685). */}
        {!partyHand && !aiRunsFoes && hand.encounter ? (
          <MonsterHand
            campaignId={campaignId}
            sheets={sheets}
            encounter={hand.encounter}
            leaving={hand.leaving}
            genre={genre}
          />
        ) : null}
        {(partyHand || ownsHeroes || answersForCompanions) && hand.encounter ? (
          <CombatHand
            onComposeAs={speakingAs?.onChange}
            reactionsSent={reactionsSent}
            onReactionSent={onReactionSent}
            reactionsOnly={!partyHand}
            runsTable={gmCompanions}
            runsDominated={gmDominated}
            multiCharacter={multiCharacter}
            activeSheetId={activeSheetId}
            campaignId={campaignId}
            sheets={sheets}
            meUserId={meUserId}
            encounter={hand.encounter}
            leaving={hand.leaving}
            floor={floor}
            inputBlocked={inputBlocked}
            blockedReason={placeholder}
            input={input}
            setInput={setInput}
            onKindChange={onKindChange}
            composerRef={composerRef}
            trackAmmo={trackAmmo}
            edges={edges}
            feet={feet}
            unseen={unseen}
            drops={drops}
            mounts={mounts}
            board={board}
            sight={sight}
            genre={genre}
          />
        ) : null}
        </>)}
        </div>
        <div className="session-compose-entry">
        <div data-pill-group="" className="mb-2 flex flex-wrap items-center gap-1.5" data-tour="composer-modes">
          {/* The DM authors and talks out of character; they have no
              character to act or speak as, and the story directions exist to
              steer an AI narrator they have replaced. At a table the AI runs
              the steering seat steers that narrator, so Direct is theirs too:
              the way to ask for an enemy's move there. */}
          {(isDm
            ? [
                ...(heroUp ? (["do", "say"] as const) : []),
                "narrate" as const,
                ...(aiRunsFoes && steersStory ? (["lead"] as const) : []),
                "ooc" as const,
              ]
            : ([
                "do",
                "say",
                "ooc",
                ...(steersStory ? (["lead"] as const) : []),
              ] as const)
          ).map(
            (option) => (
              <Tooltip key={option} content={KIND_TIPS[option]}>
                <button data-on={kind === option ? "" : undefined}
                  data-mode={option}
                  type="button"
                  onClick={() => onKindChange(option)}
                  className="session-mode"
                >
                  <GameIcon icon={{ kind: "glyph", key: MODE_GLYPHS[option] }} size="size-6" />
                  {option === "do"
                    ? "Do"
                    : option === "say"
                      ? "Say"
                      : option === "ooc"
                        ? "OOC"
                        : option === "narrate"
                          ? "Narrate"
                          : "Direct"}
                </button>
              </Tooltip>
            ),
          )}
          <DmStatusLine campaignId={campaignId} dmStatus={dmStatus} dmJob={dmJob} canStop={steersStory} />
        </div>
        {/*
          Direct's own controls, and the reason there is no second row of
          director buttons above this composer: a canned event to arm, and the
          choice of whether the direction is something the table reads.
        */}
        {kind === "narrate" && isDm && onSpeakerChange ? (
          <SpeakerPicker
            speaker={speaker}
            onChange={onSpeakerChange}
            cast={cast}
            monsters={(encounter?.enemies ?? []).filter((enemy) => enemy.status === "alive").map((enemy) => ({ id: enemy.id, name: enemy.name }))}
          />
        ) : null}
        {kind === "do" && speakingAs?.reactors.length ? <ReactAsPicker {...speakingAs} /> : null}
        {kind === "lead" && steersStory ? (
          <div className="reveal mb-2 flex flex-wrap items-center gap-1.5">
            <DirectorPresets campaignId={campaignId} romance={romanceCue} />
            <Tooltip
              content={
                leadPrivate
                  ? "Only the GM sees this. It steers the next turn and never enters the transcript."
                  : "The table sees this direction, and the GM acts on it now."
              }
            >
              <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-stone-300">
                {leadPrivate ? <EyeOff className="size-3.5 text-amber-300" /> : <Eye className="size-3.5 text-stone-500" />}
                Private
                <Switch on={leadPrivate} onChange={onLeadPrivateChange} label="Private" />
              </span>
            </Tooltip>
          </div>
        ) : null}
        <div
          ref={wellRef}
          data-tour="composer-input"
          data-over={tooLong ? "" : undefined}
          className={
            "session-well texture-noise flex items-end gap-2 p-2" +
            (highlight ? " composer-pulse" : "")
          }
        >
          <NameMenu menu={names} anchor={wellRef} />
          <textarea
            ref={composerRef}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              names.read(event.target);
            }}
            // The caret moving (arrows, a tap) moves the menu with it.
            onSelect={(event) => names.read(event.currentTarget)}
            onBlur={names.close}
            {...names.fieldProps}
            onKeyDown={(event) => {
              // Enter picks a name while the menu is up, and sends otherwise.
              if (names.onKeyDown(event)) {
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSubmit(event);
              }
            }}
            rows={2}
            disabled={inputBlocked}
            placeholder={placeholder}
            aria-describedby={noteId}
            aria-invalid={tooLong || undefined}
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-stone-200 outline-none disabled:opacity-50"
          />
          {onXCard ? (
            <Tooltip content="X-card: pause the table without saying why. Nobody is told who pressed it.">
              <button
                type="button"
                onClick={onXCard}
                aria-label="Raise the X-card"
                className={cn(ui.btnSmall, "session-deskbtn text-stone-400")}
              >
                <Hand className="size-4" />
              </button>
            </Tooltip>
          ) : null}
          <PushToTalk
            disabled={inputBlocked}
            composerRef={composerRef}
            onTranscript={(text) =>
              setInput((current) => (current ? `${current} ${text}` : text))
            }
          />
          <button
            type="submit"
            disabled={sending || !input.trim() || inputBlocked || tooLong}
            aria-label="Send"
            className={cn(ui.btnPrimary, "session-deskbtn cine-send")}
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>
        <LengthNote id={noteId} length={length} max={maxChars} from={0.8} className="mt-1" />
        {error ? <p className="motion-shake mt-1.5 text-sm text-red-400">{error}</p> : null}
        </div>
      </div>
    </form>
  );
}

// Memoized for the same reason as SidePanel: unchanged props while the DM
// streams narration into the message list.
export const Composer = memo(ComposerInner);
