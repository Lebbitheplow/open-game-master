import zlib from "node:zlib";
import { PACKED_JSON_HEADER } from "./packed-json.ts";

// A route's JSON answer, packed when it is big and the caller can unpack it.
// `next start` gzipped its pages and static files but not a route handler's
// answer, so a 4,000-entry world went over the wire as 12.7 MB of JSON
// (audit WF-24, docs/worldforge-large-worlds.md). Packed it is about 2 MB.
//
// gzip at its fastest packs that world in about 70 ms, synchronously on
// purpose: zlib's own pool, shared with the server's other work, took 3 to 4
// seconds for the same answer in the running server (measured in the docs
// above).
//
// Next 16.4.6 drops a route handler's Content-Encoding (packed-json.ts says
// why), so a packed answer can no longer be left to the browser to unpack
// unseen. It goes only to a caller that asked with PACKED_JSON_HEADER and
// unpacks it itself (unpackJson), as raw bytes Next's compression leaves
// alone. Every other caller, and any answer under 64 KB, gets plain JSON,
// which Next gzips on its way out (src/lib/json-compression.ts).

const FROM_BYTES = 64 * 1024;

export function compressedJson(request: Request, body: unknown, init: ResponseInit = {}): Response {
  const text = JSON.stringify(body);
  const headers = new Headers(init.headers);
  headers.append("vary", PACKED_JSON_HEADER);
  if (text.length >= FROM_BYTES && request.headers.get(PACKED_JSON_HEADER) === "gzip") {
    headers.set("content-type", "application/octet-stream");
    headers.set("cache-control", "no-store, no-transform");
    headers.set(PACKED_JSON_HEADER, "gzip");
    return new Response(new Uint8Array(zlib.gzipSync(text, { level: 1 })), { ...init, headers });
  }
  headers.set("content-type", "application/json");
  return new Response(text, { ...init, headers });
}
