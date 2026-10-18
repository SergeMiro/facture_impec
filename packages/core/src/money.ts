// Money is integer cents (CLAUDE.md rule 4). Quantities, prices and rates stay decimal strings and are
// computed as scaled bigints, so no float ever touches an amount.

/** An amount in cents (1 € = 100). Always a safe integer. */
export type Cents = number;

const DECIMAL = /^-?\d+(?:\.\d+)?$/;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

interface Scaled {
  units: bigint;
  scale: number;
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);

export function isDecimal(value: string): boolean {
  return DECIMAL.test(value);
}

/** Number of digits after the decimal point; 0 for "12". */
export function decimalPlaces(value: string): number {
  const dot = value.indexOf('.');
  return dot === -1 ? 0 : value.length - dot - 1;
}

function parse(value: string): Scaled | null {
  if (!DECIMAL.test(value)) return null;
  const negative = value.startsWith('-');
  const [int = '', frac = ''] = (negative ? value.slice(1) : value).split('.');
  const units = BigInt(int + frac);
  return { units: negative ? -units : units, scale: frac.length };
}

/** Integer division rounded half away from zero (« arrondi commercial »). */
export function divRound(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  if (r === 0n) return q;
  const abs = (x: bigint) => (x < 0n ? -x : x);
  if (abs(r) * 2n < abs(d)) return q;
  return n < 0n !== d < 0n ? q - 1n : q + 1n;
}

function toCents(n: bigint): Cents {
  if (n > MAX_SAFE || n < -MAX_SAFE) throw new RangeError('Amount out of range');
  return Number(n);
}

/** Parses an amount written with at most 2 decimals ("12", "12.5", "-0.05"); null otherwise. */
export function parseAmount(value: string): Cents | null {
  const s = parse(value);
  if (!s || s.scale > 2) return null;
  return toCents(s.units * pow10(2 - s.scale));
}

/** Rounds any decimal string to the cent. */
export function roundToCents(value: string): Cents | null {
  const s = parse(value);
  if (!s) return null;
  return toCents(
    s.scale >= 2 ? divRound(s.units, pow10(s.scale - 2)) : s.units * pow10(2 - s.scale),
  );
}

/** Writes cents as an XML amount: 1250 → "12.50", -5 → "-0.05". */
export function formatAmount(cents: Cents): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const int = Math.trunc(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${int}.${frac}`;
}

/** Quantity × net price ÷ base quantity, rounded to the cent (base of BT-131). Null on bad input. */
export function lineAmount(quantity: string, netPrice: string, baseQuantity = '1'): Cents | null {
  const q = parse(quantity);
  const p = parse(netPrice);
  const b = parse(baseQuantity);
  if (!q || !p || !b || b.units === 0n) return null;
  const numerator = q.units * p.units * pow10(2 + b.scale);
  const denominator = b.units * pow10(q.scale + p.scale);
  return toCents(divRound(numerator, denominator));
}

/** Base × rate %, rounded to the cent (BT-117 = BT-116 × BT-119 ÷ 100). Null on a bad rate. */
export function percentOf(base: Cents, rate: string): Cents | null {
  const r = parse(rate);
  if (!r) return null;
  return toCents(divRound(BigInt(base) * r.units, 100n * pow10(r.scale)));
}

export function sum(values: readonly Cents[]): Cents {
  return toCents(values.reduce((acc, v) => acc + BigInt(v), 0n));
}

/** Compares two decimal strings numerically ("20" equals "20.00"). Null if either is not a decimal. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 | null {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  const scale = Math.max(x.scale, y.scale);
  const l = x.units * pow10(scale - x.scale);
  const r = y.units * pow10(scale - y.scale);
  return l === r ? 0 : l < r ? -1 : 1;
}

/** Canonical decimal text without trailing zeros: "20.00" → "20", "5.50" → "5.5", "-0.0" → "0". */
export function normalizeDecimal(value: string): string | null {
  const s = parse(value);
  if (!s) return null;
  let { units, scale } = s;
  while (scale > 0 && units % 10n === 0n) {
    units /= 10n;
    scale--;
  }
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const text = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${text}` : text;
}
