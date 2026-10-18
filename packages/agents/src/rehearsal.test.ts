import { describe, expect, it } from 'vitest';
import { type RehearsalChecks, rehearse } from './rehearsal';

const allOk = (): RehearsalChecks => ({
  valid: async () => ({ ok: true }),
  xml: async () => ({ ok: true }),
  pdf: async () => ({ ok: true }),
  directory: async () => ({ ok: true }),
  mentions: async () => ({ ok: true }),
  rejection: async () => ({ ok: true, detail: 'Rejet reçu et expliqué.' }),
});

describe('rehearse', () => {
  it('says « Prêt à envoyer » when every check passes', async () => {
    const r = await rehearse(allOk());
    expect(r.ready).toBe(true);
    expect(r.summary).toBe('Prêt à envoyer');
    expect(r.checklist.map((c) => c.label)).toEqual([
      'Facture conforme aux règles',
      'XML valide',
      'PDF lisible',
      "Client trouvé dans l'annuaire",
      'Mentions légales présentes',
      'Rejet simulé correctement géré',
    ]);
    expect(r.checklist.at(-1)?.detail).toBe('Rejet reçu et expliqué.');
  });

  it('skips the simulated send of an invalid invoice and keeps the other checks', async () => {
    let simulated = false;
    const r = await rehearse({
      ...allOk(),
      valid: async () => ({ ok: false, detail: '2 point(s) bloquant(s) à corriger d’abord.' }),
      rejection: async () => {
        simulated = true;
        return { ok: true };
      },
    });
    expect(simulated).toBe(false);
    expect(r.ready).toBe(false);
    expect(r.summary).toContain('Pas encore prêt');
    expect(r.checklist.find((c) => c.item === 'rejection')?.detail).toContain('non effectué');
    expect(r.checklist.find((c) => c.item === 'xml')?.ok).toBe(true);
  });

  it('turns a crash into a calm failed item', async () => {
    const r = await rehearse({
      ...allOk(),
      pdf: async () => {
        throw new Error('font missing');
      },
    });
    expect(r.checklist.find((c) => c.item === 'pdf')).toMatchObject({
      ok: false,
      detail: expect.stringContaining("n'a pas été modifiée"),
    });
  });
});
