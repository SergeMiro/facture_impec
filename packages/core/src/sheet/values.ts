// Reading typed values out of cells. Excel stores numbers and dates as numbers; a sheet typed by hand
// also holds French text ("1 234,50 €", "18/10/2026", "5,5 %"). Only unambiguous forms are converted:
// anything else is passed on as typed, so a core rule (FF-FMT-03, FF-FMT-04) reports it on its cell.
import { isIsoDate } from '../dates';
import { FR_RATES } from '../rules/fr';
import type { RawCell } from './cells';

const SPACES = /[\s  ]/g;

/** Plain text of a cell, trimmed; undefined when empty. */
export function textOf(cell: RawCell | undefined): string | undefined {
  if (!cell) return undefined;
  const raw = cell.text !== '' ? cell.text : cell.value === null ? '' : String(cell.value);
  const text = raw.trim();
  return text === '' ? undefined : text;
}

/** A float from Excel as decimal text, without binary noise: 20.009999999999998 → "20.01". */
export function numberText(n: number): string | undefined {
  if (!Number.isFinite(n)) return undefined;
  const s = String(Number(n.toPrecision(15)));
  return /e/i.test(s) ? undefined : s;
}

/** French or English number text → "1234.5"; undefined when it is not clearly one number. */
export function decimalFromText(text: string): string | undefined {
  let s = text
    .replace(SPACES, '')
    .replace(/€|euros?|eur|ht|ttc/gi, '')
    .replace(/^\+/, '');
  if (/^-?\d+$/.test(s)) return s;
  if (/^-?\d+[.,]\d+$/.test(s)) return s.replace(',', '.');
  if (/^-?\d{1,3}(?:\.\d{3})+,\d+$/.test(s)) return s.replaceAll('.', '').replace(',', '.');
  if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) return s.replaceAll(',', '');
  s = s.replace(/[.,]$/, '');
  return /^-?\d+$/.test(s) ? s : undefined;
}

/** A quantity, price or amount: the decimal text, or the text as typed when it is not a number. */
export function decimalOf(cell: RawCell | undefined): string | undefined {
  if (!cell) return undefined;
  if (typeof cell.value === 'number') return numberText(cell.value) ?? textOf(cell);
  const text = textOf(cell);
  return text === undefined ? undefined : (decimalFromText(text) ?? text);
}

const isPercentFormat = (cell: RawCell) => (cell.format ?? '').includes('%');

/** A VAT rate in percent ("20", "5.5"). Excel percent cells hold 0.2 for 20 %. */
export function rateOf(cell: RawCell | undefined): string | undefined {
  if (!cell) return undefined;
  if (typeof cell.value === 'number') {
    const hundred = numberText(cell.value * 100);
    if (isPercentFormat(cell)) return hundred;
    if (cell.value > 0 && cell.value < 1 && hundred && FR_RATES.includes(hundred)) return hundred;
    return numberText(cell.value);
  }
  const text = textOf(cell);
  if (text === undefined) return undefined;
  return decimalFromText(text.replace('%', '')) ?? text;
}

const MONTHS: Readonly<Record<string, number>> = {
  janvier: 1,
  janv: 1,
  jan: 1,
  fevrier: 2,
  fevr: 2,
  fev: 2,
  mars: 3,
  avril: 4,
  avr: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  juil: 7,
  aout: 8,
  septembre: 9,
  sept: 9,
  sep: 9,
  octobre: 10,
  oct: 10,
  novembre: 11,
  nov: 11,
  decembre: 12,
  dec: 12,
};

const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Excel serial day (1900 system) → ISO date. Serial 61 is 1900-03-01; earlier ones never occur. */
export function serialToIso(serial: number): string | undefined {
  if (!Number.isFinite(serial) || serial < 61 || serial > 2_958_465) return undefined;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** French date text → ISO; undefined when it is not clearly one date. */
export function dateFromText(text: string): string | undefined {
  const s = text.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (isoMatch) {
    const value = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    return isIsoDate(value) ? value : undefined;
  }
  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (numeric) {
    const year = Number(numeric[3]);
    const value = iso(year < 100 ? 2000 + year : year, Number(numeric[2]), Number(numeric[1]));
    return isIsoDate(value) ? value : undefined;
  }
  const words = s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\./g, '');
  const named = /^(\d{1,2})(?:er)?\s+([a-z]+)\s+(\d{4})$/.exec(words);
  const month = named ? MONTHS[named[2] ?? ''] : undefined;
  if (named && month) {
    const value = iso(Number(named[3]), month, Number(named[1]));
    return isIsoDate(value) ? value : undefined;
  }
  return undefined;
}

const looksLikeDateFormat = (format: string | undefined) =>
  format !== undefined && /[dmy]/i.test(format.replace(/\[[^\]]*\]|"[^"]*"/g, ''));

/** A date: ISO when the cell clearly holds one, else the text as typed (FF-FMT-03 reports it). */
export function dateOf(cell: RawCell | undefined): string | undefined {
  if (!cell) return undefined;
  if (typeof cell.value === 'number') {
    const fromSerial = serialToIso(cell.value);
    if (fromSerial && (looksLikeDateFormat(cell.format) || cell.format === undefined)) {
      return fromSerial;
    }
  }
  const text = textOf(cell);
  if (text === undefined) return undefined;
  return dateFromText(text) ?? text;
}

/** SIREN, SIRET, VAT number: spaces and dots removed, upper case (FF-FMT-02 rewrites the same way). */
export function identifierOf(cell: RawCell | undefined): string | undefined {
  if (!cell) return undefined;
  if (typeof cell.value === 'number' && Number.isSafeInteger(cell.value)) return String(cell.value);
  const text = textOf(cell);
  return text?.replace(/[\s  .]/g, '').toUpperCase();
}

/** Goods or services, from a « Nature » column. */
export function natureOf(cell: RawCell | undefined): 'goods' | 'services' | undefined {
  const text = textOf(cell)
    ?.normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  if (text === undefined) return undefined;
  if (/bien|marchandise|produit|vente|goods/.test(text)) return 'goods';
  if (/service|prestation/.test(text)) return 'services';
  return undefined;
}
