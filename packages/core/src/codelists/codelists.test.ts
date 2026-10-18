import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderGenerated } from './extract';
import { countryCodes, currencyCodes, unitCodes, vatCategoryCodes, vatexCodes } from './generated';

const vendor = (name: string) => {
  const bytes = readFileSync(new URL(`../../vendor/cen-1.3.17/codelist/${name}`, import.meta.url));
  return {
    name,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    text: bytes.toString('latin1'),
  };
};

describe('code lists', () => {
  it('match the vendored CEN files (run `pnpm --filter @fi/core codelists` after an upgrade)', () => {
    const expected = renderGenerated(
      '1.3.17',
      vendor('EN16931-CII-codes.sch'),
      vendor('EN16931-UBL-codes.sch'),
    );
    const actual = readFileSync(new URL('./generated.ts', import.meta.url), 'utf8');
    expect(actual).toBe(expected);
  });

  it('contain the codes French invoices use', () => {
    expect(currencyCodes.has('EUR')).toBe(true);
    expect(countryCodes.has('FR')).toBe(true);
    for (const unit of ['C62', 'H87', 'HUR', 'DAY', 'KGM']) expect(unitCodes.has(unit)).toBe(true);
    expect([...vatCategoryCodes].sort()).toEqual([
      'AE',
      'B',
      'E',
      'G',
      'K',
      'L',
      'M',
      'O',
      'S',
      'Z',
    ]);
    expect(vatexCodes.has('VATEX-FR-FRANCHISE')).toBe(true);
    expect(currencyCodes.has('XYZ')).toBe(false);
  });
});
