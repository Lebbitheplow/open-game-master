import { ServerResponse } from "node:http";

// Why a route's JSON went out uncompressed, and the one-line cure.
//
// Next gzips what it serves (next.config's `compress`, on unless a proxy in
// front does it), and it did for pages and for the files under public/. Not
// for a route handler's answer: Next copies a handler's headers onto the
// response as lists (appendHeader, so a header may repeat), and its
// compression filter asks whether the Content-Type is a compressible one by
// testing it as a string. A list of one type is not a string, the filter read
// it as "not compressible", and every /api answer went out whole: 78 KB to
// open a table, 122 KB for the rulebook's index, 258 KB for a bestiary
// search, each time, to every phone on the LAN and every app on a direct
// address (a tunnel that compresses at its edge hid it from browsers there).
//
// A Content-Type set as a list of one JSON type is stored as that type, which
// is what it says and what goes on the wire either way. Nothing else changes:
// the same filter still leaves alone a response marked no-transform (the
// event streams), a HEAD, and one already encoded, and no other content type
// is touched, so pictures, audio, PDFs, 3D models and their byte ranges go
// out exactly as before.

const JSON_TYPE = /^application\/json(?:\s*;|\s*$)/i;

// The JSON content type a header call sets as a list of one, or null for any
// other header or value.
export function soleJsonType(name: unknown, value: unknown): string | null {
  if (typeof name !== "string" || name.length !== 12 || name.toLowerCase() !== "content-type") {
    return null;
  }
  if (!Array.isArray(value) || value.length !== 1 || typeof value[0] !== "string") {
    return null;
  }
  return JSON_TYPE.test(value[0]) ? value[0] : null;
}

declare global {
  var __odmJsonCompression: boolean | undefined;
}

// Called once at start (src/instrumentation.ts), before the first request.
export function installJsonCompression(): void {
  if (globalThis.__odmJsonCompression) {
    return;
  }
  globalThis.__odmJsonCompression = true;
  const setHeader = ServerResponse.prototype.setHeader;
  ServerResponse.prototype.setHeader = function setHeaderWithJsonType(
    this: ServerResponse,
    name: string,
    value: number | string | readonly string[],
  ) {
    return setHeader.call(this, name, soleJsonType(name, value) ?? value);
  } as typeof setHeader;
}
