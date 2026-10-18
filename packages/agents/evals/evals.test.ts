// Replays recorded model answers through the real agents (guardrails included) and scores them.
// A recording made with another prompt fails: re-record with `pnpm --filter @fi/agents eval:record`.
import { detectMapping } from '@fi/core';
import { describe, expect, it } from 'vitest';
import { EXPLAIN_PROMPT_HASH, explainIssues } from '../src/explain';
import { MAPPING_PROMPT_HASH, proposeMapping } from '../src/mapping';
import {
  failingModel,
  handleFor,
  mockModel,
  testOrchestrator,
  textResult,
} from '../src/test-model';
import { EXPLAIN_FIXTURES } from './explain.fixtures';
import { loadRecordings, ratio, scoreMapping } from './harness';
import { MAPPING_FIXTURES } from './mapping.fixtures';

const replayModel = (answer: unknown) =>
  answer === null
    ? failingModel(new Error('recorded failure'))
    : mockModel(textResult(JSON.stringify(answer)));

describe('MappingAgent eval fixtures', () => {
  it('are 20 sheets with expectations for the 8 core fields', () => {
    expect(MAPPING_FIXTURES).toHaveLength(20);
    expect(new Set(MAPPING_FIXTURES.map((f) => f.name)).size).toBe(20);
  });

  it('header dictionary alone (the fallback): score kept as the baseline', () => {
    const scores = MAPPING_FIXTURES.map((f) => scoreMapping(f, detectMapping(f.snapshot)));
    // Not a gate: the agent exists because the dictionary misses messy sheets. Recorded in AI_PROVIDERS.md.
    expect(ratio(scores)).toBeGreaterThan(0.7);
  });

  for (const rec of loadRecordings('mapping')) {
    describe(`recording ${rec.label} (${rec.provider} / ${rec.model})`, () => {
      it('was made with the current prompt', () => {
        expect(rec.promptHash, 'prompts/mapping.md or its schema changed: re-record').toBe(
          MAPPING_PROMPT_HASH,
        );
      });

      it(`scores ${rec.gate ? '≥ 95 %' : '(not gating)'} on the core fields`, async () => {
        const scores = [];
        for (const f of MAPPING_FIXTURES) {
          const { orchestrator } = testOrchestrator({ retries: 0 });
          const answer = rec.answers[f.name] ?? null;
          const { mapping } = await proposeMapping(f.snapshot, {
            tenantId: 't',
            orchestrator,
            ai: handleFor(replayModel(answer), false),
          });
          scores.push(scoreMapping(f, mapping));
        }
        if (rec.gate) expect(ratio(scores)).toBeGreaterThanOrEqual(0.95);
        else expect(ratio(scores)).toBeGreaterThan(0);
      });
    });
  }
});

describe('ExplainAgent eval fixtures', () => {
  it('cover formatting fixes and issues that must never be auto-fixed', () => {
    const issues = EXPLAIN_FIXTURES.flatMap((f) => f.issues);
    expect(issues.some((i) => i.autoFixable)).toBe(true);
    expect(issues.some((i) => !i.autoFixable)).toBe(true);
    for (const f of EXPLAIN_FIXTURES) expect(f.issues.length, f.name).toBeGreaterThan(0);
  });

  for (const rec of loadRecordings('explain')) {
    describe(`recording ${rec.label} (${rec.provider} / ${rec.model})`, () => {
      it('was made with the current prompt', () => {
        expect(rec.promptHash, 'prompts/explain.md or its schema changed: re-record').toBe(
          EXPLAIN_PROMPT_HASH,
        );
      });

      it('never ends with an automatic fix the rules forbid', async () => {
        let explained = 0;
        let total = 0;
        for (const f of EXPLAIN_FIXTURES) {
          const { orchestrator } = testOrchestrator({ retries: 0 });
          const result = await explainIssues(f.invoice, f.issues, {
            tenantId: 't',
            orchestrator,
            ai: handleFor(replayModel(rec.answers[f.name] ?? null), false),
          });
          f.issues.forEach((issue, i) => {
            const e = result.explanations[i];
            if (!issue.autoFixable) expect(e?.auto_fix, `${f.name} ${issue.ruleId}`).toBeNull();
          });
          explained += result.explanations.filter((e) => e.source === 'agent').length;
          total += result.explanations.length;
        }
        if (rec.gate) expect(explained / total).toBeGreaterThanOrEqual(0.9);
      });
    });
  }
});
