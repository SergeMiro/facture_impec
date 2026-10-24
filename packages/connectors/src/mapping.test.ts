import { describe, expect, it } from 'vitest';
import {
  type ChantierFields,
  chantierChange,
  customerOf,
  type PartyFields,
  partyChange,
} from './mapping';

const known: PartyFields = {
  legalName: 'DUPONT BATIMENT',
  siren: '100000009',
  siret: null,
  email: 'contact@dupont.test',
  address: null,
  erpRef: null,
  subcontracting: false,
};

describe('the shared mapping', () => {
  it('create a company as the ERP writes it; sous-traitance only for a supplier', () => {
    const row = { row: 2, code: 'F01', name: 'Roux', siren: '100000009', subcontracting: true };
    expect(partyChange(row, 'supplier', undefined)).toEqual({
      kind: 'insert',
      values: {
        legalName: 'Roux',
        siren: '100000009',
        siret: null,
        email: null,
        address: null,
        erpRef: 'F01',
        subcontracting: true,
      },
    });
    expect(partyChange(row, 'customer', undefined)).toMatchObject({
      values: { subcontracting: false },
    });
  });

  it('fill only what a known company lacks, and take the ERP code', () => {
    const row = {
      row: 3,
      code: 'C001',
      name: 'SARL Dupont',
      siren: '100000009',
      siret: '10000000900017',
      email: 'compta@dupont.test',
      address: { city: 'Dijon' },
      subcontracting: true,
    };
    // The name the directory gave, the e-mail a person typed and the switch stay.
    expect(partyChange(row, 'supplier', known)).toEqual({
      kind: 'update',
      values: { erpRef: 'C001', siret: '10000000900017', address: { city: 'Dijon' } },
    });
    const filled = {
      ...known,
      erpRef: 'C001',
      siret: '10000000900017',
      address: { city: 'Dijon' },
    };
    expect(partyChange(row, 'supplier', filled)).toEqual({ kind: 'unchanged' });
  });

  it('rewrite a chantier where the ERP says something, and keep the rest', () => {
    const row = { row: 2, code: 'CH-01', name: 'Les Tilleuls', status: 'closed' as const };
    const before: ChantierFields = {
      erpRef: 'CH-01',
      name: 'Tilleuls',
      customerId: 'c-1',
      status: 'open',
      address: { city: 'Dijon' },
      receptionOn: '2026-01-15',
      reservesLiftedOn: null,
      retenueBps: 500,
    };
    expect(chantierChange(row, null, before)).toEqual({
      kind: 'update',
      values: { name: 'Les Tilleuls', status: 'closed' },
    });
    expect(chantierChange({ ...row, name: 'Tilleuls', status: 'open' }, 'c-1', before)).toEqual({
      kind: 'unchanged',
    });
    // The database gives an address's keys in its own order: the same address is no change.
    const stored = {
      ...before,
      address: { postCode: '21000', line1: '2 rue Neuve', city: 'Dijon' },
    };
    const again = {
      ...row,
      name: 'Tilleuls',
      status: 'open' as const,
      address: { line1: '2 rue Neuve', postCode: '21000', city: 'Dijon' },
    };
    expect(chantierChange(again, null, stored)).toEqual({ kind: 'unchanged' });
    expect(chantierChange(row, 'c-2', undefined)).toEqual({
      kind: 'insert',
      values: {
        erpRef: 'CH-01',
        name: 'Les Tilleuls',
        customerId: 'c-2',
        status: 'closed',
        address: null,
        receptionOn: null,
        reservesLiftedOn: null,
        retenueBps: null,
      },
    });
  });

  it('find a chantier’s customer by its code, its SIREN, or a name only one customer has', () => {
    const customers = [
      { id: 'a', erpRef: 'C001', siren: '100000009', legalName: 'Dupont Bâtiment' },
      { id: 'b', erpRef: null, siren: '300000007', legalName: 'Mairie de Talant' },
      { id: 'c', erpRef: null, siren: '400000006', legalName: 'Martin' },
      { id: 'd', erpRef: null, siren: '500000005', legalName: 'MARTIN' },
    ];
    const row = (customer: object) => ({ row: 2, code: 'X', name: 'X', customer });
    expect(customerOf(row({ code: 'C001', name: 'Autre' }), customers)).toBe('a');
    expect(customerOf(row({ siren: '300000007' }), customers)).toBe('b');
    expect(customerOf(row({ name: 'mairie de talant' }), customers)).toBe('b');
    expect(customerOf(row({ name: 'Martin' }), customers)).toBeNull();
    expect(customerOf(row({ code: 'C999' }), customers)).toBeNull();
    expect(customerOf({ row: 2, code: 'X', name: 'X' }, customers)).toBeNull();
  });
});
