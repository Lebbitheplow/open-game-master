"use client";

import { useT } from "@/lib/locale";
import { useCapabilities } from "@/lib/use-capabilities";
import type { ImageBackend } from "@/lib/types";

// Where a campaign's narration and pictures are actually made (issue 89).
// The campaign only switches them on and picks a voice or a backend; the
// address, the model and the key belong to the server and are set by an
// admin, so a table could not tell what its switch would do: was the text
// going to the cloud, to the story model's server, nowhere? These lines say
// it, from what the server reports about itself (/api/capabilities), and say
// so when the thing behind the switch is not there (issue 88).

const noteClass = "reveal text-[11px] leading-4 text-stone-500";
const warnClass = "reveal text-[11px] leading-4 text-amber-400/90";

export function NarrationNote() {
  const t = useT();
  const capabilities = useCapabilities();
  const tts = capabilities?.tts;
  // No answer yet, or a server older than these fields: say nothing rather
  // than guess.
  if (!tts || !tts.provider) {
    return null;
  }
  if (tts.provider === "off") {
    return (
      <p className={warnClass}>
        {t("Narration is switched off on this server, so nothing will be read aloud. An admin turns it on in Admin > Speech.")}
      </p>
    );
  }
  const server = tts.provider === "kokoro" ? t("the Kokoro speech server") : t("an OpenAI-compatible speech server");
  const where = tts.place === "local" || !tts.place ? t("on this server's own network") : t("at {place}", { place: tts.place });
  // The server answers but has no model to ask for (an older server sends
  // no such field and says nothing here).
  if (tts.needsModel) {
    return (
      <p className={warnClass}>
        {t("Narration is on, but {server} {where} has no model picked, so nothing is read aloud until an admin picks one in Admin > Speech.", { server, where })}
      </p>
    );
  }
  if (!tts.reachable) {
    return (
      <p className={warnClass}>
        {t("Narration is on, but {server} {where} is not answering, so passages will stay silent until it does. An admin can test it in Admin > Speech.", { server, where })}
      </p>
    );
  }
  return (
    <p className={noteClass}>
      {t("Each passage is sent as text to {server} {where} and comes back as audio.{local} The address, model and key are the server's, set in Admin > Speech.", {
        server,
        where,
        local: tts.place === "local" || !tts.place ? ` ${t("Nothing leaves it.")}` : "",
      })}
    </p>
  );
}

const PAINTERS: Record<ImageBackend, string> = {
  comfyui: "the ComfyUI install this server is set up with",
  "mflux-hs": "the FLUX worker (mflux) on this server",
  "sdnq-hs": "the FLUX worker (sdnq) on this server",
  openai: "an OpenAI-compatible images API",
  harness: "the server's agent program",
};

export function ImagesNote({ backend }: { backend: ImageBackend }) {
  const t = useT();
  const capabilities = useCapabilities();
  if (!capabilities) {
    return null;
  }
  const place = capabilities.images.openaiPlace;
  const where = backend !== "openai" || !place ? "" : place === "local" ? ` ${t("on this server's own network")}` : ` ${t("at {place}", { place })}`;
  return (
    <p className={noteClass}>
      {t("Pictures are painted by {painter}{where}. Its address, model and key are the server's, set in Admin > Image generation, so every campaign here shares them.", {
        painter: t(PAINTERS[backend]),
        where,
      })}
    </p>
  );
}
