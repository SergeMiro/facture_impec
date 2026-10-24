import { frMoney } from '@fi/core';
import { describe, expect, it } from 'vitest';
import { draftRequest, type RequestFacts } from './requests';

const base = {
  company: 'Atelier Dupont SARL',
  to: 'contact@plaquiste.example',
  dueOn: '2026-11-10',
  today: '2026-10-24',
  isTest: false,
} satisfies Omit<RequestFacts, 'kind'>;

describe('draftRequest', () => {
  it('asks a supplier for its new attestation before the date, and says it is past after', () => {
    const soon = draftRequest({ ...base, kind: 'demande_attestation_vigilance' });
    expect(soon.to).toBe('contact@plaquiste.example');
    expect(soon.subject).toBe('Attestation de vigilance URSSAF à renouveler');
    expect(soon.body).toContain('arrive à échéance le 10/11/2026');
    expect(soon.body).toContain('moins de six mois');
    expect(soon.body.trimEnd().endsWith('Atelier Dupont SARL')).toBe(true);
    const late = draftRequest({
      ...base,
      kind: 'demande_attestation_vigilance',
      today: '2026-11-11',
    });
    expect(late.body).toContain('est arrivée à échéance le 10/11/2026');
  });

  it('names the insurance asked for, and asks for a Kbis', () => {
    const rc = draftRequest({ ...base, kind: 'demande_attestation_assurance', insurance: 'rc' });
    expect(rc.subject).toContain('responsabilité civile professionnelle');
    const ten = draftRequest({
      ...base,
      kind: 'demande_attestation_assurance',
      insurance: 'decennale',
    });
    expect(ten.body).toContain('responsabilité civile décennale');
    expect(draftRequest({ ...base, kind: 'demande_kbis' }).subject).toBe(
      'Extrait Kbis à renouveler',
    );
  });

  it('asks a customer for the retenue with its law, and its amount only when known', () => {
    const plain = draftRequest({ ...base, kind: 'demande_liberation_retenue' });
    expect(plain.body).toContain('loi n° 71-584 du 16 juillet 1971');
    expect(plain.body).toContain('opposition motivée');
    expect(plain.body).not.toContain("d'un montant");
    const known = draftRequest({ ...base, kind: 'demande_liberation_retenue', amount: 123_456 });
    expect(known.body).toContain(`d'un montant de ${frMoney(123_456)}`);
  });

  it('reminds an unpaid invoice by its number and what is left to pay', () => {
    const d = draftRequest({
      ...base,
      kind: 'relance_facture',
      today: '2026-11-20',
      reference: 'F2026-104',
      amount: 180_000,
    });
    expect(d.subject).toBe('Facture F2026-104 : règlement en attente');
    expect(d.body).toContain(`la facture F2026-104 de ${frMoney(180_000)}, échue le 10/11/2026`);
    expect(d.body).toContain('ne pas tenir compte');
  });

  it('marks a Mode test draft, and leaves the address empty when none is known', () => {
    const d = draftRequest({ ...base, kind: 'demande_kbis', to: null, isTest: true });
    expect(d.subject.startsWith('[TEST] ')).toBe(true);
    expect(d.to).toBeNull();
  });

  it('never leaves a placeholder unfilled', () => {
    const kinds = [
      'demande_attestation_vigilance',
      'demande_kbis',
      'demande_attestation_assurance',
      'demande_liberation_retenue',
      'relance_facture',
      'relance_situation',
    ] as const;
    for (const kind of kinds) {
      const d = draftRequest({ ...base, kind, reference: 'X-1', amount: 100 });
      expect(`${d.subject}\n${d.body}`).not.toMatch(/[{}]/);
    }
  });
});
