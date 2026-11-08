import type { Picture, ReadPage } from "./reading.ts";
import type { KeptPicture } from "./draft-logic.ts";

// The pictures of a book: which are worth keeping, which are maps, and the
// grid a map is drawn on. Pure: the page runs the keeping and the grid (it
// has the pixels), the server the kinds (it has the text around them).

// An 8 x 8 average hash of RGBA pixels: one bit per cell, set where the cell
// is brighter than the mean. Two drawings of the same ornament agree on it
// even after different scaling.
export function averageHash(rgba: ArrayLike<number>): string {
  const cells = Math.floor(rgba.length / 4);
  if (cells < 64) return "";
  const grey: number[] = [];
  for (let index = 0; index < 64; index += 1) {
    const at = index * 4;
    grey.push(rgba[at] * 0.299 + rgba[at + 1] * 0.587 + rgba[at + 2] * 0.114);
  }
  const mean = grey.reduce((sum, value) => sum + value, 0) / 64;
  let hex = "";
  for (let nibble = 0; nibble < 16; nibble += 1) {
    let value = 0;
    for (let bit = 0; bit < 4; bit += 1) value = (value << 1) | (grey[nibble * 4 + bit] > mean ? 1 : 0);
    hex += value.toString(16);
  }
  return hex;
}

// A page drawn rather than pasted: many paths, little text and no big
// picture. That is how a vector map reaches a PDF; the page is rendered to
// keep it.
export function isDrawnPage(page: { paths: number; runs: number; pictures: Array<Pick<Picture, "w" | "h">>; width: number; height: number }): boolean {
  const area = page.width * page.height;
  const pictured = page.pictures.reduce((sum, picture) => sum + picture.w * picture.h, 0);
  return page.paths >= 400 && page.runs <= 250 && pictured < area * 0.3;
}

// Pictures that are page furniture: the same picture (by hash) on several
// pages, or one too small to be anything but a flourish. A drawn page is
// kept only when few pages are drawn: a book that draws its border on every
// page in lines would otherwise send every page.
export function furnitureIds(pages: ReadPage[], mapPages: Set<number> = new Set()): Set<string> {
  const pagesByHash = new Map<string, Set<number>>();
  for (const page of pages) {
    for (const picture of page.pictures) {
      if (!picture.hash || picture.drawn) continue;
      const seen = pagesByHash.get(picture.hash) ?? new Set<number>();
      seen.add(page.n);
      pagesByHash.set(picture.hash, seen);
    }
  }
  const drawnPages = pages.filter((page) => page.pictures.some((picture) => picture.drawn)).length;
  const tooManyDrawn = drawnPages > Math.max(6, pages.length * 0.2);
  const out = new Set<string>();
  for (const page of pages) {
    const area = Math.max(1, page.w * page.h);
    for (const picture of page.pictures) {
      if (picture.drawn) {
        if (tooManyDrawn) out.add(picture.id);
        continue;
      }
      // A scanned page under its words is the page; its parts with no
      // words (picture.of) are what is kept of it. A scan with almost no
      // words is itself the picture (a map, a full-page painting).
      // A page the book's bookmarks call a map keeps its whole scan (its
      // room numbers are words on it, not a sign of a text page).
      if (picture.scan && !picture.of) {
        // A map page with the map cut out of it keeps the cut-out instead.
        const cut = page.pictures.some((other) => other.of === picture.id);
        if ((page.runs.length >= 60 && !mapPages.has(page.n)) || (mapPages.has(page.n) && cut)) out.add(picture.id);
        continue;
      }
      if (picture.of) continue;
      const share = (picture.w * picture.h) / area;
      // A flat hash (all one tone) is a fill, not art.
      const flat = picture.hash === "0000000000000000" || picture.hash === "ffffffffffffffff";
      const repeated = (pagesByHash.get(picture.hash)?.size ?? 0) >= 3;
      if (repeated || flat || share < 0.012) out.add(picture.id);
    }
  }
  return out;
}

export type PictureKind = "map" | "art" | "backdrop";

