"use client";

import { PageSection } from "@/components/PageShell";
import { ui } from "@/lib/ui";
import {
  Field,
  SecretField,
  SelectField,
  type EnvDefaults,
  type MaskedConfig,
  inheritedHint,
} from "@/app/admin/AdminSettingsFields";
import { useT } from "@/lib/locale";
import type { MessageKey } from "@/lib/messages-logic";

// The two sections about how the server is reached from outside: live voice
// and Discord sign-in. A world an app hosts owns both itself, so the panel
// leaves this whole file out there.
export function AdminNetworkSections({
  config,
  env,
  setConfig,
  voiceUnroutable,
  discordSecret,
  setDiscordSecret,
}: {
  config: MaskedConfig;
  env: EnvDefaults;
  setConfig: (next: MaskedConfig) => void;
  voiceUnroutable: boolean;
  discordSecret: string;
  setDiscordSecret: (value: string) => void;
}) {
  const t = useT();
  return (
    <>
        <PageSection id="admin-voice" heading={t("Voice chat", { context: "admin.voice.heading" })} glyph="ui-voice">
          <p className="mb-3 text-xs text-stone-500">
            {t("Lets a table talk over live audio. Needs two things beyond this switch: the app reached over ")}
            <strong>https</strong>
            {t(" (browsers block microphone access on plain http, except on localhost), and ")}
            <strong>{t("one open port")}</strong>
            {t(" for both UDP and TCP. That port carries the audio itself, which is not HTTP and cannot go through a reverse proxy, so open it on your firewall pointing straight at this host.")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label={t("Voice chat", { context: "admin.voice.toggle" })}
              hint={
                config.voiceChat.enabled === ""
                  ? t("Following the server config: {state}", { state: env.voiceEnabled ? t("on", { context: "admin.voice.state.on" }) : t("off", { context: "admin.voice.state.off" }) })
                  : t("Overrides the server config.")
              }
              value={config.voiceChat.enabled}
              onChange={(enabled) => setConfig({ ...config, voiceChat: { ...config.voiceChat, enabled } })}
              options={[
                { value: "", label: t("Use server config ({state})", { state: env.voiceEnabled ? t("on", { context: "admin.voice.state.on" }) : t("off", { context: "admin.voice.state.off" }) }) },
                { value: "on", label: t("On", { context: "admin.voice.on" }) },
                { value: "off", label: t("Off", { context: "admin.voice.off" }) },
              ]}
            />
            <SelectField
              label={t("Transport")}
              hint={t("The voice server needs the media port below open. Peer-to-peer needs no port and works through tunnels, but suits small tables: every player sends audio to every other player.")}
              value={config.voiceChat.mode}
              onChange={(mode) => setConfig({ ...config, voiceChat: { ...config.voiceChat, mode } })}
              options={[
                { value: "", label: t("Voice server (default)") },
                { value: "mesh", label: t("Peer-to-peer (mesh)") },
              ]}
            />
            <Field
              label={t("Media port")}
              hint={t("Open for UDP and TCP. Env: {port}", { port: env.voiceRtcPort })}
            >
              <input
                className={ui.input}
                value={config.voiceChat.rtcPort}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    voiceChat: { ...config.voiceChat, rtcPort: event.target.value },
                  })
                }
                placeholder={env.voiceRtcPort}
              />
            </Field>
            <Field
              label={t("Announced address")}
              hint={t("The address a player's BROWSER can reach this host on, normally your public IP. Leave blank only for a localhost-only install.")}
            >
              <input
                className={ui.input}
                value={config.voiceChat.announcedIp}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    voiceChat: { ...config.voiceChat, announcedIp: event.target.value },
                  })
                }
                placeholder={env.voiceAnnouncedIp || "203.0.113.10"}
              />
            </Field>
            <Field
              label={t("Voice domain (optional)")}
              hint={t("Announce a hostname instead of the IP. It must resolve straight here: a Cloudflare-proxied name does not carry UDP, so calls would connect and stay silent.")}
            >
              <input
                className={ui.input}
                value={config.voiceChat.domain}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    voiceChat: { ...config.voiceChat, domain: event.target.value },
                  })
                }
                placeholder={env.voiceDomain || "voice.example.com"}
              />
            </Field>
          </div>
          {/* Hidden as soon as mesh is picked, even before saving: the warning
              is about what the voice server announces, and mesh announces
              nothing. */}
          {voiceUnroutable && config.voiceChat.mode !== "mesh" ? (
            <p role="status" className="live-in mt-3 text-xs text-amber-400">
              {t("Voice will connect but stay silent for remote players: set an announced address or domain.")}
            </p>
          ) : null}
          <p className="mt-3 text-[11px] text-stone-500">
            {t("Port and address changes apply the next time somebody joins a call, once nobody is connected. No server restart needed.")}
          </p>
        </PageSection>

        <PageSection id="admin-discord" heading={t("Discord sign-in")} glyph="system-share">
          <p className="mb-3 text-xs text-stone-500">
            {t("Optional. Create an application at discord.com/developers, add the redirect URI ")}
            <code className="text-stone-400">&lt;public URL&gt;/api/auth/discord/callback</code>
            {t(" (the exact address players use, e.g. https://your.domain or http://lan-host:3005), then paste the client ID and secret. The login button appears once both are set. Behind a reverse proxy, also set the Public URL in the Server section above.")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t("Client ID")}
              hint={inheritedHint(t, config.discord.clientId, env.discordClientId)}
            >
              <input
                className={ui.input}
                value={config.discord.clientId}
                onChange={(event) =>
                  setConfig({ ...config, discord: { ...config.discord, clientId: event.target.value } })
                }
                placeholder={env.discordClientId || t("Not set", { context: "admin.discord.notSet" })}
              />
            </Field>
            <SecretField
              label={t("Client secret")}
              isSet={config.discord.hasClientSecret}
              value={discordSecret}
              onChange={setDiscordSecret}
              hint={env.hasDiscordClientSecret ? t("An env-var secret is also set.") : undefined}
            />
          </div>
        </PageSection>
    </>
  );
}
