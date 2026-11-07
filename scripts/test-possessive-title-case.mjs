// A name title-cased for the page keeps a possessive's "s" small: the
// sheet's training read "Alchemist'S Supplies" and "Thieves' Tools" came out
// right only by luck (a space after the apostrophe). The same helper, copied,
// named a feat's spell or language the catalog did not know ("Tasha'S").
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { TrainingLines } = await import("../src/components/sheet/SheetParts.tsx");
const { featSpellGrants } = await import("../src/lib/srd/feat-spells.ts");
const { featGrantSpec } = await import("../src/lib/srd/feat-grant-text.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("the sheet's training reads Alchemist's Supplies, not Alchemist'S Supplies", () => {
  const markup = renderToStaticMarkup(
    createElement(TrainingLines, { proficiencies: { languages: ["deep_speech"], tools: ["alchemist's supplies", "thieves' tools"], armor: ["light"], weapons: [] } }),
  );
  assert.match(markup, /Alchemist&#x27;s Supplies/);
  assert.match(markup, /Thieves&#x27; Tools/);
  assert.match(markup, /Deep Speech/);
  assert.doesNotMatch(markup, /&#x27;S/);
});

test("a feat's spell the catalog does not know is named Tasha's, not Tasha'S", () => {
  const { grants } = featSpellGrants({
    feats: [{ name: "Laughing Gift", desc: "You learn the tasha's mind whip spell." }],
    choices: {},
    raisedAbility: () => null,
    strict: false,
  });
  // A name the catalog cannot sort is filed with the cantrips (featSpellGrants).
  assert.deepEqual([...(grants[0]?.cantrips ?? []), ...(grants[0]?.spells ?? [])], ["Tasha's Mind Whip"]);
});

test("a feat's language the standard list does not hold keeps its possessive small", () => {
  const spec = featGrantSpec("You learn to speak, read, and write the dragon's tongue.");
  assert.ok(spec.fixedLanguages.includes("The Dragon's Tongue"), JSON.stringify(spec.fixedLanguages));
});

console.log(`${passed} possessive title-case tests passed`);