const MAP_WORDS = /\b(map|maps|level|floor|dungeon|cavern|caves|keep|tower|ruins|lair|crypt|temple|village|town|city|region|area)\b/i;
const MAP_TITLE = /\bmap\b|\bmap\s+\d|\bfloor\s*plan\b|\blevel\s+\d/i;

// What a kept picture is, from where it sits and the words near it. A map
// fills much of its page and is named nearby ("Map 3: The Sunken Keep"), or
// is a drawn page; a picture under the whole page's text is the page's
// backdrop; the rest is art (portraits, scenes, items).
export function pictureKind(page: ReadPage, picture: Picture, nearText: string): PictureKind {
  if (picture.drawn) return "map";
  const area = Math.max(1, page.w * page.h);
  const share = (picture.w * picture.h) / area;
  const covered = page.runs.filter((run) => run.x >= picture.x && run.x <= picture.x + picture.w && run.y >= picture.y && run.y <= picture.y + picture.h).length;
  if (share >= 0.8 && covered >= 120 && !picture.of) return "backdrop";
  if (MAP_TITLE.test(nearText)) return "map";
  if (share >= 0.45 && covered <= 60 && MAP_WORDS.test(nearText)) return "map";
  // Room numbers printed over a picture, as text: a keyed map.
  const keys = page.runs.filter(
    (run) => /^[A-Z]?\d{1,3}[a-z]?$/.test(run.s.trim()) && run.x >= picture.x && run.x <= picture.x + picture.w && run.y >= picture.y && run.y <= picture.y + picture.h,
  ).length;
  if (keys >= 3) return "map";
  return "art";
}

// Room keys printed as text over a map picture, where they sit as a share
// of the picture (0..1 each way). A map whose numbers are part of its
// painting yields none; those are read by a model that can see, if any.
export function mapKeys(page: ReadPage, picture: Picture): Array<{ key: string; fx: number; fy: number }> {
  const out: Array<{ key: string; fx: number; fy: number }> = [];
  if (picture.w <= 0 || picture.h <= 0) return out;
  for (const run of page.runs) {
    const key = run.s.trim();
    if (!/^[A-Z]?\d{1,3}[a-z]?$/.test(key)) continue;
    const cx = run.x + run.w / 2;
    const cy = run.y - run.z / 3;
    if (cx < picture.x || cx > picture.x + picture.w || cy < picture.y || cy > picture.y + picture.h) continue;
    out.push({ key, fx: (cx - picture.x) / picture.w, fy: (cy - picture.y) / picture.h });
    if (out.length >= 200) break;
  }
  return out;
}

export type GridGuess = { cell: number; offsetX: number; offsetY: number; confidence: number };

// The grid a battle map is drawn on, from its pixels: edges summed down
// each column and along each row repeat every cell, so the autocorrelation
// of each profile peaks at the cell size. Both directions must agree, and
// the peak must stand clear, or there is no grid to report (a region map, a
// painting) and the GM sets the scale by hand.
export function detectGrid(rgba: ArrayLike<number>, width: number, height: number): GridGuess | null {
  if (width < 64 || height < 64 || rgba.length < width * height * 4) return null;
  const grey = new Float32Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const at = index * 4;
    grey[index] = rgba[at] * 0.299 + rgba[at + 1] * 0.587 + rgba[at + 2] * 0.114;
  }
  const columns = new Float64Array(width);
  const rows = new Float64Array(height);
  for (let y = 1; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const here = grey[y * width + x];
      columns[x] += Math.abs(here - grey[y * width + x - 1]);
      rows[y] += Math.abs(here - grey[(y - 1) * width + x]);
    }
  }
  const across = periodOf(columns);
  const down = periodOf(rows);
  if (!across || !down) return null;
  if (Math.abs(across.period - down.period) > Math.max(2, across.period * 0.08)) return null;
  const cell = (across.period + down.period) / 2;
  return {
    cell: Math.round(cell * 100) / 100,
    offsetX: phaseOf(columns, cell),
    offsetY: phaseOf(rows, cell),
    confidence: Math.round(Math.min(across.score, down.score) * 100) / 100,
  };
}

