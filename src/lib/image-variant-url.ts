// The sizes a picture's smaller copies come in, and the address a page asks
// for one with. Apart from src/lib/image-format.ts, which re-exports all of
// it, because that module reads picture bytes through Buffer: a page that
// imported it for these few lines made the bundler ship a Buffer polyfill
// (21 KiB of script) with it. Pure: no imports, so it serves the page
// components, the serve routes and the test scripts alike.

export const VARIANT_WIDTHS = [256, 1024] as const;
export type VariantWidth = (typeof VARIANT_WIDTHS)[number];

const VARIANT_ROOTS = ["/generated/", "/uploads/"];

// A picture address with the size a consumer wants. Only the server's own
// generated and uploaded pictures have variants, so anything else (data:,
// blob:, built-in art, another origin, an address that already carries a
// query) comes back untouched. The form is a query, never a path suffix,
// because the apps route these to the host by path prefix and pass the
// query through.
export function variantUrl(src: string, width: VariantWidth): string {
  if (!VARIANT_ROOTS.some((root) => src.startsWith(root))) {
    return src;
  }
  if (src.includes("?") || src.includes("#")) {
    return src;
  }
  return `${src}?w=${width}`;
}
