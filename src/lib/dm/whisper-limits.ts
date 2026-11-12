// The longest private note send_whisper takes. Its own module so the
// console's whisper box (src/lib/dm/catalog-world.ts, bundled into the
// screens and the apps) reads it without the server code in whispers.ts.
//
// A scene told to one player runs longer than a line: notes of 1,029, 1,214
// and 1,251 characters were refused at the old 1,000 (0.34.0 report). GAME STATE keeps only
// the first 200 characters of each sent note, so a longer one costs no
// context later.
export const WHISPER_MAX_CHARS = 2_000;
