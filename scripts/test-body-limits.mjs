// Request body budgets (src/lib/body-limits.ts): what the proxy refuses
// before Next copies a body, and that every route's own advertised cap fits
// inside the budget its path is given, so nothing it accepts is cut short.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { DEFAULT_BODY_LIMIT, LARGEST_BODY_LIMIT, bodyLimitFor, judgeBody } = await import("../src/lib/body-limits.ts");
const { MAX_PDF_BYTES, MAX_UPLOAD_BYTES } = await import("../src/lib/uploads-store.ts");
const workshopBundle = await import("../src/lib/workshop/bundle-schema.ts");
const characterBundle = await import("../src/lib/character-bundle.ts");
const { MAX_MANIFEST_BYTES } = await import("../src/lib/worlds/types.ts");
const { MESH_SIGNAL_MAX_BYTES } = await import("../src/lib/voice/mesh-logic.ts");
const { AZGAAR_LIMITS } = await import("../src/lib/overworld/azgaar.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const MIB = 1024 * 1024;
// What base64 inside a JSON string costs: 4 characters per 3 bytes, plus
// the data: prefix and the other fields.
const asBase64Json = (bytes) => Math.ceil(bytes / 3) * 4 + 4096;

test("a sign-in form is judged small, an import large, everything else the default", () => {
  assert.equal(bodyLimitFor("/api/auth/login"), 64 * 1024);
  assert.equal(bodyLimitFor("/api/auth/token"), 64 * 1024);
  assert.equal(bodyLimitFor("/api/upload"), 40 * MIB);
  assert.equal(bodyLimitFor("/api/workshops/import"), 80 * MIB);
  assert.equal(bodyLimitFor("/api/campaigns/abc/world/import"), 80 * MIB);
  assert.equal(bodyLimitFor("/api/campaigns/abc/notes"), DEFAULT_BODY_LIMIT);
  // A look-alike path does not borrow a bigger budget.
  assert.equal(bodyLimitFor("/api/campaigns/abc/world/import/extra"), DEFAULT_BODY_LIMIT);
  assert.equal(bodyLimitFor("/api/uploads"), DEFAULT_BODY_LIMIT);
});

test("a declared size over the budget is 413, at or under it passes", () => {
  assert.deepEqual(judgeBody("POST", "/api/auth/login", String(64 * 1024 + 1), null), {
    ok: false,
    status: 413,
    limit: 64 * 1024,
  });
  assert.deepEqual(judgeBody("POST", "/api/auth/login", String(64 * 1024), null), { ok: true });
  assert.deepEqual(judgeBody("POST", "/api/auth/login", "120", null), { ok: true });
  assert.equal(judgeBody("PUT", "/api/campaigns/a/sheet", String(9 * MIB), null).status, 413);
  assert.equal(judgeBody("POST", "/api/auth/login", "-1", null).status, 413);
  assert.equal(judgeBody("POST", "/api/auth/login", "lots", null).status, 413);
});

test("a chunked body with no size is 411; no body at all passes", () => {
  assert.deepEqual(judgeBody("POST", "/api/upload", null, "chunked"), { ok: false, status: 411, limit: 40 * MIB });
  assert.deepEqual(judgeBody("POST", "/api/auth/logout", null, null), { ok: true });
  assert.deepEqual(judgeBody("DELETE", "/api/campaigns/a", null, null), { ok: true });
});

test("reads and paths outside the API are never judged", () => {
  assert.deepEqual(judgeBody("GET", "/api/campaigns/a/events", null, "chunked"), { ok: true });
  assert.deepEqual(judgeBody("POST", "/uploads/x.png", String(900 * MIB), null), { ok: true });
});

test("every route's own cap fits inside its budget", () => {
  assert.ok(asBase64Json(MAX_PDF_BYTES) <= bodyLimitFor("/api/upload"), "a 25 MB PDF");
  assert.ok(asBase64Json(MAX_UPLOAD_BYTES) <= bodyLimitFor("/api/upload"), "an 8 MB picture");
  // A bundle's text inside a JSON string: an escaped quote or newline costs
  // two characters, and a bundle is mostly base64 that needs none.
  const bundleAsJson = Math.ceil(workshopBundle.MAX_BUNDLE_BYTES * 1.2);
  assert.ok(bundleAsJson <= bodyLimitFor("/api/workshops/import"), "a workshop bundle");
  assert.ok(bundleAsJson <= bodyLimitFor("/api/campaigns/x/world/import"), "a world export");
  assert.ok(Math.ceil(AZGAAR_LIMITS.maxChars * 1.4) <= bodyLimitFor("/api/campaigns/x/overworld/import"), "Azgaar files");
  assert.ok(characterBundle.MAX_BUNDLE_BYTES < bodyLimitFor("/api/characters/import"), "a character file");
  assert.ok(MAX_MANIFEST_BYTES < bodyLimitFor("/api/workshops/w/plugin"), "a world pack");
  assert.ok(8 * MIB < bodyLimitFor("/api/stt"), "a dictation recording");
  assert.ok(6 * MIB < bodyLimitFor("/api/campaigns/x/voice/transcript"), "a call ring");
  assert.ok(MESH_SIGNAL_MAX_BYTES < bodyLimitFor("/api/campaigns/x/voice/mesh/signal"), "a mesh signal");
});

test("next.config.ts lets the proxy copy exactly the largest budget", () => {
  const config = fs.readFileSync(path.join(import.meta.dirname, "..", "next.config.ts"), "utf8");
  const match = /proxyClientMaxBodySize:\s*"(\d+)mb"/.exec(config);
  assert.ok(match, "proxyClientMaxBodySize is set in megabytes");
  assert.equal(Number(match[1]) * MIB, LARGEST_BODY_LIMIT);
});

console.log(`\n${passed} body-limit tests passed.`);
