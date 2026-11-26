// The Hand's Mount card. Dismount had a card and mounting had none, so a
// rider on foot beside their own steed typed their way up and waited for the
// GM. Maren stands beside the warhorse Find Steed made, on her turn: the
// Hand deals Mount, named for a screen reader and a finger's height on a
// phone, its rules line says which creature and what it costs, and playing
// it puts her up, where the Hand deals Dismount in its place. Shot by night
// and by day. The seed's Mount Card Tables, one per viewport, since the play
// changes the table.
import { check, eventually, untilStill, upTo } from "../lib.mjs";

const visible = (locator) => locator.locator("visible=true");

export default {
  name: "mount-card",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    const bench = ids.bench2.mountCard[t.viewport];
    const setTheme = (mode) => page.evaluate((choice) => {
      window.localStorage.setItem("odm.theme", choice);
      // What applyTheme does: the app's screens do not reload between pages.
      document.documentElement.dataset.theme = choice;
      document.documentElement.style.colorScheme = choice;
    }, mode);
    // A card pressed from the keyboard on a desktop, where the fanned cards
    // overlap and a pointer aimed at one lands on its neighbour.
    const press = async (locator) => {
      if (t.touch) return t.tap(locator);
      await locator.focus();
      await page.keyboard.press("Enter");
    };
    const inFan = (name) => visible(page.locator(`${root}.hand-fan button.hand-card[aria-label^="${name},"]`));
    const moreButton = () => visible(page.locator(`${root}button.hand-more`));
    const moreRow = (name) => visible(page.locator("li.hand-more-row button").filter({ has: page.locator(".font-display", { hasText: new RegExp(`^${name}$`) }) }));
    // The card of that name where it is dealt: in the fan, or on its row
    // behind More, which this opens.
    const find = async (name) => {
      if (await upTo(() => inFan(name).count(), 5_000)) return { where: "fan", card: inFan(name).first() };
      await eventually(() => moreButton().count(), { timeoutMs: 30_000, label: "the Hand's More button" });
      await t.tap(moreButton().first());
      await eventually(() => moreRow(name).count(), { label: `${name} behind More` });
      await untilStill(page);
      return { where: "more", card: moreRow(name).first() };
    };
    const openTable = async () => {
      await t.open(`/campaigns/${bench.id}`);
      const tab = visible(page.locator(`${root}button, ${root}[role="tab"]`).filter({ hasText: /^\s*table\s*$/i }));
      if (await tab.count()) await t.tap(tab.first());
      // The fight's title card plays over the board as the page opens.
      const title = visible(page.getByText("Roll initiative", { exact: true }));
      await eventually(async () => (await title.count()) === 0, { timeoutMs: 30_000, label: "the title card gone" });
    };
    try {
      for (const mode of ["dark", "light"]) {
        await openTable();
        await setTheme(mode);
        await openTable();
        const { where, card } = await find("Mount");
        const seen = await card.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return { text: node.textContent ?? "", label: node.getAttribute("aria-label") ?? "", height: box.height, width: box.width };
        });
        check(seen.text.includes(`Onto ${bench.steed.name}: half your speed.`), `Mount says which creature and what it costs (${where}: "${seen.text.trim().slice(0, 120)}")`);
        check(where === "more" || seen.label.startsWith("Mount,"), `the card is named for a screen reader ("${seen.label}")`);
        check(Math.round(seen.height) >= 40 && seen.width >= 40, `and is a finger's height (${Math.round(seen.width)} by ${Math.round(seen.height)}px)`);
        // A phone's fan scrolls sideways: the card is brought into view for the picture.
        await card.scrollIntoViewIfNeeded();
        await untilStill(page).catch(() => undefined);
        await t.shot(`card-${mode}`);
        if (where === "more") {
          await page.keyboard.press("Escape");
          await eventually(async () => (await moreRow("Mount").count()) === 0, { label: "More closed" });
        }
      }
      // Played: the aim bar opens under the picked card, and its button sends it.
      const { card } = await find("Mount");
      await press(card);
      const send = visible(page.locator(`${root}.hand-aim`).getByRole("button", { name: /Mount/ })).first();
      await eventually(() => send.count(), { label: "the aim bar's button for Mount" });
      await untilStill(page);
      await t.shot("aim");
      await t.tap(send);
      // Up on the steed, the Hand deals Dismount where Mount was.
      await eventually(
        async () => (await inFan("Dismount").count()) > 0 || ((await moreButton().count()) > 0 && (await find("Dismount")).where === "more"),
        { timeoutMs: 30_000, label: "Dismount dealt once Maren is up" },
      );
      if (await moreRow("Dismount").count()) {
        check((await moreRow("Mount").count()) === 0, "and Mount is no longer dealt");
        await page.keyboard.press("Escape");
      } else {
        check((await inFan("Mount").count()) === 0, "and Mount is no longer dealt");
      }
      // The focus the play left behind opens a card's details over the fan.
      await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
      const down = inFan("Dismount");
      if (await down.count()) await down.first().scrollIntoViewIfNeeded();
      await untilStill(page).catch(() => undefined);
      await t.shot("mounted");
    } finally {
      await setTheme("dark");
    }
  },
};
