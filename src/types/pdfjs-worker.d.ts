// pdf.js's worker module, imported only to run pdf.js on the page's own
// thread when a Worker cannot start (src/lib/pdf-import/read-pdf.ts). It
// ships without types; nothing of it is called directly.
declare module "pdfjs-dist/legacy/build/pdf.worker.min.mjs" {
  export const WorkerMessageHandler: unknown;
}
