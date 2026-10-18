import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  fromCiiDate,
  isIsoDate,
  isoWeek,
  isoWeekday,
  parisHour,
  parisToday,
  toCiiDate,
} from './dates';

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

  it('takes the hour in Europe/Paris, summer and winter time', () => {
    expect(parisHour(new Date('2026-10-17T07:00:00Z'))).toBe(9);
    expect(parisHour(new Date('2026-12-17T07:00:00Z'))).toBe(8);
    expect(parisHour(new Date('2026-10-17T22:30:00Z'))).toBe(0);
  });

  it('adds calendar days across months, years and the clock change', () => {
    expect(addDays('2026-10-17', 30)).toBe('2026-11-16');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-27', 3)).toBe('2026-03-30');
    expect(addDays('2026-11-01', -3)).toBe('2026-10-29');
  });

  it('names the ISO week, whose year is the year of its Thursday', () => {
    expect(isoWeek('2026-10-19')).toBe('2026-W43');
    expect(isoWeek('2026-10-18')).toBe('2026-W42');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
    expect(isoWeek('2026-01-01')).toBe('2026-W01');
    expect(isoWeek('2021-01-03')).toBe('2020-W53');
    expect([isoWeekday('2026-10-19'), isoWeekday('2026-10-18')]).toEqual([1, 7]);
  });

  it('counts days and converts the CII date format', () => {
    expect(daysBetween('2026-10-17', '2026-11-16')).toBe(30);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(toCiiDate('2026-10-17')).toBe('20261017');
    expect(fromCiiDate('20261017')).toBe('2026-10-17');
    expect(fromCiiDate('2026-10-17')).toBe('2026-10-17');
  });
});
