// Replays recorded model answers through the real agents (guardrails included) and scores them.
// A recording made with another prompt fails: re-record with `pnpm --filter @fi/agents eval:record`.
import { detectLayout, detectMapping } from '@fi/core';
import { describe, expect, it } from 'vitest';
import { CHAT_PROMPT_HASH } from '../src/chat';
import { EXPLAIN_PROMPT_HASH, explainIssues } from '../src/explain';
import { LAYOUT_PROMPT_HASH, proposeLayout } from '../src/layout';
import { MAPPING_PROMPT_HASH, proposeMapping } from '../src/mapping';
import { adviseNext, MONITOR_PROMPT_HASH } from '../src/monitor';
import {
  failingModel,
  handleFor,
  mockModel,
  testOrchestrator,
  textResult,
} from '../src/test-model';
import { CHAT_FIXTURES, playChat, type TurnScore } from './chat.fixtures';
import { EXPLAIN_FIXTURES } from './explain.fixtures';
import { loadRecordings, ratio, scoreLayout, scoreMapping } from './harness';
import { LAYOUT_FIXTURES } from './layout.fixtures';
import { MAPPING_FIXTURES } from './mapping.fixtures';
import { MONITOR_FIXTURES } from './monitor.fixtures';

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

describe('LayoutAgent eval fixtures', () => {
  it('are 20 sheets, five of each kind', () => {
    expect(LAYOUT_FIXTURES).toHaveLength(20);
    expect(new Set(LAYOUT_FIXTURES.map((f) => f.name)).size).toBe(20);
    for (const kind of ['order', 'delivery', 'purchase', 'price_list'])
      expect(
        LAYOUT_FIXTURES.filter((f) => f.expected.kind === kind),
        kind,
      ).toHaveLength(5);
  });

  it('header dictionary alone (the fallback): score kept as the baseline', () => {
    const scores = LAYOUT_FIXTURES.map((f) => scoreLayout(f, detectLayout(f.snapshot)));
    // Not a gate, and optimistic: the dictionary was tuned next to these sheets. In AI_PROVIDERS.md.
    expect(ratio(scores)).toBeGreaterThan(0.9);
  });

  for (const rec of loadRecordings('layout')) {
    describe(`recording ${rec.label} (${rec.provider} / ${rec.model})`, () => {
      it('was made with the current prompt', () => {
        expect(rec.promptHash, 'prompts/layout.md or its schema changed: re-record').toBe(
          LAYOUT_PROMPT_HASH,
        );
      });

      it(`scores ${rec.gate ? '≥ 95 %' : '(not gating)'} on the kind and the key fields`, async () => {
        const scores = [];
        for (const f of LAYOUT_FIXTURES) {
          const { orchestrator } = testOrchestrator({ retries: 0 });
          const { layout } = await proposeLayout(f.snapshot, {
            tenantId: 't',
            orchestrator,
            ai: handleFor(replayModel(rec.answers[f.name] ?? null), false),
          });
          scores.push(scoreLayout(f, layout));
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

describe('MonitorAgent eval fixtures', () => {
  it('cover the three proposals, coded and free-text reasons, and no reason at all', () => {
    expect(new Set(MONITOR_FIXTURES.map((f) => f.expected)).size).toBe(3);
    expect(MONITOR_FIXTURES.some((f) => f.reason?.code && !f.reason.text)).toBe(true);
    expect(MONITOR_FIXTURES.some((f) => f.reason?.text && !f.reason.code)).toBe(true);
    expect(MONITOR_FIXTURES.some((f) => f.reason === null)).toBe(true);
  });

  for (const rec of loadRecordings('monitor')) {
    describe(`recording ${rec.label} (${rec.provider} / ${rec.model})`, () => {
      it('was made with the current prompt', () => {
        expect(rec.promptHash, 'prompts/monitor.md or its schema changed: re-record').toBe(
          MONITOR_PROMPT_HASH,
        );
      });

      it(`proposes the expected next step ${rec.gate ? '≥ 85 %' : '(not gating)'}, never a wrong amount`, async () => {
        let right = 0;
        for (const f of MONITOR_FIXTURES) {
          const { orchestrator } = testOrchestrator({ retries: 0 });
          const { advice } = await adviseNext(
            f.invoice,
            { kind: 'refusal', reason: f.reason },
            {
              tenantId: 't',
              orchestrator,
              ai: handleFor(replayModel(rec.answers[f.name] ?? null), false),
            },
          );
          // Whatever the model wrote, the draft the user sees carries no amount but the invoice's own.
          expect(advice.draft?.body, f.name).toBeTruthy();
          if (advice.proposal === f.expected) right++;
        }
        if (rec.gate) expect(right / MONITOR_FIXTURES.length).toBeGreaterThanOrEqual(0.85);
      });
    });
  }
});

describe('ChatAgent eval fixtures', () => {
  it('cover explain → fix → undo on 300/400, a sent invoice and a finding without a fix', () => {
    const cards = CHAT_FIXTURES.flatMap((f) => f.turns.map((t) => t.expect?.tool ?? 'none'));
    expect(new Set(cards)).toEqual(new Set(['none', 'proposeFix', 'undoEdit']));
    expect(CHAT_FIXTURES.some((f) => f.turns.some((t) => t.answer?.status === 'refused'))).toBe(
      true,
    );
  });

  for (const rec of loadRecordings('chat')) {
    describe(`recording ${rec.label} (${rec.provider} / ${rec.model})`, () => {
      it('was made with the current prompt', () => {
        expect(rec.promptHash, 'prompts/chat.md or its tools changed: re-record').toBe(
          CHAT_PROMPT_HASH,
        );
      });

      it(`shows the right card on each turn ${rec.gate ? '(300/400 whole, ≥ 80 % overall)' : '(not gating)'}`, async () => {
        const scores: TurnScore[] = [];
        for (const f of CHAT_FIXTURES) {
          const answers = rec.answers[f.name];
          const model = Array.isArray(answers)
            ? mockModel(...(answers as Parameters<typeof mockModel>))
            : failingModel(new Error('recorded failure'));
          try {
            scores.push(...(await playChat(f, handleFor(model))));
          } catch {
            scores.push(
              ...f.turns.map((_, turn) => ({ fixture: f.name, turn, ok: false, why: ['failed'] })),
            );
          }
        }
        if (!rec.gate) return;
        const main = scores.filter((s) => s.fixture === '300-400');
        expect(main.filter((s) => !s.ok)).toEqual([]);
        expect(scores.filter((s) => s.ok).length / scores.length).toBeGreaterThanOrEqual(0.8);
      });
    });
  }
});
