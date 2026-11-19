"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ui } from "@/lib/ui";
import { CopyLine } from "@/components/CopyLine";
import { shellHost } from "@/lib/shell-host";
import type { Draft } from "@/app/setup/draft";
import { ModelPicker } from "@/app/setup/SetupParts";
import { blanks } from "@/app/admin/model-blanks";
import { useRecheckOnReturn } from "@/app/admin/recheck-on-return";
import { useT } from "@/lib/locale";
import type { MessageKey } from "@/lib/messages-logic";
import type { HarnessId, HarnessStatus } from "@/lib/harness/types";

type Update = (change: (draft: Draft) => Draft) => void;

const MARKS: Record<HarnessId, string> = { claude: "CC", codex: "Cx", opencode: "oc", grok: "Gk", pi: "π", antigravity: "Ag" };

// The status pill's word, keyed by the machine state the status carries.
const STATUS_KEYS: Record<string, MessageKey> = {
  notAvailable: "Not available here",
  notInstalled: "Not installed",
  signIn: "Sign in needed",
  installed: "Installed",
  ready: "Ready",
};

function statusKey(status: HarnessStatus): MessageKey {
  if (status.availability !== "ok") return STATUS_KEYS.notAvailable;
  if (!status.installed) return STATUS_KEYS.notInstalled;
  if (status.auth.state === "signed-out") return STATUS_KEYS.signIn;
  if (status.auth.state === "unknown") return STATUS_KEYS.installed;
  return STATUS_KEYS.ready;
}

function statusTone(status: HarnessStatus): "ready" | "warn" | "off" {
  if (status.availability !== "ok") return "off";
  if (!status.installed) return "off";
  if (status.auth.state === "signed-out" || status.auth.state === "unknown") return "warn";
  return "ready";
}

// "An agent you already pay for": each program this server can run, whether
// it is installed and signed in here, and the one command that fixes it when
// it is not. Nothing is saved until the step's Continue; the live test turn
// waits on the last step, once the choice is the server's.
export function AgentPanel({ draft, update }: { draft: Draft; update: Update }) {
  const t = useT();
  const BLANK = blanks(t);
  const [statuses, setStatuses] = useState<HarnessStatus[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const phone = shellHost()?.platform === "android";

  const load = useCallback(
    (refresh: boolean) =>
      fetch(`/api/admin/harness?${refresh ? "refresh=1&" : ""}${phone ? "platform=android" : ""}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data?.statuses) setStatuses(data.statuses as HarnessStatus[]);
        })
        .catch(() => undefined),
    [phone],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  // Nothing is saved yet, so coming back asks every program again, the one
  // being set up among them.
  useRecheckOnReturn(useCallback(() => void load(true), [load]));

  async function refresh() {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }

  const setAgent = (patch: Partial<Draft["agent"]>) => update((current) => ({ ...current, agent: { ...current.agent, ...patch } }));

  if (!statuses) {
    return (
      <div className="flex items-center gap-2 text-xs text-stone-400">
        <span className="su-scan" aria-hidden="true" /> {t("Looking for agent programs on this computer…")}
      </div>
    );
  }

  const chosen = statuses.find((status) => status.id === draft.agent.id) ?? null;
  const unavailable = statuses.every((status) => status.availability !== "ok");

  return (
    <div className="space-y-3">
      {unavailable && statuses[0]?.message ? <p className="su-note">{statuses[0].message}</p> : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-stone-400">{t("Choose the program")}</span>
        <button type="button" onClick={refresh} disabled={refreshing} aria-busy={refreshing} className={ui.btnSmall}>
          <RefreshCw className={refreshing ? "size-3.5 animate-spin" : "size-3.5"} /> {t("Check again")}
        </button>
      </div>
      <div role="radiogroup" aria-label={t("Agent program")} className="hx-cards stagger">
        {statuses.map((status) => {
          const pill = statusTone(status);
          const pillText = t(statusKey(status));
          const picked = draft.agent.id === status.id;
          return (
            <button
              key={status.id}
              type="button"
              role="radio"
              aria-checked={picked}
              data-unavailable={status.availability !== "ok" || !status.installed}
              className="hx-card"
              onClick={() => setAgent({ id: status.id, model: picked ? draft.agent.model : "", utilityModel: picked ? draft.agent.utilityModel : "" })}
            >
              <span className="flex items-center gap-2.5">
                <span className="hx-mark" aria-hidden="true">
                  {MARKS[status.id]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-stone-100">{status.label}</span>
                  <span className="block truncate text-[11px] text-stone-500">
                    {status.version ? `v${status.version}` : status.installed ? t("installed") : t("not on this computer")}
                    {status.auth.plan ? ` · ${status.auth.plan}` : ""}
                  </span>
                </span>
              </span>
              <span key={pillText} className="hx-pill reveal-pop self-start" data-tone={pill}>
                {pillText}
              </span>
            </button>
          );
        })}
      </div>

      {chosen ? (
        <div key={chosen.id} className="reveal-height space-y-3">
          {chosen.availability === "ok" && !chosen.installed ? (
            <div className="su-row flex-col items-stretch">
              <span className="text-sm text-stone-200">{t("1. Install {name} on this computer", { name: chosen.label })}</span>
              <CopyLine text={chosen.installHint ?? ""} label={t("install command")} />
              <span className="text-sm text-stone-200">{t("2. Sign it in")}</span>
              <CopyLine text={chosen.signInHint ?? ""} label={t("sign-in command")} />
              <span className="text-xs text-stone-500">{t("Run both in a terminal on the server's computer, then press Check again.")}</span>
            </div>
          ) : chosen.installed && chosen.auth.state === "signed-out" ? (
            <div className="su-row flex-col items-stretch">
              <span className="text-sm text-stone-200">{t("Sign {name} in on this computer", { name: chosen.label })}</span>
              <CopyLine text={chosen.signInHint ?? ""} label={t("sign-in command")} />
              <span className="text-xs text-stone-500">{t("It opens a browser to sign in with your own plan. Then press Check again.")}</span>
            </div>
          ) : chosen.message ? (
            <p className="su-note">{chosen.message}</p>
          ) : null}
          {chosen.installed ? (
            <p className="text-xs text-stone-500">
              {t("{path}{account}. It runs with none of its own tools: it can only touch the table's rules engine, and this server never sees its password or key.", {
                path: chosen.path ?? "",
                account: chosen.auth.account ? t(" · signed in as {account}", { account: chosen.auth.account }) : "",
              })}
            </p>
          ) : null}
          {chosen.models.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <ModelPicker
                label={t("Story model")}
                models={[{ id: "", label: BLANK.programDefault }, ...chosen.models.map((model) => ({ id: model.id, label: model.label }))]}
                value={draft.agent.model}
                recommended=""
                onChange={(model) => setAgent({ model })}
              />
              <ModelPicker
                label={t("Bookkeeping model (summaries, Ask)")}
                models={[
                  { id: "", label: BLANK.utility },
                  ...[...chosen.models]
                    .sort((a, b) => Number(Boolean(b.cheap)) - Number(Boolean(a.cheap)))
                    .map((model) => ({ id: model.id, label: model.cheap ? `${model.label}${t(" (light)")}` : model.label })),
                ]}
                value={draft.agent.utilityModel}
                recommended=""
                onChange={(utilityModel) => setAgent({ utilityModel })}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
