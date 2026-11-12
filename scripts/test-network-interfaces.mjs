// Some hosts cannot enumerate interfaces (uv_interface_addresses throws).
// Address discovery must not take down login, setup, sharing or OAuth. These
// are the real handlers against a scratch database; no model is contacted.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { register, syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ogm-network-interfaces-"));
const originalCwd = process.cwd();
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);
register("./lib/register-routes.mjs", import.meta.url);

const realNetworkInterfaces = os.networkInterfaces;
const realFetch = globalThis.fetch;
const originalPublicUrl = process.env.APP_PUBLIC_URL;
const originalToken = globalThis.__odmTestToken;
// Setup probes its configured backends; none may reach this machine's models.
globalThis.fetch = async () => new Response(null, { status: 503 });
delete process.env.APP_PUBLIC_URL;

let calls = 0;
let discover = () => {
  throw Object.assign(new Error("uv_interface_addresses failed"), { code: "ERR_SYSTEM_ERROR" });
};
os.networkInterfaces = () => {
  calls += 1;
  return discover();
};
syncBuiltinESMExports();

const publicUrl = "https://play.example.org";
const privateUrl = "http://192.168.50.10:3005";
const interfaces = {
  en0: [{ address: "192.168.50.10", family: "IPv4", internal: false }],
};
const request = (headers) => new Request("http://localhost:3005/", { headers });
let passed = 0;
async function test(name, fn) {
  calls = 0;
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

try {
  const { createUser } = await import("../src/lib/db/users.ts");
  const { mintSession } = await import("../src/lib/auth.ts");
  const { getGlobalConfig, saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
  const { publicOrigin, discordRedirectUri } = await import("../src/lib/discord-oauth.ts");
  const providers = await import("../src/app/api/auth/providers/route.ts");
  const addresses = await import("../src/app/api/server/addresses/route.ts");
  const setup = await import("../src/app/api/admin/setup/route.ts");

  await test("address and setup discovery still require a signed-in caller", async () => {
    delete globalThis.__odmTestToken;
    assert.equal((await addresses.GET(request())).status, 401);
    assert.equal((await setup.GET(request())).status, 401);
    assert.equal(calls, 0);
  });

  await test("setup discovery still requires an admin", async () => {
    const player = createUser("network-player", "x");
    globalThis.__odmTestToken = mintSession(player.id).token;
    assert.equal((await setup.GET(request())).status, 403);
    assert.equal(calls, 0);
  });

  const admin = createUser("network-admin", "x", { isAdmin: true });
  globalThis.__odmTestToken = mintSession(admin.id).token;

  for (const [name, handler, listsLan] of [
    ["login providers", providers.GET, false],
    ["server addresses", addresses.GET, true],
    ["guided setup", setup.GET, true],
  ]) {
    for (const [saved, expected] of [[publicUrl, publicUrl], [privateUrl, ""], ["", ""]]) {
      await test(`${name} answers with unavailable interfaces and ${saved === publicUrl ? "a public" : saved ? "a private" : "no"} saved URL`, async () => {
        saveGlobalConfig({ publicUrl: saved });
        const response = await handler(request());
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.publicUrl, expected);
        if (listsLan) assert.deepEqual(body.lanUrls, []);
        assert.equal(calls, 1, "one interface snapshot per response");
        assert.equal(getGlobalConfig().publicUrl, saved, "discovery never rewrites the saved address");
      });
    }
  }

  await test("OAuth and agent origins keep the public URL and every existing fallback", () => {
    saveGlobalConfig({ publicUrl });
    assert.equal(discordRedirectUri(request()), `${publicUrl}/api/auth/discord/callback`);
    saveGlobalConfig({ publicUrl: privateUrl });
    process.env.APP_PUBLIC_URL = "https://configured.example.org/";
    assert.equal(publicOrigin(request()), "https://configured.example.org");
    delete process.env.APP_PUBLIC_URL;
    assert.equal(publicOrigin(request({ "x-forwarded-host": "proxy.example.org", "x-forwarded-proto": "https" })), "https://proxy.example.org");
    assert.equal(publicOrigin(request()), "http://localhost:3005");
  });

  await test("an empty interface list gives the same conservative answer", async () => {
    discover = () => ({});
    const body = await (await addresses.GET(request())).json();
    assert.equal(body.publicUrl, "");
    assert.deepEqual(body.lanUrls, []);
  });

  await test("discovery recovers on the next request without caching a failure", async () => {
    discover = () => interfaces;
    for (const handler of [providers.GET, addresses.GET, setup.GET]) {
      calls = 0;
      const body = await (await handler(request())).json();
      assert.equal(body.publicUrl, privateUrl);
      if (body.lanUrls) assert.deepEqual(body.lanUrls, [privateUrl]);
      assert.equal(calls, 1, "public and LAN addresses use the same snapshot");
    }
    assert.equal(publicOrigin(request()), privateUrl);
  });
} finally {
  os.networkInterfaces = realNetworkInterfaces;
  syncBuiltinESMExports();
  globalThis.fetch = realFetch;
  globalThis.__odmTestToken = originalToken;
  if (originalPublicUrl === undefined) delete process.env.APP_PUBLIC_URL;
  else process.env.APP_PUBLIC_URL = originalPublicUrl;
  process.chdir(originalCwd);
  removeTempDir(dir);
}

console.log(`network interfaces: ${passed} tests passed`);
