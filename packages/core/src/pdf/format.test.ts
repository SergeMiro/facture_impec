import { describe, expect, it } from 'vitest';
import { frDate, frDecimal, frMoney, frPrice, frRate, groupIban, NBSP } from './format';

const fr = (s: string) => s.replaceAll(' ', NBSP);

describe('French formatting', () => {
  it.each([
    ['1234.5', 0, '1 234,5'],
    ['1234.5', 2, '1 234,50'],
    ['12.3400', 2, '12,34'],
    ['12.3456', 2, '12,3456'],
    ['-1000000', 0, '-1 000 000'],
    [' 7 ', 0, '7'],
    ['abc', 2, 'abc'],
  ])('frDecimal(%j, %i) = %j', (value, min, expected) => {
    expect(frDecimal(value, min)).toBe(fr(expected));
  });

  it('writes money with its currency, never broken across lines', () => {
    expect(frMoney(125000)).toBe(fr('1 250,00 €'));
    expect(frMoney(-5)).toBe(fr('-0,05 €'));
    expect(frMoney(125000, 'USD')).toBe(fr('1 250,00 USD'));
    expect(frPrice('12.3456')).toBe(fr('12,3456 €'));
  });

  it('writes dates, rates and IBANs', () => {
    expect(frDate('2026-10-17')).toBe('17/10/2026');
    expect(frDate('17/10/2026')).toBe('17/10/2026');
    expect(frRate('5.5')).toBe(fr('5,5 %'));
    expect(groupIban('FR76 3000 6000 0112 3456 7890 189')).toBe(
      'FR76 3000 6000 0112 3456 7890 189',
    );
    expect(groupIban('FR7630006000011234567890189')).toBe('FR76 3000 6000 0112 3456 7890 189');
  });
});
