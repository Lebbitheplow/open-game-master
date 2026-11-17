"use client";

import Link from "next/link";
import {
  BookOpen,
  Brain,
  Bug,
  Compass,
  Footprints,
  Crown,
  Dices,
  DoorOpen,
  Gavel,
  MessageSquareText,
  Mic,
  Music,
  PanelRight,
  Puzzle,
  RefreshCw,
  Swords,
  Volume2,
} from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { GameIcon } from "@/components/ui/GameIcon";
import { HelpContents, ModeRow, Section } from "@/components/HelpParts";
import { ui } from "@/lib/ui";
import { useT } from "@/lib/locale";

// HowToPlayDialog and WorkshopHelpDialog import these from here.
export { ModeRow, Section };

// One walkthrough of the whole app: menus, side-panel tabs, composer modes,
// asking the DM, fixing a bad narration, what the DM remembers, dice, voice,
// lead powers and world packs. Opened from the home account menu and the
// in-session header.
export function HelpDialog({
  open,
  onOpenChange,
  tours,
  section,
  report,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // A section to open at, by its title, for a control that has one.
  section?: string;
  // The table offers its guided tours from here; each runs once on its own
  // and can be replayed at will. Other pages pass nothing.
  tours?: { label: string; detail: string; onStart: () => void }[];
  // The table's "Report a problem" (issue #459): Help is where someone
  // looks when something broke. The server's admin saves a report file
  // from here (onSave) or Admin > Server log; everyone else is told to ask
  // whoever runs the server, who can check its setup first. Other pages
  // pass nothing.
  report?: { onSave?: () => void };
}) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Help", { context: "menu.help" })}
      icon={<GameIcon icon={{ kind: "glyph", key: "tab-story" }} size="size-7" />}
      width="w-[min(94vw,44rem)]"
    >
      <HelpContents withTours={Boolean(tours?.length)} withReport={Boolean(report)} initialSection={section} />
      {tours && tours.length ? (
        <Section icon={Footprints} title={t("Guided tours")} id="Guided tours">
          <p>
            {t("A spotlight walk through the table's controls, one at a time. Each tour ran once when you first sat down; take it again whenever you like.")}
          </p>
          <div className="flex flex-wrap gap-2">
            {tours.map((tour) => (
              <button
                key={tour.label}
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  tour.onStart();
                }}
                className={ui.btnSmall}
                title={tour.detail}
              >
                <Footprints className="size-4" /> {tour.label}
              </button>
            ))}
          </div>
        </Section>
      ) : null}
      <Section icon={Compass} title={t("Getting started", { context: "help.started.heading" })} id="Getting started">
        <p>
          <span className="text-stone-300">{t("Quick start")}</span>
          {t(" is a prepared one-evening adventure with ready-made heroes. ")}
          <span className="text-stone-300">{t("New campaign")}</span>
          {t(" builds a table your way, and ")}
          <span className="text-stone-300">{t("Solo adventure", { context: "help.started.solo" })}</span>
          {t(" builds one for you alone. To play at a friend's table, use ")}
          <span className="text-stone-300">{t("Join with a code")}</span>
          {t(" or their ")}
          <span className="text-stone-300">{t("/join")}</span>
          {t(" link.")}
        </p>
        <p>{t("Every table needs a hero, and there are three ways to one: take a ready-made hero and play in a minute, bring a character from your library (adapted to the table's level), or build your own in the creation wizard. When everyone in the lobby is ready, the owner starts the adventure.")}</p>
        <p>
          {t("If the server has campaign plugins installed, the create form also offers a ")}
          <span className="text-stone-300">{t("pre-built world")}</span>
          {t(" to run the campaign in. See Campaign plugins below for what that changes.")}
        </p>
      </Section>

      <Section icon={DoorOpen} title={t("The lobby")} id="The lobby">
        <p>{t("Before the game begins, each player picks a hero and readies up; the line above the buttons always says what comes next. Whoever steers the story (the party lead, or the GM when a person runs the table) can change the table settings, in the same named groups the campaign creator used: world and story, character creation, narration, atmosphere, safety, and the rest. Each group says what is set inside before you open it, and every change applies to everyone at once. Share the room code or copy the invite link to bring in more players; the owner or the GM opens the table once everyone is ready.")}</p>
      </Section>

      <Section icon={MessageSquareText} title={t("Talking to the GM")} id="Talking to the GM">
        <p>{t("The buttons above the message box change what your message means:")}</p>
        <ModeRow label={t("Do", { context: "help.talking.do.label" })}>
          {t("Describe what your character does. The GM narrates the outcome and asks for dice rolls when the rules call for them.")}
        </ModeRow>
        <ModeRow label={t("Say")}>
          {t("Speak in character. Your text is sent as spoken dialogue, in quotes.")}
        </ModeRow>
        <ModeRow label={t("OOC")}>
          {t("Out-of-character table talk. The GM does not respond to it, and it stays available even when the floor is locked during narration or a spotlight.")}
        </ModeRow>
        <ModeRow label={t("Direct", { context: "help.talking.direct.label" })} lead>
          {t("Party lead only. Send the GM an authoritative story direction it must weave into the tale, or arm one of the seven canned events: Combat, Place, Social, Romance, Mystery, Weird or Windfall. Turn on ")}
          <span className="text-stone-300">{t("Private")}</span>
          {t(" and the direction goes to the GM alone: no character hears it, it never enters the transcript, and it steers the next turn instead of this one. The table still sees that something is armed, just never what.")}
        </ModeRow>
        <p>
          {t("Questions are not one of these buttons. Open the ")}
          <span className="text-stone-300">{t("Ask the GM")}</span>
          {t(" strip just above the message box and use its own question box. Set ")}
          <span className="text-stone-300">{t("About", { context: "help.talking.ask.span2" })}</span>
          {t(" to Auto, Story, Rules or My sheet to say where the answer should come from, and ")}
          <span className="text-stone-300">{t("Seen by")}</span>
          {t(" to Just me or The table to say who reads it. Answers quote what the campaign has on record under ")}
          <span className="text-stone-300">{t("From the record", { context: "help.talking.ask.span4" })}</span>
          {t(".", { context: "help.talking.ask.e" })}
        </p>
        <p>{t("Asking writes nothing to the transcript and never moves the story on, so it works during narration, during someone else's spotlight, and while the floor is locked. Collapsing the strip keeps a half-typed question and your place in the thread.")}</p>
        <p>{t("Sometimes the GM puts one player in the spotlight and waits for them to act. While the floor is locked for you, a banner explains why, and OOC and the Ask strip still work. Small chips above the message box name the background work the engine is doing between turns, such as compacting history, sealing a chapter, running the world tick or answering an Ask, with how long it has been going.")}</p>
      </Section>

      <Section icon={Swords} title={t("Your hand in a fight")} id="Your hand in a fight">
        <p>{t("While a fight is on, your options appear as a hand of cards above the message box: one for each weapon you carry, each spell you have prepared, your class features, and the basic actions (Dodge, Dash, Disengage, Help, Hide, Ready, Grapple, Shove, Use an object, End turn). Each card shows what it costs (action, bonus action, reaction, a spell slot, a use) and what it rolls, worked out from your sheet.")}</p>
        <p>
          {t("Pick a card, pick who it lands on from the chips or by tapping them on the battle map, check the line under ")}
          <span className="text-stone-300">{t("Sends")}</span>
          {t(", then press the gold button named after the card. ")}
          <span className="text-stone-300">{t("Edit")}</span>
          {t(" puts that line in the message box so you can change it first. A dimmed card is spent for the turn; hover or press it to see why. Rider cards such as Divine Smite attach to your next attack.")}
        </p>
        <p>{t("The hand never replaces typing. The message box, Do, Say and OOC, the microphone and Enter to send all work exactly as before, and the arrow on the hand's bar puts it away. The question mark beside it replays the two-line introduction.")}</p>
      </Section>

      <Section icon={RefreshCw} title={t("When the GM gets it wrong")} id="When the GM gets it wrong">
        <p>{t("Hover a GM message and a row of actions appears above it. None of them advance the story or change a single number the rules produced. Rewriting the narration belongs to the party lead, since everyone reads the same transcript:")}</p>
        <ul className="list-none space-y-1.5">
          <li>
            <span className="text-stone-300">{t("Reroll:")}</span>
            {t(" lead only. Have the GM write that moment again with the same dice and the same outcome, optionally with a note on what to do differently. Only the prose changes.")}
          </li>
          <li>
            <span className="text-stone-300">{t("Takes:")}</span>
            {t(" lead only. Once a second version exists, arrows and a counter appear in the message header. Paging between takes swaps the message for the whole table.")}
          </li>
          <li>
            <span className="text-stone-300">{t("Continue:")}</span>
            {t(" lead only. Have the GM keep writing from where a reply stopped short, without moving the story on.")}
          </li>
          <li>
            <span className="text-stone-300">{t("Edit:")}</span>
            {t(" lead only. Fix what the GM said by hand. Mechanics are untouched and every dice marker in the passage has to survive the edit.")}
          </li>
          <li>
            <span className="text-stone-300">{t("Lore check:")}</span>
            {t(" anyone. Flag the passage, or just the text you selected, against the campaign record and see whether it contradicts anything already established.")}
          </li>
        </ul>
        <p>{t("If a GM turn fails outright, a banner offers to send it back in from where it stopped. It resumes the turn that was already running, so nobody has to retype an action and nothing lands in the transcript twice.")}</p>
        <p>
          {t("An edit keeps the GM's own wording as a take beside yours, so you can page back to it. After you fix something the AI did (an undo, an edit, a reroll, a retry, a rewind), a small row asks ")}
          <span className="text-stone-300">{t("Why the fix?")}</span>
          {t(" with a few reasons. One tap helps the project see what the AI gets wrong; ignore it or close it and nothing changes.")}
        </p>
      </Section>

      {report ? (
        <Section icon={Bug} title={t("Report a problem")} id="Report a problem">
          {report.onSave ? (
            <>
              <p>{t("Something broke? Save a report file and attach it to a bug report on GitHub. You choose what goes in it; it is saved to this device and never sent anywhere, and it never holds other players' lines, whispers, passwords or keys.")}</p>
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  report.onSave?.();
                }}
                className={ui.btnSmall}
                data-report-problem
              >
                <Bug className="size-4" /> {t("Report a problem")}
              </button>
            </>
          ) : (
            <p data-report-ask-host>
              {t("Something not working? Tell whoever runs this server. Most problems come from how a server is set up, and they can check that. If it turns out to be a bug, they can save a report file for it.")}
            </p>
          )}
        </Section>
      ) : null}

      <Section icon={Brain} title={t("What the GM remembers")} id="What the GM remembers">
        <p>{t("Recent turns are in front of the GM word for word. Older ones are compacted into a rolling summary, and closed chapters become chapter summaries it can search and re-read when the table brings up something from long ago.")}</p>
        <ul className="list-none space-y-1.5">
          <li>
            <span className="text-stone-300">{t("Pin to memory:")}</span>
            {t(" any player can select text in a GM message and press the pin icon, or press it with nothing selected to keep the whole message. Pinned memories ride in every prompt from then on. There is a size budget, and the Pinned memories list under Story, Facts shows how much of it the table has spent.")}
          </li>
          <li>
            <span className="text-stone-300">{t("Add to Facts:")}</span>
            {t(" party lead only, because it writes to the campaign record. The book icon saves a passage to Facts as established fact, which the GM keeps to from then on.")}
          </li>
          <li>
            <span className="text-stone-300">{t("Facts and lore:")}</span>
            {t(" Story, Facts also holds GM secrets the GM must never contradict and the lore entries the table has written up.")}
          </li>
          <li>
            <span className="text-stone-300">{t("Bonds:")}</span>
            {t(" under Party, where each character stands with the people they have dealt with.")}
          </li>
        </ul>
        <p>{t("NPCs the party stops mentioning are archived so they do not crowd out the ones in play, and the party lead can see exactly what the GM was sent on the last turn, plus anything the budget cut, in the Context tab.")}</p>
      </Section>

      <Section icon={PanelRight} title={t("The side panel")} id="The side panel">
        <ul className="list-none space-y-1.5">
          <li>
            <span className="text-stone-300">{t("Party:")}</span>
            {t(" the roster, with character sheets, HP and conditions for the whole party, and the active encounter during combat. A Bonds sub-tab appears when relationships are on. The room code is in the lead's tab.")}
          </li>
          <li>
            <span className="text-stone-300">{t("Battle:")}</span>
            {t(" the tactical battle map, while a fight with a map is running. Move your token on your turn.")}
          </li>
          <li>
            <span className="text-stone-300">{t("Map:")}</span>
            {t(" the scene map, the overworld and discovered locations, when maps are enabled, and the party's Atlas: the world maps the GM has shown the party, with only the pins and regions they chose to show.")}
          </li>
          <li>
            <span className="text-stone-300">{t("Story:")}</span>
            {t(" three sub-tabs. Chapters is the tale so far and the arc in play, and it is where you export the story. Facts holds pinned memories, GM secrets and lore. Log is the audited record of every dice roll and every stat change the GM makes.")}
          </li>
          <li>
            <span className="text-stone-300">{t("Notes:")}</span>
            {t(" suggest campaign notes for the story; the party lead approves them.")}
          </li>
          <li>
            <span className="text-stone-300">{t("Chat:")}</span>
            {t(" private whispers between you and the GM, and side chat between players that the GM and the campaign transcript never see.")}
          </li>
          <li>
            <span className="text-stone-300">{t("World:")}</span>
            {t(" whoever runs the story only. The campaign's own copy of its WorldForge world: a change there stays at this table. ")}
            <span className="text-stone-300">{t("Reveal to the party")}</span>
            {t(" turns a secret into lore every player can read, and the GM can put it on every screen as a handout.")}
          </li>
          <li>
            <span className="text-stone-300">{t("Context:")}</span>
            {t(" party lead only. What the GM was actually sent last turn, and anything the token budget dropped.")}
          </li>
          <li>
            <span className="text-stone-300">{t("Settings:")}</span>
            {t(" the campaign's details, the table settings and the Story AI it plays with. Whoever steers the story can bring in more prep from a workshop here at any point, and the owner or the GM can end the campaign, which saves each library character's progress back to the player's library.")}
          </li>
        </ul>
        <p>
          {t("On a wide screen the table can be arranged your way. Drag the line between two panels to resize them. The ")}
          <span className="text-stone-300">{t("layout")}</span>
          {t(" button in the header opens ")}
          <span className="text-stone-300">{t("Arrange the table", { context: "help.panel.layout.span2" })}</span>
          {t(": give a tab such as Party, Story or Notes a pane of its own so several show at once, drag a panel by its bar to dock it beside another, float it over the table, maximize it (Escape puts it back) or set it aside and show it again later with whatever it held. ")}
          <span className="text-stone-300">{t("Lock layout")}</span>
          {t(" keeps it as it is and ")}
          <span className="text-stone-300">{t("Reset layout")}</span>
          {t(" brings back the table's own. Only this browser remembers it. On a phone the bottom bar keeps the table and the tabs you use most, and ")}
          <span className="text-stone-300">{t("More")}</span>
          {t(" lists every other tab.")}
        </p>
      </Section>

      <Section icon={Dices} title={t("Dice")} id="Dice">
        <p>
          {t("Every check, save, and attack is rolled by the server, never invented by the AI. The dice button in the header opens ")}
          <span className="text-stone-300">{t("Roll dice", { context: "help.dice.p1.span1" })}</span>
          {t(": tap dice into the tray (or type an expression such as 2d6+3), add a bonus, and roll. Turn on ")}
          <span className="text-stone-300">{t("Roll in secret")}</span>
          {t(" to roll behind the screen: a GM's secret roll is seen by the GM seats alone, and a player's by that player and the GM; the rest of the table is not told a die was rolled. The same menu toggles the 3D dice animation. If the table allows real dice and you opt in, the GM waits for you to enter your physical roll, with a digital fallback button if you would rather let the server roll.")}
        </p>
        <p>
          {t("Once you have opted in, the ")}
          <span className="text-stone-300">{t("Dice sources")}</span>
          {t(" button in the Party tab lets you decide per die which happens: type the physical roll yourself, let the server roll that die for you, or read it straight from a connected ")}
          <span className="text-stone-300">{t("Pixels Bluetooth die")}</span>
          {t(". Pairing a Pixel needs a Chromium-based browser and a secure (https) connection, because that is what Web Bluetooth requires. When every die in a request is covered by a Pixel or the server, the roll submits itself the moment the last die lands. These choices are saved in the browser you set them in, so set them again if you switch devices.")}
        </p>
      </Section>

      <Section icon={Volume2} title={t("Voice and narration")} id="Voice and narration">
        <p>
          {t("The story itself is written: the storyteller (the AI or the person in the GM's seat) writes each reply, and nothing about sound changes that. Four different things then use sound, and each has its own switch. ")}
          <span className="text-stone-300">{t("Narration", { context: "help.voice.p1.span1" })}</span>
          {t(" reads the GM's written replies aloud, and the table decides whether it is on. ")}
          <span className="text-stone-300">{t("Your volume")}</span>
          {t(" is yours alone: the speaker button in the header unmutes (browsers require one click before audio can play) and its slider sets how loud it plays on this device. ")}
          <span className="text-stone-300">{t("Live voice chat", { context: "help.voice.p1.span3" })}</span>
          {t(" is people talking to each other (below), and ")}
          <span className="text-stone-300">{t("dictation")}</span>
          {t(" turns your speech into typed words. Hover a GM message to replay its narration. Push-to-talk, when configured, lets you hold the microphone button to dictate your message.")}
        </p>
        <p>
          {t("A key can hold the microphone too: choose one under ")}
          <span className="text-stone-300">{t("Dictation key")}</span>
          {t(" in your account settings (the apps also have it under Audio and dice), and its name appears on the mic. Hold it in the message box, or anywhere at the table outside another field, and let go when you are done. The words wait in the box like the button's; only Send sends them.")}
        </p>
      </Section>

      <Section icon={Mic} title={t("Live voice chat", { context: "help.live.heading" })} id="Live voice chat">
        <p>
          {t("When the server and the campaign both have voice chat switched on, a ")}
          <span className="text-stone-300">{t("Voice", { context: "help.live.p1.span1" })}</span>
          {t(" card appears in the lobby, and during play a ")}
          <span className="text-stone-300">{t("headphones button")}</span>
          {t(" sits in the top bar with the full voice menu under it. Join and you are talking to the table; no other app needed, and the call stays up whatever panel you switch to. The microphone needs a secure (https) connection, and your browser will ask permission the first time.")}
        </p>
        <p>
          {t("Whoever runs the story can open ")}
          <span className="text-stone-300">{t("side rooms")}</span>
          {t(" for a split party or a private word, and can hold the floor: soft enforcement marks who should be talking, strict actually mutes everyone else, and a raised-hand queue keeps it civil. A table can also opt into rules that make the call behave like the world: proximity hearing (you only hear players whose characters are near yours on the map, while the GM hears everyone), whisper and shout ranges, walls muffling speech, and downed characters going deaf. All of that lives under Live voice chat in the Settings tab, and all of it is off by default, so a plain group call is what you get until the table asks for more.")}
        </p>
      </Section>

      <Section icon={Music} title={t("Ambience and music")} id="Ambience and music">
        <p>{t("With ambience on in the table settings (under Atmosphere), the table shares a soundtrack: a room for where the party is (a tavern, a forest, a crypt), music for what the scene is doing, and one-shot sounds for dramatic moments. The GM changes it as the story moves, and combat brings its own music. A cue may have several takes; the player moves between them so a long fight is not one loop forever, and Next skips ahead.")}</p>
        <p>{t("The speaker in the table header opens the sound panel: what is playing, a level for the room and one for the music (for you alone), and, if you steer the story, the pickers for the room, the music and the sounds, with a hold that keeps the scene from changing a layer you chose. Sound ducks automatically while narration speaks.")}</p>
        <p>{t("The library itself ships with the game: public-domain and Creative Commons recordings, and the licenses page says who made what. If ambience is on but silent, the panel says why.")}</p>
      </Section>

      <Section icon={Gavel} title={t("Playing with a human GM")} id="Playing with a human GM">
        <p>
          {t("A campaign does not have to be run by the AI. Created with ")}
          <span className="text-stone-300">{t("a person in the GM seat")}</span>
          {t(", the table works the way a kitchen-table game does: the GM narrates in their own words (most tables do it over voice chat), and the app keeps the sheets, the dice, the maps and the record straight underneath them. Your Do and Say messages still land in the transcript, but instead of waking the AI they queue as intents for the GM to answer. The GM holds no party slot (though they can build a companion to play from the console), holds the story secrets the party lead would hold at an AI table, and gets a console of tools: initiative, monsters, maps, NPCs, roll tables and rulings, with an AI assistant one click away for stat blocks and suggestions if they want it.")}
        </p>
        <p>
          {t("The in-between setting, ")}
          <span className="text-stone-300">{t("assisted mode")}</span>
          {t(", lets the GM keep the story and hand the bookkeeping to the AI a piece at a time: it can run the monsters' turns, read the GM's notes aloud as full prose, or ")}
          <span className="text-stone-300">{t("cover the table")}</span>
          {t(" for a counted stretch of answers while the GM steps away, following the outline they left behind.")}
        </p>
        <p>
          {t("Because the narration happens out loud, the app nudges the GM every so often to jot down a ")}
          <span className="text-stone-300">{t("story beat")}</span>
          {t(", a line or two about what just happened. Beats are what chapter summaries, recaps and the exported story are built from, so a table that never writes any ends up with a transcript of intents and no tale. Players can help by keeping their actions in the composer rather than only in the call.")}
        </p>
      </Section>

      <Section icon={Crown} title={t("Party lead")} id="Party lead">
        <p>{t("The campaign owner starts as party lead and can pass the role from a party member's menu. The lead steers the table: the Direct message mode with its event presets and private directions, approving suggested notes, releasing a stuck spotlight, retrying a halted turn, rerolling or editing a narration, letting new players join mid-game, and editing campaign settings and house rules.")}</p>
        <p>{t("The lead also owns the story spine, under Story, Chapters. A single beat can be reworded, skipped or promoted to the one in play without regenerating the whole arc, a chapter can be sealed early, and the whole campaign can be rewound to the start of a chapter. A rewind is destructive: it asks for confirmation and lists what it will undo first, then puts sheets, NPCs, locations, maps and quest state back the way they were.")}</p>
        <p>{t("Where the engine spots two NPC names that might be the same person but refuses to merge them on a guess, the lead is the one who settles it.")}</p>
        <p>{t("At a table with a human GM the split is different: the lead keeps the invites and the campaign details but is otherwise a player, because the story powers listed above exist to steer the AI and there is no AI to steer. Story secrets, settings, rules, floor control, narration fixes and the GM seats belong to the person in the GM seat instead.")}</p>
      </Section>

      <Section icon={Puzzle} title={t("Campaign plugins")} id="Campaign plugins">
        <p>
          {t("A campaign can run in a ")}
          <span className="text-stone-300">{t("world pack")}</span>
          {t(": a pre-built setting with its own races, classes, spells, gear, monsters, factions and lore, and a brief telling the GM how that world should sound. Picking one at creation also sets the campaign's genre and can fill in its theme and premise.")}
        </p>
        <p>{t("A pack renames things, it never changes a rule. Everything underneath is still 5e, your sheet still stores the canonical names, and a character built in a pack campaign can be brought into a plain one and simply reads under its ordinary names again.")}</p>
        <p>{t("Server admins install and remove packs under Admin, Campaign plugins, from a registry or from a file. A pack built on somebody else's setting carries an unofficial-work notice wherever it appears: it is fan-made and is not affiliated with, sponsored by or endorsed by the rights holder.")}</p>
      </Section>

      <Section icon={BookOpen} title={t("New to D&D?")} id="New to D&D?">
        <p>{t("You do not need to know the rules to play; the GM and the server handle them. When a term comes up that you do not recognize, look for the small info button next to it: every feature, spell and stat on your sheet explains itself.")}</p>
        <p>
          {t("The ")}
          <Link href="/reference" className="text-amber-300 underline-offset-2 hover:underline">
            {t("rules reference")}
          </Link>
          {t(" collects the basics in plain language and lets you search every spell, feat, item and condition the app knows about. The ")}
          <Link href="/rulebook" className="text-amber-300 underline-offset-2 hover:underline">
            {t("rulebook")}
          </Link>
          {t(" is the whole fifth edition reference document, searchable, for the moment a rule needs checking word for word. Its contents are bound as three books: the players' rules, the Game Master's, and the monsters, each holding everything the reference document opens from the Player's Handbook, the Dungeon Master's Guide and the Monster Manual (the rest of those books is not openly licensed). At the table it opens from the book button in the header.")}
        </p>
      </Section>

      <Section icon={BookOpen} title={t("About", { context: "help.about.heading" })} id="About">
        <p>
          {t("Open Game Master is a self-hosted, multiplayer Dungeons & Dragons 5e platform run by an AI Game Master. Server admins manage users, models, images, voice and campaign plugins from the Admin panel. Game content comes from the SRD 5.1 and Open5e; see ")}
          <Link href="/licenses" className="text-amber-300 underline-offset-2 hover:underline">
            {t("licenses and attribution")}
          </Link>
          {t(".", { context: "help.about.p1.b" })}
        </p>
      </Section>
    </Dialog>
  );
}
