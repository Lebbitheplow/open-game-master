// The way back in for a device world's host (src/app/api/auth/recover-owner):
// the app made up the host's password and kept it, so when that password
// stops signing in (issue 909: the host reset their own account) the setup
// code the app handed the server at start is the proof that sets a new one.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-recover-owner-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.ODM_ENV_FILE = path.join(dir, "no-env-file");
process.env.ODM_DEVICE_WORLD = "1";
process.env.ODM_SETUP_CODE = "shell-made-secret-0123";

register("./lib/register-alias.mjs", import.meta.url);

const { POST } = await import("../src/app/api/auth/recover-owner/route.ts");
const { POST: token } = await import("../src/app/api/auth/token/route.ts");
const { hashPassword } = await import("../src/lib/auth.ts");
const { claimFirstAdmin } = await import("../src/lib/setup-code.ts");
const { createUser, getUserByUsername, setUserAdmin, setUserPassword } = await import("../src/lib/db/users.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

function call(handler, route, body, ip = "203.0.113.7") {
  return handler(
    new Request(`http://127.0.0.1:3210/api/auth/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(ip ? { "cf-connecting-ip": ip } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

const recover = (body, ip) => call(POST, "recover-owner", body, ip);
const signIn = (username, password) => call(token, "token", { username, password });

await test("a world with no owner yet has nobody to recover", async () => {
  const response = await recover({ setupCode: "shell-made-secret-0123", password: "new-secret-1" });
  assert.equal(response.status, 404);
});

const host = claimFirstAdmin("host", await hashPassword("made-up-by-app"), "shell-made-secret-0123");
assert.ok(host?.isAdmin);
createUser("guest", await hashPassword("guest-secret-1"));

await test("the host locked out by a reset of their own account", async () => {
  // What Users > Reset did to the host's own row.
  setUserPassword(host.id, await hashPassword("temporary-nobody-saw"), true);
  assert.equal((await signIn("host", "made-up-by-app")).status, 401);
});

await test("a wrong or missing code changes nothing", async () => {
  assert.equal((await recover({ setupCode: "guess", password: "attacker-secret" }, "198.51.100.1")).status, 403);
  assert.equal((await recover({ password: "attacker-secret" }, "198.51.100.1")).status, 400);
  assert.equal((await signIn("host", "attacker-secret")).status, 401);
});

await test("the app's code sets the host's new password and answers with a session", async () => {
  const response = await recover({ setupCode: "shell-made-secret-0123", password: "app-made-new-1", username: "host" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.token);
  assert.equal(body.user.username, "host");
  assert.equal(body.user.isAdmin, true);
  assert.equal(getUserByUsername("host").mustChangePassword, false, "the reset's must-change gate is left");
  assert.equal((await signIn("host", "app-made-new-1")).status, 200);
});

await test("a name that is no admin here recovers the world's owner, never a guest", async () => {
  const response = await recover({ setupCode: "shell-made-secret-0123", password: "app-made-new-2", username: "guest" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.username, "host");
  assert.equal((await signIn("guest", "guest-secret-1")).status, 200, "the guest's password moved");
  assert.equal((await signIn("host", "app-made-new-2")).status, 200);
});

await test("a host a co-admin demoted is still the one let back in, never the co-admin", async () => {
  // The host made a guest an admin, and that admin took the host's admin
  // away and reset the host's password. The app names its own host: the
  // world's first account is recovered, and the co-admin's account and
  // password are left alone.
  const coAdmin = createUser("coadmin", await hashPassword("coadmin-secret-1"), { isAdmin: true });
  setUserAdmin(host.id, false);
  setUserPassword(host.id, await hashPassword("temporary-nobody-saw-2"), true);
  const response = await recover({ setupCode: "shell-made-secret-0123", password: "app-made-new-5", username: "host" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.username, "host");
  assert.equal((await signIn("coadmin", "coadmin-secret-1")).status, 200, "the co-admin's password is untouched");
  assert.equal((await signIn("host", "app-made-new-5")).status, 200);
  setUserAdmin(host.id, true);
  setUserAdmin(coAdmin.id, false);
});

await test("a caller on the Wi-Fi cannot lock the app out of its own door", async () => {
  // The address a lockout would be counted against is whatever the caller
  // says it is (cf-connecting-ip comes first in clientIp, and a world
  // reached directly has no edge to set it), so a caller naming the app's
  // own address could keep the host out with a few wrong codes, and one
  // naming a new address each time was never counted. The code's length is
  // what holds a guesser off; nothing a caller sends keeps the app out.
  for (const ip of ["127.0.0.1", null]) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      assert.equal((await recover({ setupCode: `wifi-guess-${attempt}`, password: "attacker-secret" }, ip)).status, 403);
    }
    const response = await recover({ setupCode: "shell-made-secret-0123", password: "app-made-new-6", username: "host" }, ip);
    assert.equal(response.status, 200);
  }
});

await test("a host account that is gone is no one else's to take", async () => {
  // A co-admin deleted the host's account: the name the app keeps is no
  // account here, and the world's next admin is the co-admin, whose
  // account the app must not be handed.
  const response = await recover({ setupCode: "shell-made-secret-0123", password: "app-made-new-8", username: "host-who-was-deleted" });
  assert.equal(response.status, 404);
  assert.equal((await signIn("host", "app-made-new-6")).status, 200, "nobody's password moved");
});

await test("a code short enough to guess opens no such door", async () => {
  process.env.ODM_SETUP_CODE = "abc-123";
  assert.equal((await recover({ setupCode: "abc-123", password: "app-made-new-7" })).status, 404);
  process.env.ODM_SETUP_CODE = "shell-made-secret-0123";
});

await test("a server somebody runs, or a device world started without a code, has no such door", async () => {
  delete process.env.ODM_DEVICE_WORLD;
  assert.equal((await recover({ setupCode: "shell-made-secret-0123", password: "app-made-new-4" })).status, 404);
  process.env.ODM_DEVICE_WORLD = "1";
  delete process.env.ODM_SETUP_CODE;
  assert.equal((await recover({ setupCode: "shell-made-secret-0123", password: "app-made-new-4" })).status, 404);
  assert.equal((await signIn("host", "app-made-new-4")).status, 401);
});

console.log(`${passed} recover-owner tests passed`);
