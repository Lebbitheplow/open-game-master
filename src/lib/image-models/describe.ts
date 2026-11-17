import type { VerifiedRow } from "./curate.ts";

// How the admin panel and the setup wizard put a measurement into words.
// The sentences live in the dictionaries (admin.images.measure.*); like
// home/types.ts's agoLabel, the builders take the translator from the
// component that draws them. seconds() stays unit words only ("19 s",
// "1 min 12 s"), which both languages read the same way.

// The fields of a catalog model as one ComfyUI reported it (ComfyModelReport
// in src/lib/comfyui.ts) that the wording needs.
export type ReportLike = {
  verified: VerifiedRow | null;
  needGb: number | null;
  fits: boolean | null;
};

// The shape of a translator, as the pure sentence builders take it.
type T = (key: string, vars?: Record<string, string | number>) => string;

export function seconds(value: number): string {
  if (value < 90) return `${Math.round(value)} s`;
  const minutes = Math.floor(value / 60);
  const rest = Math.round(value - minutes * 60);
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

// One line for a picker hint: what this hardware made of the model.
export function measuredLine(t: T, report: ReportLike, hardware: string | null): string {
  const row = report.verified;
  if (row?.verdict === "fails") return hardware ? t("Did not run on {device}.", { device: hardware }) : t("Did not run on this hardware.");
  if (row?.verdict === "poor") return t("Runs on {device}, but its pictures were poor there.", { device: hardware ?? row.device });
  if (row) {
    const verdict = row.verdict === "recommended" ? t("Recommended. ") : "";
    return t("{verdict}{time} a picture, peaks {peak} GB on {device}.", {
      verdict,
      time: seconds(row.seconds.square),
      peak: String(row.peakGb),
      device: hardware ?? row.device,
    });
  }
  if (report.fits === false) return t("Peaked at {need} GB elsewhere, more than this GPU has.", { need: String(report.needGb) });
  return hardware ? t("Not measured on {device} yet.", { device: hardware }) : t("Not measured on this hardware yet.");
}

// "a, b and c" — and "a, b et c" in French.
export function listWords(t: T, words: readonly string[]): string {
  if (words.length < 2) return words[0] ?? "";
  return t("{list} and {last}", { list: words.slice(0, -1).join(", "), last: words[words.length - 1] });
}
