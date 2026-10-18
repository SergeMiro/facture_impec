// How the PDF writes numbers and dates: the French way, with a no-break space so "1 250,00 €"
// never breaks across lines.
import { type Cents, formatAmount } from '../money';

export const NBSP = ' ';

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);

/** "1234.5" → "1 234,5"; `minDecimals` pads the fraction. Anything that is not a decimal stays as is. */
export function frDecimal(value: string, minDecimals = 0): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) return value;
  const [, sign, int = '', frac = ''] = m;
  const shown = frac.replace(/0+$/, '').padEnd(minDecimals, '0');
  return `${sign}${group(int)}${shown ? `,${shown}` : ''}`;
}

/** "1250" → "1 250,00 €"; another currency keeps its code: "1 250,00 USD". Prices may have more decimals. */
export const frPrice = (value: string, currency = 'EUR') =>
  `${frDecimal(value, 2)}${NBSP}${currency === 'EUR' ? '€' : currency}`;

/** 125000 → "1 250,00 €". */
export const frMoney = (cents: Cents, currency = 'EUR') => frPrice(formatAmount(cents), currency);

/** "2026-10-17" → "17/10/2026". */
export function frDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export const frRate = (rate: string) => `${frDecimal(rate)}${NBSP}%`;

/** "FR7630006000011234567890189" → "FR76 3000 6000 0112 3456 7890 189". */
export const groupIban = (iban: string) => iban.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');
