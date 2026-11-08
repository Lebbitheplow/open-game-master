// Reads a PDF in Node the way the page's reader does (src/lib/pdf-import/
// read-pdf.ts), through the same pure page walk, so the suites test the
// reading a browser would send. pdf.js's legacy build runs on Node without
// a canvas; a picture's fingerprint is taken from its raw pixels here, where
// the page draws it onto a canvas.
//
// Callers register the alias loader first (scripts/lib/register-alias.mjs).

import { readFileSync } from "node:fs";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function readPdfInNode(fileOrBytes, { fileName = "book.pdf", maxPages = Infinity } = {}) {
  const { readPageFrom } = await import("../../src/lib/pdf-import/page-read-logic.ts");
  const { fontStyle } = await import("../../src/lib/pdf-import/reading.ts");
  const { averageHash, mapPagesOf } = await import("../../src/lib/pdf-import/picture-logic.ts");
  const data = typeof fileOrBytes === "string" ? new Uint8Array(readFileSync(fileOrBytes)) : new Uint8Array(fileOrBytes);
  const task = getDocument({ data, fontExtraProperties: true, isEvalSupported: false, verbosity: 0, useSystemFonts: false });
  const doc = await task.promise;
  const fonts = [];
  const fontIndex = new Map();
  const fontOf = (name) => {
    if (!fontIndex.has(name)) {
      fontIndex.set(name, fonts.length);
      fonts.push(fontStyle(name));
    }
    return fontIndex.get(name);
  };
  const outline = [];
  const walk = async (nodes, depth) => {
    for (const node of nodes ?? []) {
      try {
        const dest = typeof node.dest === "string" ? await doc.getDestination(node.dest) : node.dest;
        const target = Array.isArray(dest) ? dest[0] : null;
        const index = typeof target === "number" ? target : target ? await doc.getPageIndex(target) : -1;
        if (index >= 0 && node.title) outline.push({ title: node.title.trim(), page: index + 1, depth });
      } catch {
        // A broken bookmark is skipped, as the page skips it.
      }
      await walk(node.items, depth + 1);
    }
  };
  await walk(await doc.getOutline(), 0);
  const pages = [];
  const objects = new Map();
  const mapPages = mapPagesOf(outline);
  const count = Math.min(doc.numPages, maxPages);
  for (let n = 1; n <= count; n += 1) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();
    // Large pictures resolve after the operator list (read-pdf.ts picturesReady).
    const ids = new Set();
    ops.fnArray.forEach((fn, index) => {
      if (fn === OPS.paintImageXObject) ids.add(String(ops.argsArray[index][0]));
    });
    await Promise.all([...ids].map((objId) => new Promise((resolve) => (objId.startsWith("g_") ? page.commonObjs : page.objs).get(objId, resolve))));
    const content = await page.getTextContent();
    const imageOf = (objId) => {
      try {
        const store = objId.startsWith("g_") ? page.commonObjs : page.objs;
        return store.has(objId) ? store.get(objId) : null;
      } catch {
        return null;
      }
    };
    pages.push(
      readPageFrom({
        pageNumber: n,
        width: viewport.width,
        height: viewport.height,
        toPage: (x, y) => viewport.convertToViewportPoint(x, y),
        ops,
        codes: OPS,
        textItems: content.items.filter((item) => "str" in item),
        fontName: (id) => {
          try {
            if (page.commonObjs.has(id)) return page.commonObjs.get(id)?.name ?? id;
          } catch {
            // Falls through to the family.
          }
          return content.styles[id]?.fontFamily ?? id;
        },
        fontIndex: fontOf,
        image: imageOf,
        inlineImage: (args) => args,
        hash: (objId) => averageHash(shrink(imageOf(objId))),
        remember: (pictureId, objId, paint) => objects.set(pictureId, { page: n, objId, paint }),
        mapPage: mapPages.has(n),
      }),
    );
    page.cleanup();
  }
  const info = (await doc.getMetadata().catch(() => null))?.info ?? {};
  await task.destroy();
  return {
    fileName,
    title: typeof info.Title === "string" ? info.Title : "",
    pageCount: count,
    outline,
    fonts,
    pages,
    objects,
  };
}

// A picture's raw pixels sampled down to 8 x 8 RGBA, nearest neighbour.
function shrink(image) {
  if (!image?.data || !image.width || !image.height) return [];
  const out = [];
  const channels = image.kind === 3 ? 4 : image.kind === 2 ? 3 : 0;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const sx = Math.min(image.width - 1, Math.floor(((x + 0.5) * image.width) / 8));
      const sy = Math.min(image.height - 1, Math.floor(((y + 0.5) * image.height) / 8));
      if (channels) {
        const at = (sy * image.width + sx) * channels;
        out.push(image.data[at], image.data[at + 1], image.data[at + 2], 255);
      } else {
        const rowBytes = (image.width + 7) >> 3;
        const bit = (image.data[sy * rowBytes + (sx >> 3)] >> (7 - (sx & 7))) & 1;
        out.push(bit * 255, bit * 255, bit * 255, 255);
      }
    }
  }
  return out;
}
