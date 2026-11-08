// A small adventure PDF made on the spot, laid out the way published
// adventures are: a cover, two-column chapters with full-width titles, a
// tinted read-aloud box, a numbered key of rooms, a d6 table, a stat block
// in the SRD's form, a gridded map with room numbers printed over it, a
// portrait with its caption, a repeated corner ornament and running feet
// with page numbers. Original content (no published book's words), built
// with pdf-lib so the suites need no binary fixture.

import { deflateSync } from "node:zlib";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])), 8 + data.length);
  return out;
}
// An RGB PNG from a pixel function.
export function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      const at = y * (width * 3 + 1) + 1 + x * 3;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// A battle map: stone floor, a grid line every `cell` pixels.
export const MAP_CELL = 24;
export function gridMap(width = 480, height = 360, cell = MAP_CELL) {
  return png(width, height, (x, y) => (x % cell === 0 || y % cell === 0 ? [40, 40, 40] : [((x * 7 + y * 3) % 30) + 150, 140, 120]));
}

const W = 612;
const H = 792;
const LEFT = [54, 294];
const RIGHT = [318, 558];

export async function adventurePdf() {
  const doc = await PDFDocument.create();
  doc.setTitle("The Sunken Mill");
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const boldItalic = await doc.embedFont(StandardFonts.HelveticaBoldOblique);
  const ornament = await doc.embedPng(png(64, 64, (x, y) => ((x + y) % 16 < 8 ? [120, 30, 30] : [230, 200, 150])));
  const portrait = await doc.embedPng(png(160, 200, (x, y) => [80 + (x % 60), 60 + (y % 90), 90]));
  const map = await doc.embedPng(gridMap());

  let pageNumber = 0;
  const newPage = () => {
    const page = doc.addPage([W, H]);
    pageNumber += 1;
    page.drawImage(ornament, { x: 560, y: 740, width: 40, height: 40 });
    page.drawText("The Sunken Mill", { x: 54, y: 30, size: 8, font: serif });
    page.drawText(String(pageNumber), { x: 550, y: 30, size: 8, font: serif });
    return page;
  };

  // Lines of wrapped text in a column, top down from `y`; returns the y
  // under the last line.
  const write = (page, text, [from, to], y, { font = serif, size = 10, lead = "" } = {}) => {
    const words = text.split(/\s+/);
    let line = "";
    let first = true;
    const lines = [];
    for (const word of words) {
      const tryLine = line ? `${line} ${word}` : word;
      const width = (first && lead ? bold.widthOfTextAtSize(`${lead} `, size) : 0) + font.widthOfTextAtSize(tryLine, size);
      if (width > to - from && line) {
        lines.push({ text: line, first });
        first = false;
        line = word;
      } else line = tryLine;
    }
    if (line) lines.push({ text: line, first });
    for (const entry of lines) {
      let x = from;
      if (entry.first && lead) {
        page.drawText(lead, { x, y, size, font: boldItalic });
        x += boldItalic.widthOfTextAtSize(`${lead} `, size);
      }
      page.drawText(entry.text, { x, y, size, font });
      y -= size * 1.25;
    }
    return y - size * 0.6;
  };

  // Cover.
  {
    const page = newPage();
    page.drawText("The Sunken Mill", { x: 140, y: 560, size: 36, font: bold });
    page.drawText("An adventure for four characters of 3rd level", { x: 150, y: 520, size: 14, font: italic });
  }

  // Chapter 1: two columns, a read-aloud box, a portrait, a d6 table.
  {
    const page = newPage();
    page.drawText("Chapter 1: The Drowned Village", { x: 54, y: 730, size: 22, font: bold });
    let y = write(
      page,
      "Rain has fallen on Marrowford for forty days, and the river has swallowed the lower village. The villagers blame the old mill upstream, where lights burn at night though no miller has lived there in a generation.",
      LEFT,
      690,
    );
    // The read-aloud box.
    page.drawRectangle({ x: 50, y: y - 40, width: 248, height: 52, color: rgb(0.91, 0.86, 0.75) });
    y = write(
      page,
      "Black water laps at the doorsteps. Somewhere upstream a great wheel groans as it turns, though the river has no strength left to turn it.",
      LEFT,
      y - 4,
      { font: italic },
    );
    y = write(
      page,
      "Mother Reed, a gaunt woman in a cloak of river weed, keeps the mill. She trades favors for names and wants the village's bell, which she believes will call the drowned back to her.",
      LEFT,
      y - 14,
    );
    page.drawImage(portrait, { x: 330, y: 470, width: 160, height: 200 });
    page.drawText("Mother Reed", { x: 380, y: 456, size: 9, font: italic });
    page.drawText("Random Encounters", { x: 318, y: 420, size: 13, font: bold });
    const rows = [
      ["d6", "Encounter"],
      ["1", "Two hungry wolves"],
      ["2", "A drowned villager calling for help"],
      ["3", "A raft of eels"],
      ["4", "Mother Reed's crow, watching"],
      ["5", "A lost child on a rooftop"],
      ["6", "The bell tolls on its own"],
    ];
    let rowY = 400;
    for (const [die, text] of rows) {
      page.drawText(die, { x: 324, y: rowY, size: 10, font: die === "d6" ? bold : serif });
      page.drawText(text, { x: 380, y: rowY, size: 10, font: die === "d6" ? bold : serif });
      rowY -= 14;
    }
    write(page, "When the heroes reach the mill, go to chapter 2. The villagers will pay twenty gold pieces for the bell's safe return.", RIGHT, rowY - 10);
  }

  // Chapter 2: keyed rooms beside a gridded map with its room numbers.
  {
    const page = newPage();
    page.drawText("Chapter 2: The Mill", { x: 54, y: 730, size: 22, font: bold });
    let y = 690;
    const rooms = [
      ["1. Waterwheel", "A rotting waterwheel turns against the wall of the mill. A narrow door on the north side opens into the grinding room. The floor here is slick with weed."],
      ["2. Grinding Room", "Two millstones fill this room, twenty feet across. A ladder climbs to the loft and stairs descend to the cellar. Mother Reed waits here at night."],
      ["3. Cellar", "Water stands a foot deep on the cellar floor. The village bell hangs from a beam in the corner, wrapped in chains. Four giant eels guard it."],
    ];
    for (const [title, body] of rooms) {
      page.drawText(title, { x: 54, y, size: 12, font: bold });
      y = write(page, body, LEFT, y - 16);
    }
    page.drawImage(map, { x: 318, y: 420, width: 240, height: 180 });
    for (const [key, x, yy] of [["1", 340, 560], ["2", 420, 520], ["3", 500, 450]]) page.drawText(key, { x, y: yy, size: 12, font: bold });
    page.drawText("Map 1: The Sunken Mill", { x: 360, y: 405, size: 9, font: italic });
  }

  // Appendix: a stat block.
  {
    const page = newPage();
    page.drawText("Appendix: Creatures", { x: 54, y: 730, size: 22, font: bold });
    let y = 690;
    page.drawText("Bog Hag", { x: 54, y, size: 13, font: bold });
    y -= 15;
    page.drawText("Medium fey, neutral evil", { x: 54, y, size: 10, font: italic });
    y -= 18;
    for (const [label, value] of [
      ["Armor Class", "13 (natural armor)"],
      ["Hit Points", "39 (6d8 + 12)"],
      ["Speed", "30 ft., swim 30 ft."],
    ]) {
      page.drawText(label, { x: 54, y, size: 10, font: bold });
      page.drawText(value, { x: 54 + bold.widthOfTextAtSize(`${label} `, 10), y, size: 10, font: serif });
      y -= 14;
    }
    y -= 4;
    page.drawText("STR      DEX      CON      INT      WIS      CHA", { x: 60, y, size: 10, font: bold });
    y -= 13;
    page.drawText("16 (+3)  12 (+1)  14 (+2)  11 (+0)  13 (+1)  15 (+2)", { x: 56, y, size: 10, font: serif });
    y -= 18;
    for (const [label, value] of [
      ["Senses", "darkvision 60 ft., passive Perception 11"],
      ["Languages", "Common, Sylvan"],
      ["Challenge", "2 (450 XP)"],
    ]) {
      page.drawText(label, { x: 54, y, size: 10, font: bold });
      page.drawText(value, { x: 54 + bold.widthOfTextAtSize(`${label} `, 10), y, size: 10, font: serif });
      y -= 14;
    }
    y = write(page, "The hag can breathe air and water.", LEFT, y - 6, { lead: "Amphibious." });
    page.drawText("Actions", { x: 54, y, size: 11, font: bold });
    y = write(page, "The hag makes two claw attacks.", LEFT, y - 16, { lead: "Multiattack." });
    write(page, "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 10 (2d6 + 3) slashing damage.", LEFT, y, { lead: "Claws." });
  }

  return Buffer.from(await doc.save());
}

