// The after-the-roll card (AfterRollCard.tsx) when one account holds both the
// roller and a helper who may answer the roll: a player running two
// characters, or a test fight's one seat. Play-test 2026-11-09 (W-08): the
// roller pressed "Keep this roll", the roll then waited on the helper, and
// that same screen offered only the helper's Chronal Shift, with no way to
// let the roll stand; it stayed pending until a hand-made request cleared
// it. The keep now answers for the helpers the roller's account plays (the
// after-roll route; scripts/test-enforce-chronal-shift-others.mjs), so the
// roll lands. A roll kept that way before the server learned it still waits,
// and its card carries the helper's "Let it stand". The clock shows when the
// server set one, and each button names it for a screen reader. The real
// roll, its landing and the clock on a table with someone else online run in
// a browser: scripts/browser/scenarios/126-after-roll-same-account.mjs.
import assert from "node:assert/strict";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./lib/register-jsx.mjs", import.meta.url);
const { AfterRollCard } = await import("../src/app/campaigns/[campaignId]/AfterRollCard.tsx");
const { WatchCard } = await import("../src/app/campaigns/[campaignId]/WatchCard.tsx");

const ME = "user-me";
const OTHER = "user-other";
const fighter = { id: "sheet-wren", userId: ME, name: "Wren Ashby" };
const wizard = { id: "sheet-ilse", userId: ME, name: "Ilse Marrow" };
const seer = { id: "sheet-odo", userId: ME, name: "Odo Pell" };
const strangerWizard = { id: "sheet-tamsin", userId: OTHER, name: "Tamsin Reed" };
const shift = (by, roller = "Wren Ashby") => ({
  id: "chronal_shift",
  by,
  label: `Chronal Shift: make ${roller} roll again`,
  note: `Spend a use of Chronal Shift and your reaction: ${roller} rolls this check again, and the new roll stands.`,
});

const pendingRoll = ({ userId = ME, characterId = fighter.id, kept = false, options = [shift(wizard.id)], deadline } = {}) => ({
  id: "pending-1",
  userId,
  characterId,
  kind: "ability_check",
  detail: "Strength check",
  expression: "1d20+3",
  advantage: "none",
  dc: 20,
  reason: "Lift the gate",
  createdAt: new Date().toISOString(),
  thrown: {
    outcome: { expression: "1d20+3", total: 9, natural: 6, terms: [{ kind: "dice", dice: [{ sides: 20, value: 6, kept: true }], subtotal: 6 }, { kind: "modifier", sign: 1, value: 3 }] },
    options,
    choosing: false,
    landing: { status: "fallback", physical: false, source: "digital" },
    ...(deadline ? { deadline } : {}),
    ...(kept ? { kept: true } : {}),
  },
});

const render = (pending, sheets = [fighter, wizard]) =>
  renderToStaticMarkup(createElement(AfterRollCard, { campaignId: "camp-1", pending, sheets, meUserId: ME, steersStory: false }));
const count = (html, text) => html.split(text).length - 1;

// Kept, and the helper is this account's own wizard: the helper's reroll and
// the helper's way out, both on this screen.
const kept = render(pendingRoll({ kept: true }));
assert.ok(kept.includes("You kept this roll."), kept);
assert.ok(kept.includes("Chronal Shift: make Wren Ashby roll again"), "the wizard may still make the fighter roll again");
assert.ok(kept.includes(">Let it stand</button>"), `the wizard can let the kept roll stand (W-08): ${kept}`);
assert.ok(kept.includes(`aria-label="Use Chronal Shift on Wren Ashby&#x27;s roll, or let it stand"`), "the group says what is asked now");
assert.ok(!kept.includes("Keep this roll"), "the roller has kept it already");

// Not yet kept: one step at a time. The roller's keep comes first, and the
// helper's answer follows on the kept card.
const fresh = render(pendingRoll());
assert.ok(fresh.includes("Keep this roll"), fresh);
assert.ok(!fresh.includes("Let it stand"), "no helper's way out before the roller has kept the roll");
assert.ok(fresh.includes(`aria-label="Change this roll, or keep it"`), fresh);

