import { describe, expect, it } from 'vitest';
import type { InvoiceDraft } from './model';
import { buyerSirenOf, completeBuyer, type KnownParty, partyKey } from './party';

const party: KnownParty = {
  legalName: 'BOULANGERIE DUPONT',
  siren: '999000128',
  vatId: 'FR41999000128',
  address: { line1: '3 rue des Lilas', postCode: '21000', city: 'Dijon', country: 'FR' },
  email: 'compta@dupont.test',
};

const draft = (buyer: InvoiceDraft['buyer']): InvoiceDraft => ({
  number: 'F-1',
  buyer,
  seller: {},
});

describe('partyKey', () => {
  it('ignores case, accents, punctuation and spacing', () => {
    expect(partyKey('  Boulangerie  DUPONT-Frères, S.A.R.L. ')).toBe(
      'boulangerie dupont freres s a r l',
    );
    expect(partyKey('Électricité Générale')).toBe(partyKey('ELECTRICITE generale'));
  });
});

describe('completeBuyer (plan §6 phase 2)', () => {
  it('fills everything the sheet leaves empty', () => {
    const { draft: done, filled } = completeBuyer(draft({ name: 'Dupont' }), party);
    expect(filled).toEqual(['siren', 'vatId', 'address', 'email']);
    expect(done.buyer).toMatchObject({
      name: 'Dupont',
      legalId: { id: '999000128', scheme: '0002' },
      electronicAddress: { id: '999000128', scheme: '0225' },
      vatId: 'FR41999000128',
      address: party.address,
      contact: { email: 'compta@dupont.test' },
    });
    expect(buyerSirenOf(done)).toBe('999000128');
  });

  it('never replaces what the sheet says', () => {
    const sheet = draft({
      name: 'Dupont & fils',
      legalId: { id: '999000128', scheme: '0002' },
      vatId: 'FR00999000128',
      address: { line1: '1 place Darcy', city: 'Dijon' },
      contact: { email: 'paul@dupont.test' },
    });
    const { draft: done, filled } = completeBuyer(sheet, party);
    expect(filled).toEqual([]);
    expect(done).toBe(sheet);
  });

  it('fills the name when the sheet gives only the SIREN, and an address given as a country alone', () => {
    const { draft: done, filled } = completeBuyer(
      draft({ legalId: { id: '999000128' }, address: { country: 'FR' } }),
      party,
    );
    expect(filled).toEqual(['name', 'vatId', 'address', 'email']);
    expect(done.buyer.name).toBe('BOULANGERIE DUPONT');
    expect(done.buyer.address).toEqual(party.address);
  });

  it('leaves another customer alone: the sheet SIREN differs', () => {
    const sheet = draft({ name: 'Dupont', legalId: { id: '999000136' } });
    expect(completeBuyer(sheet, party)).toEqual({ draft: sheet, filled: [] });
  });

  it('fills no VAT number, address or e-mail the customer does not have', () => {
    const bare: KnownParty = { ...party, vatId: null, address: null, email: null };
    const { filled } = completeBuyer(draft({ name: 'Dupont' }), bare);
    expect(filled).toEqual(['siren']);
  });
});
