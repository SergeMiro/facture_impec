// Node only (`@fi/core/fonts`, outside src/ where Node modules are banned): the DejaVu Sans files
// next to this one, for servers that render PDFs. The add-in asks the API for the PDF instead.
import { readFileSync } from 'node:fs';
import type { FacturXOptions } from '../src/pdf/facturx';

const read = (file: string) => readFileSync(new URL(file, import.meta.url));

export function bundledFonts(): FacturXOptions['fonts'] {
  return { regular: read('DejaVuSans.ttf'), bold: read('DejaVuSans-Bold.ttf') };
}