// The clock still runs on the kept card when the server set one (someone
// else is online at the table: after-roll-timer.ts).
const clocked = render(pendingRoll({ kept: true, deadline: new Date(Date.now() + 15_000).toISOString() }));
assert.match(clocked, /The roll stands in (1[0-9]|20)s/, clocked);
assert.ok(clocked.includes(">Let it stand</button>"), clocked);
// The clock is no live region, so each choice names it as its description:
// a keyboard or screen reader user hears the time left at every button.
const describedBy = (html) => {
  const clockId = /<span id="([^"]+)"[^>]*>The roll stands in/.exec(html)?.[1];
  const buttons = html.match(/<button[^>]*>/g) ?? [];
  return { clockId, buttons, described: buttons.filter((tag) => clockId && tag.includes(`aria-describedby="${clockId}"`)).length };
};
const told = describedBy(clocked);
assert.ok(told.clockId, `the clock has an id to point at: ${clocked}`);
assert.equal(told.described, told.buttons.length, `every button names the clock: ${clocked}`);
const freshClocked = describedBy(render(pendingRoll({ deadline: new Date(Date.now() + 15_000).toISOString() })));
assert.equal(freshClocked.described, freshClocked.buttons.length, "before the keep too: the shift and Keep this roll");
assert.ok(!kept.includes("aria-describedby"), "no clock, nothing to name");
// A table with nobody else online has no deadline and no clock, by design.
assert.ok(!/stands in \d+s/.test(kept), "no deadline, no clock");

// Two of this account's helpers: each lets it stand by name.
const two = render(pendingRoll({ kept: true, options: [shift(wizard.id), shift(seer.id)] }), [fighter, wizard, seer]);
assert.equal(count(two, ">Let it stand (Ilse Marrow)</button>"), 1, two);
assert.equal(count(two, ">Let it stand (Odo Pell)</button>"), 1, two);

// A helper on another account decides on their own screen: the roller is
// told who the roll waits on and is offered nothing for them.
const theirs = render(pendingRoll({ kept: true, options: [shift(strangerWizard.id)] }), [fighter, strangerWizard]);
assert.ok(!theirs.includes("Let it stand"), theirs);
assert.ok(!theirs.includes("Chronal Shift: make"), theirs);
assert.ok(theirs.includes("Tamsin Reed can still make you roll it again with Chronal Shift."), theirs);

// The helper's own screen for another account's roll is as it was.
const helper = render(pendingRoll({ userId: OTHER, characterId: "sheet-bran", options: [shift(wizard.id, "Bran Ostler")] }), [{ id: "sheet-bran", userId: OTHER, name: "Bran Ostler" }, wizard]);
assert.ok(helper.includes("Chronal Shift: make Bran Ostler roll again"), helper);
assert.ok(helper.includes(">Let it stand</button>"), helper);
assert.ok(helper.includes(`aria-label="Use Chronal Shift on Bran Ostler&#x27;s roll, or let it stand"`), helper);

// The watch stop's clock (WatchCard.tsx) the same way: its bare "14s" says
// what it counts to a screen reader, and every choice names it.
const watch = renderToStaticMarkup(createElement(WatchCard, {
  campaignId: "camp-1",
  sheets: [fighter, { ...wizard, resources: {}, foretold: [] }],
  meUserId: ME,
  steersStory: false,
  pending: { ...pendingRoll({ characterId: wizard.id }), thrown: null, reason: "Wren Ashby is about to make a saving throw.", watch: { power: "chronal_shift", deadline: new Date(Date.now() + 15_000).toISOString(), choices: [{ name: "Wren Ashby", when: "if it fails" }] } },
}));
const watchClock = /<span id="([^"]+)"[^>]*><span class="sr-only">It rolls on its own in <\/span>\d+s<\/span>/.exec(watch)?.[1];
assert.ok(watchClock, `the watch clock says what it counts: ${watch}`);
const watchButtons = watch.match(/<button[^>]*>/g) ?? [];
assert.equal(watchButtons.length, 2, watch);
assert.ok(watchButtons.every((tag) => tag.includes(`aria-describedby="${watchClock}"`)), `every watch choice names the clock: ${watch}`);

console.log("test-after-roll-card: a kept roll waiting on the same account's helper can be let stand, with its clock");
