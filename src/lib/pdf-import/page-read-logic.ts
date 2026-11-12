import { MAX_BOXES_PER_PAGE, MAX_IMAGES_PER_PAGE, MAX_RUN_CHARS, MAX_RUNS_PER_PAGE, type Box, type Picture, type ReadPage, type Run } from "./reading.ts";
import { emptyRegions, isDrawnPage, isScanPicture } from "./picture-logic.ts";

// One page of pdf.js output turned into reading.ts's page: the text runs in
// top-left page points, the tinted panels, and the pictures with where they
// sit. Pure (pdf.js's objects come in through `source`), so the page's
// reader (read-pdf.ts) and the tests (which run pdf.js in Node) walk a page
// the same way.

export type OpCodes = {
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  beginGroup: number;
  endGroup: number;
  setFillRGBColor: number;
  constructPath: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  fill: number;
  eoFill: number;
  fillStroke: number;
  eoFillStroke: number;
  closeFillStroke: number;
  closeEOFillStroke: number;
};

export type TextItem = { str: string; transform: number[]; width: number; fontName: string };
export type ImageInfo = { width: number; height: number };

export type PageSource = {
  pageNumber: number;
  width: number;
  height: number;
  // PDF user space to top-left page points (pdf.js's viewport).
  toPage: (x: number, y: number) => [number, number];
  ops: { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> };
  codes: OpCodes;
  textItems: TextItem[];
  // The font's real name for a pdf.js font id.
  fontName: (id: string) => string;
  // The font's index in the reading's table.
  fontIndex: (name: string) => number;
  // A painted picture by its pdf.js object id, or an inline one by its args.
  image: (objId: string) => ImageInfo | null;
  inlineImage: (args: unknown) => ImageInfo | null;
  // The picture's fingerprint (picture-logic.ts averageHash), by object id
  // or inline args.
  hash: (objId: string, args: unknown) => string;
  // Remembers which painted picture a picture id stands for, for the
  // drawing later: by its place among the page's picture paints, since
  // pdf.js names a page's pictures afresh each time it reads the page.
  remember: (pictureId: string, objId: string, paint: number) => void;
  // The book's bookmarks call this page a map (picture-logic.ts mapPagesOf).
  mapPage?: boolean;
};

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

const round = (value: number) => Math.round(value * 10) / 10;

const isMatrix = (value: unknown): value is Matrix =>
  Array.isArray(value) || ArrayBuffer.isView(value) ? (value as ArrayLike<number>).length === 6 : false;

