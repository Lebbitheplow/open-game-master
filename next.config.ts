import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";

// Extra hostnames/IPs allowed to reach the dev server (e.g. a phone on your
// tailnet). Comma-separated, set in .env.local: ALLOWED_DEV_ORIGINS=ip1,host2
const extraDevOrigins = (process.env.ALLOWED_DEV_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// The Docker image builds with output: "standalone" so the runtime stage needs
// no node_modules. It is gated behind DOCKER_BUILD because "next start" refuses
// to run against a standalone build, and that is how the app is served on a
// plain host (npm run start:lan).
const dockerBuild = process.env.DOCKER_BUILD === "1";

// What is being built (issue 102): the commit and how far it is past the
// last release tag, read here because the built app may run with no
// repository beside it. A build that has no git to ask (the Docker image,
// whose context leaves .git out) is told through ODM_BUILD_COMMIT and
// ODM_BUILD_DESCRIBE instead; with neither, the About dialog shows the
// release number alone. src/lib/build-info.ts turns these into the label.
function git(...args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).trim();
  } catch {
    return "";
  }
}
const buildCommit = process.env.ODM_BUILD_COMMIT?.trim() || git("rev-parse", "HEAD");
const buildDescribe =
  process.env.ODM_BUILD_DESCRIBE?.trim() || git("describe", "--tags", "--long", "--dirty", "--always") || buildCommit.slice(0, 7);

// The folders under public/ that hold what players made: uploads, generated
// pictures and narration audio. Next serves any file that sat under public/
// when the server started straight from disk, ahead of every route, so after
// a restart those folders were readable by anyone with the address. A
// beforeFiles rewrite runs ahead of that and hands them to the route that
// checks the login (src/app/api/media). It is a path, so it never leaves the
// server whatever address or scheme the request arrived under; the query (a
// sized variant, "?w=256") rides along.
export const LOGIN_MEDIA_ROOTS = ["uploads", "generated", "generated-audio"];

export const loginMediaRewrites = LOGIN_MEDIA_ROOTS.map((root) => ({
  source: `/${root}/:path*`,
  destination: `/api/media/${root}/:path*`,
}));

// Security headers for every response (audit S7). Enforced: nothing may
// frame these pages but themselves (the lore panel frames its own PDFs), no
// plugin objects, no <base> or form target elsewhere, no type sniffing, and
// only the origin goes out as a referrer. The resource policy (where
// scripts, pictures, sound and connections may come from) is report-only:
// the 3D dice and the picture codecs compile WebAssembly, voice opens
// WebRTC and sockets, and a host may point the table at its own picture or
// speech server, so it is reported in the console rather than enforced
// until every one of those has been seen running under it. A table page
// reports two string evals today; both are feature probes inside a try
// with a fallback (Zod's JIT check and is-generator-function), not code
// that needs 'unsafe-eval'.
const enforcedCsp = ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'", "form-action 'self'"].join("; ");
const reportedCsp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' data: blob: https: http:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss: https: http:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

