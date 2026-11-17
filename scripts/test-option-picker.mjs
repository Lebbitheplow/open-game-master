// The builder's option picker as a WAI-ARIA listbox (backlog B9): the roles
// and names a screen reader meets, checked in the markup the components
// render, and the keyboard rules, checked on the pure functions the picker
// moves its highlight with. The axe scenario (browser 32-builder-a11y) opens
// a live picker; these checks need no server.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);
register("./lib/register-dialog-inline.mjs", import.meta.url);
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const picker = await import("../src/app/characters/builder/OptionPicker.tsx");
const { default: OptionPicker, OptionList, moveActive, typeaheadMatch, DETAILS_KEY } = picker;

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const groups = [
  { label: null, options: [{ id: "", name: "None yet" }] },
  {
    label: "Core",
    recommended: true,
    options: [
      { id: "acolyte", name: "Acolyte", meta: "Insight, Religion", infoText: "Temple service." },
      { id: "criminal", name: "Criminal", reference: { kind: "backgrounds", slug: "criminal" } },
    ],
  },
  { label: "Tome of Heroes", options: [{ id: "court-servant", name: "Court Servant" }] },
];

// Keys move one option at a time and stop at the ends; Home and End jump.
{
  assert.equal(moveActive("ArrowDown", 0, 4), 1);
  assert.equal(moveActive("ArrowDown", 3, 4), 3, "the last option stays last");
  assert.equal(moveActive("ArrowUp", 2, 4), 1);
  assert.equal(moveActive("ArrowUp", 0, 4), 0, "the first option stays first");
  assert.equal(moveActive("Home", 3, 4), 0);
  assert.equal(moveActive("End", 0, 4), 3);
  assert.equal(moveActive("PageDown", 0, 4), 3);
  assert.equal(moveActive("PageUp", 3, 4), 0);
  assert.equal(moveActive("a", 0, 4), null, "a letter is typeahead, not navigation");
  assert.equal(moveActive("ArrowDown", 0, 0), null, "an empty list has nowhere to go");
  assert.ok(!/^[a-z0-9 ]$/i.test(DETAILS_KEY), "the details key is no letter, digit or space, so typeahead keeps them all");
  console.log("ok: arrows, Home, End and Page keys move the highlight");
}

// Typeahead finds the next name with the typed prefix, and a repeated letter
// cycles through the names that start with it.
{
  const names = ["None yet", "Acolyte", "Criminal", "Charlatan", "Court Servant"];
  assert.equal(typeaheadMatch(names, "c", 0), 2);
  assert.equal(typeaheadMatch(names, "c", 2), 3, "the same letter again moves on");
  assert.equal(typeaheadMatch(names, "cc", 3), 4, "a repeated letter cycles");
  assert.equal(typeaheadMatch(names, "c", 4), 2, "and wraps to the first match");
  assert.equal(typeaheadMatch(names, "co", 2), 4, "a longer prefix narrows");
  assert.equal(typeaheadMatch(names, "cr", 2), 2, "a longer prefix may keep the current row");
  assert.equal(typeaheadMatch(names, "A", 0), 1, "case does not matter");
  assert.equal(typeaheadMatch(names, "z", 0), null);
  console.log("ok: typeahead jumps by prefix and cycles on a repeated letter");
}

