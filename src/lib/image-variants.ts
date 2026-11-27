// Smaller WebP copies of generated and uploaded pictures, written beside the
// original after it is saved (src/lib/image-format.ts names them).
//
// The work runs in a worker thread with pure WASM codecs (@jsquash/png,
// @jsquash/jpeg and @jsquash/webp to decode, @jsquash/resize to shrink,
// @jsquash/webp to encode), so it needs no native module, runs on the
// phone-hosted Node build, never blocks the event loop the tables share,
// and hands its memory back when the worker exits. The packages are
// loaded inside the worker from a code string, by real Node resolution
// from the server root, so the Next bundler never sees them; the
// standalone build carries them through outputFileTracingIncludes.
//
// Every failure is non-fatal: the original is what campaign data stores and
// what the serve routes fall back to. Jobs run one at a time.
//
// The WebP encoder comes in a SIMD build and a plain one. On some CPUs (a
// Celeron J4125 in a Synology NAS, #1124) the runtime reports SIMD but the
// SIMD build writes scrambled pixels, so the first job of a run encodes a
// test picture with it and decodes it again, and the plain build is used
// wherever that round trip comes back wrong.
import { existsSync } from "node:fs";
import { readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import {
  imageSize,
  isVariantFileName,
  pixelBudget,
  sniffImage,
  VARIANT_WIDTHS,
  variantFileName,
  type VariantWidth,
} from "@/lib/image-format";

// Well past a phone's worst case for a 3 MB picture (about a second on a
// desktop core, a few on a phone).
const JOB_TIMEOUT_MS = 90_000;
const WEBP_QUALITY = 82;

export type VariantResult = {
  written: string[];
  skipped: string[];
  error?: string;
};

// Which WebP encoder build this server uses: "simd" where it is available
// and encodes faithfully, "plain" where the runtime has no SIMD, "broken"
// where it has SIMD but the SIMD build fails the round trip (the plain build
// is used, and copies written before this run are not trusted).
export type WebpEncoder = "simd" | "plain" | "broken";

type WorkerReply = {
  ok: boolean;
  written?: string[];
  skipped?: string[];
  encoder?: WebpEncoder;
  error?: string;
};

// The worker's program. CommonJS text evaluated by the worker: it reads the
// picture, decodes it by the format the main thread sniffed, resizes for
// each target and writes each WebP through a temp file and a rename, so a
// half-written variant is never served.
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");

if (typeof globalThis.ImageData === "undefined") {
  // The codecs return browser ImageData; Node has none.
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
      this.colorSpace = "srgb";
    }
  };
}

function requireFrom(bases) {
  for (const base of bases) {
    try {
      const req = createRequire(base);
      req.resolve("@jsquash/webp");
      return req;
    } catch {}
  }
  throw new Error("the WebP codecs are not installed beside this server");
}

const load = (dir, file) => import(pathToFileURL(path.join(dir, file)).href);
const wasm = (dir, file) => new WebAssembly.Module(fs.readFileSync(path.join(dir, file)));

// One encoder build by name, through its own glue: the package's encode.js
// picks the SIMD build whenever the runtime has SIMD, which is the build
// that scrambles pictures on some CPUs.
async function webpEncoder(dir, name, quality) {
  const glue = await load(dir, "codec/enc/" + name + ".js");
  const { defaultOptions } = await load(dir, "meta.js");
  const module = wasm(dir, "codec/enc/" + name + ".wasm");
  const codec = await glue.default({
    noInitialRun: true,
    instantiateWasm: (imports, callback) => {
      const instance = new WebAssembly.Instance(module, imports);
      callback(instance);
      return instance.exports;
    },
  });
  const options = { ...defaultOptions, quality };
  return (picture) => {
    const result = codec.encode(picture.data, picture.width, picture.height, options);
    if (!result) throw new Error("the WebP encoder returned nothing");
    return result.buffer;
  };
}

// A faithful encode of the test picture at quality 82 is off by under 2 per
// channel on average; the scrambling SIMD build measured 67 to 81 (#1124).
const MAX_ROUND_TRIP_ERROR = 16;

