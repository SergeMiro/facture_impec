// What a document says (BTP plan stage 1, queue `document.ingest`): an electronic invoice is read as
// data (Factur-X PDF, UBL, CII); any other PDF by its text (`pdftotext`), and a PDF without text or an
// image by OCR (`pdftoppm`, then `tesseract -l fra`). The tools are poppler-utils and tesseract-ocr
// with its French data, installed in the API image (apps/api/Dockerfile, docs/RUNBOOK.md). Nothing
// here guesses what the document is beyond an invoice's own data: stage 2's classifier does.
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Invoice, InvoiceXmlError, parseInvoiceXml } from '@fi/core';
import { FacturXPdfError, readFacturXPdf } from '@fi/core/pdf';
import { FatalError, RetryableError } from '@fi/domain';

export type Reading =
  | { kind: 'invoice'; format: 'factur-x' | 'ubl' | 'cii'; xml: string; invoice: Invoice }
  | { kind: 'text'; text: string; ocr: boolean; pages: number; truncated: boolean }
  /** damaged: the file cannot be opened; no_text: nothing to read, even by OCR; xml: not an invoice. */
  | { kind: 'unreadable'; reason: 'damaged' | 'no_text' | 'xml' };

/** Below this many letters a PDF's text is a scan's stray marks: it is read by OCR instead. */
export const MIN_LETTERS = 20;
/** Pages read by OCR, at most: a 40-page contract's first pages say what it is. */
export const OCR_PAGES = 10;
/** Resolution of the pages given to OCR: 200 dpi reads printed text, in half the time of 300. */
const OCR_DPI = 200;
const TOOL_TIMEOUT_MS = 60_000;

const letters = (text: string) => text.match(/\p{L}/gu)?.length ?? 0;

/** Runs a tool with the bytes on its standard input; its standard output, as UTF-8. */
function run(command: string, args: string[], input?: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), TOOL_TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      // The image lacks the tool: a deployment fault, worth retrying once it is fixed.
      reject(
        e.code === 'ENOENT' ? new RetryableError('tool_missing', `${command} is not installed`) : e,
      );
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve(Buffer.concat(out).toString('utf8'));
      const detail = Buffer.concat(err).toString('utf8').trim().slice(0, 300);
      if (signal) return reject(new RetryableError('tool_timeout', `${command}: ${signal}`));
      reject(new FatalError('tool_failed', `${command} exited ${code}: ${detail}`));
    });
    child.stdin.on('error', () => {
      // The tool may stop reading early (a damaged file): its exit code says what happened.
    });
    child.stdin.end(input);
  });
}

async function ocrImages(dir: string): Promise<string[]> {
  const pages = (await readdir(dir)).filter((f) => f.startsWith('page')).sort();
  const texts: string[] = [];
  for (const page of pages) {
    texts.push(await run('tesseract', [join(dir, page), 'stdout', '-l', 'fra']));
  }
  return texts;
}

async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'fi-read-'));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  const info = await run('pdfinfo', ['-'], bytes);
  return Number(/^Pages:\s+(\d+)/m.exec(info)?.[1] ?? 0);
}

async function readPdf(bytes: Uint8Array): Promise<Reading> {
  try {
    const { xml } = await readFacturXPdf(bytes);
    return invoiceOf(xml, 'factur-x');
  } catch (e) {
    // A PDF without invoice data, or a damaged one: its text says the rest.
    if (!(e instanceof FacturXPdfError)) throw e;
  }
  try {
    const pages = await pageCount(bytes);
    const text = await run('pdftotext', ['-layout', '-enc', 'UTF-8', '-', '-'], bytes);
    if (letters(text) >= MIN_LETTERS) {
      return { kind: 'text', text: text.trim(), ocr: false, pages, truncated: false };
    }
    const scanned = await withTempDir(async (dir) => {
      const last = String(Math.min(Math.max(pages, 1), OCR_PAGES));
      const out = join(dir, 'page');
      await run('pdftoppm', ['-l', last, '-r', String(OCR_DPI), '-gray', '-png', '-', out], bytes);
      return ocrImages(dir);
    });
    const read = scanned.join('\f').trim();
    if (letters(read) < MIN_LETTERS) return { kind: 'unreadable', reason: 'no_text' };
    return { kind: 'text', text: read, ocr: true, pages, truncated: pages > OCR_PAGES };
  } catch (e) {
    // A tool refused the file: it is damaged. A missing tool or a timeout is retried instead.
    if (e instanceof FatalError) return { kind: 'unreadable', reason: 'damaged' };
    throw e;
  }
}

async function readImage(bytes: Uint8Array): Promise<Reading> {
  let text: string;
  try {
    text = await run('tesseract', ['stdin', 'stdout', '-l', 'fra'], bytes);
  } catch (e) {
    if (e instanceof FatalError) return { kind: 'unreadable', reason: 'damaged' };
    throw e;
  }
  if (letters(text) < MIN_LETTERS) return { kind: 'unreadable', reason: 'no_text' };
  return { kind: 'text', text: text.trim(), ocr: true, pages: 1, truncated: false };
}

function invoiceOf(xml: string, format?: 'factur-x'): Reading {
  try {
    const parsed = parseInvoiceXml(xml);
    return { kind: 'invoice', format: format ?? parsed.syntax, xml, invoice: parsed.invoice };
  } catch (e) {
    if (e instanceof InvoiceXmlError) return { kind: 'unreadable', reason: 'xml' };
    throw e;
  }
}

/** Reads a stored document; `mime` is what its bytes were found to be at ingest (src/ingest.ts). */
export async function readDocument(bytes: Uint8Array, mime: string): Promise<Reading> {
  if (mime === 'application/pdf') return readPdf(bytes);
  if (mime.startsWith('image/')) return readImage(bytes);
  return invoiceOf(new TextDecoder().decode(bytes));
}
