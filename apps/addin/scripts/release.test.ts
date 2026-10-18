import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { demoTable } from '../src/harness/demo';
import {
  ENGLISH_NOTICE,
  isStoreVersion,
  type Listing,
  listingProblems,
  parseListing,
  productionManifest,
  reviewerSample,
} from './release';

const DEV = readFileSync(new URL('../manifest.xml', import.meta.url), 'utf8');
const LISTING = readFileSync(
  new URL('../../../docs/appsource/listing-fr.md', import.meta.url),
  'utf8',
);
const URLS = {
  addin: 'https://app.facture-impec.test/addin/',
  support: 'https://facture-impec.test/aide',
  learnMore: 'https://facture-impec.test/aide#excel',
};

describe('the store manifest', () => {
  const store = productionManifest(DEV, URLS, '1.0.0.1');

  it('points every URL at the public host and drops what the store refuses', () => {
    expect(store).not.toMatch(/localhost|example\.com|<AppDomains>/);
    expect(store).toContain('<Version>1.0.0.1</Version>');
    expect(store).toContain('<SupportUrl DefaultValue="https://facture-impec.test/aide"/>');
    expect(store).toContain(
      '<IconUrl DefaultValue="https://app.facture-impec.test/addin/assets/icon-32.png"/>',
    );
    expect(store).toContain(
      '<HighResolutionIconUrl DefaultValue="https://app.facture-impec.test/addin/assets/icon-64.png"/>',
    );
    expect(store).toContain(
      '<SourceLocation DefaultValue="https://app.facture-impec.test/addin/taskpane.html"/>',
    );
    expect(store).toContain(
      '<bt:Url id="GetStarted.LearnMoreUrl" DefaultValue="https://facture-impec.test/aide#excel"/>',
    );
    // The same Id as in development: an update must keep it (docs/APPSOURCE.md §1).
    expect(store).toContain('<Id>65013856-1f36-4b17-9800-671932bb5e36</Id>');
    expect(store.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!-- Store manifest')).toBe(
      true,
    );
  });

  it('refuses a private, plain-http or placeholder URL, and a version the store refuses', () => {
    const build =
      (change: Partial<typeof URLS>, version = '1.0.0.0') =>
      () =>
        productionManifest(DEV, { ...URLS, ...change }, version);
    expect(build({ addin: 'http://app.facture-impec.test' })).toThrow(/https/);
    expect(build({ addin: 'https://localhost:3000' })).toThrow(/public/);
    expect(build({ support: 'https://www.example.com/support' })).toThrow(/placeholder/);
    expect(build({}, '1.0.0')).toThrow(/a\.b\.c\.d/);
    expect(['1.0.0.0', '6.23.0.1', '9999.9999.9999.9999'].every(isStoreVersion)).toBe(true);
    expect(['0.1.0.0', '1.0.0.10000', '1.0.0', 'v1.0.0.0'].some(isStoreVersion)).toBe(false);
  });
});

describe('the listing', () => {
  const ok: Listing = {
    name: 'Facture électronique depuis Excel',
    summary: 'Vérifiez, envoyez et suivez vos factures électroniques sans quitter Excel.',
    description: `Une description.\n\n${ENGLISH_NOTICE}`,
    keywords: ['facture électronique'],
  };

  it('passes within the limits, with the English sentence', () => {
    expect(listingProblems(ok)).toEqual([]);
  });

  it('names what Partner Center would refuse', () => {
    expect(
      listingProblems({
        ...ok,
        name: 'Facture gratuite !'.padEnd(51, '.'),
        description: `Prix : ⟨prix Essentiel⟩. ${'x'.repeat(4000)}`,
      }),
    ).toEqual([
      'name: 51 characters, at most 50',
      'description: 4025 characters, at most 4000',
      `description: must begin or end with « ${ENGLISH_NOTICE} »`,
      'name: no « free », « gratuit » or « ! »',
      'to fill in: ⟨prix Essentiel⟩',
    ]);
  });

  it('reads docs/appsource/listing-fr.md; only the owner’s blanks are left', () => {
    const listing = parseListing(LISTING);
    expect(listing.keywords.length).toBeGreaterThan(0);
    const problems = listingProblems(listing);
    expect(problems.every((p) => p.startsWith('to fill in: '))).toBe(true);
  });
});

describe('the reviewers’ sample', () => {
  it('pastes into Excel in any language: ISO dates, plain numbers', () => {
    const [header, first, , third] = reviewerSample(demoTable()).split('\n');
    expect(header?.split('\t').slice(0, 3)).toEqual(['N° Facture', 'Date', 'Date de prestation']);
    expect(first?.split('\t')).toEqual([
      'F2026-101',
      '2026-10-12',
      '2026-10-09',
      'Boulangerie Martin SAS',
      '200 000 008',
      '8 place du Marché',
      '21000',
      'Dijon',
      'Journée de conseil',
      '2',
      '450',
      '20%',
    ]);
    // F2026-103 keeps its missing date: the reviewers see an error explained.
    expect(third?.split('\t')[1]).toBe('');
  });
});
