// What the character creator audit's scenarios share (138-creator-*): a
// builder opened on a planted draft, the day and night themes, a phone at
// 390 px, and one look at a part of a page that names what a player would
// trip on there: a control with no name, a target smaller than a finger on
// a phone, a part pushed past the step's edge or the page scrolling
// sideways, a focus that shows no ring, a serious axe finding.
//
// The look gathers its problems instead of stopping at the first, so one run
// lists every one, as the report kit's other gatherers do.
import fs from "node:fs";
import path from "node:path";
import { axeViolations, currentStep, eventually, untilStill, upTo } from "./lib.mjs";

// Where the pictures go: ODM_UI_SHOTS when it is set (the audit's folder),
// otherwise the run folder beside the failures.
export function shotFor(t, name) {
  const dir = process.env.ODM_UI_SHOTS;
  if (!dir) return t.shotPath(name);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${t.viewport}${t.app ? "-app" : "-web"}-${name}.png`);
}

// A phone of the narrow kind (390 px, an iPhone 12 to 15): the harness's
// own phone is 412, and a row that fits there can still push at 390.
export async function narrowPhone(t) {
  if (t.viewport === "phone") await t.page.setViewportSize({ width: 390, height: 844 });
}

export const setTheme = (page, mode) =>
  page.evaluate((choice) => {
    try {
      window.localStorage.setItem("odm.theme", choice);
    } catch {
      // The attribute below is what the styles read.
    }
    document.documentElement.dataset.theme = choice;
    document.documentElement.style.colorScheme = choice;
  }, mode);

// A picture of one part (or the page) in both themes, night last so the page
// is left as the harness opens it.
export async function shootBoth(t, locator, name) {
  for (const mode of ["light", "dark"]) {
    await setTheme(t.page, mode);
    await untilStill(t.page).catch(() => {});
    const file = shotFor(t, `${name}-${mode === "light" ? "day" : "night"}`);
    if (locator) {
      // A part taller than the window is shot as the window, its top in
      // view: an element shot past the edge of a scroll pane comes out cut.
      const box = await locator.boundingBox().catch(() => null);
      const tall = box && box.height > (t.page.viewportSize()?.height ?? 800) * 0.85;
      if (tall) {
        await locator.evaluate((el) => el.scrollIntoView({ block: "start" })).catch(() => {});
        await untilStill(t.page).catch(() => {});
        await t.page.screenshot({ path: file });
      } else {
        await locator.scrollIntoViewIfNeeded().catch(() => {});
        await locator.screenshot({ path: file }).catch(async () => t.page.screenshot({ path: file }));
      }
    } else {
      await t.page.screenshot({ path: file });
    }
  }
}

// A builder on a draft the device kept: the fields given, on the step named
// (calling, ancestry, abilities, spells-gear, identity, finish). The builder
// offers it back with Resume (src/app/characters/builder/builderDraft.ts).
export async function openDraft(t, step, fields) {
  const { page, root } = t;
  if (t.app) await t.open("/characters");
  else await t.open("/characters");
  await page.evaluate(
    ({ step, fields }) => {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("odm:builder-draft:")) window.localStorage.removeItem(key);
      }
      window.localStorage.setItem("odm:builder-draft:library", JSON.stringify({ v: 2, savedAt: Date.now(), step, fields }));
    },
    { step, fields },
  );
  await t.open("/characters/new");
  const resume = page.locator(`${root}button`).filter({ hasText: /^Resume$/ }).locator("visible=true").first();
  await eventually(() => resume.count(), { timeoutMs: 30_000, label: "the draft's Resume" });
  await t.tap(resume);
  const order = ["calling", "ancestry", "abilities", "spells-gear", "identity", "finish"];
  const number = order.indexOf(step) + 1;
  await eventually(async () => new RegExp(`^Step ${number}:`).test(await currentStep(page, root)), { timeoutMs: 20_000, label: `the builder on step ${number} (${step})` });
  await upTo(async () => !(await page.locator(`${root}section[data-active] [aria-busy="true"]`).count()), 5_000);
  await untilStill(page).catch(() => {});
  return page.locator(`${root}section[data-active]`).first();
}

// 39.5: a 40 px box can measure 39.99998 after layout rounding.
const MIN = 39.5;

// One look at a part of the page. `problems` gathers what is wrong, each
// named for the part.
export async function look(t, scope, part, problems, { axe = true, targets = true } = {}) {
  const { page } = t;
  await untilStill(page).catch(() => {});
  if (!(await scope.count())) {
    problems.push(`${part}: not on the page`);
    return;
  }
  const found = await scope.first().evaluate(
    (root, { min, phone }) => {
      const out = [];
      const nameOf = (el) => {
        const labelled = el.getAttribute("aria-labelledby");
        const fromIds = labelled
          ? labelled
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent ?? "")
              .join(" ")
          : "";
        const forLabel = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent ?? "" : "";
        return (el.getAttribute("aria-label") || fromIds || el.closest("label")?.textContent || forLabel || el.getAttribute("title") || el.textContent || el.getAttribute("placeholder") || "").trim();
      };
      const shown = (el) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const controls = [...root.querySelectorAll('button, [role="button"], [role="menuitemradio"], input:not([type="hidden"]), select, textarea, a[href]')].filter(shown);
      for (const el of controls) {
        const name = nameOf(el);
        if (!name) out.push(`a ${el.tagName.toLowerCase()} with no name (${el.outerHTML.slice(0, 120)})`);
        if (phone) {
          const target = el.closest("label") ?? el;
          const reach = getComputedStyle(target, "::after");
          const reached = reach.content !== "none" && reach.position === "absolute";
          const box = target.getBoundingClientRect();
          const width = Math.max(box.width, reached ? parseFloat(reach.width) || 0 : 0);
          const height = Math.max(box.height, reached ? parseFloat(reach.height) || 0 : 0);
          const typed = el.matches("input:not([type=checkbox]):not([type=radio]), textarea, select");
          // A link in a line of text is read, not aimed at.
          const inline = el.tagName === "A" && getComputedStyle(el).display === "inline";
          // A glossary term (GameTerm, a dotted word in a sentence) is read
          // as part of its line, as a link in text is; an info button
          // carries the kit's own reach (::after), measured above.
          const term = el.matches("button.cursor-help");
          if (!inline && !term && (height < min || (!typed && width < min))) out.push(`"${name.slice(0, 40)}" is ${Math.round(width)}x${Math.round(height)} on a phone`);
        }
      }
      // Nothing pushed past the step's own edge, and the page itself not
      // scrolling sideways.
      const edge = root.getBoundingClientRect();
      for (const el of root.querySelectorAll("*")) {
        if (!shown(el)) continue;
        const box = el.getBoundingClientRect();
        if (box.right > Math.max(edge.right, window.innerWidth) + 1.5 && getComputedStyle(el).position !== "fixed") {
          const clipper = el.closest('[class*="overflow-x-auto"], [class*="overflow-auto"], [data-scroll-x]');
          if (!clipper || clipper === el) {
            out.push(`<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 60)}"> reaches ${Math.round(box.right)} past ${Math.round(Math.max(edge.right, window.innerWidth))}`);
            break;
          }
        }
      }
      const doc = document.scrollingElement ?? document.documentElement;
      if (doc.scrollWidth > window.innerWidth + 1) out.push(`the page scrolls sideways (${doc.scrollWidth} > ${window.innerWidth})`);
      return out;
    },
    { min: MIN, phone: t.viewport === "phone" && targets },
  );
  for (const entry of found) problems.push(`${part}: ${entry}`);
  if (axe) {
    const marker = `axe-${Math.random().toString(36).slice(2, 8)}`;
    await scope.first().evaluate((el, mark) => el.setAttribute("data-axe-look", mark), marker);
    const violations = await axeViolations(page, `[data-axe-look="${marker}"]`);
    for (const violation of violations) problems.push(`${part}: axe ${violation.id} (${violation.help}) at ${violation.nodes.join(" | ").slice(0, 160)}`);
  }
}

