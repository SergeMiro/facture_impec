import { t } from '@fi/shared';
import { describe, expect, it } from 'vitest';
import { CHECK_CORPUS } from '../../test/checks-corpus';
import { checkRegistry } from './check';
import { linkId } from './link';
import { CHECK_RULES } from './types';

const TODAY = '2026-10-20';

describe('R2 corpus', () => {
  it('has at least 30 scenarios, each rule firing in one and quiet in another', () => {
    expect(CHECK_CORPUS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(CHECK_CORPUS.map((s) => s.name)).size).toBe(CHECK_CORPUS.length);
    for (const rule of CHECK_RULES) {
      expect(
        CHECK_CORPUS.some((s) => s.fires.includes(rule)),
        `${rule} fires`,
      ).toBe(true);
      expect(
        CHECK_CORPUS.some((s) => s.quiet.includes(rule)),
        `${rule} quiet`,
      ).toBe(true);
    }
  });

  for (const s of CHECK_CORPUS) {
    it(`${s.name}: ${s.about}`, () => {
      const out = checkRegistry({
        docs: s.docs,
        decisions: s.decisions ?? [],
        today: s.today ?? TODAY,
      });
      const number = (id: string) => s.docs.find((d) => d.id === id)?.number;
      const got = out.findings.map((f) => ({
        message: f.message,
        doc: number(f.docId),
        amount: f.amount,
      }));
      expect(got).toEqual(s.expected);
      // What the scenario says it shows is what it shows.
      for (const rule of s.fires) expect(got.some((f) => f.message.startsWith(rule))).toBe(true);
      for (const rule of s.quiet) expect(got.some((f) => f.message.startsWith(rule))).toBe(false);
      for (const l of s.links ?? []) {
        const found = out.links.filter(
          (x) => number(x.fromDocId) === l.from && number(x.toDocId) === l.to,
        );
        expect(
          found.map((x) => x.status),
          `${l.from} → ${l.to}`,
        ).toEqual([l.status]);
      }
      // Every wording gets all its values.
      for (const f of out.findings) {
        expect(t(`check.message.${f.message}`, f.params)).not.toMatch(/\{\w+\}/);
      }
      // Keys are unique: they identify a finding from one run to the next.
      expect(new Set(out.findings.map((f) => f.key)).size).toBe(out.findings.length);
      expect(new Set(out.links.map(linkId)).size).toBe(out.links.length);
    });
  }
});