export function readPageFrom(source: PageSource): ReadPage {
  const { codes, toPage } = source;
  const rectOf = (m: Matrix, x0: number, y0: number, x1: number, y1: number) => {
    const corners = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)].map(([x, y]) => toPage(x, y));
    const xs = corners.map((point) => point[0]);
    const ys = corners.map((point) => point[1]);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { x: round(left), y: round(top), w: round(Math.max(...xs) - left), h: round(Math.max(...ys) - top) };
  };
  const fillOps = new Set([codes.fill, codes.eoFill, codes.fillStroke, codes.eoFillStroke, codes.closeFillStroke, codes.closeEOFillStroke]);
  const stack: Array<{ ctm: Matrix; fill: string }> = [];
  let ctm: Matrix = IDENTITY;
  let fill = "#000000";
  let paths = 0;
  const boxes: Box[] = [];
  const pictures: Picture[] = [];
  const placed = new Set<string>();
  const push = () => stack.push({ ctm, fill });
  const pop = () => {
    const top = stack.pop();
    ctm = top?.ctm ?? IDENTITY;
    fill = top?.fill ?? fill;
  };

  const { fnArray, argsArray } = source.ops;
  let paints = -1;
  for (let index = 0; index < fnArray.length; index += 1) {
    const fn = fnArray[index];
    const args = (argsArray[index] ?? []) as unknown[];
    if (fn === codes.save) push();
    else if (fn === codes.restore) pop();
    else if (fn === codes.transform) {
      if (isMatrix(args)) ctm = multiply(ctm, Array.from(args as ArrayLike<number>) as Matrix);
    } else if (fn === codes.paintFormXObjectBegin || fn === codes.beginGroup) {
      push();
      const matrix = fn === codes.beginGroup ? (args[0] as { matrix?: unknown } | undefined)?.matrix : args[0];
      if (isMatrix(matrix)) ctm = multiply(ctm, Array.from(matrix as ArrayLike<number>) as Matrix);
    } else if (fn === codes.paintFormXObjectEnd || fn === codes.endGroup) pop();
    else if (fn === codes.setFillRGBColor) {
      if (typeof args[0] === "string") fill = args[0];
    } else if (fn === codes.constructPath) {
      paths += 1;
      const minMax = args[2] as ArrayLike<number> | null | undefined;
      if (fillOps.has(args[0] as number) && minMax && minMax.length >= 4 && boxes.length < MAX_BOXES_PER_PAGE && /^#[0-9a-f]{6}$/i.test(fill)) {
        const rect = rectOf(ctm, minMax[0], minMax[1], minMax[2], minMax[3]);
        // A hairline or a dot is a rule or a bullet, not a panel.
        if (rect.w >= 20 && rect.h >= 12) boxes.push({ ...rect, c: fill.toLowerCase() });
      }
    } else if (fn === codes.paintImageXObject || fn === codes.paintInlineImageXObject) {
      if (fn === codes.paintImageXObject) paints += 1;
      if (pictures.length >= MAX_IMAGES_PER_PAGE) continue;
      const inline = fn === codes.paintInlineImageXObject;
      const objId = inline ? "" : String(args[0]);
      const info = inline ? source.inlineImage(args[0]) : source.image(objId);
      if (!info?.width || !info?.height) continue;
      const rect = rectOf(ctm, 0, 0, 1, 1);
      // Specks, rules and dingbats.
      if (info.width < 48 || info.height < 48 || rect.w < 24 || rect.h < 24) continue;
      // The same picture drawn twice in one place (a clipped tile) is one.
      const key = `${objId}:${rect.x}:${rect.y}`;
      if (objId && placed.has(key)) continue;
      placed.add(key);
      // An inline picture has no object to draw again later, so only
      // painted ones are offered for upload.
      if (inline) continue;
      const id = `p${source.pageNumber}i${pictures.length}`;
      pictures.push({ id, ...rect, pw: info.width, ph: info.height, hash: source.hash(objId, args[0]), drawn: false, scan: false });
      source.remember(id, objId, paints);
    }
  }

  const runs: Run[] = [];
  for (const item of source.textItems) {
    if (runs.length >= MAX_RUNS_PER_PAGE) break;
    const text = item.str;
    if (!text || !text.trim()) continue;
    const t = item.transform;
    // Text set sideways (a spine, a copyright line up the margin) is not
    // part of the reading.
    if (Math.abs(t[1]) > Math.abs(t[0]) * 0.05 || Math.abs(t[2]) > Math.abs(t[3]) * 0.05) continue;
    const [x, y] = toPage(t[4], t[5]);
    if (x < -5 || y < -5 || x > source.width + 5 || y > source.height + 5) continue;
    const size = Math.hypot(t[2], t[3]);
    runs.push({ s: text.slice(0, MAX_RUN_CHARS), x: round(x), y: round(y), w: round(item.width), z: round(size), f: source.fontIndex(source.fontName(item.fontName)) });
  }

  // A scanned page: its one picture is the page. Its art and maps are the
  // parts with no words on them, cut out of that picture when uploaded.
  const page = { n: source.pageNumber, w: round(source.width), h: round(source.height), runs, boxes, pictures };
  const scan = pictures.find((picture) => isScanPicture(page, picture));
  if (scan) {
    scan.scan = true;
    if (runs.length >= 30) {
      const regions = source.mapPage ? emptyRegions(page, 1, 25) : emptyRegions(page);
      regions.forEach((region, index) => {
        if (pictures.length >= MAX_IMAGES_PER_PAGE) return;
        pictures.push({ id: `p${source.pageNumber}r${index}`, x: round(region.x), y: round(region.y), w: round(region.w), h: round(region.h), pw: 0, ph: 0, hash: "", drawn: false, scan: true, of: scan.id });
      });
    }
  }

  // A page drawn in lines (a vector map) has no picture to lift; the page
  // itself is rendered when it is uploaded.
  if (!scan && isDrawnPage({ paths, runs: runs.length, pictures, width: source.width, height: source.height })) {
    pictures.push({ id: `p${source.pageNumber}d`, x: 0, y: 0, w: round(source.width), h: round(source.height), pw: 0, ph: 0, hash: "", drawn: true, scan: false });
  }

  return { n: source.pageNumber, w: round(source.width), h: round(source.height), runs, boxes, pictures };
}
