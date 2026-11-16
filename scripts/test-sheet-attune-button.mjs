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

const row = (name, item = {}, when = {}) => {
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
      ...when,
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
// A workshop entry is what its own snapshot says, whatever published item it
// shares a name with: a GM's mundane "Prayer Mat" and a workshop ring whose
// magic asks no attunement offer no attunement.
assert.ok(buttons(row("Prayer Mat")).includes("attune"), "the pack's Prayer Mat asks for attunement");
assert.ok(!buttons(row("Prayer Mat", { slug: "homebrew:rug" })).includes("attune"), "a GM's own Prayer Mat asks for none");
assert.ok(
  !buttons(row("Ring of Spell Storing", { slug: "homebrew:ring", gear: { magic: { requiresAttunement: false, effects: [] } } })).includes("attune"),
  "a workshop ring that asks for none offers none",
);

// In a fight a cloak goes on or comes off on the wearer's own turn, as the
// usage route holds it: off turn the wear button is shut and says why, where
// it stayed open and the route's refusal was the first word of it.
const wearButton = (markup) => /<button[^>]*>\s*<span[^>]*>(?:worn|wear)<\/span>\s*<\/button>/.exec(markup)?.[0] ?? "";
const offTurn = wearButton(row("Cloak of Protection", {}, { inCombat: true, myTurn: false }));
assert.ok(offTurn.includes(' disabled=""'), `a cloak's wear button is shut off turn in a fight (${offTurn})`);
assert.ok(offTurn.includes("own turn; it is not your turn."), "and says it waits for their turn");
const onTurn = wearButton(row("Cloak of Protection", {}, { inCombat: true, myTurn: true }));
assert.ok(onTurn && !onTurn.includes(' disabled=""'), "on their own turn it is open");
assert.ok(onTurn.includes("free object interaction"), "and says what it costs");
const atPeace = wearButton(row("Cloak of Protection"));
assert.ok(atPeace && !atPeace.includes(' disabled=""'), "outside a fight it is open");

console.log("test-sheet-attune-button: ok");
