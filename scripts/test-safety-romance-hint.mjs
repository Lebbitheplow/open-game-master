// The Safety panel (src/components/SafetyToneFields.tsx), shared by the
// campaign creator and the campaign settings, points to the Romance switch
// under Bonds and romance, the way other settings name where a related one
// lives: a line or veil naming romance keeps the engine's own romance offers
// away, and a table that wants no romance at all turns that switch off. Shown
// only where romance can happen at all (not at an all-ages table).
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
assert.doesNotMatch(standard, /torture, romance/, "the veils hint suggests no romance word: the switch is the whole of it");

console.log("test-safety-romance-hint: the Safety panel points to the Romance switch where romance can happen");
