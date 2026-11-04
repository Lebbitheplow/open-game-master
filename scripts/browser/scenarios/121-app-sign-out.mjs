// Server PR 798 and client PR 110: inside the desktop and Android apps the
// app owns sign-in, so a page there never strands the player on the
// server's login form. The account menu draws App home and no Log out,
// while a browser keeps Log out. Under --app (the app's own screens):
// an old server still draws Log out, and its call (the POST to
// /api/auth/logout that menu sent) never leaves the app: App home opens
// and the world opens again on the same sign-in. A session that ends on
// its own (here the password set again from another session, which
// revokes every other one) takes the player to the app's home with the
// news. On the web, a signed-out settings page inside an app's web view
// (an old app, which has no such watch) offers App home, not the login
// form, and a plain browser still gets its Log in link.
import { check, eventually, hydrated, newContext, settle } from "../lib.mjs";

const NOTICE = "Your session at this world ended. Sign in again.";

async function menuItems(t) {
  const { page, root } = t;
  const trigger = page.locator(`${root}button[aria-label="Account"]`).locator("visible=true").first();
  await eventually(() => trigger.count(), { timeoutMs: 30_000, label: "the account menu" });
  await t.tap(trigger);
  const menu = page.locator('[role="menu"]').locator("visible=true").first();
  await eventually(() => menu.locator('[role="menuitem"]').count(), { label: "the account menu's items" });
  const items = await menu.locator('[role="menuitem"]').allInnerTexts();
  await page.keyboard.press("Escape");
  await eventually(async () => (await page.locator('[role="menu"]').locator("visible=true").count()) === 0, { label: "the menu closed" });
  return items.map((text) => text.trim());
}

const gameShowing = (page) => page.locator(".game-root").count();

export default {
  name: "app-sign-out",
  viewports: ["desktop"],
  async run(t) {
    const { page, app, base, ids } = t;
    await t.open("/settings");
    const items = await menuItems(t);
    if (!app) {
      check(items.includes("Log out"), `a browser's account menu offers Log out (it has ${items.join(", ")})`);
      check(!items.includes("App home"), "a browser's account menu offers App home");

      // An old app's web view: the page sees window.odmShell and no session.
      const browser = page.context().browser();
      for (const inShell of [true, false]) {
        const context = await newContext(browser, "desktop", { app: false });
        try {
          if (inShell) {
            await context.addInitScript(() => {
              window.odmShell = { platform: "desktop", showServers: () => { window.__odmHome = true; } };
            });
          }
          const tab = await context.newPage();
          await tab.goto(`${base}/settings`, { waitUntil: "networkidle", timeout: 120_000 });
          await hydrated(tab);
          if (inShell) {
            // The notice's own door (the header's brand tile is one too).
            const home = tab.getByRole("button", { name: "App home" }).filter({ hasText: "App home" });
            await eventually(() => home.count(), { label: "App home on a signed-out page in an app" });
            check((await tab.getByRole("link", { name: "Log in" }).count()) === 0, "a signed-out page in an app links to the server's login form");
            const box = await home.boundingBox();
            check(box && box.height >= 40, `App home is a finger-sized target (${box?.height}px)`);
            await home.click();
            check(await tab.evaluate(() => window.__odmHome === true), "App home did not open the app's home");
          } else {
            await eventually(() => tab.getByRole("link", { name: "Log in" }).count(), { label: "a browser's Log in link" });
          }
        } finally {
          await context.close();
        }
      }
      return;
    }

    check(items.includes("App home"), `the app's account menu offers App home (it has ${items.join(", ")})`);
    check(!items.includes("Log out"), "the app's account menu still offers Log out");

    // What an old server's Log out did: the app answers it and opens home.
    const status = await page.evaluate(async () => (await fetch("/api/auth/logout", { method: "POST" })).status);
    check(status === 204, `the app answered the old server's logout with ${status}`);
    await eventually(async () => (await gameShowing(page)) === 0, { label: "App home after the old server's Log out" });
    const enter = page.getByRole("button", { name: /^enter(?: the world)?$/i }).first();
    await eventually(() => enter.count(), { label: "the world's Enter on the app's home" });
    await t.tap(enter);
    await page.waitForSelector(".game-root", { timeout: 60_000 });
    await settle(page);
    check((await page.locator('input[type="password"]').locator("visible=true").count()) === 0, "the world asked for a sign-in again");
    const alive = await t.api.get(`${base}/api/auth/me`);
    check(alive.ok(), "the lead's other session survived");

    // The session ends on its own: the password set again from another
    // session revokes every session but that one, the app's included.
    const revoke = await t.api.post(`${base}/api/auth/change-password`, {
      data: { currentPassword: ids.password, newPassword: ids.password },
    });
    check(revoke.ok(), `setting the password again answered ${revoke.status()}`);
    await page.evaluate(() => fetch("/api/friends").catch(() => undefined));
    await eventually(async () => (await gameShowing(page)) === 0, { label: "the app's home after the session ended" });
    const toast = page.locator(".shell-toast");
    await eventually(async () => (await toast.innerText().catch(() => "")).includes(NOTICE), { label: "the session's news on the app's home" });
    await t.shot("session-ended");
  },
};
