// The sheet's attune button appears for every item whose details say it
// requires attunement. A Ring of Spell Storing said so in its details and
// offered no button, since only items the magic item table held could offer
// one.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);
register("./lib/register-dialog-inline.mjs", import.meta.url);
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { SheetGearRow } = await import("../src/components/sheet/SheetGearRow.tsx");

const row = (name, item = {}) => {
  const entry = { name, qty: 1, ...item };
  return renderToStaticMarkup(
    createElement(SheetGearRow, {
      sheet: { name: "Pip", equipment: [entry] },
      item: entry,
      worn: true,
      inCombat: false,
      myTurn: true,
      dead: false,
      busy: false,
      onGear: () => {},
    }),
  );
};
const buttons = (markup) => [...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);

for (const name of ["Ring of Spell Storing", "Ring of Invisibility", "Boots of Speed"]) {
  assert.ok(buttons(row(name)).includes("attune"), `${name} offers attunement`);
}
assert.ok(buttons(row("Ring of Spell Storing", { attuned: true })).includes("attuned"), "an attuned ring can end it");
// One that asks for none offers none.
assert.ok(!buttons(row("Ring of Swimming")).includes("attune"), "a Ring of Swimming asks for none");
assert.ok(!buttons(row("Rope")).includes("attune"), "a rope offers no attunement");
// Attuned to, never put on: the row has the one button that means something.
assert.deepEqual(buttons(row("Crystal Ball")), ["attune"]);

console.log("test-sheet-attune-button: ok");