function detrended(profile: ArrayLike<number>): Float64Array {
  const out = new Float64Array(profile.length);
  const half = 8;
  let sum = 0;
  let count = 0;
  for (let index = 0; index < Math.min(profile.length, half); index += 1) {
    sum += profile[index];
    count += 1;
  }
  for (let index = 0; index < profile.length; index += 1) {
    const add = index + half;
    if (add < profile.length) {
      sum += profile[add];
      count += 1;
    }
    const drop = index - half - 1;
    if (drop >= 0) {
      sum -= profile[drop];
      count -= 1;
    }
    out[index] = profile[index] - sum / Math.max(1, count);
  }
  return out;
}

function periodOf(raw: ArrayLike<number>): { period: number; score: number } | null {
  const profile = detrended(raw);
  const n = profile.length;
  let energy = 0;
  for (let index = 0; index < n; index += 1) energy += profile[index] * profile[index];
  if (energy <= 0) return null;
  const minLag = 12;
  const maxLag = Math.min(400, Math.floor(n / 4));
  if (maxLag <= minLag + 2) return null;
  const score = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag += 1) {
    let sum = 0;
    for (let index = 0; index + lag < n; index += 1) sum += profile[index] * profile[index + lag];
    score[lag] = sum / energy;
  }
  // The first clear peak: a local maximum that is strong on its own, whose
  // double is strong too (a real grid repeats; a single strong line pair
  // does not).
  for (let lag = minLag + 1; lag <= maxLag; lag += 1) {
    const value = score[lag];
    if (value < 0.25 || value < score[lag - 1] || value < score[lag + 1]) continue;
    const double = lag * 2 <= maxLag + 1 ? score[lag * 2] : value;
    if (double < 0.15) continue;
    // Refine to a fraction of a pixel with a parabola through the peak.
    const left = score[lag - 1];
    const right = score[lag + 1];
    const bend = left - 2 * value + right;
    const shift = bend !== 0 ? (0.5 * (left - right)) / bend : 0;
    return { period: lag + Math.max(-0.5, Math.min(0.5, shift)), score: value };
  }
  return null;
}

function phaseOf(raw: ArrayLike<number>, cell: number): number {
  const profile = detrended(raw);
  let best = 0;
  let bestSum = -Infinity;
  for (let phase = 0; phase < Math.ceil(cell); phase += 1) {
    let sum = 0;
    for (let at = phase; at < profile.length; at += cell) sum += profile[Math.round(at)] ?? 0;
    if (sum > bestSum) {
      bestSum = sum;
      best = phase;
    }
  }
  return best;
}

// How a map picture sits on a board so its printed squares are the board's
// squares: the board's size in squares, and the backdrop's scale and offset
// (src/lib/battlemap/backdrop.ts stretches the picture over the board, then
// scales it about the centre and shifts it by whole or part squares).
// Without a grid the long edge is given 30 squares, the size of a room
// map drawn at an inch a square on a page.
export function gridFit(width: number, height: number, grid: GridGuess | null): { width: number; height: number; scale: number; offsetX: number; offsetY: number } {
  const clampSize = (value: number) => Math.max(4, Math.min(200, Math.round(value)));
  if (!grid || grid.cell <= 0) {
    const long = Math.max(width, height) || 1;
    return { width: clampSize((30 * width) / long), height: clampSize((30 * height) / long), scale: 1, offsetX: 0, offsetY: 0 };
  }
  const cols = clampSize(width / grid.cell);
  const rows = clampSize(height / grid.cell);
  const scale = Math.max(0.2, Math.min(5, ((width / (grid.cell * cols)) + (height / (grid.cell * rows))) / 2));
  const shift = (squares: number, phase: number) => {
    const start = (squares - squares * scale) / 2 + phase / grid.cell;
    let offset = -(start - Math.floor(start));
    if (offset < -0.5) offset += 1;
    return Math.round(offset * 100) / 100;
  };
  return { width: cols, height: rows, scale: Math.round(scale * 1000) / 1000, offsetX: shift(cols, grid.offsetX), offsetY: shift(rows, grid.offsetY) };
}

