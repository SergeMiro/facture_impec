// `pnpm perf` keeps working (docs/plans/phase-7.md › 7B): a run of 20 documents measures every path
// of §11 and leaves nothing unsettled or unsent. Whether a budget holds is `pnpm perf`'s to say, on
// 1 000 documents and an idle machine, not this test's.
import { BUDGETS, formatPerf, percentile, runPerf } from '@fi/api/scenarios';
import { expect, it } from 'vitest';

it('takes the nearest-rank percentile', () => {
  expect(percentile([1, 2, 3, 4], 50)).toBe(2);
  expect(percentile([1, 2, 3, 4], 95)).toBe(4);
  expect(percentile([7], 95)).toBe(7);
  expect(percentile([], 95)).toBeNaN();
});

it('measures every path of §11 on a small run', { timeout: 240_000 }, async () => {
  const report = await runPerf({
    documents: 20,
    rate: 10,
    deadlines: 50,
    decisions: 2,
    reads: 4,
    validations: 50,
  });
  expect(report.documents).toMatchObject({ sent: 20, unsettled: 0 });
  expect(report.documents.read).toMatchObject({ xml: 9, text: 10, ocr: 1 });
  expect(report.requests).toEqual({ drafted: 5, decided: 2, unsent: 0 });
  expect(report.results.map((r) => r.path)).toEqual(Object.keys(BUDGETS));
  for (const r of report.results) expect(r.count, r.path).toBeGreaterThan(0);
  expect(report.results.find((r) => r.path === 'actions')?.count).toBe(4);
  expect(formatPerf(report).at(-1)).toMatch(/^(PASS|FAIL) in \d+ s$/);
});
