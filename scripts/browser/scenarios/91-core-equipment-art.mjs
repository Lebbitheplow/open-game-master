// The 115 base equipment paintings load inside real inventory chips, on the
// website and in the app. Keep each correction within the sheet's 60-row cap
// and restore the fixture so other scenarios can use Vex's normal equipment.
import fs from "node:fs";
import { register } from "node:module";
import { check, eventually, untilStill } from "../lib.mjs";

const scenario = {
  name: "core-equipment-art",
  viewports: ["desktop", "phone"],
  async run(t) {
    register("../../lib/register-alias.mjs", import.meta.url);
    const { inventoryItemIcon } = await import("../../../src/lib/inventory-art-logic.ts");
    const { equipmentArtwork } = await import("../../../src/lib/equipment-art-logic.ts");
    const { iconPath } = await import("../../../src/lib/icons.ts");
    const rows = JSON.parse(fs.readFileSync(new URL("../../../docs/art/core-equipment-2026-11-18.json", import.meta.url), "utf8")).records;
    check(rows.length === 115, "the review includes all 115 new paintings");
    const { page, root, api, base, ids, viewport } = t;
    const campaignId = ids.wardrobe[viewport];
    const table = await (await api.get(`${base}/api/campaigns/${campaignId}`)).json();
    const vex = table.sheets.find(sheet => sheet.name === "Vex Halloran");
    const endpoint = `${base}/api/campaigns/${campaignId}/sheets/${vex.id}`;
    const patch = async equipment => {
      const response = await api.patch(endpoint, { data: { equipment, reason: "Synthetic inventory artwork regression" } });
      check(response.ok(), `inventory correction succeeds (${response.status()})`);
    };
    try {
      for (let offset = 0; offset < rows.length; offset += 24) {
        const batch = rows.slice(offset, offset + 24);
        await patch(batch.map(row => ({ name: row.label, qty: 1 })));
        await t.open(`/campaigns/${campaignId}`);
        const card = page.locator(`${root}button[title="View full character sheet"]`).filter({ hasText: "Vex Halloran" }).locator("visible=true").first();
        for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
          if (await card.count()) break;
          const door = page.locator(selector).locator("visible=true").first();
          if (await door.count()) {
            await t.tap(door);
            await eventually(() => card.count(), { timeoutMs: 800 }).catch(() => 0);
          }
        }
        await eventually(() => card.count(), { timeoutMs: 30_000, label: "Vex's party card" });
        await t.tap(card);
        const sheet = page.locator(`${root}[role="dialog"]`).filter({ has: page.getByRole("heading", { name: "Vex Halloran", exact: true }) }).first();
        await eventually(() => sheet.count(), { timeoutMs: 20_000, label: "inventory sheet" });
        for (const row of batch) {
          const expected = equipmentArtwork(inventoryItemIcon({ name: row.label }), table.campaign.genre, "inventory");
          const src = iconPath(expected.kind, expected.key);
          const img = sheet.locator(`img[src="${src}"], img[data-odm-src="${src}"]`).first();
          await eventually(() => img.count(), { label: `${row.label} artwork in its chip` });
          await img.scrollIntoViewIfNeeded();
          await eventually(() => img.evaluate(image => image.complete && image.naturalWidth > 0), { label: `${row.label} artwork loaded` });
        }
        const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
        for (const mode of ["dark", "light"]) {
          await page.evaluate(value => { document.documentElement.dataset.theme = value; }, mode);
          await untilStill(page);
          await t.shot(`batch-${Math.floor(offset / 24) + 1}-${mode}`);
        }
        await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
        const spill = await sheet.evaluate(dialog => dialog.scrollWidth - dialog.clientWidth);
        check(spill <= 1, `inventory fits its sheet (${spill}px overflow)`);
        await page.keyboard.press("Escape");
      }
    } finally {
      await patch(vex.equipment);
    }
  },
};
export default scenario;
