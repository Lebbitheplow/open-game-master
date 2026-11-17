"use client";

import { Check, Download, Loader2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { CopyLine } from "@/components/CopyLine";
import { downloadBlob } from "@/lib/download";
import { ui } from "@/lib/ui";
import {
  RECEIVER_PORT,
  ReceiverConfigError,
  receiverCommands,
  receiverConfig,
  receiverFileName,
  type ReceiverConfig,
} from "@/lib/agents/receiver-config";
import { useT } from "@/lib/locale";

export type ReceiverInfo = {
  campaignId: string;
  character: { id: string; name: string } | null;
  webhooksEnabled: boolean;
  pollLinks?: boolean;
};

type AddressCheck =
  | { state: "idle" }
  | { state: "checking"; url: string }
  | { state: "done"; url: string; allowed: boolean; origin: string; admin: boolean }
  | { state: "failed"; url: string; error: string };

// Shown with a new connection that can play one campaign: a receiver file
// filled in for the player's character there (src/lib/agents/receiver-config),
// so a Codex player agent wakes on its turn after two commands
// (docs/player-webhooks.md). The token stays in the box above; the
// receiver's --setup asks for it once and keeps it in the OS's store.
export function PlayerReceiverSetup({ receiver, mcpUrl }: { receiver: ReceiverInfo; mcpUrl: string }) {
  const t = useT();
  const [address, setAddress] = useState("");
  const [port, setPort] = useState(String(RECEIVER_PORT));
  const [check, setCheck] = useState<AddressCheck>({ state: "idle" });
  const asked = useRef("");

  if (!receiver.character) {
    return (
      <p className="text-xs text-stone-400">
        {t("To wake this agent on its turn, play a character at that table first, then connect it again.")}
      </p>
    );
  }
  const character = receiver.character;

  let config: ReceiverConfig | null = null;
  let configError = "";
  if (address.trim()) {
    try {
      config = receiverConfig({
        mcpUrl,
        campaignId: receiver.campaignId,
        characterId: character.id,
        characterName: character.name,
        receiverUrl: address,
        port: Number(port),
      });
    } catch (error) {
      // The refusal carries its key, so it reads the player's language; a
      // server refusal arrives as data.error and stays as sent.
      configError = error instanceof ReceiverConfigError ? t(error.key) : error instanceof Error ? error.message : t("Check the address and port.");
    }
  }
  const fileName = receiverFileName(character.name, character.id);
  const commands = config ? receiverCommands(`PATH/${fileName}`, config) : null;

  // Each check answers for the address it asked about; one that comes back
  // after the address changed, or after a newer check, is dropped.
  async function checkAddress() {
    if (!config) return;
    const url = config.receiverUrl;
    asked.current = url;
    const settle = (next: AddressCheck) => {
      if (asked.current === url) setCheck(next);
    };
    setCheck({ state: "checking", url });
    try {
      const response = await fetch("/api/profile/agents/receiver-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        settle({ state: "failed", url, error: data.error ?? t("Could not check that address.") });
        return;
      }
      settle({ state: "done", url, allowed: Boolean(data.allowed), origin: String(data.origin ?? ""), admin: Boolean(data.admin) });
    } catch {
      settle({ state: "failed", url, error: t("Could not reach the server.", { context: "receiver.error.unreachable" }) });
    }
  }
  const shown: AddressCheck = check.state !== "idle" && check.url === config?.receiverUrl ? check : { state: "idle" };
  const httpsServer = mcpUrl.startsWith("https://");

  return (
    <div className="space-y-3 rounded-xl border border-stone-800 p-3">
      <div>
        <p className="text-sm text-stone-200">{t("Wake {name}'s agent on its turn (Codex)", { name: character.name })}</p>
        <p className="text-xs text-stone-500">
          {t("A small receiver on the agent's computer starts a Codex turn when the table needs {name}. It needs this repository, Node 22.18 or later, Codex, and an HTTPS address this server can reach, such as a Tailscale Funnel.", { name: character.name })}
        </p>
      </div>
      {httpsServer ? null : (
        <p className="flex items-start gap-2 text-xs text-amber-200">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {t("This page was opened at {url}, which is not HTTPS, and the receiver only talks to ODM over HTTPS. Open Settings through the server's HTTPS address, then connect again, so the receiver file names that address.", { url: mcpUrl.replace(/\/api\/mcp$/, "") })}
        </p>
      )}
      {receiver.webhooksEnabled ? null : (
        <p className="flex items-start gap-2 text-xs text-amber-200">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {t("This server has not allowed any receiver address yet. Its admin adds yours under Admin > Player agents")}{receiver.pollLinks ? t(", or use a poll link below") : ""}.
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-stone-400">{t("The receiver's HTTPS address")}</span>
          <input
            className={ui.input}
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              setCheck({ state: "idle" });
            }}
            onBlur={() => void checkAddress()}
            placeholder="https://my-pc.example.ts.net:8443"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-stone-400">{t("Local port")}</span>
          <input
            className={ui.input}
            inputMode="numeric"
            value={port}
            onChange={(event) => setPort(event.target.value.replace(/[^0-9]/g, ""))}
          />
        </label>
      </div>
      <p className="text-[11px] text-stone-500">
        {t("Seating more than one agent from the same computer? Give each its own local port (8787, 8788, 8789) and its own HTTPS port (Funnel takes 443, 8443 and 10000).")}
      </p>
      {configError ? (
        <p role="alert" className="text-xs text-red-400">
          {configError}
        </p>
      ) : null}
      {shown.state === "checking" ? (
        <p className="flex items-center gap-2 text-xs text-stone-400">
          <Loader2 className="size-3.5 animate-spin" /> {t("Checking whether this server may reach it…")}
        </p>
      ) : shown.state === "failed" ? (
        <p className="text-xs text-red-400">{shown.error}</p>
      ) : shown.state === "done" ? (
        shown.allowed ? (
          <p className="flex items-center gap-2 text-xs text-emerald-300">
            <Check className="size-3.5" /> {t("This server may send to {origin}.", { origin: shown.origin })}
          </p>
        ) : (
          <p className="flex items-start gap-2 text-xs text-amber-200">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {t("This server does not send to {origin} yet.", { origin: shown.origin })}{" "}
              {shown.admin ? (
                <Link className="underline" href="/admin?section=admin-player-agents">
                  {t("Allow it under Admin > Player agents")}
                </Link>
              ) : (
                t("Ask its admin to allow it under Admin > Player agents")
              )}
              {t(", then run the setup below.")}
            </span>
          </p>
        )
      ) : null}
      {config && commands ? (
        <ol className="list-decimal space-y-2 pl-5 text-xs text-stone-300">
          <li className="space-y-1">
            <button
              type="button"
              className={ui.btnSmall}
              onClick={() => downloadBlob(fileName, new Blob([`${JSON.stringify(config, null, 2)}\n`], { type: "application/json" }))}
            >
              <Download className="size-3.5" /> {t("Download {name}", { name: fileName })}
            </button>
            <span className="block text-stone-500">
              {t("Keep it in a private folder of your own, outside the repository. Below, replace PATH with that folder.")}
            </span>
          </li>
          <li className="space-y-1">
            <span>{t("In the ODM repository on that computer, run the setup once. It asks for the token above.")}</span>
            <CopyLine text={commands.setup} label={t("the setup command")} />
          </li>
          <li className="space-y-1">
            <span>{t("Start the receiver and keep it running.")}</span>
            <CopyLine text={commands.listen} label={t("the receiver command")} />
          </li>
          {commands.tunnel ? (
            <li className="space-y-1">
              <span>{t("Publish it at the address you gave, once.")}</span>
              <CopyLine text={commands.tunnel} label={t("the Tailscale Funnel command")} />
            </li>
          ) : (
            <li>{t("Point your HTTPS tunnel at http://127.0.0.1:{port}, so the address you gave reaches it.", { port: config.port })}</li>
          )}
        </ol>
      ) : null}
    </div>
  );
}