async function probeEncoder(req, dir, quality) {
  const { simd } = req("wasm-feature-detect");
  if (!(await simd())) {
    return "plain";
  }
  const encode = await webpEncoder(dir, "webp_enc_simd", quality);
  const decoder = await load(dir, "decode.js");
  await decoder.init(wasm(dir, "codec/dec/webp_dec.wasm"));
  // Smooth ramps with ripples, the size the bad build was caught at.
  const size = 256;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = (x * 255) / size;
      data[i + 1] = (y * 255) / size;
      data[i + 2] = 128 + 100 * Math.sin(x / 9) * Math.cos(y / 7);
      data[i + 3] = 255;
    }
  }
  const back = (await decoder.default(encode(new ImageData(data, size, size)))).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += Math.abs(back[i] - data[i]) + Math.abs(back[i + 1] - data[i + 1]) + Math.abs(back[i + 2] - data[i + 2]);
  }
  return sum / ((data.length / 4) * 3) <= MAX_ROUND_TRIP_ERROR ? "simd" : "broken";
}

async function main() {
  const { probe, source, format, targets, quality, simd, bases } = workerData;
  const req = requireFrom(bases);
  const packageDir = (name) => path.dirname(req.resolve(name));
  const webpDir = packageDir("@jsquash/webp");
  if (probe) {
    return { encoder: await probeEncoder(req, webpDir, quality) };
  }

  const bytes = fs.readFileSync(source);
  let image;
  if (format === "png") {
    const dir = packageDir("@jsquash/png");
    const decoder = await load(dir, "decode.js");
    await decoder.init(wasm(dir, "codec/pkg/squoosh_png_bg.wasm"));
    image = await decoder.default(bytes);
  } else if (format === "jpeg") {
    const dir = packageDir("@jsquash/jpeg");
    const decoder = await load(dir, "decode.js");
    await decoder.init(wasm(dir, "codec/dec/mozjpeg_dec.wasm"));
    image = await decoder.default(bytes);
  } else if (format === "webp") {
    const decoder = await load(webpDir, "decode.js");
    await decoder.init(wasm(webpDir, "codec/dec/webp_dec.wasm"));
    image = await decoder.default(bytes);
  } else {
    throw new Error("unsupported format " + format);
  }

  const resizeDir = packageDir("@jsquash/resize");
  const resizer = await load(resizeDir, "index.js");
  await resizer.initResize(wasm(resizeDir, "lib/resize/pkg/squoosh_resize_bg.wasm"));
  const encode = await webpEncoder(webpDir, simd ? "webp_enc_simd" : "webp_enc", quality);

  const longEdge = Math.max(image.width, image.height);
  const written = [];
  const skipped = [];
  for (const target of targets) {
    const scale = Math.min(1, target.width / longEdge);
    if (scale === 1 && format === "webp") {
      // Already WebP and no smaller than asked: the original is the variant.
      skipped.push(target.file);
      continue;
    }
    let picture = image;
    if (scale < 1) {
      picture = await resizer.default(image, {
        width: Math.max(1, Math.round(image.width * scale)),
        height: Math.max(1, Math.round(image.height * scale)),
        method: "lanczos3",
        premultiply: true,
        linearRGB: false,
      });
    }
    const encoded = encode(picture);
    if (scale === 1 && encoded.byteLength >= bytes.length) {
      // Same size and no fewer bytes (a flat PNG, a tight JPEG): the
      // original serves better than a copy would.
      skipped.push(target.file);
      continue;
    }
    const temp = target.file + ".tmp-" + process.pid;
    fs.writeFileSync(temp, Buffer.from(encoded));
    fs.renameSync(temp, target.file);
    written.push(target.file);
  }
  return { written, skipped };
}

