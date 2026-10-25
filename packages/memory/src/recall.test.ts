import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Database, openDatabase, tenants } from '@fi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keysIn, RecallAnswer } from './recall';
import { MemoryStore } from './store';
import { NOW, purchase, read, tempVault } from './test-helpers';
import { MemoryVault } from './writer';

let database: Database;
const tenant = async (name: string) => {
  const [row] = await database.db
    .insert(tenants)
    .values({ name, siren: '100000009', pdpProvider: 'mock', pdpAccount: name })
    .returning();
  if (!row) throw new Error('no tenant');
  return row.id;
};
beforeAll(async () => {
  database = await openDatabase();
  await database.migrate();
});
afterAll(() => database.close());

const open = async (store: MemoryStore) => {
  const root = await tempVault();
  const vault = await MemoryVault.open(root, {
    host: 'test',
    clock: () => NOW,
    sourceExists: () => true,
    store,
  });
  const made = await vault.compile({
    reason: 'ingest',
    actor: 'agent:test',
    pages: [
      {
        path: 'tiers/marc-elec',
        frontmatter: {
          type: 'tiers',
          title: 'Marc Élec',
          sources: ['erp:tiers-1'],
          roles: ['fournisseur'],
          siren: '732829320',
        },
      },
      purchase('f-114', 'marc-elec'),
    ],
  });
  if (!made.ok) throw new Error(made.detail);
  return { root, vault };
};

describe('keys in a question', () => {
  it('reads a SIREN, a SIRET, a VAT number, an e-mail, a document number and every name', () => {
    const keys = keysIn(
      'SIREN 732 829 320, SIRET 73282932000074, TVA FR44732829320, compta@marc.example, facture F-2026-114 de Marc Élec ?',
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        'siren:732829320',
        'siret:73282932000074',
        'vat_id:fr44732829320',
        'email:comptamarcexample',
        'number:f2026114',
        'name:marc elec',
      ]),
    );
    expect(keysIn('Bonjour')).toEqual(['name:bonjour']);
  });
});

describe('recall', () => {
  it('follows what a person changed in the vault, and forgets a page they deleted', async () => {
    const store = new MemoryStore(database.db, await tenant('Atelier A'));
    const { root, vault } = await open(store);
    const ask = {
      intent: 'fact',
      question: 'Quel est le SIREN de Marc Élec ?',
      field: 'siren',
    } as const;
    expect(await vault.recall(ask)).toMatchObject({
      status: 'found',
      level: 1,
      hits: [{ path: 'tiers/marc-elec', value: '732829320' }],
    });
    const file = 'tiers/marc-elec.md';
    await writeFile(join(root, file), (await read(root, file)).replace('732829320', '552100554'));
    await vault.userEdits([file]);
    expect((await vault.recall(ask)).hits[0]?.value).toBe('552100554');

    const invoice = `${purchase('f-114', 'marc-elec').path}.md`;
    const byNumber = { intent: 'exists', question: 'La facture F-114 est-elle là ?' } as const;
    expect(await vault.recall(byNumber)).toMatchObject({ status: 'found', level: 1 });
    await import('node:fs/promises').then((fs) => fs.rm(join(root, invoice)));
    await vault.userEdits([invoice]);
    expect(await vault.recall(byNumber)).toMatchObject({ status: 'not_found', level: 6 });
    await vault.close();
  });

  it("never reads another company's memory", async () => {
    const a = new MemoryStore(database.db, await tenant('Atelier B'));
    const b = new MemoryStore(database.db, await tenant('Atelier C'));
    const { vault } = await open(a);
    const ask = {
      intent: 'fact',
      question: 'Quel est le SIREN de Marc Élec ?',
      field: 'siren',
    } as const;
    expect((await vault.recall(ask)).status).toBe('found');
    const other = await MemoryVault.open(await tempVault(), {
      host: 'test',
      clock: () => NOW,
      store: b,
    });
    expect(await other.recall(ask)).toMatchObject({ status: 'not_found' });
    await Promise.all([vault.close(), other.close()]);
  });

  it('refuses an answer without its pages, and « nothing » without what was searched', () => {
    const base = { level: 1, hits: [], searched: [], ms: 1, levelMs: 1 };
    expect(RecallAnswer.safeParse({ ...base, status: 'found' }).success).toBe(false);
    expect(RecallAnswer.safeParse({ ...base, status: 'not_found', level: 6 }).success).toBe(false);
    expect(
      RecallAnswer.safeParse({
        ...base,
        status: 'not_found',
        level: 6,
        searched: [{ level: 1, what: 'name:x', found: 0 }],
      }).success,
    ).toBe(true);
  });
});