// The focus a key press brings shows a ring: the control focused by Tab
// from the one before it carries an outline or a box shadow it lacks
// unfocused.
export async function ringOnTab(t, control, part, problems) {
  const { page } = t;
  if (!(await control.count())) {
    problems.push(`${part}: the control to tab to is not there`);
    return;
  }
  await control.first().scrollIntoViewIfNeeded().catch(() => {});
  // Shift+Tab then Tab lands on it by key, so :focus-visible holds.
  await control.first().focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const ring = await control.first().evaluate((el) => {
    const focused = document.activeElement;
    const target = focused === el || el.contains(focused) ? focused : null;
    if (!target) return { on: false, why: `the focus went to ${focused?.outerHTML.slice(0, 80)}` };
    // The ring may be the card's round the focused pick (a card holding a
    // pick and its info button rings whole).
    const ringed = (node) => {
      const style = getComputedStyle(node);
      return (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || (style.boxShadow && style.boxShadow !== "none");
    };
    const style = getComputedStyle(target);
    const on = ringed(target) || (target.parentElement ? ringed(target.parentElement) : false);
    return { on, why: `outline ${style.outlineStyle} ${style.outlineWidth}, shadow ${style.boxShadow}` };
  });
  if (!ring.on) problems.push(`${part}: no focus ring by keyboard (${ring.why})`);
}

// The rows a kit select offers, by opening it and reading its menu.
export async function selectRows(t, trigger) {
  const { page } = t;
  await t.tap(trigger);
  const rows = page.getByRole("menuitemradio").locator("visible=true");
  await eventually(() => rows.count(), { timeoutMs: 10_000, label: "the select's rows" });
  await untilStill(page).catch(() => {});
  const texts = (await rows.allTextContents()).map((text) => text.trim());
  return {
    texts,
    close: async () => {
      await page.keyboard.press("Escape");
      await eventually(async () => (await rows.count()) === 0, { timeoutMs: 10_000, label: "the select closed" });
    },
    pick: async (name) => {
      await t.tap(rows.filter({ hasText: name }).first());
      await eventually(async () => (await rows.count()) === 0, { timeoutMs: 10_000, label: `the select closed on ${name}` });
    },
  };
}

// The console's errors over a part of a run (the harness counts page errors
// and 5xx answers already; a React warning or a failed load shows only here).
export function consoleErrors(page) {
  const seen = [];
  const listen = (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // A missing favicon or an aborted image of a closed page is no fault of
    // the screen.
    if (/favicon|net::ERR_ABORTED/.test(text)) return;
    // The browser's own line for a failed load names no address; the
    // response listener below names each one that counts.
    if (/^Failed to load resource/.test(text)) return;
    seen.push(text.slice(0, 200));
  };
  // Which load failed: the console names only the status.
  const failed = (response) => {
    // A table on a server with no voice answers its voice channels 403 on
    // every page; that is the table's, not the creator's.
    if (response.status() >= 400 && !/\/voice\/channels/.test(response.url())) seen.push(`${response.status()} ${response.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 120)}`);
  };
  page.on("console", listen);
  page.on("response", failed);
  return {
    seen,
    stop: () => {
      page.off("console", listen);
      page.off("response", failed);
    },
  };
}
