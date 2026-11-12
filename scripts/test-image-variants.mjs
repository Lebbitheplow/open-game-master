// Smaller copies of generated and uploaded pictures: how a consumer asks
// for one (variantUrl), how the serve route reads the ask (variantWidth),
// how the sibling is named, how the route picks the file to stream
// without leaving its root, and that the WASM writer really writes them
// under plain Node, once, and never for a name it did not make.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire, register, syncBuiltinESMExports } from "node:module";
import zlib from "node:zlib";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";
import { staticImports } from "./lib/static-imports.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { imageSize, isVariantFileName, pixelBudget, sniffImage, variantFileName, variantUrl, variantWidth } = await import(
  "../src/lib/image-format.ts"
);
const { servedSegments, writeImageVariants } = await import("../src/lib/image-variants.ts");
const { imageVariantsSettled, scheduleImageVariants } = await import("../src/lib/image-variants.ts");
const workerThreads = createRequire(import.meta.url)("node:worker_threads");
const realWorker = workerThreads.Worker;
const fsPromises = createRequire(import.meta.url)("node:fs/promises");
const realReadFile = fsPromises.readFile;

const repo = path.resolve(import.meta.dirname, "..");
const samplePng = path.join(repo, "public", "assets", "themes", "default", "diffuse-dark.png");

// A PNG of random RGBA noise: incompressible, so it weighs what a piece of
// scene art weighs and every WebP copy comes out smaller.
function noisePng(width, height) {
  const crc = (bytes) => {
    let value = ~0;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
      }
    }
    return (~value) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.concat([Buffer.from([0]), randomBytes(width * 4)]));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
}

await test("variantUrl adds ?w= only to the server's own pictures", () => {
  assert.equal(variantUrl("/generated/a.png", 256), "/generated/a.png?w=256");
  assert.equal(variantUrl("/uploads/b.jpg", 1024), "/uploads/b.jpg?w=1024");
  assert.equal(variantUrl("/generated/a.png?w=256", 1024), "/generated/a.png?w=256");
  assert.equal(variantUrl("/generated/a.png#x", 256), "/generated/a.png#x");
  for (const src of [
    "/assets/placeholders/x.webp",
    "data:image/png;base64,AAAA",
    "blob:https://localhost/1234",
    "https://example.com/generated/a.png",
    "generated/a.png",
    "",
  ]) {
    assert.equal(variantUrl(src, 256), src);
  }
});

await test("variantWidth accepts the two sizes the server writes and nothing else", () => {
  assert.equal(variantWidth("256"), 256);
  assert.equal(variantWidth("1024"), 1024);
  for (const value of ["512", "0", "-256", "abc", "", null, undefined, "256px", "1e3"]) {
    assert.equal(variantWidth(value), null, `w=${value}`);
  }
});

await test("variant names are the stem plus .w<size>.webp, and recognisable", () => {
  assert.equal(variantFileName("a.png", 256), "a.w256.webp");
  assert.equal(variantFileName("1789851467166-openai-map.png", 1024), "1789851467166-openai-map.w1024.webp");
  assert.equal(variantFileName("photo.JPEG", 256), "photo.w256.webp");
  assert.equal(variantFileName("noext", 256), "noext.w256.webp");
  assert.ok(isVariantFileName("a.w256.webp"));
  assert.ok(isVariantFileName("a.w1024.webp"));
  assert.ok(!isVariantFileName("a.webp"));
  assert.ok(!isVariantFileName("a.w512.webp"));
  assert.ok(!isVariantFileName("a.w256.png"));
});

