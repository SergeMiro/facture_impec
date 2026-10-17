import { describe, expect, it } from 'vitest';
import {
  compareDecimal,
  decimalPlaces,
  divRound,
  formatAmount,
  isDecimal,
  lineAmount,
  normalizeDecimal,
  parseAmount,
  percentOf,
  roundToCents,
  sum,
} from './money';

describe('money', () => {
  it('rounds half away from zero', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
    expect(divRound(-4n, 3n)).toBe(-1n);
    expect(divRound(5n, -2n)).toBe(-3n);
    expect(divRound(6n, 3n)).toBe(2n);
  });

  it('parses amounts with at most two decimals', () => {
    expect(parseAmount('12')).toBe(1200);
    expect(parseAmount('12.5')).toBe(1250);
    expect(parseAmount('-0.05')).toBe(-5);
    expect(parseAmount('12.505')).toBeNull();
    expect(parseAmount('12,50')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });

  it('rounds any decimal to the cent', () => {
    expect(roundToCents('12.505')).toBe(1251);
    expect(roundToCents('-12.505')).toBe(-1251);
    expect(roundToCents('3')).toBe(300);
    expect(roundToCents('abc')).toBeNull();
  });

  it('formats cents as XML amounts', () => {
    expect(formatAmount(1250)).toBe('12.50');
    expect(formatAmount(-5)).toBe('-0.05');
    expect(formatAmount(0)).toBe('0.00');
    expect(formatAmount(123456789)).toBe('1234567.89');
  });

  it('computes line amounts exactly, without floats', () => {
    // 0.1 × 3 is 0.30000000000000004 in floating point.
    expect(lineAmount('3', '0.1')).toBe(30);
    expect(lineAmount('1.5', '33.333333')).toBe(5000);
    expect(lineAmount('7', '12.345')).toBe(8642); // 86.415 → 86.42
    expect(lineAmount('-2', '10')).toBe(-2000);
    expect(lineAmount('10', '4.5', '100')).toBe(45); // price per 100 units
    expect(lineAmount('1', '1', '0')).toBeNull();
    expect(lineAmount('x', '1')).toBeNull();
  });

  it('computes VAT on a base', () => {
    expect(percentOf(10000, '20')).toBe(2000);
    expect(percentOf(999, '5.5')).toBe(55); // 54.945 → 55
    expect(percentOf(-999, '5.5')).toBe(-55);
    expect(percentOf(1234, '2.1')).toBe(26); // 25.914 → 26
    expect(percentOf(100, '20,0')).toBeNull();
  });

  it('sums and refuses amounts beyond the safe range', () => {
    expect(sum([1, 2, 3])).toBe(6);
    expect(sum([])).toBe(0);
    expect(() => sum([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
  });

  it('compares and normalizes decimals', () => {
    expect(compareDecimal('20', '20.00')).toBe(0);
    expect(compareDecimal('5.5', '10')).toBe(-1);
    expect(compareDecimal('-1', '-2')).toBe(1);
    expect(compareDecimal('a', '1')).toBeNull();
    expect(normalizeDecimal('20.00')).toBe('20');
    expect(normalizeDecimal('5.50')).toBe('5.5');
    expect(normalizeDecimal('0.05')).toBe('0.05');
    expect(normalizeDecimal('-0.50')).toBe('-0.5');
    expect(normalizeDecimal('-0.0')).toBe('0');
    expect(normalizeDecimal('1,5')).toBeNull();
  });

  it('reads decimal syntax', () => {
    expect(isDecimal('12.50')).toBe(true);
    expect(isDecimal('.5')).toBe(false);
    expect(isDecimal('1e3')).toBe(false);
    expect(decimalPlaces('12.505')).toBe(3);
    expect(decimalPlaces('12')).toBe(0);
  });
});
