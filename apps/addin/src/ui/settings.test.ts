import { describe, expect, it } from 'vitest';
import { parseCadence, parseEuros, parseMargin } from './SettingsView';

describe('what « Réglages » reads from its fields', () => {
  it('reads a margin as a whole percentage, empty as none', () => {
    expect(parseMargin('15')).toBe(15);
    expect(parseMargin(' 20 % ')).toBe(20);
    expect(parseMargin('')).toBeNull();
    for (const wrong of ['0', '91', '12,5', 'abc', '-5'])
      expect(parseMargin(wrong)).toBeUndefined();
  });

  it('reads the chasing days and the ceiling in euros', () => {
    expect(parseCadence('-3, 7; 15 30')).toEqual([-3, 7, 15, 30]);
    expect(parseCadence('7, 3')).toBeNull();
    expect(parseEuros('2 000')).toBe(200_000);
    expect(parseEuros('1500,50 €')).toBe(150_050);
    expect(parseEuros('0')).toBeNull();
  });
});
