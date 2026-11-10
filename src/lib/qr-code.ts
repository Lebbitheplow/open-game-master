import type { QRCodeToDataURLOptions } from "qrcode";

// A QR code as a picture, with the library that draws it fetched the first
// time one is asked for. The address button sits in the corner of every
// page and the invite dialog in every lobby, and importing the library with
// them put it (22 KiB of script, 8 KiB on the wire) in every page's first
// download for a picture most visits never open.
export async function drawQrCode(text: string, options: QRCodeToDataURLOptions): Promise<string> {
  const { default: QRCode } = await import("qrcode");
  return QRCode.toDataURL(text, options);
}
