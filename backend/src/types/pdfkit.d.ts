/**
 * Minimal ambient declaration for `pdfkit`.
 *
 * pdfkit ships only a JS runtime (no `.d.ts`) and we don't pull in
 * `@types/pdfkit`. Controllers that build PDFs (vendor-order PDF, receipts,
 * cert/scan-data downloads) only use a small subset of the API, so a hand-
 * rolled declaration keeps the dependency-tree slim.
 *
 * If we ever need a richer surface (forms, custom fonts, bookmarks),
 * swap to `npm i --save-dev @types/pdfkit` and delete this file.
 */
declare module 'pdfkit' {
  type PDFOpts = {
    size?: string | [number, number];
    margin?: number;
    margins?: { top?: number; bottom?: number; left?: number; right?: number };
    info?: Record<string, string>;
    [k: string]: unknown;
  };

  class PDFDocument {
    constructor(opts?: PDFOpts);
    y: number;
    pipe(stream: NodeJS.WritableStream): this;
    fontSize(size: number): this;
    font(name: string): this;
    text(
      text: string,
      x?: number | { [k: string]: unknown },
      y?: number | { [k: string]: unknown },
      opts?: { [k: string]: unknown },
    ): this;
    moveDown(lines?: number): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    stroke(): this;
    addPage(opts?: PDFOpts): this;
    end(): void;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  export default PDFDocument;
}
