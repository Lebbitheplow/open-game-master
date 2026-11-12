// A route's JSON is gzipped on the way out (src/lib/json-compression.ts).
//
// Next's compression filter read a route handler's Content-Type, which Next
// sets as a list of one, as "not compressible", so every /api answer went out
// whole. This drives a real HTTP server through Next's own compression
// middleware, setting headers the way Next's response adapter does, and
// holds: JSON is gzipped once the fix is installed and was not before it;
// what comes back decodes to the same bytes; a caller that accepts no
// encoding gets it plain; and everything else (an event stream, a picture, a
// byte range of a 3D model, a response marked no-transform) is untouched.
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { register } from "node:module";
import zlib from "node:zlib";

register("./lib/register-alias.mjs", import.meta.url);

const require = createRequire(import.meta.url);
const compression = require("next/dist/compiled/compression");
const { installJsonCompression, soleJsonType } = await import("../src/lib/json-compression.ts");

let passed = 0;
async function test(name, body) {
  await body();
  passed += 1;
  console.log(`ok: ${name}`);
}

// What Next's node response adapter does with each of a handler's headers
// (next/dist/server/base-http/node.js appendHeader): the value joins a list.
function appendHeader(res, name, value) {
  const current = res.getHeader(name);
  const values = current === undefined ? [] : Array.isArray(current) ? current : [String(current)];
  if (!values.includes(value)) {
    res.setHeader(name, [...values, value]);
  }
}

const big = JSON.stringify({ sheets: Array.from({ length: 200 }, (_, index) => ({ id: index, name: `Hero ${index}`, notes: "Sà, the bell rang twice." })) });
const answers = {
  "/json": { headers: { "content-type": "application/json" }, body: big },
  "/json-charset": { headers: { "content-type": "application/json; charset=utf-8" }, body: big },
  "/json-no-transform": { headers: { "content-type": "application/json", "cache-control": "no-store, no-transform" }, body: big },
  "/events": { headers: { "content-type": "text/event-stream", "cache-control": "no-store, no-transform" }, body: `event: ping\ndata: {}\n\n`.repeat(200) },
  "/events-plain": { headers: { "content-type": "text/event-stream" }, body: `event: ping\ndata: {}\n\n`.repeat(200) },
  "/picture": { headers: { "content-type": "image/png" }, body: "x".repeat(5000) },
  "/model-range": { status: 206, headers: { "content-type": "model/gltf-binary", "content-range": "bytes 0-4999/9000", "content-length": "5000" }, body: "y".repeat(5000) },
  "/text": { headers: { "content-type": "text/plain" }, body: "z".repeat(5000) },
  "/jsonish": { headers: { "content-type": "application/jsonlines" }, body: big },
};

const compress = compression();
const server = http.createServer((req, res) => {
  compress(req, res, () => {});
  const answer = answers[req.url];
  res.statusCode = answer.status ?? 200;
  for (const [name, value] of Object.entries(answer.headers)) appendHeader(res, name, value);
  // The body is piped, as Next pipes a handler's: written, then ended.
  res.write(answer.body);
  res.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

function get(path, headers = { "accept-encoding": "gzip" }) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path, headers }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, wire: Buffer.concat(chunks) }));
      })
      .on("error", reject);
  });
}

try {
  await test("the header reader names a list of one JSON type and nothing else", () => {
    assert.equal(soleJsonType("Content-Type", ["application/json"]), "application/json");
    assert.equal(soleJsonType("content-type", ["application/json; charset=utf-8"]), "application/json; charset=utf-8");
    assert.equal(soleJsonType("CONTENT-TYPE", ["Application/JSON"]), "Application/JSON");
    assert.equal(soleJsonType("content-type", "application/json"), null, "a plain string is already what it should be");
    assert.equal(soleJsonType("content-type", ["application/json", "text/plain"]), null);
    assert.equal(soleJsonType("content-type", ["text/event-stream"]), null);
    assert.equal(soleJsonType("content-type", ["application/jsonlines"]), null);
    assert.equal(soleJsonType("content-type", ["model/gltf-binary"]), null);
    assert.equal(soleJsonType("content-type", [42]), null);
    assert.equal(soleJsonType("content-type", []), null);
    assert.equal(soleJsonType("x-content-type", ["application/json"]), null);
    assert.equal(soleJsonType("vary", ["application/json"]), null);
    assert.equal(soleJsonType(undefined, ["application/json"]), null);
  });

  await test("before the fix Next's filter leaves a route's JSON whole, which is the fault", async () => {
    const res = await get("/json");
    assert.equal(res.headers["content-encoding"], undefined, "Next compresses a listed JSON type itself now: src/lib/json-compression.ts can go");
    assert.equal(res.wire.toString(), big);
  });

  installJsonCompression();
  installJsonCompression();

  await test("a route's JSON is gzipped and decodes to the same bytes", async () => {
    for (const path of ["/json", "/json-charset"]) {
      const res = await get(path);
      assert.equal(res.status, 200);
      assert.equal(res.headers["content-encoding"], "gzip", path);
      assert.match(String(res.headers.vary), /accept-encoding/i);
      assert.equal(res.headers["content-type"], answers[path].headers["content-type"]);
      assert.ok(res.wire.length < big.length / 4, `${path}: ${res.wire.length} of ${big.length} bytes`);
      assert.equal(zlib.gunzipSync(res.wire).toString(), big);
    }
  });

  await test("a caller that accepts no encoding is sent the JSON plain", async () => {
    const res = await get("/json", {});
    assert.equal(res.headers["content-encoding"], undefined);
    assert.equal(res.wire.toString(), big);
  });

  await test("an event stream, a picture, a byte range, other text and a no-transform answer go out as before", async () => {
    for (const path of ["/json-no-transform", "/events", "/events-plain", "/picture", "/model-range", "/text", "/jsonish"]) {
      const res = await get(path);
      assert.equal(res.headers["content-encoding"], undefined, `${path} was compressed`);
      assert.equal(res.wire.toString(), answers[path].body, `${path} changed on the way out`);
      assert.equal(res.status, answers[path].status ?? 200);
    }
    const range = await get("/model-range");
    assert.equal(range.headers["content-range"], "bytes 0-4999/9000");
    assert.equal(range.headers["content-length"], "5000");
  });

  await test("a header set the ordinary way is stored as it was given", async () => {
    const res = new http.ServerResponse(new http.IncomingMessage(null));
    res.setHeader("Content-Type", "application/json");
    assert.equal(res.getHeader("content-type"), "application/json");
    res.setHeader("Set-Cookie", ["a=1", "b=2"]);
    assert.deepEqual(res.getHeader("set-cookie"), ["a=1", "b=2"]);
    res.setHeader("Vary", ["rsc"]);
    assert.deepEqual(res.getHeader("vary"), ["rsc"]);
    res.setHeader("Content-Length", 12);
    assert.equal(res.getHeader("content-length"), 12);
    res.setHeader("Content-Type", ["application/json"]);
    assert.equal(res.getHeader("content-type"), "application/json");
  });
} finally {
  server.close();
}

console.log(`\n${passed} json compression tests passed`);
