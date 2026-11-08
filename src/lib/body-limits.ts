// How large a request body each API route accepts, in one table, enforced
// by src/proxy.ts before anything is read.
//
// Every /api request passes the proxy, and Next copies the body of anything
// the proxy sees into memory, up to experimental.proxyClientMaxBodySize in
// next.config.ts. Past that it does not refuse the request: it hands the
// route the first part and logs a warning. So a 25 MB PDF (33 MB as base64)
// or a 64 MB workshop bundle used to arrive cut short and fail as "invalid
// input", while a tiny login form would be read whole at any size.
//
// Now a request that declares more than its route's budget is answered 413
// at once, and one that declares nothing (a chunked body) 411: Node never
// hands a route more bytes than the Content-Length it was given, so the
// declared size is a hard ceiling for every route below, without each one
// counting bytes itself. The routes keep their own finer checks (a picture
// over 8 MB inside an upload budget sized for PDFs, say).
//
// Pure, no "@/" imports: the proxy and next.config.ts both read it.

const KIB = 1024;
const MIB = 1024 * KIB;

// What every route not named below accepts: sheets, maps, notes, settings,
// agent calls. The largest of those is a battle map's imported walls.
export const DEFAULT_BODY_LIMIT = 8 * MIB;

type Rule = { pattern: RegExp; limit: number; why: string };

const SEGMENT = "[^/]+";

export const BODY_LIMIT_RULES: Rule[] = [
  { pattern: /^\/api\/auth\//, limit: 64 * KIB, why: "a username and a password" },
  { pattern: /^\/api\/upload\/?$/, limit: 40 * MIB, why: "a 25 MB PDF as base64 in JSON, with its text as the page read it" },
  { pattern: /^\/api\/workshops\/import\/?$/, limit: 80 * MIB, why: "a 64 MB workshop bundle inside a JSON string" },
  {
    pattern: new RegExp(`^/api/campaigns/${SEGMENT}/world/import/?$`),
    limit: 80 * MIB,
    why: "a 64 MB world export inside a JSON string",
  },
  {
    pattern: new RegExp(`^/api/campaigns/${SEGMENT}/overworld/import/?$`),
    limit: 72 * MIB,
    why: "48 MB of Azgaar GeoJSON inside JSON strings",
  },
  { pattern: /^\/api\/characters\/import\/?$/, limit: 13 * MIB, why: "a 12 MB character file" },
  {
    pattern: new RegExp(`^/api/workshops/${SEGMENT}/plugin/?$`),
    limit: 17 * MIB,
    why: "a 16 MB world pack manifest",
  },
  { pattern: /^\/api\/stt\/?$/, limit: 9 * MIB, why: "an 8 MB recording as a form" },
  {
    pattern: new RegExp(`^/api/pdf-imports/${SEGMENT}/pictures/?$`),
    limit: 12 * MIB,
    why: "one 8 MB picture from an adventure PDF as base64 in JSON",
  },
  { pattern: /^\/api\/admin\/addons\/upload\/?$/, limit: 64 * MIB, why: "an addon archive an admin picked" },
  {
    pattern: new RegExp(`^/api/campaigns/${SEGMENT}/voice/transcript/?$`),
    limit: 7 * MIB,
    why: "a 6 MB ring of call audio as a form",
  },
  {
    pattern: new RegExp(`^/api/campaigns/${SEGMENT}/voice/mesh/signal/?$`),
    limit: 64 * KIB,
    why: "a WebRTC offer or answer",
  },
];

// The largest budget in the table: what next.config.ts must let the proxy
// copy, or the biggest imports are cut short again.
export const LARGEST_BODY_LIMIT = Math.max(DEFAULT_BODY_LIMIT, ...BODY_LIMIT_RULES.map((rule) => rule.limit));

export function bodyLimitFor(pathname: string): number {
  for (const rule of BODY_LIMIT_RULES) {
    if (rule.pattern.test(pathname)) {
      return rule.limit;
    }
  }
  return DEFAULT_BODY_LIMIT;
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type BodyVerdict = { ok: true } | { ok: false; status: 411 | 413; limit: number };

// Whether a request's declared body fits its route. Only methods that carry
// a body are judged; a DELETE with no body declares nothing and passes.
export function judgeBody(
  method: string,
  pathname: string,
  contentLength: string | null,
  transferEncoding: string | null,
): BodyVerdict {
  if (!BODY_METHODS.has(method.toUpperCase()) || !pathname.startsWith("/api/")) {
    return { ok: true };
  }
  const limit = bodyLimitFor(pathname);
  const declared = contentLength === null || contentLength.trim() === "" ? null : Number(contentLength);
  if (declared === null) {
    // A chunked body has no size until it has all arrived, and Next would
    // copy it all the same; no client this server knows sends one.
    if ((transferEncoding ?? "").toLowerCase().includes("chunked")) {
      return { ok: false, status: 411, limit };
    }
    return { ok: true };
  }
  if (!Number.isFinite(declared) || declared < 0 || declared > limit) {
    return { ok: false, status: 413, limit };
  }
  return { ok: true };
}

export function describeLimit(limit: number): string {
  return limit >= MIB ? `${Math.round(limit / MIB)} MB` : `${Math.round(limit / KIB)} KB`;
}