// Cross-origin isolation is not here: it depends on the addons a server has
// (src/lib/page-isolation.ts), so src/proxy.ts adds it per request.
export const securityHeaders = [
  { key: "Content-Security-Policy", value: enforcedCsp },
  { key: "Content-Security-Policy-Report-Only", value: reportedCsp },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

// The game's own art under public/assets (tiles, props, icons, placeholder
// portraits): about 150 pictures on a table's board, and Next serves a public
// file as "max-age=0", so a browser asked the server about every one of them
// again on each open and each reload and was told 304 each time. A browser
// now keeps a picture for an hour before it asks. An hour, not for good: a
// repaint keeps its path (docs/art/token-readability.md), so the address
// alone never says the picture changed. Pictures only: the manifests beside
// them say which files exist and are read with the page's script, so they
// are still asked for every time. Uploads and generated pictures are not
// here at all (they sit behind a login, src/lib/serve-file.ts).
export const BUILT_IN_ART_SOURCE = "/assets/:file(.*\\.(?:webp|png|jpg))";
export const builtInArtHeaders = [{ key: "Cache-Control", value: "public, max-age=3600" }];

const nextConfig: NextConfig = {
  env: {
    ODM_BUILD_COMMIT: buildCommit,
    ODM_BUILD_DESCRIBE: buildDescribe,
    ODM_BUILD_TIME: new Date().toISOString(),
  },
  allowedDevOrigins: ["localhost", "127.0.0.1", ...extraDevOrigins],
  devIndicators: false,
  async rewrites() {
    return { beforeFiles: loginMediaRewrites, afterFiles: [], fallback: [] };
  },
  async headers() {
    return [
      // Everything but an addon's own web files and assets, which a board
      // view frames or fetches from the table (and the desktop app from its
      // own page): their routes send a sandboxing policy of their own instead
      // (src/lib/addons/static-files.ts).
      { source: "/:path((?!api/addons/[^/]+/(?:ui|assets)/).*)", headers: securityHeaders },
      // A session token or a password must never sit in a cache.
      { source: "/api/auth/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
      { source: BUILT_IN_ART_SOURCE, headers: builtInArtHeaders },
      // HSTS only where the request really arrived over https (a TLS proxy in
      // front says so); a browser ignores it over plain http, so a LAN
      // server's http address is never pinned. No includeSubDomains: the
      // server cannot speak for its neighbours.
      {
        source: "/:path*",
        has: [{ type: "header", key: "x-forwarded-proto", value: "https" }],
        headers: [{ key: "Strict-Transport-Security", value: "max-age=15552000" }],
      },
    ];
  },
  // mediasoup spawns a native worker binary and resolves it by path, so
  // bundling it breaks the lookup exactly the way it does for better-sqlite3.
  // multilingual-stemmer reads its .wasm beside its own module the same way.
  serverExternalPackages: ["better-sqlite3-multiple-ciphers", "mediasoup", "multilingual-stemmer"],
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    // Every /api request passes the proxy (src/proxy.ts: app CORS, portal
    // mode, body budgets), and Next copies the body of each into memory up
    // to this size, then hands the route only that much without an error.
    // It must be the largest budget in src/lib/body-limits.ts (a 64 MB
    // workshop bundle as JSON); the proxy refuses anything a route would not
    // accept before it is copied (scripts/test-body-limits.mjs holds the two
    // together).
    proxyClientMaxBodySize: "80mb",
    // A route is loaded when it is first asked for, not all 360 at start.
    // Loading them all read 1,700 built files (200 MB, the same code many
    // times over under different names) into memory before the first
    // request: 476 MB of heap and a 2.3 second stall on a desktop, on a
    // phone hosting a world as well. Started this way the server holds
    // 103 MB, and a route's first request pays for its own load once (a
    // table's first open after a start takes about 0.3 s longer in all).
    // What must exist before any request is loaded by src/instrumentation.ts
    // (scripts/test-boot-registrations.mjs holds that every module that
    // registers a hook as it loads is among them).
    preloadEntriesOnStart: false,
  },
  ...(dockerBuild
    ? {
        output: "standalone" as const,
        // File tracing misses all three native modules: better-sqlite3 is kept
        // out of the bundle by serverExternalPackages, onnxruntime-node (the
        // embedding runtime) resolves its .node binding by a computed path,
        // and mediasoup spawns a standalone worker executable that nothing
        // ever imports, so tracing has no reference to follow.
        // onnxruntime-node's own JavaScript is missed too: transformers.js
        // loads it through createRequire, which the tracer cannot follow, so
        // without dist/ and package.json the image carried the binding alone
        // and every embed failed with "Cannot find module 'onnxruntime-node'".
        // It then requires onnxruntime-common's CommonJS build, while the
        // tracer only saw transformers.js import the ESM one (1.2 MB whole).
        // Only the Linux binding for the CPU the image is built on is shipped
        // (linux/x64 on the published amd64 image, linux/arm64 when the image
        // is built on an arm64 host, issue #39); embeddings are CPU-only.
        // The WASM picture codecs (src/lib/image-variants.ts) are loaded
        // inside a worker thread from a code string, so nothing imports
        // them statically and the tracer would miss them too.
        // LICENSE is read by nothing, so nothing traces it, but the MIT
        // notice has to travel with every copy: the image's /app and the
        // apps' server payload (whose prune keeps it) both start from here.
        outputFileTracingIncludes: {
          "/*": [
            "node_modules/better-sqlite3-multiple-ciphers/**/*",
            "node_modules/onnxruntime-node/package.json",
            "node_modules/onnxruntime-node/dist/**/*",
            "node_modules/onnxruntime-common/**/*",
            `node_modules/onnxruntime-node/bin/napi-v6/linux/${process.arch}/**/*`,
            "node_modules/mediasoup/worker/out/Release/**/*",
            "node_modules/@jsquash/**/*",
            "node_modules/wasm-feature-detect/**/*",
            "LICENSE",
          ],
        },
      }
    : {}),
};

export default nextConfig;
