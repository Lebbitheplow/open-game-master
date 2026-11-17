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
import { playerFaces } from "@/lib/speaker-faces";
import {
  ADVENTURE_BEGINS_NOTE,
  JOIN_NOTE_PREFIX,
  LEAD_NOTE_PREFIX,
  RECAP_PREFIX,
  systemNoteWords,
  type CampaignMember,
} from "@/lib/campaign-types";
import { useT } from "@/lib/locale";
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

function translateSystemNote(t: (key: string, vars?: Record<string, string | number>) => string, raw: string): string {
  if (raw === "The fight is over.") return t("The fight is over.");
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
  let out = raw;
  out = out.replace(/It is now ([^']+)'s turn \(round (\d+)\)\./g, (_, ch, r) =>
    t("It is now {character}'s turn (round {n}).", { character: ch, n: r }),
  );
  out = out.replace(/It is now ([^']+)'s turn\./g, (_, ch) =>
    t("It is now {character}'s turn.", { character: ch }),
  );
  out = out.replace(/([A-Z][^.\n]+?) acts before ([^.]+)\./g, (_, enemy, ch) =>
    t("{enemy} acts before {character}.", { enemy, character: ch }),
  );
  out = out.replace(/Skipped enemy turns resolve automatically:/g, () =>
    t("Skipped enemy turns resolve automatically:"),
  );
  out = out.replace(
    /([^:;]+) attacks ([^:]+?) with ([^(:]+) \(([^)]+) vs AC (\d+): (HIT|CRIT|MISS)(?: for ([^)]+))?\)\./g,
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
  out = out.replace(/^Combat begins\. Initiative order: /, () => `${t("Combat begins. Initiative order:")} `);
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
          <p className="whitespace-pre-wrap text-pretty">{message.content}</p>
        </div>
        {message.cardReturned ? <CardReturnedNote message={message} mine={mine} name={sheet?.name ?? t("the player")} /> : null}
      </div>
    </ContextMenu>
  );
}