// An Old-School module of two pages, for the review's Match to SRD 5.1: a
// creature the SRD has outright (Skeleton), one whose name only ends in an
// SRD one (Starved Grey Ooze), and one the SRD has no name for (Glass
// Golem), each a bold name over its stat line as B/X books print them.
export async function oldSchoolPdf() {
  const doc = await PDFDocument.create();
  doc.setTitle("The Glass Tower");
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  {
    const page = doc.addPage([W, H]);
    page.drawText("The Glass Tower", { x: 150, y: 560, size: 36, font: bold });
    page.drawText("An adventure for characters of levels 3 to 5", { x: 150, y: 520, size: 14, font: serif });
  }
  const page = doc.addPage([W, H]);
  page.drawText("Chapter 1: The Tower", { x: 54, y: 730, size: 22, font: bold });
  let y = 690;
  const para = (text) => {
    page.drawText(text, { x: 54, y, size: 10, font: serif });
    y -= 22;
  };
  para("A tower of green glass stands on the moor, and its keeper has not been seen in a year.");
  para("Whatever walks its halls was made, not born, and it guards the stair.");
  const creature = (name, line) => {
    page.drawText(name, { x: 54, y, size: 10, font: bold });
    y -= 14;
    page.drawText(line, { x: 54, y, size: 9, font: serif });
    y -= 26;
  };
  creature("Glass Golem", "AC 3 [16], HD 6** (27hp), Att 2 x fist (1d8), THAC0 14 [+5], MV 90' (30'), SV D10 W11 P12 B13 S14 (6), ML 12, AL Lawful, XP 950");
  creature("Starved Grey Ooze", "AC 8 [11], HD 3* (13hp), Att 1 x touch (2d8), THAC0 17 [+2], MV 10' (3'), SV D12 W13 P14 B15 S16 (2), ML 12, AL Neutral, XP 50");
  creature("Skeleton", "AC 7 [12], HD 1 (4hp), Att 1 x weapon (1d6), THAC0 19 [0], MV 60' (20'), SV D12 W13 P14 B15 S16 (1), ML 12, AL Chaotic, XP 10");
  return Buffer.from(await doc.save());
}
