// The Safety panel (src/components/SafetyToneFields.tsx), shared by the
// campaign creator and the campaign settings, points to the Romance switch
// under Bonds and romance, the way other settings name where a related one
// lives: no engine reads a line or veil for its words, so a table that wants
// no romance turns that switch off. Shown only where romance can happen at
// all (not at an all-ages table).
import assert from "node:assert/strict";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./lib/register-jsx.mjs", import.meta.url);
const { SafetyToneFields } = await import("../src/components/SafetyToneFields.tsx");

const render = (boundaries) =>
  renderToStaticMarkup(
    createElement(SafetyToneFields, {
      safety: { xCard: true, boundaries, lines: [], veils: [] },
      gm: { strictness: "standard", tone: [] },
      onSafety: () => {},
      onGm: () => {},
      tableLanguage: "italian",
      showPresets: false,
    }),
  );

const standard = render("standard");
assert.match(standard, /turn Romance off under Bonds and romance/, standard);
assert.doesNotMatch(standard, /Romance (on|off)<\/button>/, "one control for romance: the switch under Bonds and romance");
assert.doesNotMatch(render("family"), /Bonds and romance/, "an all-ages table never has romance");
assert.doesNotMatch(standard, /torture, romance/, "the veils hint no longer suggests the word that once switched romance off");

console.log("test-safety-romance-hint: the Safety panel points to the Romance switch where romance can happen");
