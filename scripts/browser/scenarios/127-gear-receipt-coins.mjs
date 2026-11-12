// The gear receipt's prices and coin read on one line each, by night and by
// day, on a phone and a desktop (pull request #895). The receipt writes coin
// in gold, silver and copper, and its 5rem price column broke "8 gp 5 sp"
// over two lines, a coin's number on one and its code on the next.
//
// An acolyte barbarian with three javelins more than the kit's, a spear, a
// flask of oil and a candle: prices of one, two and three coins, and a purse
// left in all three. The picks are laid in a kept draft (builderDraft.ts) and
// resumed on the gear step, as a player coming back to the builder would.
import { check, eventually } from "../lib.mjs";

const KEY = "odm:builder-draft:library";
const BOUGHT = [
  { name: "Javelin", qty: 3 },
  { name: "Spear", qty: 1 },
  { name: "Oil (flask)", qty: 1 },
  { name: "Candle", qty: 1 },
];

const visible = (page, root, text) =>
  page.locator(`${root}button`).filter({ hasText: text }).locator("visible=true");
const draft = (page) => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), KEY);

// A reload in a browser; in the app, leaving for the library and coming back.
async function reopen(t) {
  if (t.app) await t.open("/characters");
  await t.open("/characters/new");
}

// Every price and foot figure in the receipt, with the lines its text takes.
function figures(table) {
  return table.evaluate((node) => {
    const lines = (element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return new Set([...range.getClientRects()].filter((box) => box.width > 0).map((box) => Math.round(box.top))).size;
    };
    const cells = [
      ...[...node.querySelectorAll("tbody tr")].map((row) => row.querySelector("td:last-child span")),
      ...[...node.querySelectorAll("tbody tr")].map((row) => row.querySelector("td:last-child p")),
      ...[...node.querySelectorAll("tfoot tr")].map((row) => row.querySelector("td:last-child")),
    ].filter(Boolean);
    return cells.map((cell) => ({ text: cell.textContent.replace(/\s+/g, " ").trim(), lines: lines(cell) }));
  });
}

// Each item's name, with the lines it takes and the words it has: a column
// made too narrow for the prices breaks a name inside a word ("Waterski n").
function names(table) {
  return table.evaluate((node) =>
    [...node.querySelectorAll("tbody tr td:first-child span")].map((name) => {
      const range = document.createRange();
      range.selectNodeContents(name);
      const lines = new Set([...range.getClientRects()].filter((box) => box.width > 0).map((box) => Math.round(box.top))).size;
      return { text: name.textContent.trim(), lines, words: name.textContent.trim().split(/\s+/).length };
    }),
  );
}

export default {
  name: "gear-receipt-coins",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root } = t;
    const active = `${root}section[data-active]`;
    await t.open("/characters/new");
    // A draft an earlier viewport left is not this one's.
    const fresh = visible(page, root, /^Start fresh$/);
    if (await fresh.count()) await t.tap(fresh.first());
    const barbarian = page.locator(`${active} .creator-card[aria-label^="Barbarian"]`).locator("visible=true").first();
    await barbarian.waitFor({ state: "visible", timeout: 30_000 });
    await t.tap(barbarian);
    await eventually(async () => (await draft(page))?.fields?.classId === "barbarian", { label: "the barbarian kept on the device" });
    await page.evaluate(
      ({ key, bought }) => {
        const kept = JSON.parse(window.localStorage.getItem(key) ?? "null");
        const fields = { ...kept.fields, raceId: "human", backgroundId: "acolyte", equipment: bought };
        window.localStorage.setItem(key, JSON.stringify({ ...kept, savedAt: Date.now(), step: "spells-gear", fields }));
      },
      { key: KEY, bought: BOUGHT },
    );
    await reopen(t);
    const resume = visible(page, root, /^Resume$/);
    await eventually(() => resume.count(), { timeoutMs: 15_000, label: "the Resume offer" });
    await t.tap(resume.first());
    const table = page
      .locator(`${root}table`)
      .filter({ has: page.locator("caption", { hasText: /^Your gear/ }) })
      .locator("visible=true")
      .first();
    await table.waitFor({ state: "visible", timeout: 20_000 });
    await table.evaluate((node) => node.scrollIntoView({ block: "center" }));

    for (const theme of ["dark", "light"]) {
      await page.evaluate((choice) => {
        window.localStorage.setItem("odm.theme", choice);
        document.documentElement.dataset.theme = choice;
        document.documentElement.style.colorScheme = choice;
      }, theme);
      const shown = await eventually(
        async () => {
          const list = await figures(table);
          return list.length ? list : null;
        },
        { label: "the receipt's figures" },
      );
      const left = shown.at(-1)?.text ?? "";
      check(/^\d+ gp( \d+ sp)?( \d+ cp)?$/.test(left), `the coin left reads in gold, silver and copper (${left})`);
      check(shown.some((cell) => /\d+ gp \d+ sp/.test(cell.text)), `a price of gold and silver is on the receipt (${shown.map((cell) => cell.text).join(" | ")})`);
      const broken = shown.filter((cell) => cell.lines > 1);
      check(broken.length === 0, `${theme}: figures over two lines: ${broken.map((cell) => `"${cell.text}" (${cell.lines})`).join(", ")}`);
      const split = (await names(table)).filter((name) => name.lines > name.words);
      check(split.length === 0, `${theme}: item names broken inside a word: ${split.map((name) => `"${name.text}" (${name.lines} lines)`).join(", ")}`);
      await table.locator("tfoot").evaluate((node) => node.scrollIntoView({ block: "end" }));
      await t.shot(`receipt-${theme}`);
    }
    await page.evaluate((key) => {
      window.localStorage.removeItem(key);
      window.localStorage.removeItem("odm.theme");
    }, KEY);
  },
};
