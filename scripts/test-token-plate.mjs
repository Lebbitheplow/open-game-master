// The board's hover plate shows the figure's painting large, keeps the face
// chain (an uploaded portrait first), and sits clear of the board's edges.
// Each condition shows its painting large with what it does.
import assert from "node:assert/strict";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
register("./lib/register-jsx.mjs", import.meta.url);
const { TokenPlate } = await import("../src/app/campaigns/[campaignId]/BoardChrome.tsx");

const token = { id: "t1", refId: "e1", kind: "enemy", name: "Ogre Brute", x: 9, y: 1 };
const plate = (more) => renderToStaticMarkup(createElement(TokenPlate, {
  token, boardWidth: 10, boardHeight: 10, footprint: 1,
  face: ["/uploads/portrait.png", "/assets/placeholders/monster.webp"],
  health: "bloodied", conditions: [{ id: "prone", label: "Prone" }], ...more,
}));

const markup = plate();
assert.match(markup, /role="tooltip"/);
assert.match(markup, /pointer-events-none/);
assert.match(markup, /src="\/uploads\/portrait.png"/, "the uploaded portrait wins");
assert.match(markup, /sm:size-\[160px\] size-\[124px\]/, "the painting is shown large");
for (const text of ["Ogre Brute", "Prone"]) assert.ok(markup.includes(text), text);
assert.match(markup, /w-\[312px\] sm:w-\[380px\]/, "a plate with conditions is wider, not taller");
assert.match(plate({ conditions: [] }), /w-\[136px\] sm:w-\[172px\]/, "a plate with no conditions keeps its size");
// The pin rides in the board over the figure: column 9 of 10, row 1, one
// tile tall; the plate is pinned to the page by where the pin lands.
assert.match(markup, /left:95%;top:10%;height:10%/, "the pin covers the figure");
assert.match(markup, /invisible fixed/, "measured before it is shown");

// The condition list: the painting at 40px (48px from sm up), its SRD
// meaning, and a non-SRD condition's own note, which leads with its summary.
const listed = plate({
  conditions: [
    { id: "prone", label: "Prone" },
    { id: "halted", label: "halted", rounds: 1, note: "Command (Halt): it does not move and takes no action on its turn" },
    { id: "unconscious", label: "Dying 1/2", note: "death saves: 1 success, 2 failures" },
  ],
});
assert.match(listed, /<ul/);
assert.equal((listed.match(/<li/g) ?? []).length, 3, "one row per condition");
assert.match(listed, /size-10 sm:size-12/, "the condition painting is shown large");
assert.match(listed, /src="\/assets\/icons\/condition\/prone.webp"/);
assert.ok(listed.includes("Can only crawl, or spend half its speed to stand."), "prone says what it does");
assert.ok(listed.includes("Command (Halt): it does not move"), "a non-SRD condition keeps its note");
assert.ok(listed.includes(" (1 rd)"), "a round count shows");
assert.ok(listed.includes("Incapacitated, can&#x27;t move or speak"), "a dying figure reads as unconscious");
assert.match(listed, /w-\[340px\][^"]*flex-col sm:w-\[680px\] sm:flex-row/, "three or more stack under a header on a phone, and go wide from sm up");
assert.match(listed, /size-\[72px\]/, "the portrait shrinks to a header on a phone when crowded");
assert.match(listed, /grid w-full grid-cols-1 sm:grid-cols-2/, "two across from sm up");
assert.match(listed, /<span class="capitalize">halted<\/span><span[^>]*> \(1 rd\)/, "only the name is capitalized, not the round count");
const two = plate({ conditions: [{ id: "prone", label: "Prone" }, { id: "poisoned", label: "Poisoned" }] });
assert.doesNotMatch(two, /size-\[72px\]|grid-cols-2/, "one or two conditions keep the portrait full size, in one column");

// A high-level pile, buffs on debuffs: a page at a time. The server render
// has no window, so it pages as a phone does, four to a page.
const pile = ["prone", "restrained", "poisoned", "frightened", "hasted", "blessed", "invisible", "shielded"]
  .map((id) => ({ id, label: id }));
const hovered = plate({ conditions: pile });
assert.equal((hovered.match(/<li/g) ?? []).length, 4, "hovered: the first page");
assert.match(hovered, /role="tooltip"/);
assert.match(hovered, /pointer-events-none/, "hovered: it never takes the pointer");
assert.match(hovered, /data-plate-more[^>]*>.*\+4 more: <\/span><span class="capitalize">hasted, blessed, invisible, shielded/, "hovered: the rest are named");
assert.doesNotMatch(hovered, /Next conditions|aria-label="Close"/, "hovered: no buttons");
const held = plate({ conditions: pile, pinned: true });
assert.match(held, /role="dialog"/);
assert.match(held, /aria-label="Ogre Brute: details"/);
assert.match(held, /tabindex="-1"/, "held: it can take the keyboard");
assert.match(held, /pointer-events-auto/, "held: it takes the pointer");
assert.match(held, /aria-label="Close"/);
assert.match(held, /aria-label="Previous conditions"[^>]*disabled=""|disabled=""[^>]*aria-label="Previous conditions"/, "held: no page before the first");
assert.match(held, /aria-label="Next conditions"/);
assert.match(held, /aria-live="polite"[^>]*>Page 1 of 2</, "held: which page, said as it turns");
assert.doesNotMatch(held, /data-plate-more/, "held: the pager, not a list of names");
assert.doesNotMatch(plate({ conditions: pile.slice(0, 4), pinned: true }), /Next conditions/, "one page needs no pager");

const { placePlate } = await import("../src/lib/battlemap/plate-place.ts");
const view = { width: 1280, height: 800 };
const size = { width: 380, height: 200 };
// A figure high on the screen: the plate below it, centred.
assert.deepEqual(placePlate({ left: 600, top: 100, right: 640, bottom: 140 }, size, view), { left: 430, top: 146, below: true });
// Low on the screen: above it.
assert.deepEqual(placePlate({ left: 600, top: 700, right: 640, bottom: 740 }, size, view), { left: 430, top: 494, below: false });
// Near the right edge: slid in, a margin from the window's edge.
assert.equal(placePlate({ left: 1250, top: 100, right: 1280, bottom: 140 }, size, view).left, 892);
// A short window with no room either side: still inside it.
const squeezed = placePlate({ left: 100, top: 90, right: 140, bottom: 130 }, size, { width: 375, height: 240 });
assert.ok(squeezed.top >= 8 && squeezed.top + size.height <= 232, "kept inside a short window");
assert.equal(squeezed.left, 8, "a window narrower than the plate keeps its left edge");

const { conditionRule } = await import("../src/lib/battlemap/condition-rules.ts");
for (const id of ["blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"]) {
  assert.ok(conditionRule(id), `${id} has a meaning`);
}
assert.equal(conditionRule(" Prone "), conditionRule("prone"));
assert.equal(conditionRule("halted"), null, "a non-SRD condition is left to its note");
console.log("ok: hover plate shows the portrait and condition art large, says what each condition does, and is pinned on screen above or below the figure");
