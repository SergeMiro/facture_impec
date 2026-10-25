import { mkdtemp, readFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageWrite, VaultOptions } from './compile';
import { walk } from './journal';

export const NOW = new Date('2026-10-25T10:00:00Z');
export const LATER = new Date('2026-10-25T10:05:00Z');

export const options = (now = NOW): VaultOptions => ({ now, sourceExists: () => true });

export const tempVault = () => mkdtemp(join(tmpdir(), 'fi-vault-'));

/** Every file of the vault and its text. */
export async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const f of (await walk(root)).sort()) files[f] = await readFile(join(root, f), 'utf8');
  return files;
}

export const read = (root: string, file: string) => readFile(join(root, file), 'utf8');

/** Dates a file's last change, as a person's editor would. */
export const touch = (root: string, file: string, at: Date) => utimes(join(root, file), at, at);

export const tiers = (slug: string, extra: Partial<PageWrite> = {}): PageWrite => ({
  path: `tiers/${slug}`,
  frontmatter: {
    type: 'tiers',
    title: `Entreprise ${slug}`,
    sources: ['erp:tiers-1'],
    roles: ['fournisseur'],
  },
  ...extra,
});

export const purchase = (number: string, party: string): PageWrite => ({
  path: `finances/2026/2026-10-21_achat_${party}_${number}`,
  frontmatter: {
    type: 'facture_achat',
    title: `Facture ${number}`,
    sources: [`invoice:${number}`],
    number,
    party: `tiers/${party}`,
    issue_date: '2026-10-21',
    due_date: '2026-11-20',
    ht: 1_000_000,
    tva: 200_000,
    ttc: 1_200_000,
    links: [
      {
        kind: 'issued_by',
        to: `tiers/${party}`,
        confidence: 'exact',
        evidence: 'SIREN de la facture',
      },
    ],
  },
});
