// A player asked to swing a quarterstaff they thought was drawn: nothing on
// the Hand said which weapon was out, and the storyteller put the sling away
// for them. Every sheet now says what it holds (src/lib/dm/held-default.ts)
// and each weapon card wears it: "In hand" on the longsword, "Packed" on the
// handaxe and the bow, at the art's left where a fan still shows it, read by
// a screen reader in the card's name. A draw moves the mark, and it settles
// in as it changes.
import { request } from "playwright-core";
import { check, eventually } from "../lib.mjs";

export default {
  name: "wield-chip",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport } = t;
    const table = ids.wieldTables[viewport];
    const gm = await request.newContext();
    try {
      const signed = await gm.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player signed in (${signed.status()})`);
      const invoke = async (name, args) => {
        const response = await gm.post(`${base}/api/campaigns/${table.id}/dm/invoke`, { data: { name, args } });
        const body = await response.json().catch(() => ({}));
        check(response.ok(), `${name} was refused (${response.status()}): ${body.error ?? ""}`);
        return body;
      };
      await t.open(`/campaigns/${table.id}`);
      if (viewport === "phone") await t.tap(page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }));
      const hand = page.locator(`${root}section[aria-label="Your hand"]`).locator("visible=true").first();
      await eventually(() => hand.isVisible(), { timeoutMs: 30_000, label: "the fighter's Hand" });

      const card = (id) => hand.locator(`[data-card-id="${id}"]`).locator("visible=true").first();
      const chip = (id) => card(id).locator(".hand-wield");
      await eventually(() => chip("attack:longsword").isVisible(), { timeoutMs: 15_000, label: "the longsword's mark" });
      check((await chip("attack:longsword").getAttribute("data-wield")) === "in-hand", "the longsword is in hand");
      check((await chip("attack:longsword").innerText()).trim().toLowerCase() === "in hand", "the longsword's mark reads In hand");
      check((await chip("attack:handaxe").getAttribute("data-wield")) === "stowed", "the handaxe is packed");
      check((await chip("attack:handaxe").innerText()).trim().toLowerCase() === "packed", "the handaxe's mark reads Packed");
      check(/in hand/i.test((await card("attack:longsword").getAttribute("aria-label")) ?? ""), "a screen reader hears that the longsword is in hand");

      // The mark is on show in the fan: the topmost thing at its middle is the
      // mark's own card (the mark takes no pointer, so the point lands on the
      // card under it), not the neighbouring card laid over it. Read once the
      // fight's title card has cleared the screen.
      for (const id of ["attack:longsword", "attack:handaxe"]) {
        const read = () => chip(id).evaluate((node) => {
          const box = node.getBoundingClientRect();
          const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          const own = node.closest("[data-card-id]");
          return { onTop: Boolean(top && own && own.contains(top)), under: top?.closest("[data-card-id]")?.getAttribute("data-card-id") ?? top?.className ?? null, width: box.width, height: box.height, left: box.left, right: box.right, screen: window.innerWidth };
        });
        let shown = await read();
        await eventually(async () => (shown = await read()).onTop, { timeoutMs: 10_000, label: `${id}'s mark on show (${JSON.stringify(shown)})` });
        check(shown.onTop, `${id}'s mark is not covered (${JSON.stringify(shown)})`);
        check(shown.left >= 0 && shown.right <= shown.screen, `${id}'s mark is on the screen (${JSON.stringify(shown)})`);
      }
      await t.shot("wield-chip");

      // Drawing the handaxe moves its mark, and the mark settles in.
      await invoke("handle_item", { characterId: table.hero, action: "equip", item: "Handaxe" });
      await eventually(async () => (await chip("attack:handaxe").getAttribute("data-wield")) === "in-hand", { timeoutMs: 15_000, label: "the handaxe drawn" });
      const moving = await chip("attack:handaxe").evaluate((node) => node.getAnimations().length);
      check(moving > 0, `the handaxe's mark settles in as it changes (${moving} animations)`);
      await chip("attack:handaxe").evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished)));
      check((await chip("attack:handaxe").innerText()).trim().toLowerCase() === "in hand", "the handaxe's mark reads In hand once drawn");
      await t.shot("wield-chip-drawn");
    } finally {
      await gm.dispose().catch(() => {});
    }
  },
};