// The open list: a focusable listbox that names its highlighted option, with
// labelled groups and options that are single targets.
{
  const markup = renderToStaticMarkup(
    createElement(OptionList, { id: "pick", groups, value: "acolyte", active: 2, keyboard: true, labelledBy: "cap" }),
  );
  const listbox = markup.match(/<div[^>]*role="listbox"[^>]*>/)?.[0] ?? "";
  assert.ok(listbox, `a listbox: ${markup}`);
  assert.ok(listbox.includes('tabindex="0"'), "the listbox takes focus and is the list's one tab stop");
  assert.ok(listbox.includes('aria-labelledby="cap"'), "the listbox is named by the field caption");
  assert.ok(listbox.includes('aria-activedescendant="pick-2"'), "the highlight is the active descendant");
  assert.ok(listbox.includes('aria-describedby="pick-hint"'), "the listbox points at the details hint");
  assert.ok(markup.includes(`<p id="pick-hint"`) && markup.includes(`Press ${DETAILS_KEY} for details`), "the hint names the details key");

  const inside = markup.slice(markup.indexOf(listbox) + listbox.length, markup.lastIndexOf("</div>"));
  assert.ok(!/<button\b/.test(inside), "no button inside the listbox: each option is one target");
  assert.ok(!/tabindex=/.test(inside), "nothing inside the list is a tab stop of its own");

  const options = [...markup.matchAll(/<li[^>]*role="option"[^>]*>/g)].map((match) => match[0]);
  assert.equal(options.length, 4, "every option is an option");
  options.forEach((option, index) => assert.ok(option.includes(`id="pick-${index}"`), `option ${index} has the id the listbox points at`));
  assert.ok(options[1].includes('aria-selected="true"'), "the value is the selected option");
  assert.ok(options.filter((option) => option.includes('aria-selected="true"')).length === 1, "only one selected");
  assert.ok(options[2].includes("data-highlighted"), "the keyboard highlight is drawn");

  const group = markup.match(/<ul role="group" aria-labelledby="(pick-group-1)">/);
  assert.ok(group, "a labelled heading makes a group");
  assert.ok(markup.includes(`<li id="${group[1]}" role="presentation"`), "the heading names the group and is no option");
  assert.ok(markup.includes('<ul role="presentation">'), "an unlabelled group adds no empty group");

  const details = [...markup.matchAll(/<span aria-hidden="true" data-details/g)];
  assert.equal(details.length, 2, "the mouse's ⓘ shows on rows with details only, hidden from assistive tech");

  const mouse = renderToStaticMarkup(
    createElement(OptionList, { id: "pick", groups, value: "acolyte", active: 2, keyboard: false }),
  );
  assert.ok(!mouse.includes("data-highlighted"), "no keyboard highlight for a mouse user");
  assert.ok(mouse.includes('<p id="pick-hint" class="sr-only"'), "the hint is read but not shown to a mouse user");
  console.log("ok: the open list is a listbox of single-target options in labelled groups");
}

// The trigger: a listbox button named by the caption and then the value.
{
  const markup = renderToStaticMarkup(
    createElement(OptionPicker, { value: "criminal", groups, onChange() {}, labelledBy: "caption-bg" }),
  );
  const button = markup.match(/<button[^>]*>/)?.[0] ?? "";
  assert.ok(button.includes('aria-haspopup="listbox"'));
  assert.ok(button.includes('aria-expanded="false"'));
  const named = button.match(/aria-labelledby="caption-bg ([^"]+)"/);
  assert.ok(named, `the trigger is named by the caption, then the value: ${button}`);
  assert.ok(markup.includes(`<span id="${named[1]}" class="truncate">Criminal</span>`), "the value span carries the second id");
  console.log("ok: the trigger announces the field caption and the value");
}

// Wiring that only a browser would exercise, checked in the source.
{
  const source = read("src/app/characters/builder/OptionPicker.tsx");
  const close = source.slice(source.indexOf("function close()"), source.indexOf("}", source.indexOf("function close()")));
  assert.ok(close.includes("trigger.current?.focus()"), "closing the list returns focus to the trigger");
  assert.match(source, /key === "Escape"[\s\S]{0,120}close\(\)/, "Escape closes through close()");
  assert.match(source, /key === "Enter" \|\| \(key === " "/, "Enter or Space chooses");
  assert.ok(source.includes(`closest('[role="group"][aria-labelledby]')`), "a picker in a labelled builder Field takes its caption");

  for (const [path, caption] of [
    ["src/app/characters/builder/KitChoicesSection.tsx", "labelledBy={`${captionId}-${start + at}`}"],
    ["src/app/characters/builder/BackgroundKitSection.tsx", "labelledBy={`${captionId}-${index}`}"],
    ["src/app/create-campaign/IdentityFields.tsx", "labelledBy={captionId}"],
  ]) {
    assert.ok(read(path).includes(caption), `${path} names its picker by its caption`);
  }
  console.log("ok: focus returns to the trigger, and pickers outside a Field pass their caption");
}
