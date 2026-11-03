// The purse under the gold pieces (issue: sub-GP coin handling). As Wren at
// the Market Table: the Trade dialog takes coin in the coins' codes, so an
// offer of 5 sp is spendable even when the purse shows whole gold; typed
// nonsense and a purse's whole coin answer in words. An accepted trade moves
// the copper across and carries. In the lead's Adjust dialog the Copper box
// belongs to the purse: 150 copper typed there is 1 gp 50 cp on the sheet.
// Both dialogs pass axe, and on a phone their coin controls are a finger's
// height.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const scenario = {
  name: "purse-coin",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    const serious = (list) => list.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    const table = async () => {
      const response = await api.get(`${base}/api/campaigns/${ids.marketTableId}`);
      return response.json();
    };
    const sheetOf = async (id) => ((await table()).sheets ?? []).find((sheet) => sheet.id === id);
    const purse = (sheet) => sheet.gold * 100 + (sheet.copper ?? 0);

    // Play as Wren, as the shop scenarios do, so the Trade menu is Wren's.
    check(
      await (await api.post(`${base}/api/campaigns/${ids.marketTableId}/sheet/switch`, { data: { characterId: ids.marketHeroId } })).ok,
      "playing as Wren",
    );
    await t.open(`/campaigns/${ids.marketTableId}`);
    const card = page.locator(`${root}[data-party-card="${ids.marketSecondId}"]`).locator("visible=true").first();
    const showCard = async () => {
      for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
        if (await card.count()) break;
        const door = page.locator(selector).locator("visible=true").first();
        if (await door.count()) {
          await t.tap(door);
          await eventually(() => card.count(), { timeoutMs: 800 }).catch(() => 0);
        }
      }
      await eventually(() => card.count(), { timeoutMs: 30_000, label: "Tamsin's party card" });
      await untilStill(page);
    };
    await showCard();

    // The seed's heroes carry no coin, so first the lead puts 5 sp in Wren's
    // purse (the same sheet correction the Adjust dialog posts): the coin a
    // trade draws on is the copper as much as the gold pieces.
    const funded = await api.patch(`${base}/api/campaigns/${ids.marketTableId}/sheets/${ids.marketHeroId}`, {
      data: { copper: 50, reason: "found a coin" },
    });
    check(funded.ok, `5 sp into Wren's purse (${funded.status})`);
    await eventually(async () => purse((await sheetOf(ids.marketHeroId))) === 50, { label: "5 sp in Wren's purse" });

    const wren = await sheetOf(ids.marketHeroId);
    const tamsin = await sheetOf(ids.marketSecondId);
    // formatCopper's words, kept local: the field prints the purse with them.
    const coinWords = (cp) => {
      let left = Math.max(0, Math.round(cp));
      const parts = [];
      for (const [code, each] of [["pp", 1000], ["gp", 100], ["sp", 10], ["cp", 1]]) {
        const count = Math.floor(left / each);
        if (count > 0) parts.push(`${count} ${code}`);
        left -= count * each;
      }
      return parts.length ? parts.join(" ") : "0 gp";
    };

    // The Trade dialog, opened from Tamsin's card.
    await t.tap(card.getByRole("button", { name: /^Options for / }));
    await t.tap(page.getByRole("menuitem", { name: "Trade" }));
    const trade = page.getByRole("dialog", { name: "Trade with Tamsin" });
    await eventually(() => trade.count(), { label: "the Trade dialog" });
    const giveCoin = trade.locator("#give-coin");
    await eventually(() => giveCoin.count(), { label: "the coin field under Wren gives" });
    check(
      (await trade.locator("#want-coin").count()) === 1 && (await giveCoin.getAttribute("placeholder")) !== null,
      "a coin field under each side, the purse's whole sum as its placeholder",
    );
    check(
      ((await trade.textContent()) ?? "").includes(`of ${coinWords(purse(wren))}`),
      `each field names the purse it can draw on (of ${coinWords(purse(wren))})`,
    );

    // Typed nonsense answers in words and spends nothing; a whole purse of
    // gold beyond the purse does too.
    await giveCoin.fill("half gp");
    await giveCoin.press("Enter");
    const nonsense = trade.getByRole("alert");
    await eventually(() => nonsense.count(), { label: "the unread-coin warning" });
    check(/whole numbers|not an amount/i.test((await nonsense.textContent()) ?? ""), "the warning says what coin is");
    check(await trade.getByRole("button", { name: /Offer the trade/ }).isDisabled(), "nonsense offers nothing");
    await giveCoin.fill(`${wren.gold + 999} gp`);
    await giveCoin.press("Enter");
    check(/more coin than the purse holds/i.test((await trade.getByRole("alert").textContent()) ?? ""), "the purse's whole is the cap");

    // The coins' codes reach under a gold piece: 5 sp on an all-gold purse.
    await giveCoin.fill("5 sp");
    await giveCoin.press("Enter");
    await eventually(() => giveCoin.inputValue(), { label: "the coin kept as typed back" });
    check((await giveCoin.inputValue()).includes("sp"), "5 sp reads back as coin the table says");
    const offer = trade.getByRole("button", { name: /Offer the trade/ });
    check(!(await offer.isDisabled()), "coin alone is an offer");
    if (t.touch) {
      const box = await giveCoin.boundingBox();
      check(box && box.height >= 39.5, `the coin field is a finger's height on a phone (${box?.height}px)`);
    }
    const found = serious(await axeViolations(page, '[role="dialog"]'));
    check(!found.length, `axe finds nothing serious in the Trade dialog (${found.map((violation) => violation.id).join(", ")})`);
    await t.shot("trade");

    const purseBefore = { wren: purse(wren), tamsin: purse(tamsin) };
    await t.tap(offer);
    await eventually(async () => (await trade.count()) === 0, { label: "the dialog closing on the offer" });
    const offers = (await (await api.get(`${base}/api/campaigns/${ids.marketTableId}/item-proposals`)).json()).proposals;
    const row = offers.find((proposal) => (proposal.summary ?? "").includes("offers 5 sp to Tamsin"));
    check(Boolean(row), `the offer stands as 5 sp, not nothing (${offers.map((proposal) => proposal.summary).join(" | ")})`);

    // The lead settles it, and the copper carries across both purses.
    const settled = await api.post(`${base}/api/campaigns/${ids.marketTableId}/item-proposals/${row.id}`, { data: { action: "approve" } });
    check(settled.ok, `the lead accepts the trade (${settled.status})`);
    const wrenAfter = await sheetOf(ids.marketHeroId);
    const tamsinAfter = await sheetOf(ids.marketSecondId);
    check(purse(wrenAfter) === purseBefore.wren - 50, `Wren's purse gave 5 sp (${purseBefore.wren} → ${purse(wrenAfter)} cp)`);
    check(purse(tamsinAfter) === purseBefore.tamsin + 50, `Tamsin's purse took 5 sp (${purseBefore.tamsin} → ${purse(tamsinAfter)} cp)`);
    check((tamsinAfter.copper ?? 0) >= 0 && (tamsinAfter.copper ?? 0) < 100, "the copper stays under a gold piece");

    // The lead's Adjust dialog carries the purse too: 150 copper typed into
    // the Copper box saves as gold the purse carries, not 150 copper.
    // A reload first: closing the Trade dialog under the offer's response
    // can leave Radix's body cleanup (aria-hidden, pointer-events) a step
    // behind, and this is about coin, not about that race.
    await t.open(`/campaigns/${ids.marketTableId}`);
    await showCard();
    await t.tap(card.getByRole("button", { name: /^Options for / }));
    await t.tap(page.getByRole("menuitem", { name: "Adjust stats" }));
    const adjust = page.getByRole("dialog", { name: /^Adjust / });
    await eventually(() => adjust.count(), { label: "the Adjust dialog" });
    const copperBox = adjust.getByRole("spinbutton", { name: "Copper" });
    await eventually(() => copperBox.count(), { label: "the Copper box" });
    if (t.touch) {
      // The stepper span (the input's parent), like 110 measures: the figure
      // inside it is glyph-sized by design.
      const box = await copperBox.locator("xpath=..").boundingBox();
      check(box && box.height >= 39.5, `the Copper stepper is a finger's height on a phone (${box?.height}px)`);
    }
    const before = await sheetOf(ids.marketSecondId);
    await copperBox.fill("150");
    await copperBox.press("Enter");
    const adjustAxe = serious(await axeViolations(page, '[role="dialog"]'));
    check(!adjustAxe.length, `axe finds nothing serious in the Adjust dialog (${adjustAxe.map((violation) => violation.id).join(", ")})`);
    await t.shot("adjust");
    await t.tap(adjust.getByRole("button", { name: "Save" }));
    await eventually(async () => purse((await sheetOf(ids.marketSecondId))) !== purse(before), { label: "the purse after the save" });
    const saved = await sheetOf(ids.marketSecondId);
    // The box is the copper part of the purse, not a gift of 150: the sheet
    // keeps its gold and the 150 carries — 2 gp with Tamsin's 50 cp in play.
    check(purse(saved) === before.gold * 100 + 150, `the Copper box sets the purse to gold + 150 cp (${purse(before)} → ${purse(saved)} cp)`);
    check(saved.copper >= 0 && saved.copper < 100, `150 copper carried to gold (${saved.gold} gp ${saved.copper} cp)`);
  },
};

export default scenario;
