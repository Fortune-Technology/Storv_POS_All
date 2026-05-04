/**
 * S77 Phase 2 — PDF generation for signed contracts
 *
 * Uses Puppeteer to render the full HTML document (with the embedded
 * signature image) to a Letter-sized PDF, written to:
 *   uploads/contracts/<contractId>.pdf
 *
 * The Puppeteer browser is lazy-loaded and reused across requests within
 * the process — first call ~2-3s, subsequent calls <500ms.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import type { Browser } from 'puppeteer';

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    // Lazy import so server startup isn't slowed by Puppeteer.
    browserPromise = (async () => {
      const puppeteer = await import('puppeteer');
      return puppeteer.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    })();
  }
  return browserPromise;
}

export interface PdfResult {
  filePath: string;
  fileName: string;
  size: number;
}

/**
 * Generates a PDF from the rendered HTML and writes it to disk.
 * Returns the filesystem path + size for storing on Contract.signedPdfPath.
 */
export async function generateContractPdf(contractId: string, fullHtml: string): Promise<PdfResult> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.75in', bottom: '0.75in', left: '0.75in', right: '0.75in' },
    });

    const dir = path.resolve(process.cwd(), 'uploads', 'contracts');
    await fs.mkdir(dir, { recursive: true });
    const fileName = `${contractId}.pdf`;
    const filePath = path.join(dir, fileName);
    await fs.writeFile(filePath, pdfBuffer);
    const stat = await fs.stat(filePath);
    return { filePath, fileName, size: stat.size };
  } finally {
    await page.close();
  }
}

/**
 * Cleanly shut down the singleton browser. Wired into the server's
 * graceful-shutdown handler. Optional — the OS will reap on exit anyway.
 */
export async function shutdownPdfBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    await b.close();
  } catch { /* swallow */ }
  browserPromise = null;
}
