import type { AddonManifest, SettingField, SetupDownload } from "@/lib/addons/manifest";
import type { AddonState } from "@/lib/addons/store";

// An admin's edit to an addon's settings, held to the fields its manifest
// declares: unknown keys are dropped, every value is checked against its
// field, and a secret follows the rule the server's own keys do (left out =
// keep, "" = clear, anything else = set). Pure.

type Values = AddonState["settings"];

export function cleanSettings(
  fields: SettingField[],
  current: Values,
  edits: Record<string, string | number | boolean>,
): { values: Values } | { error: string } {
  const values: Values = {};
  for (const field of fields) {
    if (current[field.key] !== undefined) values[field.key] = current[field.key];
  }
  for (const field of fields) {
    if (!(field.key in edits)) continue;
    const value = edits[field.key];
    switch (field.type) {
      case "secret":
      case "path":
      case "text":
      case "textarea": {
        if (typeof value !== "string") return { error: `${field.label} takes text.` };
        const limit = field.type === "text" || field.type === "textarea" ? field.maxLength : field.type === "path" ? 500 : 4_000;
        if (value.length > limit) return { error: `${field.label} may be ${limit} characters.` };
        if (field.type === "secret" && value === "") {
          delete values[field.key];
        } else {
          values[field.key] = field.type === "secret" ? value : value.trim();
        }
        break;
      }
      case "number": {
        const number = typeof value === "number" ? value : Number.parseFloat(String(value));
        if (!Number.isFinite(number)) return { error: `${field.label} takes a number.` };
        values[field.key] = Math.min(field.max, Math.max(field.min, number));
        break;
      }
      case "boolean":
        if (typeof value !== "boolean") return { error: `${field.label} is on or off.` };
        values[field.key] = value;
        break;
      case "select":
        if (typeof value !== "string" || !field.choices.some((choice) => choice.value === value)) {
          return { error: `${field.label} takes one of ${field.choices.map((choice) => choice.label).join(", ")}.` };
        }
        values[field.key] = value;
        break;
    }
  }
  return { values };
}

// The settings an addon starts with: what the admin set, else each field's
// default. Secrets have no default.
export function effectiveSettings(fields: SettingField[], saved: Values): Values {
  const values: Values = {};
  for (const field of fields) {
    const value = saved[field.key];
    if (value !== undefined) values[field.key] = value;
    else if (field.type !== "secret" && field.default !== undefined) values[field.key] = field.default;
  }
  return values;
}

// Required settings with no value yet: an empty text, path or secret, or a
// select with nothing chosen. Numbers and switches always have one.
export function missingRequiredSettings(fields: SettingField[], saved: Values): SettingField[] {
  const values = effectiveSettings(fields, saved);
  return fields.filter((field) => {
    if (!field.required) return false;
    const value = values[field.key];
    return value === undefined || (typeof value === "string" && !value.trim());
  });
}

// The settings whose change means setup has to run again: those marked
// affectsSetup, and those a download's `when` reads.
export function setupSettingKeys(manifest: Pick<AddonManifest, "settings" | "setup">): Set<string> {
  const keys = new Set(manifest.settings.filter((field) => field.affectsSetup).map((field) => field.key));
  for (const download of manifest.setup?.downloads ?? []) {
    if (download.when) keys.add(download.when.setting);
  }
  return keys;
}

// Whether a setup download is wanted on this computer with these settings
// and these chosen parts (a download for a part left out is not).
export function downloadApplies(download: SetupDownload, platformKey: string, settings: Values, parts: readonly string[] = []): boolean {
  if (download.platforms && !download.platforms.includes(platformKey)) return false;
  if (download.part && !parts.includes(download.part)) return false;
  if (!download.when) return true;
  const value = settings[download.when.setting];
  const wanted = Array.isArray(download.when.equals) ? download.when.equals : [download.when.equals];
  return wanted.some((entry) => entry === value);
}

// The parts an admin chose, or the author's defaults until they pick, held
// to the parts this version declares (a part a newer version dropped is
// gone; a new default part arrives with the update until the admin picks).
export function chosenParts(manifest: Pick<AddonManifest, "parts">, saved: readonly string[] | null | undefined): string[] {
  const declared = manifest.parts.map((part) => part.id);
  if (!saved) return manifest.parts.filter((part) => part.default).map((part) => part.id);
  return declared.filter((id) => saved.includes(id));
}

// What a part downloads on this computer (or, with no platform, on the
// platform it downloads most for), in bytes, ignoring `when`: the most it
// can take, for the panel to say before it is chosen.
export function partBytes(manifest: Pick<AddonManifest, "setup">, partId: string, platformKey?: string): number {
  const downloads = (manifest.setup?.downloads ?? []).filter((download) => download.part === partId);
  const total = (key: string | null) =>
    downloads.filter((download) => !download.platforms || (key !== null && download.platforms.includes(key))).reduce((sum, download) => sum + download.bytes, 0);
  if (platformKey) return total(platformKey);
  const keys = new Set(downloads.flatMap((download) => download.platforms ?? []));
  return Math.max(total(null), ...[...keys].map((key) => total(key)));
}

// Whether a part has anything to fetch on this computer.
export function partFitsHere(manifest: Pick<AddonManifest, "setup">, partId: string, platformKey: string): boolean {
  return (manifest.setup?.downloads ?? []).some((download) => download.part === partId && (!download.platforms || download.platforms.includes(platformKey)));
}