// The words printed beside a picture: a caption just under or over it, or
// failing that the biggest words on its page (the page's heading).
export function nearText(page: ReadPage, picture: Picture): string {
  const inColumn = (x: number) => x >= picture.x - 10 && x <= picture.x + picture.w + 10;
  const bottom = picture.y + picture.h;
  const caption = page.runs
    .filter((run) => inColumn(run.x) && ((run.y >= bottom && run.y <= bottom + 30) || (run.y <= picture.y && run.y >= picture.y - 24)))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((run) => run.s)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (caption && caption.length <= 140) return caption;
  const biggest = [...page.runs].sort((a, b) => b.z - a.z)[0];
  if (!biggest) return "";
  return page.runs
    .filter((run) => Math.abs(run.y - biggest.y) < 2 && Math.abs(run.z - biggest.z) < 0.6)
    .map((run) => run.s)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

export type PictureUpload = { picture: Picture; page: number; width: number; height: number; grid: GridGuess | null };

// What the server knows of each uploaded picture once the pages are in:
// its kind, the room keys printed over a map, and its caption.
export function describePictures(pages: ReadPage[], uploads: PictureUpload[], outline: Array<{ title: string; page: number }> = []): KeptPicture[] {
  const byNumber = new Map(pages.map((page) => [page.n, page]));
  // A book's bookmarks often name its maps ("[Map 1.1: Fortress Level]").
  const mapTitles = new Map<number, string>();
  for (const item of outline) {
    if (/\bmap\b/i.test(item.title) && !mapTitles.has(item.page)) mapTitles.set(item.page, item.title.replace(/^\[|\]$/g, "").trim());
  }
  const out: KeptPicture[] = [];
  for (const upload of uploads) {
    const page = byNumber.get(upload.page);
    if (!page) continue;
    const marked = mapTitles.get(upload.page);
    const near = marked ?? nearText(page, upload.picture);
    const kind = marked && (upload.picture.w * upload.picture.h >= page.w * page.h * 0.25) ? "map" : pictureKind(page, upload.picture, near);
    out.push({
      id: upload.picture.id,
      page: upload.page,
      kind,
      width: upload.width,
      height: upload.height,
      grid: kind === "map" ? upload.grid : null,
      keys: kind === "map" ? mapKeys(page, upload.picture) : [],
      near,
    });
  }
  return out;
}

// ---- scanned pages ----

// A scanned page: one picture covering the page, with the words over it.
export function isScanPicture(page: Pick<ReadPage, "w" | "h">, picture: Pick<Picture, "w" | "h">): boolean {
  return picture.w * picture.h >= page.w * page.h * 0.8;
}

// The parts of a scanned page with no words on them, big enough to hold a
// picture: a grid of the page marked wherever a word sits (and a little
// around it), its empty cells grouped, and the groups that make a solid
// block kept. Margins are left out. Whether a part holds a picture or
// blank paper is told from its pixels when it is drawn.
export function emptyRegions(page: ReadPage, limit = 3, minRunChars = 0): Array<{ x: number; y: number; w: number; h: number }> {
  const cell = 12;
  const cols = Math.max(1, Math.ceil(page.w / cell));
  const rows = Math.max(1, Math.ceil(page.h / cell));
  const busy = new Uint8Array(cols * rows);
  const mark = (x0: number, y0: number, x1: number, y1: number) => {
    for (let row = Math.max(0, Math.floor(y0 / cell) - 1); row <= Math.min(rows - 1, Math.floor(y1 / cell) + 1); row += 1) {
      for (let col = Math.max(0, Math.floor(x0 / cell) - 1); col <= Math.min(cols - 1, Math.floor(x1 / cell) + 1); col += 1) busy[row * cols + col] = 1;
    }
  };
  // On a map page only prose counts as words: a run with other words packed
  // round it. A room number, a scale or the map's own title stands alone,
  // and is part of the picture.
  const crowded = (run: ReadPage["runs"][number]) =>
    page.runs.filter((other) => other !== run && Math.abs(other.y - run.y) <= run.z * 2.6 && other.x < run.x + run.w + 40 && other.x + other.w > run.x - 40).length >= 3;
  for (const run of page.runs) {
    if (minRunChars && run.s.trim().length < minRunChars && !crowded(run)) continue;
    mark(run.x, run.y - run.z, run.x + Math.max(run.w, run.z), run.y);
  }
  const marginX = Math.ceil(cols * 0.06);
  const marginY = Math.ceil(rows * 0.05);
  // Thin gaps (the blank line under a heading, the space between columns)
  // would join a picture to the whole page: a cell counts as empty only
  // when everything within two cells of it is, and a found part grows back
  // by those two cells.
  const reach = 2;
  const open = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      let clear = true;
      for (let dy = -reach; dy <= reach && clear; dy += 1) {
        for (let dx = -reach; dx <= reach; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || busy[ny * cols + nx]) {
            clear = false;
            break;
          }
        }
      }
      open[y * cols + x] = clear ? 1 : 0;
    }
  }
  for (let index = 0; index < busy.length; index += 1) busy[index] = open[index] ? 0 : 1;
  const seen = new Uint8Array(cols * rows);
  const found: Array<{ x: number; y: number; w: number; h: number; fill: number }> = [];
  for (let start = 0; start < cols * rows; start += 1) {
    const sx = start % cols;
    const sy = Math.floor(start / cols);
    if (busy[start] || seen[start] || sx < marginX || sx >= cols - marginX || sy < marginY || sy >= rows - marginY) continue;
    const queue = [start];
    seen[start] = 1;
    let count = 0;
    let minX = sx;
    let maxX = sx;
    let minY = sy;
    let maxY = sy;
    while (queue.length) {
      const at = queue.pop()!;
      count += 1;
      const x = at % cols;
      const y = Math.floor(at / cols);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < marginX || nx >= cols - marginX || ny < marginY || ny >= rows - marginY) continue;
        const next = ny * cols + nx;
        if (busy[next] || seen[next]) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    minX = Math.max(0, minX - reach);
    minY = Math.max(0, minY - reach);
    maxX = Math.min(cols - 1, maxX + reach);
    maxY = Math.min(rows - 1, maxY + reach);
    const boxCells = (maxX - minX + 1) * (maxY - minY + 1);
    count += (maxX - minX + 1) * 2 * reach + (maxY - minY + 1) * 2 * reach;
    const fill = count / boxCells;
    const area = boxCells * cell * cell;
    if (area >= page.w * page.h * 0.08 && fill >= 0.6 && maxX - minX >= 6 && maxY - minY >= 6) {
      found.push({ x: minX * cell, y: minY * cell, w: (maxX - minX + 1) * cell, h: (maxY - minY + 1) * cell, fill });
    }
  }
  return found
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .slice(0, limit)
    .map(({ x, y, w, h }) => ({ x, y, w: Math.min(w, page.w - x), h: Math.min(h, page.h - y) }));
}

// How much a picture's pixels vary: blank paper (a scan's empty margin)
// hardly does; art and maps do. RGBA in, a standard deviation of grey out.
export function pixelSpread(rgba: ArrayLike<number>): number {
  const count = Math.floor(rgba.length / 4);
  if (!count) return 0;
  let sum = 0;
  let squares = 0;
  for (let index = 0; index < count; index += 1) {
    const at = index * 4;
    const grey = rgba[at] * 0.299 + rgba[at + 1] * 0.587 + rgba[at + 2] * 0.114;
    sum += grey;
    squares += grey * grey;
  }
  const mean = sum / count;
  return Math.sqrt(Math.max(0, squares / count - mean * mean));
}

// The pages a book's bookmarks name as maps ("[Map 2.1: The Stone Tooth]").
export function mapPagesOf(outline: Array<{ title: string; page: number }>): Set<number> {
  return new Set(outline.filter((item) => /\bmaps?\b/i.test(item.title)).map((item) => item.page));
}
