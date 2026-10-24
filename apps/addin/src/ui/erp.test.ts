import { EXPORT_LISTS, SKIP_REASONS } from '@fi/domain';
import { isMessageKey, t } from '@fi/shared';
import { describe, expect, it } from 'vitest';
import { chantiersOf } from './DocumentsView';
import { skippedOf } from './ErpPart';

describe('what the pane says of the ERP’s lists (BTP stage 4C)', () => {
  it('words every list and every reason a row is left out', () => {
    for (const list of EXPORT_LISTS) expect(isMessageKey(`erp.list.${list}`)).toBe(true);
    for (const reason of SKIP_REASONS) expect(isMessageKey(`erp.skip.${reason}`)).toBe(true);
  });

  it('lists the reasons the most frequent first, each with its rows', () => {
    const skipped = skippedOf({
      skipped: { no_siren: 1, duplicate: 3, paid: 0, gone: 1 },
      examples: [
        { row: 4, name: 'Mme Durand', reason: 'no_siren' },
        { row: 7, name: null, reason: 'duplicate' },
        { row: 9, name: 'Roux', reason: 'duplicate' },
      ],
    });
    expect(skipped.map((s) => [s.label, s.count, s.rows.map((r) => r.row)])).toEqual([
      [t('erp.skip.duplicate'), 3, [7, 9]],
      // A reason this pane does not know yet is still counted.
      [t('addin.erp.otherReason'), 1, []],
      [t('erp.skip.no_siren'), 1, [4]],
    ]);
  });

  it('offers each chantier the deadlines name once, by name', () => {
    const a = { id: 'a', name: 'Les Tilleuls' };
    const b = { id: 'b', name: 'École Jean Macé' };
    expect(
      chantiersOf([{ chantier: a }, { chantier: null }, { chantier: b }, { chantier: a }]),
    ).toEqual([b, a]);
  });
});
