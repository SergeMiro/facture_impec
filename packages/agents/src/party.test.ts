// PartyAgent (plan §6 ENRICH): what « Chercher dans l'annuaire » proposes and in what order, and the
// guardrail on « C'est ce client » (never a SIREN the directory does not vouch for now).
import { t } from '@fi/shared';
import { describe, expect, it } from 'vitest';
import {
  confirmParty,
  type DirectoryCompany,
  findParty,
  PARTY_CANDIDATES,
  type PartyTools,
} from './party';

const company = (siren: string, name: string | null, extra: Partial<DirectoryCompany> = {}) => ({
  siren,
  name,
  address: { line1: '1 rue de la Paix', postCode: '21000', city: 'Dijon', country: 'FR' },
  vatId: null,
  vatSource: 'computed' as const,
  closed: false,
  keptSiren: null,
  masked: false,
  ...extra,
});

/** Valid SIRENs (Luhn), synthetic companies. */
const MARTIN = company('200000008', 'BOULANGERIE MARTIN');
const MARTIN_FILS = company('100000009', 'BOULANGERIE MARTIN ET FILS');
const CLOSED = company('999000003', 'BOULANGERIE MARTIN', { closed: true });
const TWIN = company('999000011', 'MARTIN', { keptSiren: '999000029' });

function tools(over: Partial<PartyTools> = {}): PartyTools & { searches: unknown[] } {
  const searches: unknown[] = [];
  const known = [MARTIN, MARTIN_FILS, CLOSED, TWIN];
  return {
    searches,
    lookup: async (siren) => known.find((c) => c.siren === siren) ?? null,
    search: async (query) => {
      searches.push(query);
      return query.postCode === '75001' ? [] : [MARTIN_FILS, CLOSED, MARTIN];
    },
    routing: async (siren) => siren !== MARTIN_FILS.siren,
    ...over,
  };
}

describe('findParty', () => {
  it('puts the exact name first and what cannot be confirmed last, with the platform asked', async () => {
    const found = await findParty({ name: 'Boulangerie Martin' }, tools());
    expect(found.question).toBe(t('party.question.many', { count: 3 }));
    expect(found.candidates.map((c) => [c.siren, c.exactName, c.refusal, c.routing])).toEqual([
      [MARTIN.siren, true, null, true],
      [MARTIN_FILS.siren, false, null, false],
      // Not asked: it cannot be confirmed anyway.
      [CLOSED.siren, true, 'closed', null],
    ]);
  });

  it('asks again without the post code when it narrows to nothing', async () => {
    const used = tools();
    const found = await findParty({ name: 'Martin', postCode: '75001' }, used);
    expect(used.searches).toEqual([{ name: 'Martin', postCode: '75001' }, { name: 'Martin' }]);
    expect(found.candidates).toHaveLength(3);
  });

  it('looks a SIREN up directly, refusing a bad one before asking anyone', async () => {
    const used = tools();
    expect(await findParty({ siren: '200 000 008' }, used)).toMatchObject({
      question: t('party.question.one'),
      candidates: [{ siren: MARTIN.siren, exactName: false, routing: true }],
    });
    expect(await findParty({ siren: '200000009' }, used)).toEqual({
      candidates: [],
      question: t('party.question.badSiren'),
    });
    expect(await findParty({ siren: '999000052' }, used)).toEqual({
      candidates: [],
      question: t('party.question.noSiren'),
    });
    expect(await findParty({ siren: TWIN.siren }, used)).toMatchObject({
      candidates: [{ refusal: 'duplicate', keptSiren: '999000029', routing: null }],
    });
    expect(used.searches).toEqual([]);
  });

  it('wants three letters, says when nothing matches, and keeps at most five', async () => {
    expect(await findParty({ name: ' a-b ' }, tools())).toEqual({
      candidates: [],
      question: t('party.question.tooShort'),
    });
    expect(await findParty({}, tools())).toMatchObject({ question: t('party.question.tooShort') });
    const none = tools({ search: async () => [] });
    expect(await findParty({ name: 'Inconnu' }, none)).toEqual({
      candidates: [],
      question: t('party.question.none'),
    });
    const many = Array.from({ length: 8 }, (_, i) => company(`99800000${i}`, null));
    const crowded = await findParty({ name: 'Martin' }, tools({ search: async () => many }));
    expect(crowded.candidates).toHaveLength(PARTY_CANDIDATES);
    // A withheld name is never « the exact name ».
    expect(crowded.candidates.every((c) => !c.exactName)).toBe(true);
  });

  it('shows a candidate whose reach the platform could not tell as unknown', async () => {
    const down = tools({
      routing: async () => {
        throw new Error('platform down');
      },
    });
    const found = await findParty({ siren: MARTIN.siren }, down);
    expect(found.candidates[0]?.routing).toBeNull();
  });
});

describe('confirmParty', () => {
  it('saves only a company the directory knows now, active and not a duplicate', async () => {
    expect(await confirmParty(MARTIN.siren, tools())).toEqual({
      ok: true,
      company: MARTIN,
      routing: true,
    });
    expect(await confirmParty('200000009', tools())).toEqual({ ok: false, reason: 'invalid' });
    expect(await confirmParty('999000052', tools())).toEqual({ ok: false, reason: 'unknown' });
    expect(await confirmParty(CLOSED.siren, tools())).toEqual({ ok: false, reason: 'closed' });
    expect(await confirmParty(TWIN.siren, tools())).toEqual({
      ok: false,
      reason: 'duplicate',
      keptSiren: '999000029',
    });
  });
});