main().then(
  (result) => parentPort.postMessage({ ok: true, ...result }),
  (error) => parentPort.postMessage({ ok: false, error: String((error && error.message) || error) }),
);
`;

function resolutionBases(): string[] {
  const bases = [path.join(process.cwd(), "package.json")];
  try {
    // The bundled server's own location, for a process started elsewhere.
    bases.push(import.meta.url);
  } catch {
    // Not every runtime exposes it; the working directory is enough then.
  }
  return bases;
}

// Runs the worker program once and hands back its reply; never rejects.
function runWorker(job: Record<string, unknown>): Promise<WorkerReply> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const finish = (result: WorkerReply) => {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(result);
      }
    };
    let worker: Worker;
    try {
      worker = new Worker(WORKER_SOURCE, {
        eval: true,
        // Not the parent's flags: an inspector or a loader hook would refuse.
        execArgv: [],
        workerData: { ...job, quality: WEBP_QUALITY, bases: resolutionBases() },
      });
    } catch (error) {
      finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    timer = setTimeout(() => {
      void worker.terminate();
      finish({ ok: false, error: "timed out" });
    }, JOB_TIMEOUT_MS);
    worker.on("message", (message: WorkerReply) => finish(message));
    worker.on("error", (error) => finish({ ok: false, error: error.message }));
    worker.on("exit", (code) => {
      if (code !== 0) {
        finish({ ok: false, error: `worker exited with ${code}` });
      }
    });
  });
}

// The encoder check, once per run of the server. A check that could not run
// (the worker would not start) is tried again by the next job, which uses
// the plain build meanwhile: slower, never wrong.
let encoderCheck: Promise<WebpEncoder> | undefined;
let brokenSince = 0;

export function webpEncoderChoice(): Promise<WebpEncoder> {
  encoderCheck ??= runWorker({ probe: true }).then((reply) => {
    if (!reply.ok || !reply.encoder) {
      encoderCheck = undefined;
      return "plain";
    }
    if (reply.encoder === "broken") {
      // Before any job of this run writes a copy, so every copy older than
      // this came from the SIMD build.
      brokenSince = Date.now();
      console.warn("[image-variants] this CPU's SIMD WebP encoder scrambles pictures; using the plain encoder");
    }
    return reply.encoder;
  });
  return encoderCheck;
}

// Writes the variants of one picture that do not exist yet. Idempotent: a
// second call over the same file writes nothing. Awaitable for the backfill
// script and the tests; the server calls scheduleImageVariants instead.
export async function writeImageVariants(
  source: string,
  widths: readonly VariantWidth[] = VARIANT_WIDTHS,
): Promise<VariantResult> {
  let bytes: Buffer;
  try {
    bytes = await readFile(source);
  } catch (error) {
    return { written: [], skipped: [], error: error instanceof Error ? error.message : String(error) };
  }
  const kind = sniffImage(bytes);
  if (!kind) {
    return { written: [], skipped: [], error: "not a PNG, JPEG or WebP" };
  }
  // The worker decodes the whole picture before it can shrink it, and its
  // memory is the server's. A picture whose header declares too many pixels,
  // or hides how many, is left as the original the routes already serve.
  const budget = pixelBudget(bytes);
  if (budget !== "ok") {
    return {
      written: [],
      skipped: [],
      error: budget === "over" ? "too many pixels to make smaller copies of" : "its size could not be read from the header",
    };
  }
  const dir = path.dirname(source);
  const name = path.basename(source);
  const { width, height } = imageSize(bytes);
  const longEdge = Math.max(width, height);
  const targets: Array<{ width: number; file: string }> = [];
  const skipped: string[] = [];
  for (const target of widths) {
    const file = path.join(dir, variantFileName(name, target));
    if (existsSync(file)) {
      skipped.push(file);
    } else if (kind.format === "webp" && longEdge > 0 && longEdge <= target) {
      // Cheap header check of the rule the worker applies too.
      skipped.push(file);
    } else {
      targets.push({ width: target, file });
    }
  }
  if (!targets.length) {
    return { written: [], skipped };
  }
  const simd = (await webpEncoderChoice()) === "simd";
  const reply = await runWorker({ source, format: kind.format, targets, simd });
  if (!reply.ok) {
    return { written: [], skipped: [], error: reply.error ?? "failed" };
  }
  return { written: reply.written ?? [], skipped: [...skipped, ...(reply.skipped ?? [])] };
}

// One job at a time, keyed by the original's absolute path, so a burst of
// saves cannot spawn a worker each and the serve route can wait for the
// copy it was asked for.
const pending = new Map<string, Promise<VariantResult>>();
let chain: Promise<unknown> = Promise.resolve();

function enqueue(source: string): Promise<VariantResult> {
  const existing = pending.get(source);
  if (existing) {
    return existing;
  }
  const job = chain.then(() => writeImageVariants(source)).finally(() => {
    pending.delete(source);
  });
  chain = job.catch(() => undefined);
  pending.set(source, job);
  return job;
}

// Fire and forget from the save path. The job starts on the next turn of
// the event loop, after the caller has returned its response.
export function scheduleImageVariants(source: string): void {
  setImmediate(() => {
    void enqueue(source)
      .then((result) => {
        if (result.error) {
          console.warn(`[image-variants] ${path.basename(source)}: ${result.error}`);
        }
      })
      .catch((error) => {
        console.warn(`[image-variants] ${path.basename(source)}: ${error instanceof Error ? error.message : String(error)}`);
      });
  });
}

// Resolves once every job scheduled so far has finished, so a test can
// delete the folder its pictures were saved in without a job still reading.
export async function imageVariantsSettled(): Promise<void> {
  while (checking.size > 0) {
    await Promise.all(checking);
  }
  await new Promise((resolve) => setImmediate(resolve));
  while (pending.size > 0) {
    await chain;
  }
}

// A picture asked for in a size it has no copy of gets its copies made, so
// the next ask is answered with the small one. Pictures saved before the
// copies existed, brought in inside a bundle, or copied into the folder by
// a path that scheduled none stayed whole for good otherwise: a 3 MB
// portrait sent to every 40 pixel token.
//
// Each original is tried once per run of the server, so one that can have
// no copy (too many pixels, not a picture after all) is not read again on
// every request. Only a picture that really lives in its folder is read: a
// link out of it (one a restored backup carried in, say) is refused here as
// src/lib/serve-file.ts refuses to serve it, or its copy would be a way to
// read the file it points at.
const PICTURE = /\.(?:png|jpe?g|webp)$/i;
const TRIED_MAX = 20_000;
const tried = new Set<string>();
const checking = new Set<Promise<void>>();

function makeMissingVariants(root: string, original: string): void {
  if (tried.has(original) || !PICTURE.test(original) || isVariantFileName(path.basename(original))) {
    return;
  }
  if (tried.size >= TRIED_MAX) {
    tried.clear();
  }
  tried.add(original);
  const check: Promise<void> = Promise.all([realpath(root), realpath(original)])
    .then(([realRoot, real]) => {
      if (real.startsWith(realRoot + path.sep)) {
        scheduleImageVariants(original);
      }
    })
    .catch(() => undefined)
    .finally(() => {
      checking.delete(check);
    });
  checking.add(check);
}

// Where the SIMD build scrambles pictures, the copies an earlier version
// wrote with it are scrambled too. A marker in each picture folder records
// when this server first wrote with the plain build there; a copy older than
// that is deleted when asked for and made again. Elsewhere nothing is read.
const SCRAMBLED_MARKER = ".webp-copies-scrambled-before";
const scrambledCutoffs = new Map<string, Promise<number>>();

async function readCutoff(root: string): Promise<number> {
  const marker = path.join(root, SCRAMBLED_MARKER);
  try {
    const recorded = Number((await readFile(marker, "utf8")).trim());
    if (Number.isFinite(recorded) && recorded > 0) {
      return recorded;
    }
  } catch {
    // first run with the plain build in this folder
  }
  await writeFile(marker, String(brokenSince)).catch(() => undefined);
  return brokenSince;
}

async function scrambledCopy(root: string, modifiedMs: number): Promise<boolean> {
  if ((await webpEncoderChoice()) !== "broken") {
    return false;
  }
  let cutoff = scrambledCutoffs.get(root);
  if (!cutoff) {
    cutoff = readCutoff(root);
    scrambledCutoffs.set(root, cutoff);
  }
  return modifiedMs < (await cutoff);
}

// The segments a serve route should stream for a ?w= request: the variant's
// when it exists (waiting briefly for one that is being written right now,
// as happens when a client asks the moment the picture lands), else the
// original's, whose copies are then made for the next ask. The variant is always a sibling in the same folder; segments
// that would leave the root are handed back untouched for serve-file to
// refuse the way it always has.
export async function servedSegments(
  rootDir: string,
  segments: string[],
  width: VariantWidth,
  waitMs = 4000,
): Promise<string[]> {
  const name = segments[segments.length - 1];
  if (!name || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return segments;
  }
  const root = path.join(/*turbopackIgnore: true*/ process.cwd(), "public", rootDir);
  const original = path.resolve(root, ...segments);
  if (!original.startsWith(root + path.sep)) {
    return segments;
  }
  const inFlight = pending.get(original);
  if (inFlight) {
    await Promise.race([inFlight, new Promise((resolve) => setTimeout(resolve, waitMs))]);
  }
  const variant = [...segments.slice(0, -1), variantFileName(name, width)];
  const variantPath = path.resolve(root, ...variant);
  try {
    const info = await stat(variantPath);
    if (info.isFile()) {
      if (!(await scrambledCopy(root, info.mtimeMs))) {
        return variant;
      }
      await rm(variantPath, { force: true });
      // Made again even if its other size was made this run.
      tried.delete(original);
    }
  } catch {
    // no copy in that size
  }
  makeMissingVariants(root, original);
  return segments;
}
