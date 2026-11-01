// Issue 640: a romance reaches the table. The companion's Party card shows
// the rung beside his standing (the lead reads the number, a player the word
// alone, as on the Bonds tab); a step taken posts a line in the transcript
// that every seat reads; and a step asked in a fight is held, then waits on
// the GM's console once the fight is called off, where "Have Sir Hollis
// Stonebridge answer" opens the Romance form already filled in. Night and
// day, phone and desktop, clean under axe.
import { request } from "playwright-core";
import { axeViolations, check, eventually, openPanelTab, untilStill } from "../lib.mjs";

const HOLLIS = "Sir Hollis Stonebridge";

const scenario = {
  name: "romance-at-the-table",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    const table = ids.romanceTables[t.viewport];
    const campaign = `${base}/api/campaigns/${table.id}`;
    const invoke = async (name, args) => {
      const response = await api.post(`${campaign}/dm/invoke`, { data: { name, args } });
      const body = await response.json().catch(() => ({}));
      check(response.ok() && body.ok !== false, `${name} ran (${response.status()}): ${JSON.stringify(body).slice(0, 240)}`);
      return body;
    };
    const lines = async () => ((await (await api.get(`${campaign}/messages?limit=30`)).json()).messages ?? []).filter((message) => message.authorType === "system").map((message) => message.content);
    const theme = async (name) => {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), name);
      await untilStill(page);
    };

    await t.open(`/campaigns/${table.id}`);
    await openPanelTab(t, "party");
    const card = page.locator(`${root}[data-companion-bonds="${HOLLIS}"]`).locator("visible=true").first();
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "the companion card's romance line" });
    const stage = () => card.locator("[data-companion-stage]").first().getAttribute("data-companion-stage");
    check((await stage()) === "courting", `the card shows courting (${await stage()})`);
    check(/Kael Ashvale/.test((await card.textContent()) ?? ""), "the card names who he is courting");
    check(/Devoted \+100/.test((await card.textContent()) ?? ""), "the lead reads the standing with its number, as on the Bonds tab");
    await untilStill(page);
    const found = await axeViolations(page, `${root}[data-companion-bonds="${HOLLIS}"]`);
    check(!found.length, `axe on the card's romance line: ${found.map((entry) => entry.id).join(", ")}`);
    await t.shot("card-courting");

    // A step taken: the card moves, and the table is told.
    const together = await invoke("romance_advance", { characterId: table.kael, subject: HOLLIS, to: "together" });
    check(together.result?.accepted === true, `the step was taken (${JSON.stringify(together.result).slice(0, 200)})`);
    await eventually(async () => (await stage()) === "together", { timeoutMs: 20_000, label: "the card at together" });
    const said = `Kael Ashvale and ${HOLLIS} became partners.`;
    await eventually(() => page.getByText(said).count(), { timeoutMs: 20_000, label: "the line in the transcript" });
    check((await lines()).includes(said), "the line is in the transcript");
    await t.shot("partners");
    await theme("light");
    await t.shot("partners-day");
    await theme("dark");

    // The player reads the same rung and the same line, and the word alone.
    const playerApi = await request.newContext();
    try {
      const signed = await playerApi.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player's sign-in answered ${signed.status()}`);
      const view = await (await playerApi.get(`${campaign}/relationships`)).json();
      const bond = view.relationships?.find((entry) => entry.subjectName === HOLLIS);
      check(bond?.romance === "together" && bond.approval === undefined, `the player reads the rung without the number (${JSON.stringify(bond)})`);
      const theirs = (await (await playerApi.get(`${campaign}/messages?limit=30`)).json()).messages ?? [];
      check(theirs.some((message) => message.content === said), "every seat reads the line");
    } finally {
      await playerApi.dispose();
    }

    // Asked in a fight: held, not answered; the fight called off; the
    // console waits on the GM for the answer. The GM narrates between, as at
    // any table a person runs: a step answered holds the scene until then
    // (issue 638).
    // A week on the road first: being betrothed needs that long after
    // becoming partners (issue 643), so the held ask can be answered.
    await invoke("pass_time", { amount: 8, unit: "days", reason: "The road north." });
    const narrated = await api.post(`${campaign}/dm/narrate`, { data: { content: "Goblins spill out of the ditch, blades bared." } });
    check(narrated.ok(), `the narration answered ${narrated.status()}`);
    await invoke("start_encounter", { enemies: [{ monster: "goblin" }] });
    const held = await invoke("romance_advance", { characterId: table.kael, subject: HOLLIS, to: "betrothed", note: "Marry me when this is done." });
    check(held.result?.held === true, `the ask was held (${JSON.stringify(held.result).slice(0, 200)})`);
    // Read from the server: a phone's shell turns to the board as a fight opens.
    const rung = (await (await api.get(`${campaign}/relationships`)).json()).relationships?.find((entry) => entry.subjectName === HOLLIS)?.romance;
    check(rung === "together", `nothing moved mid-fight (${rung})`);
    const ended = await api.delete(`${campaign}/encounter`);
    check(ended.ok(), `the force-end answered ${ended.status()}`);

    await openPanelTab(t, "dm");
    const ask = page.locator(`${root}[data-held-ask="${HOLLIS}"]`).locator("visible=true").first();
    await eventually(() => ask.count(), { timeoutMs: 30_000, label: "the held ask under Waiting on you" });
    check(/Kael Ashvale asked Sir Hollis Stonebridge to be betrothed/.test((await ask.textContent()) ?? ""), "the ask in words");
    await untilStill(page);
    const askAxe = await axeViolations(page, `${root}[data-held-ask="${HOLLIS}"]`);
    check(!askAxe.length, `axe on the held ask: ${askAxe.map((entry) => entry.id).join(", ")}`);
    const answer = ask.getByRole("button", { name: `Have ${HOLLIS} answer` });
    const box = await answer.boundingBox();
    check(box && box.height >= 40, `the answer button is a finger's size (${JSON.stringify(box)})`);
    await t.shot("held-ask");
    await theme("light");
    await t.shot("held-ask-day");
    await theme("dark");

    await t.tap(answer);
    const subject = ask.getByLabel("NPC or companion", { exact: true });
    await eventually(() => subject.count(), { label: "the Romance form" });
    check((await subject.inputValue()) === HOLLIS, "the form names the companion");
    await t.shot("answer-form");
    const ran = page.waitForResponse((response) => response.url().endsWith("/dm/invoke") && response.request().method() === "POST", { timeout: 30_000 });
    ran.catch(() => {});
    await t.tap(ask.getByRole("button", { name: /^\s*Run\s*$/ }));
    const reply = await ran;
    check(reply.ok(), `Run answered ${reply.status()}: ${await reply.text()}`);
    const vows = `Kael Ashvale and ${HOLLIS} were betrothed.`;
    await eventually(async () => (await lines()).includes(vows), { timeoutMs: 20_000, label: "the betrothal told to the table" });
    await untilStill(page);
    await t.shot("answered");
  },
};

export default scenario;
