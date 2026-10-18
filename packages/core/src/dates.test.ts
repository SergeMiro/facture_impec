import { describe, expect, it } from 'vitest';
import { daysBetween, fromCiiDate, isIsoDate, parisToday, toCiiDate } from './dates';

describe('dates', () => {
  it('accepts only real calendar dates', () => {
    expect(isIsoDate('2026-10-17')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('17/10/2026')).toBe(false);
    expect(isIsoDate('2026-1-7')).toBe(false);
  });

  it('takes today in Europe/Paris', () => {
    // 23:30 UTC on 17 October is already the 18th in Paris (UTC+2).
    expect(parisToday(new Date('2026-10-17T23:30:00Z'))).toBe('2026-10-18');
    expect(parisToday(new Date('2026-12-31T22:59:00Z'))).toBe('2026-12-31');
  });

  it('counts days and converts the CII date format', () => {
    expect(daysBetween('2026-10-17', '2026-11-16')).toBe(30);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(toCiiDate('2026-10-17')).toBe('20261017');
    expect(fromCiiDate('20261017')).toBe('2026-10-17');
    expect(fromCiiDate('2026-10-17')).toBe('2026-10-17');
  });
});
