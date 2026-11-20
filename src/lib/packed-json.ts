// The browser's half of a big JSON answer sent packed (compressed-json.ts).
//
// The server used to mark a packed answer with Content-Encoding and let the
// browser unpack it unseen. Next 16.4.6 drops Content-Encoding from a route
// handler's answer (GHSA-pc58-hwjq-p385: a body fetch() already unpacked
// must not go out still claiming its encoding), and its own compression then
// gzipped the packed bytes a second time under one header, so the world came
// back as garbage. A caller that can unpack asks for it by this header and
// unpacks it here; any other caller gets plain JSON.
export const PACKED_JSON_HEADER = "x-odm-packed";

// A gzip stream's first two bytes. JSON never starts with them, so a packed
// answer is known by its bytes even where a proxy dropped the header.
function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

// The answer with its JSON unpacked, ready for response.json(); an answer
// that was not packed, or failed, comes back as it was sent.
export async function unpackJson(response: Response): Promise<Response> {
  if (!response.ok) return response;
  const bytes = new Uint8Array(await response.arrayBuffer());
  const init = { status: response.status, statusText: response.statusText, headers: { "content-type": "application/json" } };
  if (!isGzip(bytes)) return new Response(bytes, init);
  const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  return new Response(text, init);
}