await test("sniffImage and imageSize read PNG, JPEG and every WebP header shape", () => {
  const png = fs.readFileSync(samplePng);
  assert.equal(sniffImage(png)?.format, "png");
  assert.deepEqual(imageSize(png), { width: 1024, height: 1024 });
  assert.equal(sniffImage(Buffer.from("<svg onload=alert(1)>")), null);
  // A VP8L (lossless) header: 3x2 pixels.
  const lossless = Buffer.alloc(30);
  lossless.write("RIFF", 0, "ascii");
  lossless.write("WEBP", 8, "ascii");
  lossless.write("VP8L", 12, "ascii");
  lossless[20] = 0x2f;
  lossless.writeUInt32LE((3 - 1) | ((2 - 1) << 14), 21);
  assert.equal(sniffImage(lossless)?.format, "webp");
  assert.deepEqual(imageSize(lossless), { width: 3, height: 2 });
});

// A small file whose header declares a huge picture: the IHDR of a 1x1 PNG
// rewritten, which is all a decoder reads before it allocates.
function declaredPng(width, height) {
  const png = Buffer.from(noisePng(1, 1));
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

await test("a picture's pixel count is read from its header, before anything decodes it", () => {
  assert.equal(pixelBudget(noisePng(4, 4)), "ok");
  assert.equal(pixelBudget(declaredPng(8000, 8000)), "ok");
  assert.equal(pixelBudget(declaredPng(8001, 8000)), "over");
  assert.equal(pixelBudget(declaredPng(30000, 30000)), "over");
  assert.equal(pixelBudget(Buffer.from("not a picture at all")), "unknown");
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-image-variants-"));
try {
  const generated = path.join(dir, "public", "generated");
  fs.mkdirSync(generated, { recursive: true });
  const original = path.join(generated, "sample.png");
  const noise = noisePng(1024, 768);
  fs.writeFileSync(original, noise);
  assert.deepEqual(imageSize(noise), { width: 1024, height: 768 });

  await test("a picture that declares too many pixels is never handed to the decoder", async () => {
    const bomb = path.join(generated, "bomb.png");
    fs.writeFileSync(bomb, declaredPng(30000, 30000));
    const result = await writeImageVariants(bomb);
    assert.match(result.error ?? "", /too many pixels/);
    assert.deepEqual(result.written, []);
    assert.deepEqual(fs.readdirSync(generated).filter((name) => name.startsWith("bomb.")), ["bomb.png"]);
  });

  await test("the worker writes both WebP copies of a PNG, sized to the long edge", async () => {
    const first = await writeImageVariants(original);
    assert.equal(first.error, undefined);
    assert.deepEqual(first.written.map((file) => path.basename(file)).sort(), ["sample.w1024.webp", "sample.w256.webp"]);
    const small = fs.readFileSync(path.join(generated, "sample.w256.webp"));
    const large = fs.readFileSync(path.join(generated, "sample.w1024.webp"));
    assert.equal(sniffImage(small)?.format, "webp");
    assert.equal(sniffImage(large)?.format, "webp");
    assert.deepEqual(imageSize(small), { width: 256, height: 192 });
    // The sample is exactly 1024 wide, so the 1024 copy is a re-encode, not a resize.
    assert.deepEqual(imageSize(large), { width: 1024, height: 768 });
    assert.ok(small.length < large.length);
    assert.ok(large.length < noise.length);
    assert.ok(!fs.existsSync(path.join(generated, "sample.w256.webp.tmp-" + process.pid)));
  });

  await test("a same-size copy that would weigh more than the original is not written", async () => {
    // A flat 1024 px PNG (19 KB) encodes to a larger WebP: only the 256 copy is worth having.
    const flat = path.join(generated, "flat.png");
    fs.copyFileSync(samplePng, flat);
    const result = await writeImageVariants(flat);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.written.map((file) => path.basename(file)), ["flat.w256.webp"]);
    assert.ok(!fs.existsSync(path.join(generated, "flat.w1024.webp")));
  });

  await test("a second pass writes nothing: the backfill can run any number of times", async () => {
    const before = fs.statSync(path.join(generated, "sample.w256.webp")).mtimeMs;
    const again = await writeImageVariants(original);
    assert.deepEqual(again.written, []);
    assert.equal(again.skipped.length, 2);
    assert.equal(fs.statSync(path.join(generated, "sample.w256.webp")).mtimeMs, before);
  });

  await test("a WebP original only gets the copies that are smaller than it", async () => {
    // 1024 px WebP (what a harness picture may be): a 256 copy, no 1024 one.
    const big = path.join(generated, "big.webp");
    fs.copyFileSync(path.join(generated, "sample.w1024.webp"), big);
    const result = await writeImageVariants(big);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.written.map((file) => path.basename(file)), ["big.w256.webp"]);
    assert.deepEqual(imageSize(fs.readFileSync(path.join(generated, "big.w256.webp"))), { width: 256, height: 192 });
    assert.ok(!fs.existsSync(path.join(generated, "big.w1024.webp")));
    // 256 px WebP: nothing to write at all, and no worker is needed to know.
    const tiny = path.join(generated, "tiny.webp");
    fs.copyFileSync(path.join(generated, "sample.w256.webp"), tiny);
    const none = await writeImageVariants(tiny);
    assert.deepEqual(none, { written: [], skipped: [path.join(generated, "tiny.w256.webp"), path.join(generated, "tiny.w1024.webp")] });
  });

  await test("something that is not a picture is refused without a worker", async () => {
    const junk = path.join(generated, "junk.png");
    fs.writeFileSync(junk, "<svg onload=alert(1)>");
    const result = await writeImageVariants(junk);
    assert.match(result.error, /not a PNG/);
    assert.deepEqual(result.written, []);
    const missing = await writeImageVariants(path.join(generated, "nope.png"));
    assert.ok(missing.error);
  });

  await test("worker startup failure is nonfatal and the next image still gets its copies", async () => {
    const startupOriginal = path.join(generated, "startup.png");
    fs.copyFileSync(samplePng, startupOriginal);
    workerThreads.Worker = class Worker {
      constructor() { throw new Error("injected worker startup failure"); }
    };
    syncBuiltinESMExports();
    const unhandled = [];
    const onUnhandled = (error) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    try {
      const result = await writeImageVariants(startupOriginal);
      assert.deepEqual(result, { written: [], skipped: [], error: "injected worker startup failure" });
      assert.ok(fs.existsSync(startupOriginal));
      assert.ok(!fs.existsSync(path.join(generated, "startup.w256.webp")));
      scheduleImageVariants(startupOriginal);
      await imageVariantsSettled();
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(unhandled, []);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      workerThreads.Worker = realWorker;
      syncBuiltinESMExports();
    }
    const next = await writeImageVariants(startupOriginal);
    assert.equal(next.error, undefined);
    assert.ok(fs.existsSync(path.join(generated, "startup.w256.webp")));
    assert.ok(fs.existsSync(startupOriginal));
  });

  await test("worker error, exit and timeout return errors without removing originals", async () => {
    const runInjected = async (name, WorkerClass) => {
      const source = path.join(generated, `${name}.png`);
      fs.copyFileSync(samplePng, source);
      workerThreads.Worker = WorkerClass;
      syncBuiltinESMExports();
      try {
        const result = await writeImageVariants(source);
        assert.deepEqual(result.written, []);
        assert.ok(fs.existsSync(source));
        return result.error;
      } finally {
        workerThreads.Worker = realWorker;
        syncBuiltinESMExports();
      }
    };
    class ErrorWorker extends EventEmitter {
      constructor() {
        super();
        setImmediate(() => this.emit("error", new Error("injected worker error")));
      }
    }
    class ExitWorker extends EventEmitter {
      constructor() {
        super();
        setImmediate(() => this.emit("exit", 17));
      }
    }
    class TimeoutWorker extends EventEmitter {
      terminate() { return Promise.resolve(0); }
    }
    assert.equal(await runInjected("worker-error", ErrorWorker), "injected worker error");
    assert.equal(await runInjected("worker-exit", ExitWorker), "worker exited with 17");
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (callback, delay, ...args) =>
      realSetTimeout(callback, delay === 90_000 ? 0 : delay, ...args);
    try {
      assert.equal(await runInjected("worker-timeout", TimeoutWorker), "timed out");
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  await test("an unexpected queued rejection is logged and does not become unhandled", async () => {
    const source = path.join(generated, "queued-rejection.png");
    fs.copyFileSync(samplePng, source);
    fsPromises.readFile = async (file, ...args) =>
      file === source ? undefined : realReadFile(file, ...args);
    syncBuiltinESMExports();
    const unhandled = [];
    const warnings = [];
    const onUnhandled = (error) => unhandled.push(error);
    const realWarn = console.warn;
    process.on("unhandledRejection", onUnhandled);
    console.warn = (message) => warnings.push(message);
    try {
      scheduleImageVariants(source);
      await imageVariantsSettled();
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(unhandled, []);
      assert.ok(warnings.some((message) => message.includes("queued-rejection.png")));
      assert.ok(fs.existsSync(source));
    } finally {
      console.warn = realWarn;
      process.off("unhandledRejection", onUnhandled);
      fsPromises.readFile = realReadFile;
      syncBuiltinESMExports();
    }
    const next = await writeImageVariants(source);
    assert.equal(next.error, undefined);
  });

  // servedSegments reads under process.cwd()/public like the routes do.
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    await test("the route serves the variant when it exists and the original when not", async () => {
      assert.deepEqual(await servedSegments("generated", ["sample.png"], 256), ["sample.w256.webp"]);
      assert.deepEqual(await servedSegments("generated", ["sample.png"], 1024), ["sample.w1024.webp"]);
      assert.deepEqual(await servedSegments("generated", ["big.webp"], 256), ["big.w256.webp"]);
      assert.deepEqual(await servedSegments("generated", ["big.webp"], 1024), ["big.webp"]);
      assert.deepEqual(await servedSegments("generated", ["tiny.webp"], 256), ["tiny.webp"]);
      assert.deepEqual(await servedSegments("generated", ["tiny.webp"], 1024), ["tiny.webp"]);
      assert.deepEqual(await servedSegments("generated", ["junk.png"], 256), ["junk.png"]);
      assert.deepEqual(await servedSegments("uploads", ["sample.png"], 256), ["sample.png"]);
    });

    await test("segments that would leave the root come back untouched for serve-file to refuse", async () => {
      fs.mkdirSync(path.join(dir, "public", "secret"));
      fs.writeFileSync(path.join(dir, "public", "secret", "key.w256.webp"), "x");
      for (const segments of [
        ["..", "secret", "key.png"],
        ["generated", "..", "..", "secret", "key.png"],
        [".", "sample.png"],
        [""],
        [],
      ]) {
        assert.deepEqual(await servedSegments("generated", segments, 256), segments);
      }
      // A nested name resolves to a sibling in the same folder, never elsewhere.
      fs.mkdirSync(path.join(generated, "deep"));
      fs.copyFileSync(original, path.join(generated, "deep", "x.png"));
      assert.deepEqual(await servedSegments("generated", ["deep", "x.png"], 256), ["deep", "x.png"]);
      fs.copyFileSync(path.join(generated, "sample.w256.webp"), path.join(generated, "deep", "x.w256.webp"));
      assert.deepEqual(await servedSegments("generated", ["deep", "x.png"], 256), ["deep", "x.w256.webp"]);
    });

    const uploads = path.join(dir, "public", "uploads");
    fs.mkdirSync(uploads, { recursive: true });

    await test("a picture asked for in a size it has no copy of goes out whole once, and its copies are there for the next ask", async () => {
      // A portrait saved before the copies existed, or brought in by a bundle.
      fs.copyFileSync(original, path.join(uploads, "portrait.png"));
      assert.deepEqual(await servedSegments("uploads", ["portrait.png"], 256), ["portrait.png"]);
      await imageVariantsSettled();
      assert.deepEqual(await servedSegments("uploads", ["portrait.png"], 256), ["portrait.w256.webp"]);
      assert.deepEqual(await servedSegments("uploads", ["portrait.png"], 1024), ["portrait.w1024.webp"]);
      assert.equal(sniffImage(fs.readFileSync(path.join(uploads, "portrait.w256.webp")))?.format, "webp");
      assert.ok(fs.statSync(path.join(uploads, "portrait.w256.webp")).size < fs.statSync(path.join(uploads, "portrait.png")).size);
    });

    await test("a copy gets no copies of its own, a file that is no picture is read once, and a document is never read", async () => {
      assert.deepEqual(await servedSegments("uploads", ["portrait.w1024.webp"], 256), ["portrait.w1024.webp"]);
      fs.writeFileSync(path.join(uploads, "notes.png"), "not a picture");
      fs.writeFileSync(path.join(uploads, "book.pdf"), "%PDF-1.4 not a picture either");
      const read = [];
      fsPromises.readFile = (file, ...args) => {
        read.push(path.basename(String(file)));
        return realReadFile(file, ...args);
      };
      syncBuiltinESMExports();
      const realWarn = console.warn;
      console.warn = () => {};
      try {
        for (let ask = 0; ask < 3; ask += 1) {
          assert.deepEqual(await servedSegments("uploads", ["notes.png"], 256), ["notes.png"]);
          assert.deepEqual(await servedSegments("uploads", ["book.pdf"], 256), ["book.pdf"]);
          assert.deepEqual(await servedSegments("uploads", ["gone.png"], 256), ["gone.png"]);
          await imageVariantsSettled();
        }
      } finally {
        console.warn = realWarn;
        fsPromises.readFile = realReadFile;
        syncBuiltinESMExports();
      }
      assert.deepEqual(read, ["notes.png"], "what was read to make copies");
      assert.deepEqual(
        fs.readdirSync(uploads).sort(),
        ["book.pdf", "notes.png", "portrait.png", "portrait.w1024.webp", "portrait.w256.webp"],
        "nothing but the portrait's two copies was written",
      );
    });

    if (process.platform !== "win32") {
      await test("a link that points out of the folder is not read to make copies of what it points at", async () => {
        const outside = path.join(dir, "outside.png");
        fs.copyFileSync(original, outside);
        fs.symlinkSync(outside, path.join(uploads, "link.png"));
        assert.deepEqual(await servedSegments("uploads", ["link.png"], 256), ["link.png"]);
        await imageVariantsSettled();
        assert.equal(fs.existsSync(path.join(uploads, "link.w256.webp")), false, "a copy of the file outside was written into the folder");
        assert.equal(fs.existsSync(path.join(dir, "outside.w256.webp")), false);
        // A link to a picture inside the folder is that picture.
        fs.symlinkSync(path.join(uploads, "portrait.png"), path.join(uploads, "alias.png"));
        assert.deepEqual(await servedSegments("uploads", ["alias.png"], 256), ["alias.png"]);
        await imageVariantsSettled();
        assert.deepEqual(await servedSegments("uploads", ["alias.png"], 256), ["alias.w256.webp"]);
      });
    }
  } finally {
    // The asks above started work of their own; it ends before the folder goes.
    await imageVariantsSettled();
    process.chdir(cwd);
  }
} finally {
  removeTempDir(dir);
}

// The table view's first load (the pages' own static imports, from the page
// down through "@/" and relative paths) never reaches image-format.ts: its
// byte-reading half uses Buffer, and a page that imports it carries Next's
// Buffer polyfill, about 7 KiB gzip. Pages ask for a copy's address from
// image-variant-url.ts. The native board client (an addon's board view in the
// apps) imported it, and the table page took the polyfill with it.
{
  const reached = staticImports("app/campaigns/[campaignId]/table/page.tsx");
  assert.ok(reached.size > 100, `the walk reads the table page's imports (${reached.size} files)`);
  assert.ok(!reached.has("lib/image-format.ts"), "the table page imports image-format.ts (Buffer); import variantUrl from image-variant-url.ts");
  passed += 1;
}

console.log(`image variants: ${passed} tests passed`);
